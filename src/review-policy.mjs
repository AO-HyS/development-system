// @ts-check
// The 2.13.0 review policy as pure rules (plan ds-friction-plan-20261111 v5, change A). No GitHub, no files: the
// ledger (`review-state.mjs`), the gate (`pr-review-status.mjs`) and the CLI all decide through these functions, so a
// PR into develop never ends in a question to the owner.
//   rounds       run without owner approval: round 1 full, later rounds fix-diff, after a blocking round or when
//                commits arrived that coverage does not explain. Two per branch lineage since 2.14.1 (five before):
//                in the council's measurements a third or later round doubled the time without closing more.
//   cap          round 2 blocking with nothing critical open: no round 3; the coordinator fixes, records each finding
//                and an `auto-advance` row, and merges. Stopping reviews is not acceptance: the row lists what nobody
//                re-read. Rows written under the caps of five and seven stay valid.
//   critical     security, authorization, data-loss, money, minors-privacy, consent, and any finding that does not say
//                `none`. A critical blocker gets up to two more rounds (3 and 4) that only re-read its fix. Still
//                blocking after round 4: the disputed change leaves the PR, or the PR stays unmerged.
//   chain        each fix-diff starts exactly at the previous round's head; a gap breaks the chain.
import { isNonFunctionalChange } from "./evidence.mjs";

/** Review rounds a branch lineage runs on its own, whichever reviewer runs them. */
export const BUDGET = 2;
/** Rounds 3 and 4 exist only to re-read the fix of a critical finding. */
export const CRITICAL_LIMIT = 4;
/** Last slot of the ordinary reading. Not BUDGET: a recorded round keeps its reading when caps move. */
const ORDINARY_READING_UNTIL = 5;
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

/** The reviewers a round row may name; Sol 6.1 High runs the rounds and Fable 5.2 the hard ones (2.14.0). */
export const REVIEWERS = ["sol", "fable"];
/** The prefix of a release reason that records Fable as unavailable (quota or not offered). */
export const FABLE_UNAVAILABLE = "fable-unavailable:";
/** How long a recorded Fable unavailability sends the rounds to Sol. */
export const FABLE_UNAVAILABLE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Why the next round of a lineage is hard, first match wins, or "" for a normal round (owner decision of 2026-11-12:
 * Fable reviews only security work and hard reviews). The gate computes it; nobody is asked.
 * @param {{critical?: boolean, rejected?: boolean, nextSlot: number}} input
 */
export function hardReason({ critical = false, rejected = false, nextSlot }) {
  if (critical) return "hallazgo crítico abierto";
  if (rejected) return "rechazo de un hilo crítico de Codex";
  return nextSlot >= 3 ? "dos rondas no cerraron la revisión" : "";
}

/**
 * Who runs the next round of a lineage: Sol, unless the round is `hard` (a short reason from hardReason); then Fable
 * with that reason, unless the newest release whose reason starts with `fable-unavailable:` is newer than the newest
 * Fable round row of the lineage and less than seven days old; then Sol again, `degraded`, with the recorded reason
 * (at most 160 characters). Pure: the caller passes the sidecar's releases, the lineage's round rows and the time.
 * @param {{releases: {reason: string, recordedAt: string}[], rounds: {reviewer: string, recordedAt: string}[], now: number, hard?: string}} input
 * @returns {{reviewer: "fable" | "sol", reason: string, degraded: boolean}}
 */
export function reviewerFor({ releases, rounds, now, hard = "" }) {
  if (!hard) return { reviewer: "sol", reason: "", degraded: false };
  const at = (/** @type {{recordedAt: string}} */ row) => Date.parse(row.recordedAt);
  const unavailable = releases.filter((release) => typeof release.reason === "string" && release.reason.startsWith(FABLE_UNAVAILABLE) && Number.isFinite(at(release)))
    .sort((a, b) => at(a) - at(b)).at(-1);
  const fable = { reviewer: /** @type {const} */ ("fable"), reason: hard, degraded: false };
  if (!unavailable) return fable;
  const lastFable = Math.max(-Infinity, ...rounds.filter((round) => round.reviewer === "fable" && Number.isFinite(at(round))).map(at));
  if (at(unavailable) <= lastFable || now - at(unavailable) >= FABLE_UNAVAILABLE_MS) return fable;
  return { reviewer: "sol", reason: unavailable.reason.replace(/\s+/g, " ").trim().slice(0, 160), degraded: true };
}

