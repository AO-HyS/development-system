// @ts-check
// The 2.13.0 review policy as pure rules (plan ds-friction-plan-20261111 v5, change A). No GitHub, no files: the
// ledger (`review-state.mjs`), the gate (`pr-review-status.mjs`) and the CLI all decide through these functions, so a
// PR into develop never ends in a question to the owner.
//   rounds       run without owner approval: round 1 full, later rounds fix-diff, after a blocking round or when
//                commits arrived that coverage does not explain. Five per branch lineage.
//   cap          round 5 blocking with nothing critical open: no round 6; the coordinator fixes, records each finding
//                and an `auto-advance` row, and merges. Stopping reviews is not acceptance: the row lists what nobody
//                re-read.
//   critical     security, authorization, data-loss, money, minors-privacy, consent, and any finding that does not say
//                `none`. A critical blocker gets up to two more rounds (6 and 7) that only re-read its fix. Still
//                blocking after round 7: the disputed change leaves the PR, or the PR stays unmerged.
//   chain        each fix-diff starts exactly at the previous round's head; a gap breaks the chain.
import { isNonFunctionalChange } from "./evidence.mjs";

/** Sol rounds a branch lineage runs on its own. */
export const BUDGET = 5;
/** Rounds 6 and 7 exist only to re-read the fix of a critical finding. */
export const CRITICAL_LIMIT = 7;
export const CRITICAL = ["security", "authorization", "data-loss", "money", "minors-privacy", "consent"];
/** The explicit "not a critical domain" mark; a finding without the field counts as critical at the cap. */
export const NOT_CRITICAL = "none";
export const OUTCOMES = ["fixed", "rejected", "follow-up"];
export const ADVANCE_KINDS = ["cap", "withdrawn"];
const SHA = /^[0-9a-f]{40}$/;

/**
 * @typedef {{id: string, paths: string[], origin?: "prior" | "fix-induced" | "new", critical?: string}} Finding
 * @typedef {{type: "disposition", pr: string, round: number, finding: string, outcome: "fixed" | "rejected" | "follow-up", commit?: string, note?: string, recordedAt: string}} DispositionRecord
 * @typedef {{type: "auto-advance", pr: string, round: number, slot: number, kind: "cap" | "withdrawn", head: string, findings: string[], fixCommits: string[], recordedAt: string}} AdvanceRecord
 * @typedef {"round" | "advance" | "withdraw" | "split" | "hold" | "none"} NextAction
 */

/** Critical unless the reviewer said `none`: when in doubt, critical. @param {Finding} finding */
export const isCritical = (finding) => finding.critical !== NOT_CRITICAL;

/**
 * Which findings keep a round blocking. Slot 1 keeps the result as given. Slots 2 to 5: a finding with origin `new`
 * outside a critical domain is a follow-up; prior, fix-induced, unknown origin and any critical domain block. Slots 6
 * and 7 re-read a critical fix only: everything marked `none` is a follow-up. A blocking result that names no finding
 * stays blocking; a blocking result whose findings are all follow-ups becomes non-blocking.
 * @param {Finding[]} findings @param {number} slot @param {"blocking" | "non-blocking" | "none"} result
 */
export function classifyFindings(findings, slot, result) {
  if (slot < 2) return { result, blockers: findings.map((finding) => finding.id), followUps: /** @type {string[]} */ ([]) };
  const followUp = slot > BUDGET
    ? (/** @type {Finding} */ finding) => !isCritical(finding)
    : (/** @type {Finding} */ finding) => finding.origin === "new" && !CRITICAL.includes(finding.critical ?? "");
  const blockers = findings.filter((finding) => !followUp(finding)).map((finding) => finding.id);
  const followUps = findings.filter(followUp).map((finding) => finding.id);
  let effective = result;
  if (blockers.length) effective = "blocking";
  else if (result === "blocking" && followUps.length) effective = "non-blocking";
  return { result: effective, blockers, followUps };
}

/**
 * The findings a blocking round leaves open, and whether any of them is critical. A blocking round that names no
 * finding counts as critical: it errs toward another read.
 * @param {{result: string, findings: Finding[]}} round @param {number} slot
 */
export function openFindings(round, slot) {
  if (round.result !== "blocking") return { blockers: /** @type {Finding[]} */ ([]), critical: false };
  const ids = new Set(classifyFindings(round.findings, slot, "blocking").blockers);
  const blockers = round.findings.filter((finding) => ids.has(finding.id));
  return { blockers, critical: blockers.length === 0 || blockers.some(isCritical) };
}

/**
 * What the lineage does next, decided without anyone's permission.
 *   round     reserve and run the next Sol round (`scope`), inside the cap or as a critical re-read
 *   advance   the cap is reached and nothing open is critical: fix, record, merge without another round
 *   withdraw  seven rounds and a critical finding is still open: take the disputed change out, or leave the PR out
 *   split     the cap is reached and unexplained commits arrived: they go to another PR
 *   hold      the lineage spent its rounds without one valid read: the PR stays out
 *   none      the last round is clean and nothing arrived after it
 * `pendingCritical` is a rejected critical Codex thread no Sol round has read yet; `moved` says commits arrived after
 * the last round that coverage does not explain.
 * @param {{nextSlot: number, last?: {result: string, critical: boolean}, moved?: boolean, pendingCritical?: boolean}} input
 * @returns {{action: NextAction, scope?: "full" | "fix-diff", critical?: boolean}}
 */
