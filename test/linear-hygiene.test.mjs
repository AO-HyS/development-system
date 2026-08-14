import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { LINEAR_PRODUCT_MAP, buildLinearHygienePlan } from "../src/linear-hygiene.mjs";

const now = "2026-08-14T18:00:00.000Z";

function issue(overrides = {}) {
  return {
    id: "issue-1",
    key: "AOH-101",
    workId: "work-1",
    title: "[AO HyS] Improve dashboard",
    team: "Aohys",
    project: "AOHYS Dashboard 100/100",
    product: "aohys",
    repository: "AO-HyS/aohys",
    status: "In Progress",
    updatedAt: "2026-08-14T17:00:00.000Z",
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    id: "git-work-1",
    workId: "work-1",
    repository: "AO-HyS/aohys",
    source: "repository",
    state: "active",
    observedAt: "2026-08-14T17:30:00.000Z",
    url: "https://example.test/evidence/work-1",
    ...overrides,
  };
}

test("the five-product mapping is explicit and makes shared AOH keys unambiguous", () => {
  assert.deepEqual(Object.keys(LINEAR_PRODUCT_MAP), ["aohys", "casa-roca", "the-barber-central", "nutriplan", "eteria"]);
  for (const product of Object.values(LINEAR_PRODUCT_MAP)) {
    assert.equal(product.team, "Aohys");
    assert.equal(product.linearKey, "AOH");
    assert.match(product.repository, /^[^/]+\/[^/]+$/);
    assert.match(product.project, /\S/);
    assert.match(product.titlePrefix, /^\[[^\]]+\]$/);
    assert.match(product.identifierPrefix, /^[A-Z]+$/);
  }
  assert.equal(LINEAR_PRODUCT_MAP["casa-roca"].titlePrefix, "[Casa Roca]");
  assert.equal(LINEAR_PRODUCT_MAP["casa-roca"].identifierPrefix, "CR");
});

test("audit classifies fake, duplicate, stale, externally completed, orphaned, and wrong-product issues", () => {
  const report = buildLinearHygienePlan({
    now,
    staleAfterDays: 30,
    evidenceComplete: true,
    issues: [
      issue({ id: "fake", key: "AOH-1", workId: "fake-work", authenticity: "fake" }),
      issue({ id: "canonical", key: "AOH-2", workId: "duplicate-work", canonical: true }),
      issue({ id: "duplicate", key: "AOH-3", workId: "duplicate-work", duplicateOf: "canonical" }),
      issue({ id: "stale", key: "AOH-4", workId: "stale-work", updatedAt: "2026-06-01T00:00:00.000Z" }),
      issue({ id: "completed", key: "AOH-5", workId: "done-work" }),
      issue({ id: "orphan", key: "AOH-6", workId: "orphan-work", project: null }),
      issue({ id: "wrong", key: "AOH-7", workId: "casa-work", repository: "corrortiz/casa-roca" }),
    ],
    evidence: [
      evidence({ id: "done-pr", workId: "done-work", source: "pull-request", state: "merged" }),
      evidence({ id: "done-deploy", workId: "done-work", source: "deploy", state: "deployed", providerEvidence: true }),
      evidence({ id: "done-runtime", workId: "done-work", source: "runtime", state: "healthy", providerEvidence: true }),
      evidence({ id: "casa-repo", workId: "casa-work", repository: "corrortiz/casa-roca" }),
    ],
  });

  assert.equal(report.valid, true);
  assert.deepEqual(Object.fromEntries(report.findings.map((finding) => [finding.issueId, finding.kinds])), {
    fake: ["fake"],
    duplicate: ["duplicate"],
    stale: ["stale"],
    completed: ["completed-outside-tracker"],
    orphan: ["orphan"],
    wrong: ["wrong-product", "ambiguous-name"],
  });
  assert.equal(report.reconciliation.productionClaims, 0);
  assert.equal(report.reconciliation.runtimeEvidenceUsed, true);
});

