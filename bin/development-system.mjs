#!/usr/bin/env node

import { run } from "../src/cli.mjs";

const wantsJson = process.argv.includes("--json");

try {
  const { result, output } = await run(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
  if (result.ok === false && result.operation !== "audit") process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify({ ok: false, operation: "error", error: message })}\n`);
  } else {
    process.stderr.write(`Development System error: ${message}\n`);
  }
  process.exitCode = 1;
}
