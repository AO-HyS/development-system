#!/usr/bin/env node
// @ts-check

/**
 * Stop hook for Claude Code and Codex. Blocks the first stop of a session that changed files
 * without producing a completion report, then allows every later stop. It also reminds once
 * when a dev or model server this session started is still listening. Fails open on any
 * internal error. State lives in ~/.development-system/private/runs/report-gate/<session>.json.
 */

import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, realpathSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const reason = "Files changed this session and no report was produced. Write the concise report packet (flow-implement/references/completion-report.md), run `development-system document --input <packet> --json`, then deliver it durably: render it in this T3 thread or give its persistent htmlPath. A reader-live tunnel link is optional and never the only delivery; state its expiry if you add one. If a report is truly not useful, say why in one line. This reminder appears once.";

const serverReason = (/** @type {string} */ list) => `A server matching one this session started may still be listening: ${list}. If you launched it, stop that PID (never by name); if you did not, leave it alone. Say in one line why one must keep running. This reminder appears once.`;
/** A command that starts a long-lived dev or model server. */
const serverStart = /(?:^|[\s;&|(])(?:(?:vite|next|astro|wrangler|convex|remix|nuxt)\s+dev\b|(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b|server\.py\b|http\.server\b|workerd\s+serve\b)/u;
/** Ports named in a server command: `http.server N`, --port N, -p N, PORT=N, :N in a localhost URL. */
const portPatterns = [/\bhttp\.server\s+(\d{2,5})\b/gu, /--port[=\s]+(\d{2,5})/gu, /(?:^|\s)-p\s+(\d{2,5})\b/gu, /\bPORT=(\d{2,5})/gu, /(?:localhost|127\.0\.0\.1):(\d{2,5})/gu];
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
 * @typedef {{port: number, dir: string}} Launch
 * @typedef {{offset: number, sawEdit: boolean, sawReport: boolean, blocked: boolean, subagent: boolean, startedAt: number, launches: Launch[], serversWarned: boolean}} GateState
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

/** @param {string} literal a JS string literal @returns {string} */
function unquote(literal) {
  if (literal.startsWith("\"")) {
    try { return String(JSON.parse(literal)); } catch { /* fall through */ }
  }
  return literal.slice(1, -1).replace(/\\(.)/gu, "$1");
}

// A double, single or backtick JS string literal (backticks are not escaped: the regex is in unicode mode).
const jsString = "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)";

/**
 * The source with every comment and the inside of every string or template literal replaced by
 * spaces (same length, quotes kept), so code structure can be read without text getting in the way.
 * @param {string} source
 */
function maskJs(source) {
  const out = source.split("");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? source.indexOf("\n", index) : source.indexOf("*/", index + 2) + 1;
      const stop = end <= 0 ? source.length - 1 : end;
      for (let k = index; k <= stop; k += 1) if (out[k] !== "\n") out[k] = " ";
      index = stop;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      let k = index + 1;
      for (; k < source.length && source[k] !== char; k += 1) {
        if (source[k] === "\\") { out[k] = " "; k += 1; }
        out[k] = " ";
      }
      index = k;
    }
  }
  return out.join("");
}

/**
 * Codex code mode runs JavaScript whose tool calls look like
 * `tools.exec_command({cmd:"...", workdir:"..."})`. Only the argument object of each real
 * exec_command call (not one inside a comment or string) is read, so a cmd and a workdir from
 * different calls never pair up.
 * @param {string} source @returns {{command: string, dir?: string}[]}
 */
