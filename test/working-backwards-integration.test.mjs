import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { runWorkingBackwardsScenario } from "../src/working-backwards.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(repositoryRoot, "bin", "development-system.mjs");

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
      featureId: "saved-search",
      userOutcome: "A person can return to a saved search.",
      acceptanceCriteria: ["The saved search can be reopened"],
    },
    repository: { identity: "acme/example", revision: "def456" },
    gateOperations: ["product-contract-approved", "technical-contract-approved", "implementation-map-approved"],
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
  assert.equal(result.humanLayer.observation.loaded, false);
  assert.equal(result.humanLayer.receipt.appVersion, "0.153.0");
  assert.equal(result.humanLayer.feedback.gateGranted, false);
  assert.equal(result.implementationAuthorized, false);
});

test("explicit JSON CLI operations prepare intent, private handoff, freshness, and adapter observations", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-cli-ops-"));
  const repository = { identity: "acme/example", baseRevision: "abc123" };
  const approvedArtifacts = [
    { id: "WB:outline", role: "structure-outline", status: "approved", contentHash: "sha256:outline" },
    { id: "WB:tickets", role: "ticket-map", status: "approved", contentHash: "sha256:tickets" },
  ];
  const ticketMap = {
    status: "approved",
    tickets: [{ id: "slice-a", title: "First value", outcome: "The user sees value", acceptanceCriteria: ["Value is visible"], dependsOn: [] }],
  };
  const intent = await runJsonCli(home, "working-backwards-publication-intent", { workflowId: "WB", repository, approvedArtifacts, ticketMap });
  assert.equal(intent.publicationAuthorized, false);

  const trackerState = { status: "published", issues: [{ sliceId: "slice-a", id: "LIN-1", status: "ready-for-agent" }] };
  const handoff = await runJsonCli(home, "working-backwards-t3-handoff", { intent, repository, approvedArtifacts, ticketMap, trackerState });
  assert.equal(handoff.visibility, "private");
  assert.equal(handoff.implementationAuthorized, false);

  const freshness = await runJsonCli(home, "working-backwards-handoff-freshness", { handoff, repository, approvedArtifacts, trackerState });
  assert.equal(freshness.fresh, true);
  assert.equal(freshness.implementationAuthorized, false);

  const humanLayer = await runJsonCli(home, "working-backwards-humanlayer", {
    observation: { existence: true, discovery: true, loading: false, influence: null, sideEffects: [] },
    receipt: { appVersion: "0.153.0", cliVersion: "0.31.0" },
    feedback: { comments: ["reviewed"], taskStatus: "done" },
  });
  assert.equal(humanLayer.observation.loaded, false);
  assert.equal(humanLayer.feedback.gateGranted, false);
  assert.equal(humanLayer.implementationAuthorized, false);
});
