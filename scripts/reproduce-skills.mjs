// @ts-check

import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repositoryRoot, "bin/development-system.mjs");
const home = await mkdtemp(resolve(tmpdir(), "aohys-development-skills-scenario-"));
const sourceRoot = await mkdtemp(resolve(tmpdir(), "aohys-development-skills-source-"));
await mkdir(resolve(sourceRoot, "artifacts"), { recursive: true });
await cp(
  resolve(repositoryRoot, "artifacts", "0.2.0"),
  resolve(sourceRoot, "artifacts", "0.2.0"),
  { recursive: true },
);
for (const args of [
  ["init"],
  ["add", "."],
  ["-c", "user.name=Development System scenarios", "-c", "user.email=scenarios@aohys.com", "commit", "-m", "fixture source"],
]) {
  const git = spawnSync("git", args, { cwd: sourceRoot, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
}
const sourceCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).stdout.trim();

/** @param {string[]} args @param {number} expectedStatus */
function step(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, "--home", home, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout);
  process.stdout.write(`skills ${args[0]}: ${evidence.status ?? evidence.snapshotId ?? "ok"}\n`);
  return evidence;
}

const oldResearch = resolve(home, ".agents", "skills", "research", "SKILL.md");
const brokenFactoryLink = resolve(home, ".factory", "skills", "extract");
const staleWorkspace = resolve(home, ".agents", "skills", "grill-me-workspace", "result.txt");
const unrelated = resolve(home, "notes", "preserved.txt");
await mkdir(dirname(oldResearch), { recursive: true });
await writeFile(oldResearch, "old research bytes\n", "utf8");
await mkdir(dirname(brokenFactoryLink), { recursive: true });
await symlink("../../.agents/skills/missing", brokenFactoryLink);
await mkdir(dirname(staleWorkspace), { recursive: true });
await writeFile(staleWorkspace, "stale checkout output\n", "utf8");
await mkdir(dirname(unrelated), { recursive: true });
await writeFile(unrelated, "user-owned\n", "utf8");

assert.equal(step(["audit-skills"], 1).status, "invalid");
step(["sync-skills", "--source-root", sourceRoot, "--source-commit", sourceCommit]);
const structurallyHealthy = step(["audit-skills"], 1);
assert.equal(structurallyHealthy.status, "invalid");
assert.match(structurallyHealthy.problems.join("\n"), /operational evidence/i);
assert.equal(structurallyHealthy.logicalSkillCount, 20);
assert.equal(structurallyHealthy.physicalVariantCount, 40);
assert.ok(structurallyHealthy.skills.every(/** @param {{states: Record<string, boolean>}} skill */ (skill) => skill.states.exists && skill.states.discovered && skill.states.loadable));
assert.ok(structurallyHealthy.mirrors.every(/** @param {{status: string}} mirror */ (mirror) => mirror.status === "identical"));

await writeFile(oldResearch, "drifted research bytes\n", "utf8");
assert.equal(step(["audit-skills"], 1).status, "invalid");
step(["sync-skills", "--source-root", sourceRoot, "--source-commit", sourceCommit]);
const reinstalled = step(["audit-skills"], 1);
assert.ok(reinstalled.skills.every(/** @param {{states: Record<string, boolean>}} skill */ (skill) => skill.states.exists && skill.states.discovered && skill.states.loadable));

step(["rollback-skills"]);
assert.equal(await readFile(oldResearch, "utf8"), "old research bytes\n");
assert.equal((await lstat(brokenFactoryLink)).isSymbolicLink(), true);
assert.equal(await readlink(brokenFactoryLink), "../../.agents/skills/missing");
assert.equal(await readFile(staleWorkspace, "utf8"), "stale checkout output\n");
assert.equal(await readFile(unrelated, "utf8"), "user-owned\n");

process.stdout.write(`Skill scenario complete. Isolated HOME: ${home}\n`);
