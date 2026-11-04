// @ts-check
// Shared review state behind `review-records.mjs` (the facade the CLI and `pr-review-status` import): the per-PR Sol
// ledger (<reviews>/<owner>/<repo>/<n>.jsonl) and its owner voids (<n>.voids.jsonl), and the 2.9.0 review brake. The
// brake counts Sol rounds per branch lineage, not per PR: a lineage is owner/repo + head repository + head ref, and its
// PRs are the unmerged PRs with that head created after the latest merged one (a merge ends a lineage). Slots, approvals,
// reservations and releases live in a head sidecar <reviews>/<owner>/<repo>/branches/<hash>.jsonl shared by every
// lineage of that head; only entries of the current lineage's PRs count, older ones are history. Slot 1 is full;
// slot 2 is fix-diff after a blocking round; slot 3 and later also need an unused owner approval bound to (PR, slot,
// scope). A round is recorded only against a reservation, so every host (Claude hook, Codex wrapper or a
// coordinator calling the CLI) goes through the same brake. Every GitHub read that the brake depends on fails closed.
// A void annuls one ledger line (even a malformed or fake one) but restores no budget.
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { parsePrReference } from "./evidence.mjs";

export const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const FINDING_ID = /^[A-Za-z0-9_.-]+$/;
// Coverage also names Codex thread ids (`codex:<comment id>`).
export const COVERAGE_ID = /^[A-Za-z0-9_.:-]+$/;
export const SCOPES = ["full", "fix-diff"];
export const RESULTS = ["blocking", "non-blocking", "none"];
export const EXEMPTIONS = ["docs-only", "low-risk"];
export const VERDICTS = ["fix-only", "out-of-scope"];
export const ORIGINS = ["prior", "fix-induced", "new"];
export const CRITICAL = ["security", "authorization", "data-loss", "money", "minors-privacy", "consent"];
/** Sol rounds a lineage gets without the owner: one full, one fix-diff after a blocking round. */
export const BUDGET = 2;
/** A reviewer thread reference a person can open again; rejects placeholders such as "x". */
export const THREAD = /^(t3-thread:\/\/\S+|thread:\S{8,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(codex|claude):\S{8,}|https:\/\/\S+)$/i;
const REQUEST_KEY = /^[\x21-\x7e]{1,200}$/;

/**
 * @typedef {{id: string, paths: string[], origin?: "prior" | "fix-induced" | "new", critical?: string}} Finding
 * @typedef {{type: "round", pr: string, reviewer: "sol", round: number, head: string, scope: "full" | "fix-diff", result: "blocking" | "non-blocking" | "none", thread: string, findings: Finding[], recordedAt: string, operatorApproval?: string, slot?: number, from?: string, approvalId?: string}} RoundRecord
 * @typedef {{type: "exemption", pr: string, reviewer: "sol", head: string, exempt: "docs-only" | "low-risk", reason: string, recordedAt: string}} ExemptionRecord
 * @typedef {{type: "coverage", pr: string, from: string, to: string, findings: string[], verdict: "fix-only" | "out-of-scope", note: string, recordedAt: string}} CoverageRecord
 * @typedef {RoundRecord | ExemptionRecord | CoverageRecord} ReviewRecord
 * @typedef {{type: "void", pr: string, lineHash: string, reason: string, quote: string, recordedAt: string}} VoidRecord
 * @typedef {{type: "approval", id: string, lineage: string, pr: string, slot: number, scope: "full" | "fix-diff", quote: string, sourceRef?: string, recordedAt: string}} Approval
 * @typedef {{type: "reservation", id: string, lineage: string, pr: string, slot: number, scope: "full" | "fix-diff", requestKey: string, packetHash?: string, approvalId?: string, redesign?: string, reservedAt: string}} Reservation
 * @typedef {{type: "release", reservationId: string, reason: string, quote: string, recordedAt: string}} Release
 * @typedef {{number: number, key: string, state: string, merged: boolean}} LineagePr
 * @typedef {{id: string, hash: string, key: string, owner: string, repo: string, number: number, headRepo: string, headRef: string, file: string, prs: LineagePr[], pull: any}} Lineage
 */

/** @param {unknown} value */
export const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Accepts an array or a comma-separated string. @param {unknown} value @returns {string[]} */
export function list(value) {
  if (value === undefined || value === null || value === "") return [];
  const items = Array.isArray(value) ? value : String(value).split(",");
  return items.map((item) => String(item).trim()).filter(Boolean);
}

/** @param {string | Buffer} value */
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** @param {unknown} error */
const message = (error) => (error instanceof Error ? error.message : String(error)).split("\n").find((line) => line.trim())?.trim() ?? "unknown error";

/**
 * The PR key, number and its JSONL file; owner and repo must be plain names so the path stays under the reviews root.
 * @param {string} home @param {string | undefined} pr
 */
export function locate(home, pr) {
  if (!pr) throw new Error("needs --pr <owner/repo#number | PR URL>");
  const reference = parsePrReference(pr);
  for (const part of [reference.owner, reference.repo]) if (!NAME.test(part) || part === "." || part === "..") throw new Error(`Not a PR reference: ${pr}`);
  return { key: reference.key, owner: reference.owner, repo: reference.repo, number: reference.number, file: resolve(home, ".development-system/private/reviews", reference.owner, reference.repo, `${reference.number}.jsonl`) };
}

/** @param {string} file the per-PR ledger */
const voidsFile = (file) => file.replace(/\.jsonl$/, ".voids.jsonl");

// ---------------------------------------------------------------------------------------------------------------
// Locking

const MALFORMED_LOCK_MS = 600_000;
/** @param {number} ms */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {string} raw @returns {{pid: number, hostname: string, token: string} | undefined} */
function parseLock(raw) {
  try {
    const lock = JSON.parse(raw);
    if (Number.isInteger(lock?.pid) && lock.pid > 0 && text(lock.hostname) && text(lock.token)) return lock;
  } catch { /* malformed */ }
  return undefined;
}

/** The lock's identity: its token when the content parses, else the raw text. @param {string} raw */
const lockToken = (raw) => parseLock(raw)?.token ?? raw;

/** True unless the process is certainly gone: EPERM and any other error count as alive. @param {number} pid */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return /** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH"; }
}

/**
 * Removes the dead lock at `path` only while holding `<path>.recover`, so recoverers never race each other and the
 * canonical path is never detached from a live owner. True when this call removed it or it was already gone; false
 * while another recovery runs. A recovery guard left by a dead process fails closed for the operator.
 * @param {string} path @param {string} raw the dead lock content observed
 */
function removeDeadLock(path, raw) {
  const guard = `${path}.recover`;
  let fd;
  try { fd = openSync(guard, "wx", 0o600); } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
    let owner;
    let mtimeMs = Date.now();
    try { owner = parseLock(readFileSync(guard, "utf8")); mtimeMs = statSync(guard).mtimeMs; } catch { return false; }
    const dead = owner ? owner.hostname === hostname() && !pidAlive(owner.pid) : Date.now() - mtimeMs > MALFORMED_LOCK_MS;
    if (dead) throw new Error(`${guard} was left by a recovery that died; remove it once no run uses ${path}`);
    return false;
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString(), token: randomUUID() }));
    let current;
    try { current = readFileSync(path, "utf8"); } catch { return true; } // already released
    if (lockToken(current) === lockToken(raw)) unlinkSync(path);
    return true;
  } finally {
    closeSync(fd);
    unlinkSync(guard);
  }
}

