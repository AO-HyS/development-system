#!/usr/bin/env node
// @ts-check

/**
 * Stop hook for Claude Code and Codex. Blocks the first stop of a session that changed files
 * without producing a completion report, then allows every later stop. Fails open on any
 * internal error. State lives in ~/.development-system/private/runs/report-gate/<session>.json.
 */

import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const reason = "Files changed this session and no report was produced. Write the concise report packet (flow-implement/references/completion-report.md), run `development-system document --input <packet> --json`, serve it with working-backwards `reader-live.mjs --tunnel` from a per-report copy directory, and put the URL in your final answer. If a report is truly not useful, say why in one line. This reminder appears once.";

const editTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]);
const shellTools = new Set(["Bash", "exec", "exec_command", "shell", "local_shell", "container.exec"]);
const delegationTools = new Set(["Agent", "Task", "spawn_agent"]);
const writerMarker = "Owned paths:";
/**
 * A report is an actual run: `development-system document` or `reader-live.mjs` in command
 * position (optionally after env assignments, npx, pnpm exec or node), not a mention of either.
 */
const reportPattern = /(?:^|[;&|(\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:npx|pnpm\s+exec|node)\s+(?:-\S+\s+)*)?(?:\S*\/)?(?:development-system(?:\.mjs)?\s+document\b|reader-live\.mjs\b)/u;
/** A redirect to a file (not `2>&1`, `>/dev/null`, `=>` or `->`), tee, in-place sed, commits, moves and copies. */
const writePatterns = [
  /(?:^|[^0-9&<>=\-])>>?\s*(?!&|\/dev\/null\b)[^\s|&;<>]/u,
  /(?:^|[\s|;&(])tee\s/u,
  /(?:^|[\s|;&(])sed\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*i/u,
  /(?:^|[\s|;&(])git\s+(?:-[^\s]+\s+)*commit\b/u,
  /(?:^|[\s|;&(])(?:mv|cp)\s/u,
];

/**
 * @typedef {{offset: number, sawEdit: boolean, sawReport: boolean, blocked: boolean, subagent: boolean}} GateState
 */

/** Quoted strings are arguments (awk programs, messages), never redirects. @param {string} command */
function stripQuoted(command) {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/gu, "''");
}

/** @param {string} command */
function writesFiles(command) {
  return writePatterns.some((pattern) => pattern.test(command));
}

/** @param {unknown} value @returns {string} */
function commandText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(" ");
  return "";
}

/** @param {unknown} raw @returns {Record<string, unknown>} */
function parseArguments(raw) {
  if (raw && typeof raw === "object") return /** @type {Record<string, unknown>} */ (raw);
  if (typeof raw !== "string") return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/**
 * Codex code mode runs JavaScript whose tool calls look like `tools.exec_command({cmd:"..."})`.
 * @param {string} source @returns {string[]}
 */
function codeModeCommands(source) {
  /** @type {string[]} */
  const commands = [];
  for (const match of source.matchAll(/\bcmd\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/gu)) {
    const literal = match[1];
    if (literal.startsWith("\"")) {
      try { commands.push(String(JSON.parse(literal))); continue; } catch { /* fall through */ }
    }
    commands.push(literal.slice(1, -1).replace(/\\(.)/gu, "$1"));
  }
  return commands;
}

/**
 * @param {{name: string, input: unknown}} call
 * @param {{sawEdit: boolean, sawReport: boolean}} flags
 */
function classifyCall(call, flags) {
  const input = parseArguments(call.input);
  if (editTools.has(call.name)) {
    flags.sawEdit = true;
    return;
  }
  if (delegationTools.has(call.name)) {
    // A delegated writer packet changes files in a sidechain or child session this scan skips.
    const packet = call.name === "spawn_agent" ? (typeof call.input === "string" ? call.input : JSON.stringify(input)) : input.prompt;
    if (typeof packet === "string" && packet.includes(writerMarker)) flags.sawEdit = true;
    return;
  }
  /** @type {string[]} */
  let commands = [];
  if (call.name === "exec" && typeof call.input === "string" && !call.input.trimStart().startsWith("{")) {
    // Codex code mode: JavaScript source.
    if (/\bapply_patch\b|\*\*\* Begin Patch/u.test(call.input)) flags.sawEdit = true;
    if (/\bspawn_agent\b/u.test(call.input) && call.input.includes(writerMarker)) flags.sawEdit = true;
    commands = codeModeCommands(call.input);
  } else if (shellTools.has(call.name)) {
    commands = [commandText(input.command ?? input.cmd)];
  } else {
    return;
  }
  for (const command of commands) {
    if (!command) continue;
    const bare = stripQuoted(command);
    if (reportPattern.test(bare)) flags.sawReport = true;
    if (writesFiles(bare)) flags.sawEdit = true;
  }
}

/**
 * @param {any} entry
 * @param {{sawEdit: boolean, sawReport: boolean, subagent: boolean}} flags
 */
function scanEntry(entry, flags) {
  if (!entry || typeof entry !== "object") return;
  // Claude Code transcript.
  if (entry.type === "assistant" && !entry.isSidechain && Array.isArray(entry.message?.content)) {
    for (const block of entry.message.content) {
      if (block?.type === "tool_use" && typeof block.name === "string") classifyCall({ name: block.name, input: block.input }, flags);
    }
    return;
  }
  // Codex rollout.
  const payload = entry.payload;
  if (!payload || typeof payload !== "object") return;
  if (entry.type === "session_meta") {
    const source = payload.source;
    if ((source && typeof source === "object" && "subagent" in source) || typeof payload.parent_thread_id === "string") flags.subagent = true;
    return;
  }
  if (entry.type !== "response_item") return;
  if (payload.type === "function_call" && typeof payload.name === "string") {
    classifyCall({ name: payload.name, input: payload.arguments }, flags);
  } else if (payload.type === "custom_tool_call" && typeof payload.name === "string") {
    classifyCall({ name: payload.name, input: payload.input }, flags);
  } else if (payload.type === "local_shell_call") {
    classifyCall({ name: "local_shell", input: { command: payload.action?.command } }, flags);
  }
}

/** @param {string} path @param {number} offset @returns {{text: string, next: number}} */
function readSince(path, offset) {
  const size = statSync(path).size;
  const start = offset > size ? 0 : offset;
  if (size === start) return { text: "", next: start };
  const buffer = Buffer.alloc(size - start);
  const descriptor = openSync(path, "r");
  try { readSync(descriptor, buffer, 0, buffer.length, start); }
  finally { closeSync(descriptor); }
  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline === -1) return { text: "", next: start };
  return { text: buffer.subarray(0, lastNewline + 1).toString("utf8"), next: start + lastNewline + 1 };
}

/** @param {string} path @returns {GateState} */
function readState(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return {
      offset: Number.isInteger(value.offset) ? value.offset : 0,
      sawEdit: value.sawEdit === true,
      sawReport: value.sawReport === true,
      blocked: value.blocked === true,
      subagent: value.subagent === true,
    };
  } catch {
    return { offset: 0, sawEdit: false, sawReport: false, blocked: false, subagent: false };
  }
}

/** @param {string} path @param {GateState} state */
function writeState(path, state) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/** Delete state files untouched for seven days; cleanup never blocks the gate. @param {string} directory @param {string} keep */
function pruneState(directory, keep) {
  const cutoff = Date.now() - stateMaxAgeMs;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json") && !name.endsWith(".tmp")) continue;
    const path = join(directory, name);
    if (path === keep) continue;
    try {
      const stats = lstatSync(path);
      if (stats.isFile() && stats.mtimeMs < cutoff) unlinkSync(path);
    } catch { /* another stop may have removed it */ }
  }
}

/**
 * Create the state directory and confirm that it and every parent below HOME is a real
 * directory, so the gate never writes through a symbolic link.
 * @param {string} home @param {string[]} parts @returns {string | null}
 */
function stateDirectory(home, parts) {
  if (lstatSync(home).isSymbolicLink()) return null;
  let current = home;
  for (const part of parts) {
    current = join(current, part);
    try { mkdirSync(current, { mode: 0o700 }); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return null;
  }
  return current;
}

async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const harnessIndex = process.argv.indexOf("--harness");
  const harness = harnessIndex === -1 ? "claude" : process.argv[harnessIndex + 1];
  if (harness !== "claude" && harness !== "codex") return;
  const payload = JSON.parse(await readStdin());
  if (!payload || typeof payload !== "object" || payload.stop_hook_active === true) return;
  const session = typeof payload.session_id === "string" ? payload.session_id.replace(/[^A-Za-z0-9._-]/gu, "_") : "";
  const transcript = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  if (!session || !transcript) return;
  const directory = stateDirectory(homedir(), [".development-system", "private", "runs", "report-gate"]);
  if (!directory) return; // Fail open on a symbolic link.
  const statePath = join(directory, `${session}.json`);
  const state = readState(statePath);
  if (state.blocked) return;
  const { text, next } = readSince(transcript, state.offset);
  const flags = { sawEdit: state.sawEdit, sawReport: state.sawReport, subagent: state.subagent };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { scanEntry(JSON.parse(line), flags); } catch { /* skip malformed lines */ }
  }
  /** @type {GateState} */
  const updated = { offset: next, ...flags, blocked: false };
  const block = !flags.subagent && flags.sawEdit && !flags.sawReport;
  if (block) updated.blocked = true;
  writeState(statePath, updated);
  try { pruneState(directory, statePath); } catch { /* cleanup is best effort */ }
  if (block) process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

try {
  await main();
} catch {
  // Fail open: the gate never breaks a stop because of its own error.
}
process.exitCode = 0;
