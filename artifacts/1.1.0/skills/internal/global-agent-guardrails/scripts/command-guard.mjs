#!/usr/bin/env node
// @ts-check

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(resolve(root, "references", "policy.json"), "utf8"));
const rules = policy.rules.map((rule) => ({ ...rule, regex: new RegExp(rule.pattern, "iu") }));

function readOnlyLiteral(command) {
  if (!/^\s*(?:echo|printf|rg|grep)\b/u.test(command)) return false;
  return !/[;&|\n]|\$\(|`/u.test(command);
}

export function evaluateCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) {
    return { allowed: false, ruleId: "missing-command", reason: "Shell hook input did not contain a command; blocked closed." };
  }
  if (readOnlyLiteral(command)) return { allowed: true, ruleId: null, reason: null };
  for (const rule of rules) {
    if (rule.regex.test(command)) return { allowed: false, ruleId: rule.id, reason: rule.reason };
  }
  return { allowed: true, ruleId: null, reason: null };
}

function commandsFrom(value) {
  const commands = [];
  function walk(current, key = "") {
    if (typeof current === "string" && new Set(["command", "cmd", "script"]).has(key)) commands.push(current);
    else if (Array.isArray(current)) current.forEach((entry) => walk(entry));
    else if (current && typeof current === "object") Object.entries(current).forEach(([childKey, child]) => walk(child, childKey));
  }
  walk(value);
  return commands;
}

async function stdinJson() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1_000_000) throw new Error("Hook input exceeds 1 MB");
  }
  if (!input.trim()) throw new Error("Hook input is empty");
  return JSON.parse(input);
}

function codexDeny(reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  })}\n`);
}

function block(harness, reason) {
  if (harness === "codex") {
    codexDeny(reason);
    process.exitCode = 0;
  } else {
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") {
    const index = args.indexOf("--command");
    if (index < 0 || !args[index + 1]) throw new Error("check requires --command <shell-command>");
    const result = evaluateCommand(args[index + 1]);
    process.stdout.write(`${JSON.stringify({ policyVersion: policy.policyVersion, ...result })}\n`);
    process.exitCode = result.allowed ? 0 : 2;
    return;
  }
  if (command !== "hook") throw new Error("Usage: command-guard.mjs <check|hook> [options]");
  const harnessIndex = args.indexOf("--harness");
  const harness = harnessIndex >= 0 ? args[harnessIndex + 1] : null;
  if (!new Set(["codex", "factory"]).has(harness)) throw new Error("hook requires --harness <codex|factory>");
  try {
    const commands = commandsFrom(await stdinJson());
    if (commands.length === 0) return block(harness, "Shell hook input contained no command; blocked closed.");
    for (const shellCommand of commands) {
      const result = evaluateCommand(shellCommand);
      if (!result.allowed) return block(harness, `[${result.ruleId}] ${result.reason}`);
    }
  } catch (error) {
    return block(harness, `Malformed shell hook input; blocked closed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
