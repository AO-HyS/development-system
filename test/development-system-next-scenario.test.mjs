import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { routeDefinition } from "../src/definition-router.mjs";
import { planParallelWork } from "../src/parallel-work.mjs";
import { selectApplicableQualityChecks } from "../src/stack-quality-profiles.mjs";
import { auditConvexGuardian } from "../src/convex-guardian.mjs";
import { planReleaseTrain } from "../src/release-train-v2.mjs";
import { auditPostHogObservability } from "../src/posthog-observability.mjs";
import { buildLinearHygienePlan } from "../src/linear-hygiene.mjs";
import { buildDevelopmentStewardReview, primaryRepositoryAllowlist } from "../src/development-steward.mjs";
import { buildCheckIn } from "../src/check-in.mjs";
import { buildDevelopmentRun } from "../src/development-run.mjs";
import { executeLifecycleOperation, runLifecycleRequest } from "../src/lifecycle.mjs";

const revision = "a".repeat(40);
const agent = { role: "implementer", harness: "codex", resolvedModel: "gpt-5.6-sol", reasoning: "high" };

function ticket(id, surfaces, dependencies = []) {
  return { id, surfaces, dependencies, status: "pending", acceptance: `${id} works`, checks: [`test:${id}`], stopCondition: `${id} proven`, branch: `codex/${id}`, worktree: `/tmp/${id}`, agent };
}

test("Development System Next composes definition, execution, quality, release, reports, and timing without side effects", () => {
  const normalRoute = routeDefinition({ productGrill: "approved", customerStory: "approved", technicalGrill: "approved" });
  const simpleRoute = routeDefinition({
    request: "Solo implementa esta cosa pequeña",
    quickEvidence: { behaviorSettled: true, scopeNarrow: true, rollbackEasy: true, singleSurface: true },
  });
  assert.equal(normalRoute.currentStage, "working-backwards-contracts");
  assert.equal(simpleRoute.currentStage, "simple-implementation");
  assert.equal(normalRoute.implementationAuthorized, false);

  const parallel = planParallelWork({
    explicitlyInvoked: true,
    repository: { identity: "AO-HyS/development-system", revision },
    tickets: [ticket("DSN-01", ["src/definition"]), ticket("DSN-02", ["src/reader"]), ticket("DSN-03", ["src/release"], ["DSN-01"])],
    integration: { baseRevision: revision, currentRevision: revision, conflicts: [] },
  });
  assert.deepEqual(parallel.frontier, ["DSN-01", "DSN-02"]);
  assert.equal(parallel.delivery.pullRequestCount, 1);

  const quality = selectApplicableQualityChecks({
    capabilities: ["react", "convex", "cloudflare"],
    changedSurfaces: [{ id: "apps/web", capabilities: ["react"] }, { id: "convex", capabilities: ["convex"] }],
  });
  assert.equal(quality.valid, true);
  assert.equal(quality.checks.some((check) => check.oracle === "provider-checks"), false);

  const convex = auditConvexGuardian({
    repository: "AO-HyS/development-system",
    functions: [], subscriptions: [], writes: [], dataOperations: [], componentCandidates: [], storage: [],
  });
  assert.equal(convex.valid, true);
  assert.equal(convex.readOnly, true);

  const release = planReleaseTrain({
    revision,
    changedSurfaces: ["apps/web", "convex"],
    quality: { capabilities: ["react", "convex"], changedSurfaces: [{ id: "apps/web", capabilities: ["react"] }, { id: "convex", capabilities: ["convex"] }] },
    providers: [
      { id: "cloudflare", type: "cloudflare", surfaces: ["apps/web"], credentials: "ready", acceptsBuildArtifact: true, destination: "preview.example.pages.dev" },
      { id: "convex", type: "convex", surfaces: ["convex"], credentials: "missing", acceptsBuildArtifact: false, destination: "dev:example" },
    ],
    buildArtifact: { id: "web-build", revision, hash: `sha256:${"b".repeat(64)}` },
  });
  assert.equal(release.providers.find((provider) => provider.id === "cloudflare").status, "planned");
  assert.equal(release.providers.find((provider) => provider.id === "convex").status, "blocked-credentials");
  assert.equal(release.outcome.production, "unproven");

  const linear = buildLinearHygienePlan({ now: "2026-08-14T12:00:00.000Z", issues: [], evidence: [] });
  assert.equal(linear.valid, true);
  assert.equal(linear.readOnly, true);

  const observability = auditPostHogObservability({
    repository: "AO-HyS/development-system",
    now: "2026-08-14T12:00:00.000Z",
    policy: { productionEnvironments: ["production"], canonicalHosts: ["example.com"], conversionEvents: [], requiredWebVitals: ["LCP", "INP", "CLS"], minimumEligibleEvents: 1, parityCapabilities: [] },
    instrumentation: { enabledEnvironments: ["production"], canonicalHosts: ["example.com"], identity: { anonymous: true, authenticated: true }, conversionEvents: [], exceptionCapture: true, release: "release-1", sourceMaps: [{ release: "release-1", status: "uploaded" }], webVitals: ["LCP", "INP", "CLS"], replay: { enabled: false } },
    observations: [{ id: "page", kind: "event", event: "pageview", environment: "production", host: "example.com", release: "release-1", actorType: "human" }],
    alertRoutes: [], errors: [], legacyProviders: [],
  });
  assert.equal(observability.valid, true);
  assert.deepEqual(observability.externalSideEffects, []);

  const steward = buildDevelopmentStewardReview({
    observedAt: "2026-08-14T12:00:00.000Z",
    repositories: primaryRepositoryAllowlist.map((repository) => ({
      id: repository.id,
      revision,
      status: "healthy",
      upstream: [],
      evaluations: repository.id === "aohys" ? [{ id: "preview-ready", area: "release-train", state: "action-needed", summary: "Review the current preview.", device: "mobile" }] : [],
    })),
  });
  const checkIn = buildCheckIn({ request: "Ya llegué, estoy en el celular", now: "2026-08-14T12:00:00.000Z", evidence: steward.checkInEvidence });
  assert.equal(steward.valid, true);
  assert.equal(checkIn.actions.length, 1);
  assert.equal(checkIn.actions[0].capability, "mobile");

  const run = buildDevelopmentRun({
    runId: "dsn-scenario",
    objectiveId: "development-system-next",
    route: "parallel-work",
    tickets: ["DSN-01", "DSN-02"],
    repository: { identity: "AO-HyS/development-system", revision },
    harness: "codex",
    model: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "high" },
    events: [
      { id: "implementation", phase: "implementation", kind: "start", monotonicMs: 0 },
      { id: "implementation", phase: "implementation", kind: "end", monotonicMs: 120_000 },
      { id: "functional", phase: "checks", kind: "functional-evidence", monotonicMs: 120_000 },
    ],
  });
  assert.equal(run.speed.functionalEvidence.status, "met");

  for (const result of [normalRoute, simpleRoute, parallel, quality, convex, release, linear, observability, steward, checkIn, run]) {
    assert.deepEqual(result.externalSideEffects, []);
  }
});

