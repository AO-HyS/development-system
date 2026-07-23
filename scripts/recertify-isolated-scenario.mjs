// @ts-check

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
    env: process.env,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  };
}

function readAudit() {
  const result = run("./bin/development-system", ["audit", "--json"]);
  if (result.status !== 0) {
    throw new Error(`HOME audit failed: ${result.stderr || result.error || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function stableHomeState(audit) {
  return {
    ok: audit.ok,
    status: audit.status,
    contractVersion: audit.contractVersion,
    source: audit.source,
    artifacts: audit.artifacts.map((artifact) => ({
      id: artifact.id,
      destination: artifact.destination,
      sha256: artifact.sha256,
      actualSha256: artifact.actualSha256,
      status: artifact.status,
    })),
    mirrors: audit.mirrors,
    problems: audit.problems,
  };
}

function sourceCommit() {
  const result = run("git", ["rev-parse", "HEAD"]);
  if (result.status !== 0) throw new Error(result.stderr || "Unable to resolve source commit");
  return result.stdout.trim();
}

const startedAt = new Date();
const homeBefore = stableHomeState(readAudit());
const scenario = run("pnpm", ["run", "scenario"]);
const homeAfter = stableHomeState(readAudit());
const finishedAt = new Date();
const realHomeUnchanged = JSON.stringify(homeBefore) === JSON.stringify(homeAfter);
const combinedOutput = `${scenario.stdout}\n${scenario.stderr}`;
const markers = {
  installation: combinedOutput.includes("Scenario complete"),
  skills: combinedOutput.includes("Skill scenario complete"),
  lifecycle: combinedOutput.includes("Lifecycle scenario complete"),
  repositoryPreparation: combinedOutput.includes("Repository preparation scenario complete"),
  acceptanceTests: /\bpass 16\b/.test(combinedOutput) && /\bfail 0\b/.test(combinedOutput),
};

const report = {
  schemaVersion: 1,
  contractVersion: "0.8.0",
  generatedAt: finishedAt.toISOString(),
  startedAt: startedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  operation: "isolated-scenario-recertification",
  sourceCommit: sourceCommit(),
  realHomeReadOnly: true,
  realHomeUnchanged,
  scenario: {
    command: scenario.command,
    exitCode: scenario.status,
    signal: scenario.signal,
    error: scenario.error,
    markers,
  },
  homeBefore,
  homeAfter,
  ok:
    scenario.status === 0 &&
    Object.values(markers).every(Boolean) &&
    homeBefore.ok === true &&
    homeAfter.ok === true &&
    realHomeUnchanged,
};

if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
