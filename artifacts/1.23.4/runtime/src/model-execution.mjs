// @ts-check
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Rates per million tokens, explicitly authorized benchmark equivalents, not subscription charges. */
export const modelPricing = Object.freeze(JSON.parse(await readFile(new URL("../config/1.23.0/api-prices.json", import.meta.url), "utf8")));

/** @param {any} profile */
function validateProfile(profile) {
  const valid = profile?.adapter === "codex"
    ? (profile.model === "gpt-6-astra" && profile.effort === "xhigh") || (profile.model === "gpt-5.6-sol" && profile.effort === "high")
    : profile?.adapter === "opencode" && profile.model === "opencode-go/deepseek-v4.1-flash" && profile.effort === "high";
  if (!valid) throw new Error("unsupported_model_profile");
}

/** @param {string} path @param {any} value */
async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/** Reject aliases and symlink escapes before storing prompts or provider output.
 * @param {string} path
 */
async function freshPrivateDirectory(path) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) throw new Error("invalid_evidence_directory");
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (await realpath(parent) !== parent) throw new Error("aliased_evidence_directory");
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
}

/** @param {string} path */
async function optionalText(path) {
  try { return await readFile(path, "utf8"); } catch { return ""; }
}

/** @param {string} content @returns {any[]} */
function jsonLines(content) {
  return content.split("\n").flatMap((line) => {
    try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; }
  });
}

/** @param {string} sessions @param {string} id @param {boolean} [deep] @returns {Promise<string | null>} */
async function findSession(sessions, id, deep = false) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const dates = [new Date(), new Date(Date.now() - 86400000)];
  for (const date of dates) {
    const directory = join(sessions, date.toISOString().slice(0, 10).replaceAll("-", "/"));
    try {
      const name = (await readdir(directory)).find((item) => item.endsWith(`${id}.jsonl`));
      if (name) return join(directory, name);
    } catch { /* The native session may not yet have flushed. */ }
  }
  if (deep) {
    try {
      const name = (await readdir(sessions, { recursive: true })).find((item) => item.endsWith(`${id}.jsonl`));
      if (name) return join(sessions, name);
    } catch { /* Unknown identity fails closed at the caller. */ }
  }
  return null;
}

/** @param {any} value */
const count = (value) => Number.isSafeInteger(value) && value >= 0;

/** Fresh-session cumulative counters may repeat or reset; never sum cumulative snapshots.
 * Input already includes cached input. Output already includes reasoning output.
 * @param {any[]} events
 */
export function summarizeCodexUsage(events) {
  return summarizeCodexAccounting(events).usage;
}

/** @param {any[]} events */
export function summarizeCodexAccounting(events) {
  const fields = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "cache_write_input_tokens"];
  const infos = events.filter((event) => event.type === "event_msg" && event.payload?.type === "token_count")
    .map((event) => event.payload.info).filter((info) => info?.total_token_usage && count(info.total_token_usage.input_tokens) && count(info.total_token_usage.output_tokens));
  /** @type {Record<string, number>} */
  const totals = Object.fromEntries(fields.map((field) => [field, 0]));
  /** @type {Record<string, number>} */
  let previous = {};
  const missing = new Set();
  /** @type {any[]} */
  const requests = [];
  let requestsComplete = true;
  for (const info of infos) {
    const snapshot = info.total_token_usage;
    /** @type {Record<string, number>} */
    const deltas = {};
    for (const field of fields) {
      if (!count(snapshot[field])) { missing.add(field); continue; }
      const prior = previous?.[field];
      deltas[field] = prior === undefined || snapshot[field] < prior ? snapshot[field] : snapshot[field] - prior;
      totals[field] += deltas[field];
    }
    // Optional breakdown disappearance is unknown telemetry, never a reset of input/output.
    previous = { ...previous, ...Object.fromEntries(fields.filter((field) => count(snapshot[field])).map((field) => [field, snapshot[field]])) };
    if ((deltas.input_tokens ?? 0) === 0 && (deltas.output_tokens ?? 0) === 0) continue;
    const last = info.last_token_usage;
    const complete = last && count(last.input_tokens) && count(last.cached_input_tokens) && count(last.output_tokens)
      && last.input_tokens === deltas.input_tokens && last.output_tokens === deltas.output_tokens;
    if (complete) requests.push({ input: last.input_tokens, cachedInput: last.cached_input_tokens, output: last.output_tokens,
      reasoningOutput: count(last.reasoning_output_tokens) ? last.reasoning_output_tokens : null,
      total: last.input_tokens + last.output_tokens, cacheWriteInput: count(last.cache_write_input_tokens) ? last.cache_write_input_tokens : 0 });
    else requestsComplete = false;
  }
  if (!infos.length) return { usage: null, usageComplete: false, requests: [], requestsComplete: false };
  return { usage: { input: totals.input_tokens, cachedInput: missing.has("cached_input_tokens") ? null : totals.cached_input_tokens,
    output: totals.output_tokens, reasoningOutput: missing.has("reasoning_output_tokens") ? null : totals.reasoning_output_tokens,
    total: totals.input_tokens + totals.output_tokens, cacheWriteInput: missing.has("cache_write_input_tokens") ? null : totals.cache_write_input_tokens },
  usageComplete: !["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "cache_write_input_tokens"].some((field) => missing.has(field)),
  requests, requestsComplete };
}