/** Critical unless the reviewer said `none`: when in doubt, critical. @param {Finding} finding */
export const isCritical = (finding) => finding.critical !== NOT_CRITICAL;

/**
 * Which findings keep a round blocking. Slot 1 keeps the result as given. Slots 2 to 5: a finding with origin `new`
 * that says `none` is a follow-up; prior, fix-induced, unknown origin, any critical domain and a finding that names
 * no domain block. Past slot 5 (rows of the 2.13.0 caps) everything marked `none` is a follow-up. A blocking result
 * that names no finding stays blocking; one whose findings are all follow-ups becomes non-blocking.
 * @param {Finding[]} findings @param {number} slot @param {"blocking" | "non-blocking" | "none"} result
 */
export function classifyFindings(findings, slot, result) {
  if (slot < 2) return { result, blockers: findings.map((finding) => finding.id), followUps: /** @type {string[]} */ ([]) };
  const followUp = slot > ORDINARY_READING_UNTIL
    ? (/** @type {Finding} */ finding) => !isCritical(finding)
    : (/** @type {Finding} */ finding) => finding.origin === "new" && !isCritical(finding);
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
 *   round     reserve and run the next review round (`scope`), inside the cap or as a critical re-read
 *   advance   the cap is reached and nothing open is critical: fix, record, merge without another round
 *   withdraw  four rounds and a critical finding is still open: take the disputed change out, or leave the PR out
 *   split     the cap is reached and unexplained commits arrived: they go to another PR
 *   hold      the lineage spent its rounds without one valid read: the PR stays out
 *   none      the last round is clean and nothing arrived after it
 * `pendingCritical` is a rejected critical Codex thread no review round has read yet; `moved` says commits arrived after
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
 * slot (2.9.0 rows still read) admits a round the policy would not run only inside the cap; it never opens a round
 * past the caps.
 * @param {{slot: number, scope: string, last?: {result: string, critical: boolean, head: string}, head: string, approved?: boolean, pendingCritical?: boolean}} input
 */
export function admission({ slot, scope, last, head, approved = false, pendingCritical = false }) {
  if (slot === 1) return scope === "full" ? "" : "the first review round of a lineage must be --scope full";
  if (approved && slot <= BUDGET) return "";
  const next = nextReview({ nextSlot: slot, last, moved: Boolean(last) && last?.head !== head, pendingCritical });
  if (next.action === "round") return "";
  const gate = "run development-system pr-review-status <pr> --gate and do what it says";
  if (next.action === "none") return `the last review round is clean and the head has not moved since: no other round runs; ${gate}`;
  if (next.action === "advance") return `the lineage reached its ${BUDGET} rounds and nothing open is critical: no round ${slot} runs; ${gate} (it advances without another round)`;
  if (next.action === "withdraw") return `the lineage reached ${CRITICAL_LIMIT} rounds with a critical finding still open: no round ${slot} runs; ${gate} (the disputed change leaves the PR)`;
  if (next.action === "split") return `the lineage reached its ${BUDGET} rounds: commits that are not a cited fix or a clean base merge go to another PR; ${gate}`;
  return `the lineage spent its rounds without a valid recorded round: the PR stays unmerged; ${gate}`;
}

/**
 * The head each recorded round started from, checked as one chain: a fix-diff must start (`from`) exactly at the
 * previous round's head. A full round rereads the whole candidate, so only the chain from the latest full round
 * counts and an older gap no longer leaves the PR uncovered. A row without `from` is a pre-2.13.0 row and is read as
 * chained. Returns "" or the first gap.
 * @param {{round: number, scope: string, head: string, from?: string}[]} rounds
 */
export function chainGap(rounds) {
  let start = 0;
  rounds.forEach((round, index) => { if (round.scope === "full") start = index; });
  for (let index = start + 1; index < rounds.length; index += 1) {
    const round = rounds[index];
    const previous = rounds[index - 1];
    if (round.scope === "fix-diff" && round.from && round.from !== previous.head) return `round ${round.round} read from ${round.from.slice(0, 12)}, not from the head of round ${previous.round} (${previous.head.slice(0, 12)})`;
  }
  return "";
}

/**
 * Why an `auto-advance` row does not let the PR advance, or "". Checked when the row is written and again every time
 * the gate reads it, against the ledger and the PR as they are then: a row that contradicts its own history has no
 * authority. `slot` is the real lineage slot of the row's round, `open` what that round left open, `dispositions` the
 * latest disposition of each of its findings, `roundHead` that round's head and `commits` the first-parent commits
 * after it up to `head` (newest first). The writer has not walked them and passes none; the gate always passes them
 * (an empty list when the PR head is the round's head), and then every fix must be among them. A `settled` commit
 * (2.14.3: it leaves no net change, or only takes files out of the PR) is nobody's fix and needs no disposition.
 * @param {{advance: AdvanceRecord, slot: number, open: {blockers: Finding[], critical: boolean}, dispositions: Map<string, {outcome: string, commit?: string}>, head: string, roundHead: string, commits?: {sha: string, baseMerge?: boolean, settled?: boolean}[]}} input
 */
export function advanceProblem({ advance, slot, open, dispositions, head, roundHead, commits: walked }) {
  const commits = walked ?? [];
  if (advance.slot !== slot) return `the advance says slot ${advance.slot}, but its round is slot ${slot}`;
  const wanted = advance.kind === "withdrawn" ? "withdraw" : "advance";
  const next = nextReview({ nextSlot: slot + 1, last: { result: "blocking", critical: open.critical } });
  if (next.action !== wanted) return `after slot ${slot} the policy says ${next.action}, not ${wanted}`;
  // Nothing identified means nothing whose fix or withdrawal can be checked.
  if (open.blockers.length === 0) return "the round names no finding, so there is no fix or withdrawn change to check";
  const ids = open.blockers.map((finding) => finding.id);
  if (ids.length !== advance.findings.length || ids.some((id) => !advance.findings.includes(id))) return `the advance lists ${advance.findings.join(", ") || "no finding"}, but the round left ${ids.join(", ")} open`;
  const missing = ids.filter((id) => !dispositions.has(id));
  if (missing.length) return `${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no disposition`;
  const kept = advance.kind === "withdrawn" ? ids.filter((id) => dispositions.get(id)?.outcome !== "follow-up") : [];
  if (kept.length) return `${kept.join(", ")} ${kept.length === 1 ? "is" : "are"} not recorded as follow-up, so the disputed change did not leave the PR`;
  if (advance.head !== head) {
    // Only clean merges of the base may arrive after the advance; anything else needs the advance recorded again.
    const at = advance.head === roundHead ? commits.length : commits.findIndex((commit) => commit.sha === advance.head);
    if (at < 0 || commits.slice(0, at).some((commit) => !commit.baseMerge)) return `the advance was recorded for head ${advance.head.slice(0, 12)}, and the PR is now at ${head.slice(0, 12)} with more than clean base merges in between: record it again for the current head`;
  }
  const unlisted = commits.filter((commit) => !commit.baseMerge && !commit.settled && !advance.fixCommits.includes(commit.sha)).map((commit) => commit.sha.slice(0, 12));
  if (unlisted.length) return `the advance does not list ${unlisted.join(", ")} among the commits nobody re-read: record each with its finding (development-system review dispose --finding <id> --commit <sha>: the fix, or for a follow-up the commit that took the change out), then the advance again`;
  if (walked) {
    // A finding recorded as fixed in a commit the PR no longer has is not fixed in what would be merged.
    const present = new Set(commits.map((commit) => commit.sha));
    const absent = ids.filter((id) => { const disposition = dispositions.get(id); return disposition?.outcome === "fixed" && !present.has(String(disposition.commit)); });
    if (absent.length) return `${absent.join(", ")} ${absent.length === 1 ? "is" : "are"} recorded as fixed in a commit that is not among the PR's commits after the round: record the disposition again with the commit that is, then the advance`;
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

/** The model a Fable round observed at runtime (a model id or `unknown`): printable, no spaces. */
export const OBSERVED_MODEL = /^[\x21-\x7e]{1,200}$/;

/**
 * 2.14.0: a Fable round is a Sol-shaped row with reviewer "fable" and an optional observedModel. Returns a problem,
 * or the row to validate with the Sol rules (the same object for a sol row, which never carries observedModel).
 * @param {Record<string, unknown>} record
 * @returns {{problem: string} | {row: Record<string, unknown>}}
 */
export function fableRound(record) {
  if ("observedModel" in record && record.reviewer !== "fable") return { problem: "round observedModel is only for a fable round" };
  if (record.reviewer !== "fable") return { row: record };
  if ("operatorApproval" in record) return { problem: "a fable round has no operator approval" };
  if ("observedModel" in record && (typeof record.observedModel !== "string" || !OBSERVED_MODEL.test(record.observedModel))) return { problem: "round observedModel is not a model id or unknown" };
  const { observedModel, ...rest } = record;
  return { row: { ...rest, reviewer: "sol" } };
}
