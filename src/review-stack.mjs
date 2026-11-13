// @ts-check
// Whether a PR leads to develop (2.14.3).
//
// A PR into develop is reviewed and advanced without the owner (2.13.0). A PR stacked on another open PR used to be
// read as "not develop", so the gate sent it to the owner as if it were a production merge (frictions
// stacked-pr-review-coverage and the Barber stack of 2026-11-13: develop <- #694 <- #699 <- #701). Its merge lands in
// a task branch; it still needs its own behavioral evidence, because GitHub retargets it to develop with the same head
// when the PR below merges.
import { execFileSync } from "node:child_process";

const MAX_STACK = 10;
// Never a step of a stack, whatever open PR starts from them (a back-merge of main into develop has main as its head).
const PRODUCTION = new Set(["main", "master", "production", "prod", "release"]);

/**
 * True only for a base that is positively production: one of the names above, or the repository's default branch when
 * it is not develop. Behavioral evidence is skipped only there (its merge is the owner's production stop); a base the
 * stack lookup could not resolve is not production, so it fails closed.
 * @param {string} ref @param {string} [defaultBranch]
 */
export const productionBase = (ref, defaultBranch = "") => PRODUCTION.has(ref) || (ref !== "develop" && ref !== "" && ref === defaultBranch);

/** @param {string[]} args */
function ghApi(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * True when `baseRef` is develop, or the head branch of exactly one open PR of the same repository whose own base
 * leads to develop, at most ten PRs deep. A production branch, the repository's default branch (unless it is develop),
 * a branch that two open PRs start from, a loop and anything GitHub cannot answer are not toward develop: the caller
 * then keeps the owner's route.
 * @param {{owner: string, repo: string, baseRef: string, defaultBranch?: string, gh?: (args: string[]) => string}} input
 */
export function towardDevelop({ owner, repo, baseRef, defaultBranch = "", gh = ghApi }) {
  const repository = `${owner}/${repo}`.toLowerCase();
  const seen = new Set();
  let ref = baseRef;
  for (let depth = 0; depth <= MAX_STACK; depth += 1) {
    if (ref === "develop") return true;
    if (!owner || !repo || !ref || seen.has(ref) || productionBase(ref, defaultBranch)) return false;
    seen.add(ref);
    /** @type {any} */
    let pulls;
    try { pulls = JSON.parse(gh(["api", "-X", "GET", `repos/${owner}/${repo}/pulls`, "-f", "state=open", "-f", `head=${owner}:${ref}`, "-f", "per_page=100"])); } catch { return false; }
    const below = Array.isArray(pulls) ? pulls.filter((pull) => pull?.head?.ref === ref && String(pull?.head?.repo?.full_name ?? "").toLowerCase() === repository) : [];
    if (below.length !== 1) return false;
    ref = String(below[0].base?.ref ?? "");
  }
  return false;
}
