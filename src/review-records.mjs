// @ts-check
// Sol review rounds, exemptions and coverage verdicts for one PR, appended as JSONL under
// <home>/.development-system/private/reviews/<owner>/<repo>/<number>.jsonl. The coordinator writes them
// (`review record`, `review coverage`); `pr-review-status` reads them for `mergeReady`. Budget: the first Sol
// round is `full`; a second, `fix-diff`, only after a blocking first round; a third is refused. An exemption binds
// one head and replaces any earlier exemption; rounds and exemptions never mix. Every read validates each record and
// the whole sequence, and every write checks and appends under an exclusive per-PR lock, so a hand-edited or racing
// file can never pass as approval. A record states what a reviewer or the coordinator concluded; it never authorizes a
// merge by itself.
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { parsePrReference } from "./evidence.mjs";

const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const FINDING_ID = /^[A-Za-z0-9_.-]+$/;
// Coverage also names Codex thread ids (`codex:<comment id>`).
const COVERAGE_ID = /^[A-Za-z0-9_.:-]+$/;
const SCOPES = ["full", "fix-diff"];
const RESULTS = ["blocking", "non-blocking", "none"];
const EXEMPTIONS = ["docs-only", "low-risk"];
const VERDICTS = ["fix-only", "out-of-scope"];

/**
 * @typedef {{id: string, paths: string[]}} Finding
 * @typedef {{type: "round", pr: string, reviewer: "sol", round: number, head: string, scope: "full" | "fix-diff", result: "blocking" | "non-blocking" | "none", thread: string, findings: Finding[], recordedAt: string}} RoundRecord
 * @typedef {{type: "exemption", pr: string, reviewer: "sol", head: string, exempt: "docs-only" | "low-risk", reason: string, recordedAt: string}} ExemptionRecord
 * @typedef {{type: "coverage", pr: string, from: string, to: string, findings: string[], verdict: "fix-only" | "out-of-scope", note: string, recordedAt: string}} CoverageRecord
 * @typedef {RoundRecord | ExemptionRecord | CoverageRecord} ReviewRecord
 */

/** @param {unknown} value */
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Accepts an array or a comma-separated string. @param {unknown} value @returns {string[]} */
function list(value) {
  if (value === undefined || value === null || value === "") return [];
  const items = Array.isArray(value) ? value : String(value).split(",");
  return items.map((item) => String(item).trim()).filter(Boolean);
}

/** The PR key and its JSONL file; owner and repo must be plain names so the path stays under the reviews root. @param {string} home @param {string | undefined} pr */
function locate(home, pr) {
  if (!pr) throw new Error("needs --pr <owner/repo#number | PR URL>");
  const reference = parsePrReference(pr);
  for (const part of [reference.owner, reference.repo]) if (!NAME.test(part) || part === "." || part === "..") throw new Error(`Not a PR reference: ${pr}`);
  return { key: reference.key, file: resolve(home, ".development-system/private/reviews", reference.owner, reference.repo, `${reference.number}.jsonl`) };
}

/** The lock that serializes `pr-review-status --request` for one PR. @param {string} home @param {string} pr */
export function requestLockPath(home, pr) {
  return locate(home, pr).file.replace(/\.jsonl$/, ".request.lock");
}

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

/** "<id>:<path>[+<path>...]" -> {id, paths}. @param {string} value @returns {Finding} */
export function parseFinding(value) {
  const at = value.indexOf(":");
  const id = at > 0 ? value.slice(0, at).trim() : "";
  const paths = at > 0 ? value.slice(at + 1).split("+").map((path) => path.trim()).filter(Boolean) : [];
  if (!FINDING_ID.test(id) || paths.length === 0 || paths.some((path) => path.includes(".."))) throw new Error(`Finding must be <id>:<path>[+<path>...]: ${value}`);
  return { id, paths };
}

/** @param {string} file @param {ReviewRecord} record */
function append(file, record) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

/** @param {unknown} value */
const isDate = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
/** Exactly these keys, no more, no fewer. @param {any} value @param {string[]} keys */
const hasKeys = (value, keys) => typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
/** @param {any} value */
const isFinding = (value) => hasKeys(value, ["id", "paths"]) && typeof value.id === "string" && FINDING_ID.test(value.id) && Array.isArray(value.paths) && value.paths.length > 0
  && value.paths.every((/** @type {unknown} */ path) => typeof path === "string" && path !== "" && path.trim() === path && !path.includes(".."));

/**
 * The first schema problem of one record, or "" when it is a complete record for `key`.
 * @param {any} record @param {string} key @returns {string}
 */
