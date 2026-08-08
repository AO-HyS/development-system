import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  runWorkingBackwardsScenario,
} from "../src/working-backwards.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(repositoryRoot, "bin", "development-system.mjs");

const quickFeature = {
  featureId: "focus-filter",
  title: "Filtrar tareas enfocadas",
  userOutcome: "Una persona puede encontrar sus tareas enfocadas sin revisar las demás.",
  scope: "Una sola vista de tareas.",
  behaviorSettled: true,
  scopeNarrow: true,
  rollbackEasy: true,
  singleSurface: true,
  acceptanceCriteria: ["Sólo muestra tareas enfocadas", "Permite volver a todas las tareas"],
};

const completeDefinition = {
  actor: "account owner",
  problem: "The repeated task must be rebuilt manually.",
  scope: "One account and one product surface.",
  experience: "The account owner completes the task and can return to it later.",
  firstValueJourney: ["Start", "Complete", "Return"],
  externalFaq: [{ question: "What changes?", answer: "The user-visible flow." }],
  internalFaq: [{ question: "How is success checked?", answer: "The acceptance criteria pass." }],
  acceptanceCriteria: ["The result is observable"],
  evidenceGaps: [],
  unsupportedClaims: [],
  notBuilding: ["Cross-account sharing"],
  productFactsResolved: true,
  technicalFactsResolved: true,
};

test("Quick produces a compact private handoff without mutating lifecycle or external systems", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-quick-"));
  const result = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-quick",
    feature: quickFeature,
    repository: { revision: "abc123" },
  });

  assert.equal(result.profile.recommended, "Quick");
  assert.equal(result.profile.selected, "Quick");
  assert.deepEqual(result.artifacts.map((artifact) => artifact.role), [
    "working-backwards-brief",
    "acceptance-contract",
    "structure-outline",
    "t3-implementation-handoff",
  ]);
  assert.equal(result.artifacts.at(-1).visibility, "private");
  assert.equal(result.artifacts.at(-1).status, "candidate");
  assert.equal(result.implementationAuthorized, false);
  assert.deepEqual(result.externalSideEffects, []);
  await assert.rejects(access(resolve(home, ".development-system", "lifecycles", "WB-quick.json")));
});

test("Standard is the default and preserves current-state research, lineage, hashes, visibility, and three gates", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-standard-"));
  const result = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-standard",
    feature: {
      ...completeDefinition,
      featureId: "saved-search",
      title: "Búsquedas guardadas",
      userOutcome: "Una persona puede volver a una búsqueda que usa con frecuencia.",
      scope: "Cuenta y pantalla de resultados.",
      acceptanceCriteria: ["Guarda una búsqueda", "Recupera una búsqueda guardada"],
    },
    repository: { identity: "acme/example", revision: "def456", observed: "La pantalla ya lista búsquedas, pero no las persiste." },
    gateOperations: ["approve-product-contract", "approve-technical-contract", "approve-implementation-map"],
  });

  assert.equal(result.profile.recommended, "Standard");
  assert.equal(result.profile.selected, "Standard");
  assert.deepEqual(result.artifacts.map((artifact) => artifact.role), [
    "working-backwards-brief",
    "research-questions",
    "research-report",
    "product-contract",
    "domain-technical-design",
    "structure-outline",
    "ticket-map",
    "t3-implementation-handoff",
  ]);
  const research = result.artifacts.find((artifact) => artifact.role === "research-report");
  const design = result.artifacts.find((artifact) => artifact.role === "domain-technical-design");
  assert.equal(research.content.mode, "current-state");
  assert.equal(design.content.mode, "future-state");
  assert.notEqual(research.content.mode, design.content.mode);
  assert.ok(result.artifacts.every((artifact) => artifact.contentHash.startsWith("sha256:")));
  assert.ok(result.artifacts.every((artifact) => Array.isArray(artifact.lineage.dependsOn)));
  assert.equal(result.gates.product.status, "approved");
  assert.equal(result.gates.technical.status, "approved");
  assert.equal(result.gates.implementationMap.status, "approved");
  assert.equal(result.handoffEligible, true);
  assert.equal(result.implementationAuthorized, false);
  assert.deepEqual(result.externalSideEffects, []);
  assert.deepEqual(result.receipts.map((receipt) => receipt.gate), ["product", "technical", "implementationMap"]);
});

test("HumanLayer feedback cannot grant a gate, while an approved upstream edit stales only its descendants", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-stale-"));
  const initial = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-stale",
    feature: {
      ...completeDefinition,
      featureId: "saved-search",
      title: "Búsquedas guardadas",
      userOutcome: "Una persona puede volver a una búsqueda frecuente.",
      scope: "Resultados.",
    },
    repository: { identity: "acme/example", revision: "ghi789", observed: "Searches are not persisted." },
  });
  const contract = initial.artifacts.find((artifact) => artifact.role === "product-contract");
  const outline = initial.artifacts.find((artifact) => artifact.role === "structure-outline");
  const unrelated = initial.artifacts.find((artifact) => artifact.role === "working-backwards-brief");
  const result = await runWorkingBackwardsScenario({
    home,
    workflowId: "WB-stale",
    feature: {
      ...completeDefinition,
      featureId: "saved-search",
      title: "Búsquedas guardadas",
      userOutcome: "Una persona puede volver a una búsqueda frecuente.",
      scope: "Resultados.",
    },
    repository: { identity: "acme/example", revision: "ghi789", observed: "Searches are not persisted." },
    artifactState: {
      artifacts: [
        { ...contract, status: "approved", content: { ...contract.content, changed: true } },
        { ...outline, status: "approved" },
        { ...unrelated, status: "approved" },
      ],
    },
    humanLayer: { comments: ["Approve Product Contract"], taskStatus: "done", autoAdvance: true },
  });

  assert.equal(result.gates.product.status, "pending");
  assert.deepEqual(result.staleArtifacts, [outline.id]);
  assert.equal(result.resumeFrom, "technical-contract");
  assert.equal(result.implementationAuthorized, false);
  assert.deepEqual(result.externalSideEffects, []);
  assert.deepEqual(result.receipts, [{ adapter: "humanlayer", accepted: false, reason: "feedback-only" }]);
});

test("CLI accepts explicit JSON input and emits the observable contract as JSON", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-working-backwards-cli-"));
  const inputPath = resolve(home, "input.json");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(inputPath, JSON.stringify({
    workflowId: "WB-cli",
    feature: quickFeature,
    repository: { revision: "cli123" },
  })));
  const result = spawnSync(process.execPath, [cliPath, "working-backwards", "--home", home, "--input", inputPath, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.operation, "working-backwards");
  assert.equal(output.implementationAuthorized, false);
  assert.deepEqual(output.externalSideEffects, []);
  assert.equal((await readFile(inputPath, "utf8")).includes("focus-filter"), true);
});
