import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { probeHumanLayerLocalRuntime, probeHumanLayerReadOnly } from "../src/humanlayer-adapter.mjs";
import { evaluateWorkingBackwards } from "../src/working-backwards-evaluation.mjs";
import {
  createT3ImplementationHandoff,
  prepareTicketPublication,
  publishApprovedTickets,
  validateVerticalTicketSlices,
  verifyT3HandoffFreshness,
} from "../src/working-backwards-handoff.mjs";
import { runWorkingBackwardsScenario } from "../src/working-backwards.mjs";
import { createWorkingBackwardsGateReceipt } from "../src/working-backwards-gates.mjs";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)]));
}

function hash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")}`;
}

const completeFeature = {
  featureId: "saved-search",
  title: "Saved searches",
  actor: "account owner",
  problem: "Repeated searches must be rebuilt manually.",
  userOutcome: "An account owner can reopen a saved search.",
  experience: "The owner names a search and later reopens the same filters.",
  scope: "Save and reopen search filters in one account.",
  firstValueJourney: ["Run a search", "Save it", "Reopen it"],
  externalFaq: [{ question: "What is saved?", answer: "The active filters and name." }],
  internalFaq: [{ question: "How is success checked?", answer: "A reopened search restores the filters." }],
  acceptanceCriteria: ["Reopening restores the saved filters"],
  evidenceGaps: [],
  unsupportedClaims: [],
  notBuilding: ["Sharing searches between accounts"],
  productFactsResolved: true,
  technicalFactsResolved: true,
};

const gateOperations = [
  "approve-product-contract",
  "approve-technical-contract",
  "approve-implementation-map",
];

test("gate receipts bind exact artifacts and stale or missing artifact state cannot inherit approval", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-receipts-"));
  const first = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-receipts",
    feature: completeFeature,
    repository: { identity: "acme/example", revision: "abc123", observed: "Search filters are currently ephemeral." },
    gateOperations,
  });
  assert.deepEqual(Object.values(first.gates).map((gate) => gate.status), ["approved", "approved", "approved"]);
  assert.deepEqual(first.gateReceipts.map((receipt) => receipt.gate), ["product", "technical", "implementationMap"]);
  assert.ok(first.gateReceipts.every((receipt) => receipt.artifacts.every((artifact) => artifact.contentHash.startsWith("sha256:"))));
  const receiptPath = resolve(home, ".development-system", "private", "working-backwards", "WB-receipts", "gate-receipts.json");
  const persisted = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(persisted.workflowId, "WB-receipts");

  const missingState = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-receipts",
    feature: completeFeature,
    repository: { identity: "acme/example", revision: "abc123", observed: "Search filters are currently ephemeral." },
  });
  assert.ok(Object.values(missingState.gates).every((gate) => gate.status === "pending"));
  assert.equal(missingState.publicationIntent.ok, false);

  const changedRevision = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-receipts",
    feature: completeFeature,
    repository: { identity: "acme/example", revision: "different", observed: "Search filters are currently ephemeral." },
    artifactState: { artifacts: first.artifacts },
  });
  assert.ok(Object.values(changedRevision.gates).every((gate) => gate.status === "pending"));
  assert.equal(changedRevision.receiptValidation.invalidFrom, "product");

  const changedRepository = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-receipts",
    feature: completeFeature,
    repository: { identity: "other/example", revision: "abc123", observed: "Search filters are currently ephemeral." },
    artifactState: { artifacts: first.artifacts },
  });
  assert.equal(changedRepository.receiptValidation.invalidFrom, "product");
  assert.match(changedRepository.receiptValidation.reason, /identity/i);

  const changedFeature = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-receipts",
    feature: { ...completeFeature, problem: "A newly observed customer problem changes the brief." },
    repository: { identity: "acme/example", revision: "abc123", observed: "Search filters are currently ephemeral." },
    artifactState: { artifacts: first.artifacts },
  });
  assert.equal(changedFeature.gates.product.status, "pending");
  assert.equal(changedFeature.receiptValidation.invalidFrom, "product");
  assert.equal(changedFeature.resumeFrom, "requirements");

  persisted.receipts[0].artifacts[0].contentHash = "sha256:tampered";
  await writeFile(receiptPath, `${JSON.stringify(persisted)}\n`, "utf8");
  await assert.rejects(runWorkingBackwardsScenario({
    home,
    workflowId: "WB-receipts",
    feature: completeFeature,
    repository: { identity: "acme/example", revision: "abc123", observed: "Search filters are currently ephemeral." },
    artifactState: { artifacts: first.artifacts },
  }), /receipt integrity/i);
});