test("old open work is never proposed for deletion from an incomplete evidence snapshot", () => {
  const report = buildLinearHygienePlan({
    now,
    staleAfterDays: 30,
    issues: [issue({ id: "authentic-old", key: "AOH-88", workId: "authentic-old", updatedAt: "2026-01-01T00:00:00.000Z" })],
    evidence: [],
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.findings[0].kinds, ["staleness-unproven"]);
  assert.equal(report.cleanupPreview.some((change) => change.issueId === "authentic-old" && change.operation === "delete"), false);
  assert.equal(report.reconciliation.evidenceCollectionComplete, false);
});

test("cleanup preview emits deterministic create/update/move/close/delete diffs with reasons and rollback", () => {
  const report = buildLinearHygienePlan({
    now,
    evidenceComplete: true,
    issues: [
      issue({ id: "fake", key: "AOH-1", workId: "fake-work", authenticity: "fake", deletionExport: "export://fake" }),
      issue({ id: "duplicate-a", key: "AOH-2", workId: "dupe", canonical: true }),
      issue({ id: "duplicate-b", key: "AOH-3", workId: "dupe", duplicateOf: "duplicate-a", deletionExport: "export://duplicate-b" }),
      issue({ id: "rename", key: "AOH-4", workId: "rename", title: "Improve dashboard" }),
      issue({ id: "move", key: "AOH-5", workId: "casa", repository: "corrortiz/casa-roca", title: "Generic task" }),
      issue({ id: "done", key: "AOH-6", workId: "done" }),
    ],
    evidence: [
      evidence({ id: "untracked", workId: "new-work", repository: "AO-HyS/eteria", title: "Prepare inventory", trackable: true }),
      evidence({ id: "done-git", workId: "done", source: "repository", state: "merged" }),
      evidence({ id: "done-pr", workId: "done", source: "pull-request", state: "merged" }),
    ],
  });

  assert.deepEqual(new Set(report.cleanupPreview.map((change) => change.operation)), new Set(["create", "update", "move", "close", "delete"]));
  for (const change of report.cleanupPreview) {
    assert.match(change.reason, /\S/);
    assert.ok("before" in change.diff);
    assert.ok("after" in change.diff);
    assert.equal(typeof change.rollback.supported, "boolean");
  }
  const casaMove = report.cleanupPreview.find((change) => change.issueId === "move");
  assert.equal(casaMove.operation, "move");
  assert.equal(casaMove.diff.after.project, "Casa Roca");
  assert.equal(casaMove.diff.after.title, "[Casa Roca] Generic task");
  assert.equal(casaMove.diff.after.displayIdentifier, "CR/AOH-5");
  const fakeDelete = report.cleanupPreview.find((change) => change.issueId === "fake");
  assert.deepEqual(fakeDelete.rollback, { supported: true, operation: "restore-from-export", handle: "export://fake" });
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.externalWriteIntents, []);
  assert.deepEqual(report.externalSideEffects, []);
});

test("clean Check-in evidence includes only real human actions and never asserts production", () => {
  const report = buildLinearHygienePlan({
    now,
    issues: [
      issue({
        id: "human",
        workId: "human",
        humanAction: { title: "Approve copy", reason: "The wording needs product approval.", capability: "mobile", minutes: 4, priority: 80 },
      }),
      issue({ id: "quiet", key: "AOH-102", workId: "quiet" }),
      issue({ id: "fake", key: "AOH-103", workId: "fake", authenticity: "fake", humanAction: { title: "Ignore me", reason: "Not real.", capability: "mobile" } }),
    ],
    evidence: [evidence({ workId: "human" }), evidence({ id: "quiet-evidence", workId: "quiet" })],
  });

  assert.deepEqual(report.checkInEvidence.map((item) => item.id), ["linear-hygiene:human"]);
  assert.equal(report.checkInEvidence[0].source, "linear");
  assert.equal(report.checkInEvidence[0].claim, "workflow-state");
  assert.equal(report.checkInEvidence[0].requiresHuman, true);
  assert.equal(report.checkInEvidence[0].destination, undefined);
  assert.equal(report.checkInEvidence[0].providerEvidence, false);
  assert.deepEqual(report.cleanView.map((item) => item.issueId), ["human", "quiet"]);
});

test("invalid clocks and unknown repositories fail closed without inventing a product", () => {
  const report = buildLinearHygienePlan({
    now: "not-a-date",
    issues: [issue({ repository: "someone/unknown", product: null, project: null })],
    evidence: [],
  });
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /deterministic timestamp/);
  assert.match(report.errors.join("\n"), /cannot infer product/);
  assert.equal(report.cleanView.length, 0);
});

test("known fake clutter remains visible but is not deletable without complete evidence and an export", () => {
  const report = buildLinearHygienePlan({
    now,
    issues: [issue({ id: "legacy-fake", workId: null, repository: "retired/unknown", product: null, project: null, authenticity: "fake" })],
    evidence: [],
  });
  assert.equal(report.valid, false);
  assert.equal(report.cleanupPreview.some((change) => change.issueId === "legacy-fake" && change.operation === "delete"), false);
  assert.equal(report.cleanView.length, 0);
});

test("an incomplete duplicate snapshot cannot propose irreversible deletion", () => {
  const report = buildLinearHygienePlan({
    now,
    evidenceComplete: false,
    issues: [
      issue({ id: "canonical", key: "AOH-2", workId: "dupe", canonical: true }),
      issue({ id: "possible-duplicate", key: "AOH-3", workId: "dupe", duplicateOf: "canonical" }),
    ],
    evidence: [],
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.findings.find((finding) => finding.issueId === "possible-duplicate")?.kinds, ["duplicate-unproven"]);
  assert.equal(report.cleanupPreview.some((change) => change.operation === "delete"), false);
});

test("the 1.5.0 installable skill preserves preview-only cleanup and Check-in handoff", async () => {
  const skillRoot = resolve(import.meta.dirname, "../artifacts/1.5.0/skills/internal/linear-hygiene");
  const [skill, interfaceYaml] = await Promise.all([
    readFile(resolve(skillRoot, "SKILL.md"), "utf8"),
    readFile(resolve(skillRoot, "agents/openai.yaml"), "utf8"),
  ]);
  assert.match(skill, /AO HyS.*Casa Roca.*The Barber Central.*NutriPlan.*ETERIA/s);
  assert.match(skill, /create.*update.*move.*close.*delete/s);
  assert.match(skill, /read-only|readOnly: true/i);
  assert.match(skill, /Check-in/);
  assert.match(skill, /never calls production/i);
  assert.match(interfaceYaml, /display_name: "Linear Hygiene"/);
});