export function nextReview({ nextSlot, last, moved = false, pendingCritical = false }) {
  if (nextSlot === 1) return { action: "round", scope: "full" };
  if (!last) return nextSlot <= BUDGET ? { action: "round", scope: "full" } : { action: "hold" };
  const critical = pendingCritical || (last.result === "blocking" && last.critical);
  if (last.result === "blocking" || pendingCritical) {
    if (nextSlot <= BUDGET) return { action: "round", scope: "fix-diff" };
    if (!critical) return { action: "advance" };
    return nextSlot <= CRITICAL_LIMIT ? { action: "round", scope: "fix-diff", critical: true } : { action: "withdraw" };
  }
  if (!moved) return { action: "none" };
  return nextSlot <= BUDGET ? { action: "round", scope: "fix-diff" } : { action: "split" };
}

/**
 * Why a reservation for `slot` is refused, or "" when the policy admits it. An unused owner approval recorded for the
 * slot (2.9.0 rows still work) admits any round.
 * @param {{slot: number, scope: string, last?: {result: string, critical: boolean, head: string}, head: string, approved?: boolean, pendingCritical?: boolean}} input
 */
export function admission({ slot, scope, last, head, approved = false, pendingCritical = false }) {
  if (slot === 1) return scope === "full" ? "" : "the first Sol round of a lineage must be --scope full";
  if (approved) return "";
  const next = nextReview({ nextSlot: slot, last, moved: Boolean(last) && last?.head !== head, pendingCritical });
  if (next.action === "round") return "";
  const gate = "run development-system pr-review-status <pr> --gate and do what it says";
  if (next.action === "none") return `the last Sol round is clean and the head has not moved since: no other round runs; ${gate}`;
  if (next.action === "advance") return `the lineage reached its ${BUDGET} rounds and nothing open is critical: no round ${slot} runs; ${gate} (it advances without another round)`;
  if (next.action === "withdraw") return `the lineage reached ${CRITICAL_LIMIT} rounds with a critical finding still open: no round ${slot} runs; ${gate} (the disputed change leaves the PR)`;
  if (next.action === "split") return `the lineage reached its ${BUDGET} rounds: commits that are not a cited fix or a clean base merge go to another PR; ${gate}`;
  return `the lineage spent its rounds without a valid recorded round: the PR stays unmerged; ${gate}`;
}

/**
 * The head each recorded round started from, checked as one chain: a full round restarts it, a fix-diff must start
 * (`from`) exactly at the previous round's head. A row without `from` is a pre-2.13.0 row and is read as chained.
 * Returns "" or the first gap.
 * @param {{round: number, scope: string, head: string, from?: string}[]} rounds
 */
export function chainGap(rounds) {
  for (let index = 1; index < rounds.length; index += 1) {
    const round = rounds[index];
    const previous = rounds[index - 1];
    if (round.scope === "fix-diff" && round.from && round.from !== previous.head) return `round ${round.round} read from ${round.from.slice(0, 12)}, not from the head of round ${previous.round} (${previous.head.slice(0, 12)})`;
  }
  return "";
}

/** After the last round only prose documentation stays covered. @param {{filename: string, status: string, previous_filename?: string}[] | null} files */
export const onlyProse = (files) => Boolean(files?.length) && /** @type {any[]} */ (files).every(isNonFunctionalChange);

/** @param {unknown} value */
const words = (value) => typeof value === "string" && value.trim() !== "";
/** @param {any} value @param {string[]} required @param {string[]} optional */
const shaped = (value, required, optional) => required.every((key) => key in value) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

/**
 * Schema problem of a 2.13.0 ledger row (disposition, auto-advance), "" when complete, undefined for other types.
 * @param {any} record @returns {string | undefined}
 */
export function policyRecordProblem(record) {
  if (record?.type === "disposition") {
    if (!shaped(record, ["type", "pr", "round", "finding", "outcome", "recordedAt"], ["commit", "note"])) return "disposition has missing or unknown fields";
    if (!Number.isInteger(record.round) || record.round < 1 || !words(record.finding)) return "disposition names no round or finding";
    if (!OUTCOMES.includes(record.outcome)) return `disposition outcome is not ${OUTCOMES.join(", ")}`;
    if (record.outcome === "fixed" ? !(typeof record.commit === "string" && SHA.test(record.commit)) : !words(record.note)) return "a fixed disposition needs its 40-hex commit; a rejected or follow-up one needs a note";
    if (("commit" in record && !SHA.test(String(record.commit))) || ("note" in record && !words(record.note))) return "disposition commit or note is empty";
    return "";
  }
  if (record?.type === "auto-advance") {
    if (!shaped(record, ["type", "pr", "round", "slot", "kind", "head", "findings", "fixCommits", "recordedAt"], [])) return "auto-advance has missing or unknown fields";
    if (!ADVANCE_KINDS.includes(record.kind)) return `auto-advance kind is not ${ADVANCE_KINDS.join(" or ")}`;
    if (!Number.isInteger(record.round) || record.round < 1 || !Number.isInteger(record.slot)) return "auto-advance names no round or slot";
    if (record.slot < (record.kind === "cap" ? BUDGET : CRITICAL_LIMIT)) return "auto-advance is below the round cap";
    if (typeof record.head !== "string" || !SHA.test(record.head)) return "auto-advance head is not a 40-hex SHA";
    if (!Array.isArray(record.findings) || !record.findings.every(words)) return "auto-advance findings are not ids";
    if (!Array.isArray(record.fixCommits) || !record.fixCommits.every((/** @type {unknown} */ sha) => typeof sha === "string" && SHA.test(sha))) return "auto-advance fixCommits are not 40-hex SHAs";
    return "";
  }
  return undefined;
}
