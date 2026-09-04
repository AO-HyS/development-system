// @ts-check

import { createHash } from "node:crypto";

/**
 * Canonical executable anti-slop lane contract. This module is the single
 * source of truth for the ordered protocol: orchestration planning assigns
 * every phase to concrete lanes from this schema, and repository preparation
 * publishes the same schema, so the two surfaces cannot drift.
 *
 * Lines of code and related proxy metrics are excluded as optimization
 * targets and gates; tests are subordinate evidence and can never override
 * the objective or observable product behavior.
 */
const antiSlopPhaseDefinitions = [
  {
    order: 1,
    id: "pre-implementation-simplification",
    ownerRole: "fast_implementer",
    laneType: "writer",
    writable: true,
    dependsOn: Object.freeze([]),
    requirement: "Establish the smallest design that satisfies the accepted behavior before writing code; record what was deliberately not built and why.",
    completion: "The writer reports its pre-implementation simplification decision and cannot reach a terminal state without it.",
  },
  {
    order: 2,
    id: "behavior-first-evidence-design",
    ownerRole: "fast_implementer",
    laneType: "writer",
    writable: true,
    dependsOn: Object.freeze(["pre-implementation-simplification"]),
    requirement: "Derive tests and evidence from the objective and the public interface before implementing; tests are subordinate evidence and never override observable product behavior.",
    completion: "The writer reports the behavior-first evidence design before implementation begins.",
  },
  {
    order: 3,
    id: "implementation",
    ownerRole: "fast_implementer",
    laneType: "writer",
    writable: true,
    dependsOn: Object.freeze(["behavior-first-evidence-design"]),
    requirement: "Implement only the accepted design; readability, domain boundaries, and security outrank size.",
    completion: "The writer reports focused-check results for the implemented change.",
  },
  {
    order: 4,
    id: "test-value-review",
    ownerRole: "reviewer",
    laneType: "independent-review",
    writable: false,
    dependsOn: Object.freeze(["implementation"]),
    requirement: "Independently audit every changed or new test for behavioral value; refuse green-only acceptance; reject weakened assertions, updated snapshots, and private-structure tests without an observable-behavior justification; recommend deleting a useless test only when its behavior is covered elsewhere or intentionally removed.",
    completion: "The read-only review reports a per-test disposition and every weakening finding, and never edits.",
  },
  {
    order: 5,
    id: "deletion-pass",
    ownerRole: "fast_implementer",
    laneType: "correction",
    writable: true,
    dependsOn: Object.freeze(["test-value-review"]),
    requirement: "Apply safe deletions and corrections as the writable follow-up to the test-value review, covering production code and test code; preserve behavior and protected boundaries; edits are never delegated to a read-only reviewer.",
    completion: "The correction lane reports what was deleted, kept, and why across production and test code, and reruns the focused checks after every edit.",
  },
  {
    order: 6,
    id: "independent-objective-verification",
    ownerRole: "reviewer",
    laneType: "independent-review",
    writable: false,
    dependsOn: Object.freeze(["deletion-pass"]),
    requirement: "Independently derive the verification oracle from the accepted objective and the public interface with context isolated from implementation conclusions; reject tests or snapshots weakened merely to get green; the implementation writer's own tests are never the only evidence.",
    completion: "The read-only verification returns a verdict against the acceptance criteria exactly as written, including anything unproven.",
  },
];

// Freeze the phase records as well as the containing array. Callers receive a
// copy in plans, but the module-level schema itself must remain immutable when
// a hostile caller attempts to mutate a supplied protocol.
export const antiSlopPhases = Object.freeze(
  antiSlopPhaseDefinitions.map((phase) => Object.freeze({
    ...phase,
    dependsOn: Object.freeze([...phase.dependsOn]),
  })),
);

export const antiSlopExcludedMetrics = Object.freeze([
  "lines-of-code",
  "file-counts",
  "test-to-runtime-line-ratio",
  "identifier-length",
  "minified-or-compressed-formatting",
]);

/** Cyclomatic and Halstead signals are diagnostic evidence only, never gates. */
export const antiSlopDiagnosticOnlyMetrics = Object.freeze([
  "cyclomatic-complexity",
  "halstead-complexity",
]);

/** Route slot in the capability roster for independent anti-slop review lanes. */
export const antiSlopAdversarialRouteSlot = "adversarial-review";

/**
 * Deliberate Factory coverage choice: Factory writers never depend on Codex
 * skill discovery. Every lane contract embeds the complete anti-slop
 * requirements as model-independent prompt fields, so Factory execution is
 * requirement-complete by construction.
 */