/** OpenCode input excludes cache, while output excludes its separately stored reasoning count.
 * Deduplicate assistant IDs, retaining the latest (possibly failed) observation.
 * @param {any[]} messages
 */
export function summarizeFlashUsage(messages) {
  const assistants = [...new Map(messages.filter((message) => message.info?.role === "assistant" && message.info?.id)
    .map((message) => [message.info.id, message])).values()];
  // Step parts retain every provider request; assistant.tokens can contain only the last step.
  const records = assistants.flatMap((message) => {
    const steps = [...new Map((message.parts ?? []).filter((/** @type {any} */ part) => part.type === "step-finish" && part.id)
      .map((/** @type {any} */ part) => [part.id, part])).values()];
    return steps.length ? steps : [message.info];
  });
  const finalized = (/** @type {any} */ info) => info.type === "step-finish" || Boolean(info.finish);
  const unknownPlaceholder = (/** @type {any} */ info) => !finalized(info) && [info.tokens?.input, info.tokens?.output,
    info.tokens?.reasoning, info.tokens?.cache?.read, info.tokens?.cache?.write].every((value) => value === 0);
  const observed = records.filter((info) => count(info.tokens?.input) && count(info.tokens?.output) && !unknownPlaceholder(info));
  const costs = records.filter((info) => typeof info.cost === "number" && Number.isFinite(info.cost) && info.cost >= 0 && !unknownPlaceholder(info));
  const reportedKnownCostUsd = costs.length ? costs.reduce((sum, info) => sum + info.cost, 0) : null;
  const reportedCostComplete = records.length > 0 && costs.length === records.length && records.every(finalized);
  if (!observed.length) return { usage: null, reportedCostUsd: reportedCostComplete ? reportedKnownCostUsd : null,
    reportedKnownCostUsd, reportedCostComplete, usageComplete: false, requests: [] };
  const usage = { input: 0, cachedInput: 0, output: 0, reasoningOutput: 0, total: 0, cacheWriteInput: 0 };
  /** @type {any[]} */
  const requests = [];
  let breakdownComplete = true;
  for (const info of observed) {
    const token = info.tokens;
    const cached = count(token.cache?.read) ? token.cache.read : 0;
    const written = count(token.cache?.write) ? token.cache.write : 0;
    const reasoning = count(token.reasoning) ? token.reasoning : 0;
    usage.input += token.input + cached + written;
    usage.cachedInput += cached;
    usage.cacheWriteInput += written;
    usage.output += token.output + reasoning;
    usage.reasoningOutput += reasoning;
    const complete = count(token.cache?.read) && count(token.cache?.write) && count(token.reasoning);
    breakdownComplete &&= complete;
    if (complete) requests.push({ input: token.input + cached + written, cachedInput: cached, cacheWriteInput: written,
      output: token.output + reasoning, reasoningOutput: reasoning, total: token.input + cached + written + token.output + reasoning });
  }
  usage.total = usage.input + usage.output;
  return { usage, reportedCostUsd: reportedCostComplete ? reportedKnownCostUsd : null, reportedKnownCostUsd, reportedCostComplete,
    usageComplete: observed.length === records.length && breakdownComplete && records.every(finalized), requests };
}

