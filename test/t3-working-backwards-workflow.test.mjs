import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  classifyApproval,
  inspectT3Workflow,
  recordT3Turn,
  writeT3Reader,
  WORKING_BACKWARDS_PHASES,
} from "../artifacts/1.4.0/skills/internal/working-backwards/scripts/t3-workflow.mjs";
import { writeT3Reader as writeT3ReaderV2 } from "../artifacts/1.5.0/skills/internal/working-backwards/scripts/t3-workflow.mjs";
import { writeT3Reader as writeT3ReaderV3 } from "../artifacts/1.5.5/skills/internal/working-backwards/scripts/t3-workflow.mjs";
import { classifyApproval as classifyApprovalV4 } from "../artifacts/1.5.7/skills/internal/working-backwards/scripts/t3-workflow.mjs";
import { classifyApproval as classifyApprovalV5 } from "../artifacts/1.5.8/skills/internal/working-backwards/scripts/t3-workflow.mjs";
import { readWorkingBackwardsGateReceipts } from "../src/working-backwards-gates.mjs";
import { executeLifecycleOperation, readLifecycleState, runLifecycleRequest } from "../src/lifecycle.mjs";

const story = `---
working_backwards_role: customer-story
working_backwards_status: draft
---

# La experiencia futura

Una persona consigue el resultado sin conocer la implementación.
`;

async function createGitRepository() {
  const repositoryPath = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-repo-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repositoryPath });
  execFileSync("git", ["config", "user.email", "tests@example.invalid"], { cwd: repositoryPath });
  execFileSync("git", ["config", "user.name", "Development System Tests"], { cwd: repositoryPath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/AO-HyS/example.git"], { cwd: repositoryPath });
  await writeFile(resolve(repositoryPath, "README.md"), "# Fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repositoryPath });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repositoryPath });
  return { repositoryPath, repositoryRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).trim() };
}

async function approveDeliveryWorkflow(home, workspaceDir, repository) {
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract", "implementation-map"];
  for (const [index, role] of roles.entries()) {
    const firstSlice = role === "implementation-map" ? "working_backwards_first_slice: slice-01\n" : "";
    const body = role === "implementation-map" ? "\n## slice-01 — Primer slice\n\n### Outcome\nEntrega el resultado.\n\n### Acceptance\nEl flujo termina.\n\n### Checks\nPrueba enfocada.\n\n### Dependencies\n- None\n" : "";
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n${firstSlice}---\n\n# ${role}\n${body}`, "utf8");
    const result = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision, repositoryPath: repository.repositoryPath });
    assert.equal(result.approval.accepted, true);
  }
  return inspectT3Workflow({ home, workspaceDir, repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision });
}

test("the T3 Code workflow starts with one customer-story artifact", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-my-feature");
  await mkdir(workspaceDir, { recursive: true });

  const status = await inspectT3Workflow({ home, workspaceDir });

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

  const rendered = await writeT3Reader({ home, workspaceDir, repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: "abc123" });
  assert.equal(rendered.readerWritten, true);
  const html = await readFile(rendered.readerPath, "utf8");
  assert.match(html, /Working Backwards/);
  assert.match(html, /Crear Future Customer Story/);
  assert.match(html, /Implementación no autorizada.*Implement Preview/);
  assert.match(html, /noindex,nofollow/);
  assert.match(html, /class="document-column"/);
  assert.match(html, /class="artifacts-rail"/);
  assert.match(html, /class="toc-rail"/);
  assert.match(html, /grid-template-columns:minmax\(12rem,1fr\) minmax\(0,56rem\) minmax\(11rem,1fr\)/);
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(html, /connect-src 'none'/);
});

test("the T3 planning workspace must remain under private Development System HOME", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  await assert.rejects(
    inspectT3Workflow({ home, workspaceDir: resolve(home, "repo", ".scratch", "working-backwards", "feature") }),
    /inside private Development System HOME/i,
  );
});