test("negated, denied, revoked, and ambiguous gate strings never approve any gate", async () => {
  for (const { operation, priorOperations, approved } of [
    { operation: "do not approve product contract", priorOperations: [], approved: [] },
    { operation: "deny technical contract approved", priorOperations: ["approve-product-contract"], approved: ["product"] },
    { operation: "revoke implementation map approval", priorOperations: ["approve-product-contract", "approve-technical-contract"], approved: ["product", "technical"] },
    { operation: "approve product and technical", priorOperations: [], approved: [] },
  ]) {
    const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-negated-"));
    const result = await runWorkingBackwardsScenario({
      home,
      workflowId: "WB-negated",
      feature: completeFeature,
      repository: { identity: "acme/example", revision: "abc123", observed: "Observed." },
      gateOperations: [...priorOperations, operation],
    });
    assert.deepEqual(Object.entries(result.gates).filter(([, gate]) => gate.status === "approved").map(([gate]) => gate), approved, operation);
    assert.ok(result.receipts.some((receipt) => receipt.accepted === false), operation);
    if (priorOperations.length === 0) await assert.rejects(access(resolve(home, ".development-system", "private", "working-backwards", "WB-negated", "gate-receipts.json")));
  }
});

test("unsupported customer claims and scope contradictions block the product gate", async () => {
  const result = await runWorkingBackwardsScenario({
    home: await mkdtemp(resolve(tmpdir(), "aohys-wb-claims-")),
    workflowId: "WB-claims",
    feature: {
      ...completeFeature,
      experience: "Our user quote proves 99% success by Friday for every external provider.",
      notBuilding: [completeFeature.scope],
    },
    repository: { identity: "acme/example", revision: "abc123", observed: "Observed." },
    gateOperations: ["approve-product-contract"],
  });
  assert.equal(result.gates.product.status, "blocked");
  assert.match(result.definitionValidation.errors.join(" "), /unsupported|contradict/i);
  const brief = result.artifacts.find((artifact) => artifact.role === "working-backwards-brief");
  assert.deepEqual(brief.content.firstValueJourney, completeFeature.firstValueJourney);
  assert.ok(Array.isArray(brief.content.externalFaq));
  assert.ok(Array.isArray(brief.content.internalFaq));
});

test("claim evidence must be integrity-bound and mapped to the exact suspicious claim", async () => {
  const claim = "Our user quote proves 99% success by Friday for every external provider.";
  const base = { ...completeFeature, experience: claim };
  for (const claimEvidence of [
    [{}],
    [{ id: "e-1", source: "research.md", content: { finding: "unrelated" }, contentHash: hash({ finding: "unrelated" }), claim: "A different claim" }],
  ]) {
    const result = await runWorkingBackwardsScenario({
      home: await mkdtemp(resolve(tmpdir(), "aohys-wb-claim-map-")),
      workflowId: "WB-claim-map",
      feature: { ...base, claimEvidence },
      repository: { identity: "acme/example", revision: "abc123", observed: "Observed." },
      gateOperations: ["approve-product-contract"],
    });
    assert.equal(result.gates.product.status, "blocked");
  }
  const content = { finding: "The exact claim is supported by the cited primary record." };
  const supported = await runWorkingBackwardsScenario({
    home: await mkdtemp(resolve(tmpdir(), "aohys-wb-claim-map-")),
    workflowId: "WB-claim-map",
    feature: { ...base, claimEvidence: [{ id: "e-2", source: "primary-record.json", content, contentHash: hash(content), claim }] },
    repository: { identity: "acme/example", revision: "abc123", observed: "Observed." },
    gateOperations: ["approve-product-contract"],
  });
  assert.equal(supported.gates.product.status, "approved");
});

