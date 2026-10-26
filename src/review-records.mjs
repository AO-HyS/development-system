// @ts-check
// Sol review rounds, exemptions and coverage verdicts for one PR, appended as JSONL under
// <home>/.development-system/private/reviews/<owner>/<repo>/<number>.jsonl. The coordinator writes them
// (`review record`, `review coverage`); `pr-review-status` reads them for `mergeReady`. Budget: the first Sol
// round is `full`; a second, `fix-diff`, only after a blocking first round; a third is refused. A record states
// what a reviewer or the coordinator concluded; it never authorizes a merge by itself.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parsePrReference } from "./evidence.mjs";

const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const FINDING_ID = /^[A-Za-z0-9_.-]+$/;
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

/**
 * Every record for one PR, oldest first. Fails closed: a malformed line or a record for another PR throws, so a
 * damaged file can never hide a blocking round.
 * @param {string} home @param {string} pr @returns {ReviewRecord[]}
 */
export function readReviewRecords(home, pr) {
  const { key, file } = locate(home, pr);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    /** @type {any} */
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`${file}:${index + 1} is not valid JSON`); }
    if (record?.pr !== key || !["round", "exemption", "coverage"].includes(record?.type)) throw new Error(`${file}:${index + 1} is not a review record for ${key}`);
    return /** @type {ReviewRecord} */ (record);
  });
}

/**
 * Records one Sol round, or an exemption instead of any round.
 * @param {{home: string, pr?: string, reviewer?: string, head?: string, scope?: string, result?: string, thread?: string, findings?: string[] | string, exempt?: string, reason?: string}} options
 */
export function recordReview({ home, pr, reviewer, head, scope, result, thread, findings, exempt, reason }) {
  const { key, file } = locate(home, pr);
  if (reviewer !== "sol") throw new Error("review record supports only --reviewer sol");
  if (!head || !SHA.test(head)) throw new Error("review record needs --head <40-hex SHA the reviewer read>");
  const existing = readReviewRecords(home, key);
  const rounds = /** @type {RoundRecord[]} */ (existing.filter((record) => record.type === "round"));
  if (existing.some((record) => record.type === "exemption")) throw new Error(`${key} already has a Sol exemption; it replaces every round`);
  const recordedAt = new Date().toISOString();
  if (exempt !== undefined) {
    if (!EXEMPTIONS.includes(exempt)) throw new Error("--exempt must be docs-only or low-risk");
    if (!text(reason)) throw new Error("--exempt needs --reason");
    if (rounds.length) throw new Error(`${key} already has ${rounds.length} Sol round(s); an exemption only replaces a round that never ran`);
    /** @type {ExemptionRecord} */
    const record = { type: "exemption", pr: key, reviewer: "sol", head, exempt: /** @type {ExemptionRecord["exempt"]} */ (exempt), reason: /** @type {string} */ (text(reason)), recordedAt };
    append(file, record);
    return { ok: true, operation: "review-record", path: file, record };
  }
  if (!scope || !SCOPES.includes(scope)) throw new Error("--scope must be full or fix-diff");
  if (!result || !RESULTS.includes(result)) throw new Error("--result must be blocking, non-blocking or none");
  if (!text(thread)) throw new Error("review record needs --thread <reviewer thread reference>");
  // Operator budget: one full round; a fix-diff second round only after a blocking first; never a third.
  if (rounds.length >= 2) throw new Error(`${key} already has two Sol rounds; a third needs the operator`);
  if (rounds.length === 0 && scope !== "full") throw new Error("the first Sol round must be --scope full");
  if (rounds.length === 1 && rounds[0].result !== "blocking") throw new Error(`a second Sol round needs a blocking first round (first was ${rounds[0].result})`);
  if (rounds.length === 1 && scope !== "fix-diff") throw new Error("the second Sol round must be --scope fix-diff");
  const parsed = list(findings).map(parseFinding);
  const ids = parsed.map((finding) => finding.id);
  if (new Set(ids).size !== ids.length) throw new Error("finding ids must be unique");
  /** @type {RoundRecord} */
  const record = { type: "round", pr: key, reviewer: "sol", round: rounds.length + 1, head, scope: /** @type {RoundRecord["scope"]} */ (scope), result: /** @type {RoundRecord["result"]} */ (result), thread: /** @type {string} */ (text(thread)), findings: parsed, recordedAt };
  append(file, record);
  return { ok: true, operation: "review-record", path: file, record };
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
  /** @type {CoverageRecord} */
  const record = { type: "coverage", pr: key, from, to, findings: ids, verdict: /** @type {CoverageRecord["verdict"]} */ (verdict), note: /** @type {string} */ (text(note)), recordedAt: new Date().toISOString() };
  append(file, record);
  return { ok: true, operation: "review-coverage", path: file, record };
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
