import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  classifyApproval,
  inspectWorkflow,
  recordHumanLayerTurn,
  WORKING_BACKWARDS_PHASES,
} from "../artifacts/1.3.0/skills/internal/working-backwards/scripts/humanlayer-workflow.mjs";
import { readWorkingBackwardsGateReceipts } from "../src/working-backwards-gates.mjs";
import { readLifecycleState } from "../src/lifecycle.mjs";

const story = `---
working_backwards_role: customer-story
working_backwards_status: draft
---

# La experiencia futura

Una persona consigue el resultado sin conocer la implementación.
`;

test("the HumanLayer workflow starts with one customer-story artifact", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-humanlayer-home-"));
  const taskDir = resolve(home, "repo", ".humanlayer", "tasks", "my-feature");
  await mkdir(taskDir, { recursive: true });

  const status = await inspectWorkflow({ home, taskDir });

  assert.equal(status.workflow, "working-backwards");
  assert.equal(status.profile, "Standard");
  assert.equal(status.currentPhase.role, "customer-story");
  assert.equal(status.action, "create-artifact");
  assert.equal(status.artifacts.length, 0);
  assert.equal(status.implementationAuthorized, false);
  assert.deepEqual(status.externalSideEffects, []);
  assert.deepEqual(WORKING_BACKWARDS_PHASES.map((phase) => phase.role), [
    "customer-story",
    "research-questions",
    "research-report",
    "product-contract",
    "technical-contract",
    "implementation-map",
    "t3-handoff",
  ]);
});

test("a clear conversational approval advances one document and persists private evidence", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-humanlayer-home-"));
  const repo = resolve(home, "repo");
  const taskDir = resolve(repo, ".humanlayer", "tasks", "my-feature");
  await mkdir(taskDir, { recursive: true });
  await writeFile(resolve(taskDir, "01-customer-story-my-feature.md"), story, "utf8");

  const result = await recordHumanLayerTurn({
    home,
    taskDir,
    message: "Aprobado, sigue.",
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
    now: () => "2026-08-12T18:00:00.000Z",
  });

  assert.equal(result.approval.accepted, true);
  assert.equal(result.approval.kind, "document");
  assert.equal(result.currentPhase.role, "research-questions");
  assert.equal(result.action, "create-artifact");
  assert.deepEqual(result.gateReceipts, []);
  assert.match(result.statePath, /\.development-system\/private\/working-backwards\/my-feature-[a-f0-9]{12}\/humanlayer-workflow\.json$/);

  const state = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.equal(state.documentApprovals[0].role, "customer-story");
  assert.match(state.documentApprovals[0].contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(state.gateReceipts, undefined);
});

test("negated, combined, and ambiguous language never approves", () => {
  for (const message of [
    "No lo apruebo.",
    "Todavía no.",
    "Quizá aprobado.",
    "Apruebo producto y técnico.",
    "Apruebo técnico y producto.",
    "Apruebo producto y tickets.",
    "Apruebo tickets y técnico.",
    "Legal ya lo había aprobado.",
    "¿Aprobado?",
    "She said \"approved\".",
    "Did she say approved?",
    "The reviewer said approved.",
    "Legal said approved.",
    "The customer approved it.",
    "The reviewer said looks good, go ahead.",
    "Legal says all good, continue.",
    "The customer says yes, continue.",
  ]) {
    assert.equal(classifyApproval(message).accepted, false, message);
  }
  assert.equal(classifyApproval("Apruebo, continúa").accepted, true);
  assert.equal(classifyApproval("Lo apruebo").accepted, true);
  assert.equal(classifyApproval("Se ve bien, continúa").accepted, true);
  assert.equal(classifyApproval("Looks good, go ahead").accepted, true);
  assert.equal(classifyApproval("Perfecto, adelante").accepted, true);
  assert.equal(classifyApproval("Sí, continúa").accepted, true);
  assert.equal(classifyApproval("Todo correcto, continúa").accepted, true);
  assert.equal(classifyApproval("De acuerdo, puedes avanzar").accepted, true);
  assert.equal(classifyApproval("Claro, avanza").accepted, true);
  assert.equal(classifyApproval("Sí, pero cambia el título y continúa").accepted, false);
});

