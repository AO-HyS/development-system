import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKING_BACKWARDS_RISK_INTERFACE,
  assessWorkingBackwardsRisk,
} from "../src/working-backwards-risk.mjs";

const settled = {
  behaviorSettled: true,
  scopeNarrow: true,
  rollbackEasy: true,
  singleSurface: true,
};

test("authorization is Complex, rejects a downshift, and asks only for security evidence", () => {
  const blocked = assessWorkingBackwardsRisk({
    feature: { ...settled, authorization: true },
    profileOverride: { profile: "Standard", rationale: "La entrega es urgente." },
  });

  assert.equal(blocked.minimumProfile, "Complex");
  assert.equal(blocked.recommendedProfile, "Complex");
  assert.equal(blocked.selectedProfile, "Complex");
  assert.equal(blocked.override.accepted, false);
  assert.deepEqual(blocked.hardRiskTriggers, ["authorization"]);
  assert.deepEqual(blocked.requestedEvidence.map((evidence) => evidence.type), ["security"]);
  assert.equal(blocked.technicalGate.status, "blocked");
  assert.equal(blocked.smallestUnresolvedArtifact?.type, "security");

  const approved = assessWorkingBackwardsRisk({
    feature: { ...settled, authorization: true },
    riskEvidence: [{ type: "security", trigger: "authorization", status: "approved" }],
  });
  assert.equal(approved.technicalGate.status, "approved");
  assert.equal(approved.ok, true);
});

test("migration and backfill request migration evidence and fail on contradiction", () => {
  const blocked = assessWorkingBackwardsRisk({
    feature: { migration: true, backfill: true },
  });

  assert.deepEqual(blocked.hardRiskTriggers, ["migration", "backfill"]);
  assert.deepEqual(blocked.requestedEvidence.map((evidence) => evidence.type), ["migration", "migration"]);
  assert.equal(blocked.smallestUnresolvedArtifact?.id, "working-backwards-risk:migration:migration");

  const contradictory = assessWorkingBackwardsRisk({
    feature: { migration: true },
    evidence: [{ type: "migration", trigger: "migration", status: "contradictory" }],
  });
  assert.equal(contradictory.evidenceChecks[0].status, "contradictory");
  assert.equal(contradictory.technicalGate.status, "blocked");
  assert.match(contradictory.technicalGate.reason, /conflicts|invalid/i);
});

test("paid activation plus uncertain provider asks for rollout and prototype evidence only", () => {
  const result = assessWorkingBackwardsRisk({
    feature: { paidActivation: true, externalProvider: true },
    profile: "Quick",
    riskEvidence: [
      { type: "rollout", trigger: "paid-activation", approved: true },
      { type: "prototype", trigger: "external-provider-uncertainty", verified: true },
    ],
  });

  assert.deepEqual(result.hardRiskTriggers, ["paid-activation", "external-provider-uncertainty"]);
  assert.equal(result.selectedProfile, "Complex");
  assert.deepEqual(result.requestedEvidence.map((evidence) => evidence.type), ["rollout", "prototype"]);
  assert.equal(result.technicalGate.status, "approved");
  assert.equal(result.requestedEvidence.some((evidence) => ["adr", "migration", "security"].includes(evidence.type)), false);
});

test("multiple repositories escalate from repository facts without contacting services", () => {
  const input = {
    feature: { ...settled },
    repository: { repositories: ["service-a", "service-b"] },
    profileOverride: { profile: "Quick", rationale: "Sólo cambiaremos un adaptador." },
  };
  const first = WORKING_BACKWARDS_RISK_INTERFACE.assess(input);
  const second = assessWorkingBackwardsRisk(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first.hardRiskTriggers, ["multi-repository"]);
  assert.equal(first.selectedProfile, "Complex");
  assert.equal(first.override.accepted, false);
  assert.deepEqual(first.requestedEvidence.map((evidence) => evidence.type), ["rollout"]);
  assert.equal(first.technicalGate.status, "blocked");
});
