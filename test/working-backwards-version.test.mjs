import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const cli = resolve(repositoryRoot, "bin", "development-system.mjs");

async function candidateCommit() {
  const indexRoot = await mkdtemp(resolve(tmpdir(), "aohys-wb-index-"));
  const env = {
    ...process.env,
    GIT_INDEX_FILE: resolve(indexRoot, "index"),
    GIT_AUTHOR_NAME: "Working Backwards test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Working Backwards test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  for (const args of [["read-tree", "HEAD"], ["add", "-A"]]) {
    const result = spawnSync("git", args, { cwd: repositoryRoot, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const tree = spawnSync("git", ["write-tree"], { cwd: repositoryRoot, env, encoding: "utf8" });
  assert.equal(tree.status, 0, tree.stderr);
  const commit = spawnSync("git", ["commit-tree", tree.stdout.trim(), "-m", "Working Backwards candidate"], { cwd: repositoryRoot, env, encoding: "utf8" });
  assert.equal(commit.status, 0, commit.stderr);
  return commit.stdout.trim();
}

test("catalog 0.6.0 declares explicit mirrors without claiming live Working Backwards evidence", async () => {
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, "catalog", "0.6.0.json"), "utf8"));
  const skill = catalog.skills.find((entry) => entry.logicalName === "working-backwards");
  assert.deepEqual(skill.physicalHarnesses, ["codex", "factory"]);
  assert.equal(skill.variants[1].expectedMirrorOf, skill.variants[0].id);
  assert.equal(skill.variants[0].folderSha256, skill.variants[1].folderSha256);
  assert.equal(catalog.operationalEvidenceSkills.includes("working-backwards"), false);
});

test("contract 1.2.0 and catalog 0.6.0 install into an isolated HOME", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-home-"));
  const sourceCommit = await candidateCommit();
  for (const args of [
    ["install", "--version", "1.2.0", "--source-commit", sourceCommit],
    ["sync-skills", "--version", "0.6.0", "--source-commit", sourceCommit],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args, "--home", home, "--json"], { cwd: repositoryRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const installed = JSON.parse(await readFile(resolve(home, ".development-system", "installed-manifest.json"), "utf8"));
  assert.equal(installed.contractVersion, "1.2.0");
  assert.match(await readFile(resolve(home, ".agents", "skills", "working-backwards", "SKILL.md"), "utf8"), /exactly three definition gates/i);
  assert.equal(
    await readFile(resolve(home, ".agents", "skills", "working-backwards", "SKILL.md"), "utf8"),
    await readFile(resolve(home, ".factory", "skills", "working-backwards", "SKILL.md"), "utf8"),
  );
});
