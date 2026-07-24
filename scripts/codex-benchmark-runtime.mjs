#!/usr/bin/env node
// @ts-check

import { spawn } from "node:child_process";

import { buildCodexBenchmarkArgs } from "../src/codex-benchmark-runtime.mjs";

const args = buildCodexBenchmarkArgs(process.argv.slice(2));
const child = spawn("codex", args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(/** @type {NodeJS.Signals} */ (signal)));
}

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
