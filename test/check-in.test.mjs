import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { buildCheckIn, detectCheckInRequest } from "../src/check-in.mjs";

const now = "2026-08-14T18:00:00.000Z";

function evidence(overrides = {}) {
  return {
    id: "pr-42",
    repository: "AO-HyS/example",
    source: "pull-request",
    subject: "DSN-42",
    claim: "workflow-state",
    state: "review-required",
    observedAt: "2026-08-14T17:55:00.000Z",
    requiresHuman: true,
    url: "https://example.test/pr/42",
    action: {
      title: "Revisar PR 42",
      reason: "La implementación está lista y sólo falta tu decisión.",
      capability: "mobile",
      minutes: 8,
      priority: 80,
    },
    ...overrides,
  };
}

test("natural phrases activate check-in and infer device and time without authority", () => {
  assert.deepEqual(detectCheckInRequest("Ya llegué"), {
    activated: true,
    operation: "check-in",
    device: "computer",
    availableMinutes: null,
    authorization: { externalWrites: false, promotion: false },
  });
  assert.equal(detectCheckInRequest("Estoy en el celular").device, "mobile");
  assert.equal(detectCheckInRequest("Tengo media hora").availableMinutes, 30);
  assert.equal(detectCheckInRequest("Muéstrame el backlog").activated, false);
});

test("repo-local check-in returns a short, linked, read-only action list", () => {
  const report = buildCheckIn({
    request: "Ya llegué, tengo 20 minutos",
    now,
    scope: { kind: "repository", repository: "AO-HyS/example" },
    maxActions: 3,
    evidence: [
      evidence(),
      evidence({
        id: "preview-42",
        source: "preview",
        claim: "preview-state",
        state: "ready",
        url: "https://preview.example.test",
        action: { title: "Probar preview", reason: "La navegación necesita validación manual.", capability: "computer", minutes: 15, priority: 90 },
      }),
      evidence({
        id: "reader-42",
        source: "development-run",
        claim: "run-state",
        state: "ready-for-review",
        url: "file:///private/reader/DSN-42.html",
        action: { title: "Abrir Reader", reason: "El resumen privado concentra las decisiones pendientes.", capability: "mobile", minutes: 5, priority: 70 },
      }),
      evidence({ id: "other", repository: "AO-HyS/other" }),
    ],
  });

  assert.equal(report.valid, true);
  assert.equal(report.activated, true);
  assert.equal(report.actions.length, 3);
  assert.deepEqual(report.actions.map((action) => action.capability).sort(), ["computer", "mobile", "mobile"]);
  assert.deepEqual(report.actions.map((action) => action.open?.kind).sort(), ["evidence", "preview", "reader"]);
  assert.equal(report.evidence.items.some((item) => item.repository === "AO-HyS/other"), false);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.externalWriteIntents, []);
  assert.deepEqual(report.externalSideEffects, []);
  assert.equal(report.privateReport.format, "development-system-private-report/v1");
});

test("global mobile view prioritizes matching actions and keeps the list bounded", () => {
  const report = buildCheckIn({
    request: "Estoy en el celular y tengo 10 minutos",
    now,
    scope: { kind: "global" },
    maxActions: 2,
    evidence: [
      evidence({ id: "mobile-a", repository: "repo-a", action: { title: "Decidir copy", reason: "Bloquea el cierre.", capability: "mobile", minutes: 5, priority: 40 } }),
      evidence({ id: "computer-b", repository: "repo-b", action: { title: "QA local", reason: "Requiere navegador local.", capability: "computer", minutes: 10, priority: 100 } }),
      evidence({ id: "secret-c", repository: "repo-c", action: { title: "Configurar secreto", reason: "Sólo existe en el dispositivo local.", capability: "local-device", minutes: 5, priority: 100 } }),
    ],
  });

  assert.equal(report.actions.length, 2);
  assert.equal(report.actions[0].id, "mobile-a");
  assert.equal(report.deferred.length, 1);
  assert.deepEqual(new Set([...report.actions, ...report.deferred].map((action) => action.capability)), new Set(["mobile", "computer", "local-device"]));
});

test("global check-in selects one first action per repository before a second", () => {
  const report = buildCheckIn({
    request: "Ya llegué",
    now,
    scope: { kind: "global" },
    maxActions: 3,
    evidence: [
      evidence({ id: "a-1", repository: "repo-a", action: { title: "A1", reason: "Primera", capability: "computer", priority: 100 } }),
      evidence({ id: "a-2", repository: "repo-a", subject: "A2", action: { title: "A2", reason: "Segunda", capability: "computer", priority: 90 } }),
      evidence({ id: "b-1", repository: "repo-b", action: { title: "B1", reason: "Primera", capability: "computer", priority: 10 } }),
      evidence({ id: "c-1", repository: "repo-c", action: { title: "C1", reason: "Primera", capability: "computer", priority: 1 } }),
    ],
  });
  assert.deepEqual(report.actions.map((action) => action.repository), ["repo-a", "repo-b", "repo-c"]);
  assert.equal(report.deferred[0].id, "a-2");
});