test("a clear conversational approval advances one document and persists private evidence", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-my-feature");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(resolve(workspaceDir, "01-customer-story-my-feature.md"), story, "utf8");

  const result = await recordT3Turn({
    home,
    workspaceDir,
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
  assert.match(result.statePath, /\.development-system\/private\/working-backwards\/repo-my-feature-[a-f0-9]{12}\/t3-workflow\.json$/);

  const state = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.equal(state.documentApprovals[0].role, "customer-story");
  assert.match(state.documentApprovals[0].contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(state.gateReceipts, undefined);
  const reader = await readFile(result.readerPath, "utf8");
  assert.match(reader, /Crear Research Questions/);
  assert.match(reader, /01-customer-story-my-feature\.md/);
  assert.match(reader, /La experiencia futura/);
});

test("the derived HTML escapes artifact content and never becomes canonical state", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-safe-render");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(resolve(workspaceDir, "01-customer-story.md"), `${story}\n<script>alert("x")</script>\n`, "utf8");
  const rendered = await writeT3Reader({ home, workspaceDir });
  const html = await readFile(rendered.readerPath, "utf8");
  assert.doesNotMatch(html, /<script>alert/iu);
  assert.match(html, /&lt;script&gt;alert/iu);
  assert.equal(rendered.artifacts.length, 1);
  assert.equal(rendered.artifacts[0].fileName, "01-customer-story.md");
});

test("the v2 Reader maintains one private metadata-only library across human initiatives", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-reader-library-home-"));
  const root = resolve(home, ".development-system", "private", "working-backwards");
  const firstWorkspace = resolve(root, "development-system-next");
  const secondWorkspace = resolve(root, "release-train-refresh");
  await mkdir(firstWorkspace, { recursive: true });
  await mkdir(secondWorkspace, { recursive: true });
  await writeFile(resolve(firstWorkspace, "01-product-grill.md"), `---
working_backwards_role: product-grill
working_backwards_status: draft
initiative_name: Development System Next
created_at: 2026-08-01
---

# Product Grill

Private canonical content must not enter the common catalog.
`, "utf8");

  const first = await writeT3ReaderV2({
    home,
    workspaceDir: firstWorkspace,
    repositoryIdentity: "https://github.com/AO-HyS/development-system.git",
    repositoryRevision: "abc123",
    now: () => "2026-08-14T12:00:00.000Z",
  });
  const second = await writeT3ReaderV2({
    home,
    workspaceDir: secondWorkspace,
    initiativeName: "Release Train Refresh",
    repositoryIdentity: "https://github.com/AO-HyS/development-system.git",
    repositoryRevision: "def456",
    now: () => "2026-08-14T13:00:00.000Z",
  });

  const catalog = JSON.parse(await readFile(first.readerLibraryCatalogPath, "utf8"));
  const library = await readFile(first.readerLibraryPath, "utf8");
  const reader = await readFile(first.readerPath, "utf8");
  assert.equal(first.readerLibraryPath, second.readerLibraryPath);
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.entries.length, 2);
  assert.deepEqual(catalog.entries.map((entry) => entry.name), ["Development System Next", "Release Train Refresh"]);
  assert.equal(catalog.entries[0].slug, "development-system-next");
  assert.equal(catalog.entries[0].repository, "https://github.com/ao-hys/development-system");
  assert.equal(catalog.entries[0].phase, "Product Grill With Docs");
  assert.equal(catalog.entries[0].status, "in-review");
  assert.equal(catalog.entries[0].createdAt, "2026-08-01T00:00:00.000Z");
  assert.equal(catalog.entries[0].updatedAt, "2026-08-14T12:00:00.000Z");
  assert.equal(catalog.entries[0].nextAction, "Revisar y aprobar Product Grill With Docs");
  assert.match(catalog.entries[0].readerHref, /^development-system-next\/index\.html$/u);
  assert.doesNotMatch(JSON.stringify(catalog), /Private canonical content/);
  assert.match(library, /Biblioteca del Technical Reader/);
  assert.match(library, /Development System Next/);
  assert.match(library, /Release Train Refresh/);
  assert.doesNotMatch(library, /Private canonical content/);
  assert.match(reader, /class="source-button library-link" href="\.\.\/index\.html"/);
  assert.deepEqual(first.localWrites, [first.readerPath, first.readerLibraryCatalogPath, first.readerLibraryPath]);
  assert.equal((await stat(first.readerPath)).mode & 0o777, 0o600);
  assert.equal((await stat(first.readerLibraryCatalogPath)).mode & 0o777, 0o600);
  assert.equal((await stat(first.readerLibraryPath)).mode & 0o777, 0o600);
});