/** @param {string} model @param {any} usage @param {any} [flashModel] */
export function equivalentCost(model, usage, flashModel) {
  if (!usage) return null;
  const flashRates = flashModel?.cost?.tiers?.filter((/** @type {any} */ tier) => tier.tier?.type === "context" && usage.input > tier.tier.size)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.tier.size - a.tier.size)[0] ?? flashModel?.cost;
  const rates = model === "gpt-6-astra" || model === "gpt-5.6-sol" ? modelPricing.models[model]
    : flashRates ? { input: flashRates.input, cachedInput: flashRates.cache?.read,
      cacheWriteInput: flashRates.cache?.write, output: flashRates.output } : null;
  if (!rates || ![rates.input, rates.cachedInput, rates.output].every((rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0)) return null;
  if (![usage.input, usage.cachedInput, usage.output].every(count)) return null;
  const written = count(usage.cacheWriteInput) ? usage.cacheWriteInput : 0;
  if (usage.cachedInput + written > usage.input) return null;
  const writeRate = typeof rates.cacheWriteInput === "number" ? rates.cacheWriteInput : rates.input;
  const long = (model === "gpt-6-astra" || model === "gpt-5.6-sol") && usage.input > modelPricing.openaiLongContext.inputTokensGreaterThan;
  const inputMultiplier = long ? modelPricing.openaiLongContext.inputMultiplier : 1;
  const cacheMultiplier = long ? modelPricing.openaiLongContext.cacheMultiplier : 1;
  const outputMultiplier = long ? modelPricing.openaiLongContext.outputMultiplier : 1;
  return ((usage.input - usage.cachedInput - written) * rates.input * inputMultiplier
    + usage.cachedInput * rates.cachedInput * cacheMultiplier + written * writeRate * inputMultiplier + usage.output * rates.output * outputMultiplier) / 1e6;
}

/** @param {number} pid @param {NodeJS.Signals} signal */
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch (error) { return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH"; }
}

