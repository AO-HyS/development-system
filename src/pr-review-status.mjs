// @ts-check
// Whether a PR's current head has a clean Codex review (the chatgpt-codex-connector GitHub app).
// Codex reviews only when a PR is opened, marked ready, or asked with "@codex review", so commits
// pushed afterwards go unreviewed unless someone asks again. Integration requires `no-findings`
// (the exact head reviewed by the Codex app and no unresolved Codex thread) or `budget-spent`
// (both allowed requests used and every finding of the last reviewed head answered). `--request` asks once
// per (repository, PR, head SHA); concurrent duplicates are deleted on GitHub, earliest kept.
import { execFileSync } from "node:child_process";

// The Codex GitHub app: REST reports its login with the [bot] suffix and type "Bot"; GraphQL
// reports the bare login with __typename "Bot". A user account can never have either shape.
const APP_LOGIN = "chatgpt-codex-connector";
const REQUEST_MARKER = "ds-codex-review-request";

/** @param {any} user REST user object */
const isCodexApp = (user) => user?.type === "Bot" && user?.login === `${APP_LOGIN}[bot]`;
/** @param {any} author GraphQL actor */
const isCodexActor = (author) => author?.__typename === "Bot" && author?.login === APP_LOGIN;

/** @param {string} pr */
function parsePr(pr) {
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

const THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{isResolved isOutdated path comments(first:100){pageInfo{hasNextPage}nodes{author{__typename login}body}}}}}}}`;

/** Every review thread whose first comment is from the Codex app; fails closed if a thread's comments are truncated. */
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
      if (isCodexActor(thread.comments.nodes[0]?.author)) threads.push(thread);
    }
    if (!page.pageInfo.hasNextPage) return threads;
    after = page.pageInfo.endCursor;
  }
}

/**
 * @param {{pr: string, request?: boolean}} options
 */
export function prReviewStatus({ pr, request = false }) {
  const { owner, repo, number } = parsePr(pr);
  const base = `repos/${owner}/${repo}`;
  const pull = JSON.parse(gh(["api", `${base}/pulls/${number}`]));
  const head = String(pull.head.sha);
  // Only a real Codex review counts: a reply inside a review thread also creates an empty
  // review on the head, which must not mark the head as reviewed.
  const reviews = ghList(`${base}/pulls/${number}/reviews`).filter((review) => isCodexApp(review.user) && /Codex Review|Reviewed commit/.test(String(review.body)));
  const read = () => ghList(`${base}/issues/${number}/comments`);
  // Request markers count only on comments the authenticated account posted as a real request;
  // anyone else can paste the marker text.
  const viewer = String(JSON.parse(gh(["api", "user"])).login);
  const ownRequest = (/** @type {any} */ comment) => comment.user?.login === viewer && String(comment.body).startsWith("@codex review") && String(comment.body).includes(`${REQUEST_MARKER} sha=${head}`);
  const comments = read();
  const appComments = comments.filter((comment) => isCodexApp(comment.user));
  const summary = appComments.filter((comment) => String(comment.body).includes("codex-pull-request-review-summary")).pop();
  const summaryRow = summary ? /\|\s*📝[^|]*\|\s*([^|]+)\|\s*`([0-9a-f]{7,40})`/.exec(String(summary.body)) : null;
  const summaryForHead = summaryRow !== null && head.startsWith(summaryRow[2]);
  const threads = codexThreads(owner, repo, number);
  const open = threads.filter((thread) => !thread.isResolved).map((thread) => ({
    path: thread.path,
    outdated: thread.isOutdated,
    finding: String(thread.comments.nodes[0].body).replace(/<[^>]+>|!\[[^\]]*\]\([^)]*\)|\*\*/g, "").trim().split("\n")[0].slice(0, 160),
  }));
  // Clicking Resolve is not a fix: a resolved Codex thread with no human reply still counts as a finding.
  // Only a reply from a human account (GraphQL __typename "User") answers a finding; bots and
  // deleted or unknown authors do not.
  const silentlyResolved = threads.filter((thread) => thread.isResolved && !thread.comments.nodes.slice(1).some((/** @type {any} */ comment) => comment.author?.__typename === "User"));
  const resolvedWithoutReply = silentlyResolved.length;
  const headReviewed = reviews.some((review) => review.commit_id === head) || (summaryForHead && /Completed/i.test(summaryRow?.[1] ?? ""));
  const runningForHead = summaryForHead && /running|progress|queued/i.test(summaryRow?.[1] ?? "");
  // A usage or access error counts only as an answer to our own request for this exact head;
  // anything else stays pending so a new head can always be asked.
  const ourRequest = Math.max(0, ...comments.filter(ownRequest).map((comment) => Date.parse(comment.created_at)));
  const unavailable = ourRequest > 0 && appComments.some((comment) => Date.parse(comment.created_at) > ourRequest && /usage limit|quota|not enabled|no access/i.test(String(comment.body)));
  const requestedForHead = (/** @type {any[]} */ list) => list.some(ownRequest);
  // Review budget: Codex is asked at most twice per PR. Once both requests are spent and an
  // earlier head was reviewed with every finding answered, later fix commits need no third request.
  const requestedShas = comments.filter((comment) => comment.user?.login === viewer && String(comment.body).startsWith("@codex review") && String(comment.body).includes(REQUEST_MARKER))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((comment) => /sha=([0-9a-f]{40})/.exec(String(comment.body))?.[1]).filter(Boolean);
  // The last request must already be answered by a real review, so a pending second review never counts.
  const lastRequested = requestedShas.at(-1);
  const budgetSpent = !headReviewed && new Set(requestedShas).size >= 2 && reviews.some((review) => review.commit_id === lastRequested) && open.length === 0 && resolvedWithoutReply === 0;
  /** @type {"no-findings" | "findings" | "budget-spent" | "running" | "pending" | "unavailable"} */
  let state;
  if (headReviewed) state = open.length > 0 || resolvedWithoutReply > 0 ? "findings" : "no-findings";
  else if (budgetSpent) state = "budget-spent";
  else if (runningForHead) state = "running";
  else if (unavailable) state = "unavailable";
  else state = "pending";
  let requestStatus = "not-requested";
  if (request) {
    if (state !== "pending") requestStatus = `skipped-${state}`;
    else if (requestedForHead(comments)) requestStatus = "already-requested-for-head";
    else {
      // Post, then settle duplicates on GitHub itself: if concurrent runs both asked for this head,
      // every request but the earliest is deleted, so exactly one remains. No local lock to strand.
      const posted = JSON.parse(gh(["api", `${base}/issues/${number}/comments`, "-f", `body=@codex review\n\n<!-- ${REQUEST_MARKER} sha=${head} -->`]));
      const forHead = read().filter(ownRequest).sort((a, b) => a.id - b.id);
      if (forHead.length > 0 && forHead[0].id !== posted.id) {
        gh(["api", "-X", "DELETE", `${base}/issues/comments/${posted.id}`]);
        requestStatus = "already-requested-for-head";
      } else requestStatus = "requested";
    }
  }
  return {
    ok: state === "no-findings" || state === "budget-spent",
    operation: "pr-review-status",
    pr: `${owner}/${repo}#${number}`,
    head,
    state,
    headReviewed,
    reviewedCommits: [...new Set(reviews.map((review) => String(review.commit_id).slice(0, 12)))],
    openFindings: open,
    resolvedWithoutReply,
    requestedForHead: requestedForHead(comments) || requestStatus === "requested",
    request: requestStatus,
  };
}

/** @param {ReturnType<typeof prReviewStatus>} result */
export function formatPrReviewStatus(result) {
  const lines = [`${result.pr} head ${result.head.slice(0, 12)}: Codex ${result.state}${result.headReviewed ? "" : " (head not reviewed by Codex)"}.`];
  if (result.reviewedCommits.length) lines.push(`Reviewed commits: ${result.reviewedCommits.join(", ")}`);
  for (const finding of result.openFindings) lines.push(`- open${finding.outdated ? " (outdated)" : ""}: ${finding.path}: ${finding.finding}`);
  if (result.resolvedWithoutReply) lines.push(`${result.resolvedWithoutReply} Codex thread(s) resolved without a written reply: answer each one (fixed in <sha>, or why it does not apply); resolving is not a fix.`);
  if (result.state === "budget-spent") lines.push(`Both Codex requests are spent and the last reviewed head (${result.reviewedCommits.at(-1)}) has every finding answered; the commits after it must only fix those findings. Name them in the report.`);
  if (result.request !== "not-requested") lines.push(`Request: ${result.request}.`);
  if (result.state === "pending" && result.request === "not-requested") lines.push("Run again with --request to ask Codex to review this head.");
  return lines.join("\n");
}
