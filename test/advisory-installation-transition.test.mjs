import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditInstallation, installVersion, rollbackInstallation } from "../src/core.mjs";
import { auditGovernanceHooks, enableGovernanceHooks } from "../src/governance-installation.mjs";
import { run } from "../src/cli.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = join(root, "manifests/1.29.0.json");
const manifestAvailable = await readFile(versionPath).then(() => true, () => false);

/** Create a provenance commit from current artifact bytes without touching the real index. */
async function sourceCommit(t, manifest) {
  const scratch = await mkdtemp(join(tmpdir(), "advisory-source-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index"),
    GIT_AUTHOR_NAME: "Development System tests", GIT_AUTHOR_EMAIL: "tests@aohys.com",
    GIT_COMMITTER_NAME: "Development System tests", GIT_COMMITTER_EMAIL: "tests@aohys.com" };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("read-tree", "HEAD");
  git("add", "--", "manifests/1.29.0.json", ...manifest.artifacts.map((artifact) => artifact.sourcePath));
  return git("commit-tree", git("write-tree"), "-m", "isolated advisory installation test");
}

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "advisory-install-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(versionPath, "utf8"));
  const commit = await sourceCommit(t, manifest);
  await installVersion({ home, version: "1.28.0", sourceCommit: commit });
  const hooks = join(home, ".codex/hooks.json");
  const prior = '{"description":"operator","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node operator.mjs"}]}]}}\n';
  await writeFile(hooks, prior);
  await enableGovernanceHooks({ home });
  const governedHooks = await readFile(hooks, "utf8");
  const recovery = join(home, ".development-system/governance-hooks.json");
  const governedRecovery = await readFile(recovery, "utf8");
  const history = join(home, ".development-system/private/historical-run.json");
  await mkdir(dirname(history), { recursive: true });
  await writeFile(history, '{"status":"historical"}\n');
  return { home, commit, hooks, recovery, governedHooks, governedRecovery, history };
}

test("plain install transitions governed hooks and reinstall retains the original rollback boundary", { skip: !manifestAvailable }, async (t) => {
  const f = await fixture(t);
  const first = await installVersion({ home: f.home, version: "1.29.0", sourceCommit: f.commit });
  assert.equal(first.executionMode, "advisory-parent-execution");
  assert.equal((await auditInstallation({ home: f.home })).executionMode, "advisory-parent-execution");
  assert.equal((await auditGovernanceHooks({ home: f.home })).status, "disabled");
  const advisoryHooks = await readFile(f.hooks, "utf8");
  assert.equal(JSON.parse(advisoryHooks).hooks.PreToolUse[0].hooks[0].command, "node operator.mjs");
  assert.equal(advisoryHooks.includes("AOHYS_JEV_GOVERNANCE=1"), false);
  assert.equal(await readFile(f.recovery, "utf8"), f.governedRecovery);
  assert.equal(await readFile(f.history, "utf8"), '{"status":"historical"}\n');
  assert.equal((await installVersion({ home: f.home, version: "1.29.0", sourceCommit: f.commit })).reinstalled, true);
  const rolledBack = await rollbackInstallation({ home: f.home });
  assert.equal(rolledBack.toVersion, "1.28.0");
  assert.equal(await readFile(f.hooks, "utf8"), f.governedHooks);
  assert.equal(await readFile(f.recovery, "utf8"), f.governedRecovery);
  assert.equal(await readFile(f.history, "utf8"), '{"status":"historical"}\n');
});

test("advisory rollback refuses hook drift before restoring any contract artifact", { skip: !manifestAvailable }, async (t) => {
  const f = await fixture(t);
  await installVersion({ home: f.home, version: "1.29.0", sourceCommit: f.commit });
  const stateBefore = await readFile(join(f.home, ".development-system/state.json"), "utf8");
  const manifestBefore = await readFile(join(f.home, ".development-system/installed-manifest.json"), "utf8");
  await writeFile(f.hooks, '{"operator":"changed"}\n');
  await assert.rejects(rollbackInstallation({ home: f.home }), /changed after installation/);
  assert.equal(await readFile(f.hooks, "utf8"), '{"operator":"changed"}\n');
  assert.equal(await readFile(join(f.home, ".development-system/state.json"), "utf8"), stateBefore);
  assert.equal(await readFile(join(f.home, ".development-system/installed-manifest.json"), "utf8"), manifestBefore);
});

test("setup skill-sync failure restores governed contract and exact hooks", { skip: !manifestAvailable }, async (t) => {
  const f = await fixture(t);
  const stateBefore = await readFile(join(f.home, ".development-system/state.json"), "utf8");
  const skillsParent = join(f.home, ".agents/skills");
  await mkdir(dirname(skillsParent), { recursive: true });
  await symlink(join(f.home, "operator-skills"), skillsParent);
  await assert.rejects(run(["setup", "--home", f.home, "--version", "1.29.0", "--source-commit", f.commit, "--json"]), /skill synchronization failed/i);
  assert.equal((await auditInstallation({ home: f.home })).contractVersion, "1.28.0");
  assert.equal(await readFile(f.hooks, "utf8"), f.governedHooks);
  assert.equal(await readFile(f.recovery, "utf8"), f.governedRecovery);
  assert.equal(await readFile(join(f.home, ".development-system/state.json"), "utf8"), stateBefore);
  assert.equal(await readFile(f.history, "utf8"), '{"status":"historical"}\n');
});