test("the v3 Reader gives each workflow a human initiative filename", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-reader-name-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "reader-legibility");
  await mkdir(workspaceDir, { recursive: true });
  const unrelatedPath = resolve(workspaceDir, "operator-notes.txt");
  await writeFile(unrelatedPath, "preserve this file", "utf8");
  const legacy = await writeT3ReaderV2({
    home,
    workspaceDir,
    initiativeName: "Informe Técnico Legible",
    now: () => "2026-08-14T14:00:00.000Z",
  });

  const result = await writeT3ReaderV3({
    home,
    workspaceDir,
    initiativeName: "Informe Técnico Legible",
    now: () => "2026-08-14T15:00:00.000Z",
  });
  const catalog = JSON.parse(await readFile(result.readerLibraryCatalogPath, "utf8"));

  assert.match(result.readerPath, /\/informe-tecnico-legible\.html$/u);
  assert.equal(legacy.readerPath, resolve(workspaceDir, "index.html"));
  assert.equal(result.retiredReaderPath, legacy.readerPath);
  await assert.rejects(access(legacy.readerPath), { code: "ENOENT" });
  assert.equal(await readFile(unrelatedPath, "utf8"), "preserve this file");
  assert.equal(catalog.entries[0].readerHref, "reader-legibility/informe-tecnico-legible.html");
  await access(result.readerPath);
  await access(result.readerLibraryPath);

  await symlink(unrelatedPath, legacy.readerPath);
  const repeated = await writeT3ReaderV3({
    home,
    workspaceDir,
    initiativeName: "Informe Técnico Legible",
    now: () => "2026-08-14T16:00:00.000Z",
  });
  assert.equal(repeated.retiredReaderPath, null);
  assert.deepEqual(repeated.readerIndexCollision, { path: legacy.readerPath, reason: "symbolic-link" });
  assert.equal((await lstat(legacy.readerPath)).isSymbolicLink(), true);
  assert.equal(await readFile(legacy.readerPath, "utf8"), "preserve this file");
});

test("the v3 Reader preserves and reports a user-owned workflow index collision", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-reader-index-collision-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "reader-index-collision");
  const indexPath = resolve(workspaceDir, "index.html");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(indexPath, "<!doctype html><title>Operator-owned index</title>", "utf8");

  const result = await writeT3ReaderV3({
    home,
    workspaceDir,
    initiativeName: "Reader Index Collision",
    now: () => "2026-08-14T16:30:00.000Z",
  });

  assert.equal(await readFile(indexPath, "utf8"), "<!doctype html><title>Operator-owned index</title>");
  assert.equal(result.retiredReaderPath, null);
  assert.deepEqual(result.readerIndexCollision, { path: indexPath, reason: "unmanaged-regular-file" });
  await access(result.readerPath);
  await access(result.readerLibraryPath);
});

test("the v3 Reader fails closed on a user-owned named destination", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-reader-destination-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "reader-destination");
  const destinationPath = resolve(workspaceDir, "operator-reader.html");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(destinationPath, "<!doctype html><title>Operator-owned Reader</title>", "utf8");

  await assert.rejects(
    writeT3ReaderV3({
      home,
      workspaceDir,
      initiativeName: "Operator Reader",
      now: () => "2026-08-14T16:40:00.000Z",
    }),
    { code: "TECHNICAL_READER_DESTINATION_COLLISION", path: destinationPath, reason: "unmanaged-regular-file" },
  );

  assert.equal(await readFile(destinationPath, "utf8"), "<!doctype html><title>Operator-owned Reader</title>");
  assert.deepEqual(await readdir(workspaceDir), ["operator-reader.html"]);
});

