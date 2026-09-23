// @ts-check
// Pure host-tool adapters. This module deliberately imports neither hook.mjs,
// core.mjs nor store.mjs: schemas.mjs and core.mjs consume it, so a back-import
// would create a cycle. Only node:crypto and the shared typed errors are used;
// hashing is a local canonical-JSON sha256 compatible with schemas.stableHash.

import { createHash } from "node:crypto";

import { GovernanceError } from "./errors.mjs";

export const ADAPTER_OBSERVATION_LEVEL = "host-invocation";

/**
 * The closed adapter catalog. Each capability is the only identity that can
 * become an exact permit or a passive availability observation. Anything not
 * listed here is unsupported and must stay blocked rather than guessed.
 * @type {ReadonlyArray<{adapterId:string,capability:string,effect:"read"|"external-write"|"opaque",observationLevel:string,toolNames:readonly string[],summary:string}>}
 */
const CATALOG = Object.freeze([
  Object.freeze({
    adapterId: "shell",
    capability: "shell",
    effect: /** @type {"external-write"} */ ("external-write"),
    observationLevel: ADAPTER_OBSERVATION_LEVEL,
    toolNames: Object.freeze(["Bash", "exec_command"]),
    summary: "Native shell invocation. Arbitrary argv can mutate the workspace, so it is never certified read-only.",
  }),
  Object.freeze({
    adapterId: "patch",
    capability: "patch",
    effect: /** @type {"external-write"} */ ("external-write"),
    observationLevel: ADAPTER_OBSERVATION_LEVEL,
    toolNames: Object.freeze(["apply_patch", "ApplyPatch"]),
    summary: "Patch envelope applied against the prepared writable scope.",
  }),
  Object.freeze({
    adapterId: "linear-read",
    capability: "linear-read",
    effect: /** @type {"read"} */ ("read"),
    observationLevel: ADAPTER_OBSERVATION_LEVEL,
    toolNames: Object.freeze(["mcp__linear__get_issue", "mcp__linear__get_document"]),
    summary: "Exact Linear issue and linked-document reads. Arbitrary MCP tools are unsupported.",
  }),
  Object.freeze({
    adapterId: "linear-write", capability: "linear-write", effect: /** @type {"external-write"} */ ("external-write"),
    observationLevel: ADAPTER_OBSERVATION_LEVEL,
    toolNames: Object.freeze(["mcp__linear__save_issue"]),
    summary: "Exact update of an existing issue's title, description, state or priority; no creation or implicit target.",
  }),
  Object.freeze({
    adapterId: "computer-use",
    capability: "computer-use",
    effect: /** @type {"opaque"} */ ("opaque"),
    observationLevel: ADAPTER_OBSERVATION_LEVEL,
    toolNames: Object.freeze(["mcp__cua_repl__js"]),
    summary: "Opaque Computer Use outer call. Inner JavaScript is never classified as a certified read-only operation.",
  }),
]);

/** @returns {ReadonlyArray<{adapterId:string,capability:string,effect:string,observationLevel:string,toolNames:readonly string[],summary:string}>} */
export function getAdapterCatalog() {
  return CATALOG;
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} message @returns {GovernanceError} */
function invalidInput(message) {
  return new GovernanceError(message, "invalid_tool_input");
}

// --- canonical hashing (compatible with schemas.stableHash) ----------------

/** @param {any} value @returns {any} */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/** @param {any} value @returns {string} */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** @param {any} value @returns {string} */
export function stableHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

// --- exact command grammar (shared with core/executor through hook) --------

/** Deliberately smaller than shell syntax. Quoting permits spaces, never expansion.
 * @param {unknown} command @returns {string[] | null} */
