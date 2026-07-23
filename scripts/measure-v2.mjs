#!/usr/bin/env node
// @ts-check

import {
  buildMeasurementScorecard,
  ingestRunRecords,
  writeMeasurementScorecard,
} from "../src/measurements.mjs";

const usage = `Usage:
  node scripts/measure-v2.mjs validate --input <file-or-directory> [--input <path> ...]
  node scripts/measure-v2.mjs scorecard --input <path> [--input <path> ...] --output <directory>
    [--baseline <cohort>] [--treatment <cohort>] [--sample-threshold <count>]
    [--current-roster-hash <sha256>]
    [--rollback-ref <git:40hex|roster:64hex>]
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

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["validate", "scorecard"].includes(command)) throw new Error(usage);
  const inputs = values(args, "--input");
  if (inputs.length === 0) throw new Error(`--input is required\n\n${usage}`);
  const records = await ingestRunRecords(inputs);
  if (command === "validate") {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operation: "measurement-v2-validate",
      records: records.length,
      runIds: records.map((record) => record.runId),
    }, null, 2)}\n`);
    return;
  }

  const output = value(args, "--output");
  if (!output) throw new Error(`--output is required\n\n${usage}`);
  const thresholdText = value(args, "--sample-threshold");
  const sampleThreshold = thresholdText === undefined ? 3 : Number(thresholdText);
  if (!Number.isSafeInteger(sampleThreshold) || sampleThreshold < 1) {
    throw new Error("--sample-threshold must be a positive integer");
  }
  const scorecard = buildMeasurementScorecard(records, {
    baseline: value(args, "--baseline") ?? "baseline",
    treatment: value(args, "--treatment") ?? "treatment",
    sampleThreshold,
    rollbackRef: value(args, "--rollback-ref") ?? null,
    currentRosterHash: value(args, "--current-roster-hash") ?? null,
  });
  const paths = await writeMeasurementScorecard(scorecard, output);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    operation: "measurement-v2-scorecard",
    records: records.length,
    output,
    ...paths,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
  process.exitCode = 1;
});