export const antiSlopFactoryCoverage = Object.freeze({
  policy: "requirements-embedded-in-lane-contracts",
  installedSkillsRequired: false,
  statement:
    "Factory writers do not require installed skills. Every lane contract embeds the complete anti-slop requirements in model-independent prompt fields, so Factory execution never depends on Codex skill discovery.",
});

/** Ordered evidence-bound adversarial fallback route for independent anti-slop review lanes. */
export const antiSlopAdversarialChain = Object.freeze([
  { harness: "factory", model: "claude-fable-5.1", reasoning: "xhigh" },
  { harness: "devin", model: "claude-fable-5.1", reasoning: "xhigh" },
  { harness: "codex", model: "gpt-5.6-sol", reasoning: "xhigh" },
]);

/** @param {string} routeSlot */
export function antiSlopAdversarialRoute(routeSlot = antiSlopAdversarialRouteSlot) {
  return Object.freeze({
    routeSlot,
    chain: antiSlopAdversarialChain,
    subordinate: true,
    runtimeRouting: true,
    receiptRequired: true,
    attemptBeforeDispatch: true,
  });
}

/**
 * Build the protocol surface attached to a plan. When `applicable` is false
 * the reason must state why the write lanes are not required.
 * @param {{applicable: boolean, reason: string, topology?: Record<string, unknown> | null}} input
 */
export function buildAntiSlopProtocol({ applicable, reason, topology = null }) {
  return {
    required: applicable,
    reason,
    phases: applicable
      ? antiSlopPhases.map((phase) => ({
          ...phase,
          dependsOn: [...phase.dependsOn],
          requirement: phase.requirement,
          completion: phase.completion,
        }))
      : [],
    excludedMetrics: [...antiSlopExcludedMetrics],
    diagnosticOnlyMetrics: [...antiSlopDiagnosticOnlyMetrics],
    factoryCoverage: { ...antiSlopFactoryCoverage },
    topology,
  };
}

const topologyArrayFields = Object.freeze([
  "writerLaneIds",
  "reviewBarrierLaneIds",
  "requiredCorrectionDependencies",
]);

const digestPattern = /^[a-f0-9]{64}$/u;
const fingerprintFields = Object.freeze(["writerFingerprints", "specialistFingerprints"]);

/** @param {Record<string, unknown>} topology */
function topologyPayload(topology) {
  return {
    schemaVersion: topology.schemaVersion,
    source: topology.source,
    writerLaneIds: topology.writerLaneIds,
    reviewBarrierLaneIds: topology.reviewBarrierLaneIds,
    requiredCorrectionDependencies: topology.requiredCorrectionDependencies,
    integrationBarrierLaneId: topology.integrationBarrierLaneId,
    correctionLaneId: topology.correctionLaneId,
    finalVerificationLaneId: topology.finalVerificationLaneId,
    writerFingerprints: topology.writerFingerprints,
    specialistFingerprints: topology.specialistFingerprints,
  };
}

/** @param {unknown} value @returns {unknown} */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

/** @param {unknown} value @returns {string} */
function fingerprintSha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

/**
 * Normalize a string-array fingerprint surface. Order is canonicalized by
 * sorting, but multiplicity is preserved: adding a duplicate ownership,
 * ticket, or evidence entry must change the digest, so a same-ID substitute
 * cannot hide extra duplicated claims behind set semantics.
 * @param {unknown} value @returns {string[]}
 */
function fingerprintStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string" && entry.trim())
    .map((entry) => /** @type {string} */ (entry).trim())
    .sort();
}

/** @param {unknown} model @returns {Record<string, unknown> | null} */
function fingerprintModel(model) {
  if (!isRecord(model)) return null;
  return {
    requested: typeof model.requested === "string" ? model.requested : null,
    resolved: typeof model.resolved === "string" ? model.resolved : null,
    reasoning: typeof model.reasoning === "string" ? model.reasoning : null,
  };
}

/** @param {unknown} route @returns {unknown} */
function fingerprintRoute(route) {
  return isRecord(route) ? canonicalValue(route) : null;
}

/** @param {unknown} agent @returns {Record<string, unknown> | null} */
function fingerprintAgent(agent) {
  if (!isRecord(agent)) return null;
  return {
    role: typeof agent.role === "string" ? agent.role : null,
    harness: typeof agent.harness === "string" ? agent.harness : null,
    requestedModel: typeof agent.requestedModel === "string" ? agent.requestedModel : null,
    resolvedModel: typeof agent.resolvedModel === "string" ? agent.resolvedModel : null,
    reasoning: typeof agent.reasoning === "string" ? agent.reasoning : null,
    modelRoute: fingerprintRoute(agent.modelRoute),
  };
}