test("formal product approval is bound to the exact artifact and drift blocks descendants", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-humanlayer-home-"));
  const taskDir = resolve(home, "repo", ".humanlayer", "tasks", "my-feature");
  await mkdir(taskDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract"];
  for (const [index, role] of roles.entries()) {
    const file = resolve(taskDir, `${String(index + 1).padStart(2, "0")}-${role}-my-feature.md`);
    await writeFile(file, `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n---\n\n# ${role}\n`, "utf8");
    const approval = await recordHumanLayerTurn({
      home,
      taskDir,
      message: "Apruebo, sigue",
      repositoryIdentity: "https://github.com/AO-HyS/example.git",
      repositoryRevision: "abc123",
      now: () => `2026-08-12T18:0${index}:00.000Z`,
    });
    assert.equal(approval.approval.accepted, true);
  }

  const approved = await inspectWorkflow({ home, taskDir });
  assert.equal(approved.currentPhase.role, "technical-contract");
  assert.equal(approved.gateReceipts.length, 1);
  assert.equal(approved.gateReceipts[0].gate, "product");
  assert.equal(approved.gateReceipts[0].repositoryIdentity, "https://github.com/ao-hys/example");
  assert.deepEqual(approved.gateReceipts[0].artifacts.map((artifact) => artifact.role), [
    "working-backwards-brief",
    "research-questions",
    "research-report",
    "product-contract",
  ]);
  assert.match(approved.gateReceipts[0].receiptHash, /^sha256:[a-f0-9]{64}$/);
  const receiptFile = JSON.parse(await readFile(approved.gateReceiptPath, "utf8"));
  assert.equal(receiptFile.workflowId, approved.workflowId);
  assert.equal(receiptFile.receipts[0].gate, "product");
  const canonicalReceipts = await readWorkingBackwardsGateReceipts({ home, workflowId: approved.workflowId });
  assert.equal(canonicalReceipts.length, 1);
  assert.equal(canonicalReceipts[0].receiptHash, approved.gateReceipts[0].receiptHash);
  const lifecycle = await readLifecycleState({ home, workflowId: approved.workflowId });
  assert.equal(lifecycle.stage, "requirements_approved");
  assert.deepEqual(lifecycle.evidence.map((entry) => entry.operation), ["start_requirements", "approve_requirements"]);

  await writeFile(resolve(taskDir, "01-customer-story-my-feature.md"), `${story}\nCambio posterior.\n`, "utf8");
  const stale = await inspectWorkflow({ home, taskDir });
  assert.equal(stale.invalidFrom, "customer-story");
  assert.equal(stale.currentPhase.role, "customer-story");
  assert.equal(stale.gateReceipts.length, 0);
  assert.equal(stale.implementationAuthorized, false);
});

test("repository drift returns to the affected formal gate and requires its explicit reapproval", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-humanlayer-home-"));
  const taskDir = resolve(home, "repo", ".humanlayer", "tasks", "my-feature");
  await mkdir(taskDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract"];
  for (const [index, role] of roles.entries()) {
    await writeFile(resolve(taskDir, `${String(index + 1).padStart(2, "0")}-${role}-my-feature.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n---\n\n# ${role}\n`, "utf8");
    if (role === "technical-contract") break;
    const result = await recordHumanLayerTurn({
      home,
      taskDir,
      message: "Apruebo, sigue",
      repositoryIdentity: "https://github.com/AO-HyS/example.git",
      repositoryRevision: "revision-a",
    });
    assert.equal(result.approval.accepted, true);
  }

  const drifted = await inspectWorkflow({
    home,
    taskDir,
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "revision-b",
  });
  assert.equal(drifted.invalidFrom, "product-contract");
  assert.equal(drifted.currentPhase.role, "product-contract");
  assert.deepEqual(drifted.gateReceipts, []);

  const reapproved = await recordHumanLayerTurn({
    home,
    taskDir,
    message: "Apruebo, sigue",
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "revision-b",
  });
  assert.equal(reapproved.approval.accepted, true);
  assert.equal(reapproved.approval.operation, "approve-product-contract");
  assert.equal(reapproved.currentPhase.role, "technical-contract");
  assert.equal(reapproved.gateReceipts[0].repositoryRevision, "revision-b");
});

test("a dead canonical lifecycle lock is recovered before a formal approval", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-humanlayer-home-"));
  const taskDir = resolve(home, "repo", ".humanlayer", "tasks", "my-feature");
  await mkdir(taskDir, { recursive: true });
  for (const [index, role] of ["customer-story", "research-questions", "research-report", "product-contract"].entries()) {
    await writeFile(resolve(taskDir, `${String(index + 1).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n---\n\n# ${role}\n`, "utf8");
    if (role !== "product-contract") {
      const result = await recordHumanLayerTurn({ home, taskDir, message: "Claro, avanza" });
      assert.equal(result.approval.accepted, true);
    }
  }
  const active = await inspectWorkflow({ home, taskDir });
  const lifecycleDirectory = resolve(home, ".development-system", "lifecycles");
  await mkdir(lifecycleDirectory, { recursive: true });
  await writeFile(resolve(lifecycleDirectory, `${active.workflowId}.json.lock`), `${JSON.stringify({ pid: 2147483647, token: "dead", createdAt: "2020-01-01T00:00:00.000Z" })}\n`, "utf8");

  const approved = await recordHumanLayerTurn({
    home,
    taskDir,
    message: "Todo correcto, continúa",
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
  });
  assert.equal(approved.approval.accepted, true);
  assert.equal((await readLifecycleState({ home, workflowId: active.workflowId })).stage, "requirements_approved");
});

test("the T3 handoff can only exist in the private workflow directory", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-humanlayer-home-"));
  const taskDir = resolve(home, "repo", ".humanlayer", "tasks", "my-feature");
  await mkdir(taskDir, { recursive: true });
  await writeFile(resolve(taskDir, "07-t3-handoff-my-feature.md"), "---\nworking_backwards_role: t3-handoff\nworking_backwards_status: draft\n---\n", "utf8");
  await assert.rejects(inspectWorkflow({ home, taskDir }), /private.*cannot live.*HumanLayer task directory/i);
});

