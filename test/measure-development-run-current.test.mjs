import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { collectTelemetry } from "../artifacts/1.10.0/skills/internal/measure-development-run/scripts/measure-development-run.mjs";

const parentId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";

function event(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}

async function writeSession(dir, name, lines) {
  const path = resolve(dir, name);
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

async function roots() {
  const root = await mkdtemp(resolve(tmpdir(), "measure-current-"));
  const sessionsRoot = resolve(root, "sessions");
  const sessionDirectory = resolve(sessionsRoot, "2026", "09", "07");
  await mkdir(sessionDirectory, { recursive: true });
  return { root, sessionsRoot, sessionDirectory };
}

test("interrupted turn then resume excludes idle gap", async () => {
  const { sessionsRoot, sessionDirectory } = await roots();
  const sessionPath = await writeSession(sessionDirectory, `rollout-x-${parentId}.jsonl`, [
    event("2026-09-07T00:00:00.000Z", "session_meta", { id: parentId, cwd: "/tmp", originator: "t", cli_version: "t", source: "t", model_provider: "t" }),
    event("2026-09-07T00:00:01.000Z", "event_msg", { type: "user_message", message: "go" }),
    event("2026-09-07T00:00:02.000Z", "event_msg", { type: "task_started", turn_id: "turn-A" }),
    event("2026-09-07T00:00:04.000Z", "event_msg", { type: "turn_aborted", turn_id: "turn-A" }),
    event("2026-09-07T00:01:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-B" }),
    event("2026-09-07T00:01:10.000Z", "event_msg", { type: "task_complete", turn_id: "turn-B", duration_ms: 999999 }),
    event("2026-09-07T00:02:00.000Z", "event_msg", { type: "user_message", message: "measure" }),
  ]);
  const telemetry = await collectTelemetry({ sessionsRoot, sessionPath, cutoff: "latest-user" });
  assert.equal(telemetry.timing.wallMs, 119000);
  assert.ok(telemetry.timing.operationalMs <= telemetry.timing.wallMs, `operational ${telemetry.timing.operationalMs} exceeds wall ${telemetry.timing.wallMs}`);
  assert.equal(telemetry.timing.operationalMs, 12000, "reported duration must not pull idle time into the turn");
  assert.equal(telemetry.turns.inProgress, 0);
});

test("cumulative token counters are summed across resets with dedupe", async () => {
  const { sessionsRoot, sessionDirectory } = await roots();
  const token = (ts, total) => event(ts, "event_msg", { type: "token_count", info: { total_token_usage: { input_tokens: total, total_tokens: total } } });
  const sessionPath = await writeSession(sessionDirectory, `rollout-x-${parentId}.jsonl`, [
    event("2026-09-07T00:00:00.000Z", "session_meta", { id: parentId, cwd: "/tmp", originator: "t", cli_version: "t", source: "t", model_provider: "t" }),
    event("2026-09-07T00:00:01.000Z", "event_msg", { type: "user_message", message: "go" }),
    event("2026-09-07T00:00:02.000Z", "event_msg", { type: "task_started", turn_id: "t1" }),
    token("2026-09-07T00:00:03.000Z", 100),
    token("2026-09-07T00:00:04.000Z", 150),
    token("2026-09-07T00:00:05.000Z", 150),
    token("2026-09-07T00:00:06.000Z", 20),
    token("2026-09-07T00:00:07.000Z", 60),
    event("2026-09-07T00:00:08.000Z", "event_msg", { type: "task_complete", turn_id: "t1", duration_ms: 6000 }),
    event("2026-09-07T00:00:09.000Z", "event_msg", { type: "user_message", message: "measure" }),
  ]);
  const telemetry = await collectTelemetry({ sessionsRoot, sessionPath, cutoff: "latest-user" });
  assert.equal(telemetry.tokens.total, 210);
});

for (const metadataOnly of [false, true]) test(`child discovery via ${metadataOnly ? "header" : "spawn output"} excludes inherited history`, async () => {
  const { sessionsRoot, sessionDirectory } = await roots();
  const sessionPath = await writeSession(sessionDirectory, `rollout-x-${parentId}.jsonl`, [
    event("2026-09-07T00:00:00.000Z", "session_meta", { id: parentId, cwd: "/tmp", originator: "t", cli_version: "t", source: "t", model_provider: "t" }),
    event("2026-09-07T00:00:01.000Z", "event_msg", { type: "user_message", message: "go" }),
    event("2026-09-07T00:00:02.000Z", "event_msg", { type: "task_started", turn_id: "p1" }),
    event("2026-09-07T00:00:05.000Z", "response_item", { type: "function_call", call_id: "spawn-1", name: "spawn_agent", arguments: JSON.stringify({ agent_type: "worker", task_name: "job" }) }),
    event("2026-09-07T00:00:05.500Z", "response_item", { type: "function_call_output", call_id: "spawn-1", output: JSON.stringify(metadataOnly ? { task_name: "/root/job" } : { agent_id: childId, status: "spawned" }) }),
    event("2026-09-07T00:00:10.000Z", "event_msg", { type: "task_complete", turn_id: "p1", duration_ms: 8000 }),
    event("2026-09-07T00:00:11.000Z", "event_msg", { type: "user_message", message: "measure" }),
  ]);
  // Child file contains inherited parent history (02s-04s) plus own work (06s-08s).
  await writeSession(sessionDirectory, `rollout-x-${childId}.jsonl`, [
    event("2026-09-07T00:00:05.000Z", "session_meta", { id: childId, ...(metadataOnly ? { parent_thread_id: parentId } : {}), cwd: "/tmp", originator: "t", cli_version: "t", source: "subagent", model_provider: "t" }),
    event("2026-09-07T00:00:02.000Z", "event_msg", { type: "task_started", turn_id: "inherited" }),
    event("2026-09-07T00:00:04.000Z", "event_msg", { type: "task_complete", turn_id: "inherited", duration_ms: 2000 }),
    event("2026-09-07T00:00:06.000Z", "event_msg", { type: "task_started", turn_id: "own" }),
    event("2026-09-07T00:00:08.000Z", "event_msg", { type: "task_complete", turn_id: "own", duration_ms: 2000 }),
    event("2026-09-07T00:00:03.000Z", "event_msg", { type: "token_count", info: { total_token_usage: { total_tokens: 500 } } }),
    event("2026-09-07T00:00:08.000Z", "event_msg", { type: "token_count", info: { total_token_usage: { total_tokens: metadataOnly ? 530 : 30 } } }),
  ]);
  const telemetry = await collectTelemetry({ sessionsRoot, sessionPath, cutoff: "latest-user" });
  assert.equal(telemetry.agents.childAgents, 1);
  const child = telemetry.agents.children[0];
  assert.equal(child.threadId, childId);
  assert.equal(child.durationMs, 2000);
  assert.ok(!child.startedAt || child.startedAt >= "2026-09-07T00:00:05.000Z", `inherited start leaked: ${child.startedAt}`);
  assert.equal(child.tokens, 30);
});
