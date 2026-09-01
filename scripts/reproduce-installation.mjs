// @ts-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repositoryRoot, "bin/development-system.mjs");
const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-scenario-"));
const candidateIndexRoot = await mkdtemp(resolve(tmpdir(), "aohys-development-system-index-"));
const candidateIndex = resolve(candidateIndexRoot, "index");
const candidateEnvironment = {
  ...process.env,
  GIT_INDEX_FILE: candidateIndex,
  GIT_AUTHOR_NAME: "Development System scenario",
  GIT_AUTHOR_EMAIL: "scenario@aohys.com",
  GIT_COMMITTER_NAME: "Development System scenario",
  GIT_COMMITTER_EMAIL: "scenario@aohys.com",
};
for (const args of [["read-tree", "HEAD"], ["add", "-A"]]) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: candidateEnvironment,
  });
  assert.equal(result.status, 0, result.stderr);
}
const tree = spawnSync("git", ["write-tree"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: candidateEnvironment,
});
assert.equal(tree.status, 0, tree.stderr);
const candidateCommit = spawnSync("git", ["commit-tree", tree.stdout.trim(), "-m", "scenario candidate"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: candidateEnvironment,
});
assert.equal(candidateCommit.status, 0, candidateCommit.stderr);
const sourceCommit = candidateCommit.stdout.trim();

/** @param {string[]} args @param {number} expectedStatus */
function step(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, "--home", home, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout);
  process.stdout.write(`${args[0]}: ${evidence.status ?? evidence.version ?? evidence.toVersion ?? "ok"}\n`);
  return evidence;
}

const unrelated = resolve(home, "notes", "preserved.txt");
await mkdir(dirname(unrelated), { recursive: true });
await writeFile(unrelated, "user-owned\n", "utf8");

step(["install", "--version", "0.0.0", "--source-commit", sourceCommit]);
step(["install", "--version", "1.5.13", "--source-commit", sourceCommit]);
const codexContract = resolve(home, ".codex", "development-system", "contract.md");
await writeFile(codexContract, "scenario drift\n", "utf8");
assert.equal(step(["audit"]).status, "drifted");
step(["validate"], 1);
step(["install", "--version", "1.5.13", "--source-commit", sourceCommit]);
assert.equal(step(["validate"]).status, "healthy");
assert.equal(step(["rollback"]).toVersion, "0.0.0");
assert.equal(await readFile(unrelated, "utf8"), "user-owned\n");

process.stdout.write(`Scenario complete. Isolated HOME: ${home}\n`);
