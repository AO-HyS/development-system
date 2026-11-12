#!/usr/bin/env node
// @ts-check

/**
 * Stop hook for Claude Code and Codex. Blocks the first stop of a turn that changed files when
 * the turn's final assistant message has no closing (what I need from you / what happens next).
 * A turn is the transcript span since the offset saved at the previous stop. The offset moves
 * before a reminder is written, so one edit reminds once; stop_hook_active only moves it again.
 * No reminder for a subagent or delegated child session, nor for a turn that ends waiting on
 * a delegate, a background agent or a watched pull request. Fails open on any internal
 * error. Thread length never blocks a stop: the owner decides when to open a new thread. State lives in ~/.development-system/private/runs/report-gate/<session>.json.
 */

import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const reason = "Files changed this turn and your last message has no closing. Before stopping, write it in the thread, in the user's language, short and cheerful (emojis welcome, no tables, nothing the owner has to open elsewhere): 1) what was done, in plain words, and the plan in one or two sentences if there is one; 2) where the work stands against its definition of done: which parts are met and which are not; 3) «Lo que necesito de ti» / \"What I need from you\": the exact decision or action, or that nothing is needed; 4) «Lo que sigue» / \"What happens next\": the next action and who owns it. A small change can use one line per part. Do not produce an HTML report unless the owner asked for one.";
/** A closing names both what the owner must do and what happens next. */
const closingNeedPattern = /necesito de ti|need from you/iu;
const closingNextPattern = /lo que sigue|sigue:|what happens next|next steps?:|next:/iu;


const editTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]);
const shellTools = new Set(["Bash", "exec", "exec_command", "shell", "local_shell", "container.exec"]);
const delegationTools = new Set(["Agent", "Task", "spawn_agent"]);
const writerMarker = "Owned paths:";
/** Ending on one of these means the turn is waiting, not closing: the rules say to end it without a message. */
const waitPattern = /(?:^|__)(?:delegate_task|watch_pull_request|t3_background_wait|t3_thread_wait)$/u;
/** T3 opens a delegated child with this sentence; such a session reports to its parent, not to the owner. */
/** A delegation that only launched (still running) answers with this; a completed foreground one answers with its report. */
const asyncLaunchPattern = /async agent launched|in the background/iu;
const delegatedChildPattern = /^\s*Act as the [\w-]+ sub-agent for this task\./u;
/** A redirect to a file (not `2>&1`, `>/dev/null`, `=>` or `->`), tee, in-place sed, commits, moves and copies. */
const writePatterns = [
  /(?:^|[^0-9&<>=\-])>>?\s*(?!&|\/dev\/null\b)[^\s|&;<>]/u,
  /(?:^|[\s|;&(])tee\s/u,
  /(?:^|[\s|;&(])sed\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*i/u,
  /(?:^|[\s|;&(])git\s+(?:-[^\s]+\s+)*commit\b/u,
  /(?:^|[\s|;&(])(?:mv|cp)\s/u,
];

/**
 * Only the offset and the session's subagent mark carry across turns; an edit belongs to its turn.
 * @typedef {{offset: number, subagent: boolean}} GateState
 */

/**
 * @typedef {{sawEdit: boolean, subagent: boolean, lastText: string | null, waiting: boolean, waitingOn?: string | null}} TurnFlags
 */

/** @param {string} text */
function hasClosing(text) {
  return closingNeedPattern.test(text) && closingNextPattern.test(text);
}

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
 * @param {{sawEdit: boolean, waiting: boolean}} flags
 */
function classifyCall(call, flags) {
  const input = parseArguments(call.input);
  flags.waiting = waitPattern.test(call.name)
    || (delegationTools.has(call.name) && input.run_in_background !== false);
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
    if (writesFiles(stripQuoted(command))) flags.sawEdit = true;
  }
}

/**
 * @param {any} entry
 * @param {TurnFlags} flags
 */
function scanEntry(entry, flags) {
  if (!entry || typeof entry !== "object") return;
  // Claude Code transcript.
  if (entry.type === "assistant" && !entry.isSidechain && Array.isArray(entry.message?.content)) {
    for (const block of entry.message.content) {
      if (block?.type === "tool_use" && typeof block.name === "string") {
        classifyCall({ name: block.name, input: block.input }, flags);
        // Remember a delegation that may be waiting: its result says whether it only launched or already finished.
        flags.waitingOn = flags.waiting && delegationTools.has(block.name) && typeof block.id === "string" ? block.id : null;
      } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) flags.lastText = block.text;
    }
    return;
  }
  if (entry.type === "user" && !entry.isSidechain) {
    const content = entry.message?.content;
    // A delegation whose result is its finished report was a foreground call: the turn is not waiting on it.
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type !== "tool_result" || !flags.waitingOn || block.tool_use_id !== flags.waitingOn) continue;
      const text = typeof block.content === "string" ? block.content
        : Array.isArray(block.content) ? block.content.map((/** @type {any} */ part) => (typeof part?.text === "string" ? part.text : "")).join("\n") : "";
      if (!asyncLaunchPattern.test(text)) flags.waiting = false;
      flags.waitingOn = null;
    }
    const first = typeof content === "string" ? content : Array.isArray(content) ? content.find((/** @type {any} */ block) => block?.type === "text")?.text : null;
    if (typeof first === "string" && delegatedChildPattern.test(first)) flags.subagent = true;
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
  if (payload.type === "message" && payload.role === "user" && Array.isArray(payload.content)) {
    if (payload.content.some((/** @type {any} */ part) => typeof part?.text === "string" && delegatedChildPattern.test(part.text))) flags.subagent = true;
  } else if (payload.type === "message" && payload.role === "assistant" && Array.isArray(payload.content)) {
    const text = payload.content
      .filter((/** @type {any} */ part) => part?.type === "output_text" && typeof part.text === "string")
      .map((/** @type {any} */ part) => part.text)
      .join("\n");
    if (text.trim()) flags.lastText = text;
  } else if (payload.type === "function_call" && typeof payload.name === "string") {
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

/**
 * Older state files also carry sawEdit, sawReport and blocked; they are ignored so a session
 * reminded once under 2.7.0 is still reminded on later turns. @param {string} path @returns {GateState}
 */
function readState(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return {
      offset: Number.isInteger(value.offset) ? value.offset : 0,
      subagent: value.subagent === true,
    };
  } catch {
    return { offset: 0, subagent: false };
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

/**
 * True when a codex-review (review or computer-use) launched in the background is still
 * running: a pending marker whose process is alive. The coordinator is woken when it
 * exits, so the reminder waits. A missing pending directory means none; any other error
 * while inspecting markers (unreadable or malformed marker) counts as pending, so the
 * gate returns without blocking and without changing state (fail open). @param {string} home
 */
function reviewPending(home) {
  const directory = join(home, ".development-system", "private", "runs", "codex-review", "pending");
  let names;
  try { names = readdirSync(directory); } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ENOENT");
  }
  try {
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const pid = Number(JSON.parse(readFileSync(join(directory, name), "utf8")).pid);
      if (!Number.isInteger(pid) || pid <= 0) return true;
      try { process.kill(pid, 0); } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") continue;
      }
      return true;
    }
  } catch { return true; }
  return false;
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
  if (!payload || typeof payload !== "object") return;
  // The stop that follows a reminder never reminds again; it only moves the offset, so what the
  // agent did while writing its closing is not counted in the next turn.
  const retry = payload.stop_hook_active === true;
  const session = typeof payload.session_id === "string" ? payload.session_id.replace(/[^A-Za-z0-9._-]/gu, "_") : "";
  const transcript = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  if (!session || !transcript) return;
  const directory = stateDirectory(homedir(), [".development-system", "private", "runs", "report-gate"]);
  if (!directory) return; // Fail open on a symbolic link.
  const statePath = join(directory, `${session}.json`);
  const state = readState(statePath);
  const { text, next } = readSince(transcript, state.offset);
  /** @type {TurnFlags} */
  const flags = { sawEdit: false, subagent: state.subagent, lastText: null, waiting: false };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { scanEntry(JSON.parse(line), flags); } catch { /* skip malformed lines */ }
  }
  if (retry) {
    writeState(statePath, { offset: next, subagent: flags.subagent });
    return;
  }
  // A running codex-review defers the gate without advancing state, so the turn's reminder can still come later.
  if (reviewPending(homedir())) return;
  // The transcript can lag the final message, so the host's last_assistant_message wins.
  const finalMessage = typeof payload.last_assistant_message === "string" && payload.last_assistant_message.trim()
    ? payload.last_assistant_message
    : flags.lastText;
  const remind = !flags.subagent && !flags.waiting && flags.sawEdit && finalMessage !== null && !hasClosing(finalMessage);
  /** @type {GateState} */
  const updated = { offset: next, subagent: flags.subagent };
  writeState(statePath, updated);
  try { pruneState(directory, statePath); } catch { /* cleanup is best effort */ }
  if (remind) process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

try {
  await main();
} catch {
  // Fail open: the gate never breaks a stop because of its own error.
}
process.exitCode = 0;