export function tokenizeExactCommand(command) {
  if (typeof command !== "string" || !command || command.length > 1024 * 1024 || /[\u0000-\u001f\u007f]/u.test(command)) return null;
  /** @type {string[]} */ const words = [];
  let word = "", quote = "", started = false;
  for (const char of command) {
    if (quote) { if (char === quote) quote = ""; else { if (quote === '"' && /[$`\\]/u.test(char)) return null; word += char; } started = true; }
    else if (char === "'" || char === '"') { quote = char; started = true; }
    else if (char === " ") { if (started) { words.push(word); word = ""; started = false; } }
    else { if (/[;$`|&<>\\(){}*?~#]/u.test(char)) return null; word += char; started = true; }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words.length ? words : null;
}

/** Every header is parsed, including both sides of a move.
 * @param {unknown} input @returns {string[]} */
export function patchPaths(input) {
  const patch = typeof input === "string" ? input : isRecord(input) && typeof input.patch === "string" ? input.patch
    : isRecord(input) && typeof input.input === "string" ? input.input
      : isRecord(input) && typeof input.command === "string" ? input.command : null;
  if (!patch || patch.length > 1024 * 1024 || !patch.startsWith("*** Begin Patch\n") || !patch.trimEnd().endsWith("*** End Patch")) throw invalidInput("Unsupported patch envelope.");
  const paths = [];
  let current = "";
  for (const line of patch.split("\n").slice(1, -1)) {
    const match = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/u.exec(line);
    if (match) {
      if (match[1] === "Move to" && current !== "Update File") throw invalidInput("Move must follow Update File.");
      if (match[1] !== "Move to") current = match[1];
      paths.push(match[2]);
    } else if (line.startsWith("*** ") && line !== "*** End of File" && line !== "*** End Patch") throw invalidInput("Unknown patch operation.");
  }
  if (!paths.length) throw invalidInput("Patch has no declared file paths.");
  return [...new Set(paths)];
}

// --- semantic input normalization -----------------------------------------

/** @param {Record<string, any>} value @param {readonly string[]} allowed @param {string} label */
function rejectUnknownKeys(value, allowed, label) {
  const permit = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permit.has(key)) throw invalidInput(`${label} has an unsupported field: ${key}`);
  }
}

/** @param {string} toolName @param {unknown} input @returns {Record<string, any>} */
function shellSemantic(toolName, input) {
  if (!isRecord(input)) throw invalidInput("shell input must be an object");
  const execMode = toolName === "exec_command";
  // Only benign, host-observed fields are retained. Interactive/detached
  // overrides (tty, run_in_background, background, detached, env, permissions)
  // are unknown here and therefore rejected instead of silently dropped.
  const allowed = execMode ? ["cmd", "workdir"] : ["command", "cwd", "workdir", "description", "timeout", "timeout_ms"];
  rejectUnknownKeys(input, allowed, "shell input");
  const commandKey = execMode ? "cmd" : "command";
  const command = input[commandKey];
  if (typeof command !== "string" || command.length === 0) throw invalidInput(`shell ${commandKey} must be a non-empty string`);
  if (command.length > 1024 * 1024) throw invalidInput("shell command exceeds the bounded length");
  /** @type {Record<string, any>} */ const semantic = { [commandKey]: command };
  if (input.cwd !== undefined) {
    if (typeof input.cwd !== "string" || input.cwd.length === 0) throw invalidInput("shell cwd must be a non-empty string");
    semantic.cwd = input.cwd;
  }
  if (input.workdir !== undefined) {
    if (typeof input.workdir !== "string" || input.workdir.length === 0) throw invalidInput("shell workdir must be a non-empty string");
    semantic.workdir = input.workdir;
  }
  if (semantic.cwd !== undefined && semantic.workdir !== undefined && semantic.cwd !== semantic.workdir) throw invalidInput("shell cwd and workdir disagree");
  if (input.description !== undefined) {
    if (typeof input.description !== "string") throw invalidInput("shell description must be a string");
    semantic.description = input.description;
  }
  for (const key of ["timeout", "timeout_ms"]) {
    if (input[key] === undefined) continue;
    if (!Number.isSafeInteger(input[key]) || input[key] < 0) throw invalidInput(`shell ${key} must be a non-negative integer`);
    semantic[key] = input[key];
  }
  return semantic;
}

/** @param {unknown} input @returns {Record<string, any>} */
function patchSemantic(input) {
  let patch = null;
  if (typeof input === "string") patch = input;
  else if (isRecord(input)) {
    rejectUnknownKeys(input, ["patch", "input", "command"], "patch input");
    const carriers = ["patch", "input", "command"].filter((key) => Object.hasOwn(input, key));
    if (!carriers.length) throw invalidInput("patch input requires a patch envelope");
    const values = carriers.map((key) => input[key]);
    if (values.some((value) => typeof value !== "string")) throw invalidInput("patch envelope must be a string");
    if (new Set(values).size !== 1) throw invalidInput("patch carriers disagree");
    patch = values[0];
  } else throw invalidInput("patch input must be a string or object");
  patchPaths(patch);
  return { patch };
}

/** @param {unknown} input @returns {Record<string, any>} */
function linearReadSemantic(input, document = false) {
  if (!isRecord(input)) throw invalidInput("linear-read input must be an object");
  rejectUnknownKeys(input, document ? ["id"] : ["id", "includeRelations"], "linear-read input");
  const id = input.id;
  const idOk = (typeof id === "string" && id.length > 0) || (Number.isSafeInteger(id) && /** @type {number} */ (id) > 0);
  if (!idOk) throw invalidInput("linear-read requires an issue id string or positive integer");
  /** @type {Record<string, any>} */ const semantic = { id };
  if (input.includeRelations !== undefined) {
    if (typeof input.includeRelations !== "boolean") throw invalidInput("linear-read includeRelations must be a boolean");
    semantic.includeRelations = input.includeRelations;
  }
  return semantic;
}

/** @param {unknown} input */
function linearWriteSemantic(input) {
  if (!isRecord(input)) throw invalidInput("linear-write input must be an object");
  rejectUnknownKeys(input, ["id", "title", "description", "state", "priority"], "linear-write input");
  if (typeof input.id !== "string" || !input.id.trim() || Object.keys(input).length < 2) throw invalidInput("linear-write requires an existing issue id and explicit changes");
  for (const key of ["title", "description", "state"]) if (input[key] !== undefined && (typeof input[key] !== "string" || !input[key].trim() || Buffer.byteLength(input[key]) > 64 * 1024)) throw invalidInput("linear-write text must be bounded and non-empty");
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 4)) throw invalidInput("linear-write priority must be in [0,4]");
  return structuredClone(input);
}

/** @param {unknown} input @returns {Record<string, any>} */
function computerUseSemantic(input) {
  if (!isRecord(input)) throw invalidInput("computer-use input must be an object");
  rejectUnknownKeys(input, ["code", "title", "timeout_ms"], "computer-use input");
  if (typeof input.code !== "string" || input.code.length === 0) throw invalidInput("computer-use requires the exact code");
  /** @type {Record<string, any>} */ const semantic = { code: input.code };
  if (input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.length === 0) throw invalidInput("computer-use title must be a non-empty string");
    semantic.title = input.title;
  }
  if (input.timeout_ms !== undefined) {
    if (!Number.isSafeInteger(input.timeout_ms) || /** @type {number} */ (input.timeout_ms) <= 0) throw invalidInput("computer-use timeout_ms must be a positive integer");
    semantic.timeout_ms = input.timeout_ms;
  }
  return semantic;
}

