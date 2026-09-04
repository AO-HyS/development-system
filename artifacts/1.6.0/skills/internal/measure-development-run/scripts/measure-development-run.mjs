#!/usr/bin/env node
// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillDirectory = resolve(scriptDirectory, "..");
const assessmentTemplatePath = resolve(skillDirectory, "assets", "assessment-template.json");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const overallStatuses = new Set(["success", "partial", "failed", "blocked", "abandoned", "superseded"]);
const workTypes = new Set(["planning", "diagnosis", "implementation", "review", "qa", "release", "mixed", "other"]);
const scopeStatuses = new Set([
  "completed-verified",
  "completed-unverified",
  "partial",
  "not-done",
  "out-of-scope",
  "blocked",
]);
const deliveryStatuses = new Set([
  "verified",
  "reported",
  "failed",
  "not-reached",
  "not-applicable",
  "unavailable",
]);
const qualityStatuses = new Set(["verified", "adequate", "insufficient", "not-applicable", "unavailable"]);
const errorCategories = new Set([
  "product",
  "test",
  "infrastructure",
  "permission",
  "harness",
  "scope-change",
  "human-wait",
  "tool",
  "unknown",
]);
const confidenceLevels = new Set(["high", "medium", "low"]);

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function asString(value) {
  return typeof value === "string" ? value : null;
}

/** @param {unknown} value */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {string} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** @param {string} value */
function safeSegment(value) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "unknown";
}

/** @param {string} path @param {string} root */
function resolveInside(path, root) {
  const resolvedRoot = resolve(root);
  const target = resolve(path);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Path escapes the selected root: ${target}`);
  }
  return target;
}

/** @param {string[]} argv */
function parseArguments(argv) {
  const [command, ...tokens] = argv;
  /** @type {Record<string, string | boolean>} */
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

/** @param {Record<string, string | boolean>} options @param {string} name */
function optionString(options, name) {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

/** @param {string} sessionsRoot @param {string} threadId */
export async function findSessionFile(sessionsRoot, threadId) {
  if (!uuidPattern.test(threadId)) throw new Error(`Invalid Codex thread ID: ${threadId}`);
  const root = resolve(sessionsRoot);
  /** @type {string[]} */
  const directories = [root];
  while (directories.length > 0) {
    const current = /** @type {string} */ (directories.pop());
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) return path;
    }
  }
  throw new Error(`Cannot find the Codex session for thread ${threadId} under ${root}`);
}

/** @param {unknown} output */
function customOutputStatus(output) {
  if (!Array.isArray(output)) return { failed: false, failureKind: null };
  const header = output
    .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
    .find((text) => text.length > 0) ?? "";
  if (
    /^(script failed|process exited with code [1-9]|command failed|tool error|timed out)/i.test(header.trim())
  ) {
    return { failed: true, failureKind: "tool-output-failure" };
  }
  return { failed: false, failureKind: null };
}

/** @param {unknown} output */
function functionOutputStatus(output) {
  if (typeof output !== "string") return { failed: false, failureKind: null };
  const trimmed = output.trim();
  if (/^(error|tool error|failed to execute|request failed)\b/i.test(trimmed)) {
    return { failed: true, failureKind: "function-output-failure" };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed) && (parsed.ok === false || parsed.success === false || parsed.error)) {
      return { failed: true, failureKind: "reported-failure" };
    }
  } catch {
    // Non-JSON function outputs are normal.
  }
  return { failed: false, failureKind: null };
}

/**
 * Read only metadata required for measurement. Message content, reasoning,
 * tool arguments, and tool output are intentionally discarded.
 *
 * @param {string} sessionPath
 */
export async function readSessionMetadata(sessionPath) {
  /** @type {any} */
  let session = null;
  /** @type {Array<{timestamp: string, role: string, source: string}>} */
  const messages = [];
  /** @type {Array<{timestamp: string, kind: string, turnId?: string, durationMs?: number, timeToFirstTokenMs?: number}>} */
  const taskEvents = [];
  /** @type {Array<{timestamp: string, usage: any}>} */
  const tokenEvents = [];
  /** @type {Array<{timestamp: string, model: string | null, effort: string | null, cwd: string | null}>} */
  const contexts = [];
  /** @type {Array<{timestamp: string, threadId: string | null, path: string | null, kind: string, eventId: string | null}>} */
  const agentEvents = [];
  /** @type {Array<{timestamp: string, callId: string, role: string | null, taskName: string | null}>} */
  const agentSpawns = [];
  /** @type {Map<string, {timestamp: string, name: string, family: string}>} */
  const calls = new Map();
  /** @type {Array<{callId: string, timestamp: string, failed: boolean, failureKind: string | null}>} */
  const outputs = [];
  let malformedLines = 0;

  const stream = createReadStream(sessionPath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    const timestamp = asString(record.timestamp);
    if (!timestamp) continue;
    if (record.type === "session_meta" && isRecord(record.payload)) {
      session = {
        id: asString(record.payload.id),
        startedAt: timestamp,
        cwd: asString(record.payload.cwd),
        originator: asString(record.payload.originator),
        cliVersion: asString(record.payload.cli_version),
        source: asString(record.payload.source),
        modelProvider: asString(record.payload.model_provider),
      };
      continue;
    }
    if (record.type === "turn_context" && isRecord(record.payload)) {
      contexts.push({
        timestamp,
        model: asString(record.payload.model),
        effort: asString(record.payload.effort),
        cwd: asString(record.payload.cwd),
      });
      continue;
    }
    if (record.type === "event_msg" && isRecord(record.payload)) {
      const type = asString(record.payload.type);
      if (type === "task_started" || type === "task_complete") {
        taskEvents.push({
          timestamp,
          kind: type,
          turnId: asString(record.payload.turn_id) ?? undefined,
          durationMs: asNumber(record.payload.duration_ms) ?? undefined,
          timeToFirstTokenMs: asNumber(record.payload.time_to_first_token_ms) ?? undefined,
        });
      } else if (type === "token_count" && isRecord(record.payload.info)) {
        tokenEvents.push({ timestamp, usage: record.payload.info.total_token_usage ?? null });
      } else if (type === "sub_agent_activity") {
        agentEvents.push({
          timestamp,
          threadId: asString(record.payload.agent_thread_id),
          path: asString(record.payload.agent_path),
          kind: asString(record.payload.kind) ?? "unknown",
          eventId: asString(record.payload.event_id),
        });
      } else if (type === "user_message") {
        messages.push({ timestamp, role: "user", source: "event" });
      } else if (type === "agent_message") {
        messages.push({ timestamp, role: "assistant", source: "event" });
      }
      continue;
    }
    if (record.type !== "response_item" || !isRecord(record.payload)) continue;
    const payloadType = asString(record.payload.type);
    if (payloadType === "message") {
      const role = asString(record.payload.role);
      if (role === "user" || role === "assistant") messages.push({ timestamp, role, source: "response-item" });
      continue;
    }
    if (payloadType === "custom_tool_call" || payloadType === "function_call") {
      const callId = asString(record.payload.call_id);
      if (callId) {
        const name = asString(record.payload.name) ?? "unknown";
        calls.set(callId, {
          timestamp,
          name,
          family: payloadType === "custom_tool_call" ? "custom" : "function",
        });
        if (name === "spawn_agent" && typeof record.payload.arguments === "string") {
          try {
            const argumentsValue = JSON.parse(record.payload.arguments);
            agentSpawns.push({
              timestamp,
              callId,
              role: asString(argumentsValue.agent_type),
              taskName: asString(argumentsValue.task_name),
            });
          } catch {
            // Invalid tool arguments are measured as a tool failure elsewhere.
          }
        }
      }
      continue;
    }
    if (payloadType === "custom_tool_call_output" || payloadType === "function_call_output") {
      const callId = asString(record.payload.call_id);
      if (!callId) continue;
      const status = payloadType === "custom_tool_call_output"
        ? customOutputStatus(record.payload.output)
        : functionOutputStatus(record.payload.output);
      outputs.push({ callId, timestamp, ...status });
    }
  }
  if (!session?.id) throw new Error(`Session metadata is missing from ${sessionPath}`);
  return {
    session,
    messages,
    taskEvents,
    tokenEvents,
    contexts,
    agentEvents,
    agentSpawns,
    calls,
    outputs,
    malformedLines,
  };
}

/** @param {string} value */
function timestampMs(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid timestamp: ${value}`);
  return parsed;
}