test("conflicting and stale evidence stay visible, and green CI cannot prove production", () => {
  const report = buildCheckIn({
    request: "Ya llegué",
    now,
    freshnessMinutes: 60,
    evidence: [
      evidence({ id: "git", source: "repository", state: "merged", observedAt: "2026-08-12T12:00:00.000Z" }),
      evidence({ id: "linear", source: "linear", state: "in-progress", observedAt: "2026-08-14T17:58:00.000Z" }),
      evidence({ id: "ci", source: "ci", subject: "main", state: "green", claim: "ci-state", requiresHuman: false, action: undefined }),
      evidence({ id: "unknown", source: "release", subject: "main", claim: "production-state", state: undefined, observedAt: undefined, requiresHuman: false, action: undefined }),
    ],
  });

  assert.deepEqual(report.evidence.stale, ["git"]);
  assert.deepEqual(report.evidence.unproven, ["unknown"]);
  assert.equal(report.evidence.conflicts.length, 1);
  assert.deepEqual(report.evidence.conflicts[0].states, ["merged", "in-progress"]);
  assert.equal(report.actions.length, 1);
  assert.equal(report.actions[0].conflict, true);
  assert.deepEqual(report.actions[0].evidenceIds, ["git", "linear"]);
  assert.equal(report.evidence.production[0].status, "unproven");
});

test("provider production evidence is explicit and promotion still needs separate authorization", () => {
  const report = buildCheckIn({
    request: "Ya llegué",
    now,
    evidence: [evidence({
      id: "release-42",
      source: "release",
      subject: "main",
      claim: "production-state",
      state: "smoke-passed",
      destination: "production",
      providerEvidence: true,
      action: { title: "Revisar producción", reason: "El proveedor reporta smoke completo.", capability: "promotion-authorization", minutes: 3 },
    })],
  });

  assert.equal(report.evidence.production[0].status, "proven");
  assert.equal(report.actions[0].capability, "promotion-authorization");
  assert.equal(report.authorization.promotionGranted, false);
});

test("conflicting or stale release evidence cannot prove current production", () => {
  const conflicting = buildCheckIn({
    request: "Ya llegué",
    now,
    evidence: [
      evidence({ id: "release-ok", source: "release", subject: "main", claim: "production-state", state: "deployed", destination: "production", providerEvidence: true, requiresHuman: false, action: undefined }),
      evidence({ id: "release-failed", source: "release", subject: "main", claim: "production-state", state: "failed", destination: "production", providerEvidence: true, requiresHuman: false, action: undefined }),
    ],
  });
  const stale = buildCheckIn({
    request: "Ya llegué",
    now,
    freshnessMinutes: 10,
    evidence: [evidence({ id: "old-release", source: "release", subject: "main", claim: "production-state", state: "deployed", destination: "production", providerEvidence: true, observedAt: "2026-08-13T18:00:00.000Z", requiresHuman: false, action: undefined })],
  });

  assert.equal(conflicting.evidence.production[0].status, "conflicting");
  assert.equal(stale.evidence.production[0].status, "unproven");
});

test("nothing-to-do and missing data remain explicit rather than invented", () => {
  const report = buildCheckIn({
    request: "Ya llegué",
    now,
    evidence: [evidence({ id: "quiet", requiresHuman: false, action: undefined, state: undefined, observedAt: undefined })],
  });

  assert.equal(report.summary, "No hay acciones humanas demostradas ahora.");
  assert.deepEqual(report.actions, []);
  assert.deepEqual(report.evidence.unproven, ["quiet"]);
  assert.equal(report.privateReport.summary, "nothing-to-do");
});

test("an invalid reconciliation clock fails closed and makes freshness unproven", () => {
  const report = buildCheckIn({ request: "Ya llegué", now: "not-a-date", evidence: [evidence()] });
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /deterministic timestamp/);
  assert.equal(report.evidence.items[0].freshness, "unproven");
});

test("the 1.5.0 installable surface preserves reconciliation and read-only rules", async () => {
  const skillRoot = resolve(import.meta.dirname, "../artifacts/1.5.0/skills/internal/check-in");
  const [skill, interfaceYaml] = await Promise.all([
    readFile(resolve(skillRoot, "SKILL.md"), "utf8"),
    readFile(resolve(skillRoot, "agents/openai.yaml"), "utf8"),
  ]);

  assert.match(skill, /repositories, Linear, pull requests and reviews, CI, previews/i);
  assert.match(skill, /green Git or CI alone is never deploy evidence/i);
  assert.match(skill, /readOnly: true/);
  assert.match(skill, /mobile.*computer.*local-device.*promotion-authorization/is);
  assert.match(interfaceYaml, /display_name: "Check-in"/);
});