/** @param {number} pid */
function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { return /** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH"; }
}

/** Wait for the root and surviving descendants, including children whose parent already exited.
 * @param {any} task
 */
async function terminate(task) {
  if (!task?.child?.pid) return true;
  if (!signalGroup(task.child.pid, "SIGTERM")) {
    // A just-exited CLI may race a group signal. Recheck; never let cleanup erase the receipt.
    await delay(50);
    if (groupAlive(task.child.pid)) {
      try { task.child.kill("SIGTERM"); } catch { /* Verified below, reported when unconfirmed. */ }
    }
  }
  const deadline = Date.now() + 2000;
  while (groupAlive(task.child.pid) && Date.now() < deadline) await delay(40);
  if (groupAlive(task.child.pid)) signalGroup(task.child.pid, "SIGKILL");
  const waiting = new AbortController();
  let closed;
  try { closed = await Promise.race([task.closed.then(() => true), delay(3000, undefined, { signal: waiting.signal }).then(() => false)]); }
  finally { waiting.abort(); }
  return closed && !groupAlive(task.child.pid);
}

/** @param {string[]} argv @param {any} options */
async function launch(argv, options) {
  const stdout = await open(options.stdout, "wx", 0o600);
  const stderr = await open(options.stderr, "wx", 0o600);
  const child = spawn(argv[0], argv.slice(1), { cwd: options.cwd, env: options.env ?? process.env,
    detached: true, stdio: ["pipe", stdout.fd, stderr.fd] });
  /** @type {{code: number | null, signal: string | null, error: string | null}} */
  const terminal = { code: null, signal: null, error: null };
  const closed = new Promise((accept) => {
    child.once("error", () => { terminal.error = "process_spawn_failed"; });
    child.once("close", async (code, signal) => {
      terminal.code = code;
      terminal.signal = signal;
      await Promise.all([stdout.close(), stderr.close()]);
      accept(terminal);
    });
  });
  child.stdin?.on("error", () => { /* Early termination may close stdin before the packet is read. */ });
  child.stdin?.end(options.prompt ?? "");
  return { child, closed, terminal };
}

/** Credentials and child handles live outside the serializable public server context. @type {WeakMap<object, any>} */
const serverState = new WeakMap();

/** @param {any} server @param {string} path @param {string} [method] @param {any} [body] @param {string} [directory] */
async function serverRequest(server, path, method = "GET", body, directory) {
  const privateState = serverState.get(server);
  if (!privateState || privateState.stopped) throw new Error("flash_server_unavailable");
  const url = new URL(server.url + path);
  if (directory) url.searchParams.set("directory", directory);
  const response = await fetch(url, { method,
    headers: { Authorization: `Basic ${privateState.authorization}`, "Content-Type": "application/json",
      ...(directory ? { "x-opencode-directory": encodeURIComponent(directory) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`flash_server_http_${response.status}`);
  return response.json();
}

/** One private database/server supports concurrent independent sessions. Does not alter global config.
 * @param {{evidenceDirectory: string, cwd: string, permission?: any, signal?: AbortSignal, runtime?: any}} options
 */
export async function startFlashServer(options) {
  await freshPrivateDirectory(options.evidenceDirectory);
  const root = options.evidenceDirectory;
  /** @type {Record<string, string>} */
  const overlay = {};
  for (const [key, directory] of [["XDG_DATA_HOME", "data"], ["XDG_STATE_HOME", "state"], ["XDG_CACHE_HOME", "cache"], ["XDG_CONFIG_HOME", "config"]]) {
    overlay[key] = join(root, directory);
    await mkdir(join(root, directory, "opencode"), { recursive: true, mode: 0o700 });
  }
  Object.assign(overlay, { OPENCODE_CONFIG_DIR: join(root, "config/opencode"), OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_PRUNE: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true" });
  const authPath = options.runtime?.authPath ?? join(homedir(), ".local/share/opencode/auth.json");
  const auth = await lstat(authPath);
  if (!auth.isFile() || auth.mode & 0o077) throw new Error("flash_auth_must_be_private_file");
  await symlink(authPath, join(root, "data/opencode/auth.json"));
  await copyFile(options.runtime?.catalogPath ?? join(homedir(), ".cache/opencode/models.json"), join(root, "cache/opencode/models.json"));
  await chmod(join(root, "cache/opencode/models.json"), 0o600);
  await privateJson(join(root, "config/opencode/opencode.json"), {
    model: "opencode-go/deepseek-v4.1-flash", small_model: "opencode-go/deepseek-v4.1-flash",
    share: "disabled", snapshot: false, permission: { ...(options.permission ?? { "*": "deny" }), task: "deny" },
  });
  await privateJson(join(root, "environment.json"), overlay);
  const password = randomBytes(32).toString("base64url");
  const env = { ...process.env, ...overlay, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: "opencode" };
  for (const key of ["OPENCODE_CONFIG_CONTENT", "OPENCODE_CONFIG", "OPENCODE_PERMISSION"]) delete /** @type {any} */ (env)[key];
  const argv = [options.runtime?.command ?? "opencode", "serve", "--pure", "--hostname", "127.0.0.1", "--port", "0"];
  const task = await launch(argv, { cwd: options.cwd, env, stdout: join(root, "server-stdout.log"), stderr: join(root, "server-stderr.log") });
  /** @type {any} */
  const server = { url: null, pid: task.child.pid ?? null, evidenceDirectory: root, model: null, stopped: false };
  serverState.set(server, { task, env, authorization: Buffer.from(`opencode:${password}`).toString("base64"), stopped: false, active: new Map() });
  const startedAt = new Date().toISOString();
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new Error("cancelled");
      if (task.child.exitCode !== null || task.terminal.error) throw new Error("flash_server_exited_before_ready");
      const match = (await optionalText(join(root, "server-stdout.log"))).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        server.url = match[0];
        try {
          const health = await serverRequest(server, "/global/health");
          if (health.healthy) {
            const providers = await serverRequest(server, "/config/providers");
            server.model = providers.providers?.find((/** @type {any} */ p) => p.id === "opencode-go")?.models?.["deepseek-v4.1-flash"] ?? null;
            if (!server.model || server.model.variants?.high?.reasoningEffort !== "high") throw new Error("flash_high_variant_unavailable");
            await privateJson(join(root, "server-started.json"), { argv, startedAt, pid: server.pid, url: server.url,
              model: server.model, credentialHandling: "private auth pointer; ephemeral server authorization stays in memory" });
            return server;
          }
        } catch (error) {
          if (error instanceof Error && error.message === "flash_high_variant_unavailable") throw error;
        }
      }
      await delay(100);
    }
    throw new Error("flash_server_readiness_timeout");
  } catch (error) {
    await stopFlashServer(server);
    await privateJson(join(root, "server-failed.json"), { startedAt, endedAt: new Date().toISOString(), error: error instanceof Error ? error.message.replace(/[^a-z_0-9]/g, "_") : "server_start_failed" });
    throw new Error("flash_server_start_failed");
  }
}

/** @param {any} server @param {string} session */
async function abortFlashSession(server, session) {
  const directory = serverState.get(server)?.active.get(session);
  await serverRequest(server, `/session/${encodeURIComponent(session)}/abort`, "POST", undefined, directory);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const statuses = await serverRequest(server, "/session/status", "GET", undefined, directory);
    if (!statuses[session] || statuses[session].type === "idle") return true;
    await delay(50);
  }
  return false;
}

/** @param {any} server */
export async function stopFlashServer(server) {
  const state = serverState.get(server);
  if (!state || state.stopped) return;
  const cancellations = await Promise.allSettled([...state.active.keys()].map((session) => abortFlashSession(server, session)));
  const terminated = await terminate(state.task);
  state.stopped = terminated;
  server.stopped = terminated;
  await privateJson(join(server.evidenceDirectory, "server-stopped.json"), { endedAt: new Date().toISOString(),
    pid: server.pid, exitCode: state.task.terminal.code, signal: state.task.terminal.signal,
    activeSessionAborts: cancellations.map((result) => result.status === "fulfilled" && result.value === true), terminated });
}

/** Fresh session for every packet. Unknown or mismatched observed identity cannot pass.
 * runtime supplies executable/session paths only for isolated process-fixture tests.
 * @param {{profile: {adapter: string, model: string, effort: string}, cwd: string, prompt: string,
 * evidenceDirectory: string, phase?: string, arm?: string, outputSchema?: any, server?: any,
 * sandbox?: "read-only" | "workspace-write" | "danger-full-access", timeoutMs?: number,
 * signal?: AbortSignal, runtime?: any}} options
 */
export async function runModel(options) {
  validateProfile(options.profile);
  const sandbox = options.sandbox ?? "read-only";
  if (!["read-only", "workspace-write", "danger-full-access"].includes(sandbox)) throw new Error("invalid_sandbox");
  if (typeof options.prompt !== "string" || !options.prompt.trim()) throw new Error("empty_model_packet");
  if (!isAbsolute(options.cwd) || await realpath(options.cwd) !== options.cwd) throw new Error("invalid_model_working_directory");
  if (options.profile.adapter === "opencode" && !serverState.has(options.server)) throw new Error("flash_requires_initialized_server");
  await freshPrivateDirectory(options.evidenceDirectory);
  const root = options.evidenceDirectory;
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? 900000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("invalid_model_deadline");
  const profile = options.profile;
  let prompt = options.prompt;
  /** @type {string | null} */
  let schemaPath = null;
  if (options.outputSchema) {
    const schema = typeof options.outputSchema === "string" ? JSON.parse(await readFile(options.outputSchema, "utf8")) : options.outputSchema;
    schemaPath = join(root, "output-schema.json");
    await privateJson(schemaPath, schema);
    if (profile.adapter === "opencode") prompt += `\nReturn only JSON satisfying this schema:\n${JSON.stringify(schema)}`;
  }
  await writeFile(join(root, "prompt.txt"), prompt, { mode: 0o600, flag: "wx" });
  const stdoutPath = join(root, "events.jsonl");
  const stderrPath = join(root, "stderr.log");
  /** @type {any} */
  let task = null;
  /** @type {string | null} */
  let sessionId = null;
  /** @type {string | null} */
  let threadId = null;
  /** @type {string | null} */
  let source = null;
  /** @type {string | null} */
  let failure = null;
  /** @type {any[]} */
  let contexts = [];
  /** @type {any[]} */
  let messages = [];
  /** @type {any[]} */
  let events = [];
  /** @type {any[]} */
  let nativeEvents = [];
  /** @type {any} */
  let usage = null, reportedCostUsd = null;
  /** @type {any} */
  let accounting = null;
  let finalText = "", cancellationConfirmed = true;
  /** @type {string[]} */
  let argv = [];
  /** @type {any} */
  const state = profile.adapter === "opencode" ? serverState.get(options.server) : null;
  const sessionDirectory = options.runtime?.sessionDirectory ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");

  const observe = async (terminal = false) => {
    events = jsonLines(await optionalText(stdoutPath));
    if (profile.adapter === "codex") {
      threadId = events.find((event) => event.type === "thread.started")?.thread_id ?? threadId;
      if (threadId && !source) source = await findSession(sessionDirectory, threadId, terminal);
      nativeEvents = source ? jsonLines(await optionalText(source)) : [];
      contexts = nativeEvents.filter((event) => event.type === "turn_context").map((event) => ({ model: event.payload?.model ?? null, effort: event.payload?.effort ?? null, turnId: event.payload?.turn_id ?? null, cwd: event.payload?.cwd ?? null }));
      accounting = summarizeCodexAccounting(nativeEvents);
      usage = accounting.usage;
      if (contexts.some((context) => (context.model && context.model !== profile.model) || (context.effort && context.effort !== profile.effort))) failure = "observed_identity_mismatch";
    } else if (sessionId) {
      messages = await serverRequest(options.server, `/session/${encodeURIComponent(sessionId)}/message`, "GET", undefined, options.cwd);
      contexts = messages.filter((message) => message.info?.role === "assistant").map((message) => ({
        model: message.info.providerID && message.info.modelID ? `${message.info.providerID}/${message.info.modelID}` : null,
        effort: message.info.variant ?? null, messageId: message.info.id, cwd: message.info.path?.cwd ?? null,
      }));
      accounting = summarizeFlashUsage(messages);
      ({ usage, reportedCostUsd } = accounting);
      if (contexts.some((context) => (context.model && context.model !== profile.model) || (context.effort && context.effort !== profile.effort))) failure = "observed_identity_mismatch";
    }
    if (contexts.some((context) => context.cwd && context.cwd !== options.cwd)) failure = "observed_directory_mismatch";
  };

  const cancel = async () => {
    if (sessionId && state) {
      try { cancellationConfirmed = await abortFlashSession(options.server, sessionId); }
      catch { cancellationConfirmed = false; }
      if (!cancellationConfirmed) await stopFlashServer(options.server);
    }
    if (task && !await terminate(task)) cancellationConfirmed = false;
  };

  try {
    if (options.signal?.aborted) failure = "cancelled";
    if (!failure && profile.adapter === "codex") {
      argv = [options.runtime?.command ?? "codex", "exec", "--model", profile.model, "-c", `model_reasoning_effort=${JSON.stringify(profile.effort)}`,
        "--ignore-user-config", "-c", "features.multi_agent=false", "--sandbox", sandbox, "--skip-git-repo-check",
        "-C", options.cwd, "--json", "--output-last-message", join(root, "final.txt")];
      if (schemaPath) argv.push("--output-schema", schemaPath);
      argv.push("-");
    } else if (!failure) {
      const session = await serverRequest(options.server, "/session", "POST", { title: `${options.arm ?? "model"} ${options.phase ?? "packet"}` }, options.cwd);
      sessionId = session.id;
      if (typeof sessionId !== "string" || !/^ses_[a-zA-Z0-9]+$/.test(sessionId)) throw new Error("invalid_flash_session_id");
      state.active.set(sessionId, options.cwd);
      argv = [options.runtime?.command ?? "opencode", "run", "Execute the attached exact packet. Do not delegate.", "--pure", "--format", "json", "--model", profile.model, "--variant", profile.effort,
        "--session", sessionId, "--dir", options.cwd, "--attach", options.server.url, "--title", `${options.arm ?? "model"} ${options.phase ?? "packet"}`,
        "--file", join(root, "prompt.txt")];
    }
    if (!failure) {
      task = await launch(argv, { cwd: options.cwd, env: state?.env ?? process.env,
        stdout: stdoutPath, stderr: stderrPath, prompt: profile.adapter === "codex" ? prompt : "" });
      await privateJson(join(root, "started.json"), { argv, startedAt, pid: task.child.pid ?? null, sessionId,
        execution: profile, phase: options.phase ?? null, arm: options.arm ?? null, sandbox, timeoutMs });
      let closed = false;
      task.closed.then(() => { closed = true; });
      while (!closed) {
        if (options.signal?.aborted) failure = "cancelled";
        if (performance.now() - started >= timeoutMs) failure = "deadline_exceeded";
        await observe();
        if (failure) { await cancel(); break; }
        await Promise.race([task.closed, delay(150)]);
      }
      if (cancellationConfirmed) await task.closed;
      await observe(true);
      if (!contexts.length && profile.adapter === "codex") { await delay(200); await observe(true); }
      if (task.terminal.error) failure ??= task.terminal.error;
      if (task.terminal.code !== 0) failure ??= "process_exit_nonzero";
    }
  } catch {
    failure ??= "adapter_execution_failed";
    await cancel();
    try { await observe(true); } catch { /* Keep the last observed usage, including failed attempts. */ }
  } finally {
    if (task && !await terminate(task)) { cancellationConfirmed = false; failure ??= "process_termination_unconfirmed"; }
    if (sessionId && state) state.active.delete(sessionId);
  }

  const identityAttested = contexts.length > 0 && contexts.every((context) => context.model === profile.model && context.effort === profile.effort);
  if (!identityAttested) failure ??= "observed_identity_unknown";
  if (profile.adapter === "codex") {
    finalText = (await optionalText(join(root, "final.txt"))).trim();
    if (events.some((event) => ["error", "turn.failed"].includes(event.type))) failure ??= "provider_turn_failed";
    if (!events.some((event) => event.type === "turn.completed") || !finalText) failure ??= "provider_turn_incomplete";
  } else {
    await privateJson(join(root, "messages.json"), messages);
    const assistants = messages.filter((message) => message.info?.role === "assistant");
    const finalMessage = assistants.filter((message) => message.info.finish !== "tool-calls" && (message.parts ?? []).some((/** @type {any} */ part) => part.type === "text")).at(-1) ?? assistants.at(-1);
    finalText = (finalMessage?.parts ?? []).filter((/** @type {any} */ part) => part.type === "text").map((/** @type {any} */ part) => part.text).join("").trim();
    if (!assistants.length || assistants.some((message) => message.info.error || !message.info.time?.completed || !message.info.finish)) failure ??= "provider_turn_incomplete";
    await writeFile(join(root, "final.txt"), finalText, { mode: 0o600 });
  }
  const models = [...new Set(contexts.map((context) => context.model).filter(Boolean))];
  const efforts = [...new Set(contexts.map((context) => context.effort).filter(Boolean))];
  const prices = identityAttested ? (accounting?.requests ?? []).map((/** @type {any} */ request) => equivalentCost(profile.model, request, options.server?.model)) : [];
  const knownPrices = prices.filter((/** @type {any} */ price) => typeof price === "number" && Number.isFinite(price));
  const usageComplete = accounting?.usageComplete === true && (profile.adapter === "opencode" || events.some((event) => event.type === "turn.completed"));
  const apiCostComplete = identityAttested && prices.length > 0 && prices.length === knownPrices.length
    && (profile.adapter === "codex" ? accounting?.requestsComplete === true && events.some((event) => event.type === "turn.completed") : accounting?.usageComplete === true);
  const apiEquivalentKnownCostUsd = knownPrices.length ? knownPrices.reduce((/** @type {number} */ sum, /** @type {number} */ price) => sum + price, 0) : null;
  const receiptPath = join(root, "receipt.json");
  const receipt = { schemaVersion: 1, ok: failure === null && identityAttested, exitCode: task?.terminal.code ?? null,
    modelObserved: models.length === 1 ? models[0] : null, effortObserved: efforts.length === 1 ? efforts[0] : null,
    identityAttested, execution: { ...profile }, observedContexts: contexts, threadId, sessionId,
    startedAt, endedAt: new Date().toISOString(), elapsedSeconds: (performance.now() - started) / 1000,
    usage, usageComplete, reportedCostUsd,
    reportedKnownCostUsd: accounting?.reportedKnownCostUsd ?? null, reportedCostComplete: accounting?.reportedCostComplete ?? false,
    apiCostComplete, apiEquivalentKnownCostUsd, apiEquivalentCostUsd: apiCostComplete ? apiEquivalentKnownCostUsd : null,
    pricingVersion: profile.adapter === "codex" ? modelPricing.version : "OpenCode-runtime-model-catalog",
    costMeaning: "reported API telemetry and benchmark API-equivalent estimate; not subscription spending",
    argv, phase: options.phase ?? null, arm: options.arm ?? null, sandbox,
    failure, cancellationConfirmed, receiptPath, finalTextPath: join(root, "final.txt"),
    nativeSessionPath: source, warningTypes: events.filter((event) => event.item?.type === "error").map(() => "harness_warning"),
    schemaEnforcement: schemaPath ? (profile.adapter === "codex" ? "native-output-schema" : "prompt-only-caller-must-validate") : null };
  await privateJson(receiptPath, receipt);
  return { ...receipt, finalText };
}
