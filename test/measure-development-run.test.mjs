import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  collectTelemetry,
  findSessionFile,
  persistMeasurement,
  sanitizeRemote,
  validateAssessment,
  validateMeasurement,
} from "../artifacts/1.0.0/skills/internal/measure-development-run/scripts/measure-development-run.mjs";

const threadId = "019f92ca-886b-7133-8734-36b5cd68cef4";
const childThreadId = "019f9306-c22e-7a60-891d-4591ec5fce49";

function event(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "development-run-fixture-"));
  const sessionsRoot = resolve(root, "sessions");
  const sessionDirectory = resolve(sessionsRoot, "2026", "07", "24");
  await mkdir(sessionDirectory, { recursive: true });
  const sessionPath = resolve(sessionDirectory, `rollout-2026-07-24T00-00-00-${threadId}.jsonl`);
  const lines = [
    event("2026-07-24T00:00:00.000Z", "session_meta", {
      id: threadId,
      cwd: root,
      originator: "Codex Test",
      cli_version: "test",
      source: "test",
      model_provider: "openai",
    }),
    event("2026-07-24T00:00:00.050Z", "response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "injected context" }],
    }),
    event("2026-07-24T00:00:01.000Z", "event_msg", {
      type: "user_message",
      message: "Build the feature",
    }),
    event("2026-07-24T00:00:01.100Z", "turn_context", {
      model: "gpt-test",
      effort: "high",
      cwd: root,
    }),
    event("2026-07-24T00:00:01.200Z", "event_msg", {
      type: "task_started",
      turn_id: "turn-1",
    }),
    event("2026-07-24T00:00:02.000Z", "response_item", {
      type: "custom_tool_call",
      call_id: "call-ok",
      name: "exec",
      status: "completed",
    }),
    event("2026-07-24T00:00:04.000Z", "response_item", {
      type: "custom_tool_call_output",
      call_id: "call-ok",
      output: [{ type: "input_text", text: "Script completed\nWall time 2 seconds\nOutput:\n" }],
    }),
    event("2026-07-24T00:00:05.000Z", "response_item", {
      type: "function_call",
      call_id: "spawn-review",
      name: "spawn_agent",
      arguments: JSON.stringify({ agent_type: "reviewer", task_name: "review_contract", message: "private task" }),
    }),
    event("2026-07-24T00:00:05.050Z", "response_item", {
      type: "function_call_output",
      call_id: "spawn-review",
      output: JSON.stringify({ task_name: "/root/review_contract", nickname: "Test" }),
    }),
    event("2026-07-24T00:00:05.100Z", "event_msg", {
      type: "sub_agent_activity",
      agent_thread_id: childThreadId,
      agent_path: "/root/review_contract",
      kind: "started",
      event_id: "spawn-review",
    }),
    event("2026-07-24T00:00:08.100Z", "event_msg", {
      type: "sub_agent_activity",
      agent_thread_id: childThreadId,
      agent_path: "/root/review_contract",
      kind: "completed",
      event_id: "spawn-review",
    }),
    event("2026-07-24T00:00:10.000Z", "event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          cache_write_input_tokens: 0,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 120,
        },
      },
    }),
    event("2026-07-24T00:00:11.000Z", "event_msg", {
      type: "task_complete",
      turn_id: "turn-1",
      duration_ms: 10000,
      time_to_first_token_ms: 500,
    }),
    event("2026-07-24T00:00:21.000Z", "event_msg", {
      type: "user_message",
      message: "Use the measurement skill",
    }),
    event("2026-07-24T00:00:21.100Z", "event_msg", {
      type: "task_started",
      turn_id: "turn-2",
    }),
    event("2026-07-24T00:00:22.000Z", "response_item", {
      type: "custom_tool_call",
      call_id: "measurement-call",
      name: "exec",
      status: "completed",
    }),
  ];
  await writeFile(sessionPath, `${lines.join("\n")}\n`, "utf8");
  await writeFile(
    resolve(sessionDirectory, `rollout-2026-07-24T00-00-05-${childThreadId}.jsonl`),
    `${[
      event("2026-07-24T00:00:05.100Z", "session_meta", {
        id: childThreadId,
        cwd: root,
        originator: "Codex Test",
        cli_version: "test",
        source: "subagent",
        model_provider: "openai",
      }),
      event("2026-07-24T00:00:05.200Z", "turn_context", {
        model: "gpt-review",
        effort: "medium",
        cwd: root,
      }),
      event("2026-07-24T00:00:05.250Z", "event_msg", {
        type: "task_started",
        turn_id: "child-turn",
      }),
      event("2026-07-24T00:00:08.100Z", "event_msg", {
        type: "task_complete",
        turn_id: "child-turn",
        duration_ms: 2850,
        time_to_first_token_ms: 300,
      }),
      event("2026-07-24T00:00:08.050Z", "event_msg", {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 40,
            cached_input_tokens: 10,
            output_tokens: 10,
            reasoning_output_tokens: 2,
            total_tokens: 50,
          },
        },
      }),
    ].join("\n")}\n`,
    "utf8",
  );
  return { root, sessionsRoot, sessionPath };
}

