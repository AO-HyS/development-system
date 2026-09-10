import assert from "node:assert/strict";
import test from "node:test";
import { planOrchestration } from "../src/orchestration-plan.mjs";
import { resolveModelRoute } from "../src/model-routing.mjs";
import { agentRoster } from "../src/agent-roster.mjs";

const taskContract = {
  objective: "Correct a bounded regression", scope: ["src/feature"],
  acceptance: ["Affected behavior works"], expectedOutputs: ["Reviewed diff"],
  checks: ["focused regression"], authorizationBoundaries: ["local implementation"],
  stopCondition: "Affected checks and review complete",
};
test("ordinary work does not manufacture review and correction conversations", () => {
  const p = planOrchestration({ taskContract, signals: { trivial: false } });
  assert.equal(p.valid, true);
  assert.equal(p.mode, "direct");
  assert.equal(p.antiSlop.required, false);
  assert.equal(p.lanes.length, 1);
  assert.equal(p.authority.launchesAgents, false);
  assert.deepEqual(p.lanes[0].acceptance, taskContract.acceptance);
});
test("explicit structured review retains its protected correction contract", () => {
  const p = planOrchestration({ taskContract, signals: { trivial: false, structuredReview: true } });
  assert.equal(p.valid, true);
  assert.equal(p.antiSlop.required, true);
  assert.ok(p.lanes.some((lane) => lane.id === "correction"));
});
test("compact planning still rejects out-of-authority runtime receipts", () => {
  const p = planOrchestration({ taskContract, signals: { trivial: false }, correctionReceipt: { status: "passed" } });
  assert.equal(p.valid, false);
  assert.deepEqual(p.externalSideEffects, []);
});
test("default orchestration requests xhigh at normal speed and escalation never lowers effort", () => {
  const input = { roster: agentRoster, capability: "orchestration", routeSlot: "orchestration" };
  const plain = resolveModelRoute(input);
  const escalated = resolveModelRoute({ ...input, escalation: true });
  assert.equal(plain.valid, true);
  assert.equal(plain.selected.reasoning, "xhigh");
  assert.equal(escalated.selected.reasoning, "max");
  assert.ok(plain.selected.invocation.args.includes('service_tier="default"'));
  assert.equal(plain.selected.resolvedModel, null);
});
