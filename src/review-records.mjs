// @ts-check
// Review rounds (Sol 6.1 High, Fable 5.2 for security work and hard rounds; 2.14.0), exemptions and
// coverage verdicts for one PR, appended as JSONL under
// <home>/.development-system/private/reviews/<owner>/<repo>/<number>.jsonl. The coordinator writes them
// (`review record`, `review coverage`); `pr-review-status` reads them for `mergeReady`. This module is the facade the
// CLI and the gate import; the shared state (validation, voids, the lineage brake) lives in `review-state.mjs`.
// Budget: Sol rounds count per branch lineage (see review-state.mjs) and run without anyone's approval up to the cap
// in review-policy.mjs (2.13.0). A round is recorded only against the oldest unrecorded reservation of its PR
// (`review reserve`, which the Claude hook and the Codex wrapper call before a launch), at a SHA GitHub lists for the
// PR, with a reopenable thread reference; from slot 2 the findings' origin decides whether a result blocks, and a
// fix-diff always starts at the head of the previous round. An exemption binds one head and replaces any earlier exemption; rounds and
// exemptions never mix. Every read validates each record and the whole sequence, and every write checks and appends
// under an exclusive lock, so a hand-edited or racing file can never pass as approval. A record states what a reviewer
// or the coordinator concluded; it never authorizes a merge by itself.
import {
  COVERAGE_ID, EXEMPTIONS, OBSERVED_MODEL, RESULTS, REVIEWERS, SCOPES, SHA, THREAD, VERDICTS,
  append, classifyFindings, lineageState, lineageSummary, list, locate, parseFinding, readReviewRecords, recordProblem, resolveLineage, sequenceProblem, slotOf, text, verifyHead, withFileLock,
} from "./review-state.mjs";
import { admission } from "./review-policy.mjs";

export { approveReview, classifyFindings, ledgerLines, parseFinding, readReviewRecords, releaseReservation, reserveReview, voidReviewLine, withFileLock } from "./review-state.mjs";

/**
 * @typedef {import("./review-state.mjs").Finding} Finding
 * @typedef {import("./review-state.mjs").RoundRecord} RoundRecord
 * @typedef {import("./review-state.mjs").ExemptionRecord} ExemptionRecord
 * @typedef {import("./review-state.mjs").CoverageRecord} CoverageRecord
 * @typedef {import("./review-state.mjs").WaiverRecord} WaiverRecord
 * @typedef {import("./review-state.mjs").ReviewRecord} ReviewRecord
 */

/**
 * The gate's view of the PR's branch lineage (PRs, slots used of the budget, unused approvals, pending reservations,
 * last recorded round). Throws when GitHub or a lineage ledger cannot be read completely.
 * @param {{home: string, pr: string, pull?: any}} options
 */
export function readLineage({ home, pr, pull }) {
  return lineageSummary(lineageState(home, resolveLineage({ pr, home, pull })));
}

/** The lock that serializes `pr-review-status --request` for one PR. @param {string} home @param {string} pr */
export function requestLockPath(home, pr) {
  return locate(home, pr).file.replace(/\.jsonl$/, ".request.lock");
}

export const OPERATOR_APPROVAL_MOVED = "--operator-approval is gone: since 2.13.0 no Sol round needs the owner's approval; reserve the slot with development-system review reserve, then record the round";

/** Appends `record` only if it and the whole sequence read under the lock stay valid. @param {string} home @param {string} key @param {string} file @param {ReviewRecord} record */
function appendChecked(home, key, file, record) {
  const problem = recordProblem(record, key) || sequenceProblem([...readReviewRecords(home, key), record]);
  if (problem) throw new Error(`refusing to record: ${key} ${problem}`);
  append(file, record);
}

/**
 * Records one review round (Fable or Sol) against its reservation, or an exemption (Sol only) instead of any round.
 * Both reviewers share the lineage slots: a round binds its reservation by slot whoever ran it. `dryRun` runs the same
 * validation (GitHub reads included) and writes nothing: no record, no lock, no directory.
 * @param {{home: string, pr?: string, reviewer?: string, observedModel?: string, head?: string, scope?: string, result?: string, thread?: string, findings?: string[] | string, exempt?: string, reason?: string, operatorApproval?: string, from?: string, dryRun?: boolean}} options
 */