function validAssessment() {
  return {
    schemaVersion: 2,
    title: "Measured implementation",
    workType: "implementation",
    status: "partial",
    supersedes: null,
    objective: { initial: "Build the feature", changes: [] },
    scope: [
      {
        item: "Implement the contract",
        origin: "initial",
        status: "completed-verified",
        evidence: ["Focused test passed"],
      },
      {
        item: "Verify production",
        origin: "initial",
        status: "not-done",
        evidence: [],
      },
    ],
    outcome: {
      implementation: { status: "verified", evidence: ["Diff inspected"] },
      localChecks: { status: "verified", evidence: ["Test passed"] },
      independentReview: { status: "not-reached", evidence: [] },
      runtime: { status: "not-reached", evidence: [] },
      preview: { status: "not-applicable", evidence: [] },
      production: { status: "not-applicable", evidence: [] },
    },
    quality: {
      code: { status: "verified", evidence: ["Test passed"], gaps: [] },
      architecture: { status: "adequate", evidence: ["Boundary preserved"], gaps: [] },
      security: { status: "not-applicable", evidence: ["No trust-boundary change"], gaps: [] },
    },
    errors: [
      {
        category: "tool",
        summary: "Initial command failed",
        impact: "One retry",
        corrected: true,
        evidence: ["Retry passed"],
      },
    ],
    externalTiming: [
      {
        kind: "ci",
        label: "Quality workflow",
        durationMs: 5000,
        status: "passed",
        verified: true,
        overlap: "outside-active-turn",
        startedAt: "2026-07-24T00:00:11.000Z",
        endedAt: "2026-07-24T00:00:16.000Z",
        evidence: ["CI run 123"],
      },
    ],
    retries: [
      {
        kind: "command",
        count: 1,
        reason: "Initial invocation used an invalid option",
        evidence: ["Second invocation passed"],
      },
    ],
    humanIntervention: {
      requiredApprovals: 1,
      clarifications: 0,
      corrections: 0,
      rescues: 0,
      notes: ["Implementation authorization was required"],
    },
    reportedCosts: [],
    references: [{ kind: "commit", value: "abc123" }],
    narrative: {
      approach: "Implemented one bounded contract and tested it.",
      whatWorked: ["Focused test"],
      whatDidNotWork: ["First command"],
      timeLoss: ["One retry"],
      rework: ["Corrected the command"],
      unmeasured: ["Monetary model cost"],
    },
    recommendations: [
      {
        action: "Run the focused check first",
        reason: "The broad command caused avoidable retry time",
        expectedImpact: "Reduce correction time",
        validation: "Compare retry count in the next five runs",
      },
    ],
    confidence: { level: "high", limitations: [] },
  };
}

