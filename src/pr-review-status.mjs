// @ts-check
// The review gate for one PR head: Codex (the chatgpt-codex-connector GitHub app), Sol review records
// (`src/review-records.mjs`) and, for a PR into develop, behavioral evidence (`src/evidence.mjs`). Codex reviews only
// when a PR is opened, marked ready, or asked with "@codex review", so later commits go unreviewed unless someone asks
// again. `--request` asks for the current head while fewer than two requests are published; it holds a local per-PR
// lock and re-reads GitHub inside it before posting, and never deletes a published request. `mergeReady` combines
// every gate and `--gate` records the merge pass the command guard requires for `gh pr merge --match-head-commit
// <head>`. Output always carries estado, Codex n/2, revisión n/max (JSON key `sol`), evidencia and exactly one
// siguiente. Since 2.14.0 the review rounds run on Sol 6.1 High and the hard ones (`hardReason`) on Fable 5.2, back
// on Sol while the lineage records Fable as unavailable (`reviewer` and `reviewerReason` in the JSON).
//
// Contract (plan 1.3), first match wins:
//   valid review of a SHA   a Codex app review with that commit_id and a real body (`Codex Review|Reviewed commit`), or a
//                           Codex app receipt or summary comment on this PR citing that SHA as completed
//   blocking finding        a Codex thread without a valid answer (codex-threads.mjs, 2.13.0): the coordinator's reply
//                           cites a later commit of the PR that touches the thread's file, or rejects it with a
//                           reason; nobody resolves threads. A rejected P0/P1, unprioritized or critical-domain thread
//                           also needs a Sol round recorded after the rejection
//   request state           answered (valid review of its SHA) > failed-terminal (an app comment after the request names a
//                           terminal cause: usage limit, quota, not enabled, no access, couldn't/unable to review; and it
//                           cites the request's SHA or is the first app reply before the next request) > running (summary
//                           shows its SHA running) > unknown (older than 6 h) > requested; `pending` = no request and no
//                           review for the head; unknown is never approval, never returns budget, never retries itself
//   budget                  per PR: every "@codex review" comment by a human (User) account counts, marked or typed by
//                           hand, retries included; with 2 published nothing more is posted. Toward develop a spent
//                           budget is covered by Sol (a clean chained round at the head, its coverage, or the advance)
//   budget-spent            2 published, the last answered by a valid review, no blocking finding
//   coverage (Codex, Sol)   one routine walks the first-parent chain from the current head back to the reviewed head
//                           (at most 20 first-parent commits; any API error fails closed). A clean base merge is covered:
//                           exactly 2 parents, the second an ancestor-or-equal of the base branch, and `git merge-tree
//                           --write-tree p1 p2` (local checkout) equal to its tree; the base history it imports is not a
//                           PR commit; missing objects -> uncovered. Every other first-parent commit cites `fixes: <id>`
//                           of this PR's reviews (any recorded round; Codex threads: for Codex only those the review of
//                           that head opened) and touches only those findings' paths. 2.14.3: a file the interval leaves
//                           as it was read, or that the PR no longer changes, needs no citation; `covers: <sha>` in a
//                           later commit lends its ids to a commit pushed without them; the `fix-only` record is
//                           optional and an `out-of-scope` record still vetoes. Only clean base merges -> covered.
//   Sol                     records invalid or contradictory -> invalid; an exemption counts only for its exact head;
//                           approval needs the last round's result to be none or non-blocking, on the head or covered
//   Sol (2.13.0)            rounds run without approval, two per branch lineage (2.14.1; five before) and two more for a critical fix
//                           (review-policy.mjs); rounds chain by complete intervals; after the last clean round only
//                           prose docs, clean base merges and recorded cited fixes stay covered; at the cap an
//                           `auto-advance` row lets the PR into develop with every later commit a cited fix
//   routing (2.10.0)        the first unmet gate picks siguiente through review-gate-machine.mjs (XState); --diagram draws it
//   mergeReady              Codex ok AND no blocking finding AND Sol ok AND develop evidence (asked first before the
//                           first Sol round, then again for the final head)
import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { ACCEPTED_EVIDENCE, changedFile, evaluatePullEvidence, readReceipts, writeMergeGate } from "./evidence.mjs";
import { readReviewRecords, requestLockPath, withFileLock } from "./review-records.mjs";
import { lineageState, lineageSummary, resolveLineage } from "./review-state.mjs";
import { gateNextAction, gateStep } from "./review-gate-machine.mjs";
import { codexThreads, roundsReservedAt, threadStates } from "./codex-threads.mjs";
import { BUDGET as SOL_BUDGET, CRITICAL_LIMIT, advanceProblem, chainGap, onlyProse, openFindings } from "./review-policy.mjs";
import { dispositionsOf } from "./review-advance.mjs";
import { lineageNext, solNextStep } from "./review-next.mjs";
import { productionBase, towardDevelop } from "./review-stack.mjs";

