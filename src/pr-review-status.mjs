// @ts-check
// The review gate for one PR head: Codex (the chatgpt-codex-connector GitHub app), Sol review records
// (`src/review-records.mjs`) and, for a PR into develop, behavioral evidence (`src/evidence.mjs`). Codex reviews only
// when a PR is opened, marked ready, or asked with "@codex review", so later commits go unreviewed unless someone asks
// again. `--request` asks for the current head while fewer than two requests are published; it holds a local per-PR
// lock and re-reads GitHub inside it before posting, and never deletes a published request. `mergeReady` combines
// every gate and `--gate` records the merge pass the command guard requires for `gh pr merge --match-head-commit
// <head>`. Output always carries estado, Codex n/2, Sol n/max, evidencia and exactly one siguiente.
//
// Contract (plan 1.3), first match wins:
//   valid review of a SHA   a Codex app review with that commit_id and a real body (`Codex Review|Reviewed commit`), or a
//                           Codex app receipt or summary comment on this PR citing that SHA as completed
//   blocking finding        an unresolved Codex thread (always), or a resolved one without a human (User) reply
//   request state           answered (valid review of its SHA) > failed-terminal (an app comment after the request names a
//                           terminal cause: usage limit, quota, not enabled, no access, couldn't/unable to review; and it
//                           cites the request's SHA or is the first app reply before the next request) > running (summary
//                           shows its SHA running) > unknown (older than 6 h) > requested; `pending` = no request and no
//                           review for the head; unknown is never approval, never returns budget, never retries itself
//   budget                  per PR: every "@codex review" comment by a human (User) account counts, marked or typed by
//                           hand, retries included; with 2 published nothing is posted and siguiente is "decide el
//                           dueño" unless satisfied
//   budget-spent            2 published, the last answered by a valid review, no blocking finding
//   coverage (Codex, Sol)   each commit after the reviewed head cites `fixes: <id>` of that review (Codex: only threads
//                           the review of that head opened) and touches only those findings' paths (at most 20 commits;
//                           any API error fails closed), and a `fix-only` coverage record runs from the reviewed head to
//                           the current head; out-of-scope or missing -> uncovered
//   Sol                     records invalid or contradictory -> invalid; an exemption counts only for its exact head;
//                           approval needs the last round's result to be none or non-blocking, on the head or covered
//   mergeReady              Codex ok (no-findings, or budget-spent and covered) AND no blocking finding AND Sol ok AND
//                           develop evidence
import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { ACCEPTED_EVIDENCE, evaluateEvidence, readReceipts, writeMergeGate } from "./evidence.mjs";
import { readReviewRecords, requestLockPath, withFileLock } from "./review-records.mjs";

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
const OWNER_DECIDES = "decide el dueño";
const OUT_OF_SCOPE = "cambio fuera de alcance: sácalo a otro PR o decide el dueño";
const RETRY_READ = "GitHub no respondió completo: vuelve a correr pr-review-status; si persiste, decide el dueño";

/** @param {any} user REST user object */
const isCodexApp = (user) => user?.type === "Bot" && user?.login === `${APP_LOGIN}[bot]`;
/** @param {any} author GraphQL actor */
const isCodexActor = (author) => author?.__typename === "Bot" && author?.login === APP_LOGIN;
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

const THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{isResolved isOutdated path comments(first:100){pageInfo{hasNextPage}nodes{databaseId author{__typename login}body originalCommit{oid}pullRequestReview{commit{oid}}}}}}}}}`;

/**
 * Every review thread whose first comment is from the Codex app, with `origin`: the commit its review read (the
 * review's commit, else the comment's original commit), or "" when GitHub does not say. Fails closed if a thread's
 * comments are truncated.
 */
function codexThreads(/** @type {string} */ owner, /** @type {string} */ repo, /** @type {number} */ number) {
  /** @type {any[]} */
  const threads = [];
  let after = null;
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${THREADS_QUERY}`, "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `number=${number}`];
    if (after) args.push("-f", `after=${after}`);
    const page = JSON.parse(gh(args)).data.repository.pullRequest.reviewThreads;
    for (const thread of page.nodes) {
      if (thread.comments.pageInfo.hasNextPage) throw new Error(`A review thread on ${thread.path} has more than 100 comments; refusing to report a partial state`);
      const first = thread.comments.nodes[0];
      if (!isCodexActor(first?.author)) continue;
      const origin = String(first.pullRequestReview?.commit?.oid ?? first.originalCommit?.oid ?? "");
      threads.push({ ...thread, origin: /^[0-9a-f]{40}$/.test(origin) ? origin : "" });
    }
    if (!page.pageInfo.hasNextPage) return threads;
    after = page.pageInfo.endCursor;
  }
}

/** @param {any} file */
const changedFile = (file) => ({ filename: String(file.filename), status: String(file.status), ...(file.previous_filename ? { previous_filename: String(file.previous_filename) } : {}) });

/**
 * Files changed between a verified SHA and the head, or null when GitHub cannot list them completely.
 * @param {string} base @param {string} from @param {string} to
 */