test("collector excludes abandoned between-turn gaps from operational time", async () => {
  const { sessionsRoot, sessionPath } = await fixture();
  assert.equal(await findSessionFile(sessionsRoot, threadId), sessionPath);
  const telemetry = await collectTelemetry({ sessionsRoot, sessionPath, cutoff: "latest-user" });
  assert.equal(telemetry.cutoff.startedAt, "2026-07-24T00:00:01.000Z");
  assert.equal(telemetry.cutoff.endedAt, "2026-07-24T00:00:21.000Z");
  assert.equal(telemetry.timing.wallMs, 20000);
  assert.equal(telemetry.timing.operationalMs, 10000);
  assert.equal(telemetry.timing.threadSpanMs, 20000);
  assert.equal(telemetry.timing.unattributedBetweenTurnMs, 10000);
  assert.equal(telemetry.timing.completedParentTurnMs, 10000);
  assert.equal(telemetry.timing.inProgressParentTurnMs, 0);
  assert.equal(telemetry.timing.betweenTurnAndHumanWaitMs, 10000);
  assert.equal(telemetry.timing.toolCallMs, 2050);
  assert.equal(telemetry.tokens.total, 120);
  assert.equal(telemetry.tokens.childAgentsTotal, 50);
  assert.equal(telemetry.tokens.allAgentsTotal, 170);
  assert.equal(telemetry.messages.user, 2);
  assert.equal(telemetry.tools.calls, 2);
  assert.equal(telemetry.tools.allAgentCalls, 2);
  assert.equal(telemetry.tools.incompleteAtCutoff, 0);
  assert.equal(telemetry.agents.unique, 2);
  assert.equal(telemetry.agents.peakConcurrent, 2);
  assert.equal(telemetry.agents.children[0].role, "reviewer");
  assert.equal(telemetry.agents.children[0].taskName, "review_contract");
  assert.equal(telemetry.agents.children[0].durationMs, 2850);
  assert.equal(telemetry.agents.children[0].tokens, 50);
  assert.equal(telemetry.source.transcriptPersisted, false);
});

test("explicit forensic cutoffs account for an in-progress parent turn", async () => {
  const { sessionsRoot, sessionPath } = await fixture();
  const telemetry = await collectTelemetry({
    sessionsRoot,
    sessionPath,
    cutoff: "2026-07-24T00:00:23.000Z",
  });
  assert.equal(telemetry.timing.completedParentTurnMs, 10000);
  assert.equal(telemetry.timing.inProgressParentTurnMs, 1900);
  assert.equal(telemetry.timing.observedParentTurnMs, 11900);
  assert.equal(telemetry.turns.inProgress, 1);
});

test("assessment validation rejects placeholders and accepts complete evidence", async () => {
  const template = JSON.parse(
    await readFile(
      resolve(
        import.meta.dirname,
        "..",
        "artifacts",
        "1.0.0",
        "skills",
        "internal",
        "measure-development-run",
        "assets",
        "assessment-template.json",
      ),
      "utf8",
    ),
  );
  assert.match(validateAssessment(template).join("\n"), /placeholder/i);
  assert.deepEqual(validateAssessment(validAssessment()), []);
  const withSecret = validAssessment();
  withSecret.references.push({ kind: "token", value: `sk-${"a".repeat(32)}` });
  assert.match(validateAssessment(withSecret).join("\n"), /credential or secret/i);
  const withSlackSecret = validAssessment();
  withSlackSecret.references.push({ kind: "slack", value: `xoxb-${"1".repeat(12)}-${"a".repeat(24)}` });
  assert.match(validateAssessment(withSlackSecret).join("\n"), /credential or secret/i);
  const withNpmSecret = validAssessment();
  withNpmSecret.references.push({ kind: "npm", value: `npm_${"a".repeat(36)}` });
  assert.match(validateAssessment(withNpmSecret).join("\n"), /credential or secret/i);
  const withUnknownExternalOverlap = validAssessment();
  delete withUnknownExternalOverlap.externalTiming[0].overlap;
  assert.match(validateAssessment(withUnknownExternalOverlap).join("\n"), /externalTiming\[0\]\.overlap/i);
  const withUnsupportedExternalTiming = validAssessment();
  withUnsupportedExternalTiming.externalTiming[0].evidence = [];
  assert.match(validateAssessment(withUnsupportedExternalTiming).join("\n"), /verified timing requires evidence/i);
});

