// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = await mkdtemp(resolve(tmpdir(), "aohys-governance-1270-home-"));
const indexRoot = await mkdtemp(resolve(tmpdir(), "aohys-governance-1270-index-"));
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
const sourceCommit = git(["commit-tree", git(["write-tree"]), "-m", "isolated governance 1.27.0 upgrade verification"]);
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
await mkdir(dirname(hooks), { recursive: true });
await mkdir(dirname(unrelated), { recursive: true });
await writeFile(unrelated, "preserve user work\n");
await writeFile(hooks, '{"description":"operator-owned","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node operator-guard.mjs"}]}]}}\n');
step(["setup", "--version", "1.26.1", "--source-commit", sourceCommit]);
assert.equal(step(["validate"]).status, "healthy");
assert.equal(step(["governance-hooks-audit"]).ok, true);
const installedHooks = await readFile(hooks, "utf8");
const setup = step(["setup", "--version", "1.27.0", "--source-commit", sourceCommit]);
assert.equal(setup.version, "1.27.0");
assert.equal(setup.catalogVersion, "0.46.0");
assert.equal(setup.governance.ok, true);
assert.equal(setup.governance.changed, false);
assert.equal(setup.governance.operationalEnforcement, "not-established-by-installation");
assert.equal(step(["audit"]).contractVersion, "1.27.0");
assert.equal(await readFile(hooks, "utf8"), installedHooks);
const engine = resolve(home, ".codex/development-system/governance-runtime/hook-launcher.mjs");
await writeFile(engine, "// deliberately drifted isolated engine\n");
assert.equal(step(["audit"]).status, "drifted");
step(["validate"], 1);
const reinstall = step(["setup", "--version", "1.27.0", "--source-commit", sourceCommit]);
assert.equal(reinstall.installation.reinstalled, true);
assert.equal(reinstall.governance.changed, false);
assert.equal(step(["validate"]).status, "healthy");
assert.equal(step(["audit"]).contractVersion, "1.27.0");
assert.equal(await readFile(hooks, "utf8"), installedHooks);
// This verifies installation reversal only, before any v2 governance state.
// Published 1.26.1 cannot read v2 envelopes; operational recovery needs a forward repair.
await assert.rejects(access(resolve(home, ".development-system/governance/registry.json")), { code: "ENOENT" });
const downgrade = step(["setup", "--version", "1.26.1", "--source-commit", sourceCommit]);
assert.equal(downgrade.governance.changed, false);
assert.equal(step(["validate"]).status, "healthy");
assert.equal(step(["audit"]).contractVersion, "1.26.1");
assert.equal(step(["governance-hooks-audit"]).ok, true);
assert.equal(await readFile(hooks, "utf8"), installedHooks);
assert.equal(await readFile(unrelated, "utf8"), "preserve user work\n");
console.log(JSON.stringify({ ok: true, operation: "governance-upgrade-1270", home,
  checks: ["upgrade-1261-to-1270", "unchanged-hook-definitions", "drift-denial", "reinstall", "installation-reversal-before-v2-state", "unrelated-files"],
  operationalEnforcement: "not-established-by-installation" }));
