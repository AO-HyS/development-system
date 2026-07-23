// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runBoundedProcess } from "../src/bounded-process.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;

/** @param {string} command @param {string[]} args @param {{timeout?: number}} [options] */
async function run(command, args, options = {}) {
  return runBoundedProcess(command, args, {
    cwd: repositoryRoot,
    maxBuffer: 20 * 1024 * 1024,
    timeoutMs: options.timeout ?? 10 * 60 * 1000,
    env: process.env,
  });
}

async function readAudit() {
  const result = await run("./bin/development-system", ["audit", "--json"]);
  if (result.status !== 0) {
    throw new Error(`HOME audit failed: ${result.stderr || result.error || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

/** @param {any} audit */
function stableHomeState(audit) {
  return {
    ok: audit.ok,
    status: audit.status,
    contractVersion: audit.contractVersion,
    source: audit.source,
    artifacts: audit.artifacts.map((/** @type {any} */ artifact) => ({
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

async function sourceCommit() {
  const result = await run("git", ["rev-parse", "HEAD"]);
  if (result.status !== 0) throw new Error(result.stderr || "Unable to resolve source commit");
  return result.stdout.trim();
}

const startedAt = new Date();
const homeBefore = stableHomeState(await readAudit());
const scenario = await run("pnpm", ["run", "scenario"]);
const homeAfter = stableHomeState(await readAudit());
const finishedAt = new Date();
const realHomeUnchanged = JSON.stringify(homeBefore) === JSON.stringify(homeAfter);
const combinedOutput = `${scenario.stdout}\n${scenario.stderr}`;
const testCount = Number(combinedOutput.match(/(?:^|\n)[^\n]*tests (\d+)/)?.[1] ?? 0);
const passCount = Number(combinedOutput.match(/(?:^|\n)[^\n]*pass (\d+)/)?.[1] ?? 0);
const failCount = Number(combinedOutput.match(/(?:^|\n)[^\n]*fail (\d+)/)?.[1] ?? -1);
const markers = {
  installation: combinedOutput.includes("Scenario complete"),
  skills: combinedOutput.includes("Skill scenario complete"),
  lifecycle: combinedOutput.includes("Lifecycle scenario complete"),
  repositoryPreparation: combinedOutput.includes("Repository preparation scenario complete"),
  acceptanceTests: testCount > 0 && passCount === testCount && failCount === 0,
};

const report = {
  schemaVersion: 1,
  contractVersion: "0.8.0",
  generatedAt: finishedAt.toISOString(),
  startedAt: startedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  operation: "isolated-scenario-recertification",
  sourceCommit: await sourceCommit(),
  realHomeReadOnly: true,
  realHomeUnchanged,
  scenario: {
    command: scenario.command,
    exitCode: scenario.status,
    signal: scenario.signal,
    error: scenario.error,
    testSummary: { tests: testCount, pass: passCount, fail: failCount },
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