test("Quick still holds exactly three receipt-bound gates and incomplete FAQ evidence fails closed", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-quick-gates-"));
  const quick = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-quick-gates",
    profile: "Quick",
    feature: { ...completeFeature, behaviorSettled: true, scopeNarrow: true, rollbackEasy: true, singleSurface: true },
    repository: { identity: "acme/example", revision: "abc123", observed: "Observed." },
    gateOperations,
  });
  assert.deepEqual(quick.gateReceipts.map((receipt) => receipt.gate), ["product", "technical", "implementationMap"]);
  const incomplete = await runWorkingBackwardsScenario({
    home: await mkdtemp(resolve(tmpdir(), "aohys-wb-incomplete-faq-")),
    workflowId: "WB-incomplete-faq",
    feature: { ...completeFeature, externalFaq: [{}] },
    repository: { identity: "acme/example", revision: "abc123", observed: "Observed." },
    gateOperations: ["approve-product-contract"],
  });
  assert.equal(incomplete.gates.product.status, "blocked");
  assert.match(incomplete.definitionValidation.errors.join(" "), /incomplete external FAQ/i);
});

test("ticket slices require affirmative context fit and demonstrability or verifiability", () => {
  const missing = validateVerticalTicketSlices({ tickets: [{ id: "a", outcome: "value", acceptanceCriteria: ["visible"], dependsOn: [] }] });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(" "), /fresh implementation context/i);
  assert.match(missing.errors.join(" "), /demonstrable or verifiable/i);
});

