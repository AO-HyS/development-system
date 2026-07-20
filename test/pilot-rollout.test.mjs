import assert from "node:assert/strict";
import test from "node:test";

import { validatePilotRolloutEvidence } from "../src/pilot-rollout.mjs";

function pilot(name) {
  return {
    name,
    repository: `AO-HyS/${name}`,
    baseCommit: "1".repeat(40),
    productCommit: "2".repeat(40),
    auditFingerprint: "3".repeat(64),
    managedMutationScope: [
      ".development-system/repository.json",
      ".codex/development-system/repository.md",
      ".factory/development-system/repository.md",
    ],
    preserved: { releasePolicyFiles: [".github/workflows/release.yml"], designFiles: ["src/styles.css"] },
    commands: {
      review: "pnpm run lint",
      validation: "pnpm run verify",
      qa: "pnpm run test",
      preview: "pnpm run dev",
    },
    harnesses: {
      codex: "validated",
      t3code: "validated",
      factory: "validated",
    },
    checks: [{ id: "verify", command: "pnpm run verify", status: "passed", evidence: "exit 0" }],
    pullRequest: { url: "https://github.com/AO-HyS/example/pull/1", status: "open" },
    preview: { status: "ready", url: "https://preview.example.com" },
    residualRisks: ["human review pending"],
    rollback: { kind: "revert-product-commit", command: `git revert ${"2".repeat(40)}` },
    localVisualRecap: { status: "written", privatePath: `.development-system/private/AOH-147/${name}.md` },
    decision: "ready-for-human",
  };
}

function evidence() {
  return {
    schemaVersion: 1,
    contractVersion: "0.7.0",
    linearIssue: "AOH-147",
    generatedAt: "2026-07-20T00:00:00.000Z",
    candidate: {
      sourceCommit: "4".repeat(40),
      pullRequest: "https://github.com/AO-HyS/development-system/pull/1",
      harnessEvidence: "evidence/pilots-harnesses-live-2026-07-20.json",
      skillEvidence: "evidence/skills-live-2026-07-20-hardening.json",
    },
    pilots: [pilot("nutri-plan"), pilot("the-barber-central"), pilot("aohys.com")],
    excludedRepositories: [
      { name: "Escuela 360", readiness: "unready", inspectedAsReference: false, modified: false },
    ],
    prohibitedOperations: {
      merge: false,
      release: false,
      production: false,
      paidActivation: false,
      canonicalHomeSync: false,
    },
    decision: "ready-for-human",
  };
}

test("three comparable pilots and an untouched Escuela 360 reach the human gate", () => {
  const result = validatePilotRolloutEvidence(evidence());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.decision, "ready-for-human");
});

test("the candidate fails closed on missing preview, harness parity, or Escuela 360 contact", () => {
  const document = evidence();
  document.pilots[0].preview = { status: "pending", url: null };
  document.pilots[1].harnesses.factory = "structural-only";
  document.excludedRepositories[0].inspectedAsReference = true;

  const result = validatePilotRolloutEvidence(document);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("nutri-plan preview")));
  assert.ok(result.errors.some((error) => error.includes("the-barber-central factory")));
  assert.ok(result.errors.some((error) => error.includes("Escuela 360")));
  assert.equal(result.decision, "blocked");
});

test("delivery authority remains stopped before merge, release, and production", () => {
  const document = evidence();
  document.prohibitedOperations.merge = true;
  document.prohibitedOperations.canonicalHomeSync = true;

  const result = validatePilotRolloutEvidence(document);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("merge")));
  assert.ok(result.errors.some((error) => error.includes("canonicalHomeSync")));
});
