// @ts-check

import { createHash } from "node:crypto";
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
if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
  throw new Error("revalidate-t3code-evidence requires a distinct --output <attestation-path>");
}
const outputPath = resolve(process.argv[outputIndex + 1]);
if (outputPath === inputPath) throw new Error("Attestation output must not overwrite captured evidence");
const input = await readFile(inputPath);
const report = JSON.parse(input.toString("utf8"));
const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (commit.status !== 0) throw new Error(commit.stderr || "Unable to resolve validation commit");

const validation = {
  schemaVersion: 1,
  operation: "t3code-evidence-attestation",
  evaluatedAt: new Date().toISOString(),
  evaluatorCommit: commit.stdout.trim(),
  capturedSourceCommit: report.sourceCommit,
  inputSha256: createHash("sha256").update(input).digest("hex"),
  inputBytes: input.byteLength,
  ok: evaluateT3CodeProbe(report),
};
await writeFile(outputPath, `${JSON.stringify(validation, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
if (!validation.ok) process.exitCode = 1;
