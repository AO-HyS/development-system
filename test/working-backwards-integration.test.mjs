import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { runWorkingBackwardsScenario } from "../src/working-backwards.mjs";
import { createWorkingBackwardsGateReceipt } from "../src/working-backwards-gates.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(repositoryRoot, "bin", "development-system.mjs");

function hash(value) {
  const stable = (entry) => Array.isArray(entry) ? entry.map(stable) : entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stable(nested)])) : entry;
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")}`;
}

const completeDefinition = {
  actor: "account owner",
  problem: "Repeated searches must be rebuilt.",
  scope: "One account search surface.",
  experience: "The owner saves and reopens the same filters.",
  firstValueJourney: ["Search", "Save", "Reopen"],
  externalFaq: [{ question: "What is saved?", answer: "The filters." }],
  internalFaq: [{ question: "How is success checked?", answer: "Filters are restored." }],
  evidenceGaps: [],
  unsupportedClaims: [],
  notBuilding: ["Cross-account sharing"],
  productFactsResolved: true,
  technicalFactsResolved: true,
};

/** @param {string} home @param {string} command @param {unknown} input */
async function runJsonCli(home, command, input) {
  const inputPath = resolve(home, `${command}.json`);
  await writeFile(inputPath, `${JSON.stringify(input)}\n`, "utf8");
  const result = spawnSync(process.execPath, [cliPath, command, "--input", inputPath, "--home", home, "--json"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("risk evidence is part of the graph and blocks the technical gate", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-integrated-"));
  const result = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-risk",
    feature: {
      featureId: "permissions",
      userOutcome: "An owner can control who sees a private record.",
      authorization: true,
    },
    repository: { identity: "acme/example", revision: "abc123" },
    gateOperations: ["product-contract-approved", "technical-contract-approved"],
  });

  assert.equal(result.profile.selected, "Complex");
  assert.equal(result.risk.technicalGate.status, "blocked");
  const riskArtifact = result.artifacts.find((artifact) => artifact.role === "risk-evidence");
  assert.ok(riskArtifact);
  assert.equal(riskArtifact.status, "blocked");
  assert.equal(result.gates.technical.status, "blocked");
  assert.equal(result.handoffEligible, false);
  assert.equal(result.implementationAuthorized, false);
});

test("approved map yields a deterministic publication intent and HumanLayer evidence grants no gate", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-intent-"));
  const result = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-intent",
    feature: {
      ...completeDefinition,
      featureId: "saved-search",
      userOutcome: "A person can return to a saved search.",
      acceptanceCriteria: ["The saved search can be reopened"],
    },
    repository: { identity: "acme/example", revision: "def456", observed: "Filters are not persisted." },
    gateOperations: ["approve-product-contract", "approve-technical-contract", "approve-implementation-map"],
    humanLayer: {
      config: { worktreeTiming: "Never" },
      observation: { existence: true, discovery: true, loading: false, influence: null, sideEffects: [] },
      receipt: { appVersion: "0.153.0", cliVersion: "0.31.0", taskId: "task-1" },
      comments: ["Looks good"],
    },
  });

  assert.equal(result.publicationIntent.ok, true);
  assert.equal(result.publicationIntent.publicationAuthorized, false);
  assert.equal(result.publicationIntent.implementationAuthorized, false);
  assert.equal(result.humanLayer.config.worktreeTiming, "Never");
  assert.equal(result.humanLayer.observation.loaded, null);
  assert.equal(result.humanLayer.receipt.appVersion, "0.153.0");
  assert.equal(result.humanLayer.feedback.gateGranted, false);
  assert.equal(result.implementationAuthorized, false);
});

test("explicit JSON CLI operations prepare intent, private handoff, freshness, and adapter observations", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-cli-ops-"));
  const repository = { identity: "acme/example", baseRevision: "abc123" };
  const ticketMap = {
    status: "approved",
    tickets: [{ id: "slice-a", title: "First value", outcome: "The user sees value", acceptanceCriteria: ["Value is visible"], dependsOn: [], fitsFreshContext: true, verifiable: true }],
  };
  const approvedArtifacts = [
    ["product-contract", { outcome: "approved" }],
    ["domain-technical-design", { design: "approved" }],
    ["ticket-map", ticketMap],
  ].map(([role, content]) => ({ id: `WB:${role}`, role, status: "approved", content, contentHash: hash(content), sourceIdentity: "acme/example", sourceRevision: "abc123", lineage: { dependsOn: [], governedBy: [], sourceIdentity: "acme/example", sourceRevision: "abc123" } }));
  const gateReceipts = ["product", "technical", "implementationMap"].map((gate) => createWorkingBackwardsGateReceipt({ workflowId: "WB", gate, repositoryIdentity: "acme/example", repositoryRevision: "abc123", artifacts: approvedArtifacts, approvedAt: "2026-08-08T00:00:00.000Z" }));
  const intent = await runJsonCli(home, "working-backwards-publication-intent", { workflowId: "WB", repository, approvedArtifacts, ticketMap, gateReceipts });
  assert.equal(intent.publicationAuthorized, false);

  const trackerState = { status: "published", issues: [{ sliceId: "slice-a", id: "LIN-1", status: "ready-for-agent" }] };
  const handoff = await runJsonCli(home, "working-backwards-t3-handoff", { intent, repository, approvedArtifacts, ticketMap, trackerState, gateReceipts });
  assert.equal(handoff.visibility, "private");
  assert.equal(handoff.implementationAuthorized, false);

  const freshness = await runJsonCli(home, "working-backwards-handoff-freshness", { handoff, repository, approvedArtifacts, trackerState, gateReceipts });
  assert.equal(freshness.fresh, true);
  assert.equal(freshness.implementationAuthorized, false);

  const humanLayer = await runJsonCli(home, "working-backwards-humanlayer", {
    observation: { existence: true, discovery: true, loading: false, influence: null, sideEffects: [] },
    receipt: { appVersion: "0.153.0", cliVersion: "0.31.0" },
    feedback: { comments: ["reviewed"], taskStatus: "done" },
  });
  assert.equal(humanLayer.observation.loaded, null);
  assert.equal(humanLayer.observation.provenance.kind, "unverified-input");
  assert.equal(humanLayer.feedback.gateGranted, false);
  assert.equal(humanLayer.implementationAuthorized, false);
});
