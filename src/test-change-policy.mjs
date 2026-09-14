import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Test edits are closed by default; a reviewed exception authorizes exact bytes.
 * @param {{root?: string, baseRef?: string, policyPath?: string}} options
 * @returns {Array<{file: string, line: number, rule: string, message: string}>}
 */
export function findTestPolicyViolations({
  root = process.cwd(),
  baseRef = process.env.QUALITY_BASE_REF || "origin/develop",
  policyPath = "config/test-change-policy.json",
} = {}) {
  /** @param {string} file @param {string} message */
  const violation = (file, message) => ({ file, line: 1, rule: "test-change-policy", message });
  try {
    const repository = resolve(root);
    const policyFile = resolve(repository, policyPath);
    const policyRelative = relative(repository, policyFile);
    if (policyRelative === ".." || policyRelative.startsWith(`..${sep}`) || isAbsolute(policyRelative)) {
      throw new Error("Policy must be a repository-local file.");
    }
    const policy = JSON.parse(readFileSync(policyFile, "utf8"));
    if (policy.schemaVersion !== 1 || !Array.isArray(policy.allowedChanges)) {
      throw new Error("Expected schemaVersion: 1 and allowedChanges: [].");
    }
    const allowed = new Map();
    for (const entry of policy.allowedChanges) {
      if (!entry || typeof entry.path !== "string" || !entry.path || entry.path.includes("\\") ||
          isAbsolute(entry.path) || entry.path.split("/").some((/** @type {string} */ part) => !part || part === "." || part === "..") ||
          !(entry.sha256 === null || (typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sha256))) ||
          typeof entry.reason !== "string" || !entry.reason.trim() ||
          typeof entry.issue !== "string" || !entry.issue.trim() || allowed.has(entry.path)) {
        throw new Error("Each exception needs a unique relative path, sha256 (null for deletion), reason and issue.");
      }
      allowed.set(entry.path, entry);
    }

    /** @param {...string} args */
    const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
    // Resolve a commit before interpolation; a missing comparison base is an error.
    const base = git("rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`).trim();
    const staged = new Set(git("diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--").split("\0").filter(Boolean));
    const stagedDeleted = new Set(git("diff", "--cached", "--name-only", "--no-renames", "--diff-filter=D", "-z", "HEAD", "--").split("\0").filter(Boolean));
    const changed = new Set([
      ...git("diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`, "--").split("\0"),
      ...git("diff", "--name-only", "--no-renames", "-z", "HEAD", "--").split("\0"),
      ...staged,
      ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
    ].filter(Boolean));
    /** @param {string} path */
    const isTestPath = (path) => /(?:^|\/)(?:__tests__|tests?|e2e)\//.test(path) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || /\.snap$/.test(path);
    const violations = [];
    for (const file of [...changed].filter(isTestPath).sort()) {
      const target = resolve(repository, file);
      const entry = allowed.get(file);
      if (!entry) {
        violations.push(violation(file, "Test changes are closed for this task. Reuse the selected checks. Return any missing behavioral guarantee to the orchestrator; a reviewed exception must name the issue, reason and exact content hash in config/test-change-policy.json."));
        continue;
      }
      const stat = lstatSync(target, { throwIfNoEntry: false });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
        violations.push(violation(file, "A test exception must target a regular repository file."));
        continue;
      }
      const digest = existsSync(target) ? createHash("sha256").update(readFileSync(target)).digest("hex") : null;
      if (digest !== entry.sha256) {
        violations.push(violation(file, "Test content differs from the reviewed exception. Additions inside an existing file, deletions and weakened assertions require the same explicit review; do not regenerate the hash merely to pass the check."));
      }
      if (staged.has(file)) {
        let stagedDigest = null;
        if (!stagedDeleted.has(file)) {
          const indexEntry = git("ls-files", "--stage", "-z", "--", file);
          if (!/^100(?:644|755) [0-9a-f]+ 0\t/.test(indexEntry) || indexEntry.split("\0").filter(Boolean).length !== 1) {
            violations.push(violation(file, "The staged exception must be one regular, conflict-free file."));
            continue;
          }
          const bytes = execFileSync("git", ["show", `:${file}`], { cwd: repository, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
          stagedDigest = createHash("sha256").update(bytes).digest("hex");
        }
        if (stagedDigest !== entry.sha256) {
          violations.push(violation(file, "Staged test content differs from the reviewed exception. Working-tree contents cannot authorize different bytes in the next commit."));
        }
      }
    }
    return violations;
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return [violation(policyPath, `Cannot validate the closed test policy: ${detail}`)];
  }
}
