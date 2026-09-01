import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { planOrchestration } from "../src/orchestration-plan.mjs";

const baseContract = {
  objective: "Ship the bounded change",
  inputs: ["The supplied task request"],
  constraints: ["Preserve current behavior"],
  outOfScope: ["Unrelated product work"],
  scope: ["src/feature"],
  acceptance: ["The observable behavior is verified"],
  expectedOutputs: ["A verified diff and review packet"],
  checks: ["pnpm test --filter feature"],
  protectedBoundaries: ["Authentication and production data"],
  authorizationBoundaries: ["No merge or production promotion"],
  stopCondition: "Stop after the focused checks pass and the diff is ready for review.",
};

function plan(signals = {}) {
  return planOrchestration({
    taskContract: baseContract,
    signals,
  });
}

test("trivial work stays direct on the parent", () => {
  const result = plan({ trivial: true });
  assert.equal(result.valid, true);
  assert.equal(result.mode, "direct");
  assert.deepEqual(result.lanes.map((lane) => lane.role), ["orchestrator"]);
  assert.equal(result.lanes[0].model.resolved, "gpt-5.6-sol");
  assert.deepEqual(result.lanes[0].expectedOutputs, baseContract.expectedOutputs);
  assert.deepEqual(result.lanes[0].authorizationBoundaries, baseContract.authorizationBoundaries);
  assert.deepEqual(result.externalWriteIntents, []);
  assert.deepEqual(result.externalSideEffects, []);
});

test("normal non-trivial work uses Luna writer then independent Sol review", () => {
  const result = plan({ trivial: false });
  assert.equal(result.valid, true);
  assert.equal(result.mode, "sequential");
  assert.deepEqual(result.lanes.map((lane) => lane.role), ["fast_implementer", "reviewer"]);
  assert.equal(result.lanes[0].model.resolved, "gpt-5.6-luna");
  assert.equal(result.lanes[1].model.resolved, "gpt-5.6-sol");
  assert.equal(result.lanes[1].model.reasoning, "medium");
  assert.equal(result.lanes[1].independent, true);
  assert.equal(result.lanes[0].ownership[0], "src/feature");
  assert.deepEqual(result.lanes[1].constraints, baseContract.constraints);
  assert.deepEqual(result.lanes[1].protectedBoundaries, baseContract.protectedBoundaries);
});

test("observed specialist risk adds the matching specialist lane", () => {
  const result = plan({ trivial: false, specialistRisk: "security" });
  assert.equal(result.valid, true);
  assert.equal(result.mode, "specialist");
  assert.equal(result.lanes.some((lane) => lane.role === "security_reviewer"), true);
  assert.equal(result.lanes.find((lane) => lane.role === "security_reviewer").model.reasoning, "xhigh");
});

test("Code Mode eligibility is deterministic and selection remains with the host runtime", () => {
  const eligible = plan({
    trivial: false,
    kind: "audit",
    readOnly: true,
    structuredToolHeavy: true,
    codeModeEvidence: {
      observed: true,
      executionEvent: true,
      host: "t3code",
      source: "t3code-mcp",
      provenance: "host-runtime-receipt",
      tool: "functions.exec",
      event: "code-mode.execute.completed",
      status: "completed",
      version: "1.0.0",
      eventId: "evt-1",
      observedAt: "2026-08-31T12:00:00.000Z",
    },
  });
  assert.equal(eligible.codeMode.eligible, true);
  assert.equal(eligible.codeMode.selected, false);
  assert.equal(eligible.codeMode.selectionAuthority, "host-runtime");
  assert.equal(eligible.lanes[0].execution, "code-mode-attempt");
  assert.equal(eligible.lanes[0].executionPreference, "code-mode");
  assert.equal(eligible.lanes[0].executionFallback, "sequential-read-only-tools");

  const unavailable = plan({
    trivial: false,
    kind: "audit",
    readOnly: true,
    structuredToolHeavy: true,
    codeModeEvidence: { observed: false, source: "runtime" },
  });
  assert.equal(unavailable.valid, true);
  assert.equal(unavailable.codeMode.eligible, true);
  assert.equal(unavailable.codeMode.selected, false);
  assert.equal(unavailable.codeMode.selectionAuthority, "host-runtime");
  assert.equal(unavailable.codeMode.fallback, "sequential-read-only-tools");
  assert.equal(unavailable.lanes[0].execution, "code-mode-attempt");
  assert.equal(unavailable.lanes[0].role, "docs_researcher");
  assert.equal(unavailable.lanes[0].readOnly, true);

  const editing = plan({
    trivial: false,
    kind: "audit",
    readOnly: false,
    structuredToolHeavy: true,
    codeModeEvidence: { observed: true, executionEvent: true, source: "runtime" },
  });
  assert.equal(editing.codeMode.selected, false);
  assert.match(editing.codeMode.reason, /read-only/i);
});