/**
 * Runs `work` while holding an exclusive lock file (created with `wx`) whose JSON content names the owner
 * {pid, hostname, createdAt, token}. Only a lock of this host whose pid is gone (or malformed content older than
 * 10 minutes) is recovered; a live or foreign owner is retried for `waitMs`, then the call fails closed without
 * running `work`. Recovery removes the dead lock under a separate recovery guard, only if it still carries the observed token.
 * @template T @param {string} path @param {() => T} work @param {{waitMs?: number}} [options] @returns {T}
 */
export function withFileLock(path, work, { waitMs = 5_000 } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + waitMs;
  const token = randomUUID();
  /** @type {number | undefined} */
  let fd;
  while (fd === undefined) {
    try { fd = openSync(path, "wx", 0o600); } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      let raw;
      let mtimeMs;
      try { raw = readFileSync(path, "utf8"); mtimeMs = statSync(path).mtimeMs; } catch { continue; } // released between open and read
      const owner = parseLock(raw);
      const dead = owner ? owner.hostname === hostname() && !pidAlive(owner.pid) : Date.now() - mtimeMs > MALFORMED_LOCK_MS;
      if (dead && removeDeadLock(path, raw)) continue;
      if (Date.now() >= deadline) throw new Error(`${path} is held by a live or foreign run; retry when it finishes, or remove the lock file if its owner is gone`);
      pause(50);
    }
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString(), token }));
    return work();
  } finally {
    closeSync(fd);
    try { if (parseLock(readFileSync(path, "utf8"))?.token === token) unlinkSync(path); } catch { /* already gone */ }
  }
}

/** Appends one JSON line with private permissions (directory 0700, file 0600). @param {string} file @param {object} record */
export function append(file, record) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Non-empty lines of a JSONL file, raw (a void names the sha256 of one of these). @param {string} file @returns {string[]} */
export function rawLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim());
}

// ---------------------------------------------------------------------------------------------------------------
// Findings

const SUFFIX = /^(.*[^/])@([a-z-]+)(?:\/([a-z-]+))?$/;

/**
 * "<id>:<path>[+<path>...][@<origin>[/<critical>]]" -> {id, paths, origin?, critical?}. Origin is prior, fix-induced or
 * new; critical is one of the protected domains.
 * @param {string} value @returns {Finding}
 */
export function parseFinding(value) {
  const at = value.indexOf(":");
  const id = at > 0 ? value.slice(0, at).trim() : "";
  let rest = at > 0 ? value.slice(at + 1).trim() : "";
  /** @type {Finding["origin"]} */
  let origin;
  /** @type {string | undefined} */
  let critical;
  const suffix = SUFFIX.exec(rest);
  if (suffix) {
    if (!ORIGINS.includes(suffix[2])) throw new Error(`Finding origin must be ${ORIGINS.join(", ")}: ${value}`);
    if (suffix[3] !== undefined && !CRITICAL.includes(suffix[3])) throw new Error(`Finding critical domain must be ${CRITICAL.join(", ")}: ${value}`);
    rest = suffix[1];
    origin = /** @type {Finding["origin"]} */ (suffix[2]);
    critical = suffix[3];
  }
  const paths = rest.split("+").map((path) => path.trim()).filter(Boolean);
  if (!FINDING_ID.test(id) || paths.length === 0 || paths.some((path) => path.includes(".."))) throw new Error(`Finding must be <id>:<path>[+<path>...][@prior|fix-induced|new[/<critical>]]: ${value}`);
  return { id, paths, ...(origin ? { origin } : {}), ...(critical ? { critical } : {}) };
}

/**
 * From slot 2 on, a finding with origin `new` and no critical domain is a follow-up; anything else (prior,
 * fix-induced, unknown origin, any critical domain) blocks. The effective result is blocking iff a blocker exists; a
 * blocking result whose findings are all follow-ups becomes non-blocking. A blocking result that names no finding at
 * all stays blocking (it errs toward stopping). Slot 1 keeps the result as given.
 * @param {Finding[]} findings @param {number} slot @param {RoundRecord["result"]} result
 */
export function classifyFindings(findings, slot, result) {
  if (slot < 2) return { result, blockers: findings.map((finding) => finding.id), followUps: /** @type {string[]} */ ([]) };
  const followUp = (/** @type {Finding} */ finding) => finding.origin === "new" && !finding.critical;
  const blockers = findings.filter((finding) => !followUp(finding)).map((finding) => finding.id);
  const followUps = findings.filter(followUp).map((finding) => finding.id);
  /** @type {RoundRecord["result"]} */
  let effective = result;
  if (blockers.length) effective = "blocking";
  else if (result === "blocking" && followUps.length) effective = "non-blocking";
  return { result: effective, blockers, followUps };
}

// ---------------------------------------------------------------------------------------------------------------
// Per-PR ledger validation