/**
 * SHA-256 fingerprint binding every writer-substitution surface of an
 * anti-slop writer lane: lane id, ticket ids, ownership, role/type, and the
 * exact fast route/agent fields. The trusted expectation is derived from the
 * original planning inputs and immutable planner constants; the candidate
 * lane's semantics are extracted with this same function, so a same-ID
 * substitute that drops tickets, ownership, role/type, or the fast route
 * cannot collide with the trusted digest. String arrays preserve
 * multiplicity, so duplicated tickets or ownership claims also change the
 * digest.
 * @param {unknown} lane
 * @returns {string | null}
 */
export function antiSlopWriterFingerprint(lane) {
  if (!isRecord(lane)) return null;
  return fingerprintSha256({
    kind: "anti-slop-writer-v1",
    id: typeof lane.id === "string" ? lane.id : "",
    ticketIds: fingerprintStrings(lane.tickets),
    ownership: fingerprintStrings(lane.ownership),
    role: typeof lane.role === "string" ? lane.role : null,
    type: typeof lane.type === "string" ? lane.type : null,
    model: fingerprintModel(lane.model),
    modelRoute: fingerprintRoute(lane.modelRoute),
    agent: fingerprintAgent(lane.agent),
  });
}

/**
 * SHA-256 fingerprint binding every specialist-substitution surface of an
 * anti-slop specialist review lane: lane id, role/type, ownership surfaces,
 * evidence, the exact model/route fields, and the exact agent descriptor.
 * The agent descriptor binds with a trusted expectation of null when absent,
 * so adding, removing, or changing it on a candidate lane alters the digest.
 * String arrays preserve multiplicity, so duplicated evidence or ownership
 * claims also change the digest.
 * @param {unknown} lane
 * @returns {string | null}
 */
export function antiSlopSpecialistFingerprint(lane) {
  if (!isRecord(lane)) return null;
  return fingerprintSha256({
    kind: "anti-slop-specialist-v1",
    id: typeof lane.id === "string" ? lane.id : "",
    role: typeof lane.role === "string" ? lane.role : null,
    type: typeof lane.type === "string" ? lane.type : null,
    ownership: fingerprintStrings(lane.ownership),
    evidence: fingerprintStrings(lane.evidence),
    model: fingerprintModel(lane.model),
    modelRoute: fingerprintRoute(lane.modelRoute),
    agent: fingerprintAgent(lane.agent),
  });
}

/** @param {Record<string, unknown>} topology */
function topologyHash(topology) {
  return createHash("sha256").update(JSON.stringify(topologyPayload(topology))).digest("hex");
}

/** @param {unknown} value @returns {value is string[]} */
function isUniqueStringArray(value) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0) &&
    new Set(value).size === value.length;
}

/** @param {unknown} left @param {unknown} right */
function exactArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right);
}

const trustedTopologyFields = Object.freeze([
  "schemaVersion",
  "source",
  ...topologyArrayFields,
  "integrationBarrierLaneId",
  "correctionLaneId",
  "finalVerificationLaneId",
  ...fingerprintFields,
]);

/**
 * Validate the separately retained expectations derived from the original
 * planning inputs. Candidate protocol topology and candidate lanes are never
 * used to infer these sets.
 * @param {unknown} value
 * @returns {string[]}
 */
function validateTrustedTopologyExpectations(value) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(value)) return ["anti-slop trusted topology expectations are required"];
  const expectations = value;
  if (expectations.schemaVersion !== 1 || expectations.source !== "trusted-planning-inputs") {
    errors.push("anti-slop trusted topology expectations must be version 1 from trusted planning inputs");
  }
  for (const field of topologyArrayFields) {
    if (!isUniqueStringArray(expectations[field])) {
      errors.push(`anti-slop trusted topology ${field} must be a non-empty unique string array`);
    }
  }
  if (expectations.integrationBarrierLaneId !== null && typeof expectations.integrationBarrierLaneId !== "string") {
    errors.push("anti-slop trusted topology integrationBarrierLaneId must be a lane id or null");
  }
  for (const field of ["correctionLaneId", "finalVerificationLaneId"]) {
    if (typeof expectations[field] !== "string" || !expectations[field].trim()) {
      errors.push(`anti-slop trusted topology ${field} is required`);
    }
  }
  for (const field of fingerprintFields) {
    const value = expectations[field];
    if (!isRecord(value)) {
      errors.push(`anti-slop trusted topology ${field} must be a record of lane id to SHA-256 fingerprint`);
      continue;
    }
    for (const [key, digest] of Object.entries(value)) {
      if (typeof digest !== "string" || !digestPattern.test(digest)) {
        errors.push(`anti-slop trusted topology ${field}.${key} must be a SHA-256 fingerprint`);
      }
    }
  }
  for (const key of Object.keys(expectations)) {
    if (!trustedTopologyFields.includes(key)) errors.push(`anti-slop trusted topology carries a non-canonical field: ${key}`);
  }
  return errors;
}

