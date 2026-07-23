#!/usr/bin/env node
// @ts-check

import {
  buildArchitectureReport,
  ingestArchitectureAnswers,
  readArchitectureScore,
  readArchitectureSuite,
  scoreArchitectureAnswers,
  writeArchitectureReport,
  writeArchitectureScore,
} from "../src/architecture-benchmarks.mjs";

const usage = `Usage:
  node scripts/architecture-benchmark.mjs validate-suite --suite <suite.json>
  node scripts/architecture-benchmark.mjs score --suite <suite.json> --answers <file-or-directory>
    [--answers <path> ...] --output <private-directory>
  node scripts/architecture-benchmark.mjs report --suite <suite.json> --answers <file-or-directory>
    [--answers <path> ...] --output <private-directory>
  node scripts/architecture-benchmark.mjs report --scored <architecture-benchmark.json>
    --output <private-directory>
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
  if (!["validate-suite", "score", "report"].includes(command)) throw new Error(usage);

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
