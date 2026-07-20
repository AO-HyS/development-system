// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProcessBenchmarkRuntime,
  resolveCapabilityRoster,
  runBenchmarkSuite,
} from "../src/benchmarks.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suite = JSON.parse(await readFile(resolve(repositoryRoot, "benchmarks/suite.json"), "utf8"));
const roster = JSON.parse(await readFile(resolve(repositoryRoot, "config/capability-roster.json"), "utf8"));
resolveCapabilityRoster(roster);
for (const benchmarkCase of suite.cases) {
  benchmarkCase.fixtureContents = await readFile(resolve(repositoryRoot, benchmarkCase.fixture), "utf8");
}
const runId = `capability-${new Date().toISOString().replaceAll(":", "-")}`;
const concurrencyIndex = process.argv.indexOf("--concurrency");
const concurrency = concurrencyIndex >= 0 ? Number(process.argv[concurrencyIndex + 1]) : 3;
const timeoutIndex = process.argv.indexOf("--timeout-ms");
const timeoutMs = timeoutIndex >= 0 ? Number(process.argv[timeoutIndex + 1]) : 60_000;
if (!Number.isFinite(concurrency) || concurrency <= 0) throw new Error("--concurrency must be positive");
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be positive");
const runtime = createProcessBenchmarkRuntime({
  cwd: repositoryRoot,
  codexPath: process.env.AOHYS_CODEX_PATH,
  factoryPath: process.env.AOHYS_FACTORY_PATH,
  timeoutMs,
});
const report = await runBenchmarkSuite({ suite, runId, runtime, concurrency });
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? resolve(process.argv[outputIndex + 1])
  : resolve(repositoryRoot, "evidence", "benchmarks", `${runId}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: report.ok, runId, outputPath, rankings: report.rankings }, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
