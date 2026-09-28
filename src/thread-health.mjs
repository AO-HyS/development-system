// @ts-check

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read-only health check for one long-running agent thread: is it stuck, which
// instructions did the guard stop, and how many tokens did it use. It never measures
// throughput and never writes anywhere.

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const RUN_ID = /codex-review\/runs\/(\d{8}T\d{6,9}Z-[0-9a-f]{6})|\\?"runId\\?":\s*\\?"(\d{8}T\d{6,9}Z-[0-9a-f]{6})/g;
const policyPath = resolve(dirname(fileURLToPath(import.meta.url)), "../claude/orchestration/policy.json");

/**
 * @typedef {{input: number, output: number, cacheRead: number, cacheCreation: number, total: number}} Tokens
 * @typedef {{tool: string, classification: string, errorClass: string, repeats: number, resolved: boolean, evidence: string}} Loop
 * @typedef {{id: string, name: string, classification: string, fingerprint: string, file: string, line: number}} ToolCall
 */

/** @param {string} home @param {string} value */
function expandHome(home, value) {
  return value.startsWith("~/") ? resolve(home, value.slice(2)) : resolve(value);
}

/** @param {string} file @returns {any[]} */
function readJsonLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** @param {unknown} content @returns {string} */
function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n");
  return "";
}

// Safe call classification: never the raw input. For Bash only the first command word
// when it looks like a program name; every other tool is classified by its name alone.
/** @param {string} name @param {unknown} input */
function classifyCall(name, input) {
  const record = /** @type {Record<string, unknown>} */ (input ?? {});
  if (name === "Bash" && typeof record.command === "string") {
    const word = record.command.trim().split(/\s+/)[0] ?? "";
    return /^[a-z][\w.-]*$/.test(word) ? word : "command";
  }
  return name;
}

/** @param {unknown} value @returns {unknown} */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(/** @type {Record<string, unknown>} */ (value)[key])]));
  }
  return value;
}

// Internal grouping fingerprint of the exact call (command bytes unchanged); never emitted.
/** @param {string} name @param {unknown} input */
function fingerprintCall(name, input) {
  const record = /** @type {Record<string, unknown>} */ (input ?? {});
  const normalized = name === "Bash" && typeof record.command === "string"
    ? JSON.stringify({ command: record.command })
    : JSON.stringify(sortKeys(record));
  return createHash("sha256").update(`${name}\u0000${normalized}`).digest("hex");
}

const DENIAL_LABELS = /** @type {Record<string, string>} */ ({
  "owned-paths": "Owned paths inválidos",
  tier: "tier de Jev",
  "open-decision": "decisión abierta",
  "codex-review": "revisión fuera de Codex",
  "codex-computer-use": "computer use fuera de Codex",
  retired: "rol retirado",
});

// Denial description from fixed, pattern-checked fields only; the guard reason is never read.
/** @param {any} event */
function describeDenial(event) {
  const safe = (/** @type {unknown} */ value, /** @type {RegExp} */ pattern) => (typeof value === "string" && pattern.test(value) ? value : "");
  const blockedBy = safe(event.blockedBy, /^[\w-]+$/) || "other";
  const mode = safe(event.mode, /^[\w:-]+$/);
  const tool = safe(event.tool, /^[\w:-]+$/);
  const type = safe(event.type, /^[\w:-]+$/);
  const where = [mode, tool, type].filter(Boolean).join(" ");
  return { blockedBy, where, description: `${DENIAL_LABELS[blockedBy] ?? blockedBy}${where ? ` (${where})` : ""}` };
}

// Error class derived by pattern; the error text itself is never emitted.
/** @param {string} text */
function classifyError(text) {
  if (/hook|denied|blocked by|permission/i.test(text)) return "hook-denied";
  if (/timed? ?out|timeout/i.test(text)) return "timeout";
  const exit = text.match(/^Exit code (\d+)/m);
  if (exit) return `exit-code-${exit[1]}`;
  if (/not found|no such file|ENOENT|does not exist/i.test(text)) return "not-found";
  return "other";
}

