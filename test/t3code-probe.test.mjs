import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateT3CodeProbe,
  requiredT3CodeLifecycleSkills,
} from "../src/t3code-probe.mjs";

function report(skillAuditHealthy = true) {
  return {
    requestedModel: { model: "gpt-5.6-sol" },
    observed: {
      routerLoaded: true,
      lifecycleSkills: requiredT3CodeLifecycleSkills,
      influenceSignatures: Object.fromEntries(
        requiredT3CodeLifecycleSkills.map((skill) => [skill, `${skill} rule`]),
      ),
      skillAuditHealthy,
      model: "gpt-5.6-sol",
    },
    externalState: {
      gitHeadUnchanged: true,
      gitStatusUnchanged: true,
    },
  };
}

test("T3Code probe accepts concise and detailed healthy skill audit evidence", () => {
  assert.equal(evaluateT3CodeProbe(report(true)), true);
  assert.equal(evaluateT3CodeProbe(report({ healthy: true, logicalSkills: 20 })), true);
});

test("T3Code probe fails closed when a lifecycle skill or repository invariant is missing", () => {
  const missingSkill = report();
  missingSkill.observed.lifecycleSkills = ["flow-code-review"];
  assert.equal(evaluateT3CodeProbe(missingSkill), false);

  const changedRepository = report();
  changedRepository.externalState.gitStatusUnchanged = false;
  assert.equal(evaluateT3CodeProbe(changedRepository), false);
});