/** @param {Array<{startedAt: string, endedAt: string}>} intervals */
function unionDurationMs(intervals) {
  const ordered = intervals
    .map((interval) => ({
      start: timestampMs(interval.startedAt),
      end: timestampMs(interval.endedAt),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let currentStart = null;
  let currentEnd = null;
  for (const interval of ordered) {
    if (currentStart === null || currentEnd === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  if (currentStart !== null && currentEnd !== null) total += currentEnd - currentStart;
  return total;
}

/** @param {{startedAt: string, endedAt: string}} left @param {{startedAt: string, endedAt: string}} right */
function intervalsOverlap(left, right) {
  return timestampMs(left.startedAt) < timestampMs(right.endedAt)
    && timestampMs(right.startedAt) < timestampMs(left.endedAt);
}

/** @param {Awaited<ReturnType<typeof readSessionMetadata>>} metadata @param {string} cutoffOption */
function resolveCutoff(metadata, cutoffOption) {
  if (cutoffOption === "now") {
    const value = new Date().toISOString();
    return { value, mode: "explicit-now" };
  }
  if (cutoffOption !== "latest-user") {
    timestampMs(cutoffOption);
    return { value: new Date(cutoffOption).toISOString(), mode: "explicit-timestamp" };
  }
  const latest = metadata.messages
    .filter((message) => message.role === "user")
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp))
    .at(-1);
  if (!latest) throw new Error("Cannot locate a user prompt for the invocation cutoff");
  return { value: latest.timestamp, mode: "latest-user-prompt" };
}

/** @param {Array<{timestamp: string, role: string, source: string}>} messages */
function uniqueMessages(messages) {
  const hasEventUsers = messages.some((message) => message.role === "user" && message.source === "event");
  const hasResponseAssistants = messages.some(
    (message) => message.role === "assistant" && message.source === "response-item",
  );
  const preferred = messages.filter((message) => {
    if (message.role === "user") return hasEventUsers ? message.source === "event" : message.source === "response-item";
    return hasResponseAssistants ? message.source === "response-item" : message.source === "event";
  });
  const seen = new Set();
  return preferred.filter((message) => {
    const key = `${message.timestamp}:${message.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {string | null} cwd */
/** @param {string} value */
export function sanitizeRemote(value) {
  if (!value.includes("://")) return value;
  const parsed = new URL(value);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function repositoryIdentity(cwd) {
  if (!cwd) return { root: null, name: "no-repository", remote: null, head: null, status: "unavailable" };
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    let remote = null;
    let head = null;
    try {
      const observedRemote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
      remote = observedRemote ? sanitizeRemote(observedRemote) : null;
    } catch {
      // A local repository may not have an origin.
    }
    try {
      head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
    } catch {
      // An unborn repository may not have a HEAD.
    }
    return { root, name: basename(root), remote, head, status: "observed" };
  } catch {
    return { root: null, name: basename(cwd), remote: null, head: null, status: "not-a-git-repository" };
  }
}

/** @param {Array<{timestamp: string, kind: string, threadId: string | null}>} events */
function summarizeAgents(events) {
  const ordered = [...events].sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
  const active = new Set();
  const started = new Map();
  /** @type {Map<string, number>} */
  const durationByThread = new Map();
  let peakChildren = 0;
  for (const event of ordered) {
    if (!event.threadId) continue;
    if (event.kind === "started") {
      active.add(event.threadId);
      started.set(event.threadId, timestampMs(event.timestamp));
      peakChildren = Math.max(peakChildren, active.size);
    } else if (["completed", "failed", "errored", "interrupted", "closed"].includes(event.kind)) {
      active.delete(event.threadId);
      const start = started.get(event.threadId);
      if (start !== undefined) {
        durationByThread.set(
          event.threadId,
          (durationByThread.get(event.threadId) ?? 0) + Math.max(0, timestampMs(event.timestamp) - start),
        );
        started.delete(event.threadId);
      }
    }
  }
  return {
    childThreadIds: [...new Set(ordered.map((event) => event.threadId).filter(Boolean))],
    peakChildren,
    activeAtCutoff: [...active],
    durationByThread,
  };
}

/** @param {string} sessionsRoot @param {string[]} childThreadIds @param {number} cutoffMs */
async function childAgentDetails(sessionsRoot, childThreadIds, cutoffMs) {
  /** @type {Array<Record<string, unknown>>} */
  const details = [];
  for (const threadId of childThreadIds) {
    try {
      const path = await findSessionFile(sessionsRoot, threadId);
      const metadata = await readSessionMetadata(path);
      const context = metadata.contexts
        .filter((item) => timestampMs(item.timestamp) <= cutoffMs)
        .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp))
        .at(-1);
      const taskEvents = metadata.taskEvents.filter((event) => timestampMs(event.timestamp) <= cutoffMs);
      const completedIds = new Set(
        taskEvents.filter((event) => event.kind === "task_complete").map((event) => event.turnId).filter(Boolean),
      );
      const openTurns = taskEvents.filter(
        (event) => event.kind === "task_started" && event.turnId && !completedIds.has(event.turnId),
      );
      const completedMs = taskEvents
        .filter((event) => event.kind === "task_complete")
        .reduce((total, event) => total + (event.durationMs ?? 0), 0);
      const openMs = openTurns.reduce(
        (total, event) => total + Math.max(0, cutoffMs - timestampMs(event.timestamp)),
        0,
      );
      const startedAt = taskEvents
        .filter((event) => event.kind === "task_started")
        .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp))
        .at(0)?.timestamp ?? metadata.session.startedAt;
      const endedAt = openTurns.length > 0
        ? null
        : taskEvents
          .filter((event) => event.kind === "task_complete")
          .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp))
          .at(-1)?.timestamp ?? null;
      const tokenEvent = metadata.tokenEvents
        .filter((event) => timestampMs(event.timestamp) <= cutoffMs)
        .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp))
        .at(-1);
      const completedOutputs = new Map(
        metadata.outputs
          .filter((output) => timestampMs(output.timestamp) <= cutoffMs)
          .map((output) => [output.callId, output]),
      );
      const childCalls = [...metadata.calls.entries()].filter(
        ([, call]) => timestampMs(call.timestamp) <= cutoffMs,
      );
      details.push({
        threadId,
        model: context?.model ?? null,
        reasoning: context?.effort ?? null,
        cwd: context?.cwd ?? metadata.session.cwd,
        telemetryStatus: "observed",
        executionStatus: openTurns.length > 0 ? "in-progress" : endedAt ? "completed" : "unavailable",
        startedAt,
        endedAt,
        durationMs: completedMs + openMs || null,
        tokens: isRecord(tokenEvent?.usage) ? asNumber(tokenEvent.usage.total_tokens) : null,
        toolCalls: childCalls.length,
        toolFailures: childCalls.filter(([callId]) => completedOutputs.get(callId)?.failed === true).length,
      });
    } catch (error) {
      details.push({
        threadId,
        model: null,
        reasoning: null,
        cwd: null,
        telemetryStatus: `unavailable: ${error instanceof Error ? error.message : String(error)}`,
        executionStatus: "unavailable",
        startedAt: null,
        endedAt: null,
        durationMs: null,
        tokens: null,
        toolCalls: null,
        toolFailures: null,
      });
    }
  }
  return details;
}

/**
 * @param {{sessionPath: string, sessionsRoot: string, cutoff?: string}} options
 */
export async function collectTelemetry(options) {
  const metadata = await readSessionMetadata(options.sessionPath);
  const cutoff = resolveCutoff(metadata, options.cutoff ?? "latest-user");
  const cutoffMs = timestampMs(cutoff.value);
  const observedMessages = uniqueMessages(metadata.messages)
    .filter((message) => timestampMs(message.timestamp) <= cutoffMs)
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
  const firstUser = observedMessages.find((message) => message.role === "user");
  if (!firstUser) throw new Error("Cannot locate the first user prompt in the selected interval");
  const startedAtMs = timestampMs(firstUser.timestamp);
  if (cutoffMs < startedAtMs) throw new Error("Cutoff precedes the first user prompt");

  const contexts = metadata.contexts
    .filter((context) => timestampMs(context.timestamp) <= cutoffMs)
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
  const taskEvents = metadata.taskEvents.filter((event) => timestampMs(event.timestamp) <= cutoffMs);
  const completedTurns = taskEvents.filter((event) => event.kind === "task_complete" && event.durationMs !== undefined);
  const completedTurnIds = new Set(
    taskEvents.filter((event) => event.kind === "task_complete").map((event) => event.turnId).filter(Boolean),
  );
  const openTurns = taskEvents.filter(
    (event) => event.kind === "task_started" && event.turnId && !completedTurnIds.has(event.turnId),
  );
  const completedParentTurnMs = completedTurns.reduce((total, event) => total + (event.durationMs ?? 0), 0);
  const inProgressParentTurnMs = openTurns.reduce(
    (total, event) => total + Math.max(0, cutoffMs - timestampMs(event.timestamp)),
    0,
  );
  const parentActiveMs = completedParentTurnMs + inProgressParentTurnMs;
  const startedTurnsById = new Map(
    taskEvents
      .filter((event) => event.kind === "task_started" && event.turnId)
      .map((event) => [event.turnId, event]),
  );
  const operationalIntervals = [
    ...completedTurns.map((event) => {
      const endedAtMs = timestampMs(event.timestamp);
      const started = event.turnId ? startedTurnsById.get(event.turnId) : null;
      const reportedStartedAtMs = endedAtMs - (event.durationMs ?? 0);
      const startedAtMs = started
        ? Math.min(timestampMs(started.timestamp), reportedStartedAtMs)
        : reportedStartedAtMs;
      return {
        startedAt: new Date(Math.min(startedAtMs, endedAtMs)).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
      };
    }),
    ...openTurns.map((event) => ({
      startedAt: new Date(timestampMs(event.timestamp)).toISOString(),
      endedAt: new Date(cutoffMs).toISOString(),
    })),
  ];
  const firstTokenMs = completedTurns.reduce((total, event) => total + (event.timeToFirstTokenMs ?? 0), 0);
  const wallMs = Math.max(0, cutoffMs - startedAtMs);
  const betweenTurnMs = Math.max(0, wallMs - parentActiveMs);

  const tokenEvent = metadata.tokenEvents
    .filter((event) => timestampMs(event.timestamp) <= cutoffMs)
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp))
    .at(-1);
  const usage = isRecord(tokenEvent?.usage) ? tokenEvent.usage : null;

  const outputsByCall = new Map(
    metadata.outputs
      .filter((output) => timestampMs(output.timestamp) <= cutoffMs)
      .map((output) => [output.callId, output]),
  );
  /** @type {Map<string, {name: string, family: string, calls: number, completed: number, failed: number, incomplete: number, totalDurationMs: number, maxDurationMs: number}>} */
  const tools = new Map();
  for (const [callId, call] of metadata.calls) {
    if (timestampMs(call.timestamp) > cutoffMs) continue;
    const output = outputsByCall.get(callId);
    const summary = tools.get(call.name) ?? {
      name: call.name,
      family: call.family,
      calls: 0,
      completed: 0,
      failed: 0,
      incomplete: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    summary.calls += 1;
    if (!output) {
      summary.incomplete += 1;
    } else {
      const duration = Math.max(0, timestampMs(output.timestamp) - timestampMs(call.timestamp));
      summary.completed += 1;
      summary.failed += Number(output.failed);
      summary.totalDurationMs += duration;
      summary.maxDurationMs = Math.max(summary.maxDurationMs, duration);
    }
    tools.set(call.name, summary);
  }
  const toolSummaries = [...tools.values()].sort((left, right) => left.name.localeCompare(right.name));
  const toolTimeMs = toolSummaries.reduce((total, tool) => total + tool.totalDurationMs, 0);
  const toolFailures = toolSummaries.reduce((total, tool) => total + tool.failed, 0);
  const incompleteTools = toolSummaries.reduce((total, tool) => total + tool.incomplete, 0);

  const agentEvents = metadata.agentEvents.filter((event) => timestampMs(event.timestamp) <= cutoffMs);
  const agents = summarizeAgents(agentEvents);
  const children = await childAgentDetails(options.sessionsRoot, agents.childThreadIds, cutoffMs);
  const spawnByTask = new Map(
    metadata.agentSpawns
      .filter((spawn) => timestampMs(spawn.timestamp) <= cutoffMs && spawn.taskName)
      .map((spawn) => [spawn.taskName, spawn]),
  );
  const identityByThread = new Map(
    agentEvents
      .filter((event) => event.threadId)
      .map((event) => {
        const taskName = event.path?.split("/").filter(Boolean).at(-1) ?? null;
        const spawn = taskName ? spawnByTask.get(taskName) : null;
        return [
          event.threadId,
          {
            taskPath: event.path,
            taskName,
            role: spawn?.role ?? null,
          },
        ];
      }),
  );
  const childActiveMs = children.reduce(
    (total, child) => total + (typeof child.durationMs === "number" ? child.durationMs : 0),
    0,
  );
  const childTokens = children.reduce(
    (total, child) => total + (typeof child.tokens === "number" ? child.tokens : 0),
    0,
  );
  const childToolCalls = children.reduce(
    (total, child) => total + (typeof child.toolCalls === "number" ? child.toolCalls : 0),
    0,
  );
  const childToolFailures = children.reduce(
    (total, child) => total + (typeof child.toolFailures === "number" ? child.toolFailures : 0),
    0,
  );
  const childTimeline = children.flatMap((child) => {
    if (!child.startedAt) return [];
    return [
      { timestamp: timestampMs(child.startedAt), delta: 1 },
      ...(child.endedAt ? [{ timestamp: timestampMs(child.endedAt), delta: -1 }] : []),
    ];
  }).sort((left, right) => left.timestamp - right.timestamp || left.delta - right.delta);
  let activeChildren = 0;
  let peakChildren = 0;
  for (const event of childTimeline) {
    activeChildren += event.delta;
    peakChildren = Math.max(peakChildren, activeChildren);
  }
  const cwd = contexts.at(-1)?.cwd ?? metadata.session.cwd;
  const repository = repositoryIdentity(cwd);
  const parentModels = [...new Map(
    contexts.map((context) => [
      `${context.model ?? "unknown"}:${context.effort ?? "unknown"}`,
      { model: context.model, reasoning: context.effort },
    ]),
  ).values()];

  return {
    schemaVersion: 2,
    operation: "collect-development-run",
    source: {
      harness: "codex",
      threadId: metadata.session.id,
      sessionPath: resolve(options.sessionPath),
      sessionPathStatus: "exact-thread-id-match",
      originator: metadata.session.originator,
      cliVersion: metadata.session.cliVersion,
      modelProvider: metadata.session.modelProvider,
      malformedJsonlLines: metadata.malformedLines,
      transcriptPersisted: false,
      toolInputsPersisted: false,
      toolOutputsPersisted: false,
    },
    cutoff: {
      mode: cutoff.mode,
      startedAt: firstUser.timestamp,
      endedAt: cutoff.value,
      capturedAt: new Date().toISOString(),
    },
    repository,
    timing: {
      operationalMs: parentActiveMs,
      operationalIntervals,
      threadSpanMs: wallMs,
      unattributedBetweenTurnMs: betweenTurnMs,
      wallMs,
      completedParentTurnMs,
      inProgressParentTurnMs,
      observedParentTurnMs: parentActiveMs,
      betweenTurnAndHumanWaitMs: betweenTurnMs,
      timeToFirstTokenMs: firstTokenMs,
      toolCallMs: toolTimeMs,
      childAgentMs: childActiveMs,
      agentCapacityMs: parentActiveMs + childActiveMs,
      additiveWarning: "toolCallMs and childAgentMs overlap operationalMs; agentCapacityMs measures consumed capacity, not elapsed delivery time",
    },
    tokens: usage
      ? {
          input: asNumber(usage.input_tokens),
          cachedInput: asNumber(usage.cached_input_tokens),
          cacheWriteInput: asNumber(usage.cache_write_input_tokens),
          output: asNumber(usage.output_tokens),
          reasoningOutput: asNumber(usage.reasoning_output_tokens),
          total: asNumber(usage.total_tokens),
          childAgentsTotal: childTokens,
          allAgentsTotal: (asNumber(usage.total_tokens) ?? 0) + childTokens,
          observedAt: tokenEvent?.timestamp ?? null,
          status: "reported-by-codex-before-cutoff; child sessions added separately",
        }
      : {
          input: null,
          cachedInput: null,
          cacheWriteInput: null,
          output: null,
          reasoningOutput: null,
          total: null,
          childAgentsTotal: childTokens || null,
          allAgentsTotal: childTokens || null,
          observedAt: null,
          status: "unavailable-before-cutoff",
        },
    monetaryCost: {
      amount: null,
      currency: null,
      status: "unavailable-from-codex-session",
    },
    messages: {
      user: observedMessages.filter((message) => message.role === "user").length,
      assistant: observedMessages.filter((message) => message.role === "assistant").length,
    },
    turns: {
      started: taskEvents.filter((event) => event.kind === "task_started").length,
      completed: completedTurns.length,
      inProgress: openTurns.length,
    },
    tools: {
      calls: toolSummaries.reduce((total, tool) => total + tool.calls, 0),
      completed: toolSummaries.reduce((total, tool) => total + tool.completed, 0),
      failures: toolFailures,
      incompleteAtCutoff: incompleteTools,
      childAgentCalls: childToolCalls,
      childAgentFailures: childToolFailures,
      allAgentCalls: toolSummaries.reduce((total, tool) => total + tool.calls, 0) + childToolCalls,
      allAgentFailures: toolFailures + childToolFailures,
      byName: toolSummaries,
    },
    agents: {
      unique: 1 + agents.childThreadIds.length,
      childAgents: agents.childThreadIds.length,
      peakConcurrent: 1 + peakChildren,
      activeChildrenAtCutoff: children
        .filter((child) => child.executionStatus === "in-progress")
        .map((child) => child.threadId),
      parent: {
        threadId: metadata.session.id,
        models: parentModels,
      },
      children: children.map((child) => ({
        ...child,
        ...(identityByThread.get(/** @type {string} */ (child.threadId)) ?? {
          taskPath: null,
          taskName: null,
          role: null,
        }),
      })),
    },
    confidence: {
      telemetry: metadata.malformedLines === 0 ? "high" : "medium",
      limitations: [
        "Monetary model cost is not exposed by the Codex session.",
        "Between-turn time combines human wait, archival pauses, and other idle time.",
        "Tool failure counts use structured completion signals and may omit semantic failures reported only in prose.",
        "Implementation errors, rework, quality, and outcomes require evidence-backed assessment.",
        "Assessment secret detection is pattern-based; arbitrary unlabeled secret formats still require deliberate redaction.",
      ],
    },
  };
}

/** @param {any} value @param {string} field @param {string[]} errors */
function requireString(value, field, errors) {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

/** @param {any} value @param {string} field @param {string[]} errors */
function requireStringArray(value, field, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

/** @param {any} assessment */
export function validateAssessment(assessment) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(assessment) || assessment.schemaVersion !== 2) return ["assessment.schemaVersion must equal 2"];
  requireString(assessment.title, "assessment.title", errors);
  if (!workTypes.has(assessment.workType)) errors.push("assessment.workType is invalid");
  if (!overallStatuses.has(assessment.status)) errors.push("assessment.status is invalid");
  if (assessment.supersedes !== null && !uuidPattern.test(assessment.supersedes ?? "")) {
    errors.push("assessment.supersedes must be null or a measurement UUID");
  }
  if (!isRecord(assessment.objective)) errors.push("assessment.objective is required");
  else {
    requireString(assessment.objective.initial, "assessment.objective.initial", errors);
    requireStringArray(assessment.objective.changes, "assessment.objective.changes", errors);
  }
  if (!Array.isArray(assessment.scope) || assessment.scope.length === 0) {
    errors.push("assessment.scope needs at least one item");
  } else {
    assessment.scope.forEach((item, index) => {
      requireString(item?.item, `assessment.scope[${index}].item`, errors);
      if (!["initial", "added"].includes(item?.origin)) errors.push(`assessment.scope[${index}].origin is invalid`);
      if (!scopeStatuses.has(item?.status)) errors.push(`assessment.scope[${index}].status is invalid`);
      requireStringArray(item?.evidence, `assessment.scope[${index}].evidence`, errors);
    });
  }
  for (const key of ["implementation", "localChecks", "independentReview", "runtime", "preview", "production"]) {
    const entry = assessment.outcome?.[key];
    if (!isRecord(entry) || !deliveryStatuses.has(entry.status)) errors.push(`assessment.outcome.${key}.status is invalid`);
    requireStringArray(entry?.evidence, `assessment.outcome.${key}.evidence`, errors);
  }
  for (const key of ["code", "architecture", "security"]) {
    const entry = assessment.quality?.[key];
    if (!isRecord(entry) || !qualityStatuses.has(entry.status)) errors.push(`assessment.quality.${key}.status is invalid`);
    requireStringArray(entry?.evidence, `assessment.quality.${key}.evidence`, errors);
    requireStringArray(entry?.gaps, `assessment.quality.${key}.gaps`, errors);
  }
  if (!Array.isArray(assessment.errors)) errors.push("assessment.errors must be an array");
  else {
    assessment.errors.forEach((entry, index) => {
      if (!errorCategories.has(entry?.category)) errors.push(`assessment.errors[${index}].category is invalid`);
      requireString(entry?.summary, `assessment.errors[${index}].summary`, errors);
      requireString(entry?.impact, `assessment.errors[${index}].impact`, errors);
      if (typeof entry?.corrected !== "boolean") errors.push(`assessment.errors[${index}].corrected must be boolean`);
      requireStringArray(entry?.evidence, `assessment.errors[${index}].evidence`, errors);
    });
  }
  if (!Array.isArray(assessment.externalTiming)) errors.push("assessment.externalTiming must be an array");
  else {
    assessment.externalTiming.forEach((entry, index) => {
      if (!["ci", "deployment", "queue", "provider", "other"].includes(entry?.kind)) {
        errors.push(`assessment.externalTiming[${index}].kind is invalid`);
      }
      requireString(entry?.label, `assessment.externalTiming[${index}].label`, errors);
      if (typeof entry?.durationMs !== "number" || !Number.isFinite(entry.durationMs) || entry.durationMs < 0) {
        errors.push(`assessment.externalTiming[${index}].durationMs must be a non-negative number`);
      }
      requireString(entry?.status, `assessment.externalTiming[${index}].status`, errors);
      if (!["inside-active-turn", "outside-active-turn", "unknown"].includes(entry?.overlap)) {
        errors.push(`assessment.externalTiming[${index}].overlap is invalid`);
      }
      requireStringArray(entry?.evidence, `assessment.externalTiming[${index}].evidence`, errors);
      if (typeof entry?.verified !== "boolean") {
        errors.push(`assessment.externalTiming[${index}].verified must be boolean`);
      }
      if (entry?.verified === true && (!Array.isArray(entry?.evidence) || entry.evidence.length === 0)) {
        errors.push(`assessment.externalTiming[${index}].verified timing requires evidence`);
      }
      if (entry?.overlap === "outside-active-turn") {
        const startedAtMs = typeof entry?.startedAt === "string" ? Date.parse(entry.startedAt) : Number.NaN;
        const endedAtMs = typeof entry?.endedAt === "string" ? Date.parse(entry.endedAt) : Number.NaN;
        if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs <= startedAtMs) {
          errors.push(`assessment.externalTiming[${index}] outside-active-turn timing needs a valid interval`);
        } else if (entry?.durationMs !== endedAtMs - startedAtMs) {
          errors.push(`assessment.externalTiming[${index}].durationMs must match its interval`);
        }
      }
    });
  }
  if (!Array.isArray(assessment.retries)) errors.push("assessment.retries must be an array");
  else {
    assessment.retries.forEach((entry, index) => {
      requireString(entry?.kind, `assessment.retries[${index}].kind`, errors);
      if (!Number.isInteger(entry?.count) || entry.count < 1) {
        errors.push(`assessment.retries[${index}].count must be a positive integer`);
      }
      requireString(entry?.reason, `assessment.retries[${index}].reason`, errors);
      requireStringArray(entry?.evidence, `assessment.retries[${index}].evidence`, errors);
    });
  }
  for (const key of ["requiredApprovals", "clarifications", "corrections", "rescues"]) {
    const value = assessment.humanIntervention?.[key];
    if (!Number.isInteger(value) || value < 0) errors.push(`assessment.humanIntervention.${key} must be a non-negative integer`);
  }
  requireStringArray(assessment.humanIntervention?.notes, "assessment.humanIntervention.notes", errors);
  if (!Array.isArray(assessment.reportedCosts)) errors.push("assessment.reportedCosts must be an array");
  else {
    assessment.reportedCosts.forEach((item, index) => {
      requireString(item?.kind, `assessment.reportedCosts[${index}].kind`, errors);
      if (typeof item?.amount !== "number" || !Number.isFinite(item.amount) || item.amount < 0) {
        errors.push(`assessment.reportedCosts[${index}].amount must be a non-negative number`);
      }
      requireString(item?.currency, `assessment.reportedCosts[${index}].currency`, errors);
      requireString(item?.status, `assessment.reportedCosts[${index}].status`, errors);
      requireString(item?.source, `assessment.reportedCosts[${index}].source`, errors);
    });
  }
  if (!Array.isArray(assessment.references)) errors.push("assessment.references must be an array");
  else {
    assessment.references.forEach((item, index) => {
      requireString(item?.kind, `assessment.references[${index}].kind`, errors);
      requireString(item?.value, `assessment.references[${index}].value`, errors);
    });
  }
  for (const key of ["approach"]) requireString(assessment.narrative?.[key], `assessment.narrative.${key}`, errors);
  for (const key of ["whatWorked", "whatDidNotWork", "timeLoss", "rework", "unmeasured"]) {
    requireStringArray(assessment.narrative?.[key], `assessment.narrative.${key}`, errors);
  }
  if (!Array.isArray(assessment.recommendations) || assessment.recommendations.length < 1 || assessment.recommendations.length > 5) {
    errors.push("assessment.recommendations must contain one to five items");
  } else {
    assessment.recommendations.forEach((item, index) => {
      for (const field of ["action", "reason", "expectedImpact", "validation"]) {
        requireString(item?.[field], `assessment.recommendations[${index}].${field}`, errors);
      }
    });
  }
  if (!confidenceLevels.has(assessment.confidence?.level)) errors.push("assessment.confidence.level is invalid");
  requireStringArray(assessment.confidence?.limitations, "assessment.confidence.limitations", errors);
  const serialized = JSON.stringify(assessment);
  if (/replace with/i.test(serialized)) errors.push("assessment still contains template placeholders");
  if (
    /-----BEGIN [A-Z ]*(?:PRIVATE KEY|OPENSSH KEY)-----|(?:^|[^A-Za-z0-9])(?:sk|gh[pousr])[-_][A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._~+/-]{20,}|https?:\/\/[^/\s:]+:[^@\s]+@|(?:token|secret|password|passwd|api[_-]?key|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/i.test(
      serialized,
    )
  ) {
    errors.push("assessment appears to contain a credential or secret");
  }
  return errors;
}

/** @param {any[]} scope */
function scopeSummary(scope) {
  return Object.fromEntries(
    [...scopeStatuses].map((status) => [status, scope.filter((item) => item.status === status).length]),
  );
}

/** @param {Record<string, {status: string}>} outcome */
function statusSummary(outcome) {
  return Object.values(outcome).reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] ?? 0) + 1;
    return summary;
  }, /** @type {Record<string, number>} */ ({}));
}

/** @param {any} assessment @param {any} telemetry */
function validateExternalTimingAttribution(assessment, telemetry) {
  /** @type {string[]} */
  const errors = [];
  const boundary = {
    startedAt: telemetry.cutoff.startedAt,
    endedAt: telemetry.cutoff.endedAt,
  };
  const operationalIntervals = Array.isArray(telemetry.timing.operationalIntervals)
    ? telemetry.timing.operationalIntervals
    : [];
  assessment.externalTiming.forEach((entry, index) => {
    if (entry.overlap !== "outside-active-turn") return;
    const interval = { startedAt: entry.startedAt, endedAt: entry.endedAt };
    if (
      timestampMs(interval.startedAt) < timestampMs(boundary.startedAt)
      || timestampMs(interval.endedAt) > timestampMs(boundary.endedAt)
    ) {
      errors.push(`assessment.externalTiming[${index}] falls outside the measurement boundary`);
    }
    if (operationalIntervals.some((active) => intervalsOverlap(interval, active))) {
      errors.push(`assessment.externalTiming[${index}] overlaps agent operational time`);
    }
  });
  return errors;
}

/** @param {number | null | undefined} milliseconds */
function formatDuration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return "unavailable";
  const totalSeconds = Math.round(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    !days && !hours ? `${seconds}s` : "",
  ].filter(Boolean).join(" ");
}

/** @param {unknown[]} items @param {(item: any) => string} render */
function markdownList(items, render = (item) => String(item)) {
  return items.length > 0 ? items.map((item) => `- ${render(item)}`).join("\n") : "- None observed.";
}

/** @param {any} measurement */
export function renderMarkdown(measurement) {
  const { telemetry, assessment, derived } = measurement;
  const tokenTotal = telemetry.tokens.allAgentsTotal ?? telemetry.tokens.total ?? "unavailable";
  const lines = [
    `# ${assessment.title}`,
    "",
    `Status: **${assessment.status}**  `,
    `Work type: **${assessment.workType}**  `,
    `Measurement: \`${measurement.measurementId}\`  `,
    `Thread: \`${telemetry.source.threadId}\``,
    "",
    "## Outcome",
    "",
    assessment.objective.initial,
    "",
    "| Dimension | Result |",
    "| --- | --- |",
    `| Measured work and attributable external wait | ${formatDuration(derived.measuredWorkAndExternalWaitMs)} |`,
    `| Agent operational time | ${formatDuration(telemetry.timing.operationalMs)} |`,
    `| External wait outside active turns | ${formatDuration(derived.externalWaitOutsideOperationalMs)} |`,
    `| External wait with unknown overlap | ${formatDuration(derived.externalWaitUnknownOverlapMs)} |`,
    `| Thread span (context only) | ${formatDuration(telemetry.timing.threadSpanMs)} |`,
    `| Unattributed between-turn gap | ${formatDuration(telemetry.timing.unattributedBetweenTurnMs)} |`,
    `| Agent capacity | ${formatDuration(telemetry.timing.agentCapacityMs)} |`,
    `| Tokens | ${tokenTotal} |`,
    `| Agents | ${telemetry.agents.unique} unique; peak ${telemetry.agents.peakConcurrent} |`,
    `| Tool calls | ${telemetry.tools.allAgentCalls}; ${telemetry.tools.allAgentFailures} observed failures |`,
    `| Monetary model cost | ${telemetry.monetaryCost.status} |`,
    "",
    "## Scope",
    "",
    ...assessment.scope.flatMap((item) => [
      `### ${item.item}`,
      "",
      `Status: **${item.status}**`,
      "",
      markdownList(item.evidence),
      "",
    ]),
    "Scope counts:",
    "",
    markdownList(Object.entries(derived.scope), ([status, count]) => `${status}: ${count}`),
    "",
    `Completed objectives: ${derived.scopeCompletion.completed}/${derived.scopeCompletion.total}; verified: ${derived.scopeCompletion.verified}/${derived.scopeCompletion.total}; unfinished: ${derived.scopeCompletion.unfinished}/${derived.scopeCompletion.total}.`,
    "",
    "## Functional evidence",
    "",
    ...Object.entries(assessment.outcome).flatMap(([name, entry]) => [
      `### ${name}`,
      "",
      `Status: **${entry.status}**`,
      "",
      markdownList(entry.evidence),
      "",
    ]),
    "## Quality",
    "",
    ...Object.entries(assessment.quality).flatMap(([name, entry]) => [
      `### ${name}`,
      "",
      `Status: **${entry.status}**`,
      "",
      "Evidence:",
      "",
      markdownList(entry.evidence),
      "",
      "Gaps:",
      "",
      markdownList(entry.gaps),
      "",
    ]),
    "## Execution",
    "",
    assessment.narrative.approach,
    "",
    `Parent models: ${telemetry.agents.parent.models.map((entry) => `${entry.model ?? "unknown"}/${entry.reasoning ?? "unknown"}`).join(", ") || "unavailable"}.`,
    "",
    `Human intervention: ${assessment.humanIntervention.requiredApprovals} required approvals, ${assessment.humanIntervention.clarifications} clarifications, ${assessment.humanIntervention.corrections} corrections, ${assessment.humanIntervention.rescues} rescues.`,
    "",
    markdownList(assessment.humanIntervention.notes),
    "",
    "## Errors and corrections",
    "",
    markdownList(
      assessment.errors,
      (entry) => `**${entry.category}** — ${entry.summary}. Impact: ${entry.impact}. Corrected: ${entry.corrected ? "yes" : "no"}.`,
    ),
    "",
    "## External timing",
    "",
    markdownList(
      assessment.externalTiming,
      (entry) => `**${entry.kind}** — ${entry.label}: ${formatDuration(entry.durationMs)} (${entry.status}; ${entry.overlap}; ${entry.verified ? "verified" : "unverified"}).`,
    ),
    "",
    "## Retries",
    "",
    markdownList(
      assessment.retries,
      (entry) => `**${entry.kind}** — ${entry.count} retries. Reason: ${entry.reason}.`,
    ),
    "",
    "## What worked",
    "",
    markdownList(assessment.narrative.whatWorked),
    "",
    "## What did not work",
    "",
    markdownList(assessment.narrative.whatDidNotWork),
    "",
    "## Time loss",
    "",
    markdownList(assessment.narrative.timeLoss),
    "",
    "## Rework",
    "",
    markdownList(assessment.narrative.rework),
    "",
    "## Unmeasured and limitations",
    "",
    markdownList([
      ...telemetry.confidence.limitations,
      ...assessment.narrative.unmeasured,
      ...assessment.confidence.limitations,
    ]),
    "",
    "## Reported costs",
    "",
    markdownList(
      assessment.reportedCosts,
      (item) => `${item.kind}: ${item.amount} ${item.currency} (${item.status}) — ${item.source}`,
    ),
    "",
    "## References",
    "",
    markdownList(assessment.references, (item) => `${item.kind}: ${item.value}`),
    "",
    "## Recommendations",
    "",
    ...assessment.recommendations.flatMap((item, index) => [
      `### ${index + 1}. ${item.action}`,
      "",
      `Reason: ${item.reason}`,
      "",
      `Expected impact: ${item.expectedImpact}`,
      "",
      `Validation: ${item.validation}`,
      "",
    ]),
  ];
  return `${lines.join("\n").trim()}\n`;
}

/** @param {string} path @param {string} contents */
async function writePrivateImmutable(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  try {
    await stat(path);
    throw new Error(`Refusing to overwrite existing measurement artifact: ${path}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/**
 * @param {{assessment: any, telemetry: any, outputRoot: string}} options
 */
export async function persistMeasurement(options) {
  const errors = validateAssessment(options.assessment);
  if (options.telemetry?.schemaVersion !== 2) {
    errors.push("telemetry.schemaVersion must equal 2");
  } else if (errors.length === 0) {
    errors.push(...validateExternalTimingAttribution(options.assessment, options.telemetry));
  }
  if (errors.length > 0) throw new Error(`Invalid assessment:\n- ${errors.join("\n- ")}`);
  const measurementId = randomUUID();
  const capturedAt = new Date().toISOString();
  const scope = scopeSummary(options.assessment.scope);
  const externalTimingMs = options.assessment.externalTiming.reduce(
    (total, entry) => total + entry.durationMs,
    0,
  );
  const externalWaitOutsideOperationalMs = unionDurationMs(
    options.assessment.externalTiming
      .filter((entry) => entry.overlap === "outside-active-turn" && entry.verified)
      .map((entry) => ({ startedAt: entry.startedAt, endedAt: entry.endedAt })),
  );
  const externalWaitUnknownOverlapMs = options.assessment.externalTiming
    .filter((entry) => entry.overlap === "unknown" && entry.verified)
    .reduce((total, entry) => total + entry.durationMs, 0);
  const derived = {
    scope,
    scopeCompletion: {
      total: options.assessment.scope.length,
      completed: scope["completed-verified"] + scope["completed-unverified"],
      verified: scope["completed-verified"],
      unfinished: scope.partial + scope["not-done"] + scope.blocked,
      excluded: scope["out-of-scope"],
    },
    functionalEvidence: statusSummary(options.assessment.outcome),
    measuredWorkAndExternalWaitMs:
      options.telemetry.timing.operationalMs + externalWaitOutsideOperationalMs,
    externalTimingMs,
    externalWaitOutsideOperationalMs,
    externalWaitUnknownOverlapMs,
    retries: options.assessment.retries.reduce((total, entry) => total + entry.count, 0),
  };
  const unsigned = {
    schemaVersion: 2,
    measurementId,
    revisionKind: options.assessment.supersedes ? "correction" : "initial",
    supersedes: options.assessment.supersedes,
    capturedAt,
    priorityOrder: ["speed-to-verified-outcome", "correctness-risk-gates", "cost"],
    compositeScore: null,
    telemetry: options.telemetry,
    assessment: options.assessment,
    derived,
  };
  const unsignedContents = `${JSON.stringify(unsigned, null, 2)}\n`;
  const measurement = {
    ...unsigned,
    integrity: {
      algorithm: "sha256",
      contentSha256: sha256(unsignedContents),
      covers: "measurement object without integrity",
    },
  };
  const repoHash = sha256(options.telemetry.repository.root ?? options.telemetry.repository.name).slice(0, 10);
  const repoSegment = `${safeSegment(options.telemetry.repository.name)}-${repoHash}`;
  const outputDirectory = resolve(
    options.outputRoot,
    "codex",
    repoSegment,
    options.telemetry.source.threadId,
  );
  resolveInside(outputDirectory, options.outputRoot);
  const timestamp = capturedAt.replace(/[:.]/g, "-");
  const base = `${timestamp}-${measurementId}`;
  const jsonPath = resolve(outputDirectory, `${base}.json`);
  const markdownPath = resolve(outputDirectory, `${base}.md`);
  await writePrivateImmutable(jsonPath, `${JSON.stringify(measurement, null, 2)}\n`);
  await writePrivateImmutable(markdownPath, renderMarkdown(measurement));
  return {
    ok: true,
    operation: "finalize-development-run",
    measurementId,
    jsonPath,
    markdownPath,
    integrity: measurement.integrity,
  };
}

/** @param {any} assessment */
function normalizeLegacyAssessment(assessment) {
  if (!isRecord(assessment)) return assessment;
  return {
    ...assessment,
    schemaVersion: 2,
    externalTiming: Array.isArray(assessment.externalTiming)
      ? assessment.externalTiming.map((entry) => ({
          ...entry,
          verified: Array.isArray(entry?.evidence) && entry.evidence.length > 0,
          overlap: "unknown",
        }))
      : assessment.externalTiming,
  };
}

/** @param {any} measurement */
export function validateMeasurement(measurement) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(measurement) || ![1, 2].includes(measurement.schemaVersion)) {
    return ["measurement.schemaVersion must equal 1 or 2"];
  }
  const legacy = measurement.schemaVersion === 1;
  if (!uuidPattern.test(measurement.measurementId ?? "")) errors.push("measurement.measurementId is invalid");
  if (!isRecord(measurement.telemetry) || measurement.telemetry.schemaVersion !== (legacy ? 1 : 2)) {
    errors.push("measurement.telemetry is invalid");
  }
  if (!legacy) {
    for (const field of ["operationalMs", "threadSpanMs", "unattributedBetweenTurnMs"]) {
      const value = measurement.telemetry?.timing?.[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push(`measurement.telemetry.timing.${field} must be a non-negative number`);
      }
    }
    for (const field of [
      "measuredWorkAndExternalWaitMs",
      "externalWaitOutsideOperationalMs",
      "externalWaitUnknownOverlapMs",
    ]) {
      const value = measurement.derived?.[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push(`measurement.derived.${field} must be a non-negative number`);
      }
    }
  }
  errors.push(...validateAssessment(legacy ? normalizeLegacyAssessment(measurement.assessment) : measurement.assessment));
  if (!isRecord(measurement.integrity) || measurement.integrity.algorithm !== "sha256") {
    errors.push("measurement.integrity is invalid");
  } else {
    const { integrity, ...unsigned } = measurement;
    const actual = sha256(`${JSON.stringify(unsigned, null, 2)}\n`);
    if (integrity.contentSha256 !== actual) errors.push("measurement integrity hash does not match content");
  }
  return errors;
}

/** @param {string} path @param {unknown} value */
async function writeJsonOutput(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(resolve(path), 0o600);
}

/** @param {Record<string, string | boolean>} options */
async function resolveSessionOptions(options) {
  const sessionsRoot = resolve(optionString(options, "sessions-root") ?? resolve(homedir(), ".codex", "sessions"));
  const threadId = optionString(options, "thread-id") ?? process.env.CODEX_THREAD_ID;
  const explicitSession = optionString(options, "session");
  const sessionPath = explicitSession
    ? resolve(explicitSession)
    : threadId
      ? await findSessionFile(sessionsRoot, threadId)
      : null;
  if (!sessionPath) throw new Error("Set CODEX_THREAD_ID or pass --thread-id/--session");
  return { sessionsRoot, sessionPath };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === "template") {
    const output = optionString(options, "output");
    if (!output) throw new Error("template requires --output <path>");
    await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
    await copyFile(assessmentTemplatePath, resolve(output));
    await chmod(resolve(output), 0o600);
    return { ok: true, operation: "template", output: resolve(output) };
  }
  if (command === "collect") {
    const sessionOptions = await resolveSessionOptions(options);
    const telemetry = await collectTelemetry({
      ...sessionOptions,
      cutoff: optionString(options, "cutoff") ?? "latest-user",
    });
    const output = optionString(options, "output");
    if (output) await writeJsonOutput(output, telemetry);
    return output ? { ok: true, operation: "collect", output: resolve(output), telemetry } : telemetry;
  }
  if (command === "finalize") {
    const assessmentPath = optionString(options, "assessment");
    if (!assessmentPath) throw new Error("finalize requires --assessment <path>");
    const sessionOptions = await resolveSessionOptions(options);
    const telemetry = await collectTelemetry({
      ...sessionOptions,
      cutoff: optionString(options, "cutoff") ?? "latest-user",
    });
    const assessment = JSON.parse(await readFile(resolve(assessmentPath), "utf8"));
    return persistMeasurement({
      assessment,
      telemetry,
      outputRoot: resolve(
        optionString(options, "output-root") ?? resolve(homedir(), ".development-system", "measurements"),
      ),
    });
  }
  if (command === "validate") {
    const path = optionString(options, "measurement");
    if (!path) throw new Error("validate requires --measurement <path>");
    const measurement = JSON.parse(await readFile(resolve(path), "utf8"));
    const errors = validateMeasurement(measurement);
    if (errors.length > 0) throw new Error(`Invalid measurement:\n- ${errors.join("\n- ")}`);
    return { ok: true, operation: "validate", measurement: resolve(path) };
  }
  throw new Error(
    "Usage: measure-development-run.mjs <collect|template|finalize|validate> [options]",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(async (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
      try {
        const temporary = process.argv.find((value) => value.endsWith(".tmp"));
        if (temporary) await rm(temporary, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    });
}