function codeModeCommands(source) {
  /** @type {{command: string, dir?: string}[]} */
  const commands = [];
  const masked = maskJs(source);
  for (const call of masked.matchAll(/\bexec_command\s*\(\s*\{/gu)) {
    const start = /** @type {number} */ (call.index) + call[0].length - 1;
    let depth = 0, end = -1;
    for (let k = start; k < masked.length; k += 1) {
      if (masked[k] === "{") depth += 1;
      else if (masked[k] === "}" && --depth === 0) { end = k; break; }
    }
    if (end === -1) continue;
    // Find keys on the masked top level (comments, strings and nested objects blanked), then
    // read each value from the original text at the same offset.
    const maskedBody = masked.slice(start, end + 1);
    let level = 0;
    const topLevel = maskedBody.split("").map((char) => {
      if (char === "{") level += 1;
      const keep = level <= 1;
      if (char === "}") level -= 1;
      return keep ? char : " ";
    }).join("");
    /**
     * The value literal of a top-level property whose name is one of `names`. Keys may be bare
     * (`cmd:`) or quoted (`"cmd":`); a quoted key is blanked in the mask, so its name is read
     * from the original text at the same offset.
     * @param {string[]} names
     */
    const value = (names) => {
      const property = /(?:^|[{,\s])(?:([A-Za-z_$][\w$]*)|(["'])[^"'\n]*\2)\s*:\s*(["'`])/gu;
      for (const at of topLevel.matchAll(property)) {
        const keyStart = start + /** @type {number} */ (at.index) + at[0].search(/[A-Za-z_$"']/u);
        let name = at[1];
        if (name === undefined) {
          const quoted = new RegExp(jsString, "uy");
          quoted.lastIndex = keyStart;
          const literal = quoted.exec(source);
          if (!literal) continue;
          name = unquote(literal[1]);
        }
        if (!names.includes(name)) continue;
        const literal = new RegExp(jsString, "uy");
        literal.lastIndex = start + /** @type {number} */ (at.index) + at[0].length - 1;
        const match = literal.exec(source);
        if (match) return unquote(match[1]);
      }
      return undefined;
    };
    const command = value(["cmd"]);
    if (command === undefined) continue;
    const dir = value(["workdir", "cwd"]);
    commands.push({ command, ...(dir !== undefined ? { dir } : {}) });
  }
  return commands;
}

/**
 * @param {{name: string, input: unknown}} call
 * @param {{sawEdit: boolean, sawReport: boolean, launches: Launch[]}} flags
 * @param {string} sessionCwd
 */
function classifyCall(call, flags, sessionCwd) {
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
  /** @type {{command: string, dir?: string}[]} */
  let commands = [];
  if (call.name === "exec" && typeof call.input === "string" && !call.input.trimStart().startsWith("{")) {
    // Codex code mode: JavaScript source.
    if (/\bapply_patch\b|\*\*\* Begin Patch/u.test(call.input)) flags.sawEdit = true;
    if (/\bspawn_agent\b/u.test(call.input) && call.input.includes(writerMarker)) flags.sawEdit = true;
    commands = codeModeCommands(call.input);
  } else if (shellTools.has(call.name)) {
    const dir = typeof input.workdir === "string" ? input.workdir : typeof input.cwd === "string" ? input.cwd : undefined;
    commands = [{ command: commandText(input.command ?? input.cmd), ...(dir ? { dir } : {}) }];
  } else {
    return;
  }
  for (const { command, dir: callDir } of commands) {
    if (!command) continue;
    const bare = stripQuoted(command);
    if (reportPattern.test(bare)) flags.sawReport = true;
    if (writesFiles(bare)) flags.sawEdit = true;
    if (serverStart.test(bare) || /\bnohup\b/u.test(bare)) {
      // Where this launch ran: an absolute `cd` in the command, else the call's own working
      // directory, else the session cwd. Each port is tied to that one directory.
      const token = /(?:^|[;&|(]\s*)cd\s+('[^']*'|"(?:[^"\\]|\\.)*"|[^\s;&|)]+)/u.exec(command)?.[1];
      // Shell quoting is not part of the path: `cd '/a b'` means /a b.
      const cd = token === undefined ? undefined : token.startsWith("'") ? token.slice(1, -1) : token.startsWith("\"") ? token.slice(1, -1).replace(/\\(.)/gu, "$1") : token.replace(/\\(.)/gu, "$1");
      const base = callDir ?? sessionCwd;
      const dir = cd ? (cd.startsWith("/") ? cd : base ? join(base, cd) : "") : base;
      if (!dir) continue;
      for (const pattern of portPatterns) for (const match of command.matchAll(pattern)) {
        const port = Number(match[1]);
        if (port >= 1024 && !flags.launches.some((launch) => launch.port === port && launch.dir === dir)) flags.launches.push({ port, dir });
      }
    }
  }
}

/**
 * @param {any} entry
 * @param {{sawEdit: boolean, sawReport: boolean, subagent: boolean, launches: Launch[]}} flags
 * @param {string} sessionCwd
 */
function scanEntry(entry, flags, sessionCwd) {
  if (!entry || typeof entry !== "object") return;
  // Claude Code transcript.
  if (entry.type === "assistant" && !entry.isSidechain && Array.isArray(entry.message?.content)) {
    for (const block of entry.message.content) {
      if (block?.type === "tool_use" && typeof block.name === "string") classifyCall({ name: block.name, input: block.input }, flags, sessionCwd);
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
    classifyCall({ name: payload.name, input: payload.arguments }, flags, sessionCwd);
  } else if (payload.type === "custom_tool_call" && typeof payload.name === "string") {
    classifyCall({ name: payload.name, input: payload.input }, flags, sessionCwd);
  } else if (payload.type === "local_shell_call") {
    classifyCall({ name: "local_shell", input: { command: payload.action?.command, workdir: payload.action?.working_directory } }, flags, sessionCwd);
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
      startedAt: Number.isFinite(value.startedAt) ? value.startedAt : Date.now(),
      launches: Array.isArray(value.launches) ? value.launches.filter((/** @type {any} */ launch) => Number.isInteger(launch?.port) && typeof launch?.dir === "string") : [],
      serversWarned: value.serversWarned === true,
    };
  } catch {
    return { offset: 0, sawEdit: false, sawReport: false, blocked: false, subagent: false, startedAt: Date.now(), launches: [], serversWarned: false };
  }
}

/** @param {string} path @param {GateState} state */
function writeState(path, state) {
  const temporary = `${path}.${process.pid}.tmp`;
  // O_EXCL never follows a symlink: a planted link at the temporary name makes the write fail (fail open).
  try { unlinkSync(temporary); } catch { /* usually absent */ }
  writeFileSync(temporary, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
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

/**
 * Listening processes matching one of this session's server launches: the launch's port,
 * started after the session began, and running under that launch's directory. Port and time
 * alone do not prove ownership, so all three must match, and the reminder asks the agent to
 * confirm it launched the process; the gate never kills.
 * @param {Launch[]} launches @param {number} since @returns {string[]}
 */
function liveServers(launches, since) {
  /** @type {string[]} */
  const found = [];
  for (const { port, dir } of launches) {
    let out = "";
    try { out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8", timeout: 2000 }); }
    catch { continue; }
    const pid = Number(/^p(\d+)/mu.exec(out)?.[1]);
    const name = /^c(.+)$/mu.exec(out)?.[1] ?? "process";
    if (!Number.isInteger(pid)) continue;
    let started = 0;
    try { started = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).trim()); }
    catch { continue; }
    // ps reports whole seconds, so compare at that precision.
    if (!Number.isFinite(started) || started < Math.floor(since / 1000) * 1000) continue;
    let cwd = "";
    try { cwd = /^n(.+)$/mu.exec(execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8", timeout: 2000 }))?.[1] ?? ""; }
    catch { continue; }
    let root = dir;
    try { root = realpathSync(dir); } catch { /* keep as given */ }
    if (cwd !== root && !cwd.startsWith(`${root.replace(/\/$/u, "")}/`)) continue;
    found.push(`${name} pid ${pid} on :${port} in ${cwd}`);
  }
  return found;
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
  const fresh = (() => { try { statSync(statePath); return false; } catch { return true; } })();
  const state = readState(statePath);
  // The session began when its transcript did, so servers started before the first stop count.
  if (fresh) { try { state.startedAt = statSync(transcript).birthtimeMs || state.startedAt; } catch { /* keep now */ } }
  const { text, next } = readSince(transcript, state.offset);
  const flags = { sawEdit: state.sawEdit, sawReport: state.sawReport, subagent: state.subagent, launches: [...state.launches] };
  const sessionCwd = typeof payload.cwd === "string" ? payload.cwd : "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { scanEntry(JSON.parse(line), flags, sessionCwd); } catch { /* skip malformed lines */ }
  }
  // A running codex-review defers the gate without advancing state, so the one reminder can still come later.
  if (reviewPending(homedir())) return;
  /** @type {GateState} */
  const updated = { offset: next, ...flags, blocked: state.blocked, startedAt: state.startedAt, serversWarned: state.serversWarned };
  // The report reminder fires once per session; once it has, later stops only check servers.
  const block = !state.blocked && !flags.subagent && flags.sawEdit && !flags.sawReport;
  if (block) updated.blocked = true;
  const servers = state.serversWarned ? [] : liveServers(flags.launches, state.startedAt);
  if (servers.length > 0) updated.serversWarned = true;
  writeState(statePath, updated);
  try { pruneState(directory, statePath); } catch { /* cleanup is best effort */ }
  // Both reminders go out in the same block: the hook does not run again while stop_hook_active is set.
  const reasons = [...(block ? [reason] : []), ...(servers.length > 0 ? [serverReason(servers.join(", "))] : [])];
  if (reasons.length > 0) process.stdout.write(`${JSON.stringify({ decision: "block", reason: reasons.join(" ") })}\n`);
}

try {
  await main();
} catch {
  // Fail open: the gate never breaks a stop because of its own error.
}
process.exitCode = 0;
