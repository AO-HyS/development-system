import assert from "node:assert/strict";
import test from "node:test";

import { planReleaseTrain } from "../src/release-train-v2.mjs";

const revision = "a".repeat(40);
const checks = [
  { id: "lint", command: "pnpm lint", surfaces: ["web", "shared"], evidenceKey: "lint" },
  { id: "runtime-audit-workflow", command: "pnpm audit:runtime", surfaces: ["provider-config"], evidenceKey: "runtime-audit" },
  { id: "runtime-audit-deploy", command: "pnpm audit:runtime", surfaces: ["provider-config"], evidenceKey: "runtime-audit" },
];

test("affected surfaces select checks once and reuse a revision-bound build across provider lanes", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["web", "provider-config"],
    checkRegistry: checks,
    buildArtifact: { id: "web-build", revision, hash: `sha256:${"b".repeat(64)}` },
    providers: [
      { id: "cloudflare-pages", type: "cloudflare", surfaces: ["web"], credentials: "ready", acceptsBuildArtifact: true, destination: "preview.example.pages.dev" },
      { id: "convex", type: "convex", surfaces: ["shared"], credentials: "ready", acceptsBuildArtifact: false, destination: "dev:example" },
    ],
  });

  assert.equal(plan.valid, true);
  assert.deepEqual(plan.checks.selected.map((check) => check.evidenceKey), ["lint", "runtime-audit"]);
  assert.deepEqual(plan.checks.skipped, [{ id: "runtime-audit-deploy", reason: "duplicate-evidence:runtime-audit" }]);
  assert.equal(plan.providers[0].build.action, "reuse");
  assert.equal(plan.providers[0].build.provenance.revision, revision);
  assert.equal(plan.providers[1].status, "skipped-unaffected");
  assert.equal(plan.phases.every((phase) => Object.hasOwn(phase, "duration")), true);
});

test("stack quality profiles feed only the checks applicable to changed capabilities", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["apps/web", "convex"],
    quality: {
      capabilities: ["react", "convex", "cloudflare"],
      changedSurfaces: [
        { id: "apps/web", capabilities: ["react"] },
        { id: "convex", capabilities: ["convex"] },
      ],
    },
    providers: [],
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.checks.selected.some((check) => check.id === "react-doctor"), true);
  assert.equal(plan.checks.selected.some((check) => check.id === "convex-review"), true);
  assert.equal(plan.checks.selected.some((check) => check.id === "provider-checks"), false);
  assert.equal(plan.checks.selected.every((check) => check.source === "stack-quality-profile"), true);
});

test("credential failure blocks only its affected provider lane", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["web", "backend"],
    checkRegistry: checks,
    providers: [
      { id: "cloudflare", type: "cloudflare", surfaces: ["web"], credentials: "missing", acceptsBuildArtifact: true },
      { id: "convex", type: "convex", surfaces: ["backend"], credentials: "ready", acceptsBuildArtifact: false, destination: "dev:healthy" },
      { id: "vercel", type: "vercel", surfaces: ["marketing"], credentials: "ready", acceptsBuildArtifact: false },
    ],
  });

  assert.equal(plan.providers.find((provider) => provider.id === "cloudflare").status, "blocked-credentials");
  assert.equal(plan.providers.find((provider) => provider.id === "convex").status, "planned");
  assert.equal(plan.providers.find((provider) => provider.id === "vercel").status, "skipped-unaffected");
  assert.equal(plan.sharedEvidence.status, "planned");
});

test("migrations and backfills fail closed without dry run, order, rollback, and risk authorization", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["migration"],
    checkRegistry: [],
    providers: [],
    dataOperations: [{ id: "backfill-users", type: "backfill", risk: "high", dryRun: false, order: 1, rollback: null, authorized: false }],
  });

  assert.equal(plan.valid, false);
  assert.match(plan.errors.join("\n"), /dry run|rollback|authorization/i);
  assert.equal(plan.phases.find((phase) => phase.id === "data-operations").status, "blocked");
});

test("Git success alone never claims preview or production", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["web"],
    checkRegistry: [],
    providers: [{ id: "cloudflare", type: "cloudflare", surfaces: ["web"], credentials: "ready", acceptsBuildArtifact: false, previewDestination: "preview.aohys.com", productionDestination: "aohys.com" }],
    results: { git: "passed", providers: {} },
  });

  assert.equal(plan.outcome.git, "passed");
  assert.equal(plan.outcome.preview, "unproven");
  assert.equal(plan.outcome.production, "unproven");
  assert.equal(plan.outcome.smoke, "unproven");
  assert.equal(plan.rollback.status, "unproven");
});