test("rollback detects a late corrupt artifact backup before changing hooks or contract", { skip: !manifestAvailable }, async (t) => {
  const f = await fixture(t);
  await installVersion({ home: f.home, version: "1.29.0", sourceCommit: f.commit });
  const statePath = join(f.home, ".development-system/state.json");
  const manifestPath = join(f.home, ".development-system/installed-manifest.json");
  const stateBefore = await readFile(statePath, "utf8");
  const manifestBefore = await readFile(manifestPath, "utf8");
  const hooksBefore = await readFile(f.hooks, "utf8");
  const reference = JSON.parse(stateBefore).history.at(-1);
  const snapshotRoot = join(f.home, ".development-system/snapshots", reference.id);
  const snapshot = JSON.parse(await readFile(join(snapshotRoot, "snapshot.json"), "utf8"));
  const backup = snapshot.files.findLast((file) => file.existed && file.backupPath);
  assert.ok(backup);
  await writeFile(join(snapshotRoot, backup.backupPath), "corrupt backup");
  await assert.rejects(rollbackInstallation({ home: f.home }), /backup integrity mismatch/);
  assert.equal(await readFile(f.hooks, "utf8"), hooksBefore);
  assert.equal(await readFile(f.recovery, "utf8"), f.governedRecovery);
  assert.equal(await readFile(statePath, "utf8"), stateBefore);
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
});

test("advisory snapshot detects later hook drift even when no managed handler was removed", { skip: !manifestAvailable }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), "advisory-clean-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(versionPath, "utf8"));
  const commit = await sourceCommit(t, manifest);
  const hooks = join(home, ".codex/hooks.json");
  await mkdir(dirname(hooks), { recursive: true });
  const previous = '{"hooks":{"Stop":[{"hooks":[{"command":"node operator.mjs"}]}]}}\n';
  await writeFile(hooks, previous);
  await installVersion({ home, version: "1.29.0", sourceCommit: commit });
  assert.equal(await readFile(hooks, "utf8"), previous);
  await writeFile(hooks, '{"operator":"later"}\n');
  await assert.rejects(rollbackInstallation({ home }), /changed after installation/);
  assert.equal((await auditInstallation({ home })).contractVersion, "1.29.0");
});

test("failed same-version setup reports failure, keeps hook repair, and preserves original rollback", { skip: !manifestAvailable }, async (t) => {
  const f = await fixture(t);
  await installVersion({ home: f.home, version: "1.29.0", sourceCommit: f.commit });
  const advisoryHooks = await readFile(f.hooks, "utf8");
  const statePath = join(f.home, ".development-system/state.json");
  const originalBoundary = JSON.parse(await readFile(statePath, "utf8")).history.at(-1);
  const reintroduced = JSON.parse(advisoryHooks);
  reintroduced.hooks.PreToolUse.push({ matcher: ".*", hooks: [
    { type: "command", command: "AOHYS_JEV_GOVERNANCE=1 node reintroduced.mjs" },
  ] });
  await writeFile(f.hooks, JSON.stringify(reintroduced, null, 2) + "\n");
  const skillsParent = join(f.home, ".agents/skills");
  await mkdir(dirname(skillsParent), { recursive: true });
  await symlink(join(f.home, "operator-skills"), skillsParent);
  const failed = spawnSync(process.execPath, [join(root, "bin/development-system.mjs"), "setup", "--home", f.home,
    "--version", "1.29.0", "--source-commit", f.commit, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(failed.status, 1, failed.stderr);
  const failure = JSON.parse(failed.stdout.trim());
  assert.equal(failure.ok, false);
  assert.match(failure.error, /skill synchronization failed; existing contract reinstalled/i);
  assert.equal(await readFile(f.hooks, "utf8"), advisoryHooks);
  assert.equal((await auditGovernanceHooks({ home: f.home })).status, "disabled");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.currentVersion, "1.29.0");
  assert.deepEqual(state.history.at(-1), originalBoundary);
  assert.equal(await readFile(f.recovery, "utf8"), f.governedRecovery);
  assert.equal(await readFile(f.history, "utf8"), '{"status":"historical"}\n');
  assert.equal((await rollbackInstallation({ home: f.home })).toVersion, "1.28.0");
  assert.equal(await readFile(f.hooks, "utf8"), f.governedHooks);
  assert.equal(await readFile(f.recovery, "utf8"), f.governedRecovery);
});