/** @param {string} text */
function slugPart(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** @param {string} prefix @param {string} text */
function mistakeSlug(prefix, text) {
  const words = slugPart(text).split("-").filter((word) => word.length > 1 && !/^\d+$/.test(word)).slice(0, 5).join("-");
  const slug = `${slugPart(prefix) || "tool"}-${words || "error"}`.slice(0, 64).replace(/-+$/, "");
  return slug.length >= 3 ? slug : `${slug}-err`;
}

/**
 * Resolves a T3 Code thread to its provider session through the provider event log.
 * @param {string} home @param {string} thread
 * @returns {{provider: string, providerThreadId: string | null}}
 */
function resolveT3Thread(home, thread) {
  const dir = resolve(home, ".t3/userdata/logs/provider");
  const base = join(dir, `events.${thread}.log`);
  const files = [base, ...[1, 2, 3, 4, 5].map((index) => `${base}.${index}`)].filter((file) => existsSync(file));
  if (files.length === 0) throw new Error(`T3 thread ${thread} has no provider log at ${base}`);
  // Claude lines carry `event.provider` and `event.providerThreadId`; Codex lines carry a
  // top-level `provider` and may never name a provider thread.
  /** @type {string | null} */
  let provider = null;
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const start = line.indexOf("{");
      if (start < 0) continue;
      let record;
      try { record = JSON.parse(line.slice(start)); } catch { continue; }
      const source = record?.event ?? record;
      if (typeof source?.provider !== "string") continue;
      provider ??= source.provider;
      if (typeof source.providerThreadId === "string" && source.providerThreadId) {
        return { provider: source.provider, providerThreadId: source.providerThreadId };
      }
    }
  }
  if (provider && provider !== "claudeAgent") return { provider, providerThreadId: null };
  throw new Error(`T3 thread ${thread} has no provider thread id in ${files.join(", ")}`);
}

/** @param {string} home @param {string} session */
function findTranscript(home, session) {
  const projects = resolve(home, ".claude/projects");
  if (!existsSync(projects)) throw new Error(`Claude Code projects directory not found: ${projects}`);
  for (const project of readdirSync(projects)) {
    const file = join(projects, project, `${session}.jsonl`);
    if (existsSync(file)) return file;
  }
  throw new Error(`Claude session ${session} has no transcript under ${projects}/*/${session}.jsonl`);
}

/** @param {Tokens} tokens @param {Record<string, any>} usage */
function addUsage(tokens, usage) {
  tokens.input += usage.input_tokens ?? 0;
  tokens.output += usage.output_tokens ?? 0;
  tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
  tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0;
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
}

/** @returns {Tokens} */
function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
}

/** @param {any} entry */
function isConversation(entry) {
  return (entry?.type === "user" || entry?.type === "assistant") && entry?.message;
}

/** @param {any} entry */
function isFinalAssistantText(entry) {
  if (entry?.type !== "assistant" || !Array.isArray(entry.message?.content)) return false;
  const content = entry.message.content;
  return entry.message.stop_reason !== "tool_use"
    && content.some((/** @type {any} */ part) => part?.type === "text" && String(part.text ?? "").trim())
    && !content.some((/** @type {any} */ part) => part?.type === "tool_use");
}

/**
 * Reads one thread and returns the stuck / instructions / cost sections plus a verdict.
 * @param {{home: string, session?: string, thread?: string, since?: string, idleMinutes?: number, now?: number}} options
 */
