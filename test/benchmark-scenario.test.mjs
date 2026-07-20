import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCapabilityRoster,
  runBenchmarkSuite,
  validateBenchmarkSuite,
} from "../src/benchmarks.mjs";

const capabilities = [
  "orchestration",
  "implementation",
  "review",
  "architecture",
  "browser-qa",
  "visual-judgment",
];

const suite = {
  schemaVersion: 1,
  suiteId: "capability-roster-v1",
  cases: capabilities.map((capability) => ({
    id: `${capability}-fixture`,
    capability,
    fixture: `fixtures/${capability}`,
    instructions: `Complete the ${capability} fixture`,
    checks: [`${capability}:verified`],
    candidates: [
      { id: `${capability}-codex`, harness: "codex", model: "gpt-5.6-sol", reasoning: "high" },
      { id: `${capability}-factory`, harness: "factory", model: "factory-challenger", reasoning: "high" },
    ],
  })),
};

const roster = {
  schemaVersion: 1,
  capabilities: Object.fromEntries(
    capabilities.map((capability) => [
      capability,
      {
        role: capability,
        codex: { model: "gpt-5.6-sol", reasoning: "high" },
        factory: {
          model: "inherit",
          reasoning: "high",
          resolvedModel: "factory-challenger",
        },
      },
    ]),
  ),
};

