import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeOperationalReports,
  validateHarnessRegistry,
  validateOperationalScenarios,
} from "../src/harnesses.mjs";

const observableChecks = {
  instructions: true,
  catalog: true,
  load: true,
  hooks: true,
  roster: true,
  modelRole: true,
  sideEffects: true,
  externalState: true,
  noOverflow: true,
};

const observableEvidence = {
  instructionSources: ["AGENTS.md", "drive-development-flow/SKILL.md"],
  catalogSkills: ["drive-development-flow", "coding-orchestration"],
  rosterSource: "personal agent catalog",
  hookStatus: "safe-skip",
  hookEvidence: "No repository-specific hook applies to this read-only action",
  externalSideEffects: [],
  externalState: "unchanged",
  catalogOverflow: false,
};

const registry = {
  schemaVersion: 1,
  contractVersion: "0.4.0",
  adapters: {
    codex: {
      kind: "native",
      executable: "codex",
      tools: "codex-tools",
      agents: "personal-agents",
      hooks: "codex-hooks",
      stateNamespace: "codex",
      activationPrefix: "$",
    },
    factory: {
      kind: "native",
      executable: "droid",
      tools: "factory-tools",
      agents: "factory-droids",
      hooks: "factory-hooks",
      stateNamespace: "factory",
      activationPrefix: "/",
    },
    t3code: {
      kind: "client-surface",
      adapter: "codex",
      executable: "codex",
      stateNamespace: "codex",
    },
  },
};

const expectedBehavior = {
  selectedStage: "flow-implement",
  transition: "recommend-only",
  authorization: "none",
  externalSideEffects: [],
  terminalState: "unchanged",
};

const scenarios = [
  { id: "ao-root", fixture: "ao", cwd: "/projects", surfaces: ["codex"] },
  { id: "simple-repo", fixture: "simple", cwd: "/projects/simple", surfaces: ["factory"] },
  {
    id: "mature-repo",
    fixture: "mature",
    cwd: "/projects/nutri-plan",
    surfaces: ["codex", "factory", "t3code"],
  },
  {
    id: "nested-cwd",
    fixture: "nested",
    cwd: "/projects/aohys/apps/dashboard",
    surfaces: ["codex", "factory", "t3code"],
  },
].map((scenario) => ({ ...scenario, expectedBehavior }));

