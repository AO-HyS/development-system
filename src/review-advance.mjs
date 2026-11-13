// @ts-check
// What happens to each review finding and the advance at the round cap (2.13.0, plan A2, A3 and A8).
//   review dispose   one row per finding of a round: fixed (with its commit), rejected (with the reason) or follow-up
//                    (with where it went). The ledger can then say how much of what a review finds ends in a change.
//   review advance   the `auto-advance` row: the last round of the cap (2 since 2.14.1) came back blocking with nothing
//                    critical open, so no further round runs; or (`--withdrawn`) the last critical re-read (round 4)
//                    still has a critical finding open and the disputed change left
//                    the PR. It lists the fix commits nobody re-read. Only for a PR into develop or stacked on open
//                    PRs that end in develop (2.14.3, review-stack.mjs); the gate
//                    (`pr-review-status`) still checks every commit after the round and, when withdrawn, that the PR
//                    no longer touches the finding's files.
import { advanceProblem, nextReview, openFindings, OUTCOMES } from "./review-policy.mjs";
import { SHA, append, lineageState, locate, readReviewRecords, recordProblem, resolveLineage, sequenceProblem, text, verifyHead, withFileLock } from "./review-state.mjs";
import { towardDevelop } from "./review-stack.mjs";

/**
 * @typedef {import("./review-state.mjs").RoundRecord} RoundRecord
 * @typedef {import("./review-policy.mjs").DispositionRecord} DispositionRecord
 * @typedef {import("./review-policy.mjs").AdvanceRecord} AdvanceRecord
 */

/** @param {string} home @param {string} key @param {string} file @param {import("./review-state.mjs").ReviewRecord} record */
function appendChecked(home, key, file, record) {
  const problem = recordProblem(record, key) || sequenceProblem([...readReviewRecords(home, key), record]);
  if (problem) throw new Error(`refusing to record: ${key} ${problem}`);
  append(file, record);
}

/** The latest disposition of each finding of one round. @param {import("./review-state.mjs").ReviewRecord[]} records @param {number} round */
export function dispositionsOf(records, round) {
  /** @type {Map<string, DispositionRecord>} */
  const latest = new Map();
  for (const record of records) if (record.type === "disposition" && record.round === round) latest.set(record.finding, record);
  return latest;
}

/**
 * Every commit a disposition recorded after one round names (the fix, or for a follow-up the commit that took the
 * change out), the replaced rows included: a finding may take several commits. Since 2.14.3 it reads the findings of
 * that round and of the rounds before it, not only what the round left open: coverage accepts a fix of any recorded
 * round, so the advance must be able to list that commit under the finding it really fixes (`review dispose --round
 * <n>`). Rows written before the round are left out: the round read their commits.
 * @param {import("./review-state.mjs").ReviewRecord[]} records @param {number} round
 */
export function dispositionCommits(records, round) {
  const at = records.map((record) => record.type === "round" && record.round === round).lastIndexOf(true);
  return [...new Set(records.slice(at + 1).flatMap((record) => record.type === "disposition" && record.round <= round && record.commit ? [record.commit] : []))];
}

/**
 * Records what happened to one finding of a review round (the last round unless `round` names another).
 * @param {{home: string, pr?: string, finding?: string, outcome?: string, commit?: string, note?: string, round?: string | number}} options
 */
export function recordDisposition({ home, pr, finding, outcome, commit, note, round }) {
  const { key, file } = locate(home, pr);
  if (!text(finding)) throw new Error("review dispose needs --finding <id>");
  if (!outcome || !OUTCOMES.includes(outcome)) throw new Error(`--outcome must be ${OUTCOMES.join(", ")}`);
  if (outcome === "fixed" ? !(commit && SHA.test(commit)) : !text(note)) throw new Error("--outcome fixed needs --commit <40-hex fix commit>; rejected and follow-up need --note <reason, or where the follow-up lives> (a follow-up whose change left the PR also names that commit with --commit)");
  if (commit !== undefined && !SHA.test(commit)) throw new Error("--commit must be a 40-hex SHA");
  // A fix commit belongs to the PR; GitHub failures refuse.
  if (commit) verifyHead(resolveLineage({ pr: key, home }), commit);
  return withFileLock(`${file}.lock`, () => {
    const rounds = /** @type {RoundRecord[]} */ (readReviewRecords(home, key).filter((record) => record.type === "round"));
    const target = round === undefined ? rounds.at(-1) : rounds.find((candidate) => candidate.round === Number(round));
    if (!target) throw new Error(`${key} has no ${round === undefined ? "recorded review round" : `review round ${round}`}`);
    if (!target.findings.some((candidate) => candidate.id === finding)) throw new Error(`round ${target.round} of ${key} has no finding ${finding} (it has: ${target.findings.map((candidate) => candidate.id).join(", ") || "none"})`);
    /** @type {DispositionRecord} */
    const record = { type: "disposition", pr: key, round: target.round, finding: /** @type {string} */ (text(finding)), outcome: /** @type {DispositionRecord["outcome"]} */ (outcome), ...(commit ? { commit } : {}), ...(text(note) ? { note: text(note) } : {}), recordedAt: new Date().toISOString() };
    appendChecked(home, key, file, record);
    return { ok: true, operation: "review-dispose", path: file, record };
  });
}

