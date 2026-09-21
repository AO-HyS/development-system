#!/usr/bin/env node

import { run } from "../src/cli.mjs";

const wantsJson = process.argv.includes("--json");

try {
  const response = await run(process.argv.slice(2));
  const { result, output } = response;
  process.stdout.write(`${output}\n`);
  if (result.ok === false && !["audit", "audit-repository"].includes(result.operation)) process.exitCode = 1;
  if ("code" in response && typeof response.code === "number" && response.code !== 0) process.exitCode = response.code;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify({ ok: false, operation: "error", error: message })}\n`);
  } else {
    process.stderr.write(`Development System error: ${message}\n`);
  }
  process.exitCode = 1;
}