test("the v3 Reader fails closed on a named destination symlink", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-reader-destination-link-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "reader-destination-link");
  const targetPath = resolve(workspaceDir, "operator-target.html");
  const destinationPath = resolve(workspaceDir, "linked-reader.html");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(targetPath, "operator target", "utf8");
  await symlink(targetPath, destinationPath);

  await assert.rejects(
    writeT3ReaderV3({
      home,
      workspaceDir,
      initiativeName: "Linked Reader",
      now: () => "2026-08-14T16:50:00.000Z",
    }),
    { code: "TECHNICAL_READER_DESTINATION_COLLISION", path: destinationPath, reason: "symbolic-link" },
  );

  assert.equal((await lstat(destinationPath)).isSymbolicLink(), true);
  assert.equal(await readFile(targetPath, "utf8"), "operator target");
  assert.deepEqual((await readdir(workspaceDir)).sort(), ["linked-reader.html", "operator-target.html"]);
});

test("the review surface renders local Mermaid flows, charts, and code snippets without remote scripts", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-visuals");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(resolve(workspaceDir, "01-customer-story.md"), `${story}
## Flujo

\`\`\`mermaid
flowchart LR
  A[Idea] --> B{Contrato claro}
  B -->|Sí| C[Implementación]
\`\`\`

## Señal

\`\`\`chart
{"type":"bar","title":"Confianza por fase","labels":["Historia","Contrato","Tickets"],"values":[35,72,94]}
\`\`\`

## Interfaz

\`\`\`typescript
export const outcome = "visible";
\`\`\`
`, "utf8");

  const rendered = await writeT3Reader({ home, workspaceDir });
  const html = await readFile(rendered.readerPath, "utf8");
  assert.match(html, /data-mermaid/);
  assert.match(html, />Contrato claro<|>Recordatorio activo</);
  assert.match(html, /Confianza por fase/);
  assert.match(html, /class="code-block"/);
  assert.match(html, /class="line-number"/);
  assert.match(html, /En esta página/);
  assert.match(html, /href="#flujo"/);
  assert.match(html, /--accent-ink:/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(html, /cdn|mermaid\.esm|tailwindcss/iu);
  assert.doesNotMatch(html, /https?:\/\/|\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon/iu);
});

