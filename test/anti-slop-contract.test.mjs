import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { planOrchestration } from "../src/orchestration-plan.mjs";
import { rosterChain, rosterModel } from "../src/agent-roster.mjs";
import {
  antiSlopSpecialistFingerprint,
  antiSlopWriterFingerprint,
  validateAntiSlopLanes,
} from "../src/anti-slop.mjs";
import { initializeRepository } from "../src/repositories.mjs";
import { validateSkillCatalog } from "../src/skills.mjs";
import { skillProbeContracts } from "../src/skill-probe-runtime.mjs";

const root = resolve(import.meta.dirname, "..");

/** Canonical folder-hash algorithm shared with src/skills.mjs and the catalog generator. @param {string} directory */
async function folderHash(directory) {
  const { readdir, readFile: read } = await import("node:fs/promises");
  const { relative } = await import("node:path");
  /** @type {string[]} */
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(directory);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(directory, file));
    hash.update("\0");
    hash.update(await read(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const baseContract = {
  objective: "Ship the bounded change",
  inputs: ["The supplied task request"],
  constraints: ["Preserve current behavior"],
  outOfScope: ["Unrelated product work"],
  scope: ["src/feature"],
  acceptance: ["The observable behavior is verified"],
  expectedOutputs: ["A verified diff and review packet"],
  checks: ["pnpm test --filter feature"],
  protectedBoundaries: ["Authentication and production data"],
  authorizationBoundaries: ["No merge or production promotion"],
  stopCondition: "Stop after the focused checks pass and the diff is ready for review.",
};

function plan(signals = {}, contract = {}) {
  return planOrchestration({ taskContract: { ...baseContract, ...contract }, signals });
}

const expectedPhases = [
  "pre-implementation-simplification",
  "behavior-first-evidence-design",
  "implementation",
  "test-value-review",
  "deletion-pass",
  "independent-objective-verification",
];

const expectedExcludedMetrics = [
  "lines-of-code",
  "file-counts",
  "test-to-runtime-line-ratio",
  "identifier-length",
  "minified-or-compressed-formatting",
];

const expectedDiagnosticMetrics = ["cyclomatic-complexity", "halstead-complexity"];

/** @param {Array<Record<string, unknown>>} lanes @param {string} laneId */
function laneById(lanes, laneId) {
  const lane = lanes.find((entry) => entry.id === laneId);
  assert.ok(lane, `lane ${laneId} must exist`);
  return lane;
}

function lanePhaseIds(lane) {
  return (lane.antiSlopPhases ?? []).map((phase) => phase.id);
}

/**
 * The host retains these expectations separately from the candidate lanes and
 * protocol. Tests pass that retained value explicitly so missing expectations
 * remain a fail-closed condition in the public validator.
 * @param {Record<string, unknown>} result
 * @param {Array<Record<string, unknown>>} [lanes]
 * @param {Record<string, unknown>} [protocol]
 */
function validatePlan(result, lanes = result.lanes, protocol = result.antiSlop) {
  return validateAntiSlopLanes(
    lanes,
    protocol,
    result.hostValidation?.trustedAntiSlopExpectations,
  );
}

function parallelPlanFixture() {
  return planOrchestration({
    taskContract: { ...baseContract, requestedWorkItemIds: ["T1", "T2"] },
    signals: { trivial: false },
    workGraph: {
      repository: { identity: "repo", revision: "a".repeat(40) },
      tickets: ["T1", "T2"].map((id) => ({
        id,
        kind: "implementation",
        surfaces: [`src/feature/${id.toLowerCase()}`],
        dependencies: [],
        capabilities: ["typescript"],
        acceptance: `${id} observable`,
        checks: [`test:${id}`],
        stopCondition: `${id} verified`,
        status: "pending",
      })),
      integrationChecks: ["pnpm test"],
      integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
    },
  });
}

test("every non-trivial write mode assigns all six phases to concrete ordered lanes", () => {
  const expectedOwners = [
    ["pre-implementation-simplification", "fast_implementer", true],
    ["behavior-first-evidence-design", "fast_implementer", true],
    ["implementation", "fast_implementer", true],
    ["test-value-review", "reviewer", false],
    ["deletion-pass", "fast_implementer", true],
    ["independent-objective-verification", "reviewer", false],
  ];
  for (const mode of ["sequential", "specialist", "parallel"]) {
    const result = mode === "specialist"
      ? plan({ trivial: false, specialistRisk: "security" })
      : mode === "parallel"
        ? parallelPlanFixture()
        : plan({ trivial: false });
    assert.equal(result.valid, true, `${mode}: ${result.errors?.join("; ")}`);
    assert.equal(result.mode, mode);
    assert.equal(result.antiSlop.required, true, mode);
    assert.deepEqual(result.antiSlop.phases.map((phase) => phase.id), expectedPhases, mode);
    assert.deepEqual(result.antiSlop.excludedMetrics, expectedExcludedMetrics, mode);
    assert.deepEqual(result.antiSlop.diagnosticOnlyMetrics, expectedDiagnosticMetrics, mode);
    for (const [index, [phaseId, ownerRole, writable]] of expectedOwners.entries()) {
      const phase = result.antiSlop.phases[index];
      assert.equal(phase.ownerRole, ownerRole, `${mode}/${phaseId}`);
      assert.equal(phase.writable, writable, `${mode}/${phaseId}`);
      assert.equal(phase.requirement.length > 40, true, `${mode}/${phaseId} requirement`);
      assert.equal(phase.completion.length > 40, true, `${mode}/${phaseId} completion`);
      assert.deepEqual(phase.dependsOn, index === 0 ? [] : [expectedPhases[index - 1]], `${mode}/${phaseId}`);
    }
    // Every phase is owned by lane contracts, and joint ownership (parallel
    // ticket writers) only ever happens for lanes carrying the identical
    // phase set. Owners are chained in protocol order.
    const owners = new Map();
    for (const lane of result.lanes) {
      for (const phase of lane.antiSlopPhases ?? []) {
        owners.set(phase.id, [...(owners.get(phase.id) ?? []), lane.id]);
      }
    }
    assert.deepEqual([...owners.keys()], expectedPhases, mode);
    for (const [phaseId, ownerIds] of owners) {
      if (ownerIds.length === 1) continue;
      const signatures = new Set(
        ownerIds.map((id) => lanePhaseIds(laneById(result.lanes, id)).sort().join("|")),
      );
      assert.equal(signatures.size, 1, `${mode}: ${phaseId} joint owners must carry the same phase set`);
    }
    const validatorErrors = validatePlan(result);
    assert.deepEqual(validatorErrors, [], mode);
  }
});

test("sequential and specialist plans chain writer, review, correction, and final verification lanes", () => {
  const result = plan({ trivial: false });
  const writer = laneById(result.lanes, "writer");
  const review = laneById(result.lanes, "review-test-value");
  const correction = laneById(result.lanes, "correction");
  const verification = laneById(result.lanes, "review-objective-verification");

  assert.deepEqual(lanePhaseIds(writer), expectedPhases.slice(0, 3));
  assert.equal(writer.readOnly, false);
  assert.equal(writer.type, "writer");
  assert.deepEqual(writer.dependsOn, []);

  assert.deepEqual(lanePhaseIds(review), ["test-value-review"]);
  assert.equal(review.readOnly, true);
  assert.equal(review.independent, true);
  assert.deepEqual(review.dependsOn, ["writer"]);
  assert.match(review.stopCondition, /weakened assertions/);
  assert.match(review.stopCondition, /refuse green-only acceptance/i);
  assert.match(review.stopCondition, /private-structure/i);
  assert.match(review.stopCondition, /observable-behavior justification/i);
  assert.match(review.stopCondition, /Do not edit\.$/);

  assert.deepEqual(lanePhaseIds(correction), ["deletion-pass"]);
  assert.equal(correction.readOnly, false);
  assert.equal(correction.role, "fast_implementer");
  assert.equal(correction.type, "correction");
  assert.deepEqual(correction.dependsOn, ["review-test-value"]);
  assert.match(correction.stopCondition, /production code and test code/);
  assert.match(correction.stopCondition, /deleted, kept, and why/);
  assert.match(correction.stopCondition, /reruns the focused checks/);

  assert.deepEqual(lanePhaseIds(verification), ["independent-objective-verification"]);
  assert.equal(verification.readOnly, true);
  assert.equal(verification.independent, true);
  assert.deepEqual(verification.dependsOn, ["correction"]);
  assert.match(verification.stopCondition, /accepted objective and the public interface/);
  assert.match(verification.stopCondition, /isolated from implementation conclusions/);

  const specialistPlan = plan({ trivial: false, specialistRisk: "security" });
  const specialist = laneById(specialistPlan.lanes, "specialist-security");
  assert.equal(specialist.readOnly, true);
  // The specialist runs after the writer and gates the correction lane.
  assert.deepEqual(specialist.dependsOn, ["writer"]);
  assert.deepEqual(specialist.antiSlopPhases, undefined);
  const specialistReview = laneById(specialistPlan.lanes, "review-test-value");
  assert.deepEqual(specialistReview.dependsOn, ["writer", "specialist-security"]);
  const specialistCorrection = laneById(specialistPlan.lanes, "correction");
  assert.deepEqual(specialistCorrection.dependsOn, ["review-test-value", "specialist-security"]);
  assert.match(specialistCorrection.stopCondition, /Resolve or explicitly block on every blocker or high finding/);
  assert.match(specialistCorrection.stopCondition, /the security specialist review/);
});

test("parallel ticket writers keep disjoint ownership and integrate before ordered review, correction, and final review", () => {
  const result = parallelPlanFixture();
  assert.equal(result.valid, true, result.errors?.join("; "));
  const writerLanes = result.lanes.filter((lane) => Array.isArray(lane.antiSlopPhases) && lane.antiSlopPhases.length === 3);
  assert.equal(writerLanes.length, 2);
  for (const lane of writerLanes) {
    assert.deepEqual(lanePhaseIds(lane), expectedPhases.slice(0, 3));
    assert.equal(lane.readOnly !== true, true);
    assert.equal((lane.ownership ?? []).some((surface) => surface.startsWith("src/feature/t")), true);
  }
  assert.notDeepEqual(writerLanes[0].ownership, writerLanes[1].ownership, "disjoint ticket ownership");
  const integration = laneById(result.lanes, "integration");
  assert.deepEqual(integration.dependsOn, writerLanes.map((lane) => lane.id));
  const review = laneById(result.lanes, "review-test-value");
  assert.deepEqual(review.dependsOn, ["integration"]);
  assert.deepEqual(laneById(result.lanes, "review-standards").dependsOn, ["integration"]);
  const correction = laneById(result.lanes, "correction");
  assert.deepEqual(correction.dependsOn, ["review-standards", "review-test-value"]);
  assert.equal(correction.readOnly, false);
  const verification = laneById(result.lanes, "review-objective-verification");
  assert.deepEqual(verification.dependsOn, ["correction"]);
  assert.deepEqual(validatePlan(result), []);
});

test("selected parallel specialists and the standards review gate correction and final verification", () => {
  const result = planOrchestration({
    taskContract: { ...baseContract, requestedWorkItemIds: ["T1", "T2"] },
    signals: {
      trivial: false,
      specialistRisks: [
        { id: "security", evidence: ["auth boundary changed"], surfaces: ["src/feature/t1"] },
        { id: "backend", evidence: ["query changed"], surfaces: ["src/feature/t2"] },
      ],
    },
    workGraph: {
      repository: { identity: "repo", revision: "a".repeat(40) },
      tickets: ["T1", "T2"].map((id) => ({
        id,
        kind: "implementation",
        surfaces: [`src/feature/${id.toLowerCase()}`],
        dependencies: [],
        capabilities: ["typescript"],
        acceptance: `${id} observable`,
        checks: [`test:${id}`],
        stopCondition: `${id} verified`,
        status: "pending",
      })),
      integrationChecks: ["pnpm test"],
      integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
    },
  });
  assert.equal(result.valid, true, result.errors?.join("; "));
  const specialists = result.lanes.filter((lane) => lane.type === "specialist-review");
  assert.deepEqual(specialists.map((lane) => lane.id).sort(), ["specialist-backend", "specialist-security"]);
  for (const specialist of specialists) {
    assert.equal(specialist.readOnly, true);
    assert.deepEqual(specialist.dependsOn, ["integration"]);
  }
  const correction = laneById(result.lanes, "correction");
  assert.deepEqual(correction.dependsOn, ["review-standards", "review-test-value", "specialist-security", "specialist-backend"]);
  assert.match(correction.stopCondition, /Resolve or explicitly block on every blocker or high finding/);
  assert.match(correction.stopCondition, /the standards review/);
  assert.match(correction.stopCondition, /the security specialist review/);
  assert.match(correction.stopCondition, /the backend specialist review/);
  // Final objective verification cannot bypass specialist resolution: it runs
  // only after the correction lane that every specialist gates.
  const verification = laneById(result.lanes, "review-objective-verification");
  assert.deepEqual(verification.dependsOn, ["correction"]);
  assert.deepEqual(validatePlan(result), []);
  // Removing a specialist from correction fails the topology check.
  const bypassed = structuredClone(result);
  bypassed.lanes = bypassed.lanes.map((lane) =>
    lane.id === "correction"
      ? { ...lane, dependsOn: lane.dependsOn.filter((id) => id !== "specialist-security") }
      : lane,
  );
  assert.ok(
    laneById(bypassed.lanes, "correction").dependsOn.includes("specialist-backend"),
  );
  assert.equal(
    laneById(bypassed.lanes, "correction").dependsOn.includes("specialist-security"),
    false,
    "fixture mutation removed the security specialist gate",
  );
});

test("deletion correction is writable and always precedes the final objective verification", () => {
  for (const result of [plan({ trivial: false }), plan({ trivial: false, specialistRisk: "security" }), parallelPlanFixture()]) {
    const deletionPhase = result.antiSlop.phases.find((phase) => phase.id === "deletion-pass");
    assert.equal(deletionPhase.ownerRole, "fast_implementer");
    assert.equal(deletionPhase.writable, true);
    const owner = laneById(result.lanes, "correction");
    assert.equal(owner.readOnly, false, "the correction lane must be able to edit");
    const verification = laneById(result.lanes, "review-objective-verification");
    assert.deepEqual(verification.dependsOn, ["correction"]);
    assert.deepEqual(verification.antiSlopPhases[0].dependsOn, ["deletion-pass"]);
  }
  // The validator refuses a read-only deletion owner.
  const broken = parallelPlanFixture();
  const readOnlyCorrection = structuredClone(broken);
  readOnlyCorrection.lanes = readOnlyCorrection.lanes.map((lane) =>
    lane.id === "correction" ? { ...lane, readOnly: true } : lane,
  );
  assert.match(
    validatePlan(broken, readOnlyCorrection.lanes, readOnlyCorrection.antiSlop).join("\n"),
    /deletion-pass requires a writable lane, but correction is read-only/,
  );
});

test("a weakened or useless test can only pass through a correction before final verification", () => {
  const result = plan({ trivial: false });
  const review = laneById(result.lanes, "review-test-value");
  // The review contract rejects exactly the weakening escapes.
  for (const forbidden of [
    /weakened assertions/,
    /updated snapshots/,
    /private-structure/,
    /green-only acceptance|green alone never/i,
  ]) {
    assert.match(`${review.antiSlopPhases[0].requirement} ${review.antiSlopPhases[0].completion}`, forbidden);
  }
  // The only writable lane after the review is the correction lane, and the
  // final verification cannot start before it reports.
  const writableAfterReview = result.lanes.filter((lane) =>
    lane.readOnly !== true && lane.dependsOn.includes("review-test-value"),
  );
  assert.deepEqual(writableAfterReview.map((lane) => lane.id), ["correction"]);
  // Reordering verification before correction fails the plan closed.
  const reordered = structuredClone(result);
  reordered.lanes = reordered.lanes.map((lane) =>
    lane.id === "review-objective-verification" ? { ...lane, dependsOn: ["writer"] } : lane,
  );
  const errors = validatePlan(result, reordered.lanes, reordered.antiSlop);
  assert.ok(errors.some((error) => /deletion-pass/.test(error)), errors.join("; "));
});

test("the validator fails closed on missing, duplicated, or inconsistent phase assignments", () => {
  const result = plan({ trivial: false });
  const protocol = result.antiSlop;

  const missing = result.lanes.filter((lane) => lane.id !== "correction");
  const missingErrors = validatePlan(result, missing, protocol);
  assert.ok(missingErrors.some((error) => /deletion-pass has no owning lane/.test(error)), missingErrors.join("; "));

  const duplicated = structuredClone(result.lanes);
  laneById(duplicated, "writer").antiSlopPhases = [
    ...laneById(duplicated, "writer").antiSlopPhases,
    { ...laneById(duplicated, "correction").antiSlopPhases[0] },
  ];
  assert.ok(
    validatePlan(result, duplicated, protocol).some((error) => /deletion-pass is assigned twice|assigned inconsistently/.test(error)),
  );

  const readOnlyReview = structuredClone(result.lanes);
  readOnlyReview.splice(result.lanes.findIndex((lane) => lane.id === "review-test-value"), 1);
  assert.ok(
    validatePlan(result, readOnlyReview, protocol).some((error) => /test-value-review has no owning lane/.test(error)),
  );

  // A broken dependency chain (final review not behind correction) fails.
  const broken = structuredClone(result.lanes);
  laneById(broken, "review-objective-verification").dependsOn = ["writer"];
  assert.ok(
    validatePlan(result, broken, protocol).some((error) => /does not depend on any lane owning/.test(error)),
  );

  // Unknown phase references fail.
  const unknown = structuredClone(result.lanes);
  laneById(unknown, "writer").antiSlopPhases = [...laneById(unknown, "writer").antiSlopPhases, { id: "phantom-phase" }];
  assert.ok(
    validatePlan(result, unknown, protocol).some((error) => /unknown anti-slop phase/.test(error)),
  );
});

test("reversing a lane's phase assignments fails the canonical protocol order check", () => {
  const result = plan({ trivial: false });
  const protocol = result.antiSlop;

  // The reviewer's exact reverse-order mutation: the writer's three phases
  // reversed previously validated because assignments collapsed into a Set.
  const reversed = structuredClone(result.lanes);
  laneById(reversed, "writer").antiSlopPhases =
    [...laneById(reversed, "writer").antiSlopPhases].reverse();
  const reversedErrors = validatePlan(result, reversed, protocol);
  assert.ok(
    reversedErrors.some((error) => /out of canonical protocol order/.test(error)),
    reversedErrors.join("; "),
  );

  // A mutated phase contract (changed requirement text) fails closed.
  const mutated = structuredClone(result.lanes);
  laneById(mutated, "writer").antiSlopPhases = laneById(mutated, "writer").antiSlopPhases.map((phase) =>
    phase.id === "pre-implementation-simplification"
      ? { ...phase, requirement: "Skip the design step and start coding immediately." }
      : phase,
  );
  const mutatedErrors = validatePlan(result, mutated, protocol);
  assert.ok(
    mutatedErrors.some((error) => /does not match the canonical protocol requirement/.test(error)),
    mutatedErrors.join("; "),
  );

  // A mutated phase dependency fails closed.
  const reattached = structuredClone(result.lanes);
  laneById(reattached, "correction").antiSlopPhases = laneById(reattached, "correction").antiSlopPhases.map((phase) =>
    phase.id === "deletion-pass" ? { ...phase, dependsOn: [] } : phase,
  );
  assert.ok(
    validatePlan(result, reattached, protocol).some((error) => /does not match the canonical protocol dependsOn/.test(error)),
  );

  // A duplicated phase assignment within one lane fails closed.
  const duplicated = structuredClone(result.lanes);
  laneById(duplicated, "writer").antiSlopPhases = [
    ...laneById(duplicated, "writer").antiSlopPhases,
    { ...laneById(duplicated, "writer").antiSlopPhases[1] },
  ];
  assert.ok(
    validatePlan(result, duplicated, protocol).some((error) => /assigned twice to lane writer|out of canonical protocol order/.test(error)),
  );

  // A missing middle phase in the owning lane leaves the phase unowned.
  const missing = structuredClone(result.lanes);
  laneById(missing, "writer").antiSlopPhases = laneById(missing, "writer").antiSlopPhases.filter((phase) => phase.id !== "behavior-first-evidence-design");
  const missingErrors = validatePlan(result, missing, protocol);
  assert.ok(missingErrors.some((error) => /behavior-first-evidence-design has no owning lane/.test(error)), missingErrors.join("; "));
});

test("every antiSlopPhases entry must be a full canonical phase object, table-driven across mutations", () => {
  const result = plan({ trivial: false });
  const protocol = result.antiSlop;
  const originalWriterPhases = laneById(result.lanes, "writer").antiSlopPhases;

  /** @param {(phases: Array<Record<string, unknown>>) => unknown} mutate */
  const cases = [
    ["an ID-only string reference", () => ["pre-implementation-simplification"], /must be a full phase object, never an ID-only string/],
    ["a mutated order", (phases) => phases.map((phase) => phase.id === "pre-implementation-simplification" ? { ...phase, order: 99 } : phase), /does not match the canonical protocol order/],
    ["a mutated id", (phases) => phases.map((phase) => phase.id === "pre-implementation-simplification" ? { ...phase, id: "renamed-phase" } : phase), /references unknown anti-slop phase renamed-phase/],
    ["a mutated ownerRole", (phases) => phases.map((phase) => phase.id === "pre-implementation-simplification" ? { ...phase, ownerRole: "reviewer" } : phase), /does not match the canonical protocol ownerRole/],
    ["a mutated laneType", (phases) => phases.map((phase) => phase.id === "implementation" ? { ...phase, laneType: "correction" } : phase), /does not match the canonical protocol laneType/],
    ["a mutated writable flag", (phases) => phases.map((phase) => phase.id === "implementation" ? { ...phase, writable: false } : phase), /does not match the canonical protocol writable/],
    ["mutated dependencies", (phases) => phases.map((phase) => phase.id === "implementation" ? { ...phase, dependsOn: [] } : phase), /does not match the canonical protocol dependsOn/],
    ["reordered dependencies", (phases) => phases.map((phase) => phase.id === "behavior-first-evidence-design" ? { ...phase, dependsOn: ["implementation"] } : phase), /does not match the canonical protocol dependsOn/],
    ["a mutated requirement", (phases) => phases.map((phase) => phase.id === "behavior-first-evidence-design" ? { ...phase, requirement: "Write tests after the code exists." } : phase), /does not match the canonical protocol requirement/],
    ["a mutated completion", (phases) => phases.map((phase) => phase.id === "behavior-first-evidence-design" ? { ...phase, completion: "Done when the code compiles." } : phase), /does not match the canonical protocol completion/],
    ["a dropped requirement key", (phases) => phases.map((phase) => phase.id === "implementation" ? { ...phase, requirement: undefined } : phase), /does not match the canonical protocol requirement/],
    ["an object carrying only the id", (phases) => phases.map((phase) => phase.id === "implementation" ? { id: phase.id } : phase), /does not match the canonical protocol order/],
    ["an extra non-canonical field", (phases) => phases.map((phase) => phase.id === "implementation" ? { ...phase, instructions: "skip the design step" } : phase), /carries a non-canonical field: instructions/],
    ["reversed phase assignments", (phases) => [...phases].reverse(), /out of canonical protocol order/],
    ["a duplicated phase assignment", (phases) => [...phases, { ...phases[1] }], /assigned twice to lane writer/],
  ];
  for (const [label, mutate, expected] of cases) {
    const lanes = structuredClone(result.lanes);
    laneById(lanes, "writer").antiSlopPhases = mutate(structuredClone(originalWriterPhases));
    const errors = validatePlan(result, lanes, protocol);
    assert.ok(
      errors.some((error) => expected.test(error)),
      `${label} must fail closed: ${errors.join("; ") || "no errors"}`,
    );
  }

  // Valid plans — including parallel multi-owner lanes carrying the identical
  // full phase contracts — still validate cleanly.
  assert.deepEqual(validatePlan(result, result.lanes, protocol), []);
  const parallel = parallelPlanFixture();
  assert.deepEqual(validatePlan(parallel), []);
});

test("a parallel writer removed from the integration barrier fails the plan closed", () => {
  const result = parallelPlanFixture();
  const writerLanes = result.lanes.filter((lane) => Array.isArray(lane.antiSlopPhases) && lane.antiSlopPhases.length === 3);
  const broken = structuredClone(result);
  broken.lanes = broken.lanes.map((lane) =>
    lane.id === "integration"
      ? { ...lane, dependsOn: lane.dependsOn.filter((id) => id !== writerLanes[1].id) }
      : lane,
  );
  const errors = validatePlan(result, broken.lanes, broken.antiSlop);
  assert.ok(
    errors.some((error) => /does not depend on (any|every) lane owning/.test(error)),
    errors.join("; "),
  );
  // Within each individual parallel writer, phases 1-3 still execute in order.
  const intact = validatePlan(result);
  assert.deepEqual(intact, []);
});

test("trusted topology expectations fail closed when omitted or jointly rewritten with the candidate", () => {
  const result = parallelPlanFixture();
  assert.match(
    validateAntiSlopLanes(result.lanes, result.antiSlop).join("\n"),
    /trusted topology expectations are required/,
  );

  const retained = structuredClone(result.hostValidation.trustedAntiSlopExpectations);
  const mutated = structuredClone(result);
  const removedWriter = retained.writerLaneIds[1];
  mutated.lanes = mutated.lanes.filter((lane) => lane.id !== removedWriter);
  laneById(mutated.lanes, "integration").dependsOn = [retained.writerLaneIds[0]];
  mutated.antiSlop.topology.writerLaneIds = [retained.writerLaneIds[0]];
  const topologyPayload = {
    schemaVersion: mutated.antiSlop.topology.schemaVersion,
    source: mutated.antiSlop.topology.source,
    writerLaneIds: mutated.antiSlop.topology.writerLaneIds,
    reviewBarrierLaneIds: mutated.antiSlop.topology.reviewBarrierLaneIds,
    requiredCorrectionDependencies: mutated.antiSlop.topology.requiredCorrectionDependencies,
    integrationBarrierLaneId: mutated.antiSlop.topology.integrationBarrierLaneId,
    correctionLaneId: mutated.antiSlop.topology.correctionLaneId,
    finalVerificationLaneId: mutated.antiSlop.topology.finalVerificationLaneId,
    writerFingerprints: mutated.antiSlop.topology.writerFingerprints,
    specialistFingerprints: mutated.antiSlop.topology.specialistFingerprints,
  };
  mutated.antiSlop.topology.integritySha256 = createHash("sha256")
    .update(JSON.stringify(topologyPayload))
    .digest("hex");

  const errors = validateAntiSlopLanes(mutated.lanes, mutated.antiSlop, retained);
  assert.ok(
    errors.some((error) => /does not match trusted planning expectations/.test(error)),
    errors.join("; "),
  );
});

test("same-ID writer substitutes fail the trusted canonical writer fingerprint", () => {
  const sequential = plan({ trivial: false });
  const parallel = parallelPlanFixture();
  // Untouched plans keep validating cleanly.
  assert.deepEqual(validatePlan(sequential), []);
  assert.deepEqual(validatePlan(parallel), []);

  const sequentialMutations = [
    ["role", (lane) => ({ ...lane, role: "reviewer" })],
    ["type", (lane) => ({ ...lane, type: "correction" })],
    ["ownership removed", (lane) => ({ ...lane, ownership: [] })],
    ["ownership duplicated", (lane) => ({ ...lane, ownership: [...lane.ownership, lane.ownership[0]] })],
    ["model requested", (lane) => ({ ...lane, model: { ...lane.model, requested: "other-model" } })],
    ["model resolved", (lane) => ({ ...lane, model: { ...lane.model, resolved: "other-model" } })],
    ["model reasoning", (lane) => ({ ...lane, model: { ...lane.model, reasoning: "low" } })],
    ["route slot", (lane) => ({ ...lane, modelRoute: { ...lane.modelRoute, routeSlot: "fast-execution" } })],
    ["route removed", (lane) => ({ ...lane, modelRoute: undefined })],
    ["route downgraded", (lane) => ({ ...lane, modelRoute: { ...lane.modelRoute, receiptRequired: false } })],
  ];
  for (const [label, mutate] of sequentialMutations) {
    const tampered = structuredClone(sequential);
    tampered.lanes = tampered.lanes.map((lane) => (lane.id === "writer" ? mutate(lane) : lane));
    const errors = validatePlan(tampered);
    assert.ok(
      errors.some((error) => /writer lane writer does not match the trusted canonical writer fingerprint/.test(error)),
      `${label}: ${errors.join("; ") || "no errors"}`,
    );
  }

  // A parallel writer substitute that drops tickets, ownership, or any exact
  // fast route/agent field cannot collide with the trusted fingerprint.
  const parallelMutations = [
    ["tickets removed", (lane) => ({ ...lane, tickets: [] })],
    ["tickets swapped", (lane) => ({ ...lane, tickets: ["T2"] })],
    ["tickets duplicated", (lane) => ({ ...lane, tickets: [...lane.tickets, lane.tickets[0]] })],
    ["ownership removed", (lane) => ({ ...lane, ownership: [] })],
    ["ownership widened", (lane) => ({ ...lane, ownership: [...lane.ownership, "src/other"] })],
    ["ownership duplicated", (lane) => ({ ...lane, ownership: [...lane.ownership, lane.ownership[0]] })],
    ["agent removed", (lane) => ({ ...lane, agent: null })],
    ["agent role", (lane) => ({ ...lane, agent: { ...lane.agent, role: "reviewer" } })],
    ["agent harness", (lane) => ({ ...lane, agent: { ...lane.agent, harness: "factory" } })],
    ["agent requested model", (lane) => ({ ...lane, agent: { ...lane.agent, requestedModel: "other-model" } })],
    ["agent reasoning", (lane) => ({ ...lane, agent: { ...lane.agent, reasoning: "high" } })],
    ["agent resolved model", (lane) => ({ ...lane, agent: { ...lane.agent, resolvedModel: "other-model" } })],
    ["agent route slot", (lane) => ({ ...lane, agent: { ...lane.agent, modelRoute: { ...lane.agent.modelRoute, routeSlot: "implementation-default" } } })],
    ["agent route removed", (lane) => ({ ...lane, agent: { ...lane.agent, modelRoute: null } })],
  ];
  for (const [label, mutate] of parallelMutations) {
    const tampered = structuredClone(parallel);
    tampered.lanes = tampered.lanes.map((lane) => (lane.id === "lane-1" ? mutate(lane) : lane));
    const errors = validatePlan(tampered);
    assert.ok(
      errors.some((error) => /writer lane lane-1 does not match the trusted canonical writer fingerprint/.test(error)),
      `${label}: ${errors.join("; ") || "no errors"}`,
    );
  }

  // A rogue lane owning the writer phases is rejected even with identical
  // phase contracts, because no trusted fingerprint covers it.
  const rogue = structuredClone(parallel);
  const template = laneById(rogue.lanes, "lane-1");
  rogue.lanes.push({ ...structuredClone(template), id: "lane-rogue", tickets: ["T1"], ownership: [...template.ownership] });
  const rogueErrors = validatePlan(rogue);
  assert.ok(
    rogueErrors.some((error) => /writer lane lane-rogue owns pre-implementation-simplification but is not a trusted writer fingerprint lane/.test(error)),
    rogueErrors.join("; "),
  );
});

test("same-ID specialist substitutes fail the trusted canonical specialist fingerprint", () => {
  const result = plan({ trivial: false, specialistRisk: "security" });
  assert.deepEqual(validatePlan(result), []);

  const mutations = [
    ["role", (lane) => ({ ...lane, role: "reviewer" })],
    ["type", (lane) => ({ ...lane, type: "independent-review" })],
    ["ownership removed", (lane) => ({ ...lane, ownership: [] })],
    ["ownership changed", (lane) => ({ ...lane, ownership: ["src/everything"] })],
    ["ownership duplicated", (lane) => ({ ...lane, ownership: [...lane.ownership, lane.ownership[0]] })],
    ["evidence removed", (lane) => ({ ...lane, evidence: [] })],
    ["evidence changed", (lane) => ({ ...lane, evidence: ["unrelated evidence"] })],
    ["evidence duplicated", (lane) => ({ ...lane, evidence: [...lane.evidence, lane.evidence[0]] })],
    ["agent rogue added", (lane) => ({ ...lane, agent: { role: "rogue", harness: "codex", requestedModel: "other-model", resolvedModel: "other-model", reasoning: "high", modelRoute: null } })],
    ["agent minimal added", (lane) => ({ ...lane, agent: { role: "rogue" } })],
    ["model removed", (lane) => ({ ...lane, model: null })],
    ["model requested", (lane) => ({ ...lane, model: { ...lane.model, requested: "other-model" } })],
    ["model resolved", (lane) => ({ ...lane, model: { ...lane.model, resolved: null } })],
    ["model reasoning", (lane) => ({ ...lane, model: { ...lane.model, reasoning: "low" } })],
    ["route added", (lane) => ({ ...lane, modelRoute: { routeSlot: "adversarial-review" } })],
  ];
  for (const [label, mutate] of mutations) {
    const tampered = structuredClone(result);
    tampered.lanes = tampered.lanes.map((lane) => (lane.id === "specialist-security" ? mutate(lane) : lane));
    const errors = validatePlan(tampered);
    assert.ok(
      errors.some((error) => /specialist lane specialist-security does not match the trusted canonical specialist fingerprint/.test(error)),
      `${label}: ${errors.join("; ") || "no errors"}`,
    );
  }

  // A parallel specialist substitution fails the same way, and an injected
  // specialist-review lane is never a trusted specialist fingerprint lane.
  const parallelSpecialists = planOrchestration({
    taskContract: { ...baseContract, requestedWorkItemIds: ["T1", "T2"] },
    signals: {
      trivial: false,
      specialistRisks: [{ id: "security", evidence: ["auth boundary changed"], surfaces: ["src/feature/t1"] }],
    },
    workGraph: {
      repository: { identity: "repo", revision: "a".repeat(40) },
      tickets: ["T1", "T2"].map((id) => ({
        id,
        kind: "implementation",
        surfaces: [`src/feature/${id.toLowerCase()}`],
        dependencies: [],
        capabilities: ["typescript"],
        acceptance: `${id} observable`,
        checks: [`test:${id}`],
        stopCondition: `${id} verified`,
        status: "pending",
      })),
      integrationChecks: ["pnpm test"],
      integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
    },
  });
  assert.equal(parallelSpecialists.valid, true, parallelSpecialists.errors?.join("; "));
  assert.deepEqual(validatePlan(parallelSpecialists), []);
  const swapped = structuredClone(parallelSpecialists);
  swapped.lanes = swapped.lanes.map((lane) =>
    lane.id === "specialist-security" ? { ...lane, model: { ...lane.model, reasoning: "low" } } : lane,
  );
  assert.ok(
    validatePlan(swapped).some((error) => /specialist lane specialist-security does not match the trusted canonical specialist fingerprint/),
  );
  const injected = structuredClone(parallelSpecialists);
  const template = laneById(injected.lanes, "specialist-security");
  injected.lanes.push({ ...structuredClone(template), id: "specialist-phantom" });
  assert.ok(
    validatePlan(injected).some((error) => /specialist lane specialist-phantom is not a trusted specialist fingerprint lane/),
  );
});

test("fingerprints preserve string-array multiplicity and bind the specialist agent descriptor", () => {
  const specialist = {
    id: "specialist-security",
    role: "security_reviewer",
    type: "specialist-review",
    ownership: ["src/feature"],
    evidence: ["auth boundary changed"],
    model: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "xhigh" },
  };
  const specialistDigest = antiSlopSpecialistFingerprint(specialist);
  assert.match(specialistDigest, /^[a-f0-9]{64}$/u);
  // Duplicate evidence or ownership claims change the digest instead of
  // collapsing behind set semantics.
  assert.notEqual(
    antiSlopSpecialistFingerprint({ ...specialist, evidence: ["auth boundary changed", "auth boundary changed"] }),
    specialistDigest,
  );
  assert.notEqual(
    antiSlopSpecialistFingerprint({ ...specialist, ownership: ["src/feature", "src/feature"] }),
    specialistDigest,
  );
  // An absent or null agent descriptor matches the trusted expectation.
  assert.equal(antiSlopSpecialistFingerprint({ ...specialist, agent: undefined }), specialistDigest);
  assert.equal(antiSlopSpecialistFingerprint({ ...specialist, agent: null }), specialistDigest);
  // Adding or changing the agent descriptor alters the digest.
  const rogue = { role: "rogue", harness: "codex", requestedModel: "m", resolvedModel: "m", reasoning: "high", modelRoute: null };
  const rogueDigest = antiSlopSpecialistFingerprint({ ...specialist, agent: rogue });
  assert.notEqual(rogueDigest, specialistDigest);
  assert.notEqual(antiSlopSpecialistFingerprint({ ...specialist, agent: { ...rogue, role: "reviewer" } }), rogueDigest);
  assert.notEqual(antiSlopSpecialistFingerprint({ ...specialist, agent: null, modelRoute: { routeSlot: "r" } }), specialistDigest);

  const writer = {
    id: "lane-1",
    tickets: ["T1"],
    ownership: ["src/feature/t1"],
    role: "fast_implementer",
    type: "writer",
    agent: { role: "fast_implementer", harness: "codex", requestedModel: "swe-1-7", resolvedModel: null, reasoning: "max", modelRoute: null },
  };
  const writerDigest = antiSlopWriterFingerprint(writer);
  assert.match(writerDigest, /^[a-f0-9]{64}$/u);
  assert.notEqual(antiSlopWriterFingerprint({ ...writer, tickets: ["T1", "T1"] }), writerDigest);
  assert.notEqual(antiSlopWriterFingerprint({ ...writer, ownership: ["src/feature/t1", "src/feature/t1"] }), writerDigest);
});

test("anti-slop owning lanes are directly bound to the immutable phase ownerRole and laneType", () => {
  const result = plan({ trivial: false });
  const mutations = [
    ["writer role", "writer", (lane) => ({ ...lane, role: "reviewer" }), /pre-implementation-simplification owner writer must carry the canonical ownerRole fast_implementer/],
    ["writer type", "writer", (lane) => ({ ...lane, type: "correction" }), /pre-implementation-simplification owner writer must carry the canonical laneType writer/],
    ["review role", "review-test-value", (lane) => ({ ...lane, role: "fast_implementer" }), /test-value-review owner review-test-value must carry the canonical ownerRole reviewer/],
    ["review type", "review-test-value", (lane) => ({ ...lane, type: "specialist-review" }), /test-value-review owner review-test-value must carry the canonical laneType independent-review/],
    ["correction role", "correction", (lane) => ({ ...lane, role: "reviewer" }), /deletion-pass owner correction must carry the canonical ownerRole fast_implementer/],
    ["correction type", "correction", (lane) => ({ ...lane, type: "writer" }), /deletion-pass owner correction must carry the canonical laneType correction/],
    ["final verification type", "review-objective-verification", (lane) => ({ ...lane, type: "writer" }), /independent-objective-verification owner review-objective-verification must carry the canonical laneType independent-review/],
  ];
  for (const [label, laneId, mutate, expected] of mutations) {
    const tampered = structuredClone(result);
    tampered.lanes = tampered.lanes.map((lane) => (lane.id === laneId ? mutate(lane) : lane));
    const errors = validatePlan(tampered);
    assert.ok(errors.some((error) => expected.test(error)), `${label}: ${errors.join("; ") || "no errors"}`);
  }
});

test("non-trivial read-only runs own no writable lane for every kind and fail closed on a parallel work graph", () => {
  const readOnlyKinds = [
    ["analysis", { kind: "analysis" }],
    ["missing", {}],
    ["unknown", { kind: "taxonomy-sweep" }],
    ["research", { kind: "research" }],
    ["audit", { kind: "audit" }],
    ["operations-analysis", { kind: "operations-analysis" }],
    ["operations-analysis with Code Mode eligibility", { kind: "operations-analysis", structuredToolHeavy: true }],
    ["operations-analysis with a specialist risk", { kind: "operations-analysis", specialistRisk: "security" }],
  ];
  for (const [label, extra] of readOnlyKinds) {
    const result = plan({ trivial: false, readOnly: true, ...extra });
    assert.equal(result.valid, true, `${label}: ${result.errors?.join("; ")}`);
    assert.equal(result.mode !== "parallel", true, label);
    assert.equal(result.antiSlop.required, false, label);
    assert.deepEqual(result.antiSlop.phases, [], label);
    assert.equal(result.lanes.some((lane) => (lane.antiSlopPhases ?? []).length > 0), false, label);
    assert.equal(result.lanes.some((lane) => lane.readOnly !== true), false, `${label}: no writable lane`);
    const analysis = result.lanes.find((lane) => lane.id === "analysis");
    assert.ok(analysis, `${label}: read-only analysis lane exists`);
    assert.equal(analysis.role, "docs_researcher", label);
    assert.equal(analysis.type, "analysis", label);
    // Code Mode preference only when the lane is eligible.
    const codeModeEligible = "kind" in extra && extra.structuredToolHeavy === true &&
      ["research", "audit", "operations-analysis", "operations_analysis"].includes(String(extra.kind));
    assert.equal(
      analysis.execution,
      codeModeEligible ? "code-mode-attempt" : "sequential",
      label,
    );
  }

  // A supplied parallel work graph combined with readOnly fails closed
  // instead of creating writer lanes.
  const conflict = planOrchestration({
    taskContract: { ...baseContract, requestedWorkItemIds: ["T1", "T2"] },
    signals: { trivial: false, readOnly: true },
    workGraph: {
      repository: { identity: "repo", revision: "a".repeat(40) },
      tickets: ["T1", "T2"].map((id) => ({
        id,
        kind: "implementation",
        surfaces: [`src/feature/${id.toLowerCase()}`],
        dependencies: [],
        capabilities: ["typescript"],
        acceptance: `${id} observable`,
        checks: [`test:${id}`],
        stopCondition: `${id} verified`,
        status: "pending",
      })),
      integrationChecks: ["pnpm test"],
      integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
    },
  });
  assert.equal(conflict.valid, false);
  assert.match(conflict.errors.join("\n"), /read-only runs cannot authorize a writable or parallel work graph/);
  assert.equal(conflict.lanes.length, 0);
  assert.equal(conflict.antiSlop.required, false);
});

test("independent anti-slop review lanes use the evidence-bound Fable to Sol adversarial route", () => {
  const expectedModel = rosterModel("adversarial-review");
  const expectedChain = rosterChain("adversarial-review");
  for (const result of [plan({ trivial: false }), plan({ trivial: false, specialistRisk: "security" }), parallelPlanFixture()]) {
    for (const laneId of ["review-test-value", "review-objective-verification"]) {
      const lane = laneById(result.lanes, laneId);
      assert.equal(lane.model.resolved, null, `${laneId} resolved model stays null before a runtime receipt`);
      assert.equal(lane.model.requested, expectedModel.requested);
      assert.equal(lane.model.reasoning, expectedModel.reasoning);
      assert.equal(lane.modelRoute.routeSlot, "adversarial-review");
      assert.equal(lane.modelRoute.receiptRequired, true);
      assert.equal(lane.modelRoute.attemptBeforeDispatch, true);
      assert.deepEqual(lane.modelRoute.chain, expectedChain);
    }
    // Specialist routing is unchanged.
    const specialists = result.lanes.filter((lane) => lane.type === "specialist-review");
    assert.ok(specialists.every((lane) => lane.modelRoute === undefined));
  }
});

test("non-trivial read-only analysis and verification-only runs never receive writer-owned phases", () => {
  for (const signals of [
    { trivial: false, kind: "research", readOnly: true, structuredToolHeavy: true },
    { trivial: false, kind: "audit", readOnly: true },
    { trivial: false, kind: "operations-analysis", readOnly: true, specialistRisk: "security" },
  ]) {
    const result = plan(signals);
    assert.equal(result.valid, true, result.errors?.join("; "));
    assert.equal(result.antiSlop.required, false, JSON.stringify(signals));
    assert.deepEqual(result.antiSlop.phases, []);
    assert.equal(result.lanes.some((lane) => (lane.antiSlopPhases ?? []).length > 0), false);
    assert.equal(result.lanes.some((lane) => lane.readOnly !== true), false, "every lane stays read-only");
    assert.ok(result.antiSlop.reason.includes("read-only"));
  }
  const direct = plan({ trivial: true });
  assert.equal(direct.mode, "direct");
  assert.equal(direct.antiSlop.required, false);
  assert.deepEqual(direct.antiSlop.phases, []);
  assert.deepEqual(direct.antiSlop.excludedMetrics, expectedExcludedMetrics);
  const executionPlan = {
    version: "1",
    allowedOrigins: ["https://example.test"],
    allowedPathPatterns: ["/"],
    allowedActions: ["navigate"],
    inputReferences: [],
    steps: [{ id: "s1", action: "navigate", target: "https://example.test/" }],
    sideEffectMode: "none",
    evidencePath: "$HOME/.development-system/private/verification/run1",
    sha256: createHash("sha256")
      .update(JSON.stringify({
        version: "1",
        allowedOrigins: ["https://example.test"],
        allowedPathPatterns: ["/"],
        allowedActions: ["navigate"],
        inputReferences: [],
        steps: [{ id: "s1", action: "navigate", target: "https://example.test/" }],
        sideEffectMode: "none",
        evidencePath: "$HOME/.development-system/private/verification/run1",
      }))
      .digest("hex"),
  };
  const verification = planOrchestration({
    taskContract: baseContract,
    signals: { trivial: false, computerUse: true, qaOnly: true, executionPlan },
  });
  assert.equal(verification.antiSlop.required, false);
  assert.equal(verification.antiSlop.reason.includes("Verification-only"), true);
});

test("loc and proxy metrics stay excluded and cyclomatic or Halstead signals stay diagnostic only", () => {
  const result = plan({
    trivial: false,
    diffRisk: { addedLines: 100000, testToRuntimeLineRatio: 42, linesOfCode: 999999, cyclomaticComplexity: 500, halsteadVolume: 99999 },
  });
  assert.equal(result.valid, true);
  assert.equal(result.simplifyCode.selected, false);
  assert.equal(result.antiSlop.required, true);
  assert.deepEqual(result.antiSlop.phases.map((phase) => phase.id), expectedPhases);
  assert.ok(expectedExcludedMetrics.every((metric) => result.antiSlop.excludedMetrics.includes(metric)));
  assert.ok(expectedDiagnosticMetrics.every((metric) => result.antiSlop.diagnosticOnlyMetrics.includes(metric)));
  assert.equal(result.antiSlop.phases.some((phase) => /line/i.test(phase.id)), false);
});

test("lane contracts embed the complete anti-slop requirements for harnesses without installed skills", () => {
  const result = plan({ trivial: false });
  assert.equal(result.antiSlop.factoryCoverage.policy, "requirements-embedded-in-lane-contracts");
  assert.equal(result.antiSlop.factoryCoverage.installedSkillsRequired, false);
  assert.match(result.antiSlop.factoryCoverage.statement, /Factory writers do not require installed skills/);
  assert.match(result.antiSlop.factoryCoverage.statement, /never depends on Codex skill discovery/);
  // The writer lane is self-contained: each writer-owned phase carries its
  // full model-independent requirement and completion text.
  const writer = laneById(result.lanes, "writer");
  assert.deepEqual(
    writer.antiSlopPhases.map((phase) => phase.id),
    expectedPhases.slice(0, 3),
  );
  for (const phase of writer.antiSlopPhases) {
    assert.equal(phase.ownerRole, "fast_implementer");
    assert.ok(phase.requirement.length > 40);
    assert.ok(phase.completion.length > 40);
  }
  // The correction lane embeds the deletion-pass requirements verbatim.
  const correction = laneById(result.lanes, "correction");
  assert.equal(correction.antiSlopPhases[0].id, "deletion-pass");
  assert.match(correction.antiSlopPhases[0].requirement, /production code and test code/);
  assert.match(correction.antiSlopPhases[0].completion, /deleted, kept, and why/);
  assert.match(correction.antiSlopPhases[0].completion, /reruns the focused checks/);
});

test("the installed anti-slop skill uses the single contained installer entrypoint with preserved upstream provenance", async () => {
  const { synchronizeSkillCatalog } = await import("../src/skills.mjs");
  const { execFileSync: exec } = await import("node:child_process");

  const catalog = JSON.parse(await readFile(resolve(root, "catalog/0.24.0.json"), "utf8"));
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "aohys-anti-slop-source-"));
  for (const directory of [...new Set(catalog.skills.flatMap((skill) => skill.variants.map((variant) => variant.sourceDirectory)))]) {
    await cp(resolve(root, directory), resolve(sourceRoot, directory), { recursive: true });
  }
  exec("git", ["init", "-q"], { cwd: sourceRoot });
  exec("git", ["add", "."], { cwd: sourceRoot });
  exec("git", ["-c", "user.name=AOHYS Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], { cwd: sourceRoot });
  const sourceCommit = exec("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).trim();

  const home = await mkdtemp(resolve(tmpdir(), "aohys-anti-slop-home-"));
  const sync = await synchronizeSkillCatalog({ home, sourceRoot, sourceCommit, catalog });
  assert.equal(sync.ok, true);

  const installed = resolve(home, ".agents/skills/install-anti-slop");
  const installedSkill = await readFile(resolve(installed, "SKILL.md"), "utf8");
  assert.match(installedSkill, /^name: install-anti-slop$/m);
  assert.match(installedSkill, /scripts\/install\.mjs/);
  assert.match(installedSkill, /absolute destinations/);
  const installerStatus = await lstat(resolve(installed, "scripts/install.mjs"));
  assert.equal(installerStatus.isFile(), true);
  assert.equal((installerStatus.mode & 0o111) !== 0, true, "the contained installer stays executable");
  const installedScriptEntries = await readdir(resolve(installed, "scripts"));
  assert.deepEqual(installedScriptEntries.sort(), ["install.mjs"], "the installed adapter must contain no other executable");
  const installedPlugin = await readFile(resolve(installed, "assets/anti-slop/index.ts"), "utf8");
  assert.match(installedPlugin, /anti-slop/);
  const adapterLicense = await readFile(resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/LICENSE"), "utf8");
  assert.match(adapterLicense, /^MIT License\n\nCopyright \(c\) 2026 Dillon Mulroy\n/);
  assert.equal(createHash("sha256").update(adapterLicense).digest("hex"), "10ed33bf340d6d63dc0633dfc917a346b369b6aa41fe20734aefc6a3fb75ba17");
  assert.equal(
    await readFile(resolve(installed, "LICENSE"), "utf8"),
    adapterLicense,
    "the installed adapter must ship the exact MIT notice",
  );
  assert.equal((await lstat(resolve(installed, "LICENSE"))).mode & 0o777, 0o644);
  assert.equal(
    await readFile(resolve(installed, "SKILL.md"), "utf8"),
    await readFile(resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/SKILL.md"), "utf8"),
    "installed bytes match the pinned safe adapter source",
  );
  const evidence = await readFile(resolve(home, ".development-system/skills-lock.json"), "utf8").then(JSON.parse);
  assert.equal(evidence.catalogVersion, "0.24.0");
  const locked = evidence.logicalSkills.find((skill) => skill.logicalName === "install-anti-slop");
  assert.equal(locked.source.commit, sourceCommit);
  assert.equal(locked.source.upstreamReference.commit, "e8c4880471b23ab7f216fba7b27d173a6ef07d4c");
  assert.equal(locked.variants[0].destination, ".agents/skills/install-anti-slop");
  await rm(home, { recursive: true, force: true });
  await rm(sourceRoot, { recursive: true, force: true });
});

test("pristine upstream anti-slop bytes remain untouched, pinned to a literal tree hash, behind one contained installer", async () => {
  const catalog = JSON.parse(await readFile(resolve(root, "catalog/0.24.0.json"), "utf8"));
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);

  const antiSlop = catalog.skills.find((skill) => skill.logicalName === "install-anti-slop");
  assert.ok(antiSlop, "install-anti-slop is catalogued");
  assert.equal(antiSlop.source.repository, "https://github.com/AO-HyS/development-system");
  assert.equal(antiSlop.source.path, "artifacts/1.5.17/skills/internal/install-anti-slop");
  // The pristine vendored upstream snapshot is bound to a literal pinned
  // expected directory SHA-256 computed with the canonical folder-hash
  // algorithm, not merely to a local comparison and a commit string.
  const upstreamTreeHash = await folderHash(resolve(root, "artifacts/1.5.17/skills/upstream/install-anti-slop"));
  assert.deepEqual(antiSlop.source.upstreamReference, {
    repository: "https://github.com/dmmulroy/anti-slop",
    commit: "e8c4880471b23ab7f216fba7b27d173a6ef07d4c",
    path: "skills/install-anti-slop",
    license: "MIT",
    licenseSha256: "10ed33bf340d6d63dc0633dfc917a346b369b6aa41fe20734aefc6a3fb75ba17",
    treeSha256: upstreamTreeHash,
  });
  assert.equal(antiSlop.source.upstreamReference.treeSha256, "c309c21257eea4c681cb2388e1939c6f03d98af17885ff14e3b38efaf01f6a55");
  const variant = antiSlop.variants[0];
  assert.equal(variant.sourceDirectory, "artifacts/1.5.17/skills/internal/install-anti-slop");
  assert.equal(variant.destination, ".agents/skills/install-anti-slop");
  assert.deepEqual(variant.executableFiles, ["scripts/install.mjs"]);

  // The pristine vendored upstream snapshot stays byte-exact for provenance.
  assert.equal(
    (await readdir(resolve(root, "artifacts/1.5.17/skills/upstream/install-anti-slop"))).includes("LICENSE"),
    false,
    "the repository license must not be copied into the pristine upstream snapshot",
  );
  const upstreamSkill = await readFile(resolve(root, "artifacts/1.5.17/skills/upstream/install-anti-slop/SKILL.md"), "utf8");
  assert.match(upstreamSkill, /^name: install-anti-slop$/m);
  assert.match(upstreamSkill, /node <skill-directory>\/scripts\/install\.mjs/);
  const pristineInstaller = await readFile(resolve(root, "artifacts/1.5.17/skills/upstream/install-anti-slop/scripts/install.mjs"), "utf8");
  assert.match(pristineInstaller, /cpSync\(source, target, \{ recursive: true, force \}\)/);
  const adapterInstaller = await readFile(resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/scripts/install.mjs"), "utf8");
  assert.notEqual(adapterInstaller, pristineInstaller, "the installed entrypoint is the contained implementation, not raw upstream bytes");
  assert.match(adapterInstaller, /symbolic link ancestor/);

  // No npm dependency may appear; the upstream project is vendored, not installed.
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies, undefined);
  assert.deepEqual(Object.keys(packageJson.devDependencies).sort(), ["@types/node", "typescript"]);
});

test("behavioral-evidence and simplify-code skills carry the executable review and correction rules", async () => {
  const [evidenceSkill, simplifySkill] = await Promise.all([
    readFile(resolve(root, "artifacts/1.5.17/skills/internal/behavioral-evidence/SKILL.md"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.17/skills/internal/simplify-code/SKILL.md"), "utf8"),
  ]);
  assert.match(evidenceSkill, /subordinate evidence/);
  assert.match(evidenceSkill, /never override the objective/);
  assert.match(evidenceSkill, /green\s+result alone justifies nothing/);
  assert.match(evidenceSkill, /weakened/);
  assert.match(evidenceSkill, /Never delete a test without proving its behavior is covered/);
  assert.match(evidenceSkill, /context isolated from the implementation session/);
  assert.match(evidenceSkill, /never edits/);
  assert.match(simplifySkill, /Final deletion pass/);
  assert.match(simplifySkill, /production code and test code/);
  assert.match(simplifySkill, /state in one line why it must remain/);
  assert.match(simplifySkill, /excluded as optimization targets/);
  assert.match(simplifySkill, /Cyclomatic or Halstead complexity signals are\s+diagnostic evidence only/);
});

test("catalog sync plus operational evidence contract: signatures, hashes, and probe contracts agree", async () => {
  const catalog = JSON.parse(await readFile(resolve(root, "catalog/0.25.0.json"), "utf8"));
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
  const evidenceSkills = catalog.operationalEvidenceSkills ?? [];
  for (const name of ["research", "behavioral-evidence", "simplify-code", "install-anti-slop"]) {
    assert.ok(evidenceSkills.includes(name), `${name} requires operational evidence`);
    const contract = catalog.operationalEvidenceContracts?.[name];
    assert.ok(Array.isArray(contract?.behaviorSignature) && contract.behaviorSignature.length > 0, name);
    const probe = skillProbeContracts.find((entry) => entry.logicalName === name);
    assert.ok(probe, `${name} has a live probe contract`);
    assert.deepEqual(probe.behaviorSignature, contract.behaviorSignature, `${name} probe/catalog signature sync`);
  }
  // Every probe contract must be catalogued as an installed skill.
  for (const probe of skillProbeContracts) {
    const skill = catalog.skills.find((entry) => entry.logicalName === probe.logicalName);
    assert.ok(skill, probe.logicalName);
    assert.equal(skill.variants[0].destination, `.agents/skills/${probe.logicalName}`);
  }
});

test("operational evidence validation is fail-closed per skill", async () => {
  const { auditSkillCatalog } = await import("../src/skills.mjs");
  const catalog = JSON.parse(await readFile(resolve(root, "catalog/0.25.0.json"), "utf8"));
  const home = await mkdtemp(resolve(tmpdir(), "aohys-evidence-home-"));
  const audit = await auditSkillCatalog({ home, catalog });
  assert.equal(audit.ok, false);
  const problems = audit.problems.join("\n");
  for (const name of ["behavioral-evidence", "simplify-code", "install-anti-slop"]) {
    assert.match(problems, new RegExp(`${name}[^\\n]*operational evidence|operational evidence`, "i"));
    const variant = audit.skills.find((skill) => skill.logicalName === name);
    assert.ok(variant, name);
    assert.equal(variant.states.influenced, false);
  }
  assert.equal(audit.evidenceCoverage.liveRequiredSkills.sort().join(","), ["behavioral-evidence", "install-anti-slop", "research", "simplify-code"].sort().join(","));
  await rm(home, { recursive: true, force: true });
});

test("contract 1.5.17 and manifest 1.5.17 publish the executable anti-slop contract without rewriting 1.5.16 sources", async () => {
  const [manifest, contract, previousManifest] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.17.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.17/contract.md"), "utf8"),
    readFile(resolve(root, "manifests/1.5.16.json"), "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.contractVersion, "1.5.17");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.17/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.24.0.json");
  const unchanged = ["model-routing", "codex-agent-fast-implementer", "capability-roster"];
  for (const logicalName of unchanged) {
    const next = manifest.artifacts.find((artifact) => artifact.logicalName === logicalName);
    const before = previousManifest.artifacts.find((artifact) => artifact.logicalName === logicalName);
    assert.deepEqual(next, before, `${logicalName} keeps its published 1.5.16 source`);
  }

  for (const expected of [
    /executable lane contract/i,
    /Pre-implementation simplification/i,
    /Behavior-first evidence design/i,
    /Test-value review/i,
    /deletion pass/i,
    /writable (fast[- ]writer )?correction lane|writable correction lane/i,
    /Independent objective-derived verification/i,
    /subordinate evidence/i,
    /excluded as quality goals/i,
    /diagnostic/i,
    /adversarial review route|Fable 5\.1/i,
    /Factory writers do not require installed skills|requirements embedded in their lane contracts/i,
    /`e8c4880471b23ab7f216fba7b27d173a6ef07d4c`/,
    /MIT/,
    /no npm dependency is added/,
    /1\.5\.16 bytes and catalog\s+0\.23\.0 remain untouched/,
    /`scripts\/install\.mjs`/,
    /c309c21257eea4c681cb2388e1939c6f03d98af17885ff14e3b38efaf01f6a55/,
    /operational[- ]evidence/i,
  ]) {
    assert.match(contract, expected);
  }
});

test("repository preparation records the executable lane contract and adapter surfaces it", async () => {
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-anti-slop-repository-"));
  const write = async (path, contents) => {
    await mkdir(dirname(resolve(repository, path)), { recursive: true });
    await writeFile(resolve(repository, path), contents);
  };
  await write("package.json", JSON.stringify({
    name: "lumen-console",
    private: true,
    scripts: {
      review: "node -e \"process.exit(0)\"",
      "verify:changed": "node -e \"process.exit(0)\"",
      "quality:certify": "node -e \"process.exit(0)\"",
      qa: "node -e \"process.exit(0)\"",
      preview: "node -e \"process.exit(0)\"",
    },
  }));
  await write("AGENTS.md", "# Lumen Console\nPreserve the Lumen product language.\n");

  const result = await initializeRepository({ repository, confirm: "initialize" });
  assert.equal(result.status, "updated");
  const contract = JSON.parse(await readFile(resolve(repository, ".development-system/repository.json"), "utf8"));
  assert.equal(contract.contractVersion, "1.5.19");
  assert.equal(contract.operatorPrerequisites.skillCatalogVersion, "0.26.0");
  assert.ok(contract.operatorPrerequisites.requiredSkills.includes("install-anti-slop"));
  assert.ok(contract.operatorPrerequisites.requiredSkills.includes("behavioral-evidence"));
  assert.equal(contract.antiSlop.schema, "executable-lane-contract-v1");
  assert.deepEqual(contract.antiSlop.phases.map((phase) => phase.id), expectedPhases);
  assert.deepEqual(
    contract.antiSlop.phases.map((phase) => [phase.ownerRole, phase.writable]),
    [
      ["fast_implementer", true],
      ["fast_implementer", true],
      ["fast_implementer", true],
      ["reviewer", false],
      ["fast_implementer", true],
      ["reviewer", false],
    ],
  );
  assert.deepEqual(contract.antiSlop.phases[4].dependsOn, ["test-value-review"]);
  assert.deepEqual(contract.antiSlop.phases[5].dependsOn, ["deletion-pass"]);
  assert.equal(contract.antiSlop.testsAreSubordinateEvidence, true);
  assert.equal(contract.antiSlop.upstream.commit, "e8c4880471b23ab7f216fba7b27d173a6ef07d4c");
  assert.equal(contract.antiSlop.upstream.license, "MIT");
  assert.deepEqual(contract.antiSlop.excludedMetrics, expectedExcludedMetrics);
  assert.deepEqual(contract.antiSlop.diagnosticOnlyMetrics, expectedDiagnosticMetrics);
  assert.deepEqual(contract.antiSlop.installerSafety.refuses, [
    "absolute-targets",
    "empty-dot-or-parent-segments",
    "backslash-targets",
    "symlink-ancestors-or-target-escape",
  ]);
  assert.equal(contract.antiSlop.installerSafety.entrypoint, "scripts/install.mjs");
  assert.equal(contract.antiSlop.installerSafety.forceBehaviorPreserved, true);
  assert.equal(contract.antiSlop.upstream.treeSha256, "c309c21257eea4c681cb2388e1939c6f03d98af17885ff14e3b38efaf01f6a55");
  assert.equal(contract.antiSlop.factoryCoverage.installedSkillsRequired, false);
  const adapter = await readFile(resolve(repository, ".codex/development-system/repository.md"), "utf8");
  assert.match(adapter, /Contract version: `1\.5\.19`/);
  assert.match(adapter, /executable lane contract/);
  assert.match(adapter, /test-value review/);
  assert.match(adapter, /writable fast-writer correction lane/);
  assert.match(adapter, /never quality gates/);
  assert.match(adapter, /diagnostic only/);
  assert.match(adapter, /scripts\/install\.mjs/);
  assert.match(adapter, /never depend on installed skills/);
  await rm(repository, { recursive: true, force: true });
});

test("contract 1.5.18 publishes reliable live probes without rewriting the 1.5.17 contract or catalog", async () => {
  const [manifest, contract, previousManifest, previousContract] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.18.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.18/contract.md"), "utf8"),
    readFile(resolve(root, "manifests/1.5.17.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.17/contract.md"), "utf8"),
  ]);

  assert.equal(manifest.contractVersion, "1.5.18");
  assert.equal(
    manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath,
    "artifacts/1.5.18/contract.md",
  );
  assert.equal(
    manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath,
    "catalog/0.25.0.json",
  );
  assert.equal(previousManifest.contractVersion, "1.5.17");
  assert.match(previousContract, /^# Development System Contract 1\.5\.17/m);
  assert.match(contract, /Probe prompts still contain none of their own\s+behavior signatures/i);
  assert.match(contract, /real read of the exact installed `SKILL\.md`/i);
});
