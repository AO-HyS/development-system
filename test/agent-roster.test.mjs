import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { agentRoster, rosterChain, rosterModel, rosterRoute, validateAgentRoster } from "../src/agent-roster.mjs";

test("editable roster is valid and covers every planner route", () => {
  assert.deepEqual(validateAgentRoster(agentRoster), { valid: true, errors: [] });
  for (const slot of [
    "orchestration",
    "fast-execution",
    "implementation-default",
    "adversarial-review",
    "general-review",
    "security-review",
    "backend-review",
    "performance-review",
    "visual-review",
    "research",
    "computer-use",
  ]) assert.equal(rosterRoute(slot).candidates.length > 0, true, slot);
});

test("aliases share one ordered candidate list without duplicating policy", () => {
  assert.deepEqual(rosterChain("implementation-default"), rosterChain("fast-execution"));
  assert.equal(rosterModel("implementation-default").requested, "gpt-5.6-terra");
});

test("fast-execution leads with the current Terra/Sol recommendations and preserves the fallback order", () => {
  const chain = rosterChain("fast-execution");
  assert.deepEqual(chain.map((candidate) => candidate.model), [
    "gpt-5.6-terra",
    "gpt-5.6-sol",
    "opencode-go/glm-5.3-flash",
    "opencode-go/muse-spark-1.3-contributor",
    "opencode-go/qwen3.8-flash",
    "gpt-5.6-luna",
  ]);
  const route = rosterRoute("fast-execution");
  assert.equal(route.candidates[0].id, "codex-terra-priority");
  assert.equal(route.candidates[0].reasoning, "low");
  assert.equal(route.candidates[0].mappingStatus, "provisional");
  assert.equal(route.candidates[0].evidenceStatus, "runtime-required");
  assert.equal(route.candidates[0].independenceBoundary, "provider:openai-priority");
  assert.deepEqual(route.candidates[0].serviceTier, {
    tier: "priority",
    label: "fast",
    status: "runtime-required",
  });
  assert.equal("requiresVerifiedRuntimeAvailability" in route.candidates[0], false);
});

test("rosterModel never reports a runtime-resolved model from config alone", () => {
  for (const route of agentRoster.routes) {
    assert.equal(rosterModel(/** @type {string} */ (route.routeSlot)).resolved, null, route.id);
  }
});

test("the current fast route retains Sol as a provisional recommendation", () => {
  const route = rosterRoute("fast-execution");
  assert.equal(route.candidates.some((candidate) => candidate.id === "codex-sol-priority"), true);
  assert.equal(JSON.stringify(agentRoster).includes("gpt-5.6-sol"), true);
});

test("fast-execution wording keeps deterministic work out of the model route", () => {
  const route = rosterRoute("fast-execution");
  assert.equal(route.does.some((entry) => /buscar|evidencia|pruebas/i.test(entry)), false);
  assert.match(/** @type {string} */ (route.when), /Recomendaciones provisionales/i);
  assert.match(/** @type {string} */ (route.when), /parent conserva seleccion/i);
});

test("invalid manual edits fail closed with actionable errors", () => {
  const invalid = structuredClone(agentRoster);
  invalid.routes[0].candidates[0].reasoning = "magic";
  invalid.routes[1].routeSlot = invalid.routes[0].routeSlot;
  const result = validateAgentRoster(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unsupported: magic/);
  assert.match(result.errors.join("\n"), /duplicate route slot/);
});

test("1.5.19 installs the roster and roster-driven orchestration skill", async () => {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(await readFile(resolve(root, "manifests/1.5.19.json"), "utf8"));
  const catalog = JSON.parse(await readFile(resolve(root, "catalog/0.26.0.json"), "utf8"));
  const installedRoster = manifest.artifacts.find((artifact) => artifact.logicalName === "agent-roster");
  assert.equal(installedRoster.sourcePath, "config/1.5.19/agent-roster.json");
  assert.equal(installedRoster.destination, ".codex/development-system/agent-roster.json");
  const orchestration = catalog.skills.find((skill) => skill.logicalName === "coding-orchestration");
  assert.equal(orchestration.source.path, "artifacts/1.5.19/skills/internal/coding-orchestration");
});