test("a symlinked planning workspace fails before reading or persisting approval state", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const outside = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-outside-"));
  await writeFile(resolve(outside, "01-customer-story.md"), story, "utf8");
  const root = resolve(home, ".development-system", "private", "working-backwards");
  await mkdir(root, { recursive: true });
  const workspaceDir = resolve(root, "repo-symlink");
  await symlink(outside, workspaceDir);

  await assert.rejects(inspectT3Workflow({ home, workspaceDir }), /unsafe symbolic link/i);
  await assert.rejects(recordT3Turn({ home, workspaceDir, message: "Aprobado, sigue" }), /unsafe symbolic link/i);
  const expectedStateRoot = resolve(root, `repo-symlink-${createHash("sha256").update(resolve(workspaceDir)).digest("hex").slice(0, 12)}`);
  await assert.rejects(access(resolve(expectedStateRoot, "t3-workflow.json")));
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

test("the 1.5.7 workflow accepts direct natural approval for only the active artifact", () => {
  for (const message of [
    "Está muy bien.",
    "Me gusta",
    "Todo lo recomendado está muy bien",
    "Perfecto todo aquí",
    "Suena muy bien",
    "Excelente",
  ]) {
    assert.equal(classifyApprovalV4(message).accepted, true, message);
  }
  for (const message of [
    "El título está bien",
    "Me gusta el título",
    "Está muy bien, pero cambia el título",
    "¿Está muy bien?",
    "El reviewer dijo que está muy bien",
    "Todo bien con producto y técnico",
  ]) {
    assert.equal(classifyApprovalV4(message).accepted, false, message);
  }
});

test("the 1.5.8 workflow accepts ordinary no-change and move-on language without weakening feedback gates", () => {
  for (const message of [
    "Por mí está bien, vamos a la siguiente fase.",
    "No tengo cambios, sigue con lo que sigue.",
    "No hace falta cambiar nada; continúa.",
    "Ya quedó, dale.",
    "Adelante.",
    "Continúa con el siguiente documento.",
    "Lo veo bien, puedes avanzar.",
  ]) {
    assert.equal(classifyApprovalV5(message).accepted, true, message);
  }
  for (const message of [
    "No está bien, continúa.",
    "No quiero aprobarlo, sigue.",
    "No hace falta aprobarlo, continúa.",
    "Por mí está bien, pero cambia el título.",
    "¿Continúas con el siguiente documento?",
    "El reviewer dijo que ya quedó, dale.",
    "Aprueba producto y técnico y sigue.",
  ]) {
    assert.equal(classifyApprovalV5(message).accepted, false, message);
  }
});

test("formal product approval is bound to the exact artifact and drift blocks descendants", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-my-feature");
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract"];
  for (const [index, role] of roles.entries()) {
    const file = resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}-my-feature.md`);
    await writeFile(file, `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n---\n\n# ${role}\n`, "utf8");
    const approval = await recordT3Turn({
      home,
      workspaceDir,
      message: "Apruebo, sigue",
      repositoryIdentity: "https://github.com/AO-HyS/example.git",
      repositoryRevision: "abc123",
      now: () => `2026-08-12T18:0${index}:00.000Z`,
    });
    assert.equal(approval.approval.accepted, true);
  }

  const approved = await inspectT3Workflow({ home, workspaceDir });
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

  await writeFile(resolve(workspaceDir, "01-customer-story-my-feature.md"), `${story}\nCambio posterior.\n`, "utf8");
  const stale = await inspectT3Workflow({ home, workspaceDir });
  assert.equal(stale.invalidFrom, "customer-story");
  assert.equal(stale.currentPhase.role, "customer-story");
  assert.equal(stale.gateReceipts.length, 0);
  assert.equal(stale.implementationAuthorized, false);
});

test("repository drift returns to the affected formal gate and requires its explicit reapproval", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-my-feature");
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract"];
  for (const [index, role] of roles.entries()) {
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}-my-feature.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n---\n\n# ${role}\n`, "utf8");
    if (role === "technical-contract") break;
    const result = await recordT3Turn({
      home,
      workspaceDir,
      message: "Apruebo, sigue",
      repositoryIdentity: "https://github.com/AO-HyS/example.git",
      repositoryRevision: "revision-a",
    });
    assert.equal(result.approval.accepted, true);
  }

  const drifted = await inspectT3Workflow({
    home,
    workspaceDir,
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "revision-b",
  });
  assert.equal(drifted.invalidFrom, "product-contract");
  assert.equal(drifted.currentPhase.role, "product-contract");
  assert.deepEqual(drifted.gateReceipts, []);

  const reapproved = await recordT3Turn({
    home,
    workspaceDir,
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
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-my-feature");
  await mkdir(workspaceDir, { recursive: true });
  for (const [index, role] of ["customer-story", "research-questions", "research-report", "product-contract"].entries()) {
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n---\n\n# ${role}\n`, "utf8");
    if (role !== "product-contract") {
      const result = await recordT3Turn({ home, workspaceDir, message: "Claro, avanza" });
      assert.equal(result.approval.accepted, true);
    }
  }
  const active = await inspectT3Workflow({ home, workspaceDir });
  const lifecycleDirectory = resolve(home, ".development-system", "lifecycles");
  await mkdir(lifecycleDirectory, { recursive: true });
  await writeFile(resolve(lifecycleDirectory, `${active.workflowId}.json.lock`), `${JSON.stringify({ pid: 2147483647, token: "dead", createdAt: "2020-01-01T00:00:00.000Z" })}\n`, "utf8");

  const approved = await recordT3Turn({
    home,
    workspaceDir,
    message: "Todo correcto, continúa",
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
  });
  assert.equal(approved.approval.accepted, true);
  assert.equal((await readLifecycleState({ home, workflowId: active.workflowId })).stage, "requirements_approved");
});