/** @param {string} capability @param {string} toolName @param {unknown} input */
function semanticFor(capability, toolName, input) {
  if (capability === "shell") return shellSemantic(toolName, input);
  if (capability === "patch") return patchSemantic(input);
  if (capability === "linear-read") return linearReadSemantic(input, toolName === "mcp__linear__get_document");
  if (capability === "linear-write") return linearWriteSemantic(input);
  if (capability === "computer-use") return computerUseSemantic(input);
  throw new GovernanceError(`unsupported capability: ${capability}`, "capability_missing");
}

/**
 * Describe one actual host invocation. The full raw name and input are hashed
 * for permit binding; semanticInput exists only for validation and must never
 * replace the raw identity.
 * @param {{toolName?: unknown, toolInput?: unknown}} [invocation]
 */
export function describeToolInvocation(invocation = {}) {
  if (!isRecord(invocation)) throw invalidInput("invocation must be an object");
  const toolName = invocation.toolName;
  const toolInput = invocation.toolInput;
  if (typeof toolName !== "string" || toolName.length === 0 || toolName.length > 4096) throw invalidInput("toolName must be a bounded non-empty string");
  const adapter = CATALOG.find((entry) => entry.toolNames.includes(toolName));
  if (!adapter) throw new GovernanceError(`unsupported tool: ${toolName}`, "unsupported_tool");
  const semanticInput = semanticFor(adapter.capability, toolName, toolInput);
  let rawToolInput;
  try { rawToolInput = toolInput === undefined ? null : structuredClone(toolInput); }
  catch { rawToolInput = toolInput; }
  return {
    adapterId: adapter.adapterId,
    capability: adapter.capability,
    effect: adapter.effect,
    observationLevel: ADAPTER_OBSERVATION_LEVEL,
    rawToolName: toolName,
    rawToolInput,
    toolInputHash: stableHash({ name: toolName, input: rawToolInput }),
    semanticInput,
  };
}

/**
 * Validate a declared capability list against the closed catalog. Unknown
 * capability names are reported as capability_missing, never silently ignored.
 * @param {unknown} value @returns {string[]}
 */
export function validateRequiredCapabilities(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new GovernanceError("required capabilities must be an array of known capability names", "invalid_tool_input");
  const known = new Set(CATALOG.map((entry) => entry.capability));
  /** @type {string[]} */ const out = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) throw new GovernanceError("each required capability must be a non-empty string", "invalid_tool_input");
    if (!known.has(entry)) throw new GovernanceError(`unsupported capability: ${entry}`, "capability_missing", { missingCapabilities: [entry] });
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

// --- result classification -------------------------------------------------

/** Strong, line-anchored error envelopes. Absence of an explicit completion
 * signal stays unknown; success is never inferred from mere output text. */