function recordProblem(record, key) {
  if (record?.pr !== key) return `is not a review record for ${key}`;
  if (record.type === "round") {
    if (!hasKeys(record, ["type", "pr", "reviewer", "round", "head", "scope", "result", "thread", "findings", "recordedAt"])) return "round has missing or unknown fields";
    if (record.reviewer !== "sol") return "round reviewer is not sol";
    if (record.round !== 1 && record.round !== 2) return "round number is not 1 or 2";
    if (typeof record.head !== "string" || !SHA.test(record.head)) return "round head is not a 40-hex SHA";
    if (!SCOPES.includes(record.scope)) return "round scope is not full or fix-diff";
    if (!RESULTS.includes(record.result)) return "round result is not blocking, non-blocking or none";
    if (!text(record.thread)) return "round has no thread";
    if (!Array.isArray(record.findings) || !record.findings.every(isFinding)) return "round findings are not {id, paths[]}";
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
 * The first sequence problem, or "": round 1 full; round 2 only fix-diff after a blocking round 1; never a third;
 * rounds and exemptions never mix (a later exemption replaces an earlier one).
 * @param {ReviewRecord[]} records @returns {string}
 */
function sequenceProblem(records) {
  const rounds = /** @type {RoundRecord[]} */ (records.filter((record) => record.type === "round"));
  if (rounds.length && records.some((record) => record.type === "exemption")) return "has both Sol rounds and an exemption";
  if (rounds.length > 2) return "has more than two Sol rounds";
  if (rounds.some((round, index) => round.round !== index + 1)) return "numbers its Sol rounds out of order";
  if (rounds[0] && rounds[0].scope !== "full") return "has a first Sol round that is not full";
  if (rounds[1] && (rounds[0].result !== "blocking" || rounds[1].scope !== "fix-diff")) return "has a second Sol round that is not a fix-diff after a blocking first round";
  return "";
}

/**
 * Every record for one PR, oldest first. Fails closed: a malformed line, an incomplete or foreign record, or an
 * impossible round sequence throws, so a damaged or hand-edited file can never hide a blocking round or fake approval.
 * @param {string} home @param {string} pr @returns {ReviewRecord[]}
 */
export function readReviewRecords(home, pr) {
  const { key, file } = locate(home, pr);
  if (!existsSync(file)) return [];
  const records = readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    /** @type {any} */
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`${file}:${index + 1} is not valid JSON`); }
    const problem = recordProblem(record, key);
    if (problem) throw new Error(`${file}:${index + 1} ${problem}`);
    return /** @type {ReviewRecord} */ (record);
  });
  const problem = sequenceProblem(records);
  if (problem) throw new Error(`${file} ${problem}`);
  return records;
}

/** Appends `record` only if it and the whole sequence read under the lock stay valid. @param {string} home @param {string} key @param {string} file @param {ReviewRecord} record */
function appendChecked(home, key, file, record) {
  const problem = recordProblem(record, key) || sequenceProblem([...readReviewRecords(home, key), record]);
  if (problem) throw new Error(`refusing to record: ${key} ${problem}`);
  append(file, record);
}

/**
 * Records one Sol round, or an exemption instead of any round.
 * @param {{home: string, pr?: string, reviewer?: string, head?: string, scope?: string, result?: string, thread?: string, findings?: string[] | string, exempt?: string, reason?: string}} options
 */