test("eligible Code Mode retains explicit specialist risk review", () => {
  const result = plan({
    trivial: false,
    kind: "audit",
    readOnly: true,
    structuredToolHeavy: true,
    specialistRisk: "security",
    codeModeEvidence: {
      host: "t3code",
      source: "t3code-mcp",
      provenance: "host-runtime-receipt",
      tool: "functions.exec",
      event: "code-mode.execute.completed",
      status: "completed",
      version: "1.0.0",
      eventId: "evt-security",
      observedAt: "2026-08-31T12:00:00.000Z",
    },
  });
  assert.equal(result.codeMode.eligible, true);
  assert.equal(result.codeMode.selected, false);
  assert.equal(result.codeMode.selectionAuthority, "host-runtime");
  assert.deepEqual(result.lanes.map((lane) => lane.role), ["docs_researcher", "security_reviewer"]);
  assert.equal(result.lanes[0].executionPreference, "code-mode");
});

test("Code Mode ignores self-reports and command_execution fallback receipts", () => {
  const selfReport = plan({
    trivial: false,
    kind: "audit",
    readOnly: true,
    structuredToolHeavy: true,
    codeModeEvidence: { observed: true, executionEvent: true },
  });
  assert.equal(selfReport.codeMode.eligible, true);
  assert.equal(selfReport.codeMode.selected, false);
  assert.equal(selfReport.codeMode.selectionAuthority, "host-runtime");
  assert.equal(selfReport.lanes[0].executionPreference, "code-mode");
  assert.equal(selfReport.lanes[0].executionFallback, "sequential-read-only-tools");

  const commandFallback = plan({
    trivial: false,
    kind: "audit",
    readOnly: true,
    structuredToolHeavy: true,
    codeModeEvidence: {
      host: "codex",
      source: "codex-app-server",
      provenance: "host-runtime-receipt",
      tool: "command_execution",
      event: "command_execution.completed",
      status: "completed",
      version: "1.0.0",
      eventId: "evt-command",
      observedAt: "2026-08-31T12:00:00.000Z",
    },
  });
  assert.equal(commandFallback.codeMode.eligible, true);
  assert.equal(commandFallback.codeMode.selected, false);
  assert.equal(commandFallback.codeMode.selectionAuthority, "host-runtime");
  assert.equal(commandFallback.lanes[0].role, "docs_researcher");
  assert.equal(commandFallback.lanes[0].executionFallback, "sequential-read-only-tools");
});

test("simplify-code is selected only from explicit diff-risk signals", () => {
  const selected = plan({ trivial: false, diffRisk: { newAbstractions: true } });
  assert.equal(selected.simplifyCode.selected, true);
  assert.equal(selected.lanes.some((lane) => lane.role === "simplify-code"), true);
  assert.equal(selected.lanes.find((lane) => lane.role === "simplify-code").readOnly, true);

  const notSelected = plan({ trivial: false, diffRisk: { addedLines: 500 } });
  assert.equal(notSelected.simplifyCode.selected, false);
  assert.equal(notSelected.lanes.some((lane) => lane.role === "simplify-code"), false);
});

test("incomplete contracts fail closed without side effects", () => {
  const result = planOrchestration({ taskContract: { objective: "incomplete" }, signals: {} });
  assert.equal(result.valid, false);
  assert.equal(result.mode, "blocked");
  assert.equal(result.lanes.length, 0);
  assert.match(result.errors.join("\n"), /scope|acceptance|expectedOutputs|authorizationBoundaries|checks|stopCondition/);
  assert.deepEqual(result.externalWriteIntents, []);
  assert.deepEqual(result.externalSideEffects, []);
});

test("required lane contract fields are validated and Code Mode is not selected for direct work", () => {
  const missing = { ...baseContract };
  delete missing.expectedOutputs;
  const invalid = planOrchestration({ taskContract: missing, signals: { trivial: false } });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /expectedOutputs/);

  const direct = planOrchestration({
    taskContract: baseContract,
    signals: {
      trivial: true,
      kind: "audit",
      readOnly: true,
      structuredToolHeavy: true,
      codeModeEvidence: { observed: true, executionEvent: true },
    },
  });
  assert.equal(direct.mode, "direct");
  assert.equal(direct.codeMode.eligible, false);
  assert.equal(direct.codeMode.selected, false);
  assert.equal(direct.codeMode.selectionAuthority, "host-runtime");
  assert.equal(direct.codeMode.fallback, "direct");
  assert.deepEqual(direct.lanes[0].authorizationBoundaries, baseContract.authorizationBoundaries);
});

test("CLI exposes the pure planner as JSON", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "orchestration-plan-cli-"));
  const inputPath = resolve(directory, "input.json");
  await writeFile(inputPath, JSON.stringify({ taskContract: baseContract, signals: { trivial: true } }), "utf8");
  const cli = resolve(import.meta.dirname, "..", "bin", "development-system.mjs");
  const result = spawnSync(process.execPath, [cli, "orchestration-plan", "--input", inputPath, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).operation, "orchestration-plan");
  assert.equal(JSON.parse(result.stdout).mode, "direct");
});
