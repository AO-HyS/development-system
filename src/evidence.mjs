// @ts-check
// Behavioral evidence receipts: what a real browser or computer-use run proved for one PR head, recorded before a
// develop merge. A receipt binds repository, PR, the head SHA that was verified and the revision the environment
// actually served during the run; `pr-review-status` turns the latest receipt into `behavioralEvidence` and the merge
// gate the guard reads. A receipt records evidence; it never authorizes a merge by itself.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const SHA = /^[0-9a-f]{40}$/;
const SHORT_SHA = /^[0-9a-f]{7,40}$/;
const FLOWS = /** @type {const} */ (["allowed", "denied", "effects"]);
const PLATFORMS = /** @type {const} */ (["ios", "android", "web"]);
// A merge pass is valid for two hours; GitHub refuses it anyway once the head moves (`--match-head-commit`).
const GATE_HOURS = 2;

/**
 * @typedef {"pass" | "fail"} FlowResult
 * @typedef {"ok" | "failed" | "incomplete" | "missing" | "stale" | "waived" | "nonvisual" | "nonfunctional"} EvidenceState
 * @typedef {{pr: string, verifiedSha: string, deployedSha?: string, environment?: string, account?: string, role?: string, flows: Partial<Record<"allowed" | "denied" | "effects", FlowResult>>, captures: string[], platforms?: string[], exception?: {kind: "nonvisual", reason: string, checks: string}, ownerWaiver?: string, status: "ok" | "failed" | "incomplete" | "waived" | "nonvisual", problems: string[], recordedAt: string, receiptSha256?: string}} Receipt
 * @typedef {{filename: string, status?: string, previous_filename?: string}} ChangedFile
 */

/** @param {string} home */
export const receiptRoot = (home) => resolve(home, ".development-system/private/evidence/receipts");
/** @param {string} home */
export const mergeGateRoot = (home) => resolve(home, ".development-system/private/merge-gates");

/** @param {string} pr */
export function parsePrReference(pr) {
  const url = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pr);
  const short = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(pr);
  const match = url ?? short;
  if (!match) throw new Error(`Not a PR reference: ${pr} (use owner/repo#number or the PR URL)`);
  return { owner: match[1].toLowerCase(), repo: match[2].toLowerCase(), number: Number(match[3]), key: `${match[1]}/${match[2]}#${match[3]}`.toLowerCase() };
}

/** @param {Record<string, unknown>} value */
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** @param {string | undefined} value */
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * Writes one receipt. Its status is decided here from what the run observed, not from what the caller hopes:
 * a deployed revision that differs from the verified head, or any failed flow, makes it `failed`.
 * @param {{home: string, pr?: string, verifiedSha?: string, deployedSha?: string, environment?: string, account?: string, role?: string, allowed?: string, denied?: string, effects?: string, captures?: string[], platforms?: string, exception?: string, reason?: string, checks?: string, ownerWaiver?: string}} options
 */