test("the T3 handoff can only exist in the private workflow directory", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-my-feature");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(resolve(workspaceDir, "07-t3-handoff-my-feature.md"), "---\nworking_backwards_role: t3-handoff\nworking_backwards_status: draft\n---\n", "utf8");
  await assert.rejects(inspectT3Workflow({ home, workspaceDir }), /private.*cannot live.*T3 Code planning workspace/i);
});

test("the complete progressive flow reaches a private T3 handoff with three canonical gates", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-my-feature");
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract", "implementation-map"];
  let status;
  for (const [index, role] of roles.entries()) {
    const firstSlice = role === "implementation-map" ? "working_backwards_first_slice: slice-01\n" : "";
    const body = role === "implementation-map" ? "\n## slice-01 — Primer slice vertical\n\n### Outcome\nEntrega una capacidad observable.\n\n### Acceptance\nEl usuario completa el flujo end-to-end.\n\n### Checks\nPrueba enfocada y validación de contrato.\n\n### Dependencies: none\n" : "";
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}-my-feature.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n${firstSlice}---\n\n# ${role}\n${body}`, "utf8");
    status = await recordT3Turn({
      home,
      workspaceDir,
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
  const invalid = await inspectT3Workflow({
    home,
    workspaceDir,
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
  const mismatched = await inspectT3Workflow({
    home,
    workspaceDir,
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
  });
  assert.equal(mismatched.action, "create-private-handoff");
  assert.equal(mismatched.privateHandoffInvalid, true);
  await writeFile(status.privateHandoffPath, boundHandoff("slice-01"), { encoding: "utf8", mode: 0o600 });
  const ready = await inspectT3Workflow({
    home,
    workspaceDir,
    repositoryIdentity: "https://github.com/AO-HyS/example.git",
    repositoryRevision: "abc123",
  });
  assert.equal(ready.action, "handoff-ready");
  assert.equal(ready.privateHandoffInvalid, false);
  assert.equal(ready.currentArtifact.path, ready.privateHandoffPath);
  assert.equal(ready.artifacts.length, 6);
  assert.equal(ready.implementationAuthorized, false);
});

test("artifact drift revokes an existing Implement Preview before delivery can execute", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-revocation");
  const repository = await createGitRepository();
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract", "implementation-map"];
  for (const [index, role] of roles.entries()) {
    const firstSlice = role === "implementation-map" ? "working_backwards_first_slice: slice-01\n" : "";
    const body = role === "implementation-map" ? "\n## slice-01 — Primer slice\n\n### Outcome\nEntrega el resultado.\n\n### Acceptance\nEl flujo termina.\n\n### Checks\nPrueba enfocada.\n\n### Dependencies: none\n" : "";
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n${firstSlice}---\n\n# ${role}\n${body}`, "utf8");
    const result = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision, repositoryPath: repository.repositoryPath });
    assert.equal(result.approval.accepted, true);
  }
  const workflow = await inspectT3Workflow({ home, workspaceDir, repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision });
  const mismatchedPreview = await runLifecycleRequest({ home, workflowId: workflow.workflowId, mode: "transition", request: "Autorizo Implement Preview para slice-99", terminalSlice: "slice-99" });
  assert.equal(mismatchedPreview.transition.status, "denied");
  assert.match(mismatchedPreview.transition.reason, /does not match.*first slice/i);
  const preview = await runLifecycleRequest({ home, workflowId: workflow.workflowId, mode: "transition", request: "Autorizo Implement Preview para slice-01", terminalSlice: "slice-01" });
  assert.equal(preview.state.stage, "delivery_authorized");

  await writeFile(resolve(workspaceDir, "01-customer-story.md"), `${story}\nCambio posterior.\n`, "utf8");
  const deniedWithoutStatus = await executeLifecycleOperation({ home, workflowId: workflow.workflowId, operation: "implement" });
  assert.equal(deniedWithoutStatus.execution.status, "denied");
  assert.match(deniedWithoutStatus.execution.reason, /artifact drift/i);

  const stale = await inspectT3Workflow({ home, workspaceDir, repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision });
  assert.equal(stale.invalidFrom, "customer-story");
  const lifecycle = await readLifecycleState({ home, workflowId: workflow.workflowId });
  assert.equal(lifecycle.stage, "requirements_in_progress");
  assert.equal(lifecycle.terminalSlice, null);
  assert.match(lifecycle.evidence.at(-1).operation, /invalidate_working_backwards_drift/);
});

