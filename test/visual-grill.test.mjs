import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { routeDefinition } from "../src/definition-router.mjs";
import { validateSkillCatalog } from "../src/skills.mjs";
import { routeVisualGrill } from "../src/visual-grill.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("natural visual and mixed requests route without skill names", () => {
  const visual = routeDefinition({ request: "Quiero un Grill de cómo luce el sistema" });
  assert.equal(visual.currentStage, "visual-direction");
  assert.equal(visual.visualFlow.leadSkill, "design-direction");
  assert.equal(visual.visualFlow.questionSurface, "grill-with-docs");
  assert.equal(visual.visualFlow.decisionSurface, "impeccable-decision-page");
  assert.equal(visual.visualFlow.interviewPolicy.maximumConcurrentInterviews, 1);

  const proposalsFirst = routeDefinition({ request: "Muéstrame propuestas antes de hablar de lo funcional" });
  assert.equal(proposalsFirst.currentStage, "visual-direction");
  assert.deepEqual(proposalsFirst.visualFlow.requiredFlow.slice(3, 6), ["candidates", "concept-seed", "impeccable-decision-page"]);

  const mixed = routeDefinition({ request: "Quiero simplificar tanto el funcionamiento como la apariencia" });
  assert.equal(mixed.currentStage, "mixed-grill");
  assert.equal(mixed.visualFlow.interviewPolicy.maximumConcurrentInterviews, 1);
  assert.equal(mixed.visualFlow.leadSkill, "design-direction");
});

test("fixed palette remains identity while composition stays open and three means exactly three", () => {
  const result = routeVisualGrill({
    request: "Quiero tres propuestas visuales",
    nextProposalDecisionKeys: ["identity.palette", "composition.density", "interaction.panel-open"],
    brief: {
      confirmedConstraints: [{ key: "identity.palette", value: "Conservar paleta" }],
      verifiedProductFacts: [{ key: "task.primary", value: "Revisar expediente", evidence: "capture-1" }],
      agentProposals: [{ key: "composition.density", value: "Carril compacto", status: "provisional" }],
      identity: { palette: "existing", status: "confirmed" },
      composition: { status: "open" },
      interviewAnswers: [{ key: "identity.palette", value: "Conservar paleta", status: "answered" }],
    },
  });
  assert.equal(result.mode, "visual-grill");
  assert.equal(result.exactAlternativeCountRequired, true);
  assert.equal(result.requestedAlternatives, 3);
  assert.deepEqual(result.interviewPolicy.openDecisionKeys, ["composition.density", "interaction.panel-open"]);
  assert.equal(result.decisionLedger.confirmedConstraints.length, 1);
  assert.equal(result.decisionLedger.verifiedProductFacts.length, 1);
  assert.equal(result.decisionLedger.agentProposals.length, 1);
  assert.equal(result.decisionLedger.identity.status, "confirmed");
  assert.equal(result.decisionLedger.composition.status, "open");
});

test("recovered answers, rejection and approved direction continue without coercion or restart", () => {
  const recovered = routeVisualGrill({
    request: "Quiero un grill visual",
    nextProposalDecisionKeys: ["task.primary", "composition.density"],
    brief: {
      interviewAnswers: [
        { key: "task.primary", value: "Prioridad clínica", status: "answered" },
        { key: "composition.density", value: "Pendiente", status: "deferred" },
      ],
      selectionStatus: "all-rejected",
    },
  });
  assert.deepEqual(recovered.interviewPolicy.recoveredAnswerKeys, ["task.primary"]);
  assert.deepEqual(recovered.interviewPolicy.openDecisionKeys, ["composition.density"]);
  assert.deepEqual(recovered.rejection, { selectionRequired: false, nextAction: "revise-hypothesis-from-literal-correction" });

  const literalRejection = routeVisualGrill({
    request: "Ninguna funciona; quiero nuevas propuestas visuales",
    nextProposalDecisionKeys: ["literal-correction"],
    brief: { selectionStatus: "all-rejected" },
  });
  assert.equal(literalRejection.mode, "visual-grill");
  assert.deepEqual(literalRejection.interviewPolicy.openDecisionKeys, ["literal-correction"]);
  assert.deepEqual(literalRejection.rejection, { selectionRequired: false, nextAction: "revise-hypothesis-from-literal-correction" });

  const continuation = routeDefinition({
    request: "Continúa con la dirección visual aprobada",
    brief: { phase: "selected", selectedDirection: "quiet-clinical-focus" },
  });
  assert.equal(continuation.currentStage, "visual-direction-continuation");
  assert.equal(continuation.visualFlow.restartExploration, false);
  assert.deepEqual(continuation.visualFlow.requiredFlow.slice(0, 3), ["recover-selected-direction", "refine", "prototype-interaction"]);
});

test("functional grill is preserved and a small visual adjustment stays proportional", () => {
  const functional = routeVisualGrill({ request: "Quiero un grill funcional del flujo de citas" });
  assert.equal(functional.mode, "functional-grill");
  assert.equal(functional.leadSkill, "grill-with-docs");
  assert.deepEqual(functional.requiredFlow, ["functional-interview"]);

  const small = routeDefinition({ request: "Ajusta el espaciado de este componente" });
  assert.equal(small.currentStage, "visual-refinement");
  assert.equal(small.visualFlow.leadSkill, "impeccable");
  assert.deepEqual(small.visualFlow.requiredFlow, ["impeccable-refinement", "focused-check"]);

  const authToken = routeDefinition({ request: "Corrige el token de autenticación expirado" });
  assert.equal(authToken.currentStage, "implementation");

  const approvedImplementation = routeDefinition({ request: "Implementa la apariencia descrita en la especificación aprobada" });
  assert.equal(approvedImplementation.currentStage, "implementation");

  const functionalWithVisualHistory = routeVisualGrill({
    request: "Quiero un Grill funcional del producto",
    brief: { phase: "verified", selectedDirection: "clinical-brief" },
  });
  assert.equal(functionalWithVisualHistory.mode, "functional-grill");
  assert.deepEqual(functionalWithVisualHistory.requiredFlow, ["functional-interview"]);
});

