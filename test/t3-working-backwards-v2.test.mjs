import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  inspectT3Workflow,
  recordT3Turn,
  WORKING_BACKWARDS_PHASES,
} from "../artifacts/1.5.0/skills/internal/working-backwards/scripts/t3-workflow.mjs";

async function writeArtifact(workspaceDir, index, role, title, body) {
  await writeFile(resolve(workspaceDir, `${String(index).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\ntitle: ${title}\nsummary: Evidencia asentada.\n---\n\n# ${title}\n\n${body}\n`, "utf8");
}

test("T3 Working Backwards v2 runs Product Grill, non-technical story, then Technical Grill", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-v2-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "feature-v2");
  await mkdir(workspaceDir, { recursive: true });

  const initial = await inspectT3Workflow({ home, workspaceDir });
  assert.equal(initial.currentPhase.role, "product-grill");
  assert.equal(initial.action, "create-artifact");
  assert.deepEqual(WORKING_BACKWARDS_PHASES.map((phase) => phase.role).slice(0, 4), ["product-grill", "customer-story", "technical-grill", "research-questions"]);

  await writeArtifact(workspaceDir, 1, "product-grill", "Product Grill", "Actor, problema, resultado y límites. No contiene arquitectura.");
  const storyStage = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue" });
  assert.equal(storyStage.approval.accepted, true);
  assert.equal(storyStage.currentPhase.role, "customer-story");

  await writeArtifact(workspaceDir, 2, "customer-story", "Future Customer Story", "La persona obtiene el resultado sin conocer la implementación.");
  const technicalStage = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue" });
  assert.equal(technicalStage.approval.accepted, true);
  assert.equal(technicalStage.currentPhase.role, "technical-grill");

  await writeArtifact(workspaceDir, 3, "technical-grill", "Technical Grill", "Entidades, estados, interfaces, seguridad, pruebas y rollout quedan asentados según la historia.");
  const researchStage = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue" });
  assert.equal(researchStage.approval.accepted, true);
  assert.equal(researchStage.currentPhase.role, "research-questions");
  assert.equal(researchStage.implementationAuthorized, false);
  assert.deepEqual(researchStage.externalSideEffects, []);
});
