import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { buildDevelopmentRun, createDevelopmentRunRecorder } from "../src/development-run.mjs";

const identity = {
  runId: "run-03",
  objectiveId: "development-system-next",
  route: "flow-implement",
  tickets: ["DSN-03"],
  repository: { identity: "AO-HyS/development-system", revision: "a".repeat(40) },
  harness: "codex",
  model: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "high" },
};

test("run measurement separates phases and unions concurrent intervals without double counting", () => {
  const run = buildDevelopmentRun({
    ...identity,
    events: [
      { id: "discovery-1", phase: "discovery", kind: "start", monotonicMs: 0 },
      { id: "discovery-1", phase: "discovery", kind: "end", monotonicMs: 1_000 },
      { id: "implementation-1", phase: "implementation", kind: "start", monotonicMs: 1_000 },
      { id: "agent-1", phase: "agent-wait", kind: "start", monotonicMs: 2_000 },
      { id: "checks-1", phase: "checks", kind: "start", monotonicMs: 4_000 },
      { id: "implementation-1", phase: "implementation", kind: "end", monotonicMs: 7_000 },
      { id: "checks-1", phase: "checks", kind: "end", monotonicMs: 8_000 },
      { id: "agent-1", phase: "agent-wait", kind: "end", monotonicMs: 9_000 },
      { id: "review-1", phase: "review", kind: "start", monotonicMs: 9_000 },
      { id: "review-1", phase: "review", kind: "end", monotonicMs: 10_000 },
      { id: "evidence", phase: "checks", kind: "functional-evidence", monotonicMs: 10_000 },
    ],
  });

  assert.equal(run.valid, true);
  assert.equal(run.phases.implementation.durationMs, 6_000);
  assert.equal(run.phases.checks.durationMs, 4_000);
  assert.equal(run.phases["agent-wait"].durationMs, 7_000);
  assert.equal(run.timing.measuredUnionMs, 10_000);
  assert.equal(run.timing.activeUnionMs, 3_000);
  assert.equal(run.timing.waitUnionMs, 7_000);
  assert.equal(run.timing.wallMs, 10_000);
  assert.equal(run.speed.functionalEvidence.status, "met");
  assert.equal(run.telemetry.costUsd.status, "unproven");
  assert.equal(run.telemetry.tokens.status, "unproven");
});

test("retries, resumption, missing evidence, and ten-minute exceptions remain explicit", () => {
  const run = buildDevelopmentRun({
    ...identity,
    delayReason: "Provider preview queue",
    events: [
      { id: "implementation-1", phase: "implementation", kind: "start", monotonicMs: 0, attempt: 1 },
      { id: "implementation-1", phase: "implementation", kind: "end", monotonicMs: 240_000, attempt: 1, outcome: "failed" },
      { id: "resume", phase: "implementation", kind: "resume", monotonicMs: 300_000 },
      { id: "correction-2", phase: "correction", kind: "start", monotonicMs: 300_000, attempt: 2 },
      { id: "correction-2", phase: "correction", kind: "end", monotonicMs: 610_000, attempt: 2, outcome: "passed" },
      { id: "evidence", phase: "checks", kind: "functional-evidence", monotonicMs: 610_000 },
    ],
  });

  assert.equal(run.valid, true);
  assert.equal(run.retries, 1);
  assert.equal(run.resumptions, 1);
  assert.equal(run.speed.functionalEvidence.status, "missed-exception-documented");
  assert.equal(run.speed.functionalEvidence.reason, "Provider preview queue");
  assert.equal(run.phases.ci.status, "unproven");
  assert.equal(run.phases.provider.status, "unproven");
  assert.equal(run.quality.status, "unproven");
});

test("a recorder uses an injected monotonic clock and never requires telemetry", () => {
  let now = 0;
  const recorder = createDevelopmentRunRecorder(identity, { clock: () => now });
  recorder.start("implementation", "implementation-1");
  now = 1_500;
  recorder.end("implementation", "implementation-1", { outcome: "passed" });
  recorder.point("checks", "functional-evidence", "evidence");
  const run = recorder.snapshot();

  assert.equal(run.valid, true);
  assert.equal(run.phases.implementation.durationMs, 1_500);
  assert.equal(run.telemetry.provider.status, "unproven");
  assert.deepEqual(run.consumers, ["check-in", "development-steward", "release-train"]);
});

test("invalid monotonic ordering and undocumented ten-minute misses fail closed", () => {
  const invalid = buildDevelopmentRun({
    ...identity,
    events: [
      { id: "implementation-1", phase: "implementation", kind: "start", monotonicMs: 20 },
      { id: "implementation-1", phase: "implementation", kind: "end", monotonicMs: 10 },
      { id: "evidence", phase: "checks", kind: "functional-evidence", monotonicMs: 610_000 },
    ],
  });

  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /monotonic|delay reason/i);
});

test("development-run CLI emits the provider-neutral record", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "development-run-cli-"));
  const inputPath = resolve(directory, "run.json");
  await writeFile(inputPath, JSON.stringify({
    ...identity,
    events: [
      { id: "implementation", phase: "implementation", kind: "start", monotonicMs: 0 },
      { id: "implementation", phase: "implementation", kind: "end", monotonicMs: 100 },
    ],
  }), "utf8");
  const cliPath = resolve(import.meta.dirname, "..", "bin", "development-system.mjs");
  const result = spawnSync(process.execPath, [cliPath, "development-run", "--input", inputPath, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.operation, "development-run");
  assert.deepEqual(output.consumers, ["check-in", "development-steward", "release-train"]);
  assert.deepEqual(output.externalSideEffects, []);
});