test("the integrated CLI and lifecycle gate stay inside isolated HOME and repository boundaries", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "development-system-next-home-"));
  const repository = await mkdtemp(resolve(tmpdir(), "development-system-next-repo-"));
  const sentinelPath = resolve(repository, "sentinel.txt");
  const inputPath = resolve(repository, "definition.json");
  await writeFile(sentinelPath, "unchanged\n", "utf8");
  await writeFile(inputPath, JSON.stringify({
    request: "Solo implementa esta cosa pequeña",
    quickEvidence: { behaviorSettled: true, scopeNarrow: true, rollbackEasy: true, singleSurface: true },
  }), "utf8");
  const beforeSentinel = await readFile(sentinelPath, "utf8");

  const denied = await executeLifecycleOperation({ home, workflowId: "DSN-GATE", operation: "implement" });
  assert.equal(denied.ok, false);
  assert.equal(denied.execution.status, "denied");
  assert.deepEqual(denied.externalSideEffects, []);
  await assert.rejects(access(resolve(home, ".development-system", "lifecycles", "DSN-GATE.json")));

  const recommendation = await runLifecycleRequest({
    home,
    workflowId: "DSN-GATE",
    mode: "recommend",
    request: "Quiero una funcionalidad pequeña y reversible",
  });
  assert.equal(recommendation.ok, true);
  assert.deepEqual(recommendation.externalSideEffects, []);
  await assert.rejects(access(resolve(home, ".development-system", "lifecycles", "DSN-GATE.json")));

  const cli = spawnSync(process.execPath, [
    resolve(import.meta.dirname, "../bin/development-system.mjs"),
    "definition-route",
    "--input",
    inputPath,
    "--json",
  ], {
    cwd: repository,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.equal(cli.status, 0, cli.stderr);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.currentStage, "simple-implementation");
  assert.equal(result.implementationAuthorized, false);
  assert.deepEqual(result.externalSideEffects, []);
  assert.equal(await readFile(sentinelPath, "utf8"), beforeSentinel);
  assert.equal(await readFile(inputPath, "utf8"), JSON.stringify({
    request: "Solo implementa esta cosa pequeña",
    quickEvidence: { behaviorSettled: true, scopeNarrow: true, rollbackEasy: true, singleSurface: true },
  }));
});