export function threadHealth({ home, session, thread, since, idleMinutes = 20, now = Date.now() }) {
  if ((session ? 1 : 0) + (thread ? 1 : 0) !== 1) throw new Error("thread-health needs exactly one of --session <claude-session-id> or --thread <t3-thread-id>");
  const requested = /** @type {string} */ (session ?? thread);
  if (!ID.test(requested)) throw new Error(`thread-health id must match ${ID.source}`);
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) throw new Error("--idle-minutes must be a positive number");
  const sinceMs = since === undefined ? -Infinity : Date.parse(since);
  if (Number.isNaN(sinceMs)) throw new Error(`--since must be an ISO date: ${since}`);

  let sessionId = session ?? "";
  /** @type {{id: string, provider: string} | null} */
  let t3 = null;
  if (thread) {
    const resolved = resolveT3Thread(home, thread);
    t3 = { id: thread, provider: resolved.provider };
    if (resolved.provider !== "claudeAgent") {
      const label = /codex/i.test(resolved.provider) ? "Codex" : resolved.provider;
      return {
        ok: false,
        operation: "thread-health",
        thread,
        provider: resolved.provider,
        providerThreadId: resolved.providerThreadId,
        error: `thread-health reads Claude Code transcripts; ${label} threads are not supported yet`,
      };
    }
    sessionId = resolved.providerThreadId ?? "";
    if (!ID.test(sessionId)) throw new Error(`T3 thread ${thread} resolved to an invalid session id`);
  }

  const mainFile = findTranscript(home, sessionId);
  const subDir = join(dirname(mainFile), sessionId, "subagents");
  const subFiles = existsSync(subDir) ? readdirSync(subDir).filter((name) => name.endsWith(".jsonl")).sort().map((name) => join(subDir, name)) : [];
  const incident = thread ?? sessionId;
  /** @param {any} entry */
  const inWindow = (entry) => !entry?.timestamp || Date.parse(entry.timestamp) >= sinceMs;

  // One pass over every transcript: activity, tool calls, errors, tokens and review run ids.
  let lastActivityMs = -Infinity;
  let firstActivityMs = Infinity;
  /** @type {any} */
  let lastMainEntry = null;
  /** @type {Map<string, ToolCall>} */
  const calls = new Map();
  /** @type {{call: ToolCall | undefined, errorClass: string, file: string, line: number, seq: number}[]} */
  const errors = [];
  /** @type {{key: string, file: string, seq: number}[]} */
  const successes = [];
  /** @type {{file: string, seq: number, id: unknown}[]} */
  const answerCandidates = [];
  // Claude streams one message as several rows; text followed by a tool_use row of the same id is progress.
  const toolUseMessageIds = new Set();
  let consecutiveErrors = 0;
  let run = 0;
  let seq = 0;
  /** @type {Map<string, {model: string, usage: Record<string, any>, isMain: boolean}>} */
  const lastUsage = new Map();
  /** @type {Record<string, Tokens>} */
  const byModel = {};
  const scopes = { main: emptyTokens(), subagents: emptyTokens() };
  const runIds = new Set();

  for (const file of [mainFile, ...subFiles]) {
    const isMain = file === mainFile;
    const raw = readFileSync(file, "utf8");
    for (const match of raw.matchAll(RUN_ID)) runIds.add(match[1] ?? match[2]);
    for (const [index, line] of raw.split("\n").entries()) {
      if (!line.trim()) continue;
      seq += 1;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isNaN(at)) {
        if (at > lastActivityMs) lastActivityMs = at;
        if (at < firstActivityMs) firstActivityMs = at;
      }
      if (isMain && isConversation(entry)) lastMainEntry = entry;
      if (!isConversation(entry) || !inWindow(entry)) continue;
      const message = entry.message;
      const content = Array.isArray(message.content) ? message.content : [];
      if (entry.type === "assistant") {
        for (const part of content) {
          if (part?.type === "tool_use" && typeof part.id === "string") {
            const name = String(part.name ?? "tool");
            calls.set(part.id, { id: part.id, name, classification: classifyCall(name, part.input), fingerprint: fingerprintCall(name, part.input), file, line: index + 1 });
          }
        }
        if (content.some((/** @type {any} */ part) => part?.type === "tool_use") || message.stop_reason === "tool_use") toolUseMessageIds.add(message.id);
        if (isFinalAssistantText(entry)) answerCandidates.push({ file, seq, id: message.id });
        // Claude streams several rows per message id; the last one carries the complete usage.
        const usage = message.usage;
        const id = message.id;
        const model = String(message.model ?? "unknown");
        if (usage && id && model !== "<synthetic>") lastUsage.set(id, { model, usage, isMain });
        continue;
      }
      for (const part of content) {
        if (part?.type !== "tool_result") continue;
        const call = calls.get(part.tool_use_id);
        if (part.is_error === true) {
          errors.push({ call, errorClass: classifyError(resultText(part.content)), file, line: index + 1, seq });
          if (isMain) { run += 1; consecutiveErrors = Math.max(consecutiveErrors, run); }
        } else {
          if (call) successes.push({ key: call.fingerprint, file, seq });
          if (isMain) run = 0;
        }
      }
    }
  }
  const trailingErrors = run;
  const finalAnswers = answerCandidates.filter((answer) => !answer.id || !toolUseMessageIds.has(answer.id));
  for (const { model, usage, isMain } of lastUsage.values()) {
    addUsage(byModel[model] ??= emptyTokens(), usage);
    addUsage(isMain ? scopes.main : scopes.subagents, usage);
  }

  // Failure groups keyed by transcript, internal call fingerprint and error class. A group is
  // resolved when a later successful call with the same fingerprint, or a final assistant answer,
  // follows its last failure in the same transcript.
  /** @type {Map<string, Loop & {key: string, file: string, lastSeq: number}>} */
  const groups = new Map();
  for (const error of errors) {
    const tool = error.call?.name ?? "tool";
    const classification = error.call?.classification ?? tool;
    const callKey = error.call?.fingerprint ?? `${tool}\u0000${classification}`;
    const evidence = `${error.file}:${error.line}${error.call ? `#${error.call.id}` : ""}`;
    const groupKey = `${error.file}\u0000${callKey}\u0000${error.errorClass}`;
    const group = groups.get(groupKey) ?? { tool, classification, errorClass: error.errorClass, repeats: 0, resolved: false, evidence, key: callKey, file: error.file, lastSeq: 0 };
    group.repeats += 1;
    group.lastSeq = Math.max(group.lastSeq, error.seq);
    groups.set(groupKey, group);
  }
  /** @type {Loop[]} */
  const loops = [...groups.values()].filter((group) => group.repeats >= 3).map(({ key, file, lastSeq, ...loop }) => ({
    ...loop,
    resolved: successes.some((success) => success.key === key && success.file === file && success.seq > lastSeq)
      || finalAnswers.some((answer) => answer.file === file && answer.seq > lastSeq),
  })).sort((a, b) => b.repeats - a.repeats);

  // Codex review runs this thread referenced, started after the thread's first entry.
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const reviewRunsDir = join(expandHome(home, policy.review?.stateDir ?? "~/.development-system/private/runs/codex-review"), "runs");
  const windowStart = Math.max(sinceMs, firstActivityMs);
  /** @type {Map<string, {taskId: string, rounds: number, attempts: number, lastVerdict: string | null}>} */
  const tasks = new Map();
  let reviewsWithoutTaskId = 0;
  let pendingReviews = 0;
  const codex = { input: 0, cachedInput: 0, output: 0, total: 0, runs: 0, runsWithUsage: 0 };
  for (const runId of [...runIds].sort()) {
    const stamp = runId.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    const started = stamp ? Date.parse(`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`) : NaN;
    if (Number.isNaN(started) || started < windowStart - 60_000) continue;
    const runDir = join(reviewRunsDir, runId);
    if (!existsSync(runDir)) continue;
    codex.runs += 1;
    const receiptFile = join(runDir, "receipt.json");
    /** @type {any} */
    let receipt = null;
    try { receipt = JSON.parse(readFileSync(receiptFile, "utf8")); } catch { receipt = null; }
    if (!receipt) { pendingReviews += 1; continue; }
    // Tokens: the receipt's usage when recorded, otherwise the run's own Codex event usage.
    /** @type {any[]} */
    const usages = receipt.usage && typeof receipt.usage === "object" ? [receipt.usage]
      : readJsonLines(join(runDir, "events.jsonl")).map((event) => event?.usage ?? event?.msg?.usage).filter((usage) => usage && typeof usage === "object");
    if (usages.length) codex.runsWithUsage += 1;
    for (const usage of usages) {
      codex.input += usage.input_tokens ?? 0;
      codex.cachedInput += usage.cached_input_tokens ?? 0;
      codex.output += usage.output_tokens ?? 0;
    }
    if (receipt.mode !== "review") continue;
    if (!receipt.taskId) { reviewsWithoutTaskId += 1; continue; }
    const task = tasks.get(receipt.taskId) ?? { taskId: receipt.taskId, rounds: 0, attempts: 0, lastVerdict: null };
    if (receipt.outcome === "review" || (receipt.status === "succeeded" && receipt.verdict)) { task.rounds += 1; task.lastVerdict = receipt.verdict ?? null; }
    else task.attempts += 1;
    tasks.set(receipt.taskId, task);
  }
  codex.total = codex.input + codex.output;
  const reviewRounds = [...tasks.values()];

  // Guard ledger: denials for this session. A denial is the guard doing its job, not a thread fault.
  const ledgerFile = join(expandHome(home, policy.stateDir ?? "~/.development-system/private/runs/claude-orchestration"), "ledger.jsonl");
  /** @type {{event: any, line: number}[]} */
  const ledgerRows = existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8").split("\n").flatMap((text, index) => {
    if (!text.trim()) return [];
    try { return [{ event: JSON.parse(text), line: index + 1 }]; } catch { return []; }
  }) : [];
  const ledgerInWindow = ledgerRows.filter(({ event }) => event?.session === sessionId && (!event.at || Date.parse(event.at) >= sinceMs));
  const ledger = ledgerInWindow.map(({ event }) => event);
  /** @type {Map<string, {description: string, blockedBy: string, where: string, count: number, repeated: boolean, evidence: string}>} */
  const denialGroups = new Map();
  let gitIndexRefusals = 0;
  for (const { event, line } of ledgerInWindow) {
    if (event.decision !== "deny") continue;
    if (event.mode === "writer-bash") { gitIndexRefusals += 1; continue; }
    const { description, blockedBy, where } = describeDenial(event);
    const group = denialGroups.get(description) ?? { description, blockedBy, where, count: 0, repeated: false, evidence: `${ledgerFile}:${line}` };
    group.count += 1;
    group.repeated = group.count >= 3;
    denialGroups.set(description, group);
  }
  const denials = [...denialGroups.values()].sort((a, b) => b.count - a.count);
  const writerHoldsExpired = ledger.filter((event) => event.event === "writer-hold-expired").length;

  // Cost.
  const claudeTotal = scopes.main.total + scopes.subagents.total;
  const cacheRead = scopes.main.cacheRead + scopes.subagents.cacheRead;
  const cost = {
    claude: {
      byModel: Object.entries(byModel).map(([model, tokens]) => ({ model, ...tokens })).sort((a, b) => b.total - a.total),
      main: scopes.main,
      subagents: scopes.subagents,
      total: claudeTotal,
      cacheShare: claudeTotal ? Math.round((cacheRead / claudeTotal) * 1000) / 1000 : 0,
    },
    codexReviews: codex,
  };

  // Verdict.
  const idle = lastActivityMs === -Infinity ? null : Math.round(((now - lastActivityMs) / 60_000) * 10) / 10;
  const finished = isFinalAssistantText(lastMainEntry) && !toolUseMessageIds.has(lastMainEntry?.message?.id);
  /** @type {string[]} */
  const stuckReasons = [];
  /** @type {string[]} */
  const watchReasons = [];
  if (idle !== null && idle > idleMinutes && !finished) stuckReasons.push(`sin actividad hace ${Math.round(idle)} min y el último turno no cerró con texto`);
  for (const loop of loops.filter((group) => !group.resolved)) {
    const what = `${loop.tool} (${loop.classification}) repetido ×${loop.repeats} con ${loop.errorClass}`;
    (loop.repeats >= 5 ? stuckReasons : watchReasons).push(what);
  }
  for (const task of reviewRounds) if (task.rounds > 3) stuckReasons.push(`${task.taskId} lleva ${task.rounds} rondas de revisión completas`);
  if (trailingErrors >= 5) watchReasons.push(`${consecutiveErrors} errores seguidos en el hilo principal`);
  const verdict = stuckReasons.length ? "stuck" : watchReasons.length ? "watch" : "moving";

  // Candidate mistake records; never run.
  /** @type {Map<string, string>} */
  const suggestions = new Map();
  for (const loop of loops) {
    const slug = mistakeSlug(loop.tool, `${loop.classification} ${loop.errorClass}`);
    suggestions.set(slug, `development-system mistake add --id ${slug} --incident ${incident} --evidence ${loop.evidence}`);
  }
  for (const denial of denials.filter((group) => group.repeated)) {
    const slug = mistakeSlug("guard", `${denial.blockedBy} ${denial.where}`);
    suggestions.set(slug, `development-system mistake add --id ${slug} --incident ${incident} --evidence ${denial.evidence}`);
  }

  return {
    ok: true,
    operation: "thread-health",
    session: sessionId,
    ...(t3 ? { thread: t3.id, provider: t3.provider } : {}),
    since: since ?? null,
    transcripts: { main: mainFile, subagents: subFiles.length },
    verdict,
    reasons: verdict === "stuck" ? stuckReasons : verdict === "watch" ? watchReasons : [],
    stuck: {
      lastActivityAt: lastActivityMs === -Infinity ? null : new Date(lastActivityMs).toISOString(),
      idleMinutes: idle,
      idleThresholdMinutes: idleMinutes,
      lastTurnFinished: finished,
      loops,
      consecutiveErrors,
      historicalFailures: errors.length,
      reviewRounds,
      pendingReviews,
    },
    instructions: { denials, gitIndexRefusals, writerHoldsExpired, reviewsWithoutTaskId },
    cost,
    suggestions: [...suggestions.values()],
  };
}