// The Codex GitHub app: REST reports its login with the [bot] suffix and type "Bot"; GraphQL
// reports the bare login with __typename "Bot". A user account can never have either shape.
const APP_LOGIN = "chatgpt-codex-connector";
const REQUEST_MARKER = "ds-codex-review-request";
const BUDGET = 2;
const UNKNOWN_HOURS = 6;
const MAX_COVERAGE_COMMITS = 20;
// Only causes that end the request; a bare "error" is ambiguous and leaves it requested/unknown.
const TERMINAL = /usage limit|quota|not enabled|no access|couldn['’]?t review|could not review|unable to review/i;
const REQUEST = /^\s*@codex\s+review\b/i;
const REQUEST_LOCK_WAIT_MS = 20_000;
const RUNNING = /running|progress|queued/i;

/** @param {any} user REST user object */
const isCodexApp = (user) => user?.type === "Bot" && user?.login === `${APP_LOGIN}[bot]`;
/** A cited SHA (7 to 40 hex) names this full SHA. @param {string} sha @param {string} cited */
const cites = (sha, cited) => cited.length >= 7 && sha.startsWith(cited);

/** @param {string} pr */
export function parsePr(pr) {
  const url = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pr);
  const short = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(pr);
  const match = url ?? short;
  if (!match) throw new Error(`Not a PR reference: ${pr} (use owner/repo#number or the PR URL)`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** @param {string[]} args */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** @param {string} path @returns {any[]} */
const ghList = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

/**
 * Files changed between a verified SHA and the head, or null when GitHub cannot list them completely or the head
 * does not descend from that SHA (after a force-push the comparison hides what the new history dropped).
 * @param {string} base @param {string} from @param {string} to
 */
export function changedSince(base, from, to) {
  try {
    const compare = JSON.parse(gh(["api", `${base}/compare/${from}...${to}`]));
    if (compare.status !== "ahead" && compare.status !== "identical") return null;
    const files = Array.isArray(compare.files) ? compare.files : [];
    return files.length >= 300 ? null : files.map(changedFile);
  } catch { return null; }
}

/**
 * Every file the PR changes, or null when GitHub cannot list them all (the files endpoint stops at 3000).
 * @param {string} base @param {number} number @param {number} expected
 */
function pullFiles(base, number, expected) {
  try {
    const files = ghList(`${base}/pulls/${number}/files`);
    return files.length === expected ? files.map(changedFile) : null;
  } catch { return null; }
}

/** Every Codex app summary comment as {sha, status}: the hidden state JSON first, the table row as fallback. @param {any[]} appComments */
function summaryStates(appComments) {
  return appComments.filter((comment) => String(comment.body).includes("codex-pull-request-review-summary")).flatMap((comment) => {
    const body = String(comment.body);
    const hidden = /<!-- codex-review-state:v1 (\{.*?\}) -->/.exec(body);
    if (hidden) {
      try {
        const code = JSON.parse(hidden[1]).code_review;
        if (typeof code?.commit_sha === "string" && /^[0-9a-f]{7,40}$/.test(code.commit_sha)) return [{ sha: code.commit_sha, status: String(code.status ?? "") }];
      } catch { /* fall back to the table row */ }
    }
    const row = /\|\s*📝[^|]*\|\s*([^|]+)\|\s*`([0-9a-f]{7,40})`/.exec(body);
    return row ? [{ sha: row[2], status: row[1] }] : [];
  });
}

/**
 * @typedef {{id: string, paths: string[]}} Finding
 * @typedef {"pending" | "requested" | "running" | "answered" | "failed-terminal" | "unknown"} CodexState
 * @typedef {{sha: string, message: string, fixes: string[], files: string[], problem?: string, baseMerge?: boolean, settled?: boolean, undone?: boolean}} CoveredCommit
 * @typedef {{from: string, to: string, covered: boolean, error: boolean, filtersPass: boolean, reason: string, commits: CoveredCommit[]}} Coverage
 */

/** True when `ancestor` is `descendant` or one of its ancestors on GitHub; throws when GitHub cannot say. @param {string} base @param {string} ancestor @param {string} descendant */
function ancestorOrEqual(base, ancestor, descendant) {
  const compare = JSON.parse(gh(["api", `${base}/compare/${ancestor}...${descendant}`]));
  return compare.status === "identical" || compare.status === "ahead";
}

/**
 * Whether one first-parent commit (GitHub commit detail) is a clean merge of the base branch: exactly 2 parents, the second an ancestor-or-equal
 * of `baseRef` (GitHub compare), and `git merge-tree --write-tree p1 p2` in the local checkout yields the commit's
 * tree. Missing local objects or another repository leave it unproven, with the reason.
 * @param {string} base @param {any} entry a commit as GitHub's commits API reports it @param {string} baseRef
 * @returns {{merge: boolean, clean?: boolean, error?: boolean, reason?: string}}
 */
function cleanBaseMerge(base, entry, baseRef) {
  const parents = Array.isArray(entry.parents) ? entry.parents.map((/** @type {any} */ parent) => String(parent?.sha ?? "")) : [];
  if (parents.length !== 2) return { merge: false };
  const [first, second] = parents;
  const tree = String(entry.commit?.tree?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(first) || !/^[0-9a-f]{40}$/.test(second) || !/^[0-9a-f]{40}$/.test(tree)) return { merge: true, clean: false, error: true, reason: "GitHub did not report the merge's parents and tree" };
  if (!baseRef) return { merge: true, clean: false, reason: "the PR has no base branch" };
  try {
    if (!ancestorOrEqual(base, second, baseRef)) return { merge: true, clean: false, reason: `its second parent ${second.slice(0, 12)} is not in ${baseRef}` };
  } catch { return { merge: true, clean: false, error: true, reason: `GitHub could not compare ${second.slice(0, 12)} with ${baseRef}` }; }
  let written;
  try {
    written = execFileSync("git", ["merge-tree", "--write-tree", first, second], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }).split("\n")[0].trim();
  } catch (error) {
    const status = /** @type {{status?: number}} */ (error).status;
    return { merge: true, clean: false, reason: status === 1 ? "git merge-tree reports conflicts" : "the local checkout cannot rebuild the merge (missing objects or another repository: run from the PR's checkout after git fetch)" };
  }
  if (written !== tree) return { merge: true, clean: false, reason: `its tree ${tree.slice(0, 12)} differs from the clean merge ${written.slice(0, 12)}` };
  return { merge: true, clean: true };
}

/**
 * The single coverage rule for Codex (budget-spent) and Sol: the PR's own commits from the reviewed head to the current
 * head. It walks the first-parent chain from the current head back to the reviewed head (at most 20 first-parent
 * commits). A first-parent commit that is a verified clean merge of `baseRef` is covered, and the base history it
 * imports through its second parent is not a PR commit, so it needs no `fixes:` line. Every other first-parent commit
 * must cite findings of this PR's reviews: `findings` and `peers` together are every recorded round and the Codex
 * threads, because a fix another round or the other reviewer asked for is still a fix, not new scope (operator decision
 * 2026-11-03; every round since 2.14.3). It must touch only the cited findings' paths.
 *
 * 2.14.3, from five stalls in one day (frictions fixes-line-needs-amend, gate-per-commit-scope-no-net-diff,
 * gate-codex-coverage-ignores-fable-fixes, review-coverage-fix-diff-rounds):
 *   settled files   a file needs no citation when the interval leaves it as the reviewer read it (it is not in the
 *                   diff from the reviewed head to the current head, and no clean base merge of the interval brought
 *                   it in: undoing a base merge also leaves that diff empty, and merging it would delete the base's
 *                   work) or when the PR no longer changes it (`prChanged` does not list it: the change left the PR).
 *                   A commit made only of such files, an empty commit included, is covered without a `fixes:` line.
 *                   A commit whose every file the interval left as it was read is also marked `undone`: a finding
 *                   recorded as fixed there is not fixed (review-policy.mjs advanceProblem). Best effort: it needs
 *                   the net diff, and another change to the same file hides it; the revert then needs its own
 *                   citation, so the only loss is a wrong "fixed" in the ledger.
 *   covers          a later commit of the interval lends its `fixes:` ids to an earlier one it names with
 *                   `covers: <sha>` (7 to 40 hex). Pushed history cannot be amended, so this repairs a fix that was
 *                   pushed without its line or with a wrong id; the lent ids replace the commit's own and the newest
 *                   `covers:` that carries ids wins, so a mistyped repair is repaired by another. Ids are not joined
 *                   across repair commits: one repair commit carries every id of the fix.
 *   record          a `fix-only` coverage record is no longer required: it was the coordinator's word about its own
 *                   commits and added nothing to the citation. An `out-of-scope` record for the head still vetoes.
 * Anything GitHub or the local checkout cannot prove leaves the interval uncovered with the reason.
 * @param {{base: string, from: string, to: string, findings: Finding[], peers?: Finding[], records: any[], baseRef: string, prChanged?: Set<string> | null}} input @returns {Coverage}
 */
function coverage({ base, from, to, findings, peers = [], records, baseRef, prChanged = null }) {
  /** @type {CoveredCommit[]} */
  const commits = [];
  /** @param {string} reason @param {boolean} [error] @returns {Coverage} */
  const uncovered = (reason, error = false) => ({ from, to, covered: false, error, filtersPass: false, reason, commits });
  /** @type {any} */
  let compare;
  try { compare = JSON.parse(gh(["api", `${base}/compare/${from}...${to}`])); } catch { return uncovered(`GitHub could not compare ${from.slice(0, 12)}...${to.slice(0, 12)}`, true); }
  if (compare.status !== "ahead") return uncovered(`the head is ${compare.status} of the reviewed head ${from.slice(0, 12)}, not ahead`);
  // Two rounds may reuse an id (F1 of round 1 and of round 2): the id then stands for the paths of both.
  /** @type {Map<string, string[]>} */
  const known = new Map();
  for (const finding of [...peers, ...findings]) known.set(finding.id, [...(known.get(finding.id) ?? []), ...finding.paths]);
  // The interval's net diff; null when GitHub does not list it or lists it partially, and then no file counts as
  // untouched by the interval.
  /** @type {Set<string> | null} */
  let net = Array.isArray(compare.files) && compare.files.length < 300 ? new Set(compare.files.flatMap((/** @type {any} */ file) => [String(file.filename), ...(file.previous_filename ? [String(file.previous_filename)] : [])])) : null;
  // What the clean base merges of the interval brought in: never "untouched", whatever the net diff says.
  /** @type {Set<string>} */
  const merged = new Set();
  /** The interval left the file as the reviewer read it. @param {string} name */
  const untouched = (name) => net !== null && !net.has(name) && !merged.has(name);
  /** A file the reviewer has nothing new to read in. @param {string} name */
  const settled = (name) => untouched(name) || (prChanged !== null && !prChanged.has(name));
  /** Commits that are not clean base merges, judged after the walk: a base merge is older than the commit that undoes it. @type {{commit: CoveredCommit, merge: ReturnType<typeof cleanBaseMerge>, parents: number}[]} */
  const judged = [];
  /** `covers:` lines seen so far, newest commit first: [sha prefix, the ids that commit cites]. @type {[string, string[]][]} */
  const lent = [];
  let filtersPass = true;
  let baseMerges = 0;
  let sha = to;
  while (sha !== from) {
    if (commits.length >= MAX_COVERAGE_COMMITS) return { ...uncovered(`more than ${MAX_COVERAGE_COMMITS} first-parent commits after the reviewed head, or the first-parent chain from ${to.slice(0, 12)} does not reach ${from.slice(0, 12)}`), commits };
    /** @type {any} */
    let detail;
    try { detail = JSON.parse(gh(["api", `${base}/commits/${sha}`])); } catch { return { ...uncovered(`GitHub could not read commit ${sha.slice(0, 12)}`, true), commits }; }
    const parents = Array.isArray(detail.parents) ? detail.parents.map((/** @type {any} */ parent) => String(parent?.sha ?? "")) : [];
    if (String(detail.sha) !== sha || parents.length === 0 || !parents.every((/** @type {string} */ parent) => /^[0-9a-f]{40}$/.test(parent))) return { ...uncovered(`GitHub did not report the parents of ${sha.slice(0, 12)}`, true), commits };
    const message = String(detail.commit?.message ?? "");
    const merge = cleanBaseMerge(base, detail, baseRef);
    if (merge.error) return { ...uncovered(`${sha.slice(0, 12)}: ${merge.reason}`, true), commits };
    if (merge.clean) {
      // GitHub lists a merge's files against its first parent; an unlisted, empty or partial list means "every file".
      if (Array.isArray(detail.files) && detail.files.length > 0 && detail.files.length < 300) for (const file of detail.files) { merged.add(String(file.filename)); if (file.previous_filename) merged.add(String(file.previous_filename)); }
      else net = null;
      commits.push({ sha, message: message.split("\n")[0].slice(0, 120), fixes: [], files: [], baseMerge: true });
      baseMerges += 1;
      sha = parents[0];
      continue;
    }
    const own = [...message.matchAll(/^fixes:\s*(.+)$/gim)].flatMap((match) => match[1].split(/[\s,]+/)).filter(Boolean);
    // Newest first, so the latest `covers:` naming this commit wins.
    const borrowed = lent.find(([prefix]) => sha.startsWith(prefix))?.[1] ?? [];
    const fixes = borrowed.length ? borrowed : own;
    for (const match of message.matchAll(/^covers:\s*(.+)$/gim)) for (const prefix of match[1].split(/[\s,]+/)) if (own.length && /^[0-9a-f]{7,40}$/.test(prefix)) lent.push([prefix, own]);
    const files = detail.files;
    if (!Array.isArray(files) || files.length >= 300) return { ...uncovered(`GitHub listed the files of ${sha.slice(0, 12)} partially`, true), commits };
    const names = files.flatMap((/** @type {any} */ file) => [String(file.filename), ...(file.previous_filename ? [String(file.previous_filename)] : [])]);
    /** @type {CoveredCommit} */
    const commit = { sha, message: message.split("\n")[0].slice(0, 120), fixes, files: names };
    judged.push({ commit, merge, parents: parents.length });
    commits.push(commit);
    sha = parents[0];
  }
  for (const { commit, merge, parents } of judged) {
    // Only the files the interval really changes, and the PR still changes, need a cited finding.
    const pending = commit.files.filter((name) => !settled(name));
    const allowed = new Set(commit.fixes.flatMap((id) => known.get(id) ?? []));
    const unknown = commit.fixes.filter((id) => !known.has(id));
    const outside = pending.filter((name) => !allowed.has(name));
    if (pending.length === 0) commit.settled = true;
    if (commit.files.length > 0 && commit.files.every(untouched)) commit.undone = true;
    if (pending.length === 0) { /* nothing left to read: no citation needed */ }
    else if (commit.fixes.length === 0) commit.problem = "no `fixes: <id>` line";
    else if (unknown.length) commit.problem = `cites ids that are not findings of this PR's reviews: ${unknown.join(", ")}`;
    else if (outside.length) commit.problem = `touches files outside the cited findings: ${outside.slice(0, 5).join(", ")}`;
    if (commit.problem && merge.merge) commit.problem = `${commit.problem}; not a clean base merge: ${merge.reason}`;
    // Only a verified clean base merge may skip its side parents; any other merge brings in history this walk never
    // inspects, so it fails closed instead of being covered by the merge commit's own fixes lines.
    if (!commit.problem && parents > 1) commit.problem = `a merge that is not a verified clean base merge (${merge.reason ?? "side history not from the base"}); its side-parent commits are unreviewed`;
    if (commit.problem) filtersPass = false;
  }
  if (commits.length === 0) return uncovered("no commits after the reviewed head");
  if (!filtersPass) return { ...uncovered("a commit after the reviewed head is not a cited fix of its findings"), commits };
  if (baseMerges === commits.length) return { from, to, covered: true, error: false, filtersPass, reason: `only clean merges of ${baseRef} after the reviewed head`, commits };
  const forHead = records.filter((record) => record.type === "coverage" && record.to === to);
  if (forHead.some((record) => record.verdict === "out-of-scope")) return { ...uncovered(`a coverage record for ${to.slice(0, 12)} says out-of-scope`), filtersPass, commits };
  // The record is optional since 2.14.3; when one exists for this interval its note is the reason shown.
  const record = forHead.find((candidate) => candidate.verdict === "fix-only" && candidate.from === from);
  return { from, to, covered: true, error: false, filtersPass, reason: record ? `fix-only coverage recorded: ${record.note}` : "every commit after the reviewed head is a cited fix of this PR's findings, leaves no net change or takes a file out of the PR", commits };
}

/**
 * Where Codex's review stands for the current head. A request Codex has not answered yet keeps the review in flight
 * whichever head it names: a hand-typed request names none until its review arrives, and one asked for an earlier head
 * may still report. So two published requests count as spent only when none of them is still waiting.
 * @param {{headReviewed: boolean, headRequest?: {state: CodexState}, headRunning: boolean, published: {state: CodexState}[]}} input
 * @returns {CodexState}
 */
export function codexHeadState({ headReviewed, headRequest, headRunning, published }) {
  if (headReviewed) return "answered";
  const own = headRequest ? headRequest.state : headRunning ? "running" : "pending";
  if (own === "requested" || own === "running") return own;
  return published.filter((entry) => entry.state === "requested" || entry.state === "running").at(-1)?.state ?? own;
}

/**
 * @param {{pr: string, request?: boolean, gate?: boolean, home?: string}} options
 */
export function prReviewStatus({ pr, request = false, gate = false, home = homedir() }) {
  const { owner, repo, number } = parsePr(pr);
  const prKey = `${owner}/${repo}#${number}`;
  const base = `repos/${owner}/${repo}`;
  const pull = JSON.parse(gh(["api", `${base}/pulls/${number}`]));
  const head = String(pull.head.sha);
  const threads = codexThreads(gh, owner, repo, number);
  /** @type {(Finding & {origin: string})[]} */
  const codexFindings = threads.map((thread) => ({ id: `codex:${thread.comments.nodes[0].databaseId}`, paths: [String(thread.path)], origin: String(thread.origin) }));
  // Sol: rounds, exemption and coverage records written by the coordinator; invalid or contradictory records fail closed.
  /** @type {import("./review-records.mjs").ReviewRecord[]} */
  let records = [];
  let recordsError = "";
  try { records = readReviewRecords(home, prKey); } catch (error) { recordsError = error instanceof Error ? error.message : String(error); }
  const rounds = /** @type {import("./review-records.mjs").RoundRecord[]} */ (records.filter((record) => record.type === "round"));
  // Answered, not resolved (2.13.0): a reply cites a later commit of this PR touching the thread's file, or rejects it.
  /** @type {string[] | null} */
  let prCommits = null;
  const commitInfo = (/** @type {string} */ cited) => {
    prCommits ??= ghList(`${base}/pulls/${number}/commits?per_page=100`).map((commit) => String(commit.sha));
    const sha = prCommits.find((candidate) => candidate.startsWith(cited));
    if (!sha) return null;
    const files = JSON.parse(gh(["api", `${base}/commits/${sha}`])).files ?? [];
    return { sha, files: files.flatMap((/** @type {any} */ file) => [String(file.filename), ...(file.previous_filename ? [String(file.previous_filename)] : [])]), after: (/** @type {string} */ origin) => origin !== sha && ancestorOrEqual(base, origin, sha) };
  };
  // The branch lineage Sol rounds count against: siguiente, the last round's slot and when each round was reserved.
  /** @type {ReturnType<typeof lineageSummary> | null} */
  let lineage = null;
  let lineageError = "";
  /** @type {number[]} */
  let solRoundsAt = [];
  // Who runs the next round (2.14.0; review-policy.mjs reviewerFor); an unreadable lineage keeps Sol.
  /** @type {(rejected: boolean) => ReturnType<typeof import("./review-policy.mjs").reviewerFor>} */
  let reviewerWith = () => ({ reviewer: "sol", reason: "", degraded: false });
  try {
    const state = lineageState(home, resolveLineage({ pr: prKey, home, pull }));
    lineage = lineageSummary(state);
    reviewerWith = state.reviewerWith;
    solRoundsAt = roundsReservedAt({ rounds, live: state.live, pr: prKey });
  } catch (error) { lineageError = error instanceof Error ? error.message : String(error); }
  const threadView = threadStates({ threads, commitInfo, solRoundsAt });
  const open = threadView.filter((thread) => thread.state === "open" || thread.state === "unverified");
  const rejectedNeedSol = threadView.filter((thread) => thread.state === "rejected-needs-sol");
  const blockingIds = open.map((thread) => thread.id);
  /** One read of Codex reviews and PR comments and everything derived from it; `--request` repeats it under its lock. */
  const observe = () => {
    // Only a real Codex review counts: a reply inside a review thread also creates an empty
    // review on the head, which must not mark the head as reviewed.
    const reviews = ghList(`${base}/pulls/${number}/reviews`).filter((review) => isCodexApp(review.user) && /Codex Review|Reviewed commit/.test(String(review.body)));
    const comments = ghList(`${base}/issues/${number}/comments`);
    const appComments = comments.filter((comment) => isCodexApp(comment.user)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    const summaries = summaryStates(appComments);
    // A receipt is the app's own "Reviewed commit" comment when a review ends without inline findings.
    const receiptEntries = appComments.filter((comment) => String(comment.body).includes("codex-review-receipt:v1"))
      .map((comment) => ({ sha: /Reviewed commit:?\**:?\s*`([0-9a-f]{7,40})`/.exec(String(comment.body))?.[1], at: Date.parse(comment.created_at) }))
      .filter((entry) => typeof entry.sha === "string");
    const receipts = receiptEntries.map((entry) => entry.sha);
    /** The one commit Codex completed a review or receipt for in (from, to); "" when none or ambiguous. */
    const reviewedBetween = (/** @type {number} */ from, /** @type {number} */ to) => {
      /** @type {string[]} */
      const shas = [];
      // A receipt cites an abbreviated SHA: it names the same commit as a full SHA (or a longer abbreviation) it prefixes.
      for (const sha of [
        ...reviews.filter((review) => { const at = Date.parse(review.submitted_at); return at > from && at < to; }).map((review) => String(review.commit_id)),
        ...receiptEntries.filter((entry) => entry.at > from && entry.at < to).map((entry) => /** @type {string} */ (entry.sha)),
      ]) {
        const same = shas.findIndex((known) => known.startsWith(sha) || sha.startsWith(known));
        if (same < 0) shas.push(sha);
        else if (sha.length > shas[same].length) shas[same] = sha;
      }
      return shas.length === 1 ? shas[0] : "";
    };
    const validReview = (/** @type {string} */ sha) => sha !== "" && (reviews.some((review) => review.commit_id === sha)
      || receipts.some((cited) => cites(sha, /** @type {string} */ (cited)))
      || summaries.some((summary) => cites(sha, summary.sha) && /completed/i.test(summary.status)));
    const headReviewed = validReview(head);
    // The budget is per PR: every "@codex review" a human account posted counts, marked by this CLI or typed by hand,
    // whoever posted it. Bots (the app included) never count.
    const replies = appComments.filter((reply) => !String(reply.body).includes("codex-pull-request-review-summary"));
    const now = Date.now();
    const published = comments.filter((comment) => comment.user?.type === "User" && REQUEST.test(String(comment.body)))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
      .map((comment, index, all) => {
        const at = Date.parse(comment.created_at);
        const next = index + 1 < all.length ? Date.parse(all[index + 1].created_at) : Infinity;
        // A hand-typed request carries no marker: it takes the one commit Codex reviewed before the next request.
        const sha = new RegExp(`${REQUEST_MARKER} sha=([0-9a-f]{40})`).exec(String(comment.body))?.[1] ?? reviewedBetween(at, next);
        const after = replies.filter((reply) => Date.parse(reply.created_at) > at);
        const first = after[0];
        // A terminal app reply ends this request only if it names the request's SHA or is the first app reply to it.
        const terminal = after.some((reply) => {
          const body = String(reply.body);
          if (body.includes("codex-review-receipt:v1") || !TERMINAL.test(body)) return false;
          const namesSha = sha !== "" && [...body.matchAll(/\b[0-9a-f]{7,40}\b/g)].some((match) => cites(sha, match[0]));
          return namesSha || (reply === first && Date.parse(reply.created_at) < next);
        });
        /** @type {CodexState} */
        let state;
        if (validReview(sha)) state = "answered";
        else if (terminal) state = "failed-terminal";
        else if (sha && summaries.some((summary) => cites(sha, summary.sha) && RUNNING.test(summary.status))) state = "running";
        else if (now - at > UNKNOWN_HOURS * 3_600_000) state = "unknown";
        else state = "requested";
        return { id: Number(comment.id), sha, createdAt: String(comment.created_at), state };
      });
    let headState = codexHeadState({ headReviewed, headRequest: published.filter((entry) => entry.sha === head).at(-1),
      headRunning: summaries.some((summary) => cites(head, summary.sha) && RUNNING.test(summary.status)), published });
    const last = published.at(-1);
    const budgetSpent = !headReviewed && published.length >= BUDGET && last?.state === "answered" && blockingIds.length === 0;
    /** @type {"no-findings" | "findings" | "budget-spent" | "running" | "pending" | "unavailable"} */
    let state;
    if (headReviewed) state = blockingIds.length > 0 ? "findings" : "no-findings";
    else if (budgetSpent) state = "budget-spent";
    else if (headState === "running") state = "running";
    else if (headState === "failed-terminal") state = "unavailable";
    else state = "pending";
    return { reviews, published, headReviewed, headState, last, budgetSpent, state };
  };
  let requestStatus = "not-requested";
  /** @returns {string} */
  const decide = (/** @type {ReturnType<typeof observe>} */ view) => {
    if (view.headReviewed || view.budgetSpent) return `skipped-${view.state}`;
    // Review budget: never post past two published requests.
    if (view.published.length >= BUDGET) return "budget-exhausted";
    if (view.headState === "requested") return "already-requested-for-head";
    if (view.headState === "running") return "skipped-running";
    return "";
  };
  const view = !request ? observe() : withFileLock(requestLockPath(home, prKey), () => {
    // pending, failed-terminal or unknown on a fresh read taken under the lock: the post consumes one request. The lock
    // keeps a concurrent run from posting too; a published request is never deleted, so it always counts.
    const fresh = observe();
    requestStatus = decide(fresh);
    if (requestStatus) return fresh;
    const posted = JSON.parse(gh(["api", `${base}/issues/${number}/comments`, "-f", `body=@codex review\n\n<!-- ${REQUEST_MARKER} sha=${head} -->`]));
    requestStatus = "requested";
    fresh.published.push({ id: Number(posted.id), sha: head, createdAt: String(posted.created_at), state: "requested" });
    fresh.headState = "requested";
    return fresh;
  }, { waitMs: REQUEST_LOCK_WAIT_MS });
  const { reviews, published, headReviewed, last, budgetSpent, state } = view;
  const headState = view.headState;
  const baseRef = String(pull.base?.ref ?? "");
  // develop, or a stack of open PRs that ends in develop (2.14.3): the review runs and advances the same way, and behavioral
  // evidence is required the same way.
  const toDevelop = towardDevelop({ owner, repo, baseRef, defaultBranch: String(pull.base?.repo?.default_branch ?? "") });
  const inFlight = headState === "requested" || headState === "running";
  // Toward develop two spent requests stop being a stop even when the last one never answered: Sol covers them.
  const codexSpent = !headReviewed && published.length >= BUDGET && !inFlight && blockingIds.length === 0 && (toDevelop || last?.state === "answered");
  // Coverage after budget-spent admits only the threads the review of that head opened.
  const reviewedHead = budgetSpent && last ? last.sha : headReviewed ? head : "";
  const originUnknown = codexFindings.some((finding) => finding.origin === "");
  const admissibleFindings = originUnknown ? [] : codexFindings.filter((finding) => reviewedHead !== "" && finding.origin === reviewedHead);
  // A later exemption replaces an earlier one; it counts only for the exact head it names.
  const exemption = /** @type {import("./review-records.mjs").ExemptionRecord | undefined} */ (records.filter((record) => record.type === "exemption").at(-1));
  const lastRound = rounds.at(-1);
  const solMax = rounds.length > SOL_BUDGET ? CRITICAL_LIMIT : SOL_BUDGET;
  const prFiles = pullFiles(base, number, Number(pull.changed_files));
  // The slot the last round counts as, derived where the advance writer derives it (a legacy round has no bound slot).
  const lineageLast = lineage?.lastRound;
  const lastSlot = !lastRound ? 0 : lineageLast && lineageLast.pr.toLowerCase() === prKey.toLowerCase() && lineageLast.round === lastRound.round ? lineageLast.effectiveSlot : Number(lastRound.slot ?? lastRound.round);
  // What the last round left open, and the row that lets the PR advance past it at the cap.
  const stillOpen = lastRound ? openFindings(lastRound, lastSlot) : { blockers: [], critical: false };
  const advance = /** @type {import("./review-policy.mjs").AdvanceRecord | undefined} */ (records.filter((record) => record.type === "auto-advance" && record.round === lastRound?.round).at(-1));
  let advanceRefused = false;
  // Why a recorded advance does not count; such a row is ignored and the lineage decides the next step.
  let advanceNote = "";
  /** @param {string} from @param {string} reason @param {boolean} covered @returns {Coverage} */
  const verdict = (from, reason, covered) => ({ from, to: head, covered, error: false, filtersPass: covered, reason, commits: [] });
  // Every recorded round's findings are citable, not only the last round's: a fix-diff round does not repeat the
  // findings of the rounds before it.
  const roundFindings = rounds.flatMap((round) => round.findings);
  const prChanged = prFiles === null ? null : new Set(prFiles.flatMap((file) => [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])]));
  /** @param {string} from */
  const walk = (from) => coverage({ base, from, to: head, findings: roundFindings, peers: originUnknown ? [] : codexFindings, records, baseRef, prChanged });
  /** @type {Coverage | null} */
  let solCoverage = null;
  /** @type {"invalid" | "exempt" | "exemption-stale" | "missing" | "blocking" | "approved" | "covered" | "not-covered" | "waived" | "advanced"} */
  let solState;
  const gap = chainGap(rounds);
  if (recordsError || (exemption && rounds.length)) solState = "invalid";
  else if (exemption) solState = exemption.head === head ? "exempt" : "exemption-stale";
  else if (!lastRound) solState = "missing";
  // Rounds chain by complete intervals: a fix-diff that did not start at the previous round's head left commits unread.
  else if (gap) { solState = "not-covered"; solCoverage = verdict(lastRound.head, gap, false); }
  else if (lastRound.result === "blocking") {
    solState = "blocking";
    if (advance && toDevelop) {
      // The advance stands in for the re-read only while every commit after the round is a cited fix of its findings
      // or a clean base merge; a withdrawn change must be gone from the PR's files.
      const after = lastRound.head === head ? null : walk(lastRound.head);
      // The row is judged again against the ledger and the PR as they are now. First its authority (the real slot, what
      // the policy says after that round, the findings and their dispositions), then, once every commit after the
      // round is a cited fix or a clean base merge, whether the row accounts for each of them at the current head.
      const judged = { advance, slot: lastSlot, open: stillOpen, dispositions: dispositionsOf(records, lastRound.round), roundHead: lastRound.head };
      // The second question is also asked when the PR head is the round's own head (no commit after it): an advance
      // recorded for another head, or a fix in a commit the PR no longer has, does not count.
      advanceNote = advanceProblem({ ...judged, head: advance.head });
      if (!advanceNote && (after === null || (!after.error && after.filtersPass))) advanceNote = advanceProblem({ ...judged, head, commits: after?.commits ?? [] });
      const kept = advance.kind === "withdrawn" ? stillOpen.blockers.flatMap((finding) => finding.paths).filter((path) => prFiles === null || prFiles.some((file) => file.filename === path || file.previous_filename === path)) : [];
      if (advanceNote) solCoverage = null;
      else if (after?.error) solCoverage = after;
      else if ((after === null || after.filtersPass) && kept.length === 0) solState = "advanced";
      else { advanceRefused = true; solCoverage = after && !after.filtersPass ? after : verdict(lastRound.head, `the PR still changes the files of the withdrawn finding: ${kept.slice(0, 5).join(", ")}`, false); }
    }
  }
  // Approval needs an explicit none or non-blocking result; anything else is invalid.
  else if (lastRound.result !== "none" && lastRound.result !== "non-blocking") solState = "invalid";
  else if (lastRound.head === head) solState = "approved";
  // After the last round only prose docs stay covered on their own (isNonFunctionalChange).
  else if (onlyProse(changedSince(base, lastRound.head, head))) { solState = "covered"; solCoverage = verdict(lastRound.head, "only prose docs changed after the last round", true); }
  else {
    // Co-cited Codex ids only need to exist: any Codex finding with a known origin, not just the latest reviewed head's.
    solCoverage = walk(lastRound.head);
    solState = solCoverage.covered ? "covered" : "not-covered";
  }
  // Sol read every commit of the PR (a clean chained round at the head, its coverage, or the advance at the cap).
  const solReadAll = solState === "approved" || solState === "covered" || solState === "advanced";
  /** @type {Coverage | null} */
  let codexCoverage = null;
  if (budgetSpent && last && !solReadAll) {
    codexCoverage = originUnknown
      ? { from: last.sha, to: head, covered: false, error: true, filtersPass: false, reason: "GitHub did not report which commit a Codex thread reviewed", commits: [] }
      : coverage({ base, from: last.sha, to: head, findings: admissibleFindings, peers: roundFindings, records, baseRef, prChanged });
  }
  let ok = state === "no-findings" || (codexSpent && (solReadAll || codexCoverage?.covered === true));
  // The owner stopped reviews for this exact head, in words the PR description quotes verbatim: no more Sol or Codex rounds.
  const waiver = recordsError ? undefined : /** @type {import("./review-records.mjs").WaiverRecord | undefined} */ (records.filter((record) => record.type === "waiver" && record.head === head && String(pull.body ?? "").includes(record.quote)).at(-1));
  if (waiver && solState !== "invalid") solState = "waived";
  // A waiver also stands in for further Codex rounds; unanswered threads still block through blockingIds.
  if (waiver) ok = true;
  const solOk = solState === "exempt" || solState === "approved" || solState === "covered" || solState === "waived" || solState === "advanced";
  // A rejected critical Codex thread waits for Sol's read; only the owner's waiver stands in for it.
  const pendingCritical = rejectedNeedSol.length > 0 && !waiver;
  const reviewer = reviewerWith(pendingCritical);
  const evidenceReceipts = readReceipts(home, prKey);
  const behavioralEvidence = evaluatePullEvidence({
    receipts: evidenceReceipts, head, prBody: String(pull.body ?? ""), changedSince: (from) => changedSince(base, from, head),
    // Always listed: a docs-only PR needs no receipt, and a mobile PR needs one per native platform.
    prFiles,
  });
  // Evidence is required of every PR whose base is not positively production, so a stacked PR needs it, and so does one
  // whose stack could not be resolved (a failed lookup, a base branch without an open PR): when the PR below merges,
  // GitHub retargets the stacked PR to develop with the same head, and the command guard reads a merge pass by PR and
  // head, not by base, so a pass issued without evidence would admit that develop merge. A PR into main needs none
  // here; its merge is the owner's production stop, which the gate's next action says.
  const evidenceRequired = !productionBase(baseRef, String(pull.base?.repo?.default_branch ?? ""));
  const evidenceOk = !evidenceRequired || ACCEPTED_EVIDENCE.has(behavioralEvidence.state);
  const mergeReady = ok && blockingIds.length === 0 && solOk && evidenceOk && !pendingCritical;
  // Contradictory or partial data (records that cannot be read or conflict, a GitHub read that failed) is `unknown`.
  const contradictory = solState === "invalid" || (!waiver && (codexCoverage?.error === true || solCoverage?.error === true));
  const estado = contradictory ? "unknown" : headState;
  // What the lineage does next when Sol, a rejected critical thread or a spent Codex still needs a read.
  const needsSol = solState !== "invalid" && solState !== "exemption-stale" && (!solOk || pendingCritical || (!ok && codexSpent));
  const exemptNeedsRound = needsSol && solState === "exempt";
  const moved = solState !== "blocking";
  /** @type {import("./review-policy.mjs").NextAction} */
  const solNext = !needsSol ? "none" : exemptNeedsRound ? "round" : advanceRefused ? "split" : lineageNext({ lineage, moved, pendingCritical }).action;
  let mergeGate = null;
  if (gate) {
    const { path, ...pass } = writeMergeGate({ home, pr: prKey, head, base: baseRef, mergeReady, codex: state, behavioralEvidence: behavioralEvidence.state });
    // The pass also names the Sol state; same file, same permissions.
    writeFileSync(path, `${JSON.stringify({ ...pass, sol: solState }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(path, 0o600);
    mergeGate = path;
  }
  // The single next action, first unmet gate first: the review gate machine (2.10.0) picks the step.
  const step = gateStep({ toDevelop, blocking: blockingIds.length > 0, codexOk: ok, codexCoverage, headState, published: published.length, budget: BUDGET,
    solState, solCoverageError: solCoverage?.error === true, solNext, evidenceOk, mergeGate: Boolean(mergeGate) });
  const problems = (/** @type {{commits?: CoveredCommit[]} | null | undefined} */ coverage) => (coverage?.commits ?? []).filter((commit) => commit.problem).map((commit) => `${commit.sha.slice(0, 12)} ${commit.problem}`);
  const uncovered = advanceRefused && !problems(solCoverage).length && solCoverage?.reason ? [solCoverage.reason] : [...new Set([...problems(solCoverage), ...problems(codexCoverage)])];
  const receipt = ["ok", "nonvisual"].includes(behavioralEvidence.state) ? evidenceReceipts.at(-1)?.path : undefined;
  const siguiente = gateNextAction(step, { toDevelop, prKey, owner, repo, number, head, blockingIds, exemptionHead: exemption?.head, recordsError, uncovered, advanceNote,
    open: [...stillOpen.blockers, ...rejectedNeedSol.map((thread) => ({ id: thread.id, paths: [thread.path] }))],
    solNext: () => solNextStep({ lineage, lineageError, prKey, head, exempt: exemptNeedsRound, moved, rejected: pendingCritical ? rejectedNeedSol.map((thread) => thread.id) : [], receipt, reviewer }) });
  return {
    ok,
    operation: "pr-review-status",
    pr: prKey,
    head,
    base: baseRef,
    estado,
    codex: `${published.length}/${BUDGET}`,
    sol: `${rounds.length}/${solMax}${exemption ? ` (exempt ${exemption.exempt})` : ""}`,
    solNext,
    reviewer: reviewer.reviewer,
    reviewerReason: reviewer.reason,
    evidencia: `${behavioralEvidence.state}${evidenceRequired ? "" : " (not required)"}`,
    siguiente,
    step,
    state,
    behavioralEvidence,
    evidenceRequired,
    mergeReady,
    ...(mergeGate ? { mergeGate } : {}),
    headReviewed,
    reviewedCommits: [...new Set(reviews.map((review) => String(review.commit_id).slice(0, 12)))],
    openFindings: open,
    codexThreads: threadView,
    codexFindings,
    codexAdmissible: { head: reviewedHead, ids: admissibleFindings.map((finding) => finding.id), ...(originUnknown ? { error: "GitHub did not report which commit a Codex thread reviewed" } : {}) },
    codexRequests: published,
    ...(codexCoverage ? { codexCoverage } : {}),
    solReview: { state: solState, rounds: rounds.length, max: solMax, ...(advanceNote ? { advanceNote } : {}), ...(exemption ? { exemption } : {}), ...(lastRound ? { lastRound } : {}), ...(solCoverage ? { coverage: solCoverage } : {}), ...(recordsError ? { error: recordsError } : {}) },
    lineage: lineage ?? { error: lineageError },
    requestedForHead: published.some((entry) => entry.sha === head),
    request: requestStatus,
  };
}

/** @param {ReturnType<typeof prReviewStatus>} result */
export function formatPrReviewStatus(result) {
  const lines = [`estado ${result.estado} | Codex ${result.codex} | revisión ${result.sol} (${result.reviewer === "fable" ? "Fable" : "Sol"}) | evidencia ${result.evidencia} | siguiente: ${result.siguiente}`];
  lines.push(`${result.pr} head ${result.head.slice(0, 12)}: Codex ${result.state}${result.headReviewed ? "" : " (head not reviewed by Codex)"}.`);
  if (result.reviewedCommits.length) lines.push(`Reviewed commits: ${result.reviewedCommits.join(", ")}`);
  for (const finding of result.openFindings) lines.push(`- ${finding.state}${finding.outdated ? " (outdated)" : ""} ${finding.id}: ${finding.path}: ${finding.finding} (${finding.detail})`);
  for (const thread of result.codexThreads.filter((entry) => entry.state !== "open" && entry.state !== "unverified")) lines.push(`- ${thread.state} ${thread.id}${thread.priority === null ? "" : ` P${thread.priority}`}${thread.critical ? " critical" : ""}: ${thread.detail}`);
  if (result.codexFindings.length) lines.push(`Codex finding ids: ${result.codexFindings.map((finding) => `${finding.id} (${finding.paths.join("+")} @ ${finding.origin.slice(0, 12) || "?"})`).join(", ")}`);
  const admissible = result.codexAdmissible;
  if (admissible.head || admissible.error) lines.push(`Codex ids admissible for coverage${admissible.head ? ` at ${admissible.head.slice(0, 12)}` : ""}: ${admissible.error ?? (admissible.ids.join(", ") || "none")}`);
  for (const entry of result.codexRequests) lines.push(`- request ${entry.createdAt} sha ${entry.sha.slice(0, 12) || "?"}: ${entry.state}`);
  /** @param {string} label @param {Coverage | undefined} cover */
  const coverageLines = (label, cover) => {
    if (!cover) return;
    lines.push(`${label} coverage ${cover.from.slice(0, 12)}..${cover.to.slice(0, 12)}: ${cover.covered ? "covered" : "not covered"} — ${cover.reason}.`);
    for (const commit of cover.commits) lines.push(`  - ${commit.sha.slice(0, 12)} ${commit.message}${commit.problem ? ` (${commit.problem})` : ""}`);
  };
  coverageLines("Codex", result.codexCoverage);
  const sol = result.solReview;
  lines.push(`Review (${result.reviewer === "fable" ? "Fable 5.2" : "Sol 6.1 High"}${result.reviewerReason ? `; ${result.reviewerReason}` : ""}): ${sol.state}${sol.lastRound ? ` (round ${sol.lastRound.round} ${sol.lastRound.scope} ${sol.lastRound.result} at ${sol.lastRound.head.slice(0, 12)})` : ""}${sol.exemption ? ` (${sol.exemption.exempt}: ${sol.exemption.reason})` : ""}${sol.error ? ` (${sol.error})` : ""}.`);
  coverageLines("Review", sol.coverage);
  const lineage = result.lineage;
  if ("error" in lineage) lines.push(`Lineage: unreadable (${lineage.error}).`);
  else {
    lines.push(`Lineage ${lineage.id}: PRs ${lineage.prs.map((number) => `#${number}`).join(", ")}; review slots used ${lineage.slotsUsed}/${lineage.budget}${lineage.lastRound ? `; last round ${lineage.lastRound.pr} ${lineage.lastRound.slot ? `slot ${lineage.lastRound.slot}` : `legacy round ${lineage.lastRound.round}`} ${lineage.lastRound.result}${lineage.lastRound.fixInduced ? " (fix-induced blocker)" : ""}` : ""}.`);
    for (const approval of lineage.approvalsUnused) lines.push(`  - unused owner approval ${approval.id} for slot ${approval.slot} (${approval.scope}) of ${approval.pr}`);
    for (const reservation of lineage.pending) lines.push(`  - reserved, unrecorded: slot ${reservation.slot} (${reservation.scope}) for ${reservation.pr}, reservation ${reservation.id}`);
  }
  if (result.request !== "not-requested") lines.push(`Request: ${result.request}.`);
  const evidence = result.behavioralEvidence;
  lines.push(`Behavioral evidence: ${evidence.state}${result.evidenceRequired ? "" : " (not required for this base)"} — ${evidence.reason}.`);
  lines.push(`Merge ready: ${result.mergeReady ? "yes" : "no"}.${result.mergeGate && result.mergeReady ? ` Merge pass: ${result.mergeGate}.` : ""}`);
  return lines.join("\n");
}
