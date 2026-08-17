import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOrchestrationPilot } from "../src/orchestration-pilot.mjs";

const repositories = ["aohys", "casa-roca", "the-barber-central", "nutri-plan", "eteria", "opportunity-os"];
const run = (overrides = {}) => ({ repository: "aohys", nonTrivial: true, period: "candidate", mode: "direct", completed: true, outcomeVerified: true, waitCount: 1, correctionCount: 0, openLaneCount: 0, ...overrides });

test("the natural-work pilot retains only with stable outcomes and improved coordination", () => {
  const result = evaluateOrchestrationPilot({
    now: "2026-08-16T12:00:00Z",
    startedAt: "2026-08-11T12:00:00Z",
    repositories,
    runs: [
      run({ period: "baseline", waitCount: 3, correctionCount: 1 }),
      run({ period: "baseline", mode: "multi-agent-v2", waitCount: 2, correctionCount: 1 }),
      ...Array.from({ length: 5 }, (_, index) => run({ repository: repositories[index], mode: index === 0 ? "multi-agent-v2" : "direct" })),
    ],
  });
  assert.equal(result.valid, true);
  assert.equal(result.checkpoint.reached, true);
  assert.equal(result.decision, "retain");
  assert.equal(result.candidate.modes.direct, 4);
  assert.equal(result.causalClaim, false);
  assert.equal(result.repositories.length, 6);
  assert.equal(result.checkInFindings.length, 1);
  assert.deepEqual(result.externalSideEffects, []);
});

test("insufficient evidence extends the pilot and completed runs fail closed with open lanes", () => {
  const collecting = evaluateOrchestrationPilot({ now: "2026-08-12T12:00:00Z", startedAt: "2026-08-11T12:00:00Z", repositories, runs: [run()] });
  assert.equal(collecting.decision, "collect-more");
  assert.equal(collecting.checkpoint.reached, false);

  const invalid = evaluateOrchestrationPilot({ now: "2026-08-16T12:00:00Z", startedAt: "2026-08-11T12:00:00Z", repositories, runs: [run({ openLaneCount: 1 })] });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /open lanes/);
});

test("a coordination regression adjusts rather than claiming savings", () => {
  const result = evaluateOrchestrationPilot({
    now: "2026-08-16T12:00:00Z",
    startedAt: "2026-08-11T12:00:00Z",
    repositories,
    runs: [run({ period: "baseline", waitCount: 1 }), ...Array.from({ length: 5 }, () => run({ waitCount: 4 }))],
  });
  assert.equal(result.decision, "adjust");
  assert.equal(result.comparisons.waits, "regressed");
  assert.equal(result.causalClaim, false);
});
