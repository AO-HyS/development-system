import assert from "node:assert/strict";
import test from "node:test";

import { auditConvexGuardian } from "../src/convex-guardian.mjs";

function brokenFixture() {
  return {
    repository: "AO/example",
    functions: [
      {
        id: "messages:list",
        path: "convex/messages.ts",
        line: 12,
        kind: "query",
        visibility: "public",
        auth: { status: "missing", evidence: "handler reads args.userId without checking viewer identity" },
        validators: { args: "incomplete", returns: "missing", evidence: "roomId is accepted as v.any and no returns validator exists" },
        reads: [{
          id: "messages",
          indexStatus: "filter-after-scan",
          bounded: false,
          collectsAll: true,
          expectsMany: true,
          paginated: false,
          evidence: "query filters roomId after collect()",
        }],
        limits: { status: "violated", evidence: "fixture scans 20,000 documents" },
      },
      {
        id: "sync:run",
        path: "convex/sync.ts",
        line: 40,
        kind: "action",
        visibility: "internal",
        validators: { args: "complete", returns: "complete" },
        action: { status: "failed", directDatabaseAccess: true, evidence: "action reaches the database adapter directly" },
        scheduling: { idempotent: false, bounded: false, evidence: "retry duplicates an unbounded import" },
        limits: { status: "verified" },
      },
    ],
    subscriptions: [{
      id: "all-messages",
      path: "src/useMessages.ts",
      scope: "broad",
      invalidationFanout: "unbounded",
      evidence: "one message write invalidates every room subscriber",
    }],
    writes: [{
      id: "global-counter",
      path: "convex/metrics.ts",
      contention: "hotspot",
      sharedDocument: true,
      evidence: "every request updates the same counter document",
    }],
    dataOperations: [{
      id: "copy-attachments",
      kind: "backfill",
      path: "convex/migrations.ts",
      plan: true,
      rollback: false,
      dryRun: false,
      separateAuthorization: false,
    }],
    componentCandidates: [{
      id: "custom-job-queue",
      path: "convex/queue.ts",
      customImplementation: true,
      fit: "confirmed",
      officialAlternative: "Workpool",
      evidence: "current primary documentation and local requirements confirm bounded parallel work fit",
    }],
    storage: [
      {
        id: "recipe-images",
        path: "convex/schema.ts",
        kind: "image",
        provider: "convex",
        cloudflareFit: "confirmed",
        proposedChange: true,
        plan: false,
        rollback: false,
        separateAuthorization: false,
        evidence: "public immutable image delivery is already served by the Cloudflare adapter",
      },
      {
        id: "recipe-image-links",
        kind: "relationship",
        provider: "convex",
      },
    ],
  };
}

test("known security, performance, cost, component, and storage problems produce prioritized actionable findings", () => {
  const report = auditConvexGuardian(brokenFixture());

  assert.equal(report.valid, true);
  assert.equal(report.status, "failed");
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.externalWriteIntents, []);
  assert.deepEqual(report.externalSideEffects, []);
  assert.deepEqual(report.authorization, {
    migrationGranted: false,
    backfillGranted: false,
    storageChangeGranted: false,
  });

  const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));
  for (const ruleId of [
    "convex.auth.required",
    "convex.validators.args",
    "convex.validators.returns",
    "convex.reads.index",
    "convex.reads.pagination",
    "convex.reads.bounded",
    "convex.subscriptions.scope",
    "convex.writes.contention",
    "convex.actions.boundary",
    "convex.scheduling.safe",
    "convex.function.limits",
    "convex.data-operation.authorization",
    "convex.components.prefer-official",
    "convex.storage.boundary",
    "convex.storage.authorization",
  ]) assert.ok(ruleIds.has(ruleId), ruleId);

  assert.ok(report.findings.every((finding) => finding.evidence.length > 0));
  assert.ok(report.focusedChecks.every((check) => check.proves.length > 0));
  assert.ok(report.findings[0].severity === "blocker");
  assert.ok(report.findings.findIndex((finding) => finding.severity === "high") < report.findings.findIndex((finding) => finding.severity === "medium"));
  assert.ok(report.findings.some((finding) => finding.ruleId === "convex.components.prefer-official" && finding.kind === "recommendation"));
  assert.ok(!report.findings.some((finding) => finding.subject === "recipe-image-links"));
});

test("the guardian is deterministic independent of supplied inventory order", () => {
  const firstInput = brokenFixture();
  const secondInput = structuredClone(firstInput);
  secondInput.functions.reverse();
  secondInput.storage.reverse();

  assert.deepEqual(auditConvexGuardian(firstInput), auditConvexGuardian(secondInput));
});