const ERROR_ENVELOPE = Object.freeze([
  /^[ \t]*(?:error|fatal|exception|traceback|panic|unhandled)\b[^\n]*/imu,
  /^[ \t]*command failed\b[^\n]*/imu,
  /^[ \t]*exit (?:code|status)\s*[:=]?\s*[1-9]\d*\b[^\n]*/imu,
  /^[ \t]*(?:sh|bash|zsh|dash|node|python3?|ruby|perl|npm|pnpm|yarn|bun):[^\n]*(?:not found|no such file|permission denied|cannot|failed)[^\n]*/imu,
  /\bcommand not found\b/iu,
  /\bno such file or directory\b/iu,
  /\bpermission denied\b/iu,
  /\b(?:ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|ELOOP|ETIMEDOUT|ECONNREFUSED)\b/u,
]);

/** @param {string} text */
function hasErrorEnvelope(text) {
  return ERROR_ENVELOPE.some((pattern) => pattern.test(text));
}

/** @param {string} text @returns {any} */
function parseJson(text) {
  if (!(text.startsWith("{") || text.startsWith("["))) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

/** @param {any} output @returns {{status:"success"|"failed"|"unknown",code:string}|null} */
function classifyStructured(output) {
  if (!isRecord(output)) return null;
  const exit = output.exit_code ?? output.exitCode;
  if (Number.isSafeInteger(exit)) return exit === 0 ? { status: "success", code: "exit-code-zero" } : { status: "failed", code: "exit-code-nonzero" };
  if (output.isError === true || output.is_error === true) return { status: "failed", code: "error-flag" };
  if (Array.isArray(output.errors) && output.errors.length > 0) return { status: "failed", code: "errors-present" };
  if (output.error !== undefined && output.error !== null && output.error !== false && output.error !== "") return { status: "failed", code: "error-field" };
  if (output.success === true) return { status: "success", code: "success-flag" };
  if (output.success === false) return { status: "failed", code: "failure-flag" };
  return null;
}

/** @param {any} output @returns {{status:"success"|"failed"|"unknown",code:string}|null} */
function classifyContent(output) {
  if (!isRecord(output) || !Array.isArray(output.content)) return null;
  if (output.isError === true || output.is_error === true) return { status: "failed", code: "content-error" };
  const texts = output.content.filter((/** @type {any} */ block) => isRecord(block) && typeof block.text === "string").map((/** @type {any} */ block) => block.text);
  if (texts.some((/** @type {string} */ text) => hasErrorEnvelope(text))) return { status: "failed", code: "content-error-envelope" };
  if (output.content.length === 0) return { status: "unknown", code: "empty-content" };
  return { status: "success", code: "content-observed" };
}

/** Content blocks take precedence so MCP/Computer Use envelopes keep their
 * transport-specific codes even when a generic error flag is also present.
 * @param {any} output @returns {{status:"success"|"failed"|"unknown",code:string}|null} */
function classifyObject(output) {
  if (!isRecord(output)) return null;
  if (Array.isArray(output.content)) return classifyContent(output) ?? classifyStructured(output);
  return classifyStructured(output) ?? classifyContent(output);
}

/**
 * Classify an actual host result envelope. MCP/Computer Use/shell transport
 * success is never product acceptance; callers must keep that distinction.
 * @param {unknown} descriptor @param {unknown} output @returns {{status:"success"|"failed"|"unknown",code:string}}
 */
export function classifyToolResult(descriptor, output) {
  if (!isRecord(descriptor) || typeof descriptor.capability !== "string") throw invalidInput("descriptor must be a tool adapter descriptor");
  if (output === undefined || output === null) return { status: "unknown", code: "no-output" };
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (trimmed.length === 0) return { status: "unknown", code: "empty-output" };
    // Native shell PostToolUse carries stdout, not exit metadata. Even JSON
    // printed by the command is data and cannot attest its process outcome.
    if (descriptor.capability === "shell") return hasErrorEnvelope(output)
      ? { status: "failed", code: "error-envelope" }
      : { status: "unknown", code: "stdout-without-exit" };
    if (descriptor.capability === "patch" && /^Success\. Updated the following files:\n(?:[AMD] .+\n?)+$/u.test(output)) return { status: "success", code: "patch-completed" };
    const parsed = parseJson(trimmed);
    if (parsed !== undefined) {
      const structured = classifyObject(parsed);
      if (structured) return structured;
    }
    if (hasErrorEnvelope(output)) return { status: "failed", code: "error-envelope" };
    return { status: "unknown", code: "string-without-outcome" };
  }
  const structured = classifyObject(output);
  if (structured) return structured;
  if (Array.isArray(output)) return { status: "unknown", code: "array-without-outcome" };
  return { status: "unknown", code: "unclassified" };
}