/** @param {unknown} value */
const isDate = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
/** Exactly these keys, no more, no fewer. @param {any} value @param {string[]} keys */
const hasKeys = (value, keys) => typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
/** Every required key and nothing outside required + optional. @param {any} value @param {string[]} required @param {string[]} optional */
const hasShape = (value, required, optional) => typeof value === "object" && value !== null && !Array.isArray(value)
  && required.every((key) => key in value) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
/** @param {any} value */
const isFinding = (value) => hasKeys(value, ["id", "paths"]) && typeof value.id === "string" && FINDING_ID.test(value.id) && Array.isArray(value.paths) && value.paths.length > 0
  && value.paths.every((/** @type {unknown} */ path) => typeof path === "string" && path !== "" && path.trim() === path && !path.includes(".."));
/** A 2.9.0 finding: the legacy shape plus an origin and, with it, an optional critical domain. @param {any} value */
const isClassifiedFinding = (value) => hasShape(value, ["id", "paths"], ["origin", "critical"])
  && isFinding({ id: value.id, paths: value.paths })
  && (value.origin === undefined || ORIGINS.includes(value.origin))
  && (value.critical === undefined || (value.origin !== undefined && CRITICAL.includes(value.critical)));

/** Keys only 2.9.0 writes; a row without them is legacy-shaped and validates exactly as in 2.8.1. @param {any} record */
const isSlotRow = (record) => record && typeof record === "object" && ("slot" in record || "approvalId" in record);
/** @param {any} record */
const hasNewKeys = (record) => isSlotRow(record) || "from" in record
  || (Array.isArray(record.findings) && record.findings.some((/** @type {any} */ finding) => finding && typeof finding === "object" && ("origin" in finding || "critical" in finding)));
/** The lineage slot of a round row: its `slot`, else its local round number. @param {any} record */
export const slotOf = (record) => Number(record?.slot ?? record?.round);

/**
 * The first schema problem of one record, or "" when it is a complete record for `key`.
 * @param {any} record @param {string} key @returns {string}
 */
export function recordProblem(record, key) {
  if (record?.pr !== key) return `is not a review record for ${key}`;
  if (record.type === "round") {
    const keys = ["type", "pr", "reviewer", "round", "head", "scope", "result", "thread", "findings", "recordedAt"];
    if (hasNewKeys(record)) {
      // 2.9.0 row: optional slot (when it differs from the local round), from (fix-diff only) and approvalId (slot 3+).
      if (!hasShape(record, keys, ["slot", "from", "approvalId"])) return "round has missing or unknown fields";
      if (!Number.isInteger(record.round) || record.round < 1) return "round number is not a positive integer";
      if ("slot" in record && (!Number.isInteger(record.slot) || record.slot <= record.round)) return "round slot is not an integer past its local round number";
      if ("from" in record && (typeof record.from !== "string" || !SHA.test(record.from) || record.scope !== "fix-diff")) return "round from is not a 40-hex SHA on a fix-diff round";
      if (slotOf(record) >= 3 ? !text(record.approvalId) : "approvalId" in record) return "round past the lineage budget has no approval id, or an approval id inside the budget";
      if (!Array.isArray(record.findings) || !record.findings.every(isClassifiedFinding)) return "round findings are not {id, paths[], origin?, critical?}";
    } else {
      if (!hasKeys(record, Number(record.round) > 2 ? [...keys, "operatorApproval"] : keys)) return "round has missing or unknown fields";
      if (!Number.isInteger(record.round) || record.round < 1) return "round number is not a positive integer";
      if (record.round > 2 && (!text(record.operatorApproval) || record.scope !== "full")) return "round past the second has no operator approval or is not full";
      if (!Array.isArray(record.findings) || !record.findings.every(isFinding)) return "round findings are not {id, paths[]}";
    }
    if (record.reviewer !== "sol") return "round reviewer is not sol";
    if (typeof record.head !== "string" || !SHA.test(record.head)) return "round head is not a 40-hex SHA";
    if (!SCOPES.includes(record.scope)) return "round scope is not full or fix-diff";
    if (!RESULTS.includes(record.result)) return "round result is not blocking, non-blocking or none";
    if (!text(record.thread)) return "round has no thread";
    if (new Set(record.findings.map((/** @type {Finding} */ finding) => finding.id)).size !== record.findings.length) return "round finding ids repeat";
  } else if (record.type === "exemption") {
    if (!hasKeys(record, ["type", "pr", "reviewer", "head", "exempt", "reason", "recordedAt"])) return "exemption has missing or unknown fields";
    if (record.reviewer !== "sol") return "exemption reviewer is not sol";
    if (typeof record.head !== "string" || !SHA.test(record.head)) return "exemption head is not a 40-hex SHA";
    if (!EXEMPTIONS.includes(record.exempt)) return "exemption is not docs-only or low-risk";
    if (!text(record.reason)) return "exemption has no reason";
  } else if (record.type === "coverage") {
    if (!hasKeys(record, ["type", "pr", "from", "to", "findings", "verdict", "note", "recordedAt"])) return "coverage has missing or unknown fields";
    if (typeof record.from !== "string" || typeof record.to !== "string" || !SHA.test(record.from) || !SHA.test(record.to) || record.from === record.to) return "coverage from/to are not two distinct 40-hex SHAs";
    if (!Array.isArray(record.findings) || !record.findings.every((/** @type {unknown} */ id) => typeof id === "string" && COVERAGE_ID.test(id))) return "coverage findings are not finding ids";
    if (!VERDICTS.includes(record.verdict)) return "coverage verdict is not fix-only or out-of-scope";
    if (record.verdict === "fix-only" && record.findings.length === 0) return "fix-only coverage names no findings";
    if (!text(record.note)) return "coverage has no note";
  } else return "has an unknown record type";
  return isDate(record.recordedAt) ? "" : "has no valid recordedAt";
}

/**
 * The first sequence problem, or "". Legacy files (no 2.9.0 slot rows): round 1 full; round 2 only fix-diff after a
 * blocking round 1; a third or later only full, after a blocking round, with the operator's approval. With slot rows
 * (2.9.0, lineage-wide): local rounds stay numbered 1..n, each after a blocking local round, lineage slots strictly
 * increase, slot 1 is full and slot 2 fix-diff; the lineage-wide checks (previous round blocking, approvals) ran when
 * the slot was reserved. Rounds and exemptions never mix (a later exemption replaces an earlier one).
 * @param {ReviewRecord[]} records @returns {string}
 */