test("preview and production require exact revision, destination, provider evidence, and successful smoke", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["web"],
    providers: [{ id: "cloudflare", type: "cloudflare", surfaces: ["web"], credentials: "ready", acceptsBuildArtifact: false, previewDestination: "preview.aohys.com", productionDestination: "aohys.com" }],
    results: {
      git: "passed",
      providers: {
        cloudflare: {
          preview: { revision, destination: "preview.aohys.com", providerEvidence: true },
          production: { revision, destination: "aohys.com", providerEvidence: true },
          smoke: { revision, destination: "aohys.com", providerEvidence: true, ok: true },
        },
        unrelated: { production: { revision: "b".repeat(40), providerEvidence: false } },
      },
    },
    rollback: { handle: "revert:aohys", revision },
  });

  assert.deepEqual(plan.outcome, { git: "passed", preview: "proven", production: "proven", smoke: "proven" });
  assert.equal(plan.rollback.status, "proven");
});

test("provider evidence for a different configured destination never proves delivery", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["web"],
    providers: [{ id: "cloudflare", type: "cloudflare", surfaces: ["web"], credentials: "ready", acceptsBuildArtifact: false, previewDestination: "preview.aohys.com", productionDestination: "aohys.com" }],
    results: {
      providers: {
        cloudflare: {
          preview: { revision, destination: "wrong-preview.example", providerEvidence: true },
          production: { revision, destination: "wrong.example", providerEvidence: true },
          smoke: { revision, destination: "wrong.example", providerEvidence: true, ok: true },
        },
      },
    },
  });

  assert.deepEqual(plan.outcome, { git: "unproven", preview: "unproven", production: "unproven", smoke: "unproven" });
});

test("a generic provider destination cannot prove either preview or production", () => {
  const plan = planReleaseTrain({
    revision,
    changedSurfaces: ["web"],
    providers: [{ id: "cloudflare", type: "cloudflare", surfaces: ["web"], credentials: "ready", acceptsBuildArtifact: false, destination: "aohys.com" }],
    results: {
      providers: {
        cloudflare: {
          preview: { revision, destination: "aohys.com", providerEvidence: true },
          production: { revision, destination: "aohys.com", providerEvidence: true },
          smoke: { revision, destination: "aohys.com", providerEvidence: true, ok: true },
        },
      },
    },
  });

  assert.deepEqual(plan.outcome, { git: "unproven", preview: "unproven", production: "unproven", smoke: "unproven" });
  assert.deepEqual(plan.providers[0].destinations, { preview: null, production: null });
});

test("missing or duplicate provider ids fail closed before release evidence is evaluated", () => {
  const duplicate = planReleaseTrain({
    revision,
    changedSurfaces: ["web"],
    providers: [
      { id: "same", type: "cloudflare", surfaces: ["web"], credentials: "ready", previewDestination: "preview-one.example", productionDestination: "one.example" },
      { id: "same", type: "convex", surfaces: ["web"], credentials: "ready", previewDestination: "preview-two.example", productionDestination: "two.example" },
    ],
    results: { providers: { same: {
      preview: { revision, destination: "preview-two.example", providerEvidence: true },
      production: { revision, destination: "two.example", providerEvidence: true },
      smoke: { revision, destination: "two.example", providerEvidence: true, ok: true },
    } } },
  });
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join("\n"), /provider id must be unique/);
  assert.deepEqual(duplicate.outcome, { git: "unproven", preview: "unproven", production: "unproven", smoke: "unproven" });

  const missing = planReleaseTrain({
    revision,
    changedSurfaces: ["web"],
    providers: [{ type: "cloudflare", surfaces: ["web"], credentials: "ready", previewDestination: "preview.example", productionDestination: "example.com" }],
  });
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join("\n"), /non-empty unique id/);
});

test("a repository with no deploy contract reports an explicit code-only skip", () => {
  const plan = planReleaseTrain({ revision, changedSurfaces: ["docs"], checkRegistry: [], providers: [] });
  assert.equal(plan.providers.length, 0);
  assert.equal(plan.phases.find((phase) => phase.id === "preview").status, "skipped");
  assert.equal(plan.phases.find((phase) => phase.id === "preview").reason, "no-deploy-contract");
});