test("publication consumes an intent-bound authority and safely resumes a partial failure", async () => {
  const ticketMap = { status: "approved", tickets: [
    { id: "a", outcome: "first", acceptanceCriteria: ["first"], dependsOn: [], fitsFreshContext: true, verifiable: true },
    { id: "b", outcome: "second", acceptanceCriteria: ["second"], dependsOn: ["a"], fitsFreshContext: true, demonstrable: true },
  ] };
  const artifacts = [
    ["product-contract", { outcome: "approved" }],
    ["domain-technical-design", { design: "approved" }],
    ["ticket-map", ticketMap],
  ].map(([role, content]) => ({ id: `WB:${role}`, role, status: "approved", content, contentHash: hash(content), sourceIdentity: "acme/example", sourceRevision: "abc123", lineage: { dependsOn: [], governedBy: [], sourceIdentity: "acme/example", sourceRevision: "abc123" } }));
  const gateReceipts = ["product", "technical", "implementationMap"].map((gate) => createWorkingBackwardsGateReceipt({ workflowId: "WB", gate, repositoryIdentity: "acme/example", repositoryRevision: "abc123", artifacts, approvedAt: "2026-08-08T00:00:00.000Z" }));
  const intent = prepareTicketPublication({ workflowId: "WB", repository: { identity: "acme/example", baseRevision: "abc123" }, approvedArtifacts: artifacts, ticketMap, gateReceipts });
  assert.equal(intent.ok, true);
  const wrongRepositoryIntent = prepareTicketPublication({ workflowId: "WB", repository: { identity: "other/example", baseRevision: "abc123" }, approvedArtifacts: artifacts, ticketMap, gateReceipts });
  assert.equal(wrongRepositoryIntent.ok, false);
  assert.match(wrongRepositoryIntent.errors.join(" "), /repository|artifact set/i);
  const calls = [];
  let failure;
  try {
    await publishApprovedTickets({
      intent,
      publicationApproval: { intentId: intent.intentId, authorized: true },
      authority: { consumeIntent: async ({ intentId }) => ({ consumed: true, intentId, resumeToken: "opaque-run-1" }) },
      tracker: { createIssue: async (issue) => {
        calls.push(issue);
        if (issue.sliceId === "b") throw new Error("tracker unavailable");
        return { id: "LIN-1" };
      } },
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure.code, "WORKING_BACKWARDS_PARTIAL_PUBLICATION");
  assert.deepEqual(failure.receipt.created, [{ sliceId: "a", id: "LIN-1", status: "created", idempotencyKey: calls[0].idempotencyKey }]);
  assert.equal(failure.receipt.safeToResume, true);

  const resumedCalls = [];
  const resumed = await publishApprovedTickets({
    intent,
    publicationApproval: { intentId: intent.intentId, authorized: true },
    authority: { validateResume: async ({ intentId, authorityReceipt }) => intentId === intent.intentId && authorityReceipt === "opaque-run-1" },
    resumeReceipt: failure.receipt,
    tracker: { findByIdempotencyKey: async () => null, createIssue: async (issue) => { resumedCalls.push(issue); return { id: "LIN-2" }; } },
  });
  assert.deepEqual(resumedCalls.map((call) => call.sliceId), ["b"]);
  assert.deepEqual(resumed.created.map((entry) => entry.id), ["LIN-1", "LIN-2"]);

  let malformedFailure;
  try {
    await publishApprovedTickets({
      intent,
      publicationApproval: { intentId: intent.intentId, authorized: true },
      authority: { consumeIntent: async () => ({ consumed: true, intentId: intent.intentId, resumeToken: "opaque-run-2" }) },
      tracker: { createIssue: async (issue) => issue.sliceId === "a" ? { id: "LIN-1" } : {} },
    });
  } catch (error) {
    malformedFailure = error;
  }
  assert.equal(malformedFailure.code, "WORKING_BACKWARDS_PARTIAL_PUBLICATION");
  assert.equal(malformedFailure.receipt.created[0].id, "LIN-1");
  assert.equal(malformedFailure.receipt.safeToResume, true);
  const forged = { ...failure.receipt, created: [] };
  const { receiptHash: ignored, ...forgedBody } = forged;
  forged.receiptHash = hash(forgedBody);
  await assert.rejects(publishApprovedTickets({
    intent,
    publicationApproval: { intentId: intent.intentId, authorized: true },
    authority: { validateResume: async () => false },
    resumeReceipt: forged,
    tracker: { findByIdempotencyKey: async () => null, createIssue: async () => ({ id: "duplicate" }) },
  }), /authority validation failed/i);

  const trackerRecords = new Map();
  let createA = 0;
  let lostFailure;
  try {
    await publishApprovedTickets({
      intent,
      publicationApproval: { intentId: intent.intentId, authorized: true },
      authority: { consumeIntent: async () => ({ consumed: true, intentId: intent.intentId, resumeToken: "opaque-lost" }) },
      tracker: { createIssue: async (issue) => {
        if (issue.sliceId === "a") {
          createA += 1;
          trackerRecords.set(issue.idempotencyKey, { id: "LIN-LOST" });
          throw new Error("response lost after commit");
        }
        return { id: "LIN-B" };
      } },
    });
  } catch (error) { lostFailure = error; }
  const recovered = await publishApprovedTickets({
    intent,
    publicationApproval: { intentId: intent.intentId, authorized: true },
    authority: { validateResume: async ({ authorityReceipt }) => authorityReceipt === "opaque-lost" },
    resumeReceipt: lostFailure.receipt,
    tracker: {
      findByIdempotencyKey: async ({ idempotencyKey }) => trackerRecords.get(idempotencyKey) ?? null,
      createIssue: async (issue) => ({ id: issue.sliceId === "b" ? "LIN-B" : "duplicate" }),
    },
  });
  assert.equal(createA, 1);
  assert.equal(recovered.reconciled[0].id, "LIN-LOST");
});

test("T3 handoff rejects fabricated gates and binds complete receipts during freshness", () => {
  const ticketMap = { status: "approved", tickets: [{ id: "a", outcome: "value", acceptanceCriteria: ["visible"], dependsOn: [], fitsFreshContext: true, verifiable: true }] };
  const artifacts = [
    ["product-contract", { outcome: "approved" }],
    ["domain-technical-design", { design: "approved" }],
    ["ticket-map", ticketMap],
  ].map(([role, content]) => ({ id: `WB:${role}`, role, status: "approved", content, contentHash: hash(content), sourceIdentity: "acme/example", sourceRevision: "abc123", lineage: { dependsOn: [], governedBy: [], sourceIdentity: "acme/example", sourceRevision: "abc123" } }));
  assert.throws(() => createT3ImplementationHandoff({ ticketMap, approvedArtifacts: artifacts, repository: { identity: "acme/example", baseRevision: "abc123" }, trackerState: { status: "published", issues: [] } }), /gate receipts/i);
  const gateReceipts = ["product", "technical", "implementationMap"].map((gate) => createWorkingBackwardsGateReceipt({ workflowId: "WB", gate, repositoryIdentity: "acme/example", repositoryRevision: "abc123", artifacts, approvedAt: "2026-08-08T00:00:00.000Z" }));
  const handoff = createT3ImplementationHandoff({ workflowId: "WB", ticketMap, approvedArtifacts: artifacts, gateReceipts, repository: { identity: "acme/example", baseRevision: "abc123" }, trackerState: { status: "published", issues: [] } });
  assert.equal(handoff.gateReceipts.length, 3);
  const stale = verifyT3HandoffFreshness({ handoff, approvedArtifacts: artifacts, gateReceipts: gateReceipts.slice(0, 2), repository: handoff.repository, trackerState: { status: "published", issues: [] } });
  assert.equal(stale.fresh, false);
  assert.match(stale.drift.join(" "), /gate receipt/i);
});

test("HumanLayer caller snapshots are unverified while local adapters produce provenance-bound evidence", async () => {
  const snapshot = await probeHumanLayerReadOnly({ skill: "working-backwards", observation: { existence: true, discovery: true, loading: true, influence: true } });
  assert.equal(snapshot.provenance.kind, "unverified-input");
  assert.deepEqual(snapshot.evidence, { existence: null, discovery: null, loading: null, influence: null });

  const runtime = await probeHumanLayerLocalRuntime({
    skill: "working-backwards",
    now: () => "2026-08-08T00:00:00.000Z",
    exec: async ({ args }) => ({ exitCode: 0, stdout: args[0] === "--version" ? "humanlayer 0.31.0" : "", executablePath: "/usr/local/bin/humanlayer" }),
    readMetadata: async () => ({ source: "/private/local-humanlayer-state.json", loadedSkills: ["working-backwards"], catalogSkills: ["working-backwards"], finalOutput: "CUSTOMER_FIRST_ARTIFACT_GRAPH", task: { id: "task-1" }, session: { id: "session-1" }, comments: [], artifacts: [{ id: "brief", content: "portable" }] }),
    signature: { id: "working-backwards-v1", terms: ["CUSTOMER_FIRST", "ARTIFACT_GRAPH"] },
  });
  assert.equal(runtime.evidence.existence, true);
  assert.equal(runtime.evidence.discovery, true);
  assert.equal(runtime.evidence.loading, true);
  assert.equal(runtime.evidence.influence, true);
  assert.equal(runtime.provenance.command, "humanlayer --version");
  assert.equal(runtime.artifacts[0].contentHash, hash("portable"));
});

test("evaluator fails closed on empty evidence and requires complete two-case replay", () => {
  const empty = evaluateWorkingBackwards({});
  assert.equal(empty.ok, false);
  assert.equal(empty.recommendation, "not-ready");
  assert.equal(empty.ticket07.status, "blocked");
  assert.ok(empty.errors.length > 0);
});
