// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = await mkdtemp(resolve(tmpdir(), "aohys-governance-setup-"));
const indexRoot = await mkdtemp(resolve(tmpdir(), "aohys-governance-index-"));
const env = { ...process.env, GIT_INDEX_FILE: resolve(indexRoot, "index"),
  GIT_AUTHOR_NAME: "Development System scenario", GIT_AUTHOR_EMAIL: "scenario@aohys.com",
  GIT_COMMITTER_NAME: "Development System scenario", GIT_COMMITTER_EMAIL: "scenario@aohys.com" };
/** @param {string[]} argv */
function git(argv) {
  const result = spawnSync("git", argv, { cwd: repositoryRoot, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
git(["read-tree", "HEAD"]);
git(["add", "-A"]);
const sourceCommit = git(["commit-tree", git(["write-tree"]), "-m", "isolated governance installation scenario"]);
const cli = resolve(repositoryRoot, "bin/development-system.mjs");
/** @param {string[]} argv @param {number} [expected] */
function step(argv, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...argv, "--home", home, "--json"], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}
const hooks = resolve(home, ".codex/hooks.json");
const unrelated = resolve(home, "notes/operator.txt");
await mkdir(dirname(unrelated), { recursive: true });
await mkdir(dirname(hooks), { recursive: true });
await writeFile(unrelated, "preserve user work\n");
const priorHooks = '{"description":"operator-owned","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node operator-guard.mjs"}]}]}}\n';
await writeFile(hooks, priorHooks);
step(["setup", "--version", "1.24.0", "--source-commit", sourceCommit]);

// A malformed operator configuration must abort the upgrade and restore its
// previous contract; setup cannot silently replace the operator's file.
await writeFile(hooks, "{ deliberately malformed operator hooks\n");
step(["setup", "--version", "1.26.0", "--source-commit", sourceCommit], 1);
assert.equal(step(["audit"]).contractVersion, "1.24.0");
assert.equal(await readFile(hooks, "utf8"), "{ deliberately malformed operator hooks\n");
await writeFile(hooks, priorHooks);

const setup = step(["setup", "--version", "1.26.0", "--source-commit", sourceCommit]);
assert.equal(setup.governance.ok, true);
assert.equal(setup.governance.operationalEnforcement, "not-established-by-installation");
assert.equal(step(["governance-hooks-audit"]).ok, true);
const installedHooks = await readFile(hooks, "utf8");
assert.equal(JSON.parse(installedHooks).hooks.PreToolUse[0].hooks[0].command, "node operator-guard.mjs");
const engine = resolve(home, ".codex/development-system/governance-runtime/hook-launcher.mjs");
await writeFile(engine, "// deliberately drifted isolated engine\n");
assert.equal(step(["audit"]).status, "drifted");
step(["validate"], 1);
step(["setup", "--version", "1.26.0", "--source-commit", sourceCommit]);
assert.equal(step(["validate"]).status, "healthy");
assert.equal(await readFile(hooks, "utf8"), installedHooks);
assert.equal(step(["rollback"]).toVersion, "1.24.0");
assert.equal(await readFile(hooks, "utf8"), priorHooks);
step(["sync-skills", "--version", "0.44.0", "--source-commit", sourceCommit]);
assert.equal(step(["validate"]).status, "healthy");
assert.equal(await readFile(unrelated, "utf8"), "preserve user work\n");
console.log(JSON.stringify({ ok: true, operation: "governance-installation-scenario", home,
  checks: ["upgrade", "failed-upgrade-restoration", "unrelated-hooks", "drift", "failed-validation", "reinstall", "contract-and-hooks-rollback", "prior-catalog", "unrelated-files"],
  operationalEnforcement: "not-established-by-installation" }));
