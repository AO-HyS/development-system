import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildDevelopmentStewardReview,
  getDevelopmentStewardSchedule,
  primaryRepositoryAllowlist,
} from "../src/development-steward.mjs";

const repositories = primaryRepositoryAllowlist.map((repository) => ({
  id: repository.id,
  revision: "a".repeat(40),
  status: "healthy",
  evaluations: [],
  upstream: [],
}));

test("the weekly headless schedule is bounded to exactly the five primary repositories", () => {
  const schedule = getDevelopmentStewardSchedule();
  assert.equal(schedule.cadence, "weekly");
  assert.equal(schedule.runner, "macos-launchd-codex-exec");
  assert.deepEqual(schedule.localTime, { weekday: "monday", hour: 9, minute: 0 });
  assert.equal(schedule.sessionRequired, false);
  assert.deepEqual(schedule.repositoryIds, ["aohys", "casa-roca", "the-barber-central", "nutri-plan", "eteria"]);
  assert.deepEqual(schedule.repositoryIds, primaryRepositoryAllowlist.map((repository) => repository.id));
});

test("unknown repositories fail closed and never silently expand the allowlist", () => {
  const review = buildDevelopmentStewardReview({
    observedAt: "2026-08-14T12:00:00.000Z",
    repositories: [...repositories, { id: "todo", revision: "b".repeat(40), status: "healthy", evaluations: [], upstream: [] }],
  });
  assert.equal(review.valid, false);
  assert.match(review.errors.join("\n"), /not allowlisted: todo/);
  assert.equal(review.repositories.some((repository) => repository.id === "todo"), false);
});

test("upstream recommendations require a pinned diff and changelog; stars never prove adoption", () => {
  const review = buildDevelopmentStewardReview({
    observedAt: "2026-08-14T12:00:00.000Z",
    repositories: repositories.map((repository) => repository.id === "aohys" ? {
      ...repository,
      upstream: [
        { id: "shadcn", current: "2.0.0", candidate: "2.1.0", stars: 100_000 },
        { id: "convex", current: "1.20.0", candidate: "1.21.0", diff: "validators changed", changelog: "https://example.test/convex-1.21" },
      ],
    } : repository),
  });
  const aohys = review.repositories.find((repository) => repository.id === "aohys");
  assert.equal(aohys.upstream.find((item) => item.id === "shadcn").status, "unproven");
  assert.equal(aohys.upstream.find((item) => item.id === "convex").status, "reviewable");
  assert.equal(review.report.items.some((item) => item.title.includes("review convex")), true);
  assert.equal(review.checkInEvidence.some((item) => item.action.title.includes("review convex")), true);
});

test("missing or invalid repository revision is reported as unproven rather than healthy", () => {
  const review = buildDevelopmentStewardReview({
    observedAt: "2026-08-14T12:00:00.000Z",
    repositories: repositories.map((repository) => repository.id === "aohys" ? { ...repository, revision: null } : repository),
  });

  const aohys = review.repositories.find((repository) => repository.id === "aohys");
  assert.equal(aohys.status, "unproven");
  assert.equal(aohys.error, "repository-revision-unproven");
  assert.equal(review.report.items.some((item) => item.title === "AO HyS: evidence unproven"), true);
});

test("one repository failure remains local and a safe deterministic update becomes draft-only", () => {
  const review = buildDevelopmentStewardReview({
    observedAt: "2026-08-14T12:00:00.000Z",
    repositories: repositories.map((repository) => {
      if (repository.id === "nutri-plan") return { ...repository, status: "blocked", error: "provider unavailable" };
      if (repository.id === "eteria") return {
        ...repository,
        evaluations: [{ id: "expo", area: "expo-mobile", state: "action-needed", summary: "Pinned runtime is behind the reviewed candidate.", deterministic: true, safeUpdate: true, focusedChecks: ["pnpm ios:verify"] }],
      };
      return repository;
    }),
  });

  assert.equal(review.valid, true);
  assert.equal(review.repositories.find((repository) => repository.id === "nutri-plan").status, "blocked-local");
  assert.equal(review.repositories.find((repository) => repository.id === "aohys").status, "healthy");
  assert.deepEqual(review.draftChanges, [{
    repositoryId: "eteria",
    evaluationId: "expo",
    action: "prepare-branch-and-draft-pr",
    focusedChecks: ["pnpm ios:verify"],
    autoMerge: false,
    releaseAuthorized: false,
    productionAuthorized: false,
  }]);
  assert.deepEqual(review.externalWriteIntents, []);
  assert.deepEqual(review.externalSideEffects, []);
});

test("the private report is concise, device-classified, and consumable by Check-in", () => {
  const review = buildDevelopmentStewardReview({
    observedAt: "2026-08-14T12:00:00.000Z",
    repositories: repositories.map((repository) => repository.id === "casa-roca" ? {
      ...repository,
      evaluations: [{ id: "react-drift", area: "react", state: "action-needed", summary: "Review stale composition pattern.", deterministic: false, safeUpdate: false, device: "computer" }],
    } : repository),
  });

  assert.equal(review.report.visibility, "private-home");
  assert.equal(review.report.items.length <= 5, true);
  assert.equal(review.report.items[0].device, "computer");
  assert.equal(review.checkInEvidence[0].source, "repository");
  assert.equal(review.checkInEvidence[0].action.capability, "computer");
});

test("the installable skill preserves upstream, no-auto-merge, and reporting boundaries", async () => {
  const root = resolve(import.meta.dirname, "../artifacts/1.5.0/skills/internal/development-steward");
  const [skill, metadata] = await Promise.all([
    readFile(resolve(root, "SKILL.md"), "utf8"),
    readFile(resolve(root, "agents/openai.yaml"), "utf8"),
  ]);
  assert.match(skill, /diff and changelog/i);
  assert.match(skill, /never.*auto-merge/is);
  assert.match(skill, /AO HyS.*Casa Roca.*The Barber Central.*NutriPlan.*ETERIA/is);
  assert.match(metadata, /display_name: "Development Steward"/);
});