test("benchmark history preserves verified-delivery evidence per capability and candidate", async () => {
  assert.deepEqual(validateBenchmarkSuite(suite), []);
  const report = await runBenchmarkSuite({
    suite,
    runId: "bench-2026-07-20",
    runtime: async ({ benchmarkCase, candidate }) => ({
      completed: true,
      checksPassed: true,
      durationMs: candidate.harness === "codex" ? 1_000 : 900,
      correctionMs: candidate.harness === "codex" ? 100 : 250,
      tokens: candidate.harness === "codex" ? 2_000 : 1_800,
      costUsd: candidate.harness === "codex" ? 0.3 : 0.25,
      corrections: candidate.harness === "codex" ? 1 : 2,
      findings: candidate.harness === "codex" ? 0 : 1,
      slop: candidate.harness === "codex" ? [] : ["unrequested abstraction"],
      output: `${benchmarkCase.capability} complete`,
      command: `${candidate.harness} exec <fixture-prompt>`,
      exitCode: 0,
    }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.records.length, capabilities.length * 2);
  assert.equal("globalWinner" in report, false);
  assert.deepEqual(Object.keys(report.rankings).sort(), [...capabilities].sort());
  for (const record of report.records) {
    assert.equal(record.runId, "bench-2026-07-20");
    assert.ok(record.fixtureHash.length === 64);
    assert.ok(record.instructions.length > 0);
    assert.ok(record.checks.length > 0);
    assert.ok(record.verifiedDeliveryMs >= record.durationMs);
    assert.equal(typeof record.harness, "string");
    assert.equal(typeof record.model, "string");
    assert.equal(typeof record.reasoning, "string");
    assert.equal(typeof record.tokens, "number");
    assert.equal(typeof record.costUsd, "number");
    assert.equal(typeof record.corrections, "number");
    assert.equal(typeof record.findings, "number");
    assert.equal(typeof record.command, "string");
    assert.equal(record.exitCode, 0);
  }
});

test("the roster is capability-based and resolves Factory inherit reproducibly", () => {
  const resolved = resolveCapabilityRoster(roster);
  assert.deepEqual(Object.keys(resolved.capabilities).sort(), [...capabilities].sort());
  for (const capability of capabilities) {
    assert.equal(resolved.capabilities[capability].factory.requestedModel, "inherit");
    assert.equal(resolved.capabilities[capability].factory.model, "factory-challenger");
    assert.equal(resolved.capabilities[capability].role, capability);
  }

  const broken = structuredClone(roster);
  delete broken.capabilities.review.factory.resolvedModel;
  assert.throws(() => resolveCapabilityRoster(broken), /inherit.*resolved/i);
});

test("benchmark reports validated, timeout, permission-blocked, and provisional evidence without ranking incomplete runs", async () => {
  const report = await runBenchmarkSuite({
    suite,
    runId: "bench-statuses",
    runtime: async ({ benchmarkCase, candidate }) => {
      if (benchmarkCase.capability === "orchestration" && candidate.harness === "codex") {
        return {
          completed: false,
          checksPassed: false,
          durationMs: 60_000,
          correctionMs: 0,
          tokens: 0,
          costUsd: null,
          corrections: 0,
          findings: 1,
          output: "deadline exceeded",
          command: "codex exec",
          exitCode: null,
          failureKind: "timeout",
        };
      }
      if (benchmarkCase.capability === "implementation" && candidate.harness === "factory") {
        return {
          completed: false,
          checksPassed: false,
          durationMs: 10,
          correctionMs: 0,
          tokens: 0,
          costUsd: null,
          corrections: 0,
          findings: 1,
          output: "insufficient permission",
          command: "droid exec",
          exitCode: 1,
          failureKind: "permission-blocked",
        };
      }
      const provisional = benchmarkCase.capability === "architecture" && candidate.harness === "codex";
      return {
        completed: true,
        checksPassed: !provisional,
        durationMs: 100,
        correctionMs: 0,
        tokens: 100,
        costUsd: null,
        corrections: 0,
        findings: provisional ? 1 : 0,
        output: provisional ? "partial evidence" : `${benchmarkCase.capability}:verified`,
        command: `${candidate.harness} exec`,
        exitCode: 0,
      };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.summary.validated > 0, true);
  assert.equal(report.summary.timeout, 1);
  assert.equal(report.summary["permission-blocked"], 1);
  assert.equal(report.summary.provisional, 1);
  assert.equal(
    report.rankings.orchestration.some((entry) => entry.harness === "codex"),
    false,
  );
  assert.equal(
    report.rankings.implementation.some((entry) => entry.harness === "factory"),
    false,
  );
  assert.ok(report.records.every((record) => typeof record.evidenceStatus === "string"));
});

test("benchmark can rerun only roster-selected provisional candidates without weakening suite validation", async () => {
  const candidateIds = ["orchestration-codex", "architecture-factory"];
  const report = await runBenchmarkSuite({
    suite,
    runId: "bench-provisional-only",
    candidateIds,
    runtime: async ({ candidate }) => ({
      completed: true,
      checksPassed: true,
      durationMs: 100,
      correctionMs: 0,
      tokens: 100,
      costUsd: null,
      corrections: 0,
      findings: 0,
      output: "verified",
      command: `${candidate.harness} exec`,
      exitCode: 0,
    }),
  });

  assert.deepEqual(report.records.map((record) => `${record.capability}:${record.harness}`), [
    "orchestration:codex",
    "architecture:factory",
  ]);
  assert.equal(report.ok, true);
});

test("benchmark fixture hashes bind the exact fixture contents and forbidden terms", async () => {
  const runtime = async ({ candidate }) => ({
    completed: true,
    checksPassed: true,
    durationMs: 10,
    correctionMs: 0,
    tokens: 10,
    costUsd: null,
    corrections: 0,
    findings: 0,
    output: "verified",
    command: `${candidate.harness} exec`,
    exitCode: 0,
  });
  const firstSuite = structuredClone(suite);
  firstSuite.cases[0].fixtureContents = "authorization stays human";
  firstSuite.cases[0].forbiddenTerms = ["auto-merge"];
  const secondSuite = structuredClone(firstSuite);
  secondSuite.cases[0].fixtureContents = "authorization is delegated";
  const thirdSuite = structuredClone(firstSuite);
  thirdSuite.cases[0].forbiddenTerms = ["silent promotion"];

  const first = await runBenchmarkSuite({
    suite: firstSuite,
    runId: "fixture-first",
    candidateIds: ["orchestration-codex"],
    runtime,
  });
  const second = await runBenchmarkSuite({
    suite: secondSuite,
    runId: "fixture-second",
    candidateIds: ["orchestration-codex"],
    runtime,
  });
  const third = await runBenchmarkSuite({
    suite: thirdSuite,
    runId: "fixture-third",
    candidateIds: ["orchestration-codex"],
    runtime,
  });

  assert.notEqual(first.records[0].fixtureHash, second.records[0].fixtureHash);
  assert.notEqual(first.records[0].fixtureHash, third.records[0].fixtureHash);
});