function changedSince(base, from, to) {
  try {
    const compare = JSON.parse(gh(["api", `${base}/compare/${from}...${to}`]));
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
 * @typedef {{sha: string, message: string, fixes: string[], files: string[], problem?: string}} CoveredCommit
 * @typedef {{from: string, to: string, covered: boolean, error: boolean, filtersPass: boolean, reason: string, commits: CoveredCommit[]}} Coverage
 */

/**
 * The single coverage rule for Codex (budget-spent) and Sol: commits from the reviewed head to the current head.
 * @param {{base: string, from: string, to: string, findings: Finding[], records: any[]}} input @returns {Coverage}
 */
function coverage({ base, from, to, findings, records }) {
  /** @type {CoveredCommit[]} */
  const commits = [];
  /** @param {string} reason @param {boolean} [error] @returns {Coverage} */
  const uncovered = (reason, error = false) => ({ from, to, covered: false, error, filtersPass: false, reason, commits });
  /** @type {any} */
  let compare;
  try { compare = JSON.parse(gh(["api", `${base}/compare/${from}...${to}`])); } catch { return uncovered(`GitHub could not compare ${from.slice(0, 12)}...${to.slice(0, 12)}`, true); }
  if (compare.status !== "ahead") return uncovered(`the head is ${compare.status} of the reviewed head ${from.slice(0, 12)}, not ahead`);
  const total = Number(compare.total_commits);
  if (!(total > 0) || total > MAX_COVERAGE_COMMITS) return uncovered(`${total} commits after the reviewed head (limit ${MAX_COVERAGE_COMMITS})`);
  if (!Array.isArray(compare.commits) || compare.commits.length !== total) return uncovered("GitHub listed the commits after the reviewed head partially", true);
  const known = new Map(findings.map((finding) => [finding.id, finding.paths]));
  let filtersPass = true;
  for (const entry of compare.commits) {
    const sha = String(entry.sha);
    const message = String(entry.commit?.message ?? "");
    const fixes = [...message.matchAll(/^fixes:\s*(.+)$/gim)].flatMap((match) => match[1].split(/[\s,]+/)).filter(Boolean);
    /** @type {any} */
    let detail;
    try { detail = JSON.parse(gh(["api", `${base}/commits/${sha}`])); } catch { return uncovered(`GitHub could not list the files of ${sha.slice(0, 12)}`, true); }
    const files = Array.isArray(detail.files) ? detail.files : [];
    if (files.length >= 300) return uncovered(`GitHub listed the files of ${sha.slice(0, 12)} partially`, true);
    const names = files.flatMap((/** @type {any} */ file) => [String(file.filename), ...(file.previous_filename ? [String(file.previous_filename)] : [])]);
    const allowed = new Set(fixes.flatMap((id) => known.get(id) ?? []));
    const unknown = fixes.filter((id) => !known.has(id));
    const outside = names.filter((/** @type {string} */ name) => !allowed.has(name));
    /** @type {CoveredCommit} */
    const commit = { sha, message: message.split("\n")[0].slice(0, 120), fixes, files: names };
    if (fixes.length === 0) commit.problem = "no `fixes: <id>` line";
    else if (unknown.length) commit.problem = `cites ids that are not findings of that review: ${unknown.join(", ")}`;
    else if (outside.length) commit.problem = `touches files outside the cited findings: ${outside.slice(0, 5).join(", ")}`;
    if (commit.problem) filtersPass = false;
    commits.push(commit);
  }
  if (!filtersPass) return { ...uncovered("a commit after the reviewed head is not a cited fix of its findings"), commits };
  const forHead = records.filter((record) => record.type === "coverage" && record.to === to);
  if (forHead.some((record) => record.verdict === "out-of-scope")) return { ...uncovered(`a coverage record for ${to.slice(0, 12)} says out-of-scope`), filtersPass, commits };
  const cited = [...new Set(commits.flatMap((commit) => commit.fixes))];
  const record = forHead.find((candidate) => candidate.verdict === "fix-only" && candidate.from === from && cited.every((id) => candidate.findings.includes(id)));
  if (!record) return { ...uncovered(`no fix-only coverage record from ${from.slice(0, 12)} to ${to.slice(0, 12)} naming ${cited.join(", ")}`), filtersPass, commits };
  return { from, to, covered: true, error: false, filtersPass, reason: `fix-only coverage recorded: ${record.note}`, commits };
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
  const threads = codexThreads(owner, repo, number);
  /** @type {(Finding & {origin: string})[]} */
  const codexFindings = threads.map((thread) => ({ id: `codex:${thread.comments.nodes[0].databaseId}`, paths: [String(thread.path)], origin: String(thread.origin) }));
  const open = threads.filter((thread) => !thread.isResolved).map((thread) => ({
    id: `codex:${thread.comments.nodes[0].databaseId}`,
    path: thread.path,
    outdated: thread.isOutdated,
    finding: String(thread.comments.nodes[0].body).replace(/<[^>]+>|!\[[^\]]*\]\([^)]*\)|\*\*/g, "").trim().split("\n")[0].slice(0, 160),
  }));
  // Clicking Resolve is not a fix: a resolved Codex thread with no human reply still counts as a finding.
  // Only a reply from a human account (GraphQL __typename "User") answers a finding; bots and
  // deleted or unknown authors do not.
  const silentlyResolved = threads.filter((thread) => thread.isResolved && !thread.comments.nodes.slice(1).some((/** @type {any} */ comment) => comment.author?.__typename === "User"));
  const resolvedWithoutReply = silentlyResolved.length;
  const blockingIds = [...open.map((finding) => finding.id), ...silentlyResolved.map((thread) => `codex:${thread.comments.nodes[0].databaseId}`)];
  /** One read of Codex reviews and PR comments and everything derived from it; `--request` repeats it under its lock. */
  const observe = () => {
    // Only a real Codex review counts: a reply inside a review thread also creates an empty
    // review on the head, which must not mark the head as reviewed.
    const reviews = ghList(`${base}/pulls/${number}/reviews`).filter((review) => isCodexApp(review.user) && /Codex Review|Reviewed commit/.test(String(review.body)));
    const comments = ghList(`${base}/issues/${number}/comments`);
    const appComments = comments.filter((comment) => isCodexApp(comment.user)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    const summaries = summaryStates(appComments);
    // A receipt is the app's own "Reviewed commit" comment when a review ends without inline findings.
    const receipts = appComments.filter((comment) => String(comment.body).includes("codex-review-receipt:v1"))
      .map((comment) => /Reviewed commit:?\**:?\s*`([0-9a-f]{7,40})`/.exec(String(comment.body))?.[1]).filter((sha) => typeof sha === "string");
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
        const sha = new RegExp(`${REQUEST_MARKER} sha=([0-9a-f]{40})`).exec(String(comment.body))?.[1] ?? "";
        const at = Date.parse(comment.created_at);
        const next = index + 1 < all.length ? Date.parse(all[index + 1].created_at) : Infinity;
        const after = replies.filter((reply) => Date.parse(reply.created_at) > at);
        const first = after[0];
        // A terminal app reply ends this request only if it names the request's SHA or is the first app reply to it.
        const terminal = after.some((reply) => {
          const body = String(reply.body);
          if (body.includes("codex-review-receipt:v1") || !TERMINAL.test(body)) return false;
          const namesSha = sha !== "" && [...body.matchAll(/\b[0-9a-f]{7,40}\b/g)].some((match) => cites(sha, match[0]));
          return namesSha || (reply === first && Date.parse(reply.created_at) < next);
        });
        /** @type {"answered" | "failed-terminal" | "running" | "unknown" | "requested"} */
        let state;
        if (validReview(sha)) state = "answered";
        else if (terminal) state = "failed-terminal";
        else if (sha && summaries.some((summary) => cites(sha, summary.sha) && RUNNING.test(summary.status))) state = "running";
        else if (now - at > UNKNOWN_HOURS * 3_600_000) state = "unknown";
        else state = "requested";
        return { id: Number(comment.id), sha, createdAt: String(comment.created_at), state };
      });
    const headRequest = published.filter((entry) => entry.sha === head).at(-1);
    /** @type {"pending" | "requested" | "running" | "answered" | "failed-terminal" | "unknown"} */
    let headState = "pending";
    if (headReviewed) headState = "answered";
    else if (headRequest) headState = headRequest.state;
    else if (summaries.some((summary) => cites(head, summary.sha) && RUNNING.test(summary.status))) headState = "running";
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
    // Review budget: never post past two published requests; the owner decides.
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
  // Coverage after budget-spent admits only the threads the review of that head opened.
  const reviewedHead = budgetSpent && last ? last.sha : headReviewed ? head : "";
  const originUnknown = codexFindings.some((finding) => finding.origin === "");
  const admissibleFindings = originUnknown ? [] : codexFindings.filter((finding) => reviewedHead !== "" && finding.origin === reviewedHead);
  // Sol: rounds, exemption and coverage records written by the coordinator; invalid or contradictory records fail closed.
  /** @type {import("./review-records.mjs").ReviewRecord[]} */
  let records = [];
  let recordsError = "";
  try { records = readReviewRecords(home, prKey); } catch (error) { recordsError = error instanceof Error ? error.message : String(error); }
  const rounds = /** @type {import("./review-records.mjs").RoundRecord[]} */ (records.filter((record) => record.type === "round"));
  // A later exemption replaces an earlier one; it counts only for the exact head it names.
  const exemption = /** @type {import("./review-records.mjs").ExemptionRecord | undefined} */ (records.filter((record) => record.type === "exemption").at(-1));
  const solMax = rounds[0]?.result === "blocking" ? 2 : 1;
  const lastRound = rounds.at(-1);
  /** @type {Coverage | null} */
  let codexCoverage = null;
  if (budgetSpent && last) {
    codexCoverage = originUnknown
      ? { from: last.sha, to: head, covered: false, error: true, filtersPass: false, reason: "GitHub did not report which commit a Codex thread reviewed", commits: [] }
      : coverage({ base, from: last.sha, to: head, findings: admissibleFindings, records });
  }
  /** @type {Coverage | null} */
  let solCoverage = null;
  /** @type {"invalid" | "exempt" | "exemption-stale" | "missing" | "blocking" | "approved" | "covered" | "not-covered"} */
  let solState;
  if (recordsError || (exemption && rounds.length)) solState = "invalid";
  else if (exemption) solState = exemption.head === head ? "exempt" : "exemption-stale";
  else if (!lastRound) solState = "missing";
  else if (lastRound.result === "blocking") solState = "blocking";
  // Approval needs an explicit none or non-blocking result; anything else is invalid.
  else if (lastRound.result !== "none" && lastRound.result !== "non-blocking") solState = "invalid";
  else if (lastRound.head === head) solState = "approved";
  else {
    solCoverage = coverage({ base, from: lastRound.head, to: head, findings: lastRound.findings, records });
    solState = solCoverage.covered ? "covered" : "not-covered";
  }
  const solOk = solState === "exempt" || solState === "approved" || solState === "covered";
  const ok = state === "no-findings" || (state === "budget-spent" && codexCoverage?.covered === true);
  const baseRef = String(pull.base?.ref ?? "");
  const evidenceReceipts = readReceipts(home, prKey);
  const latest = evidenceReceipts.at(-1)?.receipt;
  const behavioralEvidence = evaluateEvidence({
    receipts: evidenceReceipts, head, prBody: String(pull.body ?? ""),
    changedFiles: latest && latest.verifiedSha !== head && ["ok", "nonvisual"].includes(latest.status) ? changedSince(base, latest.verifiedSha, head) : undefined,
    prFiles: latest ? undefined : pullFiles(base, number, Number(pull.changed_files)),
  });
  // Evidence is a develop-merge gate; main, releases and production wait for the owner regardless.
  const evidenceRequired = baseRef === "develop";
  const evidenceOk = !evidenceRequired || ACCEPTED_EVIDENCE.has(behavioralEvidence.state);
  const mergeReady = ok && blockingIds.length === 0 && solOk && evidenceOk;
  // Contradictory or partial data (records that cannot be read or conflict, a GitHub read that failed) is `unknown`.
  const contradictory = solState === "invalid" || codexCoverage?.error === true || solCoverage?.error === true;
  const estado = contradictory ? "unknown" : headState;
  let mergeGate = null;
  if (gate) {
    const { path, ...pass } = writeMergeGate({ home, pr: prKey, head, base: baseRef, mergeReady, codex: state, behavioralEvidence: behavioralEvidence.state });
    // The pass also names the Sol state; same file, same permissions.
    writeFileSync(path, `${JSON.stringify({ ...pass, sol: solState }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(path, 0o600);
    mergeGate = path;
  }
  const short = head.slice(0, 12);
  /** The single next action, first unmet gate first. */
  let siguiente;
  if (blockingIds.length) siguiente = `atiende los hallazgos de Codex: corrige o responde por escrito cada hilo y resuélvelo (${blockingIds.slice(0, 5).join(", ")}${blockingIds.length > 5 ? ", …" : ""})`;
  else if (!ok && codexCoverage) siguiente = codexCoverage.error ? RETRY_READ : OUT_OF_SCOPE;
  else if (!ok && (headState === "requested" || headState === "running")) siguiente = `espera la revisión de Codex del head ${short}; vuelve a correr pr-review-status sin --request`;
  else if (!ok && published.length >= BUDGET) siguiente = OWNER_DECIDES;
  else if (!ok) siguiente = `pide la revisión de Codex del head ${short}: development-system pr-review-status ${prKey} --request`;
  else if (solState === "invalid") siguiente = "registros de Sol inválidos: decide el dueño";
  else if (solState === "exemption-stale") siguiente = `la exención de Sol es del head ${exemption?.head.slice(0, 12)}, no del ${short}: si sigue aplicando regístrala para este head (development-system review record --pr ${prKey} --reviewer sol --head ${head} --exempt <docs-only|low-risk> --reason <motivo>); si no, decide el dueño`;
  else if (solState === "missing") siguiente = `pide la revisión full de Sol 6.1 High del head ${short} y regístrala: development-system review record --pr ${prKey} --reviewer sol --head ${head} --scope full --result <blocking|non-blocking|none> --thread <hilo>`;
  else if (solState === "blocking") siguiente = rounds.length >= 2 ? OWNER_DECIDES : `corrige los hallazgos bloqueantes de Sol y pide la ronda fix-diff; regístrala con development-system review record --scope fix-diff`;
  else if (solState === "not-covered") siguiente = solCoverage?.error ? RETRY_READ : OUT_OF_SCOPE;
  else if (!evidenceOk) siguiente = `graba la evidencia de comportamiento del head ${short} con development-system evidence record, o cita la exención del dueño`;
  else if (!mergeGate) siguiente = `corre development-system pr-review-status ${prKey} --gate y fusiona con --match-head-commit ${head}`;
  else siguiente = `fusiona: gh pr merge ${number} -R ${owner}/${repo} --match-head-commit ${head}`;
  return {
    ok,
    operation: "pr-review-status",
    pr: prKey,
    head,
    base: baseRef,
    estado,
    codex: `${published.length}/${BUDGET}`,
    sol: `${rounds.length}/${solMax}${exemption ? ` (exempt ${exemption.exempt})` : ""}`,
    evidencia: `${behavioralEvidence.state}${evidenceRequired ? "" : " (not required)"}`,
    siguiente,
    state,
    behavioralEvidence,
    evidenceRequired,
    mergeReady,
    ...(mergeGate ? { mergeGate } : {}),
    headReviewed,
    reviewedCommits: [...new Set(reviews.map((review) => String(review.commit_id).slice(0, 12)))],
    openFindings: open,
    resolvedWithoutReply,
    codexFindings,
    codexAdmissible: { head: reviewedHead, ids: admissibleFindings.map((finding) => finding.id), ...(originUnknown ? { error: "GitHub did not report which commit a Codex thread reviewed" } : {}) },
    codexRequests: published,
    ...(codexCoverage ? { codexCoverage } : {}),
    solReview: { state: solState, rounds: rounds.length, max: solMax, ...(exemption ? { exemption } : {}), ...(lastRound ? { lastRound } : {}), ...(solCoverage ? { coverage: solCoverage } : {}), ...(recordsError ? { error: recordsError } : {}) },
    requestedForHead: published.some((entry) => entry.sha === head),
    request: requestStatus,
  };
}

/** @param {ReturnType<typeof prReviewStatus>} result */
export function formatPrReviewStatus(result) {
  const lines = [`estado ${result.estado} | Codex ${result.codex} | Sol ${result.sol} | evidencia ${result.evidencia} | siguiente: ${result.siguiente}`];
  lines.push(`${result.pr} head ${result.head.slice(0, 12)}: Codex ${result.state}${result.headReviewed ? "" : " (head not reviewed by Codex)"}.`);
  if (result.reviewedCommits.length) lines.push(`Reviewed commits: ${result.reviewedCommits.join(", ")}`);
  for (const finding of result.openFindings) lines.push(`- open${finding.outdated ? " (outdated)" : ""} ${finding.id}: ${finding.path}: ${finding.finding}`);
  if (result.resolvedWithoutReply) lines.push(`${result.resolvedWithoutReply} Codex thread(s) resolved without a written reply; resolving is not a fix.`);
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
  lines.push(`Sol: ${sol.state}${sol.lastRound ? ` (round ${sol.lastRound.round} ${sol.lastRound.scope} ${sol.lastRound.result} at ${sol.lastRound.head.slice(0, 12)})` : ""}${sol.exemption ? ` (${sol.exemption.exempt}: ${sol.exemption.reason})` : ""}${sol.error ? ` (${sol.error})` : ""}.`);
  coverageLines("Sol", sol.coverage);
  if (result.request !== "not-requested") lines.push(`Request: ${result.request}.`);
  const evidence = result.behavioralEvidence;
  lines.push(`Behavioral evidence: ${evidence.state}${result.evidenceRequired ? "" : " (not required for this base)"} — ${evidence.reason}.`);
  lines.push(`Merge ready: ${result.mergeReady ? "yes" : "no"}.${result.mergeGate && result.mergeReady ? ` Merge pass: ${result.mergeGate}.` : ""}`);
  return lines.join("\n");
}