export function recordReview({ home, pr, reviewer, observedModel, head, scope, result, thread, findings, exempt, reason, operatorApproval, from, dryRun = false }) {
  if (operatorApproval !== undefined) throw new Error(OPERATOR_APPROVAL_MOVED);
  const { key, file } = locate(home, pr);
  if (reviewer !== "sol" && reviewer !== "fable") throw new Error(`review record needs --reviewer ${REVIEWERS.join(" or --reviewer ")}`);
  if (observedModel !== undefined && reviewer !== "fable") throw new Error("--observed-model applies only to --reviewer fable");
  if (observedModel !== undefined && !OBSERVED_MODEL.test(observedModel)) throw new Error("--observed-model must be the model id the reviewer reported, or unknown");
  if (!head || !SHA.test(head)) throw new Error("review record needs --head <40-hex SHA the reviewer read>");
  if (exempt !== undefined) {
    if (reviewer !== "sol") throw new Error("an exemption is recorded with --reviewer sol");
    if (!EXEMPTIONS.includes(exempt)) throw new Error("--exempt must be docs-only or low-risk");
    if (!text(reason)) throw new Error("--exempt needs --reason");
    if (from !== undefined) throw new Error("--from applies only to a fix-diff round");
  } else {
    if (!scope || !SCOPES.includes(scope)) throw new Error("--scope must be full or fix-diff");
    if (!result || !RESULTS.includes(result)) throw new Error("--result must be blocking, non-blocking or none");
    if (!text(thread)) throw new Error("review record needs --thread <reviewer thread reference>");
    if (!THREAD.test(/** @type {string} */ (text(thread)))) throw new Error("--thread must be a reopenable reference: t3-thread://..., thread:<id>, a thread UUID, codex:<id>, claude:<id> or an https URL");
    if (from !== undefined && (!SHA.test(from) || scope !== "fix-diff")) throw new Error("--from must be the 40-hex head the fix diff starts from, on a --scope fix-diff round");
  }
  const parsed = list(findings).map(parseFinding);
  const ids = parsed.map((finding) => finding.id);
  if (new Set(ids).size !== ids.length) throw new Error("finding ids must be unique");
  const lineage = resolveLineage({ pr: key, home });
  verifyHead(lineage, head);
  const recordedAt = new Date().toISOString();
  if (exempt !== undefined) {
    const work = () => {
      const existing = readReviewRecords(home, key);
      const rounds = existing.filter((record) => record.type === "round");
      if (rounds.length) throw new Error(`${key} already has ${rounds.length} review round(s); an exemption only replaces a round that never ran`);
      // An exemption binds its own head and replaces any earlier exemption.
      /** @type {ExemptionRecord} */
      const record = { type: "exemption", pr: key, reviewer: "sol", head, exempt: /** @type {ExemptionRecord["exempt"]} */ (exempt), reason: /** @type {string} */ (text(reason)), recordedAt };
      if (dryRun) {
        const problem = recordProblem(record, key) || sequenceProblem([...existing, record]);
        if (problem) throw new Error(`refusing to record: ${key} ${problem}`);
      } else appendChecked(home, key, file, record);
      return { ok: true, operation: "review-record", path: file, record, ...(dryRun ? { dryRun: true } : {}) };
    };
    return dryRun ? work() : withFileLock(`${file}.lock`, work);
  }
  // Lineage lock first, then the PR lock (the order every writer uses), re-reading inside both.
  const work = () => {
    const existing = readReviewRecords(home, key);
    if (existing.some((record) => record.type === "exemption")) throw new Error(`${key} has a review exemption; rounds and exemptions do not mix (record a new exemption for this head, or void it with development-system review void if the PR is no longer docs-only or low-risk)`);
    const state = lineageState(home, lineage);
    const reservation = state.pending.find((candidate) => candidate.pr === key);
    if (!reservation) throw new Error(`${key} has no unrecorded review reservation: reserve the round before launching it (development-system review reserve --pr ${key} --scope ${scope} --request-key <key>; a T3 dispatch with "Review kind: pr" reserves it), then record it`);
    if (reservation.scope !== scope) throw new Error(`the reservation for slot ${reservation.slot} (${reservation.id}) is --scope ${reservation.scope}, not ${scope}`);
    // The policy is asked again for the head that was read: a reservation carries no authority of its own.
    const before = state.lastRound;
    const refusal = admission({ slot: reservation.slot, scope, last: before && { result: before.record.result, critical: before.critical, head: before.record.head }, head, approved: Boolean(reservation.approvalId), pendingCritical: Boolean(reservation.criticalThread) });
    if (refusal) throw new Error(`reservation ${reservation.id} (slot ${reservation.slot}) is not a round the policy runs: ${refusal}. Release it with development-system review release --pr ${key} --reservation-id ${reservation.id} --reason <why>`);
    const rounds = /** @type {RoundRecord[]} */ (existing.filter((record) => record.type === "round"));
    const round = rounds.length + 1;
    // A fix-diff starts exactly at the head of the previous round, so the rounds chain without a gap.
    const previous = state.lastRound?.record.head;
    if (scope === "fix-diff" && previous && from !== undefined && from !== previous) throw new Error(`a fix-diff starts exactly at the head of the previous round (${previous}); --from ${from} would leave commits nobody read`);
    const start = scope === "fix-diff" ? from ?? previous : undefined;
    const classified = classifyFindings(parsed, reservation.slot, /** @type {RoundRecord["result"]} */ (result));
    /** @type {RoundRecord} */
    const record = {
      type: "round", pr: key, reviewer: /** @type {RoundRecord["reviewer"]} */ (reviewer), round, head, scope: /** @type {RoundRecord["scope"]} */ (scope), result: classified.result, thread: /** @type {string} */ (text(thread)), findings: parsed, recordedAt,
      ...(reservation.slot !== round ? { slot: reservation.slot } : {}), ...(start ? { from: start } : {}), ...(reservation.approvalId ? { approvalId: reservation.approvalId } : {}),
      ...(reviewer === "fable" && observedModel !== undefined ? { observedModel } : {}),
    };
    if (slotOf(record) !== reservation.slot) throw new Error(`refusing to record: slot ${slotOf(record)} does not match reservation slot ${reservation.slot}`);
    if (dryRun) {
      const problem = recordProblem(record, key) || sequenceProblem([...existing, record]);
      if (problem) throw new Error(`refusing to record: ${key} ${problem}`);
    } else appendChecked(home, key, file, record);
    return {
      ok: true, operation: "review-record", path: file, record, slot: reservation.slot, reservation: reservation.id,
      ...(classified.result !== result ? { requestedResult: result } : {}), ...(classified.followUps.length ? { followUps: classified.followUps } : {}), ...(dryRun ? { dryRun: true } : {}),
    };
  };
  return dryRun ? work() : withFileLock(`${lineage.file}.lock`, () => withFileLock(`${file}.lock`, work));
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

/**
 * Records the owner's words stopping reviews for one head ("ya no quiero más revisiones"). The gate counts it as Sol
 * and Codex review for that head only while the same words appear verbatim in the PR description; any later commit
 * needs a new waiver. It never resolves open review threads.
 * @param {{home: string, pr?: string, head?: string, quote?: string}} options
 */
export function waiveReview({ home, pr, head, quote }) {
  const { key, file } = locate(home, pr);
  if (!head || !SHA.test(head)) throw new Error("review waive needs --head <40-hex PR head>");
  if (!text(quote)) throw new Error("review waive needs --quote \"<owner's words, as said>\"");
  verifyHead(resolveLineage({ pr: key, home }), head);
  return withFileLock(`${file}.lock`, () => {
    /** @type {WaiverRecord} */
    const record = { type: "waiver", pr: key, head, quote: /** @type {string} */ (text(quote)), recordedAt: new Date().toISOString() };
    appendChecked(home, key, file, record);
    return { ok: true, operation: "review-waive", path: file, record };
  });
}

/** @param {string} sha */
const short = (sha) => sha.slice(0, 12);

/** @param {{record: ReviewRecord, path: string, dryRun?: boolean, slot?: number, followUps?: string[], requestedResult?: string}} result */
export function formatReviewRecord(result) {
  const record = result.record;
  const prefix = result.dryRun ? "Dry run (nothing written): " : "";
  if (record.type === "disposition") return `${prefix}${record.pr}: round ${record.round} finding ${record.finding} ${record.outcome}${record.commit ? ` in ${short(record.commit)}` : ""}${record.note ? `: ${record.note}` : ""}.\nRecord: ${result.path}`;
  if (record.type === "auto-advance") return `${prefix}${record.pr}: advances without another round after round ${record.round} (slot ${record.slot}, ${record.kind}) at head ${short(record.head)}; nobody re-read ${record.fixCommits.length ? record.fixCommits.map(short).join(", ") : "any commit"} for ${record.findings.join(", ") || "no findings"}.\nRecord: ${result.path}`;
  if (record.type === "waiver") return `${record.pr}: owner stopped reviews at head ${short(record.head)}: «${record.quote}».\nRecord: ${result.path}`;
  if (record.type === "exemption") return `${prefix}${record.pr}: Sol exempt (${record.exempt}) at head ${short(record.head)}: ${record.reason}.\nRecord: ${result.path}`;
  if (record.type === "round") {
    const findings = record.findings.map((finding) => `- ${finding.id}: ${finding.paths.join(", ")}${finding.origin ? ` (${finding.origin}${finding.critical ? `/${finding.critical}` : ""})` : ""}`);
    const lines = [`${prefix}${record.pr}: ${record.reviewer === "fable" ? "Fable" : "Sol"} round ${record.round}${result.slot !== undefined ? ` (lineage slot ${result.slot})` : ""} (${record.scope}, ${record.result}${record.observedModel ? `, model ${record.observedModel}` : ""}) at head ${short(record.head)}, thread ${record.thread}, ${record.findings.length} finding(s).`, ...findings];
    if (result.requestedResult) lines.push(`Result ${result.requestedResult} becomes ${record.result} from the findings' origin.`);
    if (result.followUps?.length) lines.push(`Follow-ups (new, non-critical; not blocking): ${result.followUps.join(", ")}.`);
    lines.push(`Record: ${result.path}`);
    return lines.join("\n");
  }
  return `${prefix}${record.pr}: coverage ${short(record.from)}..${short(record.to)} ${record.verdict}${record.findings.length ? ` for ${record.findings.join(", ")}` : ""}: ${record.note}.\nRecord: ${result.path}`;
}

/** Human output for review reserve, approve, void and release. @param {any} result */
export function formatReviewState(result) {
  const prefix = result.dryRun ? "Dry run (nothing written): " : "";
  const lineage = result.lineage ? `Lineage ${result.lineage.id}: PRs ${result.lineage.prs.map((/** @type {number} */ n) => `#${n}`).join(", ")}; review slots used ${result.lineage.slotsUsed}/${result.lineage.budget}.` : "";
  if (result.operation === "review-reserve") {
    const r = result.reservation;
    return [`${prefix}${result.reused ? "Reused" : "Reserved"} lineage slot ${r.slot} (${r.scope}) for ${r.pr}: reservation ${r.id}${r.approvalId ? `, approval ${r.approvalId}` : ""}${r.redesign ? `, redesign ${r.redesign}` : ""}.`, lineage, `Record: ${result.path}`].filter(Boolean).join("\n");
  }
  if (result.operation === "review-approve") {
    const a = result.approval;
    return [`${prefix}Owner approval ${a.id} for lineage slot ${a.slot} (${a.scope}) recorded from ${a.pr}: "${a.quote}".`, lineage, `Record: ${result.path}`].filter(Boolean).join("\n");
  }
  if (result.operation === "review-release") return [`Released reservation ${result.reservation.id} (slot ${result.reservation.slot}, ${result.reservation.pr}): ${result.release.reason}.`, lineage, `Record: ${result.path}`].filter(Boolean).join("\n");
  if (result.operation === "review-lines") return result.lines.map((/** @type {{lineHash: string, line: string}} */ entry) => `${entry.lineHash}  ${entry.line}`).join("\n") || "No ledger lines.";
  if (result.operation === "review-void") return [`Voided line ${result.record.lineHash} of ${result.record.pr}: ${result.record.reason}. A void restores no budget.`, result.remainingProblem ? `The remaining ledger is still invalid: ${result.remainingProblem}` : "", `Record: ${result.path}`].filter(Boolean).join("\n");
  return JSON.stringify(result);
}
