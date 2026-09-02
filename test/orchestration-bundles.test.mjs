import assert from "node:assert/strict";
import test from "node:test";

import { buildOrchestrationBundle } from "../src/orchestration-bundles.mjs";

test("composes stack tactics, skill references, checks, and runtime fallback evidence", () => {
  const result = buildOrchestrationBundle({
    id: "NUTRI-120",
    capabilities: ["typescript", "react", "convex", "security"],
    checks: ["pnpm test --filter rbac"],
  }, {
    integrationChecks: ["pnpm verify"],
    runtimeEvidence: { observedSkills: ["tdd", "pstack-engineering"] },
  });
  assert.equal(result.valid, true);
  assert.equal(result.referenceSkills.includes("convex:convex-expert"), true);
  assert.equal(result.qualityOracles.includes("react-doctor"), true);
  assert.equal(result.qualityOracles.includes("convex-review"), true);
  assert.deepEqual(result.integrationChecks, ["pnpm verify"]);
  assert.equal(result.runtimeRequirements.find((entry) => entry.skill === "tdd").status, "unproven");
  assert.equal(result.runtimeRequirements.find((entry) => entry.skill === "convex:convex-expert").status, "unproven");
  assert.deepEqual(result.externalSideEffects, []);
});

test("fails closed for unknown capability or missing checks", () => {
  const result = buildOrchestrationBundle({ id: "T1", capabilities: ["magic"], checks: [] }, { integrationChecks: [] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /focused checks|integrationChecks|unsupported capabilities/);
});