/** @param {number} value */
function formatTokens(value) {
  return value >= 1e6 ? `${(value / 1e6).toFixed(1)} M` : value >= 1e3 ? `${Math.round(value / 1e3)} k` : String(value);
}

/**
 * Short Spanish summary that leads with the verdict line.
 * @param {Record<string, any>} result
 */
export function formatThreadHealth(result) {
  if (result.ok === false) return `No disponible: ${result.error}`;
  const { stuck, instructions, cost } = result;
  const reasons = result.reasons.join("; ");
  const lines = [result.verdict === "stuck" ? `Trabado: ${reasons}` : result.verdict === "watch" ? `Vigilar: ${reasons}` : "Moviéndose"];
  lines.push(`Sesión ${result.session}${result.thread ? ` (hilo T3 ${result.thread})` : ""}; última actividad ${stuck.lastActivityAt ?? "n/d"}${stuck.idleMinutes === null ? "" : ` (hace ${stuck.idleMinutes} min)`}; ${result.transcripts.subagents} subagentes.`);
  for (const loop of stuck.loops) {
    lines.push(`  Bucle${loop.resolved ? " (resuelto)" : ""}: ${loop.tool} (${loop.classification}) ×${loop.repeats} → ${loop.errorClass}; evidencia ${loop.evidence}`);
  }
  lines.push(`  Máximo de errores seguidos: ${stuck.consecutiveErrors}; fallos históricos: ${stuck.historicalFailures}.`);
  for (const task of stuck.reviewRounds) lines.push(`  Revisión ${task.taskId}: ${task.rounds} rondas, ${task.attempts} intentos fallidos, último veredicto ${task.lastVerdict ?? "—"}.`);
  if (stuck.pendingReviews) lines.push(`  Revisiones sin recibo todavía: ${stuck.pendingReviews}.`);

  lines.push("", "Instrucciones");
  if (instructions.denials.length === 0) lines.push("  El guard no frenó nada en esta sesión.");
  for (const denial of instructions.denials) lines.push(`  guard frenó: ${denial.description} ×${denial.count}${denial.repeated ? " (repetido)" : ""}; evidencia ${denial.evidence}`);
  lines.push(`  Escritores frenados al tocar el índice de git: ${instructions.gitIndexRefusals}; holds de escritor expirados: ${instructions.writerHoldsExpired}; revisiones sin Task-Id: ${instructions.reviewsWithoutTaskId}.`);

  lines.push("", "Costo");
  const claude = cost.claude;
  lines.push(`  Claude: ${formatTokens(claude.total)} tokens (principal ${formatTokens(claude.main.total)}, subagentes ${formatTokens(claude.subagents.total)}); caché leída ${Math.round(claude.cacheShare * 100)}%.`);
  for (const model of claude.byModel) {
    lines.push(`  ${model.model}: entrada ${formatTokens(model.input)}, salida ${formatTokens(model.output)}, caché leída ${formatTokens(model.cacheRead)}, caché creada ${formatTokens(model.cacheCreation)}.`);
  }
  const codex = cost.codexReviews;
  lines.push(codex.runs === 0 ? "  Codex (revisiones): sin corridas enlazadas." : `  Codex (revisiones): ${formatTokens(codex.total)} tokens (entrada ${formatTokens(codex.input)}, de ella en caché ${formatTokens(codex.cachedInput)}; salida ${formatTokens(codex.output)}) en ${codex.runs} corridas, ${codex.runsWithUsage} con uso registrado.`);

  if (result.suggestions.length) {
    lines.push("", "Sugerencias (no se ejecutan)");
    for (const command of result.suggestions) lines.push(`  ${command}`);
  }
  return lines.join("\n");
}