/**
 * Validate the host/planner-derived graph expectations carried by a plan.
 * Phase ownership alone cannot detect a removed parallel writer or a review
 * lane silently removed from the correction barrier. The expected sets come
 * only from the separately supplied trusted expectations.
 * @param {Array<Record<string, unknown>>} lanes
 * @param {unknown} candidate
 * @param {unknown} trusted
 * @returns {string[]}
 */
function validateTopology(lanes, candidate, trusted) {
  /** @type {string[]} */
  const errors = [];
  errors.push(...validateTrustedTopologyExpectations(trusted));
  if (errors.length > 0) return errors;
  if (!isRecord(candidate)) return ["anti-slop topology metadata is missing"];
  const topology = candidate;
  if (topology.schemaVersion !== 1 || topology.source !== "planner-derived") {
    errors.push("anti-slop topology metadata is not planner-derived version 1");
  }
  for (const field of topologyArrayFields) {
    if (!isUniqueStringArray(topology[field])) errors.push(`anti-slop topology ${field} must be a non-empty unique string array`);
  }
  for (const field of ["correctionLaneId", "finalVerificationLaneId"]) {
    if (typeof topology[field] !== "string" || !topology[field].trim()) errors.push(`anti-slop topology ${field} is required`);
  }
  if (topology.integrationBarrierLaneId !== null && typeof topology.integrationBarrierLaneId !== "string") {
    errors.push("anti-slop topology integrationBarrierLaneId must be a lane id or null");
  }
  if (typeof topology.integritySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(topology.integritySha256) || topologyHash(topology) !== topology.integritySha256) {
    errors.push("anti-slop topology integrity hash does not match its immutable expectations");
  }
  const extraKeys = Object.keys(topology).filter((key) => ![
    "schemaVersion",
    "source",
    ...topologyArrayFields,
    "integrationBarrierLaneId",
    "correctionLaneId",
    "finalVerificationLaneId",
    ...fingerprintFields,
    "integritySha256",
  ].includes(key));
  for (const key of extraKeys) errors.push(`anti-slop topology carries a non-canonical field: ${key}`);
  if (errors.length > 0) return errors;

  const expectations = /** @type {Record<string, unknown>} */ (trusted);
  for (const field of topologyArrayFields) {
    if (!exactArray(topology[field], expectations[field])) {
      errors.push(`anti-slop topology ${field} does not match trusted planning expectations`);
    }
  }
  for (const field of ["integrationBarrierLaneId", "correctionLaneId", "finalVerificationLaneId"]) {
    if (topology[field] !== expectations[field]) {
      errors.push(`anti-slop topology ${field} does not match trusted planning expectations`);
    }
  }
  for (const field of fingerprintFields) {
    if (JSON.stringify(canonicalValue(topology[field])) !== JSON.stringify(canonicalValue(expectations[field]))) {
      errors.push(`anti-slop topology ${field} does not match trusted planning expectations`);
    }
  }
  if (errors.length > 0) return errors;

  const laneList = Array.isArray(lanes) ? lanes : [];
  const laneById = new Map();
  for (const lane of laneList) {
    if (!isRecord(lane) || typeof lane.id !== "string") continue;
    if (laneById.has(lane.id)) errors.push(`anti-slop topology has duplicate lane id: ${lane.id}`);
    laneById.set(lane.id, lane);
  }
  const writers = /** @type {string[]} */ (expectations.writerLaneIds);
  const reviews = /** @type {string[]} */ (expectations.reviewBarrierLaneIds);
  const correctionDependencies = /** @type {string[]} */ (expectations.requiredCorrectionDependencies);
  const writerFingerprints = /** @type {Record<string, unknown>} */ (expectations.writerFingerprints);
  const specialistFingerprints = /** @type {Record<string, unknown>} */ (expectations.specialistFingerprints);
  if (!exactArray(reviews, correctionDependencies)) {
    errors.push("anti-slop topology review barriers must equal correction dependencies");
  }
  // The trusted fingerprints must bind exactly the expected lane sets: no
  // expected writer may lack a fingerprint, and no specialist fingerprint may
  // point outside the expected review barriers.
  if (JSON.stringify(Object.keys(writerFingerprints).sort()) !== JSON.stringify([...writers].sort())) {
    errors.push("anti-slop trusted writer fingerprints must cover exactly the expected writer lanes");
  }
  for (const specialistId of Object.keys(specialistFingerprints)) {
    if (!reviews.includes(specialistId)) {
      errors.push(`anti-slop trusted specialist fingerprint ${specialistId} is not an expected review barrier`);
    }
  }
  for (const writerId of writers) {
    const writer = laneById.get(writerId);
    if (!writer) {
      errors.push(`anti-slop topology is missing expected writer lane ${writerId}`);
      continue;
    }
    if (writer.readOnly === true) errors.push(`anti-slop topology writer ${writerId} is read-only`);
    const phases = /** @type {unknown[]} */ (Array.isArray(writer.antiSlopPhases) ? writer.antiSlopPhases : []);
    if (JSON.stringify(phases.map((phase) => phaseIdOf(phase))) !== JSON.stringify(antiSlopPhases.slice(0, 3).map((phase) => phase.id))) {
      errors.push(`anti-slop topology writer ${writerId} does not own the writer phase prefix`);
    }
    // The candidate lane's exact semantics must reproduce the trusted
    // canonical writer fingerprint derived from the original planning inputs.
    if (antiSlopWriterFingerprint(writer) !== writerFingerprints[writerId]) {
      errors.push(`anti-slop writer lane ${writerId} does not match the trusted canonical writer fingerprint`);
    }
  }

  const integrationId = expectations.integrationBarrierLaneId;
  if (integrationId === null) {
    if (laneList.some((lane) => isRecord(lane) && lane.type === "integration-barrier")) {
      errors.push("anti-slop topology unexpectedly contains an integration barrier");
    }
  } else {
    const integration = laneById.get(integrationId);
    if (!integration) errors.push(`anti-slop topology is missing integration barrier ${integrationId}`);
    else {
      if (integration.type !== "integration-barrier") errors.push(`anti-slop topology lane ${integrationId} is not an integration barrier`);
      if (!exactArray(integration.dependsOn, writers)) errors.push(`anti-slop integration barrier ${integrationId} must depend on every expected writer`);
    }
  }

  for (const reviewId of reviews) {
    const review = laneById.get(reviewId);
    if (!review) {
      errors.push(`anti-slop topology is missing expected review barrier ${reviewId}`);
      continue;
    }
    if (review.readOnly !== true) errors.push(`anti-slop review barrier ${reviewId} must be read-only`);
    if (integrationId !== null) {
      if (!exactArray(review.dependsOn, [integrationId])) errors.push(`anti-slop review barrier ${reviewId} must depend on integration`);
    } else if (!writers.every((writerId) => Array.isArray(review.dependsOn) && review.dependsOn.includes(writerId))) {
      errors.push(`anti-slop review barrier ${reviewId} must depend on every expected writer`);
    }
  }

  // Every trusted specialist lane must reproduce its canonical specialist
  // fingerprint derived from the original validated specialist risks.
  for (const [specialistId, expectedDigest] of Object.entries(specialistFingerprints)) {
    const specialist = laneById.get(specialistId);
    if (!specialist) {
      errors.push(`anti-slop topology is missing expected specialist review lane ${specialistId}`);
      continue;
    }
    if (antiSlopSpecialistFingerprint(specialist) !== expectedDigest) {
      errors.push(`anti-slop specialist lane ${specialistId} does not match the trusted canonical specialist fingerprint`);
    }
  }

  const correctionId = /** @type {string} */ (expectations.correctionLaneId);
  const correction = laneById.get(correctionId);
  if (!correction) errors.push(`anti-slop topology is missing correction lane ${correctionId}`);
  else {
    if (correction.readOnly === true) errors.push(`anti-slop correction ${correctionId} must be writable`);
    if (!exactArray(correction.dependsOn, correctionDependencies)) {
      errors.push(`anti-slop correction ${correctionId} must depend on every review barrier`);
    }
  }

  const finalId = /** @type {string} */ (expectations.finalVerificationLaneId);
  const finalLane = laneById.get(finalId);
  if (!finalLane) errors.push(`anti-slop topology is missing final verification lane ${finalId}`);
  else {
    if (finalLane.readOnly !== true) errors.push(`anti-slop final verification ${finalId} must be read-only`);
    if (!exactArray(finalLane.dependsOn, [correctionId])) errors.push(`anti-slop final verification ${finalId} must depend on correction`);
  }
  return errors;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {string} */
function phaseIdOf(value) {
  if (typeof value === "string") return value.trim();
  if (isRecord(value) && typeof value.id === "string") return value.id.trim();
  return "";
}

/**
 * Internal consistency validator for the executable lane contract. An
 * invalid, missing, or duplicated phase assignment or a broken dependency
 * chain produces errors so the plan fails closed.
 *
 * @param {Array<Record<string, unknown>>} lanes
 * @param {ReturnType<typeof buildAntiSlopProtocol>} protocol
 * @param {unknown} trustedExpectations
 * @returns {string[]}
 */
export function validateAntiSlopLanes(lanes, protocol, trustedExpectations) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(protocol)) return ["anti-slop protocol is missing"];
  const assignedPhases = (Array.isArray(lanes) ? lanes : []).some(
    (lane) => isRecord(lane) && Array.isArray(lane.antiSlopPhases) && lane.antiSlopPhases.length > 0,
  );
  if (protocol.required !== true) {
    if (assignedPhases) errors.push("anti-slop phases are assigned to lanes but the protocol is not required");
    return errors;
  }
  const trustedExpectationErrors = validateTrustedTopologyExpectations(trustedExpectations);
  if (trustedExpectationErrors.length > 0) return trustedExpectationErrors;

  /** Exact field set for both protocol phases and lane-embedded phases. */
  const canonicalPhaseFields = Object.freeze([
    "order",
    "id",
    "ownerRole",
    "laneType",
    "writable",
    "dependsOn",
    "requirement",
    "completion",
  ]);
  const suppliedPhases = Array.isArray(protocol.phases) ? protocol.phases : [];
  if (suppliedPhases.length === 0) errors.push("anti-slop protocol is required but exposes no phases");
  if (suppliedPhases.length !== antiSlopPhases.length) {
    errors.push(`anti-slop protocol must contain exactly ${antiSlopPhases.length} canonical phases`);
  }
  const canonicalIds = antiSlopPhases.map((phase) => phase.id);
  const suppliedIds = suppliedPhases.map((phase) => (isRecord(phase) && typeof phase.id === "string" ? phase.id : ""));
  if (suppliedIds.some((id) => !id)) errors.push("anti-slop protocol contains a phase without an id");
  if (new Set(suppliedIds).size !== suppliedIds.length) errors.push("anti-slop protocol contains duplicate phase ids");
  antiSlopPhases.forEach((canonical, index) => {
    const supplied = suppliedPhases[index];
    if (!isRecord(supplied)) {
      errors.push(`anti-slop protocol phase ${canonical.id} is incomplete`);
      return;
    }
    const canonicalRecord = /** @type {Record<string, unknown>} */ (canonical);
    const suppliedRecord = /** @type {Record<string, unknown>} */ (supplied);
    for (const field of canonicalPhaseFields) {
      const expected = canonicalRecord[field];
      const actual = suppliedRecord[field];
      const matches = field === "dependsOn"
        ? Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify([.../** @type {string[]} */ (expected)])
        : actual === expected;
      if (!matches) errors.push(`anti-slop protocol phase ${canonical.id} does not match the canonical ${field}`);
    }
    for (const key of Object.keys(supplied)) {
      if (!canonicalPhaseFields.includes(key)) errors.push(`anti-slop protocol phase ${canonical.id} carries a non-canonical field: ${key}`);
    }
  });
  // All phase/dependency reasoning below is anchored to the immutable module
  // schema, never to caller-controlled ids or ordering.
  const phases = antiSlopPhases;
  const ids = canonicalIds;
  if (errors.length > 0) return errors;

  const laneList = (Array.isArray(lanes) ? lanes : []).filter(
    (lane) => isRecord(lane) && Array.isArray(lane.antiSlopPhases) && lane.antiSlopPhases.length > 0,
  );
  // Every planned lane participates in the dependency graph; only lanes with
  // phase assignments own phases.
  const laneById = new Map(
    (Array.isArray(lanes) ? lanes : [])
      .filter((lane) => isRecord(lane) && typeof lane.id === "string")
      .map((lane) => [String(lane.id), lane]),
  );
  /** @type {Map<string, string[]>} */
  const owners = new Map();
  for (const lane of laneList) {
    for (const reference of /** @type {unknown[]} */ (lane.antiSlopPhases)) {
      // Every antiSlopPhases entry must be a full phase object; an ID-only
      // string never carries the executable contract and fails closed.
      if (!isRecord(reference)) {
        errors.push(`lane ${String(lane.id)} anti-slop phase ${String(reference)} must be a full phase object, never an ID-only string`);
        continue;
      }
      const id = phaseIdOf(reference);
      if (!ids.includes(id)) {
        errors.push(`lane ${String(lane.id)} references unknown anti-slop phase ${id || String(reference)}`);
        continue;
      }
      const current = owners.get(id) ?? [];
      if (current.includes(String(lane.id))) {
        errors.push(`anti-slop phase ${id} is assigned twice to lane ${String(lane.id)}`);
      } else {
        owners.set(id, [...current, String(lane.id)]);
      }
    }
  }
  const laneByIdOwnerOnly = new Map(laneList.map((lane) => [String(lane.id), lane]));
  /** @type {Map<string, Set<string>>} */
  const lanePhaseIds = new Map(
    laneList.map((lane) => [
      String(lane.id),
      new Set(/** @type {unknown[]} */ (lane.antiSlopPhases).map((reference) => phaseIdOf(reference))),
    ]),
  );
  for (const id of ids) {
    if (!owners.has(id)) errors.push(`anti-slop phase ${id} has no owning lane`);
  }
  for (const phase of phases) {
    const record = /** @type {Record<string, unknown>} */ (phase);
    for (const laneId of owners.get(String(record.id)) ?? []) {
      const lane = laneByIdOwnerOnly.get(laneId);
      if (!lane) continue;
      if (record.writable === true && lane.readOnly === true) {
        errors.push(`anti-slop phase ${String(record.id)} requires a writable lane, but ${laneId} is read-only`);
      }
      if (record.writable === false && lane.readOnly !== true) {
        errors.push(`anti-slop phase ${String(record.id)} must stay read-only, but ${laneId} can edit`);
      }
      // Every owning lane's declared role/type must equal the immutable phase
      // owner contract whenever the lane declares them. Parallel ticket
      // writers carry the writer identity in their agent descriptor and are
      // bound by the trusted writer fingerprint instead.
      if (lane.role !== undefined && lane.role !== record.ownerRole) {
        errors.push(`anti-slop phase ${String(record.id)} owner ${laneId} must carry the canonical ownerRole ${String(record.ownerRole)}`);
      }
      if (lane.type !== undefined && lane.type !== record.laneType) {
        errors.push(`anti-slop phase ${String(record.id)} owner ${laneId} must carry the canonical laneType ${String(record.laneType)}`);
      }
    }
    // A phase may be jointly owned only by a disjoint-ownership lane set whose
    // members carry exactly the same phase contract (parallel ticket writers).
    const laneIds = owners.get(String(record.id)) ?? [];
    if (laneIds.length > 1) {
      const signatures = new Set(laneIds.map((laneId) => [...(lanePhaseIds.get(laneId) ?? [])].sort().join("|")));
      if (signatures.size !== 1) {
        errors.push(`anti-slop phase ${String(record.id)} is assigned inconsistently across lanes ${laneIds.join(", ")}`);
      }
    }
  }
  // A lane owning a writer-owned phase must be a trusted writer fingerprint
  // lane, and a lane typed as a specialist review must be a trusted
  // specialist fingerprint lane. Neither can be injected by a candidate plan.
  const trustedRecord = /** @type {Record<string, unknown>} */ (trustedExpectations);
  const writerFingerprints = /** @type {Record<string, unknown>} */ (trustedRecord.writerFingerprints);
  const specialistFingerprints = /** @type {Record<string, unknown>} */ (trustedRecord.specialistFingerprints);
  const writerPhaseIds = new Set(antiSlopPhases.filter((phase) => phase.laneType === "writer").map((phase) => phase.id));
  for (const phaseId of writerPhaseIds) {
    for (const laneId of owners.get(phaseId) ?? []) {
      if (!Object.hasOwn(writerFingerprints, laneId)) {
        errors.push(`anti-slop writer lane ${laneId} owns ${phaseId} but is not a trusted writer fingerprint lane`);
      }
    }
  }
  for (const lane of Array.isArray(lanes) ? lanes : []) {
    if (isRecord(lane) && lane.type === "specialist-review" && !Object.hasOwn(specialistFingerprints, String(lane.id))) {
      errors.push(`anti-slop specialist lane ${String(lane.id)} is not a trusted specialist fingerprint lane`);
    }
  }
  const canonicalPhaseById = new Map(phases.map((phase) => [String((/** @type {Record<string, unknown>} */ (phase)).id), /** @type {Record<string, unknown>} */ (phase)]));
  for (const lane of laneList) {
    const references = /** @type {unknown[]} */ (lane.antiSlopPhases);
    const ownedIds = references.map((reference) => phaseIdOf(reference));
    // Each owning lane's phase subset must appear in canonical protocol order.
    const canonicalSubset = ids.filter((id) => ownedIds.includes(id));
    if (canonicalSubset.length !== ownedIds.length || canonicalSubset.some((id, index) => id !== ownedIds[index])) {
      errors.push(`lane ${String(lane.id)} assigns anti-slop phases out of canonical protocol order: ${ownedIds.join(", ")}`);
    }
    // A lane's embedded phase contract must equal the canonical protocol phase
    // exactly across every identity and execution field — order, id,
    // ownerRole, laneType, writable, dependsOn, requirement, and completion —
    // with no missing, mutated, or extra fields.
    for (const reference of references) {
      if (!isRecord(reference)) continue;
      const id = phaseIdOf(reference);
      const canonical = canonicalPhaseById.get(id);
      if (!canonical) continue;
      for (const field of canonicalPhaseFields) {
        const expected = canonical[field];
        const actual = reference[field];
        const matches = field === "dependsOn"
          ? Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify([.../** @type {string[]} */ (Array.isArray(expected) ? expected : [])])
          : actual === expected;
        if (!matches) errors.push(`lane ${String(lane.id)} phase ${id} contract does not match the canonical protocol ${field}`);
      }
      for (const key of Object.keys(reference)) {
        if (!canonicalPhaseFields.includes(key)) {
          errors.push(`lane ${String(lane.id)} phase ${id} contract carries a non-canonical field: ${key}`);
        }
      }
    }
  }
  for (const lane of laneList) {
    for (const dependency of Array.isArray(lane.dependsOn) ? /** @type {unknown[]} */ (lane.dependsOn) : []) {
      if (!laneById.has(String(dependency))) {
        errors.push(`anti-slop lane ${String(lane.id)} depends on unknown anti-slop lane ${String(dependency)}`);
      }
    }
  }
  /** @param {string} laneId @param {Set<string>} seen */
  function closure(laneId, seen) {
    if (seen.has(laneId)) return seen;
    seen.add(laneId);
    const lane = laneById.get(laneId);
    for (const dependency of Array.isArray(lane?.dependsOn) ? /** @type {string[]} */ (lane.dependsOn) : []) {
      closure(dependency, seen);
    }
    return seen;
  }
  /** @returns {boolean} true when a cycle was found */
  function hasCycle() {
    /** @type {Set<string>} */
    const done = new Set();
    /** @param {string} laneId @param {Set<string>} stack */
    function visit(laneId, stack) {
      if (done.has(laneId)) return false;
      if (stack.has(laneId)) return true;
      stack.add(laneId);
      const lane = laneById.get(laneId);
      for (const dependency of Array.isArray(lane?.dependsOn) ? /** @type {string[]} */ (lane.dependsOn) : []) {
        if (laneById.has(dependency) && visit(dependency, stack)) return true;
      }
      stack.delete(laneId);
      done.add(laneId);
      return false;
    }
    for (const laneId of laneById.keys()) {
      if (visit(laneId, new Set())) return true;
    }
    return false;
  }
  if (hasCycle()) errors.push("anti-slop lane dependencies contain a cycle");
  for (let index = 1; index < phases.length; index += 1) {
    const phase = /** @type {Record<string, unknown>} */ (phases[index]);
    const laneIds = owners.get(String(phase.id)) ?? [];
    for (const laneId of laneIds) {
      const reachable = closure(laneId, new Set());
      for (let prior = 0; prior < index; prior += 1) {
        const priorPhase = /** @type {Record<string, unknown>} */ (phases[prior]);
        const priorOwners = owners.get(String(priorPhase.id)) ?? [];
        if (priorOwners.length === 0) continue;
        // A lane that jointly owns a prior phase (parallel ticket writers)
        // satisfies it with its own in-order copy; every other later lane must
        // be reachable from every prior owner, so no parallel writer path can
        // bypass the later phase.
        if (priorOwners.includes(laneId)) continue;
        const unreached = priorOwners.filter((priorOwner) => !reachable.has(priorOwner));
        if (unreached.length === priorOwners.length) {
          errors.push(
            `anti-slop phase ${String(phase.id)} lane ${laneId} does not depend on any lane owning ${String(priorPhase.id)}`,
          );
        } else if (unreached.length > 0) {
          errors.push(
            `anti-slop phase ${String(phase.id)} lane ${laneId} does not depend on every lane owning ${String(priorPhase.id)} (missing: ${unreached.join(", ")})`,
          );
        }
      }
    }
  }
  errors.push(...validateTopology(lanes, protocol.topology, trustedExpectations));
  return errors;
}