test("normal descendant commits preserve delivery continuity through push and pull request", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-revision-guard");
  const repository = await createGitRepository();
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract", "implementation-map"];
  for (const [index, role] of roles.entries()) {
    const firstSlice = role === "implementation-map" ? "working_backwards_first_slice: slice-01\n" : "";
    const body = role === "implementation-map" ? "\n## slice-01 — Primer slice\n\n### Outcome\nEntrega el resultado.\n\n### Acceptance\nEl flujo termina.\n\n### Checks\nPrueba enfocada.\n\n### Dependencies\n- None\n" : "";
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n${firstSlice}---\n\n# ${role}\n${body}`, "utf8");
    const result = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision, repositoryPath: repository.repositoryPath });
    assert.equal(result.approval.accepted, true);
  }
  const workflow = await inspectT3Workflow({ home, workspaceDir, repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision });
  const preview = await runLifecycleRequest({ home, workflowId: workflow.workflowId, mode: "transition", request: "Autorizo Implement Preview para slice-01", terminalSlice: "slice-01" });
  assert.equal(preview.state.stage, "delivery_authorized");
  await writeFile(resolve(repository.repositoryPath, "changed.txt"), "changed\n", "utf8");
  execFileSync("git", ["add", "changed.txt"], { cwd: repository.repositoryPath });
  execFileSync("git", ["commit", "--quiet", "-m", "move revision"], { cwd: repository.repositoryPath });

  for (const operation of ["implement", "commit", "push", "open_pr"]) {
    const result = await executeLifecycleOperation({ home, workflowId: workflow.workflowId, operation });
    assert.equal(result.execution.status, "authorized", `${operation}: ${result.execution.reason ?? ""}`);
  }
});

test("repository remote drift denies delivery even when the approved commit is unchanged", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-remote-guard");
  const repository = await createGitRepository();
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract", "implementation-map"];
  for (const [index, role] of roles.entries()) {
    const firstSlice = role === "implementation-map" ? "working_backwards_first_slice: slice-01\n" : "";
    const body = role === "implementation-map" ? "\n## slice-01 — Primer slice\n\n### Outcome\nEntrega el resultado.\n\n### Acceptance\nEl flujo termina.\n\n### Checks\nPrueba enfocada.\n\n### Dependencies\n- None\n" : "";
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n${firstSlice}---\n\n# ${role}\n${body}`, "utf8");
    const result = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision, repositoryPath: repository.repositoryPath });
    assert.equal(result.approval.accepted, true);
  }
  const workflow = await inspectT3Workflow({ home, workspaceDir, repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: repository.repositoryRevision });
  const preview = await runLifecycleRequest({ home, workflowId: workflow.workflowId, mode: "transition", request: "Autorizo Implement Preview para slice-01", terminalSlice: "slice-01" });
  assert.equal(preview.state.stage, "delivery_authorized");
  execFileSync("git", ["remote", "set-url", "origin", "https://github.com/AO-HyS/forked-example.git"], { cwd: repository.repositoryPath });

  const denied = await executeLifecycleOperation({ home, workflowId: workflow.workflowId, operation: "implement" });
  assert.equal(denied.execution.status, "denied");
  assert.match(denied.execution.reason, /repository identity drift/i);
});