/**
 * Records that the PR advances without another review round. Refused unless the PR leads to develop, `head` is its
 * current head, the lineage's last round is this PR's and blocking, the policy says advance (or, with `withdrawn`,
 * withdraw), no reserved round is waiting, and every finding that round left open has a disposition.
 * @param {{home: string, pr?: string, head?: string, withdrawn?: boolean, dryRun?: boolean}} options
 */
export function recordAdvance({ home, pr, head, withdrawn = false, dryRun = false }) {
  const { key, file } = locate(home, pr);
  if (!head || !SHA.test(head)) throw new Error("review advance needs --head <40-hex PR head>");
  const lineage = resolveLineage({ pr: key, home });
  const base = String(lineage.pull?.base?.ref ?? "");
  const [owner = "", repo = ""] = String(lineage.pull?.base?.repo?.full_name ?? "").split("/");
  if (!towardDevelop({ owner, repo, baseRef: base, defaultBranch: String(lineage.pull?.base?.repo?.default_branch ?? "") })) throw new Error(`${key} goes into ${base || "an unknown branch"}, which is not develop or a stack of open PRs that ends in develop: advancing without another round does not apply`);
  if (String(lineage.pull?.head?.sha) !== head) throw new Error(`${head} is not the current head of ${key} (${String(lineage.pull?.head?.sha)}); advance the head you are about to merge`);
  const work = () => {
    const state = lineageState(home, lineage);
    const waiting = state.pending[0];
    if (waiting) throw new Error(`slot ${waiting.slot} of this lineage is reserved for ${waiting.pr} without a recorded round: record or release it first`);
    const last = state.lastRound;
    if (!last || last.pr !== key || last.record.result !== "blocking") throw new Error(`the last review round of this lineage (${last ? `${last.pr}, ${last.record.result}` : "none"}) is not a blocking round of ${key}: nothing to advance past`);
    const slot = last.effectiveSlot;
    const next = nextReview({ nextSlot: state.nextSlot, last: { result: last.record.result, critical: last.critical } });
    const wanted = withdrawn ? "withdraw" : "advance";
    if (next.action !== wanted) {
      throw new Error(next.action === "round"
        ? `slot ${state.nextSlot} still runs (${next.scope}${next.critical ? ", critical re-read" : ""}): reserve and run it instead of advancing`
        : `the policy says ${next.action}, not ${wanted}: ${next.action === "withdraw" ? "a critical finding is still open after the last round; take the disputed change out and pass --withdrawn" : "nothing open is critical; advance without --withdrawn"}`);
    }
    const stillOpen = openFindings(last.record, slot);
    const open = stillOpen.blockers;
    const records = readReviewRecords(home, key);
    const dispositions = dispositionsOf(records, last.record.round);
    const missing = open.filter((finding) => !dispositions.has(finding.id)).map((finding) => finding.id);
    if (missing.length) throw new Error(`round ${last.record.round} left ${missing.join(", ")} open without a disposition: record each with development-system review dispose --pr ${key} --finding <id> --outcome fixed|rejected|follow-up`);
    const kept = withdrawn ? open.filter((finding) => dispositions.get(finding.id)?.outcome !== "follow-up").map((finding) => finding.id) : [];
    if (kept.length) throw new Error(`--withdrawn means the disputed change left the PR as a follow-up, but ${kept.join(", ")} ${kept.length === 1 ? "is" : "are"} not recorded as follow-up`);
    const fixCommits = dispositionCommits(records, last.record.round);
    // A fix the PR no longer has (a rewritten branch) is not a fix of what would be merged.
    for (const finding of open) { const disposition = dispositions.get(finding.id); if (disposition?.outcome === "fixed" && disposition.commit) verifyHead(lineage, disposition.commit); }
    /** @type {AdvanceRecord} */
    const record = { type: "auto-advance", pr: key, round: last.record.round, slot, kind: withdrawn ? "withdrawn" : "cap", head, findings: open.map((finding) => finding.id), fixCommits, recordedAt: new Date().toISOString() };
    // The same check the gate repeats on every read; the commits after the round are walked there, against GitHub.
    const refused = advanceProblem({ advance: record, slot, open: stillOpen, dispositions, head, roundHead: head });
    if (refused) throw new Error(`refusing to record the advance of ${key}: ${refused}`);
    if (dryRun) {
      const problem = recordProblem(record, key) || sequenceProblem([...records, record]);
      if (problem) throw new Error(`refusing to record: ${key} ${problem}`);
    } else appendChecked(home, key, file, record);
    return { ok: true, operation: "review-advance", path: file, record, ...(dryRun ? { dryRun: true } : {}) };
  };
  return dryRun ? work() : withFileLock(`${lineage.file}.lock`, () => withFileLock(`${file}.lock`, work));
}