test("exploration order and critique inputs are behaviorally validated", () => {
  const valid = routeVisualGrill({
    request: "Quiero tres propuestas visuales",
    brief: {
      explorationReceipt: {
        candidates: [
          { thesis: "Focus", visibleDifference: "single reading plane", opportunity: "calm urgency", risk: "lower scan breadth" },
          { thesis: "Sequence", visibleDifference: "longitudinal rail", opportunity: "visible causality", risk: "urgent facts can recede" },
          { thesis: "Docket", visibleDifference: "aligned safety sheet", opportunity: "professional rigor", risk: "patient identity can recede" },
        ],
        events: [
          { type: "candidates", at: "2026-09-15T10:00:00Z" },
          { type: "concept-seed", at: "2026-09-15T10:01:00Z" },
          { type: "impeccable-decision-page", at: "2026-09-15T10:02:00Z" },
        ],
      },
    },
  });
  assert.equal(valid.explorationReceipt.status, "valid");
  assert.deepEqual(valid.critiqueContract.outputs, ["constraint-conformity", "compositional-quality"]);
  assert.equal(valid.critiqueContract.scoreRole, "supporting-only");

  const invalid = routeVisualGrill({
    request: "Quiero propuestas visuales",
    brief: { explorationReceipt: { candidates: [{}], events: [{ type: "concept-seed" }, { type: "candidates" }, { type: "impeccable-decision-page" }] } },
  });
  assert.equal(invalid.explorationReceipt.status, "invalid");
  assert.deepEqual(invalid.explorationReceipt.issues.sort(), ["candidate-contract-incomplete", "invalid-candidate-seed-decision-page-order"]);

  const empty = routeVisualGrill({
    request: "Quiero tres propuestas visuales",
    brief: {
      explorationReceipt: {
        candidates: [],
        events: [
          { type: "candidates", at: "2026-09-15T10:02:00Z" },
          { type: "concept-seed", at: "2026-09-15T10:01:00Z" },
          { type: "impeccable-decision-page", at: "2026-09-15T10:03:00Z" },
        ],
      },
    },
  });
  assert.equal(empty.explorationReceipt.status, "invalid");
  assert.deepEqual(empty.explorationReceipt.issues.sort(), ["candidate-count-mismatch", "missing-candidates", "non-monotonic-event-time"]);
});

test("capability gaps limit evidence without blocking independent work and CLI matches", () => {
  const input = {
    request: "Quiero un grill visual",
    capabilities: { imageGeneration: false, vision: false },
  };
  const result = routeVisualGrill(input);
  assert.deepEqual(result.limitations, ["image-generation-unavailable", "visual-judgment-unavailable"]);
  assert.deepEqual(result.allowedEvidence, ["html-css-prototype"]);

  const directory = mkdtempSync(resolve(tmpdir(), "visual-grill-cli-"));
  const inputPath = resolve(directory, "input.json");
  writeFileSync(inputPath, JSON.stringify(input));
  const cli = spawnSync(process.execPath, [resolve(repositoryRoot, "bin/development-system.mjs"), "visual-grill-route", "--input", inputPath, "--json"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).limitations, result.limitations);
});

test("current release retains visual quality skills, updates governed intake, and pins its Astra XHigh visual reviewer with explicit hashes", async () => {
  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "manifests/1.29.1.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(resolve(repositoryRoot, "catalog/0.48.0.json"), "utf8"));
  assert.equal(packageJson.version, "1.29.1");
  assert.equal(packageJson.contractVersion, "1.29.1");
  assert.equal(manifest.contractVersion, "1.29.1");
  assert.equal(catalog.catalogVersion, "0.48.0");
  assert.deepEqual(await validateSkillCatalog(catalog, repositoryRoot), []);

  for (const name of ["drive-development-flow", "grill-with-docs", "design-direction", "design-quality"]) {
    const skill = catalog.skills.find((entry) => entry.logicalName === name);
    const version = ["drive-development-flow", "grill-with-docs"].includes(name) ? "1.29.0" : "1.22.1";
    assert.equal(skill.source.path, `artifacts/${version}/skills/internal/${name}`);
    assert.equal(skill.variants.every((variant) => variant.sourceDirectory === skill.source.path), true);
    assert.equal(skill.variants.every((variant) => /^[a-f0-9]{64}$/u.test(variant.folderSha256)), true);
  }

  const reviewer = manifest.artifacts.find((entry) => entry.logicalName === "codex-agent-visual-reviewer");
  assert.equal(reviewer.sourcePath, "artifacts/1.26.0/agents/codex/visual-reviewer.toml");
  const reviewerBytes = readFileSync(resolve(repositoryRoot, reviewer.sourcePath));
  assert.equal(createHash("sha256").update(reviewerBytes).digest("hex"), reviewer.sha256);
  assert.match(reviewerBytes.toString(), /^model = "gpt-6-astra"$/mu);
  assert.match(reviewerBytes.toString(), /^model_reasoning_effort = "xhigh"$/mu);
});
