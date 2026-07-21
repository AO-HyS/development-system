import assert from "node:assert/strict";
import test from "node:test";

import { validatePilotRolloutEvidence } from "../src/pilot-rollout.mjs";

function pilot(name) {
  const claims = {
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
    review: { blocker: 0, high: 0, medium: 0, low: 0, mediumDispositions: [], evidence: "blind review lanes" },
    qaSelection: { level: "full", reason: "pilot acceptance", evidence: "repository and preview checks" },
    checks: [{ id: "verify", command: "pnpm run verify", status: "passed", evidence: "exit 0" }],
    pullRequest: { url: "https://github.com/AO-HyS/example/pull/1", status: "open" },
    preview: { status: "ready", url: "https://preview.example.com" },
    residualRisks: ["human review pending"],
    rollback: { kind: "revert-product-commit", command: `git revert ${"2".repeat(40)}` },
    localVisualRecap: { status: "written", privatePath: `.development-system/private/AOH-147/${name}.md` },
    attestation: { path: `evidence/pilots/${name}.json`, sha256: "5".repeat(64) },
    decision: "ready-for-human",
  };
  if (name === "nutri-plan") {
    claims.operationalSkillEvidence = {
      path: "evidence/pilots/nutri-plan-skill-live-2026-07-20.json",
      sha256: "8".repeat(64),
    };
  }
  return claims;
}

function evidence() {
  return {
    schemaVersion: 1,
    contractVersion: "0.7.0",
    linearIssue: "AOH-147",
    generatedAt: "2026-07-20T00:00:00.000Z",
    candidate: {
      sourceCommit: "4".repeat(40),
      evidenceCommit: "9".repeat(40),
      pullRequest: "https://github.com/AO-HyS/development-system/pull/1",
      harnessEvidence: { path: "evidence/pilots-harnesses-live-2026-07-20.json", sha256: "6".repeat(64) },
      skillEvidence: { path: "evidence/pilots-skills-live-2026-07-20.json", sha256: "7".repeat(64) },
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

function verification(document) {
  const scenarios = {
    "nutri-plan": "nutriplan-read-only",
    "the-barber-central": "barber-read-only",
    "aohys.com": "aohys-nested-read-only",
  };
  return {
    candidateCommitExists: true,
    evidenceCommitExists: true,
    evidenceDescendsFromSource: true,
    harnessEvidence: {
      path: document.candidate.harnessEvidence.path,
      sha256: document.candidate.harnessEvidence.sha256,
      document: {
        ok: true,
        contractVersion: "0.7.0",
        sourceCommit: document.candidate.sourceCommit,
        results: document.pilots.flatMap((pilot) => ["codex", "t3code", "factory"].map((surface) => ({
          scenario: scenarios[pilot.name],
          surface,
          status: "passed",
        }))),
        failures: [],
      },
    },
    skillEvidence: {
      path: document.candidate.skillEvidence.path,
      sha256: document.candidate.skillEvidence.sha256,
      document: { probeSucceeded: true, sourceCommit: document.candidate.sourceCommit },
    },
    pilots: Object.fromEntries(document.pilots.map((pilot) => {
      const { attestation, ...pilotClaims } = pilot;
      return [pilot.name, {
        commitExists: true,
        recapExists: true,
        path: attestation.path,
        sha256: attestation.sha256,
        document: pilotClaims,
        operationalSkillEvidence: pilot.name === "nutri-plan" ? {
          path: pilot.operationalSkillEvidence.path,
          sha256: pilot.operationalSkillEvidence.sha256,
          document: {
            probeSucceeded: true,
            productCommit: pilot.productCommit,
            surfaces: Object.fromEntries(["codex", "t3code", "factory"].map((surface) => [surface, {
              catalogued: true,
              loaded: true,
              influenced: true,
              exitCode: 0,
            }])),
          },
        } : null,
      }];
    })),
  };
}

test("three comparable pilots and an untouched Escuela 360 reach the human gate", () => {
  const document = evidence();
  const result = validatePilotRolloutEvidence(document, verification(document));
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.decision, "ready-for-human");
});

test("candidate evidence must come from a verified descendant commit", () => {
  const document = evidence();
  const observed = verification(document);
  observed.evidenceDescendsFromSource = false;

  const result = validatePilotRolloutEvidence(document, observed);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("evidence commit is not descended")));
});

test("the candidate fails closed on missing preview, harness parity, or Escuela 360 contact", () => {
  const document = evidence();
  document.pilots[0].preview = { status: "pending", url: null };
  document.pilots[1].harnesses.factory = "structural-only";
  document.excludedRepositories[0].inspectedAsReference = true;

  const result = validatePilotRolloutEvidence(document, verification(document));
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

  const result = validatePilotRolloutEvidence(document, verification(document));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("merge")));
  assert.ok(result.errors.some((error) => error.includes("canonicalHomeSync")));
});

test("undisposed review risk or missing QA rationale blocks the human gate", () => {
  const document = evidence();
  document.pilots[0].review.high = 1;
  document.pilots[1].qaSelection.evidence = "";

  const result = validatePilotRolloutEvidence(document, verification(document));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("nutri-plan review")));
  assert.ok(result.errors.some((error) => error.includes("the-barber-central QA selection")));
});

test("self-declared statuses cannot reach readiness without bound runtime evidence", () => {
  const document = evidence();
  const result = validatePilotRolloutEvidence(document);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("candidate commit was not verified")));
  assert.ok(result.errors.some((error) => error.includes("harness evidence is not bound")));
  assert.ok(result.errors.some((error) => error.includes("nutri-plan attestation is not bound")));
});

test("a compact packet can source every pilot claim from its hash-bound attestation", () => {
  const document = evidence();
  const bound = verification(document);
  document.pilots = document.pilots.map(({ name, attestation }) => ({ name, attestation }));

  const result = validatePilotRolloutEvidence(document, bound);
  assert.equal(result.ok, true);
});

test("candidate and Nutri operational evidence must be bound to their source commits", () => {
  const document = evidence();
  const bound = verification(document);
  bound.harnessEvidence.document.sourceCommit = "9".repeat(40);
  bound.skillEvidence.document.sourceCommit = "9".repeat(40);
  bound.pilots["nutri-plan"].operationalSkillEvidence.document.productCommit = "9".repeat(40);

  const result = validatePilotRolloutEvidence(document, bound);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("harness evidence does not match")));
  assert.ok(result.errors.some((error) => error.includes("skill evidence does not match")));
  assert.ok(result.errors.some((error) => error.includes("not green for the product commit")));
});