test("the complete progressive flow reaches a private T3 handoff with three canonical gates", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-humanlayer-home-"));
  const taskDir = resolve(home, "repo", ".humanlayer", "tasks", "my-feature");
  await mkdir(taskDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract", "implementation-map"];
  let status;
  for (const [index, role] of roles.entries()) {
    const firstSlice = role === "implementation-map" ? "working_backwards_first_slice: slice-01\n" : "";
    const body = role === "implementation-map" ? "\n## slice-01\n\nPrimer slice vertical ejecutable.\n" : "";
    await writeFile(resolve(taskDir, `${String(index + 1).padStart(2, "0")}-${role}-my-feature.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n${firstSlice}---\n\n# ${role}\n${body}`, "utf8");
    status = await recordHumanLayerTurn({
      home,
      taskDir,
      message: "Se ve bien, continúa",
      repositoryIdentity: "https://github.com/AO-HyS/example.git",
      repositoryRevision: "abc123",
    });
    assert.equal(status.approval.accepted, true);
  }

  assert.equal(status.action, "create-private-handoff", JSON.stringify({ phase: status.currentPhase, gates: status.gateReceipts, approvals: status.documentApprovals }, null, 2));
  assert.equal(status.currentPhase.role, "t3-handoff");
  assert.deepEqual(status.gateReceipts.map((receipt) => receipt.gate), ["product", "technical", "implementationMap"]);
  const lifecycle = await readLifecycleState({ home, workflowId: status.workflowId });
  assert.equal(lifecycle.stage, "tickets_approved");
  await writeFile(status.privateHandoffPath, "# T3 Handoff\n\nimplementationAuthorized: false\n", { encoding: "utf8", mode: 0o600 });
  const invalid = await inspectWorkflow({
    home,
    taskDir,
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
  });
  assert.equal(invalid.action, "create-private-handoff");
  assert.equal(invalid.privateHandoffInvalid, true);
  const receiptByGate = new Map(status.gateReceipts.map((receipt) => [receipt.gate, receipt]));
  /** @param {string} firstSlice */
  const boundHandoff = (firstSlice) => `---
working_backwards_role: t3-handoff
working_backwards_status: draft
workflow_id: ${status.workflowId}
gate_receipt_path: ${status.gateReceiptPath}
repository_identity: https://github.com/ao-hys/example
repository_revision: abc123
product_receipt_hash: ${receiptByGate.get("product").receiptHash}
technical_receipt_hash: ${receiptByGate.get("technical").receiptHash}
implementation_map_receipt_hash: ${receiptByGate.get("implementationMap").receiptHash}
implementation_map_hash: ${receiptByGate.get("implementationMap").ticketMapHash}
first_slice: ${firstSlice}
implementationAuthorized: false
requiresImplementPreview: true
---

# T3 Handoff

Implementa solamente ${firstSlice} después de un Implement Preview explícito.
`;
  await writeFile(status.privateHandoffPath, boundHandoff("slice-99"), { encoding: "utf8", mode: 0o600 });
  const mismatched = await inspectWorkflow({
    home,
    taskDir,
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
  });
  assert.equal(mismatched.action, "create-private-handoff");
  assert.equal(mismatched.privateHandoffInvalid, true);
  await writeFile(status.privateHandoffPath, boundHandoff("slice-01"), { encoding: "utf8", mode: 0o600 });
  const ready = await inspectWorkflow({
    home,
    taskDir,
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
  });
  assert.equal(ready.action, "handoff-ready");
  assert.equal(ready.privateHandoffInvalid, false);
  assert.equal(ready.currentArtifact.path, ready.privateHandoffPath);
  assert.equal(ready.artifacts.length, 6);
  assert.equal(ready.implementationAuthorized, false);
});