export function recordReview({ home, pr, reviewer, head, scope, result, thread, findings, exempt, reason }) {
  const { key, file } = locate(home, pr);
  if (reviewer !== "sol") throw new Error("review record supports only --reviewer sol");
  if (!head || !SHA.test(head)) throw new Error("review record needs --head <40-hex SHA the reviewer read>");
  if (exempt !== undefined) {
    if (!EXEMPTIONS.includes(exempt)) throw new Error("--exempt must be docs-only or low-risk");
    if (!text(reason)) throw new Error("--exempt needs --reason");
  } else {
    if (!scope || !SCOPES.includes(scope)) throw new Error("--scope must be full or fix-diff");
    if (!result || !RESULTS.includes(result)) throw new Error("--result must be blocking, non-blocking or none");
    if (!text(thread)) throw new Error("review record needs --thread <reviewer thread reference>");
  }
  const parsed = list(findings).map(parseFinding);
  const ids = parsed.map((finding) => finding.id);
  if (new Set(ids).size !== ids.length) throw new Error("finding ids must be unique");
  // Check and append under one lock, re-reading inside it, so two concurrent records cannot both pass the budget.
  return withFileLock(`${file}.lock`, () => {
    const existing = readReviewRecords(home, key);
    const rounds = /** @type {RoundRecord[]} */ (existing.filter((record) => record.type === "round"));
    const recordedAt = new Date().toISOString();
    if (exempt !== undefined) {
      if (rounds.length) throw new Error(`${key} already has ${rounds.length} Sol round(s); an exemption only replaces a round that never ran`);
      // An exemption binds its own head and replaces any earlier exemption.
      /** @type {ExemptionRecord} */
      const record = { type: "exemption", pr: key, reviewer: "sol", head, exempt: /** @type {ExemptionRecord["exempt"]} */ (exempt), reason: /** @type {string} */ (text(reason)), recordedAt };
      appendChecked(home, key, file, record);
      return { ok: true, operation: "review-record", path: file, record };
    }
    if (existing.some((record) => record.type === "exemption")) throw new Error(`${key} has a Sol exemption; rounds and exemptions do not mix (record a new exemption for this head or ask the owner)`);
    // Operator budget: one full round; a fix-diff second round only after a blocking first; never a third.
    if (rounds.length >= 2) throw new Error(`${key} already has two Sol rounds; a third needs the operator`);
    if (rounds.length === 0 && scope !== "full") throw new Error("the first Sol round must be --scope full");
    if (rounds.length === 1 && rounds[0].result !== "blocking") throw new Error(`a second Sol round needs a blocking first round (first was ${rounds[0].result})`);
    if (rounds.length === 1 && scope !== "fix-diff") throw new Error("the second Sol round must be --scope fix-diff");
    /** @type {RoundRecord} */
    const record = { type: "round", pr: key, reviewer: "sol", round: rounds.length + 1, head, scope: /** @type {RoundRecord["scope"]} */ (scope), result: /** @type {RoundRecord["result"]} */ (result), thread: /** @type {string} */ (text(thread)), findings: parsed, recordedAt };
    appendChecked(home, key, file, record);
    return { ok: true, operation: "review-record", path: file, record };
  });
}

/**
 * Records the coordinator's verdict on the commits from a reviewed head to a candidate head.
 * @param {{home: string, pr?: string, from?: string, to?: string, findings?: string[] | string, verdict?: string, note?: string}} options
 */
export function recordCoverage({ home, pr, from, to, findings, verdict, note }) {
  const { key, file } = locate(home, pr);
  if (!from || !SHA.test(from)) throw new Error("review coverage needs --from <40-hex reviewed head>");
  if (!to || !SHA.test(to)) throw new Error("review coverage needs --to <40-hex candidate head>");
  if (from === to) throw new Error("--from and --to must differ");
  if (!verdict || !VERDICTS.includes(verdict)) throw new Error("--verdict must be fix-only or out-of-scope");
  if (!text(note)) throw new Error("review coverage needs --note <why>");
  const ids = list(findings);
  if (verdict === "fix-only" && ids.length === 0) throw new Error("--verdict fix-only needs --findings <id,...> the commits fix");
  if (!ids.every((id) => COVERAGE_ID.test(id))) throw new Error("--findings must be finding ids");
  return withFileLock(`${file}.lock`, () => {
    /** @type {CoverageRecord} */
    const record = { type: "coverage", pr: key, from, to, findings: ids, verdict: /** @type {CoverageRecord["verdict"]} */ (verdict), note: /** @type {string} */ (text(note)), recordedAt: new Date().toISOString() };
    appendChecked(home, key, file, record);
    return { ok: true, operation: "review-coverage", path: file, record };
  });
}

/** @param {ReturnType<typeof recordReview> | ReturnType<typeof recordCoverage>} result */
export function formatReviewRecord(result) {
  const record = result.record;
  /** @param {string} sha */
  const short = (sha) => sha.slice(0, 12);
  if (record.type === "exemption") return `${record.pr}: Sol exempt (${record.exempt}) at head ${short(record.head)}: ${record.reason}.\nRecord: ${result.path}`;
  if (record.type === "round") {
    const findings = record.findings.map((finding) => `- ${finding.id}: ${finding.paths.join(", ")}`);
    return [`${record.pr}: Sol round ${record.round} (${record.scope}, ${record.result}) at head ${short(record.head)}, thread ${record.thread}, ${record.findings.length} finding(s).`, ...findings, `Record: ${result.path}`].join("\n");
  }
  return `${record.pr}: coverage ${short(record.from)}..${short(record.to)} ${record.verdict}${record.findings.length ? ` for ${record.findings.join(", ")}` : ""}: ${record.note}.\nRecord: ${result.path}`;
}
