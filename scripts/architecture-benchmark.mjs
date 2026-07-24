#!/usr/bin/env node
// @ts-check

import {
  architectureAnswersToMeasurementRecords,
  buildArchitectureReport,
  ingestArchitectureAnswers,
  readArchitectureScore,
  readArchitectureSuite,
  scoreArchitectureAnswers,
  writeArchitectureReport,
  writeArchitectureScore,
} from "../src/architecture-benchmarks.mjs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const usage = `Usage:
  node scripts/architecture-benchmark.mjs validate-suite --suite <suite.json>
  node scripts/architecture-benchmark.mjs score --suite <suite.json> --answers <file-or-directory>
    [--answers <path> ...] --output <private-directory>
  node scripts/architecture-benchmark.mjs report --suite <suite.json> --answers <file-or-directory>
    [--answers <path> ...] --output <private-directory>
  node scripts/architecture-benchmark.mjs report --scored <architecture-benchmark.json>
    --output <private-directory>
  node scripts/architecture-benchmark.mjs measurement --suite <suite.json>
    --answers <file-or-directory> [--answers <path> ...]
    --output <private-records.json> --roster-hash <sha256> --rollback-ref <roster:sha256>
    [--baseline-mode M1] [--treatment-mode M3]
    --validated-mode M1 --provisional-mode M3
`;

/** @param {string[]} args @param {string} name */
function values(args, name) {
  /** @type {string[]} */
  const found = [];
  args.forEach((argument, index) => {
    if (argument === name && args[index + 1] !== undefined) found.push(args[index + 1]);
  });
  return found;
}

/** @param {string[]} args @param {string} name */
function value(args, name) {
  return values(args, name).at(-1);
}

/** @param {string|undefined} selected @param {string} flag */
function required(selected, flag) {
  if (!selected) throw new Error(`${flag} is required\n\n${usage}`);
  return selected;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["validate-suite", "score", "report", "measurement"].includes(command)) throw new Error(usage);

  if (command === "validate-suite") {
    const suite = await readArchitectureSuite(required(value(args, "--suite"), "--suite"));
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operation: "architecture-benchmark-validate-suite",
      suiteId: suite.suiteId,
      repositories: suite.repositories.length,
      cases: suite.cases.length,
    }, null, 2)}\n`);
    return;
  }

  if (command === "measurement") {
    if (value(args, "--scored")) {
      throw new Error("measurement rejects derived --scored input; provide --suite with raw --answers");
    }
    const suite = await readArchitectureSuite(required(value(args, "--suite"), "--suite"));
    const answerInputs = values(args, "--answers");
    if (answerInputs.length === 0) throw new Error(`--answers is required\n\n${usage}`);
    const answers = await ingestArchitectureAnswers(answerInputs);
    const outputPath = resolve(required(value(args, "--output"), "--output"));
    const records = architectureAnswersToMeasurementRecords(suite, answers, {
      baselineMode: value(args, "--baseline-mode") ?? "M1",
      treatmentMode: value(args, "--treatment-mode") ?? "M3",
      rosterHash: required(value(args, "--roster-hash"), "--roster-hash"),
      rollbackRef: required(value(args, "--rollback-ref"), "--rollback-ref"),
      validatedModes: values(args, "--validated-mode"),
      provisionalModes: values(args, "--provisional-mode"),
    });
    await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(outputPath), 0o700);
    await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(outputPath, 0o600);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operation: "architecture-benchmark-measurement",
      records: records.length,
      outputPath,
    }, null, 2)}\n`);
    return;
  }

  const output = required(value(args, "--output"), "--output");
  if (command === "score") {
    const suite = await readArchitectureSuite(required(value(args, "--suite"), "--suite"));
    const answerInputs = values(args, "--answers");
    if (answerInputs.length === 0) throw new Error(`--answers is required\n\n${usage}`);
    const answers = await ingestArchitectureAnswers(answerInputs);
    const scored = scoreArchitectureAnswers(suite, answers);
    const paths = await writeArchitectureScore(scored, output);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operation: "architecture-benchmark-score",
      suiteId: suite.suiteId,
      runs: scored.runs.length,
      availability: scored.availability,
      ...paths,
    }, null, 2)}\n`);
    return;
  }

  const scoredPath = value(args, "--scored");
  const suitePath = value(args, "--suite");
  const answerInputs = values(args, "--answers");
  if (scoredPath && (suitePath || answerInputs.length > 0)) {
    throw new Error("report accepts either --scored or --suite with --answers, not both");
  }
  let report;
  if (scoredPath) {
    report = await readArchitectureScore(scoredPath);
  } else {
    const suite = await readArchitectureSuite(required(suitePath, "--suite"));
    if (answerInputs.length === 0) throw new Error(`--answers is required\n\n${usage}`);
    const answers = await ingestArchitectureAnswers(answerInputs);
    report = buildArchitectureReport(scoreArchitectureAnswers(suite, answers));
  }
  const paths = await writeArchitectureReport(report, output);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    operation: "architecture-benchmark-report",
    suiteId: report.suiteId,
    runs: report.runs.length,
    availability: report.availability,
    ...paths,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
  process.exitCode = 1;
});
