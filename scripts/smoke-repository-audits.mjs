// @ts-check

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditRepository } from "../src/repositories.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectsRootIndex = process.argv.indexOf("--projects-root");
const projectsRoot = resolve(
  projectsRootIndex >= 0 ? process.argv[projectsRootIndex + 1] : resolve(repositoryRoot, ".."),
);
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
const targets = ["nutri-plan", "the-barber-central", "aohys", "eteria"];

/** @param {string} repository */
function gitStatus(repository) {
  const run = spawnSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: repository,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(run.stderr || `git status failed for ${repository}`);
  return run.stdout;
}

/** @param {string} repository */
function gitHead(repository) {
  const run = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(run.stderr || `git rev-parse failed for ${repository}`);
  return run.stdout.trim();
}

const results = [];
for (const name of targets) {
  const repository = resolve(projectsRoot, name);
  const before = gitStatus(repository);
  const audit = await auditRepository({ repository });
  const after = gitStatus(repository);
  results.push({
    repository: name,
    repositoryRoot: repository,
    headCommit: gitHead(repository),
    gitStatusHash: createHash("sha256").update(before).digest("hex"),
    compatibility: "completed-without-crash",
    fingerprint: audit.repositoryFingerprint,
    fingerprintPolicy: audit.fingerprint.policy,
    excludedPaths: audit.fingerprint.excluded.length,
    boundedLargeFiles: audit.fingerprint.boundedFiles.length,
    externalSideEffects: audit.externalSideEffects,
    gitStatusUnchanged: before === after,
    rolloutReadinessClaim: false,
  });
}

const report = {
  schemaVersion: 1,
  contractVersion: "0.8.0",
  generatedAt: new Date().toISOString(),
  operation: "repository-audit-smoke",
  mode: "read-only-compatibility-evidence",
  rolloutAuthorized: false,
  ok: results.every((result) =>
    result.externalSideEffects.length === 0 && result.gitStatusUnchanged && !result.rolloutReadinessClaim
  ),
  results,
};

if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