test("operational validation compares observable parity across real harness adapter boundaries", async () => {
  assert.deepEqual(validateHarnessRegistry(registry), []);
  const calls = [];
  const report = await validateOperationalScenarios({
    registry,
    scenarios,
    runtime: async (request) => {
      calls.push(request);
      const naturalLanguageVariant = request.scenario.id === "ao-root";
      return {
        executable: request.adapter.executable,
        version: "fixture-runtime-1",
        model: request.surface === "factory" ? "factory-model" : "gpt-5.6-sol",
        reasoning: "high",
        role: "orchestrator",
        checks: observableChecks,
        evidence: naturalLanguageVariant
          ? { ...observableEvidence, externalState: "No external system contacted; no files written." }
          : observableEvidence,
        catalogProof: true,
        catalogOverflowProof: true,
        loadProof: true,
        behavior: naturalLanguageVariant
          ? { ...expectedBehavior, terminalState: "Stopped after classification without a transition." }
          : expectedBehavior,
        diagnostics: [],
      };
    },
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.coverage, ["ao", "mature", "nested", "simple"]);
  assert.ok(report.results.every((result) => result.status === "passed"));
  assert.ok(report.results.every((result) => result.externalSideEffects.length === 0));
  assert.equal(calls.length, 8);
  assert.ok(calls.every((call) => call.prompt.includes("observable development contract")));

  const codex = report.results.find(
    (result) => result.scenario === "mature-repo" && result.surface === "codex",
  );
  const t3code = report.results.find(
    (result) => result.scenario === "mature-repo" && result.surface === "t3code",
  );
  assert.equal(t3code.adapter, "codex");
  assert.equal(t3code.stateNamespace, codex.stateNamespace);
  assert.deepEqual(t3code.behavior, codex.behavior);
});

test("operational validation separates canonical, adapter, runtime, and repo-policy failures", async () => {
  const report = await validateOperationalScenarios({
    registry,
    scenarios: [
      { ...scenarios[0], id: "canonical", expectedContractVersion: "9.9.9" },
      { ...scenarios[1], id: "runtime" },
      { ...scenarios[2], id: "adapter", surfaces: ["codex", "factory"] },
      { ...scenarios[3], id: "policy", policyErrors: ["foreign AGENTS instructions"] },
    ],
    runtime: async (request) => {
      if (request.scenario.id === "runtime") {
        const error = new Error("Factory process exited 12");
        error.code = "HARNESS_RUNTIME";
        throw error;
      }
      return {
        executable: request.adapter.executable,
        version: "fixture-runtime-1",
        model: "fixture-model",
        reasoning: "high",
        role: "orchestrator",
        checks: observableChecks,
        evidence: observableEvidence,
        catalogProof: true,
        catalogOverflowProof: true,
        loadProof: true,
        behavior:
          request.scenario.id === "adapter" && request.surface === "factory"
            ? { ...expectedBehavior, selectedStage: "wayfinder" }
            : expectedBehavior,
        diagnostics: [],
      };
    },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    [...new Set(report.failures.map((failure) => failure.source))].sort(),
    ["adapter", "canonical-source", "harness-runtime", "repo-policy"],
  );
  assert.ok(report.failures.every((failure) => failure.message.length > 0));
});

test("operational checks fail closed when a harness only self-reports green booleans", async () => {
  const report = await validateOperationalScenarios({
    registry,
    scenarios: [scenarios[0]],
    runtime: async () => ({
      executable: "codex",
      version: "fixture-runtime-1",
      model: "gpt-5.6-sol",
      reasoning: "high",
      role: "orchestrator",
      checks: observableChecks,
      behavior: expectedBehavior,
      diagnostics: [],
    }),
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.map((failure) => failure.message).join("\n"), /instructions|catalog|load/i);
});

test("resume preserves first-failure evidence while replacing stale scenario results", () => {
  const merged = mergeOperationalReports({
    contractVersion: "0.4.0",
    resumeReport: {
      coverage: ["simple"],
      results: [{ scenario: "simple", surface: "codex", status: "passed" }],
      failures: [{ scenario: "simple", surface: null, source: "repo-policy", message: "stale" }],
    },
    scenarios: [{ id: "simple", fixture: "simple", surfaces: ["codex", "factory"], rerunAll: true }],
    scenarioReports: [{
      ok: true,
      coverage: ["simple"],
      results: [
        { scenario: "simple", surface: "codex", status: "passed" },
        { scenario: "simple", surface: "factory", status: "passed" },
      ],
      failures: [],
    }],
  });

  assert.equal(merged.ok, true);
  assert.equal(merged.failures.length, 0);
  assert.equal(merged.results.length, 2);
  assert.deepEqual(merged.recoveredFailures, [
    { scenario: "simple", surface: null, source: "repo-policy", message: "stale" },
  ]);
  assert.equal(merged.attempts.length, 2);
});

test("repeated resumes accumulate every recovered failure without erasing earlier history", () => {
  const firstRecovery = mergeOperationalReports({
    contractVersion: "0.6.0",
    resumeReport: {
      coverage: ["simple"],
      results: [],
      failures: [{ scenario: "simple", surface: "codex", source: "harness-runtime", message: "A failed" }],
    },
    scenarios: [{ id: "simple", fixture: "simple", surfaces: ["codex", "factory"] }],
    scenarioReports: [{
      coverage: ["simple"],
      results: [{ scenario: "simple", surface: "codex", status: "passed" }],
      failures: [{ scenario: "simple", surface: "factory", source: "harness-runtime", message: "B failed" }],
    }],
  });
  const secondRecovery = mergeOperationalReports({
    contractVersion: "0.6.0",
    resumeReport: firstRecovery,
    scenarios: [{ id: "simple", fixture: "simple", surfaces: ["factory"] }],
    scenarioReports: [{
      coverage: ["simple"],
      results: [{ scenario: "simple", surface: "factory", status: "passed" }],
      failures: [],
    }],
  });

  assert.equal(secondRecovery.ok, true);
  assert.deepEqual(secondRecovery.recoveredFailures.map((failure) => failure.message), ["A failed", "B failed"]);
  assert.equal(secondRecovery.attempts.length, 3);
});

test("nested T3Code accepts explicit no-state evidence without a manual rerun", async () => {
  const nested = scenarios.find((scenario) => scenario.id === "nested-cwd");
  const report = await validateOperationalScenarios({
    registry,
    scenarios: [{ ...nested, surfaces: ["codex", "t3code"] }],
    runtime: async (request) => ({
      executable: request.adapter.executable,
      version: "fixture-runtime-1",
      model: "gpt-5.6-sol",
      reasoning: "high",
      role: "orchestrator",
      evidence: {
        ...observableEvidence,
        externalState: request.surface === "t3code"
          ? "No persisted lifecycle state exists and nothing was written"
          : "unchanged",
      },
      catalogProof: true,
      catalogOverflowProof: true,
      loadProof: true,
      behavior: expectedBehavior,
      diagnostics: [],
    }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.failures.length, 0);
  assert.ok(report.results.every((result) => result.checks.externalState));
});

test("equivalent read-only evidence phrases keep externalState deterministic across Factory and T3Code", async () => {
  const phrases = new Map([
    ["factory", "read-only; no repository search or other tool calls issued, no files edited"],
    ["t3code", "repository and lifecycle state unmodified; no tools called"],
  ]);
  const report = await validateOperationalScenarios({
    registry,
    scenarios: [{ ...scenarios[1], surfaces: ["factory", "t3code"] }],
    runtime: async (request) => ({
      executable: request.adapter.executable,
      version: "fixture-runtime-1",
      model: "fixture-model",
      reasoning: "high",
      role: "orchestrator",
      evidence: { ...observableEvidence, externalState: phrases.get(request.surface) },
      catalogProof: true,
      catalogOverflowProof: true,
      loadProof: true,
      behavior: request.surface === "t3code"
        ? { ...expectedBehavior, authorization: "Discussion/discovery authorization only; implementation or lifecycle advancement not authorized in this request." }
        : expectedBehavior,
      diagnostics: [],
    }),
  });

  assert.equal(report.ok, true);
  assert.ok(report.results.every((result) => result.checks.externalState));
});