test("remote sanitization removes URL credentials, query strings, and fragments", () => {
  assert.equal(
    sanitizeRemote("https://token:secret@example.com/org/repo.git?access_token=secret#private"),
    "https://example.com/org/repo.git",
  );
  assert.equal(sanitizeRemote("git@example.com:org/repo.git"), "git@example.com:org/repo.git");
});

test("final reports are private, integrity checked, transcript-free, and end with recommendations", async () => {
  const { root, sessionsRoot, sessionPath } = await fixture();
  const telemetry = await collectTelemetry({ sessionsRoot, sessionPath, cutoff: "latest-user" });
  const outputRoot = resolve(root, "measurements");
  const result = await persistMeasurement({
    assessment: validAssessment(),
    telemetry,
    outputRoot,
  });
  const measurement = JSON.parse(await readFile(result.jsonPath, "utf8"));
  assert.deepEqual(validateMeasurement(measurement), []);
  assert.equal(measurement.derived.scopeCompletion.completed, 1);
  assert.equal(measurement.derived.scopeCompletion.unfinished, 1);
  assert.equal(measurement.derived.measuredWorkAndExternalWaitMs, 15000);
  assert.equal(measurement.derived.externalTimingMs, 5000);
  assert.equal(measurement.derived.externalWaitOutsideOperationalMs, 5000);
  assert.equal(measurement.derived.externalWaitUnknownOverlapMs, 0);
  assert.equal(measurement.derived.retries, 1);
  assert.equal((await stat(result.jsonPath)).mode & 0o777, 0o600);
  assert.equal((await stat(result.markdownPath)).mode & 0o777, 0o600);
  const markdown = await readFile(result.markdownPath, "utf8");
  assert.doesNotMatch(markdown, /Build the feature.*Use the measurement skill/s);
  assert.match(markdown, /\| Measured work and attributable external wait \| 15s \|/);
  assert.match(markdown, /\| Thread span \(context only\) \| 20s \|/);
  assert.match(markdown, /## Recommendations[\s\S]*Compare retry count in the next five runs\s*$/);

  measurement.assessment.title = "Tampered";
  assert.match(validateMeasurement(measurement).join("\n"), /integrity hash/i);
});

test("external waits use verified non-overlapping interval unions", async () => {
  const { root, sessionsRoot, sessionPath } = await fixture();
  const telemetry = await collectTelemetry({ sessionsRoot, sessionPath, cutoff: "latest-user" });
  const assessment = validAssessment();
  assessment.externalTiming.push({
    kind: "deployment",
    label: "Overlapping deployment",
    durationMs: 5000,
    status: "passed",
    verified: true,
    overlap: "outside-active-turn",
    startedAt: "2026-07-24T00:00:12.000Z",
    endedAt: "2026-07-24T00:00:17.000Z",
    evidence: ["Deployment run 456"],
  });
  const result = await persistMeasurement({
    assessment,
    telemetry,
    outputRoot: resolve(root, "interval-measurements"),
  });
  const measurement = JSON.parse(await readFile(result.jsonPath, "utf8"));
  assert.equal(measurement.derived.externalTimingMs, 10000);
  assert.equal(measurement.derived.externalWaitOutsideOperationalMs, 6000);
  assert.equal(measurement.derived.measuredWorkAndExternalWaitMs, 16000);

  const overlapsAgent = validAssessment();
  overlapsAgent.externalTiming[0].startedAt = "2026-07-24T00:00:10.000Z";
  overlapsAgent.externalTiming[0].endedAt = "2026-07-24T00:00:15.000Z";
  await assert.rejects(
    persistMeasurement({
      assessment: overlapsAgent,
      telemetry,
      outputRoot: resolve(root, "invalid-overlap-measurements"),
    }),
    /overlaps agent operational time/i,
  );
});