export function sequenceProblem(records) {
  const rounds = /** @type {RoundRecord[]} */ (records.filter((record) => record.type === "round"));
  if (rounds.length && records.some((record) => record.type === "exemption")) return "has both Sol rounds and an exemption";
  if (!rounds.some(isSlotRow)) {
    if (rounds.some((round, index) => index >= 2 && rounds[index - 1].result !== "blocking")) return "has a Sol round past the second after a non-blocking round";
    if (rounds.some((round, index) => round.round !== index + 1)) return "numbers its Sol rounds out of order";
    if (rounds[0] && rounds[0].scope !== "full") return "has a first Sol round that is not full";
    if (rounds[1] && (rounds[0].result !== "blocking" || rounds[1].scope !== "fix-diff")) return "has a second Sol round that is not a fix-diff after a blocking first round";
    return "";
  }
  if (rounds.some((round, index) => round.round !== index + 1)) return "numbers its Sol rounds out of order";
  if (rounds.some((round, index) => index >= 1 && rounds[index - 1].result !== "blocking")) return "has a Sol round after a non-blocking round";
  if (rounds.some((round, index) => index >= 1 && slotOf(round) <= slotOf(rounds[index - 1]))) return "has lineage slots that do not increase";
  if (rounds.some((round) => slotOf(round) === 1 && round.scope !== "full")) return "has a lineage slot 1 that is not full";
  if (rounds.some((round) => slotOf(round) === 2 && round.scope !== "fix-diff")) return "has a lineage slot 2 that is not fix-diff";
  return "";
}

/** @param {any} record @param {string} key @param {number} number */
function voidProblem(record, key, number) {
  if (!hasKeys(record, ["type", "pr", "lineHash", "reason", "quote", "recordedAt"]) || record.type !== "void") return "void has missing or unknown fields";
  if (record.pr !== key) return `is not a void for ${key}`;
  if (typeof record.lineHash !== "string" || !SHA256.test(record.lineHash)) return "void lineHash is not a sha256";
  if (!text(record.reason)) return "void has no reason";
  if (!ownerWords(record.quote)) return "void has no owner words";
  return isDate(record.recordedAt) ? "" : "void has no valid recordedAt";
}

/** The owner's voids of one PR ledger, validated; a malformed void file fails closed. @param {string} home @param {string} pr @returns {VoidRecord[]} */
export function readVoids(home, pr) {
  const { key, number, file } = locate(home, pr);
  const path = voidsFile(file);
  return rawLines(path).map((line, index) => {
    /** @type {any} */
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`${path}:${index + 1} is not valid JSON`); }
    const problem = voidProblem(record, key, number);
    if (problem) throw new Error(`${path}:${index + 1} ${problem}`);
    return /** @type {VoidRecord} */ (record);
  });
}

/**
 * Every non-voided record for one PR, oldest first. Voided lines are dropped before parsing, so a malformed or fake
 * line can be annulled by the owner. Fails closed: a malformed line, an incomplete or foreign record, or an impossible
 * round sequence throws, so a damaged or hand-edited file can never hide a blocking round or fake approval.
 * @param {string} home @param {string} pr @returns {ReviewRecord[]}
 */
export function readReviewRecords(home, pr) {
  const { key, file } = locate(home, pr);
  if (!existsSync(file)) return [];
  const voided = new Set(readVoids(home, key).map((record) => record.lineHash));
  const records = rawLines(file).flatMap((line, index) => {
    if (voided.has(sha256(line))) return [];
    /** @type {any} */
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`${file}:${index + 1} is not valid JSON`); }
    const problem = recordProblem(record, key);
    if (problem) throw new Error(`${file}:${index + 1} ${problem}`);
    return [/** @type {ReviewRecord} */ (record)];
  });
  const problem = sequenceProblem(records);
  if (problem) throw new Error(`${file} ${problem}`);
  return records;
}