export function recordEvidence({ home, pr, verifiedSha, deployedSha, environment, account, role, allowed, denied, effects, captures = [], platforms, exception, reason, checks, ownerWaiver }) {
  if (!pr) throw new Error("evidence record needs --pr <owner/repo#number | PR URL>");
  const reference = parsePrReference(pr);
  if (!verifiedSha || !SHA.test(verifiedSha)) throw new Error("evidence record needs --verified-sha <40-hex head SHA the run verified>");
  /** @type {string[]} */
  const problems = [];
  /** @type {Receipt["flows"]} */
  const flows = {};
  for (const [name, value] of Object.entries({ allowed, denied, effects })) {
    if (value === undefined) continue;
    if (value !== "pass" && value !== "fail") throw new Error(`--${name} must be pass or fail`);
    flows[/** @type {"allowed" | "denied" | "effects"} */ (name)] = value;
  }
  const covered = platforms === undefined ? undefined : [...new Set(platforms.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean))];
  const unknown = covered?.filter((name) => !PLATFORMS.includes(/** @type {typeof PLATFORMS[number]} */ (name)));
  if (covered && (!covered.length || unknown?.length)) throw new Error(`--platforms takes a comma list of ${PLATFORMS.join(", ")}`);
  const waiver = text(ownerWaiver);
  if (exception !== undefined && exception !== "nonvisual") throw new Error("--exception supports only nonvisual");
  if (exception && (!text(reason) || !text(checks))) throw new Error("--exception nonvisual needs --reason and --checks naming the real checks that ran");
  if (exception && waiver) throw new Error("use either --exception nonvisual or --owner-waiver, not both");
  /** @type {Receipt["status"]} */
  let status;
  if (waiver) status = "waived";
  else if (exception) status = "nonvisual";
  else {
    if (!deployedSha || !SHORT_SHA.test(deployedSha)) throw new Error("evidence record needs --deployed-sha: the revision the environment served during the run (preview deployment SHA or /version)");
    if (!text(environment)) throw new Error("evidence record needs --environment <preview URL or develop URL>");
    if (!verifiedSha.startsWith(deployedSha.toLowerCase()) && deployedSha.toLowerCase() !== verifiedSha) problems.push(`deployed revision ${deployedSha} is not the verified head ${verifiedSha.slice(0, 12)}`);
    for (const flow of FLOWS) {
      if (flows[flow] === "fail") problems.push(`${flow} failed`);
      if (!flows[flow]) problems.push(`${flow} missing`);
    }
    status = problems.some((problem) => !problem.endsWith("missing")) ? "failed" : problems.length ? "incomplete" : "ok";
  }
  /** @type {Receipt} */
  const receipt = {
    pr: reference.key, verifiedSha, ...(deployedSha ? { deployedSha: deployedSha.toLowerCase() } : {}),
    ...(text(environment) ? { environment: text(environment) } : {}), ...(text(account) ? { account: text(account) } : {}), ...(text(role) ? { role: text(role) } : {}),
    flows, captures: captures.map((path) => resolve(path)), ...(covered ? { platforms: covered } : {}),
    ...(exception ? { exception: { kind: "nonvisual", reason: /** @type {string} */ (text(reason)), checks: /** @type {string} */ (text(checks)) } } : {}),
    ...(waiver ? { ownerWaiver: waiver } : {}),
    status, problems, recordedAt: new Date().toISOString(),
  };
  receipt.receiptSha256 = digest(receipt);
  const directory = resolve(receiptRoot(home), `${reference.owner}-${reference.repo}-${reference.number}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = resolve(directory, `${receipt.recordedAt.replace(/[:.]/g, "-")}-${verifiedSha.slice(0, 12)}.json`);
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
  return { ok: status !== "failed", operation: "evidence-record", path: file, ...receipt };
}

/**
 * Receipts for one PR, newest last. A receipt whose hash no longer matches its content is ignored.
 * @param {string} home @param {string} pr @returns {{path: string, receipt: Receipt}[]}
 */
export function readReceipts(home, pr) {
  const reference = parsePrReference(pr);
  const directory = resolve(receiptRoot(home), `${reference.owner}-${reference.repo}-${reference.number}`);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().flatMap((name) => {
    const path = resolve(directory, name);
    try {
      const receipt = /** @type {Receipt} */ (JSON.parse(readFileSync(path, "utf8")));
      const { receiptSha256, ...body } = receipt;
      return receipt.pr === reference.key && receiptSha256 === digest(body) ? [{ path, receipt }] : [];
    } catch { return []; }
  });
}

/**
 * The only changes after a verified head that keep its receipt: prose Markdown under `docs/` or at the root.
 * Instructions, the architecture map, skills and anything else need a new run.
 * @param {ChangedFile} file
 */
export function isNonFunctionalChange(file) {
  /** @param {string} path */
  const prose = (path) => {
    if (!path.endsWith(".md") || path.includes("..")) return false;
    if (!(path.startsWith("docs/") || !path.includes("/"))) return false;
    if (["AGENTS.md", "CLAUDE.md", "SKILL.md"].includes(basename(path))) return false;
    if (path.startsWith("docs/architecture/") || /(^|\/)(skills|\.agents|\.claude|\.codex|\.github)\//.test(path)) return false;
    return true;
  };
  if (!prose(file.filename)) return false;
  if (file.status === "renamed" && (!file.previous_filename || !prose(file.previous_filename))) return false;
  return true;
}

/**
 * Native platforms a PR's mobile files need a run on. A mobile app is any `mobile/` directory (`apps/mobile/` included);
 * a `.ios.` or `.android.` file needs only its platform, every other mobile file needs both: a screen checked on one
 * platform has shipped broken on the other.
 * @param {ChangedFile[] | null | undefined} prFiles @returns {string[]}
 */
export function requiredPlatforms(prFiles) {
  const required = new Set();
  for (const file of prFiles ?? []) {
    if (!/(^|\/)mobile\//.test(file.filename) || file.filename.endsWith(".md")) continue;
    const name = basename(file.filename);
    if (/\.ios\./.test(name)) required.add("ios");
    else if (/\.android\./.test(name)) required.add("android");
    else { required.add("ios"); required.add("android"); }
  }
  return ["ios", "android"].filter((platform) => required.has(platform));
}

/**
 * `behavioralEvidence` for one PR head from its latest receipt. Pure: the caller supplies the PR body and, when the head
 * moved after the receipt, the files changed between the verified SHA and the head (null when GitHub could not list
 * them completely).
 * @param {{receipts: {path: string, receipt: Receipt}[], head: string, prBody?: string, changedFiles?: ChangedFile[] | null, prFiles?: ChangedFile[] | null}} input
 */
export function evaluateEvidence({ receipts, head, prBody = "", changedFiles, prFiles }) {
  const latest = receipts.at(-1);
  // A PR whose every file is prose documentation has no behavior to run; an incomplete file list never qualifies.
  if (!latest && prFiles?.length && prFiles.every(isNonFunctionalChange)) {
    return { state: /** @type {EvidenceState} */ ("nonfunctional"), reason: `only prose docs changed: ${prFiles.map((file) => file.filename).slice(0, 5).join(", ")}` };
  }
  if (!latest) return { state: /** @type {EvidenceState} */ ("missing"), reason: "no evidence receipt for this PR" };
  const { receipt, path } = latest;
  const base = { receipt: path, verifiedSha: receipt.verifiedSha, recordedAt: receipt.recordedAt };
  if (receipt.status === "waived") {
    // The owner's own words are the exception; they must appear verbatim in the PR so a reader can check them.
    return prBody.includes(/** @type {string} */ (receipt.ownerWaiver))
      ? { ...base, state: /** @type {EvidenceState} */ ("waived"), reason: `owner waived the run: «${receipt.ownerWaiver}»` }
      : { ...base, state: /** @type {EvidenceState} */ ("missing"), reason: "owner waiver is not quoted verbatim in the PR description" };
  }
  if (receipt.status === "failed") return { ...base, state: /** @type {EvidenceState} */ ("failed"), reason: receipt.problems.join("; ") };
  if (receipt.status === "incomplete") return { ...base, state: /** @type {EvidenceState} */ ("incomplete"), reason: receipt.problems.join("; ") };
  const uncovered = requiredPlatforms(prFiles).filter((platform) => !receipt.platforms?.includes(platform));
  if (uncovered.length) return { ...base, state: /** @type {EvidenceState} */ ("incomplete"), reason: `mobile files changed but the receipt does not cover ${uncovered.join(" and ")}: run the change there and record --platforms ${requiredPlatforms(prFiles).join(",")}` };
  const passing = /** @type {EvidenceState} */ (receipt.status === "nonvisual" ? "nonvisual" : "ok");
  if (receipt.verifiedSha === head) return { ...base, state: passing, reason: receipt.status === "nonvisual" ? `nonvisual: ${receipt.exception?.reason}` : "verified head is the current head" };
  if (!changedFiles) return { ...base, state: /** @type {EvidenceState} */ ("stale"), reason: "head changed after the receipt and the diff could not be listed completely" };
  const outside = changedFiles.filter((file) => !isNonFunctionalChange(file)).map((file) => file.filename);
  if (outside.length) return { ...base, state: /** @type {EvidenceState} */ ("stale"), reason: `head changed after the receipt in ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? ` and ${outside.length - 5} more` : ""}`, changedAfter: changedFiles.map((file) => file.filename) };
  return { ...base, state: passing, reason: `head changed after the receipt only in prose docs: ${changedFiles.map((file) => file.filename).join(", ")}`, changedAfter: changedFiles.map((file) => file.filename) };
}

/** States that let a develop merge proceed (review and authorization remain separate gates). */
export const ACCEPTED_EVIDENCE = new Set(["ok", "waived", "nonvisual", "nonfunctional"]);

/**
 * Records the merge pass the command guard reads for `gh pr merge --match-head-commit <head>`.
 * @param {{home: string, pr: string, head: string, base: string, mergeReady: boolean, codex: string, behavioralEvidence: string}} options
 */
export function writeMergeGate({ home, pr, head, base, mergeReady, codex, behavioralEvidence }) {
  const reference = parsePrReference(pr);
  const createdAt = new Date();
  const gate = { pr: reference.key, number: reference.number, head, base, mergeReady, codex, behavioralEvidence, createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + GATE_HOURS * 3_600_000).toISOString() };
  // Keyed by repository, PR and head: the guard matches the exact PR it is asked to merge.
  const file = resolve(mergeGateRoot(home), `${reference.owner}-${reference.repo}-${reference.number}-${head}.json`);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(gate, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
  return { path: file, ...gate };
}