test("missing evidence remains unproven and never becomes a false green", () => {
  const report = auditConvexGuardian({
    repository: "AO/example",
    functions: [{
      id: "profiles:get",
      kind: "query",
      visibility: "public",
      validators: { args: "complete", returns: "complete" },
      reads: [{ id: "profile", usesIndex: true, bounded: true, paginated: true }],
    }],
    subscriptions: [],
    writes: [],
    dataOperations: [],
    componentCandidates: [],
    storage: [],
  });

  assert.equal(report.status, "unproven");
  assert.equal(report.findings.length, 0);
  assert.ok(report.unprovenEvidence.some((item) => item.category === "auth"));
  assert.ok(report.unprovenEvidence.some((item) => item.category === "limits"));
});

test("omitted repository inventories remain unproven instead of producing a false pass", () => {
  const report = auditConvexGuardian({
    repository: "AO/example",
    functions: [{
      id: "profiles:get",
      kind: "query",
      visibility: "internal",
      validators: { args: "complete", returns: "complete" },
      limits: { status: "verified" },
    }],
  });

  assert.equal(report.status, "unproven");
  for (const category of ["subscriptions", "writes", "dataOperations", "componentCandidates", "storage"]) {
    assert.ok(report.unprovenEvidence.some((item) => item.category === category), category);
  }
});

test("partial subscription, write, data-operation, and storage facts remain unproven", () => {
  const report = auditConvexGuardian({
    repository: "AO/example",
    functions: [],
    subscriptions: [{ id: "messages" }],
    writes: [{ id: "counter" }],
    dataOperations: [{ id: "unknown-operation" }],
    componentCandidates: [],
    storage: [{ id: "unknown-storage", kind: "opaque", provider: "unknown" }],
  });

  assert.equal(report.status, "unproven");
  for (const category of ["subscriptions", "contention", "migrations", "storage"]) {
    assert.ok(report.unprovenEvidence.some((item) => item.category === category), category);
  }
});

test("an intentionally public function needs a rationale and a boundary test before auth can pass", () => {
  const base = {
    repository: "AO/example",
    functions: [{
      id: "status:public",
      kind: "query",
      visibility: "public",
      auth: { status: "not-required" },
      validators: { args: "complete", returns: "complete" },
      limits: { status: "verified" },
    }],
    subscriptions: [],
    writes: [],
    dataOperations: [],
    componentCandidates: [],
    storage: [],
  };

  const unproven = auditConvexGuardian(base);
  assert.equal(unproven.status, "unproven");
  assert.ok(unproven.unprovenEvidence.some((item) => item.category === "auth"));

  const proven = {
    ...base,
    functions: [{
      ...base.functions[0],
      auth: {
        status: "not-required",
        rationale: "This exposes only a constant service-health state.",
        boundaryTest: true,
      },
    }],
  };
  assert.equal(auditConvexGuardian(proven).status, "passed");
});

test("non-destructive migrations require operational safeguards without inventing destructive authorization", () => {
  const report = auditConvexGuardian({
    repository: "AO/example",
    functions: [],
    subscriptions: [],
    writes: [],
    dataOperations: [{
      id: "add-optional-field",
      kind: "migration",
      destructive: false,
      plan: false,
      rollback: false,
      dryRun: false,
      separateAuthorization: false,
    }],
    componentCandidates: [],
    storage: [],
  });

  const finding = report.findings.find((item) => item.ruleId === "convex.data-operation.authorization");
  assert.ok(finding);
  assert.match(finding.detail, /plan, rollback, dry run/);
  assert.doesNotMatch(finding.detail, /separate authorization/);
});

test("safe supplied evidence passes without inventing component or storage migrations", () => {
  const input = {
    repository: "AO/example",
    functions: [{
      id: "profiles:get",
      kind: "query",
      visibility: "public",
      auth: { status: "verified" },
      validators: { args: "complete", returns: "complete" },
      reads: [{ id: "profile", indexStatus: "valid", bounded: true, paginated: true }],
      limits: { status: "verified" },
    }],
    subscriptions: [],
    writes: [],
    dataOperations: [],
    componentCandidates: [{ id: "domain-module", customImplementation: true, fit: "rejected" }],
    storage: [
      { id: "profiles", kind: "domain-record", provider: "convex" },
      { id: "avatars", kind: "image", provider: "convex", cloudflareFit: "rejected" },
    ],
  };

  const report = auditConvexGuardian(input);
  assert.equal(report.status, "passed");
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.focusedChecks, []);
});

test("invalid input fails validation without side effects", () => {
  const report = auditConvexGuardian({ functions: "not-an-array" });
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /repository is required/);
  assert.match(report.errors.join("\n"), /functions must be an array/);
  assert.deepEqual(report.externalWriteIntents, []);
  assert.deepEqual(report.externalSideEffects, []);
});