/** Every raw line that parses as a round row, voided or not, with its hash. @param {string} file @param {Set<string>} voided */
function rawRounds(file, voided) {
  return rawLines(file).flatMap((line) => {
    const hash = sha256(line);
    try {
      const record = JSON.parse(line);
      return record && typeof record === "object" && record.type === "round" ? [{ hash, record, voided: voided.has(hash) }] : [];
    } catch { return []; }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Owner quotes

// The owner's words in the conversation are the approval ("apruebo", "pásatela", "sí, sigue"). The agent names the PR
// and the slot with --pr and --slot; the owner never has to repeat numbers (operator decision 2026-11-03).
/** True when `quote` holds the owner's words. @param {unknown} quote */
export function ownerWords(quote) {
  return Boolean(text(quote));
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub (literal argv, no shell; every failure inside the brake refuses)

/** @param {string[]} args */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** @param {string[]} args @param {string} what @returns {any} */
function ghJson(args, what) {
  try { return JSON.parse(gh(args)); } catch (error) {
    const stderr = String(/** @type {any} */ (error)?.stderr ?? "").split("\n").find((line) => line.trim())?.trim();
    throw new Error(`GitHub read failed (${what}): ${stderr || message(error)}; the review brake refuses without it`);
  }
}

/**
 * The PR's budget lineage: owner/repo + head repository + head ref. Its PRs are the unmerged PRs with that head that
 * were created after the latest merge on that head that happened before this PR was created (the PR itself is always
 * a member; when it is merged, later PRs belong to the next lineage). A branch rename starts a new lineage (accepted
 * residual). Any incomplete GitHub answer throws.
 * @param {{pr?: string, home: string, pull?: any}} options @returns {Lineage}
 */
export function resolveLineage({ pr, home, pull }) {
  const { key, owner, repo, number } = locate(home, pr);
  const base = `repos/${owner}/${repo}`;
  const current = pull ?? ghJson(["api", `${base}/pulls/${number}`], `${key}`);
  const headRepo = String(current?.head?.repo?.full_name ?? "").toLowerCase();
  const headOwner = String(current?.head?.repo?.owner?.login ?? "");
  const headRef = String(current?.head?.ref ?? "");
  if (!headRepo || !headOwner || !headRef) throw new Error(`${key} has no head repository or branch on GitHub (deleted fork?); the review brake refuses without a lineage`);
  const listed = ghJson(["api", "--paginate", "--slurp", `${base}/pulls?state=all&per_page=100&head=${encodeURIComponent(`${headOwner}:${headRef}`)}`], `PRs with head ${headOwner}:${headRef}`);
  if (!Array.isArray(listed)) throw new Error(`GitHub listed the PRs with head ${headOwner}:${headRef} in an unexpected shape; the review brake refuses`);
  const same = listed.flat().filter((entry) => String(entry?.head?.repo?.full_name ?? "").toLowerCase() === headRepo && String(entry?.head?.ref) === headRef);
  const target = same.find((entry) => Number(entry.number) === number);
  if (!target) throw new Error(`GitHub did not list ${key} among the PRs with head ${headOwner}:${headRef}; the review brake refuses`);
  /** @param {any} entry */
  const created = (entry) => Date.parse(String(entry.created_at));
  /** @param {any} entry */
  const merged = (entry) => (entry.merged_at ? Date.parse(String(entry.merged_at)) : Number.NaN);
  if (same.some((entry) => !Number.isFinite(created(entry)) || (entry.merged_at && !Number.isFinite(merged(entry))))) throw new Error(`GitHub reported a PR with head ${headOwner}:${headRef} without valid dates; the review brake refuses`);
  const cutoff = Math.max(-Infinity, ...same.filter((entry) => Number(entry.number) !== number && entry.merged_at && merged(entry) <= created(target)).map(merged));
  const end = target.merged_at ? merged(target) : Infinity;
  const members = same.filter((entry) => Number(entry.number) === number || (!entry.merged_at && created(entry) > cutoff && created(entry) < end))
    .sort((a, b) => Number(a.number) - Number(b.number))
    .map((entry) => ({ number: Number(entry.number), key: `${owner}/${repo}#${Number(entry.number)}`, state: String(entry.state), merged: Boolean(entry.merged_at) }));
  const id = `${owner}/${repo}|${headRepo}|${headRef}`;
  const hash = sha256(id).slice(0, 24);
  return { id, hash, key, owner, repo, number, headRepo, headRef, file: resolve(home, ".development-system/private/reviews", owner, repo, "branches", `${hash}.jsonl`), prs: members, pull: current };
}

/**
 * The SHA a reviewer read must be the PR's current head or one of its commits; GitHub failures refuse.
 * @param {Lineage} lineage @param {string} head
 */
export function verifyHead(lineage, head) {
  if (String(lineage.pull?.head?.sha) === head) return;
  const pages = ghJson(["api", "--paginate", "--slurp", `repos/${lineage.owner}/${lineage.repo}/pulls/${lineage.number}/commits?per_page=100`], `commits of ${lineage.key}`);
  const commits = Array.isArray(pages) ? pages.flat() : [];
  if (!commits.some((commit) => String(commit?.sha) === head)) throw new Error(`${head} is neither the head of ${lineage.key} nor one of its commits on GitHub; record the SHA the reviewer actually read`);
}

// ---------------------------------------------------------------------------------------------------------------
// Lineage sidecar

/** @param {any} record @param {string} lineage */
function sidecarProblem(record, lineage) {
  if (record?.type === "approval") {
    if (!hasShape(record, ["type", "id", "lineage", "pr", "slot", "scope", "quote", "recordedAt"], ["sourceRef"])) return "approval has missing or unknown fields";
    if (!Number.isInteger(record.slot) || record.slot < 3) return "approval slot is not 3 or later";
    if (!text(record.quote) || ("sourceRef" in record && !text(record.sourceRef))) return "approval has no quote or an empty sourceRef";
    if (!isDate(record.recordedAt)) return "approval has no valid recordedAt";
  } else if (record?.type === "reservation") {
    if (!hasShape(record, ["type", "id", "lineage", "pr", "slot", "scope", "requestKey", "reservedAt"], ["packetHash", "approvalId", "redesign"])) return "reservation has missing or unknown fields";
    if (!Number.isInteger(record.slot) || record.slot < 1) return "reservation slot is not a positive integer";
    if (typeof record.requestKey !== "string" || !REQUEST_KEY.test(record.requestKey)) return "reservation requestKey is not a printable key";
    if ("packetHash" in record && (typeof record.packetHash !== "string" || !SHA256.test(record.packetHash))) return "reservation packetHash is not a sha256";
    if (record.slot >= 3 ? !text(record.approvalId) : "approvalId" in record) return "reservation approval does not match its slot";
    if ("redesign" in record && !text(record.redesign)) return "reservation redesign is empty";
    if (!isDate(record.reservedAt)) return "reservation has no valid reservedAt";
  } else if (record?.type === "release") {
    if (!hasKeys(record, ["type", "reservationId", "reason", "quote", "recordedAt"])) return "release has missing or unknown fields";
    if (!text(record.reservationId) || !text(record.reason) || !text(record.quote)) return "release has no reservation id, reason or quote";
    return isDate(record.recordedAt) ? "" : "release has no valid recordedAt";
  } else return "has an unknown record type";
  if (record.lineage !== lineage) return `belongs to another lineage (${record.lineage})`;
  if (!text(record.id)) return "has no id";
  if (!SCOPES.includes(record.scope)) return "scope is not full or fix-diff";
  return typeof record.pr === "string" && /^[^#\s]+\/[^#\s]+#\d+$/.test(record.pr) ? "" : "has no PR key";
}

/** The lineage sidecar, validated; a damaged sidecar fails closed. @param {Lineage} lineage */
export function readSidecar(lineage) {
  /** @type {Approval[]} */
  const approvals = [];
  /** @type {Reservation[]} */
  const reservations = [];
  /** @type {Release[]} */
  const releases = [];
  rawLines(lineage.file).forEach((line, index) => {
    /** @type {any} */
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`${lineage.file}:${index + 1} is not valid JSON`); }
    const problem = sidecarProblem(record, lineage.id);
    if (problem) throw new Error(`${lineage.file}:${index + 1} ${problem}`);
    if (record.type === "approval") approvals.push(record);
    else if (record.type === "reservation") reservations.push(record);
    else releases.push(record);
  });
  const ids = [...approvals, ...reservations].map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${lineage.file} repeats an approval or reservation id`);
  if (releases.some((release) => !reservations.some((reservation) => reservation.id === release.reservationId))) throw new Error(`${lineage.file} releases an unknown reservation`);
  if (new Set(releases.map((release) => release.reservationId)).size !== releases.length) throw new Error(`${lineage.file} releases a reservation twice`);
  return { approvals, reservations, releases };
}

/**
 * Everything the brake decides from: sidecar entries, every lineage PR's non-voided rounds, and slots used =
 * non-released reservations + legacy round rows (pre-2.9.0, no reservation; voided ones still count: a void restores
 * no budget). Only the entries of the current lineage members count: the sidecar is shared by every lineage of the same
 * head (one file per owner/repo + head repository + head ref), so reservations and approvals of PRs outside the current
 * membership (a merged predecessor and the PRs of its lineage) are history, never pending, never unused, never a used
 * slot; a lineage after a merge starts at slot 1. A round row binds the live reservation of its PR with the same slot.
 * @param {string} home @param {Lineage} lineage
 */
export function lineageState(home, lineage) {
  const { approvals: allApprovals, reservations: allReservations, releases } = readSidecar(lineage);
  const members = new Set(lineage.prs.map((entry) => entry.key));
  const reservations = allReservations.filter((reservation) => members.has(reservation.pr));
  const approvals = allApprovals.filter((approval) => members.has(approval.pr));
  const released = new Set(releases.map((release) => release.reservationId));
  const live = reservations.filter((reservation) => !released.has(reservation.id));
  const prs = lineage.prs.map((entry) => {
    const { file } = locate(home, entry.key);
    const records = readReviewRecords(home, entry.key);
    const voided = new Set(readVoids(home, entry.key).map((record) => record.lineHash));
    return { ...entry, rounds: /** @type {RoundRecord[]} */ (records.filter((record) => record.type === "round")), raw: rawRounds(file, voided) };
  });
  /** @param {Reservation} reservation */
  const roundOf = (reservation) => prs.find((entry) => entry.key === reservation.pr)?.rounds.find((round) => slotOf(round) === reservation.slot);
  /**
   * Any round row (voided or not) of the reservation's own PR ledger with its slot, read from that ledger whether or
   * not the PR is still a lineage member.
   * @param {Reservation} reservation
   */
  const everBound = (reservation) => {
    const { file } = locate(home, reservation.pr);
    const voided = new Set(readVoids(home, reservation.pr).map((record) => record.lineHash));
    return rawRounds(file, voided).some((row) => slotOf(row.record) === reservation.slot);
  };
  const legacy = prs.flatMap((entry) => entry.raw.filter((row) => !live.some((reservation) => reservation.pr === entry.key && reservation.slot === slotOf(row.record))).map((row) => ({ pr: entry.key, ...row })));
  const pending = live.filter((reservation) => !roundOf(reservation)).sort((a, b) => a.slot - b.slot);
  const slotsUsed = live.length + legacy.length;
  // An approval is used once any reservation (of any lineage in the sidecar) names it.
  const used = new Set(allReservations.flatMap((reservation) => (reservation.approvalId ? [reservation.approvalId] : [])));
  const approvalsUnused = approvals.filter((approval) => !used.has(approval.id));
  const recorded = prs.flatMap((entry) => entry.rounds.map((round) => ({ pr: entry.key, round })))
    .sort((a, b) => Date.parse(a.round.recordedAt) - Date.parse(b.round.recordedAt) || slotOf(a.round) - slotOf(b.round));
  const last = recorded.at(-1);
  // A legacy last round (no reservation) has a local round number but no known lineage slot.
  const lastBound = last && live.some((reservation) => reservation.pr === last.pr && reservation.slot === slotOf(last.round));
  const lastRound = last ? { pr: last.pr, record: last.round, slot: lastBound ? slotOf(last.round) : undefined, fixInduced: last.round.result === "blocking" && last.round.findings.some((finding) => finding.origin === "fix-induced") } : undefined;
  return { lineage, approvals, reservations, allReservations, releases, live, pending, legacyRounds: legacy.length, slotsUsed, nextSlot: slotsUsed + 1, lastRound, approvalsUnused, roundOf, everBound };
}

/** The gate's view of a lineage. @param {ReturnType<typeof lineageState>} state */
export function lineageSummary(state) {
  return {
    id: state.lineage.id,
    prs: state.lineage.prs.map((entry) => entry.number),
    slotsUsed: state.slotsUsed,
    budget: BUDGET,
    nextSlot: state.nextSlot,
    approvalsUnused: state.approvalsUnused.map((approval) => ({ id: approval.id, pr: approval.pr, slot: approval.slot, scope: approval.scope })),
    pending: state.pending.map((reservation) => ({ id: reservation.id, pr: reservation.pr, slot: reservation.slot, scope: reservation.scope })),
    ...(state.lastRound ? { lastRound: { pr: state.lastRound.pr, round: state.lastRound.record.round, slot: state.lastRound.slot ?? null, result: state.lastRound.record.result, fixInduced: state.lastRound.fixInduced } } : {}),
  };
}

/** `<path>#<sha256>` of an existing file whose bytes hash to that value; returns the absolute form. @param {string} value @param {string} cwd */
function verifyRedesign(value, cwd) {
  const at = value.lastIndexOf("#");
  const path = at > 0 ? resolve(cwd, value.slice(0, at)) : "";
  const digest = at > 0 ? value.slice(at + 1).toLowerCase() : "";
  if (!path || !SHA256.test(digest)) throw new Error(`--redesign must be <path>#<sha256 of its bytes>: ${value}`);
  let bytes;
  try { bytes = readFileSync(path); } catch { throw new Error(`--redesign names ${path}, which is not a readable file`); }
  if (sha256(bytes) !== digest) throw new Error(`--redesign hash does not match the bytes of ${path} (sha256 ${sha256(bytes)})`);
  return `${path}#${digest}`;
}

/** @param {string} key */
const numberOf = (key) => Number(key.slice(key.lastIndexOf("#") + 1));

/**
 * Reserves the next lineage slot for one Sol round before it is launched. Idempotent per requestKey while its round
 * is unrecorded: a retry gets the same reservation; once that slot has a recorded round the key is spent and the call
 * refuses (reserve the next slot with a new key). Launch ownership of a reservation is single-use in the launchers
 * (the Codex wrapper keeps a launch claim per reservation). Past the budget only an unused owner approval recorded
 * for this same PR counts. Refused while another slot of the lineage is reserved but unrecorded, past the budget without an
 * unused owner approval for that slot and scope, after a non-blocking round, or after a fix-induced blocker without a
 * verified redesign. `dryRun` validates the same way and writes nothing.
 * @param {{home: string, pr?: string, scope?: string, requestKey?: string, packetHash?: string, approvalId?: string, redesign?: string, dryRun?: boolean, cwd?: string}} options
 */
export function reserveReview({ home, pr, scope, requestKey, packetHash, approvalId, redesign, dryRun = false, cwd = process.cwd() }) {
  if (!scope || !SCOPES.includes(scope)) throw new Error("--scope must be full or fix-diff");
  if (!requestKey || !REQUEST_KEY.test(requestKey)) throw new Error("review reserve needs --request-key <printable key, at most 200 characters> (the T3 clientRequestId or Task-Id + packet hash)");
  if (packetHash !== undefined && !SHA256.test(packetHash)) throw new Error("--packet-hash must be a sha256");
  if (approvalId !== undefined && !text(approvalId)) throw new Error("--approval-id needs a value");
  const lineage = resolveLineage({ pr, home });
  const work = () => {
    const state = lineageState(home, lineage);
    const existing = state.live.find((reservation) => reservation.requestKey === requestKey);
    if (existing) {
      if (existing.pr !== lineage.key || existing.scope !== scope) throw new Error(`request key ${requestKey} already reserved slot ${existing.slot} (${existing.scope}) for ${existing.pr}; use a new key for a different round`);
      if (state.roundOf(existing)) throw new Error(`request key ${requestKey} reserved slot ${existing.slot} (reservation ${existing.id}) and slot ${existing.slot} already recorded its round; reserve the next slot with a new request key (a new Task-Id or packet)`);
      return { ok: true, operation: "review-reserve", reused: true, path: lineage.file, reservation: existing, lineage: lineageSummary(state), ...(dryRun ? { dryRun: true } : {}) };
    }
    const waiting = state.pending[0];
    if (waiting) throw new Error(`slot ${waiting.slot} of this lineage is reserved for ${waiting.pr} (reservation ${waiting.id}) but has no recorded round: record it (development-system review record --pr ${waiting.pr} ...) or, with the owner's words, release it (development-system review release --pr ${waiting.pr} --reservation-id ${waiting.id} --reason <why> --quote "<owner's words>")`);
    const slot = state.nextSlot;
    const last = state.lastRound;
    /** @param {NonNullable<typeof last>} round */
    const where = (round) => `${round.pr}, ${round.slot ? `slot ${round.slot}` : `legacy round ${round.record.round}`}`;
    if (slot === 1 && scope !== "full") throw new Error("the first Sol round of a lineage must be --scope full");
    if (slot >= 2) {
      if (!last) throw new Error(`slot ${slot} needs a recorded blocking round before it; this lineage has ${state.slotsUsed} slot(s) used and no recorded round: decide el dueño`);
      if (last.record.result !== "blocking") throw new Error(`slot ${slot} needs a blocking previous round; the last recorded round of this lineage (${where(last)}) was ${last.record.result}: decide el dueño`);
      if (slot === 2 && scope !== "fix-diff") throw new Error("the second Sol round of a lineage must be --scope fix-diff");
    }
    /** @type {Approval | undefined} */
    let approval;
    if (slot >= 3) {
      // The owner's words authorize one PR: an approval recorded for another PR of the lineage never transfers.
      const candidates = state.approvalsUnused.filter((candidate) => candidate.slot === slot && candidate.pr === lineage.key);
      approval = approvalId ? candidates.find((candidate) => candidate.id === approvalId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!approval) {
        const elsewhere = state.approvalsUnused.find((candidate) => candidate.slot === slot && candidate.pr !== lineage.key && (!approvalId || candidate.id === approvalId));
        const why = elsewhere ? `approval ${elsewhere.id} for slot ${slot} was recorded for ${elsewhere.pr}, not ${lineage.key}; an approval does not transfer to another PR` : approvalId ? `approval ${approvalId} is not an unused approval for slot ${slot} of ${lineage.key}` : candidates.length > 1 ? `${candidates.length} unused approvals exist for slot ${slot}; name one with --approval-id` : `slot ${slot} is past the lineage budget (${BUDGET}) and has no unused owner approval`;
        throw new Error(`${why}: decide el dueño; record the owner's words with development-system review approve --pr ${lineage.key} --slot ${slot} --scope fix-diff --quote "<owner's words>"`);
      }
      if (approval.scope !== scope) throw new Error(`approval ${approval.id} for slot ${slot} is --scope ${approval.scope}, not ${scope}`);
    } else if (approvalId !== undefined) throw new Error(`--approval-id applies only past the budget (slot 3 or later); this is slot ${slot}`);
    if (last?.fixInduced && !redesign) throw new Error(`the last round of this lineage (${where(last)}) has a fix-induced blocking finding: redesign the fix before another round and pass --redesign <path>#<sha256 of its bytes> (packet line "Redesign: <path>#<sha256>")`);
    const verified = redesign === undefined ? undefined : verifyRedesign(redesign, cwd);
    /** @type {Reservation} */
    const reservation = {
      type: "reservation", id: randomUUID(), lineage: lineage.id, pr: lineage.key, slot, scope: /** @type {Reservation["scope"]} */ (scope), requestKey,
      ...(packetHash ? { packetHash } : {}), ...(approval ? { approvalId: approval.id } : {}), ...(verified ? { redesign: verified } : {}), reservedAt: new Date().toISOString(),
    };
    const problem = sidecarProblem(reservation, lineage.id);
    if (problem) throw new Error(`refusing to reserve: ${problem}`);
    if (!dryRun) append(lineage.file, reservation);
    return { ok: true, operation: "review-reserve", reused: false, path: lineage.file, reservation, lineage: (({ approvalsUnused, ...summary }) => ({ ...summary, slotsUsed: state.slotsUsed + 1, nextSlot: state.nextSlot + 1, approvalsUnused: approvalsUnused.filter((unused) => unused.id !== approval?.id) }))(lineageSummary(state)), ...(dryRun ? { dryRun: true } : {}) };
  };
  return dryRun ? work() : withFileLock(`${lineage.file}.lock`, work);
}

/**
 * Records the owner's approval of one lineage slot past the budget for the PR named by --pr, quoted verbatim. The
 * quote is the owner's words as said; --pr and --slot bind it to one PR and one slot. One approval allows at most one reservation.
 * @param {{home: string, pr?: string, slot?: string | number, scope?: string, quote?: string, sourceRef?: string, dryRun?: boolean}} options
 */
export function approveReview({ home, pr, slot, scope = "fix-diff", quote, sourceRef, dryRun = false }) {
  const number = Number(slot);
  if (!Number.isInteger(number) || number < 3) throw new Error("--slot must be 3 or later (slots 1 and 2 are the lineage budget)");
  if (!SCOPES.includes(scope)) throw new Error("--scope must be full or fix-diff");
  const words = text(quote);
  if (!words) throw new Error("review approve needs --quote <the owner's exact words>");
  if (sourceRef !== undefined && !text(sourceRef)) throw new Error("--source-ref needs a value");
  const lineage = resolveLineage({ pr, home });
  const work = () => {
    const state = lineageState(home, lineage);
    if (number <= state.slotsUsed) throw new Error(`slot ${number} of this lineage is already used (${state.slotsUsed} used)`);
    const twin = state.approvalsUnused.find((approval) => approval.slot === number && approval.pr === lineage.key);
    if (twin) throw new Error(`an unused approval for slot ${number} already exists (${twin.id}, ${twin.scope})`);
    /** @type {Approval} */
    const approval = { type: "approval", id: randomUUID(), lineage: lineage.id, pr: lineage.key, slot: number, scope: /** @type {Approval["scope"]} */ (scope), quote: words, ...(sourceRef ? { sourceRef: /** @type {string} */ (text(sourceRef)) } : {}), recordedAt: new Date().toISOString() };
    if (!dryRun) append(lineage.file, approval);
    return { ok: true, operation: "review-approve", path: lineage.file, approval, lineage: lineageSummary(state), ...(dryRun ? { dryRun: true } : {}) };
  };
  return dryRun ? work() : withFileLock(`${lineage.file}.lock`, work);
}

/**
 * Releases, with the owner's words, a reservation whose round never ran or was never recorded; that slot returns to
 * the lineage. A reservation with any recorded line (voided or not) cannot be released: a void restores no budget.
 * @param {{home: string, pr?: string, reservationId?: string, reason?: string, quote?: string}} options
 */
export function releaseReservation({ home, pr, reservationId, reason, quote }) {
  if (!text(reservationId)) throw new Error("review release needs --reservation-id <id>");
  if (!text(reason)) throw new Error("review release needs --reason <why the round did not run>");
  const words = text(quote);
  const lineage = resolveLineage({ pr, home });
  if (!ownerWords(words)) throw new Error("review release needs --quote <the owner's words>");
  return withFileLock(`${lineage.file}.lock`, () => {
    const state = lineageState(home, lineage);
    const reservation = state.reservations.find((candidate) => candidate.id === reservationId);
    if (!reservation) {
      const history = state.allReservations.find((candidate) => candidate.id === reservationId);
      if (history) throw new Error(`reservation ${reservationId} belongs to ${history.pr}, which is not a PR of the current lineage of ${lineage.key} (a merge ended its lineage); it is history and holds no slot`);
      throw new Error(`no reservation ${reservationId} in this lineage`);
    }
    if (!state.live.includes(reservation)) throw new Error(`reservation ${reservationId} is already released`);
    if (state.everBound(reservation)) throw new Error(`reservation ${reservationId} (slot ${reservation.slot}) has a recorded round; a void restores no budget, so it cannot be released`);
    /** @type {Release} */
    const release = { type: "release", reservationId: reservation.id, reason: /** @type {string} */ (text(reason)), quote: /** @type {string} */ (words), recordedAt: new Date().toISOString() };
    append(lineage.file, release);
    return { ok: true, operation: "review-release", path: lineage.file, release, reservation, lineage: { ...lineageSummary(state), slotsUsed: state.slotsUsed - 1, nextSlot: state.nextSlot - 1 } };
  });
}

/**
 * Annuls one line of a PR ledger by the sha256 of its raw text, with the owner's words. The line stays
 * in the file; readers drop it before parsing. A void restores no budget.
 * @param {{home: string, pr?: string, lineHash?: string, reason?: string, quote?: string}} options
 */
export function voidReviewLine({ home, pr, lineHash, reason, quote }) {
  const { key, number, file } = locate(home, pr);
  if (!lineHash || !SHA256.test(lineHash)) throw new Error("review void needs --line-hash <sha256 of the raw ledger line>");
  if (!text(reason)) throw new Error("review void needs --reason <why the line is wrong>");
  if (!ownerWords(quote)) throw new Error("review void needs --quote <the owner's words>");
  return withFileLock(`${file}.lock`, () => {
    if (!rawLines(file).some((line) => sha256(line) === lineHash)) throw new Error(`${file} has no line with sha256 ${lineHash}`);
    if (readVoids(home, key).some((record) => record.lineHash === lineHash)) throw new Error(`line ${lineHash} of ${key} is already voided`);
    /** @type {VoidRecord} */
    const record = { type: "void", pr: key, lineHash, reason: /** @type {string} */ (text(reason)), quote: /** @type {string} */ (text(quote)), recordedAt: new Date().toISOString() };
    append(voidsFile(file), record);
    let remaining = "";
    try { readReviewRecords(home, key); } catch (error) { remaining = message(error); }
    return { ok: true, operation: "review-void", path: voidsFile(file), record, ...(remaining ? { remainingProblem: remaining } : {}) };
  });
}

/** Ledger lines of one PR with their hashes, for choosing what to void. @param {string} home @param {string} pr */
export function ledgerLines(home, pr) {
  const { file } = locate(home, pr);
  return rawLines(file).map((line) => ({ lineHash: sha256(line), line }));
}