test("Implement Preview requires the exact approved repository revision", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-preview-revision-guard");
  const repository = await createGitRepository();
  const workflow = await approveDeliveryWorkflow(home, workspaceDir, repository);
  await writeFile(resolve(repository.repositoryPath, "moved-before-preview.txt"), "moved\n", "utf8");
  execFileSync("git", ["add", "moved-before-preview.txt"], { cwd: repository.repositoryPath });
  execFileSync("git", ["commit", "--quiet", "-m", "move before preview"], { cwd: repository.repositoryPath });

  const preview = await runLifecycleRequest({ home, workflowId: workflow.workflowId, mode: "transition", request: "Autorizo Implement Preview para slice-01", terminalSlice: "slice-01" });
  assert.equal(preview.transition.status, "denied");
  assert.match(preview.transition.reason, /revision drift before Implement Preview/i);
});

test("a non-descendant history rewrite invalidates delivery continuity", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-history-rewrite-guard");
  const repository = await createGitRepository();
  const workflow = await approveDeliveryWorkflow(home, workspaceDir, repository);
  const preview = await runLifecycleRequest({ home, workflowId: workflow.workflowId, mode: "transition", request: "Autorizo Implement Preview para slice-01", terminalSlice: "slice-01" });
  assert.equal(preview.state.stage, "delivery_authorized");

  const tree = execFileSync("git", ["write-tree"], { cwd: repository.repositoryPath, encoding: "utf8" }).trim();
  const unrelatedCommit = execFileSync("git", ["commit-tree", tree, "-m", "unrelated history"], { cwd: repository.repositoryPath, encoding: "utf8" }).trim();
  execFileSync("git", ["update-ref", "refs/heads/rewritten", unrelatedCommit], { cwd: repository.repositoryPath });
  execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/rewritten"], { cwd: repository.repositoryPath });

  const denied = await executeLifecycleOperation({ home, workflowId: workflow.workflowId, operation: "implement" });
  assert.equal(denied.execution.status, "denied");
  assert.match(denied.execution.reason, /repository continuity cannot be verified/i);
});

test("an Implementation Map cannot approve a missing or non-executable first slice", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-wb-t3-home-"));
  const workspaceDir = resolve(home, ".development-system", "private", "working-backwards", "repo-bad-frontier");
  await mkdir(workspaceDir, { recursive: true });
  const roles = ["customer-story", "research-questions", "research-report", "product-contract", "technical-contract"];
  for (const [index, role] of roles.entries()) {
    await writeFile(resolve(workspaceDir, `${String(index + 1).padStart(2, "0")}-${role}.md`), `---\nworking_backwards_role: ${role}\nworking_backwards_status: draft\n---\n\n# ${role}\n`, "utf8");
    const result = await recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: "abc123" });
    assert.equal(result.approval.accepted, true);
  }
  const mapPath = resolve(workspaceDir, "06-implementation-map.md");
  await writeFile(mapPath, "---\nworking_backwards_role: implementation-map\nworking_backwards_status: draft\nworking_backwards_first_slice: missing-99\n---\n\n# Implementation Map\n\n## slice-01\n\n### Outcome\nAlgo.\n", "utf8");
  await assert.rejects(recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: "abc123" }), /exactly one ticket heading: missing-99/i);
  await writeFile(mapPath, "---\nworking_backwards_role: implementation-map\nworking_backwards_status: draft\nworking_backwards_first_slice: slice-01\n---\n\n# Implementation Map\n\n## slice-01\n\n### Outcome\nAlgo.\n", "utf8");
  await assert.rejects(recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: "abc123" }), /not executable; missing:/i);
  await writeFile(mapPath, "---\nworking_backwards_role: implementation-map\nworking_backwards_status: draft\nworking_backwards_first_slice: slice-01\n---\n\n# Implementation Map\n\n## slice-01\n\n### Outcome\n\n### Acceptance\n\n### Checks\n\n### Dependencies\n- None\n", "utf8");
  await assert.rejects(recordT3Turn({ home, workspaceDir, message: "Apruebo, sigue", repositoryIdentity: "https://github.com/AO-HyS/example.git", repositoryRevision: "abc123" }), /not executable; missing: outcome, acceptance, checks/i);
});
