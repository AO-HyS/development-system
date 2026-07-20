// @ts-check

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repositoryRoot, "bin/development-system.mjs");
const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-scenario-"));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();

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
step(["install", "--version", "0.5.0", "--source-commit", sourceCommit]);
const codexContract = resolve(home, ".codex", "development-system", "contract.md");
await writeFile(codexContract, "scenario drift\n", "utf8");
assert.equal(step(["audit"]).status, "drifted");
step(["validate"], 1);
step(["install", "--version", "0.5.0", "--source-commit", sourceCommit]);
assert.equal(step(["validate"]).status, "healthy");
assert.equal(step(["rollback"]).toVersion, "0.0.0");
assert.equal(await readFile(unrelated, "utf8"), "user-owned\n");

process.stdout.write(`Scenario complete. Isolated HOME: ${home}\n`);
