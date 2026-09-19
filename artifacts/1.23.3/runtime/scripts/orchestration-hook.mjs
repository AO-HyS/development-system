#!/usr/bin/env node
// @ts-check

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateSpawnHook, assertInsideRoot } from "../src/orchestration.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input);
  const runDirectory = process.env.DEVELOPMENT_SYSTEM_ORCHESTRATION_RUN_DIR;
  if (payload?.hook_event_name === "SubagentStart") {
    if (!runDirectory) {
      process.stdout.write("{}\n");
      process.exit(0);
    }
    const contextPath = assertInsideRoot(runDirectory, resolve(runDirectory, "run-context.json"));
    const context = JSON.parse(await readFile(contextPath, "utf8"));
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: [
          `Development System run ${context.runId}.`,
          `Exact root: ${context.root}.`,
          "Honor the write-set and stop conditions in the supplied packet. Do not delegate or change ownership.",
        ].join(" "),
      },
    })}\n`);
    process.exit(0);
  }
  if (payload?.hook_event_name === "SubagentStop") {
    if (runDirectory) {
      const contextPath = assertInsideRoot(runDirectory, resolve(runDirectory, "run-context.json"));
      const context = JSON.parse(await readFile(contextPath, "utf8"));
      const eventsDirectory = assertInsideRoot(runDirectory, resolve(runDirectory, "events"));
      await mkdir(eventsDirectory, { recursive: true, mode: 0o700 });
      const safeAgentId = String(payload.agent_id ?? "unknown").replaceAll(/[^a-zA-Z0-9_-]/g, "_");
      const event = {
        schemaVersion: 1,
        type: "subagent-stop",
        observationOnly: true,
        acceptance: false,
        atomId: null,
        attemptId: null,
        runId: context.runId ?? null,
        agentId: payload.agent_id ?? null,
        agentType: payload.agent_type ?? null,
        transcriptPath: payload.agent_transcript_path ?? null,
        stoppedAt: new Date().toISOString(),
      };
      await writeFile(resolve(eventsDirectory, `${randomUUID()}-${safeAgentId.slice(0,128)}.json`), `${JSON.stringify(event, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    }
    process.stdout.write("{}\n");
    process.exit(0);
  }
  const toolName = payload?.tool_name;
  const isSpawn = ["spawn_agent", "Agent"].includes(toolName)
    || (typeof toolName === "string" && /^multi_agent_v\d+__spawn_agent$/.test(toolName));
  if (payload?.hook_event_name !== "PreToolUse" || !isSpawn) {
    process.stdout.write("{}\n");
    process.exit(0);
  }
  if (!runDirectory) {
    process.stdout.write("{}\n");
    process.exit(0);
  }
  const messageAtom = typeof payload?.tool_input?.message === "string"
    ? payload.tool_input.message.match(/^Atom:\s*([a-z0-9_]+)\s*$/m)?.[1]
    : undefined;
  const taskName = payload?.tool_input?.task_name ?? messageAtom;
  if (typeof taskName !== "string" || !/^[a-z0-9_]+$/.test(taskName)) {
    process.stdout.write(`${JSON.stringify(evaluateSpawnHook(payload, null))}\n`);
    process.exit(0);
  }
  const routePath = assertInsideRoot(runDirectory, resolve(runDirectory, "routes", `${taskName}.json`));
  const routeReceipt = JSON.parse(await readFile(routePath, "utf8"));
  process.stdout.write(`${JSON.stringify(evaluateSpawnHook(payload, routeReceipt))}\n`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Orchestration hook failed closed: ${reason}`,
    },
  })}\n`);
}
