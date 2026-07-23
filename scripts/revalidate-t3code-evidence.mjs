// @ts-check

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { evaluateT3CodeProbe } from "../src/t3code-probe.mjs";

const inputIndex = process.argv.indexOf("--input");
if (inputIndex < 0 || !process.argv[inputIndex + 1]) {
  throw new Error("revalidate-t3code-evidence requires --input <path>");
}
const inputPath = resolve(process.argv[inputIndex + 1]);
const outputIndex = process.argv.indexOf("--output");
const outputPath = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : inputPath);
const report = JSON.parse(await readFile(inputPath, "utf8"));
const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (commit.status !== 0) throw new Error(commit.stderr || "Unable to resolve validation commit");

report.validation = {
  evaluatedAt: new Date().toISOString(),
  sourceCommit: commit.stdout.trim(),
  capturedSourceCommit: report.sourceCommit,
};
report.ok = evaluateT3CodeProbe(report);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ ok: report.ok, validation: report.validation }, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
