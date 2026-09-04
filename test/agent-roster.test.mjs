import assert from "node:assert/strict";
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
  assert.equal(rosterModel("implementation-default").requested, "swe-1-7");
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
