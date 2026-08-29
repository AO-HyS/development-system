import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { routeDefinition } from "../src/definition-router.mjs";

const quickEvidence = {
  behaviorSettled: true,
  scopeNarrow: true,
  rollbackEasy: true,
  singleSurface: true,
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repositoryRoot, "bin", "development-system.mjs");

test("ordinary feature language stays direct while explicit Working Backwards starts Product Grill", () => {
  const initial = routeDefinition({ request: "Quiero crear una nueva funcionalidad" });
  assert.equal(initial.currentStage, "implementation");
  assert.deepEqual(initial.requiredArtifacts, []);
  assert.deepEqual(initial.activeTopics, []);

  const explicit = routeDefinition({ request: "Quiero usar Working Backwards para esta funcionalidad" });
  assert.equal(explicit.currentStage, "product-grill");
  assert.equal(explicit.workingBackwardsRequested, true);
  assert.equal(initial.selectedProfile, "Standard");

  assert.deepEqual(explicit.activeTopics.map((topic) => topic.id), ["actor", "problem", "outcome", "experience", "boundaries"]);

  const story = routeDefinition({ productGrill: { status: "approved", actor: "admin", problem: "pierde contexto", outcome: "retoma el trabajo", experience: "continúa sin reconstruir nada", boundaries: ["sin implementación"] } });
  assert.equal(story.currentStage, "customer-story");
  assert.deepEqual(story.artifactCandidate, {
    role: "working-backwards-brief",
    status: "draft",
    actor: "admin",
    problem: "pierde contexto",
    desiredOutcome: "retoma el trabajo",
    futureExperience: "continúa sin reconstruir nada",
    boundaries: ["sin implementación"],
    technicalDecisions: [],
  });

  const technical = routeDefinition({ productGrill: "approved", customerStory: "approved", repository: { revision: "abc" }, riskTriggers: ["authorization"] });
  assert.equal(technical.currentStage, "technical-grill");
  assert.deepEqual(technical.activeTopics.map((topic) => topic.id), ["current-repository-behavior", "behavior", "entities-and-states", "interfaces-and-data", "testing-and-rollout", "risk:authorization"]);
  assert.equal(technical.activeTopics.every((topic) => topic.depth === "risk-specific"), true);

  const contracts = routeDefinition({ productGrill: "approved", customerStory: "approved", technicalGrill: "approved" });
  assert.equal(contracts.currentStage, "working-backwards-contracts");
  assert.deepEqual(contracts.requiredArtifacts.slice(0, 3), ["product-grill-evidence", "working-backwards-brief", "technical-grill-evidence"]);
  assert.equal(contracts.requiredArtifacts.includes("product-contract"), true);
  assert.equal(contracts.requiredArtifacts.includes("domain-technical-design"), true);
  assert.deepEqual(contracts.supportedHarnesses, ["codex", "t3-code"]);
  assert.equal(JSON.stringify(contracts).toLowerCase().includes("factory"), false);
  assert.equal(contracts.implementationAuthorized, false);
  assert.deepEqual(contracts.externalSideEffects, []);
});

test("Quick compacts the same decisions while Complex adds risk evidence", () => {
  const quick = routeDefinition({ profile: "Quick", quickEvidence, productGrill: true, customerStory: true, technicalGrill: true });
  assert.equal(quick.selectedProfile, "Quick");
  assert.deepEqual(quick.requiredArtifacts, ["product-grill-evidence", "working-backwards-brief", "technical-grill-evidence", "acceptance-contract", "structure-outline", "ticket-map", "t3-implementation-handoff"]);

  const complex = routeDefinition({ profile: "Quick", quickEvidence, riskTriggers: ["authorization"], productGrill: true, customerStory: true, technicalGrill: true });
  assert.equal(complex.selectedProfile, "Complex");
  assert.equal(complex.requiredArtifacts.includes("risk-evidence"), true);
});

test("natural-language simple implementation fails closed without complete Quick evidence", () => {
  const denied = routeDefinition({ request: "Solo implementa este cambio" });
  assert.equal(denied.simpleImplementation.requested, true);
  assert.equal(denied.simpleImplementation.eligible, false);
  assert.equal(denied.simpleImplementation.deniedReason, "quick-evidence-incomplete");
  assert.equal(denied.currentStage, "implementation");

  const allowed = routeDefinition({ request: "Solo implementa este cambio", quickEvidence });
  assert.equal(allowed.simpleImplementation.eligible, true);
  assert.equal(allowed.currentStage, "simple-implementation");
  assert.deepEqual(allowed.requiredArtifacts, []);

  const risky = routeDefinition({ request: "Solo implementa esta migración de autorización", quickEvidence });
  assert.equal(risky.simpleImplementation.eligible, false);
  assert.equal(risky.selectedProfile, "Complex");
  assert.equal(risky.simpleImplementation.deniedReason, "hard-risk-requires-complex");
});

test("approval mixed with requested changes stays on the active document", () => {
  const result = routeDefinition({ productGrill: { status: "approved", feedback: "cambia el actor", settledTopics: ["problem"] } });
  assert.equal(result.currentStage, "product-grill");
  assert.equal(result.activeTopics.some((topic) => topic.id === "problem"), false);

  const inferredRisk = routeDefinition({ request: "Just implement this authorization migration", quickEvidence, productGrill: true, customerStory: true });
  assert.deepEqual(inferredRisk.hardRiskTriggers, ["authorization", "migration"]);
  assert.deepEqual(inferredRisk.activeTopics.slice(-2).map((topic) => topic.id), ["risk:authorization", "risk:migration"]);
});

test("definition-route CLI returns the same observable router contract", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "definition-route-cli-"));
  const inputPath = resolve(directory, "input.json");
  await writeFile(inputPath, JSON.stringify({ request: "Just implement this change", quickEvidence }), "utf8");
  const result = spawnSync(process.execPath, [cliPath, "definition-route", "--input", inputPath, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.currentStage, "simple-implementation");
  assert.deepEqual(output.supportedHarnesses, ["codex", "t3-code"]);
  assert.equal(output.implementationAuthorized, false);
});
