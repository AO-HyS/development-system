// @ts-check
// Whether a PR's current head has a clean Codex review (the chatgpt-codex-connector GitHub app).
// Codex reviews only when a PR is opened, marked ready, or asked with "@codex review", so commits
// pushed afterwards go unreviewed unless someone asks again. Integration requires `no-findings`
// for the exact head SHA. `--request` asks once per (repository, PR, head SHA).
import { execFileSync } from "node:child_process";

const BOT = /^chatgpt-codex-connector/;
const REQUEST_MARKER = "ds-codex-review-request";

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

/** @param {string} path @returns {any} */
const ghJson = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

/**
 * @param {{pr: string, request?: boolean, home?: string}} options
 */
export function prReviewStatus({ pr, request = false }) {
  const { owner, repo, number } = parsePr(pr);
  const base = `repos/${owner}/${repo}`;
  const pull = JSON.parse(gh(["api", `${base}/pulls/${number}`]));
  const head = String(pull.head.sha);
  const reviews = ghJson(`${base}/pulls/${number}/reviews`).filter((/** @type {any} */ review) => BOT.test(review.user?.login ?? ""));
  const issueComments = ghJson(`${base}/issues/${number}/comments`);
  const reactions = ghJson(`${base}/issues/${number}/reactions`).filter((/** @type {any} */ reaction) => BOT.test(reaction.user?.login ?? ""));
  const summary = issueComments.filter((/** @type {any} */ comment) => BOT.test(comment.user?.login ?? "") && String(comment.body).includes("codex-pull-request-review-summary")).pop();
  const summaryRow = summary ? /\|\s*📝[^|]*\|\s*([^|]+)\|\s*`([0-9a-f]{7,40})`/.exec(String(summary.body)) : null;
  const summaryState = summaryRow ? summaryRow[1] : "";
  const summarySha = summaryRow ? summaryRow[2] : null;
  const threads = JSON.parse(gh(["api", "graphql", "-f", `query=query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated path comments(first:20){nodes{author{login} body}}}}}}}`, "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `number=${number}`]))
    .data.repository.pullRequest.reviewThreads.nodes.filter((/** @type {any} */ thread) => BOT.test(thread.comments.nodes[0]?.author?.login ?? ""));
  const open = threads.filter((/** @type {any} */ thread) => !thread.isResolved).map((/** @type {any} */ thread) => ({ path: thread.path, outdated: thread.isOutdated, finding: String(thread.comments.nodes[0].body).replace(/<[^>]+>|!\[[^\]]*\]\([^)]*\)|\*\*/g, "").trim().split("\n")[0].slice(0, 160) }));
  const resolvedWithoutReply = threads.filter((/** @type {any} */ thread) => thread.isResolved && !thread.comments.nodes.slice(1).some((/** @type {any} */ comment) => !BOT.test(comment.author?.login ?? ""))).length;
  const reviewedHead = reviews.some((/** @type {any} */ review) => review.commit_id === head) || (summarySha !== null && head.startsWith(summarySha) && /Completed/i.test(summaryState));
  const running = /running|progress|queued/i.test(summaryState) || reactions.some((/** @type {any} */ reaction) => reaction.content === "eyes");
  const usageProblem = issueComments.some((/** @type {any} */ comment) => BOT.test(comment.user?.login ?? "") && /usage limit|quota|not enabled|no access/i.test(String(comment.body)));
  /** @type {"no-findings" | "findings" | "running" | "pending" | "unavailable"} */
  let state;
  if (open.length > 0) state = "findings";
  else if (reviewedHead) state = "no-findings";
  else if (running) state = "running";
  else if (usageProblem) state = "unavailable";
  else state = "pending";
  const requested = issueComments.some((/** @type {any} */ comment) => String(comment.body).includes(`${REQUEST_MARKER} sha=${head}`));
  let requestStatus = "not-requested";
  if (request) {
    if (state !== "pending") requestStatus = `skipped-${state}`;
    else if (requested) requestStatus = "already-requested-for-head";
    else {
      gh(["api", `${base}/issues/${number}/comments`, "-f", `body=@codex review\n\n<!-- ${REQUEST_MARKER} sha=${head} -->`]);
      requestStatus = "requested";
    }
  }
  return {
    ok: state === "no-findings",
    operation: "pr-review-status",
    pr: `${owner}/${repo}#${number}`,
    head,
    state,
    reviewedCommits: [...new Set(reviews.map((/** @type {any} */ review) => String(review.commit_id).slice(0, 12)))],
    openFindings: open,
    resolvedWithoutReply,
    requestedForHead: requested || requestStatus === "requested",
    request: requestStatus,
  };
}

/** @param {ReturnType<typeof prReviewStatus>} result */
export function formatPrReviewStatus(result) {
  const lines = [`${result.pr} head ${result.head.slice(0, 12)}: Codex ${result.state}.`];
  if (result.reviewedCommits.length) lines.push(`Reviewed commits: ${result.reviewedCommits.join(", ")}`);
  for (const finding of result.openFindings) lines.push(`- open${finding.outdated ? " (outdated)" : ""}: ${finding.path}: ${finding.finding}`);
  if (result.resolvedWithoutReply) lines.push(`${result.resolvedWithoutReply} Codex thread(s) resolved without a written reply; resolving is not a fix.`);
  if (result.request !== "not-requested") lines.push(`Request: ${result.request}.`);
  if (result.state === "pending" && result.request === "not-requested") lines.push("Run again with --request to ask Codex to review this head.");
  return lines.join("\n");
}
