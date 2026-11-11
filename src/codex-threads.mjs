// @ts-check
// Codex review threads for the review gate (2.13.0, plan A4): answered, not resolved. The gate no longer reads
// `isResolved` and nobody clicks Resolve. A thread is a finding; it stops blocking when the coordinator's reply
//   - cites a commit that belongs to the PR, comes after the commit Codex reviewed and touches the thread's file, or
//   - rejects it with a reason (`Rechazado: <razón>` / `Rejected: <reason>`).
// Answered is not corrected. A rejected thread that is P0 or P1 (Codex's own badge), carries no readable priority, or
// touches a critical domain whatever its priority, is closed only by a Sol round recorded after the rejection; until
// then it asks for that round. Only a rejected P2 or P3 outside the critical domains closes with its reason.
const APP_LOGIN = "chatgpt-codex-connector";

export const THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{isResolved isOutdated path comments(first:100){pageInfo{hasNextPage}nodes{databaseId createdAt author{__typename login}body originalCommit{oid}pullRequestReview{commit{oid}}}}}}}}}`;

/** @param {any} author GraphQL actor */
export const isCodexActor = (author) => author?.__typename === "Bot" && author?.login === APP_LOGIN;

/**
 * Every review thread whose first comment is from the Codex app, with `origin`: the commit its review read (the
 * review's commit, else the comment's original commit), or "" when GitHub does not say. Fails closed if a thread's
 * comments are truncated.
 * @param {(args: string[]) => string} gh @param {string} owner @param {string} repo @param {number} number
 */
export function codexThreads(gh, owner, repo, number) {
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

/** Codex's own priority badge (P0 to P3), or null when the comment carries none. @param {string} body */
export function threadPriority(body) {
  const match = /!\[P([0-3]) Badge\]|badge\/P([0-3])-|^\s*(?:\*\*)?\[?P([0-3])\]?\b/m.exec(body);
  return match ? Number(match[1] ?? match[2] ?? match[3]) : null;
}

// Words that put a thread in a critical domain whatever its priority. Broad on purpose: when in doubt, critical.
const DOMAIN = /\b(?:secur|vulnerab|inject|xss|csrf|ssrf|sanitiz|secret|access.?token|session|jwt|bearer|password|credential|api.?key|auth(?!or)|unauth|permission|privilege|role|rbac|acl\b|tenant|ownership|access control|payment|pago|charge|cobro|refund|reembolso|billing|invoice|factura|price|precio|money|dinero|stripe|mercado.?pago|checkout|subscription|suscripci|data.?loss|delet|borra|destroy|drop\s|truncate|migration|migraci|overwrit|irreversib|privacy|privacidad|minors\b|underage|child|menor(?:es)? de edad|niñ|consent|pii\b|personal data|datos personales)/i;

/** P0, P1, no readable priority, or a critical domain in its text or path. @param {{body: string, path: string}} thread */
export function threadCritical({ body, path }) {
  const priority = threadPriority(body);
  return priority === null || priority <= 1 || DOMAIN.test(body) || DOMAIN.test(path);
}

const REJECTION = /^\s*(?:\*\*)?(?:rechazad[oa]|rejected|no aplica|won'?t fix)(?:\*\*)?\s*[:.—-]\s*(\S[\s\S]{9,})/i;

/**
 * @typedef {{id: string, path: string, outdated: boolean, finding: string, priority: number | null, critical: boolean, state: "open" | "unverified" | "fixed" | "rejected" | "rejected-needs-sol", detail: string}} ThreadState
 */

/**
 * The state of every Codex thread. `commitInfo(sha)` resolves a cited (possibly abbreviated) SHA to a PR commit as
 * {sha, files, after(origin)} or null when the PR has no such commit; it may throw when GitHub cannot say, which
 * leaves the thread unverified. `solRoundsAt` are the times (ms) Sol rounds of the PR were recorded.
 * @param {{threads: any[], commitInfo: (cited: string) => {sha: string, files: string[], after: (origin: string) => boolean} | null, solRoundsAt: number[]}} input
 * @returns {ThreadState[]}
 */
export function threadStates({ threads, commitInfo, solRoundsAt }) {
  return threads.map((thread) => {
    const first = thread.comments.nodes[0];
    const body = String(first.body);
    const base = {
      id: `codex:${first.databaseId}`, path: String(thread.path), outdated: Boolean(thread.isOutdated),
      finding: body.replace(/<[^>]+>|!\[[^\]]*\]\([^)]*\)|\*\*/g, "").trim().split("\n")[0].slice(0, 160),
      priority: threadPriority(body), critical: threadCritical({ body, path: String(thread.path) }),
    };
    // Only a reply from a human account (GraphQL __typename "User") answers a thread; bots and deleted authors do not.
    const replies = thread.comments.nodes.slice(1).filter((/** @type {any} */ comment) => comment.author?.__typename === "User");
    if (replies.length === 0) return { ...base, state: /** @type {const} */ ("open"), detail: "no reply" };
    let detail = "the reply neither cites a fix commit of this PR nor rejects the finding with a reason";
    for (const reply of [...replies].reverse()) {
      const text = String(reply.body);
      if (REJECTION.test(text)) {
        if (!base.critical) return { ...base, state: /** @type {const} */ ("rejected"), detail: "rejected with a reason (P2/P3 outside the critical domains)" };
        const at = Date.parse(String(reply.createdAt));
        const read = Number.isFinite(at) && solRoundsAt.some((recorded) => recorded > at);
        return read
          ? { ...base, state: /** @type {const} */ ("rejected"), detail: "rejected with a reason; a Sol round recorded after the rejection read it" }
          : { ...base, state: /** @type {const} */ ("rejected-needs-sol"), detail: "rejected, but it is P0/P1, has no readable priority or touches a critical domain: Sol reads the rejection in the next round" };
      }
      for (const cited of new Set(text.match(/\b[0-9a-f]{7,40}\b/g) ?? [])) {
        try {
          const commit = commitInfo(cited);
          if (!commit) { detail = `${cited} is not a commit of this PR`; continue; }
          if (!thread.origin) { detail = "GitHub did not report which commit Codex reviewed"; continue; }
          if (!commit.after(thread.origin)) { detail = `${cited} is not later than the commit Codex reviewed (${thread.origin.slice(0, 12)})`; continue; }
          if (!commit.files.includes(base.path)) { detail = `${cited} does not touch ${base.path}`; continue; }
          return { ...base, state: /** @type {const} */ ("fixed"), detail: `answered with ${commit.sha.slice(0, 12)}` };
        } catch { detail = `GitHub could not read ${cited}`; }
      }
    }
    return { ...base, state: /** @type {const} */ ("unverified"), detail };
  });
}
