// @ts-check

import { createHash } from "node:crypto";
import {
  antiSlopAdversarialRoute,
  antiSlopPhases,
  antiSlopSpecialistFingerprint,
  antiSlopWriterFingerprint,
  buildAntiSlopProtocol,
  validateAntiSlopLanes,
} from "./anti-slop.mjs";
import { buildOrchestrationBundle } from "./orchestration-bundles.mjs";
import { rosterChain, rosterModel } from "./agent-roster.mjs";
import { planParallelWork } from "./parallel-work.mjs";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const hostValidationContractId = "orchestration-host-validation-v1";
const digestPattern = /^[a-f0-9]{64}$/u;

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
function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

/** @param {unknown} value @returns {string} */
export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const topologyArrayFields = Object.freeze([
  "writerLaneIds",
  "reviewBarrierLaneIds",
  "requiredCorrectionDependencies",
]);

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

/** @param {Record<string, unknown>} expectations */
function buildCandidateAntiSlopTopology(expectations) {
  const topology = {
    schemaVersion: 1,
    source: "planner-derived",
    writerLaneIds: [.../** @type {string[]} */ (expectations.writerLaneIds)],
    reviewBarrierLaneIds: [.../** @type {string[]} */ (expectations.reviewBarrierLaneIds)],
    requiredCorrectionDependencies: [.../** @type {string[]} */ (expectations.requiredCorrectionDependencies)],
    integrationBarrierLaneId: expectations.integrationBarrierLaneId,
    correctionLaneId: expectations.correctionLaneId,
    finalVerificationLaneId: expectations.finalVerificationLaneId,
    writerFingerprints: { .../** @type {Record<string, string | null>} */ (expectations.writerFingerprints) },
    specialistFingerprints: { .../** @type {Record<string, string | null>} */ (expectations.specialistFingerprints) },
  };
  return {
    ...topology,
    integritySha256: createHash("sha256").update(JSON.stringify(topologyPayload(topology))).digest("hex"),
  };
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
}

/** @param {string} value */
function safeSurface(value) {
  return value.length > 0 &&
    value !== "." &&
    !value.startsWith("/") &&
    !value.startsWith("~") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
/** @param {string} value */
function looksPathShaped(value) {
  return value.includes("/") || value.includes("\\") || value.startsWith(".") || value.startsWith("~");
}

/** @param {string} surface @param {string} scope */
function containedBy(surface, scope) {
  return surface === scope || surface.startsWith(`${scope}/`);
}

/** @param {string} left @param {string} right */
function surfacesOverlap(left, right) {
  return containedBy(left, right) || containedBy(right, left);
}

/** @param {Record<string, unknown>} contract @param {string} name @param {string[]} errors @param {boolean} required */
function contractStrings(contract, name, errors, required = false) {
  const value = contract[name];
  if (value === undefined && !required) return [];
  const normalized = strings(value);
  if ((required && normalized.length === 0) || (value !== undefined && !Array.isArray(value))) {
    errors.push(`taskContract.${name} requires an array of strings`);
  }
  return normalized;
}

const models = Object.freeze({
  parent: rosterModel("orchestration"),
  writer: rosterModel("fast-execution"),
  reviewer: rosterModel("general-review"),
  adversarialReviewer: rosterModel("adversarial-review"),
  security: rosterModel("security-review"),
  performance: rosterModel("performance-review"),
  visual: rosterModel("visual-review"),
  backend: rosterModel("backend-review"),
  research: rosterModel("research"),
  computerUseRunner: rosterModel("computer-use"),
});

/** @type {Record<string, {role: string, model: {requested: string, resolved: string | null, reasoning: string}}>} */
const specialistMap = Object.freeze({
  security: { role: "security_reviewer", model: models.security },
  performance: { role: "performance_auditor", model: models.performance },
  visual: { role: "visual_reviewer", model: models.visual },
  ui: { role: "visual_reviewer", model: models.visual },
  backend: { role: "backend_specialist", model: models.backend },
  data: { role: "backend_specialist", model: models.backend },
});

const analysisKinds = new Set(["research", "audit", "operations-analysis", "operations_analysis"]);

/**
 * Shared ordered runtime attempt chain for writer and mechanical lanes: Devin
 * `swe-1-7`, Factory `glm-5.3-flash`, Devin `gemini-3.8-flash` only when
 * current runtime availability is verified, then Codex `gpt-5.6-luna` with
 * reasoning `max` on the priority/fast service path.
 */
const fastModelChain = rosterChain("fast-execution");

/**
 * Explicit subordinate runtime-routing requirement for a lane. The parent
 * resolves and attempts the route before dispatch; a lane never claims a
 * resolved model without a provider/runtime receipt.
 * @param {string} routeSlot
 */
function fastChainRoute(routeSlot) {
  return Object.freeze({
    routeSlot,
    chain: fastModelChain,
    subordinate: true,
    runtimeRouting: true,
    receiptRequired: true,
    attemptBeforeDispatch: true,
  });
}

/**
 * Evidence-bound adversarial fallback route for independent anti-slop review
 * lanes: Factory Fable 5.1 xhigh, Devin Fable 5.1 xhigh, then Codex GPT-5.6
 * Sol xhigh. The resolved model stays null until a matching runtime receipt.
 */
function adversarialReviewRoute() {
  return antiSlopAdversarialRoute();
}

/**
 * Canonical identity of every anti-slop writer lane, shared by lane
 * construction and trusted fingerprint derivation so the two cannot drift.
 */
const writerIdentity = Object.freeze({ role: "fast_implementer", type: "writer" });

/**
 * Canonical agent descriptor embedded in every parallel ticket writer lane.
 * A fresh object per call: the model route must never be shared by reference
 * across lanes.
 */
function parallelWriterAgent() {
  return {
    role: writerIdentity.role,
    harness: "codex",
    requestedModel: models.writer.requested,
    modelRoute: fastChainRoute("fast-execution"),
    resolvedModel: null,
    reasoning: models.writer.reasoning,
  };
}

/** Shared lane contracts for the ordered anti-slop chain after the writer. @param {Record<string, unknown>} contract @param {{reviewDependsOn: string[], correctionDependsOn: string[], correctionStopSuffix?: string}} dependencies @param {ReturnType<typeof buildCorrectionContract>} correctionContract @returns {Array<Record<string, unknown>>} */
function antiSlopReviewLanes(contract, { reviewDependsOn, correctionDependsOn, correctionStopSuffix = "" }, correctionContract) {
  return [
    lane({
      id: "review-test-value",
      role: "reviewer",
      type: "independent-review",
      execution: "sequential-after-writer",
      model: models.adversarialReviewer,
      modelRoute: adversarialReviewRoute(),
      ownership: contract.scope,
      contract,
      checks: contract.checks,
      stopCondition: `${testValuePhaseContract.requirement} ${testValuePhaseContract.completion} Do not edit.`,
      independent: true,
      readOnly: true,
      antiSlopPhases: [{ ...testValuePhaseContract }],
      dependsOn: [...reviewDependsOn],
    }),
    lane({
      id: "correction",
      role: "fast_implementer",
      type: "correction",
      execution: "sequential-after-review",
      model: models.writer,
      modelRoute: fastChainRoute("fast-execution"),
      ownership: contract.scope,
      contract,
      checks: contract.checks,
      stopCondition: `${deletionPhaseContract.requirement} ${deletionPhaseContract.completion}${correctionStopSuffix}`,
      readOnly: false,
      antiSlopPhases: [{ ...deletionPhaseContract }],
      dependsOn: [...correctionDependsOn],
      requiredCorrectionReceipt: correctionContract.verificationGate,
    }),
    lane({
      id: "review-objective-verification",
      role: "reviewer",
      type: "independent-review",
      execution: "sequential-after-correction",
      model: models.adversarialReviewer,
      modelRoute: adversarialReviewRoute(),
      ownership: contract.scope,
      contract,
      checks: contract.checks,
      stopCondition: `Report actionable correctness and regression findings; ${verificationPhaseContract.requirement} ${verificationPhaseContract.completion} Do not edit.`,
      independent: true,
      readOnly: true,
      antiSlopPhases: [{ ...verificationPhaseContract }],
      dependsOn: ["correction"],
      requiredCorrectionReceipt: correctionContract.verificationGate,
    }),
  ];
}
const simplifySignals = [
  "explicitlyRequested",
  "newAbstractions",
  "duplicateLogic",
  "addedDependencies",
  "complexityIncrease",
];

/**
 * Canonical executable anti-slop phase contracts, copied whole into every
 * owning lane so each lane is a self-contained, model-independent prompt
 * surface (Factory writers never depend on installed skills).
 */
const writerPhaseContracts = Object.freeze(
  antiSlopPhases.filter((phase) => phase.order <= 3).map((phase) => ({ ...phase, dependsOn: [...phase.dependsOn] })),
);
const testValuePhaseContract = Object.freeze({ ...antiSlopPhases[3], dependsOn: [...antiSlopPhases[3].dependsOn] });
const deletionPhaseContract = Object.freeze({ ...antiSlopPhases[4], dependsOn: [...antiSlopPhases[4].dependsOn] });
const verificationPhaseContract = Object.freeze({ ...antiSlopPhases[5], dependsOn: [...antiSlopPhases[5].dependsOn] });

const correctionContractId = "anti-slop-critical-finding-correction-v1";
const acceptedFindingSeverities = Object.freeze(["blocker", "high", "medium", "low"]);
const criticalFindingSeverities = Object.freeze(["blocker", "high"]);
const acceptedTerminalDispositions = Object.freeze(["resolved", "blocked", "accepted"]);

/** @param {unknown} workGraph @returns {string[]} */
function originalTicketOrder(workGraph) {
  const tickets = isRecord(workGraph) && Array.isArray(workGraph.tickets)
    ? workGraph.tickets.filter(isRecord)
    : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  for (const ticket of tickets) {
    const id = typeof ticket.id === "string" ? ticket.id.trim() : "";
    if (id) byId.set(id, ticket);
  }
  /** @type {Map<string, 0 | 1 | 2>} */
  const visits = new Map();
  /** @type {string[]} */
  const order = [];
  /** @param {string} id */
  function visit(id) {
    if (visits.get(id) === 2) return;
    if (visits.get(id) === 1) return;
    visits.set(id, 1);
    const ticket = byId.get(id);
    if (ticket && Array.isArray(ticket.dependencies)) {
      for (const dependency of ticket.dependencies) {
        if (typeof dependency === "string" && byId.has(dependency.trim())) visit(dependency.trim());
      }
    }
    visits.set(id, 2);
    if (!order.includes(id)) order.push(id);
  }
  for (const ticket of tickets) {
    if (typeof ticket.id === "string" && ticket.id.trim()) visit(ticket.id.trim());
  }
  return order;
}

/** @param {unknown} workGraph @returns {Array<Record<string, unknown>>} */
function workGraphTicketRecords(workGraph) {
  return isRecord(workGraph) && Array.isArray(workGraph.tickets)
    ? workGraph.tickets.filter(isRecord)
    : [];
}

/**
 * Derive the anti-slop topology from the original validated inputs before any
 * executable lane or candidate protocol is constructed. The returned object
 * is retained by the host separately from the candidate plan. Trusted
 * canonical writer and specialist fingerprints are derived only from these
 * validated inputs and immutable planner constants — never from candidate
 * lanes — so a same-ID substitute lane cannot re-derive or collide with them.
 * @param {{contract: Record<string, unknown>, workGraph: unknown, risks: Array<{id: string, evidence: string[], surfaces: string[]}>, parallel: boolean}} input
 * @returns {Record<string, unknown>}
 */
function deriveTrustedAntiSlopExpectations({ contract, workGraph, risks, parallel }) {
  const requestedIds = Array.isArray(contract.requestedWorkItemIds) ? contract.requestedWorkItemIds : [];
  const ticketOrder = originalTicketOrder(workGraph);
  const writerLaneIds = parallel
    ? ticketOrder.length === requestedIds.length
      ? ticketOrder.map((_, index) => `lane-${index + 1}`)
      : []
    : ["writer"];
  const reviewBarrierLaneIds = parallel
    ? ["review-standards", "review-test-value", ...specialistLaneIds(risks)]
    : ["review-test-value", ...specialistLaneIds(risks)];
  /** @type {Record<string, string | null>} */
  const writerFingerprints = {};
  if (parallel && writerLaneIds.length === ticketOrder.length) {
    const surfacesByTicket = new Map(workGraphTicketRecords(workGraph).map((ticket) => [
      typeof ticket.id === "string" ? ticket.id.trim() : "",
      strings(ticket.surfaces),
    ]));
    ticketOrder.forEach((ticketId, index) => {
      writerFingerprints[`lane-${index + 1}`] = antiSlopWriterFingerprint({
        id: `lane-${index + 1}`,
        tickets: [ticketId],
        ownership: surfacesByTicket.get(ticketId) ?? [],
        agent: parallelWriterAgent(),
      });
    });
  } else if (!parallel) {
    writerFingerprints.writer = antiSlopWriterFingerprint({
      id: "writer",
      ownership: contract.scope,
      role: writerIdentity.role,
      type: writerIdentity.type,
      model: models.writer,
      modelRoute: fastChainRoute("implementation-default"),
    });
  }
  const specialistFingerprints = Object.fromEntries(risks.map((risk) => [
    `specialist-${risk.id}`,
    antiSlopSpecialistFingerprint({
      id: `specialist-${risk.id}`,
      role: specialistMap[risk.id].role,
      type: "specialist-review",
      ownership: risk.surfaces.length > 0 ? risk.surfaces : contract.scope,
      evidence: risk.evidence,
      model: specialistMap[risk.id].model,
    }),
  ]));
  return {
    schemaVersion: 1,
    source: "trusted-planning-inputs",
    writerLaneIds,
    reviewBarrierLaneIds,
    requiredCorrectionDependencies: [...reviewBarrierLaneIds],
    integrationBarrierLaneId: parallel ? "integration" : null,
    correctionLaneId: "correction",
    finalVerificationLaneId: "review-objective-verification",
    writerFingerprints,
    specialistFingerprints,
  };
}

/** @param {string[]} gatingReviewIds */
export function buildCorrectionContract(gatingReviewIds) {
  const ids = [...gatingReviewIds];
  return {
    required: ids.length > 0,
    schemaVersion: 1,
    contractId: correctionContractId,
    gatingReviewIds: ids,
    acceptedSeverityVocabulary: [...acceptedFindingSeverities],
    criticalSeverities: [...criticalFindingSeverities],
    requiredTerminalDispositions: {
      blocker: ["resolved", "blocked"],
      high: ["resolved", "blocked"],
    },
    dispositionRequirements: {
      resolved: { requiredFields: ["verificationEvidence"], verificationEvidence: "non-empty string array" },
      blocked: { requiredFields: ["blockingReason"], blockingReason: "non-empty string" },
      accepted: { requiredFields: ["acceptanceReason"], acceptanceReason: "non-empty string" },
    },
    receiptSchema: {
      schemaVersion: 1,
      contractId: correctionContractId,
      requiredFields: ["schemaVersion", "contractId", "gatingReviewIds", "acceptedSeverityVocabulary", "reviews", "terminal", "unresolvedCriticalFindings", "hostValidationBinding"],
      reviewFields: ["reviewId", "reviewDigestSha256", "findings", "unresolvedCriticalFindings"],
      findingFields: ["id", "severity", "disposition"],
      reviewFindingShape: "Each gating review appears exactly once; every trusted host finding is repeated with its exact severity and a terminal disposition.",
      hostValidationBinding: "The correction receipt must bind to the host-retained planning-input and complete-plan digests.",
    },
    verificationGate: {
      sourceLaneId: "correction",
      requiredInput: "correction-receipt",
      contractId: correctionContractId,
      requiredHostInputs: ["trusted-terminal-review-results", "host-retained-validation-contract"],
      dispatchCondition: "host-runtime-correction-validation.valid === true",
      acceptance: "The receipt is valid only when every blocker/high finding is resolved with verification evidence or explicitly blocked.",
    },
  };
}

/** @param {unknown} value @returns {value is string[]} */
function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

/**
 * Create the exact terminal result shape a trusted host can retain after a
 * review lane closes. The runtime validator still treats the supplied result
 * as untrusted until its canonical digest verifies.
 * @param {{reviewId: string, findings: Array<{id: string, severity: string}>}} input
 */
export function buildTerminalReviewResult({ reviewId, findings }) {
  const normalizedFindings = findings.map((finding) => ({ id: finding.id, severity: finding.severity }));
  const body = {
    schemaVersion: 1,
    reviewId,
    terminal: true,
    status: normalizedFindings.length === 0 ? "clean" : "findings",
    findings: normalizedFindings,
  };
  return { ...body, sha256: sha256Canonical(body) };
}

const terminalReviewResultFields = Object.freeze([
  "schemaVersion",
  "reviewId",
  "terminal",
  "status",
  "findings",
  "sha256",
]);
const terminalReviewFindingFields = Object.freeze(["id", "severity"]);
const correctionReceiptFields = Object.freeze([
  "schemaVersion",
  "contractId",
  "gatingReviewIds",
  "acceptedSeverityVocabulary",
  "terminal",
  "unresolvedCriticalFindings",
  "hostValidationBinding",
  "reviews",
]);
const correctionReviewFields = Object.freeze([
  "reviewId",
  "reviewDigestSha256",
  "findings",
  "unresolvedCriticalFindings",
]);
const correctionFindingFields = Object.freeze([
  "id",
  "severity",
  "disposition",
  "verificationEvidence",
  "blockingReason",
  "acceptanceReason",
  "unresolvedCriticalFindings",
]);

/** @param {Record<string, unknown>} value @param {readonly string[]} allowed @returns {string[]} */
function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

/**
 * Validate the exact terminal review results retained by the host. Findings
 * are deliberately reduced to `{id,severity}` before hashing, so a caller
 * cannot make an evidence field part of the trusted review identity.
 * @param {unknown} value
 * @param {ReturnType<typeof buildCorrectionContract>} contract
 * @returns {{errors: string[], byId: Map<string, Record<string, unknown>>}}
 */
function validateTrustedReviewResults(value, contract) {
  /** @type {string[]} */
  const errors = [];
  const byId = new Map();
  if (!Array.isArray(value)) {
    return { errors: ["trusted host review results are required as a separate array"], byId };
  }
  const expectedReviewIds = contract.gatingReviewIds;
  if (value.length !== expectedReviewIds.length) {
    errors.push("trusted host review results must contain exactly one terminal result per gating review");
  }
  /** @type {Set<string>} */
  const findingIds = new Set();
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      errors.push("trusted host review results must contain objects");
      continue;
    }
    const result = candidate;
    for (const key of unknownKeys(result, terminalReviewResultFields)) {
      errors.push(`trusted host review result carries a non-canonical field: ${key}`);
    }
    const reviewId = typeof result.reviewId === "string" ? result.reviewId : "";
    if (!reviewId || !expectedReviewIds.includes(reviewId)) {
      errors.push("trusted host review result has an unknown or malformed reviewId");
      continue;
    }
    if (byId.has(reviewId)) errors.push(`trusted host review results duplicate reviewId ${reviewId}`);
    if (result.schemaVersion !== 1 || result.terminal !== true) {
      errors.push(`trusted host review result ${reviewId} must be terminal schema version 1`);
    }
    if (!Array.isArray(result.findings)) {
      errors.push(`trusted host review result ${reviewId} must contain a findings array`);
      continue;
    }
    const findings = [];
    for (const finding of result.findings) {
      if (!isRecord(finding)) {
        errors.push(`trusted host review result ${reviewId} contains a malformed finding`);
        continue;
      }
      for (const key of unknownKeys(finding, terminalReviewFindingFields)) {
        errors.push(`trusted host review result ${reviewId} finding carries a non-canonical field: ${key}`);
      }
      const id = typeof finding.id === "string" ? finding.id : "";
      const severity = typeof finding.severity === "string" ? finding.severity : "";
      if (!id || id.trim() !== id) errors.push(`trusted host review result ${reviewId} finding requires an exact id`);
      if (!acceptedFindingSeverities.includes(severity)) errors.push(`trusted host review result ${reviewId} finding ${id || "unknown"} has an unsupported severity`);
      if (findingIds.has(id)) errors.push(`trusted host review results duplicate finding ${id}`);
      findingIds.add(id);
      findings.push({ id, severity });
    }
    const status = result.status;
    if (status !== "clean" && status !== "findings") {
      errors.push(`trusted host review result ${reviewId} must have an explicit clean or findings status`);
    }
    if (findings.length === 0 && status !== "clean") {
      errors.push(`trusted host review result ${reviewId} with an empty findings list must be explicitly clean`);
    }
    if (findings.length > 0 && status !== "findings") {
      errors.push(`trusted host review result ${reviewId} with findings must have findings status`);
    }
    const payload = {
      schemaVersion: result.schemaVersion,
      reviewId,
      terminal: result.terminal,
      status,
      findings,
    };
    if (typeof result.sha256 !== "string" || !digestPattern.test(result.sha256) || result.sha256 !== sha256Canonical(payload)) {
      errors.push(`trusted host review result ${reviewId} sha256 must bind the canonical terminal result`);
    }
    byId.set(reviewId, { ...result, findings });
  }
  if (byId.size !== expectedReviewIds.length || expectedReviewIds.some((reviewId) => !byId.has(reviewId))) {
    errors.push("trusted host review results must cover every gating review exactly once");
  }
  return { errors, byId };
}

/** @param {unknown} hostValidation @param {unknown} binding @param {ReturnType<typeof buildCorrectionContract>} contract @param {string[]} errors */
function validateHostValidationBinding(hostValidation, binding, contract, errors) {
  if (!isRecord(hostValidation)) {
    errors.push("host-retained validation contract is required for correction receipt validation");
    return;
  }
  const expectedPlanning = hostValidation.expectedPlanningInputSha256;
  const expectedComplete = hostValidation.expectedCompletePlanSha256;
  const expectedCorrectionContract = hostValidation.expectedCorrectionContractSha256;
  if (
    hostValidation.schemaVersion !== 1 ||
    hostValidation.contractId !== hostValidationContractId ||
    typeof expectedPlanning !== "string" ||
    !digestPattern.test(expectedPlanning) ||
    typeof expectedComplete !== "string" ||
    !digestPattern.test(expectedComplete) ||
    typeof expectedCorrectionContract !== "string" ||
    !digestPattern.test(expectedCorrectionContract)
  ) {
    errors.push("host-retained validation contract must have the canonical schema, contract ID, and planning, complete-plan, and correction-contract SHA-256 digests");
    return;
  }
  if (sha256Canonical(contract) !== expectedCorrectionContract) {
    errors.push("supplied correction contract does not match the contract retained with the complete plan");
  }
  if (!isRecord(binding)) {
    errors.push("correction receipt must contain a hostValidationBinding");
    return;
  }
  for (const key of unknownKeys(binding, ["planningInputSha256", "completePlanSha256"])) {
    errors.push(`correction receipt hostValidationBinding carries a non-canonical field: ${key}`);
  }
  if (binding.planningInputSha256 !== expectedPlanning) errors.push("correction receipt planning-input digest does not match the host-retained expectation");
  if (binding.completePlanSha256 !== expectedComplete) errors.push("correction receipt complete-plan digest does not match the host-retained expectation");
}

/**
 * Validate a runtime correction receipt against separately supplied trusted
 * review results and a host-retained plan binding. The pure planner never
 * calls this function and never accepts its result as input.
 * @param {unknown} receipt
 * @param {ReturnType<typeof buildCorrectionContract>} contract
 * @param {unknown} trustedReviewResults
 * @param {unknown} hostValidation
 * @returns {{valid: boolean, errors: string[], dispatchAuthorized: boolean}}
 */
export function validateRuntimeCorrectionReceipt(receipt, contract, trustedReviewResults, hostValidation) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(contract) || contract.required !== true) {
    return { valid: false, errors: ["correction receipt is not allowed when no correction contract is required"], dispatchAuthorized: false };
  }
  if (!isRecord(receipt)) return { valid: false, errors: ["correction receipt must be an object"], dispatchAuthorized: false };
  const candidate = receipt;
  for (const key of unknownKeys(candidate, correctionReceiptFields)) {
    errors.push(`correction receipt carries a non-canonical field: ${key}`);
  }
  if (receipt.schemaVersion !== contract.schemaVersion || receipt.contractId !== contract.contractId) {
    errors.push("correction receipt schema or contractId does not match");
  }
  if (!Array.isArray(receipt.gatingReviewIds) || JSON.stringify(receipt.gatingReviewIds) !== JSON.stringify(contract.gatingReviewIds)) {
    errors.push("correction receipt must enumerate the exact gating review IDs");
  }
  if (!Array.isArray(receipt.acceptedSeverityVocabulary) || JSON.stringify(receipt.acceptedSeverityVocabulary) !== JSON.stringify(contract.acceptedSeverityVocabulary)) {
    errors.push("correction receipt must use the accepted severity vocabulary");
  }
  if (receipt.terminal !== true) errors.push("correction receipt must be terminal");
  if (!Array.isArray(receipt.unresolvedCriticalFindings)) {
    errors.push("correction receipt must explicitly enumerate unresolvedCriticalFindings");
  } else if (receipt.unresolvedCriticalFindings.length > 0) {
    errors.push("correction receipt contains unresolved critical findings");
  }
  validateHostValidationBinding(hostValidation, receipt.hostValidationBinding, contract, errors);
  const trusted = validateTrustedReviewResults(trustedReviewResults, contract);
  errors.push(...trusted.errors);
  if (!Array.isArray(receipt.reviews)) {
    errors.push("correction receipt must contain one review entry per gating review");
    return { valid: false, errors, dispatchAuthorized: false };
  }
  const reviewIds = receipt.reviews.map((review) => isRecord(review) && typeof review.reviewId === "string" ? review.reviewId : "");
  if (reviewIds.length !== contract.gatingReviewIds.length || new Set(reviewIds).size !== reviewIds.length || JSON.stringify([...reviewIds].sort()) !== JSON.stringify([...contract.gatingReviewIds].sort())) {
    errors.push("correction receipt reviews must cover each gating review exactly once");
  }
  /** @type {Set<string>} */
  const findingIds = new Set();
  for (const review of receipt.reviews) {
    if (!isRecord(review) || typeof review.reviewId !== "string" || !contract.gatingReviewIds.includes(review.reviewId)) {
      errors.push("correction receipt contains an unknown or malformed review entry");
      continue;
    }
    for (const key of unknownKeys(review, correctionReviewFields)) {
      errors.push(`correction receipt review ${review.reviewId} carries a non-canonical field: ${key}`);
    }
    const trustedReview = trusted.byId.get(review.reviewId);
    if (!trustedReview) {
      errors.push(`correction receipt review ${review.reviewId} has no trusted terminal review result`);
    } else if (review.reviewDigestSha256 !== trustedReview.sha256) {
      errors.push(`correction receipt review ${review.reviewId} must reference the trusted review digest`);
    }
    if (!Array.isArray(review.findings)) {
      errors.push(`correction receipt review ${review.reviewId} must contain a findings array`);
      continue;
    }
    if (!Array.isArray(review.unresolvedCriticalFindings)) {
      errors.push(`correction receipt review ${review.reviewId} must explicitly enumerate unresolvedCriticalFindings`);
    } else if (review.unresolvedCriticalFindings.length > 0) {
      errors.push(`correction receipt review ${review.reviewId} contains unresolved critical findings`);
    }
    const expectedFindings = /** @type {Array<{id: string, severity: string}>} */ (
      trustedReview && Array.isArray(trustedReview.findings) ? trustedReview.findings : []
    );
    const expectedFindingIds = new Set(expectedFindings.map((finding) => finding.id));
    const seenReviewFindingIds = new Set();
    if (review.findings.length !== expectedFindings.length) {
      errors.push(`correction receipt review ${review.reviewId} must cover the exact trusted finding list`);
    }
    for (const finding of review.findings) {
      if (!isRecord(finding) || typeof finding.id !== "string" || !finding.id.trim()) {
        errors.push(`correction receipt review ${review.reviewId} contains a finding without an id`);
        continue;
      }
      for (const key of unknownKeys(finding, correctionFindingFields)) {
        errors.push(`correction finding ${finding.id} carries a non-canonical field: ${key}`);
      }
      if (findingIds.has(finding.id) || seenReviewFindingIds.has(finding.id)) errors.push(`correction receipt duplicates finding ${finding.id}`);
      findingIds.add(finding.id);
      seenReviewFindingIds.add(finding.id);
      const severity = typeof finding.severity === "string" ? finding.severity : "";
      const disposition = typeof finding.disposition === "string" ? finding.disposition : "";
      if (!acceptedFindingSeverities.includes(severity)) errors.push(`correction finding ${finding.id} has an unsupported severity`);
      const expectedFinding = expectedFindings.find((candidateFinding) => candidateFinding.id === finding.id);
      if (!expectedFinding) {
        if (!expectedFindingIds.has(finding.id)) errors.push(`correction finding ${finding.id} is not present in the trusted review result`);
      } else if (expectedFinding.severity !== severity) {
        errors.push(`correction finding ${finding.id} changes the trusted severity and is a downgrade or mutation`);
      }
      if (!acceptedTerminalDispositions.includes(disposition)) errors.push(`correction finding ${finding.id} has an unsupported terminal disposition`);
      if (criticalFindingSeverities.includes(severity) && !["resolved", "blocked"].includes(disposition)) {
        errors.push(`critical correction finding ${finding.id} must be resolved or explicitly blocked`);
      }
      if (disposition === "resolved" && !nonEmptyStrings(finding.verificationEvidence)) {
        errors.push(`resolved correction finding ${finding.id} requires verification evidence`);
      }
      if (disposition === "blocked" && (typeof finding.blockingReason !== "string" || !finding.blockingReason.trim())) {
        errors.push(`blocked correction finding ${finding.id} requires an explicit blocking reason`);
      }
      if (disposition === "accepted" && (typeof finding.acceptanceReason !== "string" || !finding.acceptanceReason.trim())) {
        errors.push(`accepted correction finding ${finding.id} requires an acceptance reason`);
      }
      if (Object.hasOwn(finding, "unresolvedCriticalFindings")) {
        if (!Array.isArray(finding.unresolvedCriticalFindings)) errors.push(`correction finding ${finding.id} has malformed unresolvedCriticalFindings`);
        else if (finding.unresolvedCriticalFindings.length > 0) errors.push(`correction finding ${finding.id} contains unresolved critical findings`);
      }
    }
    for (const expectedFinding of expectedFindings) {
      if (!seenReviewFindingIds.has(expectedFinding.id)) errors.push(`correction receipt omits trusted finding ${expectedFinding.id}`);
    }
  }
  for (const reviewId of contract.gatingReviewIds) {
    const trustedReview = trusted.byId.get(reviewId);
    if (!trustedReview) continue;
    const trustedFindings = /** @type {Array<{id: string, severity: string}>} */ (
      Array.isArray(trustedReview.findings) ? trustedReview.findings : []
    );
    for (const finding of trustedFindings) {
      if (!findingIds.has(finding.id)) errors.push(`correction receipt does not cover trusted finding ${finding.id}`);
    }
  }
  const valid = errors.length === 0;
  return { valid, errors, dispatchAuthorized: valid };
}

/**
 * Backward-compatible error-array surface for callers that already use the
 * existing name. Runtime authority still requires all separate host inputs.
 * @param {unknown} receipt
 * @param {ReturnType<typeof buildCorrectionContract>} contract
 * @param {unknown} trustedReviewResults
 * @param {unknown} hostValidation
 * @returns {string[]}
 */
export function validateCorrectionReceipt(receipt, contract, trustedReviewResults, hostValidation) {
  return validateRuntimeCorrectionReceipt(receipt, contract, trustedReviewResults, hostValidation).errors;
}

/** @param {"direct" | "sequential" | "specialist" | "parallel" | "verification"} mode @param {Record<string, unknown>} signals @param {Record<string, unknown> | null} [topology] */
function antiSlopProtocol(mode, signals, topology = null) {
  if (mode === "direct") {
    return buildAntiSlopProtocol({
      applicable: false,
      reason: "Trivial mechanical work stays on the direct fast path.",
      topology,
    });
  }
  if (mode === "verification") {
    return buildAntiSlopProtocol({
      applicable: false,
      reason: "Verification-only runs execute the pre-planned signed execution plan and never receive writer-owned anti-slop phases.",
      topology,
    });
  }
  if (signals.readOnly === true) {
    return buildAntiSlopProtocol({
      applicable: false,
      reason: "Non-trivial read-only research, audit, and analysis work has no writer-owned anti-slop surface.",
      topology,
    });
  }
  return buildAntiSlopProtocol({
    applicable: true,
    reason: "Non-trivial write plans execute the ordered anti-slop protocol as executable lane contracts.",
    topology,
  });
}

/** @param {Record<string, unknown>} contract @param {string[]} errors */
function validateContract(contract, errors) {
  const objective = typeof contract.objective === "string" ? contract.objective.trim() : "";
  const scope = contractStrings(contract, "scope", errors, true);
  const inputs = contractStrings(contract, "inputs", errors);
  const constraints = contractStrings(contract, "constraints", errors);
  const outOfScope = contractStrings(contract, "outOfScope", errors);
  const acceptance = contractStrings(contract, "acceptance", errors, true);
  const expectedOutputs = contractStrings(contract, "expectedOutputs", errors, true);
  const checks = contractStrings(contract, "checks", errors, true);
  const protectedBoundaries = contractStrings(contract, "protectedBoundaries", errors);
  const authorizationBoundaries = contractStrings(contract, "authorizationBoundaries", errors, true);
  const stopCondition = typeof contract.stopCondition === "string" ? contract.stopCondition.trim() : "";
  const requestedWorkItemIds = contractStrings(contract, "requestedWorkItemIds", errors);
  if (requestedWorkItemIds.length > 0 && new Set(requestedWorkItemIds).size !== requestedWorkItemIds.length) errors.push("taskContract.requestedWorkItemIds must be unique");
  if (!objective) errors.push("taskContract.objective is required");
  if (scope.length === 0) errors.push("taskContract.scope requires at least one owned surface");
  if (acceptance.length === 0) errors.push("taskContract.acceptance requires observable criteria");
  if (expectedOutputs.length === 0) errors.push("taskContract.expectedOutputs requires expected outputs");
  if (checks.length === 0) errors.push("taskContract.checks requires at least one focused check");
  if (authorizationBoundaries.length === 0) errors.push("taskContract.authorizationBoundaries requires explicit boundaries");
  if (!stopCondition) errors.push("taskContract.stopCondition is required");
  return {
    objective,
    scope,
    inputs,
    constraints,
    outOfScope,
    acceptance,
    expectedOutputs,
    checks,
    protectedBoundaries,
    authorizationBoundaries,
    stopCondition,
    requestedWorkItemIds,
  };
}

/** @param {Record<string, unknown>} signals @param {string[]} errors */
function validateSignals(signals, errors) {
  if (typeof signals.trivial !== "boolean") errors.push("signals.trivial must be an explicit boolean");
  if (signals.readOnly !== undefined && typeof signals.readOnly !== "boolean") errors.push("signals.readOnly must be boolean");
  if (signals.structuredToolHeavy !== undefined && typeof signals.structuredToolHeavy !== "boolean") errors.push("signals.structuredToolHeavy must be boolean");
  if (signals.codeModeEvidence !== undefined && !isRecord(signals.codeModeEvidence)) errors.push("signals.codeModeEvidence must be an object");
  if (signals.specialistRisk !== undefined && typeof signals.specialistRisk !== "string") errors.push("signals.specialistRisk must be a string");
  if (signals.specialistRisks !== undefined && !Array.isArray(signals.specialistRisks)) errors.push("signals.specialistRisks must be an array");
  if (signals.maxConcurrentWriters !== undefined && (!Number.isInteger(signals.maxConcurrentWriters) || Number(signals.maxConcurrentWriters) < 1)) errors.push("signals.maxConcurrentWriters must be a positive integer");
  if (signals.diffRisk !== undefined && !isRecord(signals.diffRisk)) errors.push("signals.diffRisk must be an object");
  if (signals.computerUse !== undefined && typeof signals.computerUse !== "boolean") errors.push("signals.computerUse must be boolean");
  if (signals.browserAcceptance !== undefined && typeof signals.browserAcceptance !== "boolean") errors.push("signals.browserAcceptance must be boolean");
  if (signals.qaOnly !== undefined && typeof signals.qaOnly !== "boolean") errors.push("signals.qaOnly must be boolean");
  if (signals.verificationOnly !== undefined && typeof signals.verificationOnly !== "boolean") errors.push("signals.verificationOnly must be boolean");
  return errors.length === 0;
}

/** @param {Record<string, unknown>} signals @param {string[]} errors */
function specialistRisks(signals, errors) {
  const risks = [];
  if (typeof signals.specialistRisk === "string") {
    const id = signals.specialistRisk.trim().toLowerCase();
    if (!specialistMap[id]) errors.push(`signals.specialistRisk is unsupported: ${id}`);
    else risks.push({ id, evidence: ["legacy explicit specialist risk"], surfaces: [] });
  }
  if (Array.isArray(signals.specialistRisks)) {
    for (const value of signals.specialistRisks) {
      if (!isRecord(value)) { errors.push("signals.specialistRisks entries must be objects"); continue; }
      const id = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
      const evidence = strings(value.evidence);
      const surfaces = strings(value.surfaces);
      if (!id || !specialistMap[id] || evidence.length === 0 || surfaces.length === 0) {
        errors.push("signals.specialistRisks entries require a supported id plus non-empty evidence and surfaces");
        continue;
      }
      risks.push({ id, evidence, surfaces });
    }
  }
  /** @type {Map<string, {id: string, evidence: string[], surfaces: string[]}>} */
  const merged = new Map();
  for (const risk of risks) {
    const role = specialistMap[risk.id]?.role ?? risk.id;
    const current = merged.get(role);
    if (!current) {
      merged.set(role, { id: risk.id, evidence: [...risk.evidence], surfaces: [...risk.surfaces] });
      continue;
    }
    current.evidence = [...new Set([...current.evidence, ...risk.evidence])];
    current.surfaces = [...new Set([...current.surfaces, ...risk.surfaces])];
  }
  return [...merged.values()];
}

/** @param {unknown} workGraph @param {Record<string, unknown>} contract @param {Record<string, unknown>} signals @param {Array<{id: string, evidence: string[], surfaces: string[]}>} risks @param {string[]} errors */
function authorizedParallelPlan(workGraph, contract, signals, risks, errors) {
  const requestedIds = /** @type {string[]} */ (contract.requestedWorkItemIds);
  if (requestedIds.length < 2) return null;
  if (!isRecord(workGraph)) { errors.push("workGraph is required when two or more work items are requested"); return null; }
  const tickets = Array.isArray(workGraph.tickets) ? workGraph.tickets : [];
  const graphIds = tickets.filter(isRecord).map((ticket) => typeof ticket.id === "string" ? ticket.id.trim() : "");
  if (graphIds.length !== requestedIds.length || [...requestedIds].sort().join("\n") !== [...graphIds].sort().join("\n")) {
    errors.push("workGraph ticket ids must exactly match taskContract.requestedWorkItemIds");
    return null;
  }
  const scope = /** @type {string[]} */ (contract.scope);
  const protectedBoundaries = /** @type {string[]} */ (contract.protectedBoundaries);
  if (scope.some((surface) => !safeSurface(surface))) errors.push("parallel taskContract.scope requires safe repository-relative surfaces");
  const safeProtected = protectedBoundaries.filter(safeSurface);
  if (protectedBoundaries.some((boundary) => looksPathShaped(boundary) && !safeSurface(boundary))) {
    errors.push("path-shaped protected boundaries must be safe repository-relative surfaces");
  }
  for (const value of tickets) {
    if (!isRecord(value)) continue;
    const id = typeof value.id === "string" ? value.id : "ticket";
    const surfaces = strings(value.surfaces);
    if (surfaces.some((surface) => !safeSurface(surface))) errors.push(`${id}: surfaces must be safe repository-relative paths`);
    if (surfaces.some((surface) => !scope.some((owned) => containedBy(surface, owned)))) errors.push(`${id}: surfaces must stay inside taskContract.scope`);
    if (surfaces.some((surface) => safeProtected.some((boundary) => surfacesOverlap(surface, boundary)))) errors.push(`${id}: surfaces overlap a protected boundary`);
  }
  for (const risk of risks) {
    if (risk.surfaces.some((surface) => !safeSurface(surface) || !scope.some((owned) => containedBy(surface, owned)))) {
      errors.push(`specialist ${risk.id}: surfaces must stay inside taskContract.scope`);
    }
    if (risk.surfaces.some((surface) => safeProtected.some((boundary) => surfacesOverlap(surface, boundary)))) {
      errors.push(`specialist ${risk.id}: surfaces overlap a protected boundary`);
    }
  }
  const integrationChecks = strings(workGraph.integrationChecks);
  const bundledTickets = tickets.map((value) => {
    if (!isRecord(value)) return value;
    if (typeof value.kind !== "string" || !value.kind.trim()) errors.push(`${typeof value.id === "string" ? value.id : "ticket"}: kind is required`);
    const bundle = buildOrchestrationBundle(value, { integrationChecks, runtimeEvidence: workGraph.runtimeEvidence });
    if (!bundle.valid) errors.push(...bundle.errors.map((error) => `${typeof value.id === "string" ? value.id : "ticket"}: ${error}`));
    return {
      ...value,
      // Automatic initiative planning describes topology only. The trusted
      // host allocates a fresh branch and worktree after verifying authority.
      branch: null,
      worktree: null,
      agent: parallelWriterAgent(),
      bundle,
    };
  });
  if (errors.length > 0) return null;
  const result = planParallelWork({
    initiativeAuthorized: true,
    repository: workGraph.repository,
    tickets: bundledTickets,
    integration: workGraph.integration,
    integrationChecks,
    delivery: workGraph.delivery,
    sharedBaseHealthy: workGraph.sharedBaseHealthy,
    maxConcurrentWriters: signals.maxConcurrentWriters,
  });
  if (!result.valid) errors.push(...result.errors.map((error) => `workGraph: ${error}`));
  return result;
}

/** @param {unknown} value @returns {string[]} */
function requiredStrings(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim())
    ? value.map((entry) => entry.trim())
    : [];
}

const computerUseActions = new Set([
  "navigate",
  "click",
  "type",
  "select",
  "submit-form",
  "scroll",
  "wait",
  "capture-screenshot",
  "record-video",
  "stop-recording",
]);
const observationOnlyActions = new Set([
  "navigate",
  "scroll",
  "wait",
  "capture-screenshot",
  "record-video",
  "stop-recording",
]);
const executionPlanKeys = new Set([
  "version",
  "allowedOrigins",
  "allowedPathPatterns",
  "allowedActions",
  "inputReferences",
  "steps",
  "sideEffectMode",
  "evidencePath",
  "sha256",
]);
const executionStepKeys = new Set(["id", "action", "target", "inputRef"]);

/** @param {unknown} value */
function executionSteps(value) {
  if (!Array.isArray(value)) return [];
  /** @type {Array<{id: string, action: string, target?: string, inputRef?: string}>} */
  const result = [];
  for (const entry of value) {
    if (!isRecord(entry)) return [];
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const action = typeof entry.action === "string" ? entry.action.trim() : "";
    const target = typeof entry.target === "string" ? entry.target.trim() : undefined;
    const inputRef = typeof entry.inputRef === "string" ? entry.inputRef.trim() : undefined;
    if (!id || !action) return [];
    result.push({ id, action, ...(target ? { target } : {}), ...(inputRef ? { inputRef } : {}) });
  }
  return result;
}

/** @param {Record<string, unknown>} candidate */
function executionPlanPayload(candidate) {
  return {
    version: typeof candidate.version === "string" ? candidate.version.trim() : candidate.version,
    allowedOrigins: requiredStrings(candidate.allowedOrigins),
    allowedPathPatterns: requiredStrings(candidate.allowedPathPatterns),
    allowedActions: requiredStrings(candidate.allowedActions),
    inputReferences: requiredStrings(candidate.inputReferences),
    steps: executionSteps(candidate.steps),
    sideEffectMode: candidate.sideEffectMode,
    evidencePath: typeof candidate.evidencePath === "string" ? candidate.evidencePath.trim() : candidate.evidencePath,
  };
}

/** @param {Record<string, unknown>} candidate */
function expectedExecutionPlanHash(candidate) {
  return createHash("sha256").update(JSON.stringify(executionPlanPayload(candidate))).digest("hex");
}

/** @param {string} pattern */
function pathPatternRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("**", "\0").replaceAll("*", "[^/]*").replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`, "u");
}

/** @param {string} target @param {string[]} allowedOrigins @param {string[]} allowedPathPatterns */
function navigationAllowed(target, allowedOrigins, allowedPathPatterns) {
  if (target.startsWith("//") || target.includes("\\") || /%(?:2e|2f|5c)/iu.test(target) || allowedOrigins.length === 0) return false;
  try {
    const url = new URL(target, `${allowedOrigins[0]}/`);
    if (!allowedOrigins.includes(url.origin) || url.username || url.password || url.search || url.hash) return false;
    return allowedPathPatterns.some((pattern) => pathPatternRegex(pattern).test(url.pathname));
  } catch {
    return false;
  }
}

/** @param {Record<string, unknown>} signals @param {string[]} errors */
function validateExecutionPlanInput(signals, errors) {
  const requested = signals.computerUse === true || signals.browserAcceptance === true;
  if (!requested) return null;
  const candidate = isRecord(signals.executionPlan) ? signals.executionPlan : null;
  if (!candidate) {
    errors.push("signals.executionPlan is required for Computer Use verification");
    return null;
  }
  if (Object.keys(candidate).some((key) => !executionPlanKeys.has(key))) {
    errors.push("signals.executionPlan contains unknown properties");
  }
  if (Array.isArray(candidate.steps) && candidate.steps.some((step) => isRecord(step) && Object.keys(step).some((key) => !executionStepKeys.has(key)))) {
    errors.push("signals.executionPlan.steps contains unknown properties");
  }
  const version = typeof candidate.version === "string" ? candidate.version.trim() : "";
  const allowedOrigins = requiredStrings(candidate.allowedOrigins);
  const allowedPathPatterns = requiredStrings(candidate.allowedPathPatterns);
  const allowedActions = requiredStrings(candidate.allowedActions);
  const inputReferences = requiredStrings(candidate.inputReferences);
  const steps = executionSteps(candidate.steps);
  const evidencePath = typeof candidate.evidencePath === "string" ? candidate.evidencePath.trim() : "";
  const sha256 = typeof candidate.sha256 === "string" ? candidate.sha256.trim() : "";
  const sideEffectMode = candidate.sideEffectMode;
  if (version !== "1") errors.push("signals.executionPlan.version must equal 1");
  if (allowedOrigins.length === 0) errors.push("signals.executionPlan.allowedOrigins requires an array of origins");
  if (allowedPathPatterns.length === 0) errors.push("signals.executionPlan.allowedPathPatterns requires an array of path patterns");
  if (allowedActions.length === 0) errors.push("signals.executionPlan.allowedActions requires an action allowlist");
  if (allowedOrigins.some((origin) => {
    try {
      const url = new URL(origin);
      return !["http:", "https:"].includes(url.protocol) || url.origin !== origin || Boolean(url.username || url.password);
    } catch {
      return true;
    }
  })) errors.push("signals.executionPlan.allowedOrigins must contain normalized HTTP(S) origins only");
  if (allowedPathPatterns.some((pattern) => !pattern.startsWith("/") || pattern.includes("..") || pattern.includes("?") || pattern.includes("#"))) {
    errors.push("signals.executionPlan.allowedPathPatterns must contain origin-relative safe path patterns");
  }
  if (!Array.isArray(candidate.inputReferences) || inputReferences.some((entry) => !/^(fixture|host|session|vault)\.[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(entry))) {
    errors.push("signals.executionPlan.inputReferences must use opaque fixture, host, session, or vault reference identifiers");
  }
  if (steps.length === 0) errors.push("signals.executionPlan.steps requires neutral executable steps");
  if (new Set(steps.map((step) => step.id)).size !== steps.length) errors.push("signals.executionPlan.steps requires unique ids");
  if (allowedActions.some((action) => !computerUseActions.has(action))) {
    errors.push("signals.executionPlan.allowedActions contains an unsupported action");
  }
  if (steps.some((step) => !allowedActions.includes(step.action))) {
    errors.push("signals.executionPlan.steps contains an action outside allowedActions");
  }
  if (steps.some((step) => step.inputRef && !inputReferences.includes(step.inputRef))) {
    errors.push("signals.executionPlan.steps contains an inputRef outside inputReferences");
  }
  if (steps.some((step) => step.action === "navigate" && (!step.target || !navigationAllowed(step.target, allowedOrigins, allowedPathPatterns)))) {
    errors.push("signals.executionPlan navigate targets must match allowedOrigins and allowedPathPatterns");
  }
  if (steps.some((step) => ["click", "type", "select", "submit-form"].includes(step.action) && !step.target)) {
    errors.push("signals.executionPlan interactive steps require a target");
  }
  if (steps.some((step) => ["type", "select"].includes(step.action) && !step.inputRef)) {
    errors.push("signals.executionPlan type and select steps require an opaque inputRef");
  }
  if (!/^\$HOME\/\.development-system\/private\/verification\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._\/-]+)?$/u.test(evidencePath) || evidencePath.includes("..")) {
    errors.push("signals.executionPlan.evidencePath must use the private verification evidence root");
  }
  if (!/^[a-f0-9]{64}$/u.test(sha256) || sha256 !== expectedExecutionPlanHash(candidate)) {
    errors.push("signals.executionPlan.sha256 must bind the canonical plan payload excluding sha256");
  }
  if (sideEffectMode !== "none" && sideEffectMode !== "authorized-writes") {
    errors.push("signals.executionPlan.sideEffectMode must be none or authorized-writes");
  }
  if (signals.readOnly === true && sideEffectMode !== "none") {
    errors.push("read-only Computer Use requires executionPlan.sideEffectMode none");
  }
  const noneModeAction = allowedActions.find((action) => !observationOnlyActions.has(action));
  if (sideEffectMode === "none" && noneModeAction) {
    errors.push("signals.executionPlan.sideEffectMode none permits navigation/capture actions only");
  }
  const intents = requiredStrings(signals.externalWriteIntents);
  const possibleSideEffects = requiredStrings(signals.possibleExternalSideEffects);
  if (sideEffectMode === "authorized-writes") {
    if (intents.length === 0) errors.push("authorized-writes requires scoped externalWriteIntents");
    if (possibleSideEffects.length === 0) errors.push("authorized-writes requires possibleExternalSideEffects");
    errors.push("authorized-writes cannot be authorized by the pure planner; the host must consume and verify an opaque receipt before dispatch");
  } else if (intents.length > 0 || possibleSideEffects.length > 0 || (isRecord(signals.externalWriteAuthorization) && signals.externalWriteAuthorization.granted === true)) {
    errors.push("sideEffectMode none cannot declare external writes or possible side effects");
  }
  if (signals.sideEffectMode !== undefined && signals.sideEffectMode !== sideEffectMode) {
    errors.push("signals.sideEffectMode must match signals.executionPlan.sideEffectMode");
  }
  return {
    version,
    allowedOrigins,
    allowedPathPatterns,
    allowedActions,
    inputReferences,
    steps,
    sideEffectMode,
    evidencePath,
    sha256,
    externalWriteIntents: intents,
    possibleExternalSideEffects: possibleSideEffects,
  };
}

/** @param {Record<string, unknown>} signals @param {ReturnType<typeof validateExecutionPlanInput>} executionPlan */
function computerUseDecision(signals, executionPlan) {
  const requested = signals.computerUse === true || signals.browserAcceptance === true;
  const qaOnly = requested && (signals.qaOnly === true || signals.verificationOnly === true);
  return {
    requested,
    qaOnly,
    readOnly: signals.readOnly === true,
    executor: requested ? "computer_use_runner" : null,
    executorModel: requested ? models.computerUseRunner : null,
    judgmentOwner: requested ? "orchestrator" : null,
    judgmentRole: requested ? "verification_judge" : null,
    probeOrder: requested ? ["before-execution", "computer-use-execution", "after-execution"] : [],
    rubricVisibility: requested ? "private-to-orchestrator" : null,
    browserAuthority: "host-runtime",
    sideEffectMode: executionPlan?.sideEffectMode ?? null,
    executionPlanBinding: executionPlan ? {
      version: executionPlan.version,
      sha256: executionPlan.sha256,
      allowedOrigins: [...executionPlan.allowedOrigins],
      allowedPathPatterns: [...executionPlan.allowedPathPatterns],
      allowedActions: [...executionPlan.allowedActions],
      inputReferences: [...executionPlan.inputReferences],
      steps: executionPlan.steps.map((step) => ({ ...step })),
      sideEffectMode: executionPlan.sideEffectMode,
      evidencePath: executionPlan.evidencePath,
    } : null,
    externalWriteIntents: executionPlan?.externalWriteIntents ?? [],
    possibleExternalSideEffects: executionPlan?.possibleExternalSideEffects ?? [],
  };
}

/** @param {Record<string, unknown>} signals */
function codeModeDecision(signals) {
  const kind = typeof signals.kind === "string" ? signals.kind.trim().toLowerCase() : "";
  const readOnly = signals.readOnly === true;
  const structuredToolHeavy = signals.structuredToolHeavy === true;
  const base = { selected: false, selectionAuthority: "host-runtime" };
  if (!analysisKinds.has(kind)) {
    return { ...base, eligible: false, preference: null, fallback: "sequential-read-only-tools", reason: "Code Mode is reserved for explicit research, audit, or operations analysis." };
  }
  if (!readOnly) {
    return { ...base, eligible: false, preference: null, fallback: "sequential", reason: "Code Mode requires a read-only lane." };
  }
  if (!structuredToolHeavy) {
    return { ...base, eligible: false, preference: null, fallback: "sequential-read-only-tools", reason: "The lane is not structured-tool-heavy." };
  }
  return {
    ...base,
    eligible: true,
    preference: "code-mode",
    fallback: "sequential-read-only-tools",
    reason: "The task is eligible for a host-selected Code Mode attempt; the planner cannot activate or select it.",
  };
}

/** @param {Record<string, unknown>} signals */
function simplifyDecision(signals) {
  const diffRisk = isRecord(signals.diffRisk) ? signals.diffRisk : {};
  const signal = simplifySignals.find((name) => diffRisk[name] === true);
  if (!signal) return { selected: false, reason: "No explicit simplification-risk signal was supplied." };
  return { selected: true, reason: `Explicit diff-risk signal: ${signal}.` };
}

/**
 * Build a deterministic, side-effect-free execution plan. It validates an
 * explicit task contract and observed capabilities; it never launches agents
 * or providers and never grants delivery authority.
 * @param {unknown} input
 */
export function planOrchestration(input) {
  const errors = [];
  if (!isRecord(input)) {
    return blockedPlan(["orchestration input must be an object"]);
  }
  const contractInput = isRecord(input.taskContract) ? input.taskContract : isRecord(input.contract) ? input.contract : null;
  const signals = isRecord(input.signals) ? input.signals : null;
  const forbiddenRuntimeReceiptPaths = [
    ["correctionReceipt", input.correctionReceipt],
    ["receipt", input.receipt],
    ["executionResult", input.executionResult],
    ["signals.correctionReceipt", signals?.correctionReceipt],
    ["signals.receipt", signals?.receipt],
    ["signals.executionResult", signals?.executionResult],
  ].filter(([, value]) => value !== undefined);
  if (forbiddenRuntimeReceiptPaths.length > 0) {
    errors.push(`the pure planner rejects runtime correction evidence: ${forbiddenRuntimeReceiptPaths.map(([path]) => path).join(", ")}`);
  }
  if (!contractInput) errors.push("taskContract is required");
  if (!signals) errors.push("signals is required");
  if (contractInput === null || signals === null) return blockedPlan(errors);
  const contract = validateContract(contractInput, errors);
  validateSignals(signals, errors);
  const executionPlan = validateExecutionPlanInput(signals, errors);
  const risks = specialistRisks(signals, errors);
  // Read-only authorization is absolute: ANY supplied workGraph combined with
  // readOnly fails closed on the raw input itself, before authorizedParallelPlan
  // could silently ignore the graph for fewer than two requested work items,
  // empty ids, or a malformed or partial graph.
  if (signals.readOnly === true && input.workGraph !== undefined && input.workGraph !== null) {
    errors.push("read-only runs cannot authorize a writable or parallel work graph");
  }
  const parallelWork = authorizedParallelPlan(input.workGraph, contract, signals, risks, errors);
  if (errors.length > 0) return blockedPlan(errors, contract);

  const computerUse = computerUseDecision(signals, executionPlan);
  const readOnlyRun = signals.readOnly === true && signals.trivial !== true;
  const mode = parallelWork
    ? "parallel"
    : computerUse.qaOnly
    ? "verification"
    : signals.trivial === true ? "direct" : risks.length > 0 ? "specialist" : "sequential";
  const codeMode = mode === "direct" || mode === "verification"
    ? { eligible: false, selected: false, selectionAuthority: "host-runtime", preference: null, executor: null, fallback: "direct", reason: "Direct work does not use a Code Mode analysis lane." }
    : codeModeDecision(signals);
  const simplifyCode = simplifyDecision(signals);
  const antiSlopApplicable = signals.readOnly !== true && mode !== "direct" && mode !== "verification";
  const gatingReviewIds = antiSlopApplicable
    ? parallelWork
      ? ["review-standards", "review-test-value", ...specialistLaneIds(risks)]
      : ["review-test-value", ...specialistLaneIds(risks)]
    : [];
  const correctionContract = buildCorrectionContract(gatingReviewIds);
  const trustedTopologyExpectations = antiSlopApplicable
    ? deriveTrustedAntiSlopExpectations({ contract, workGraph: input.workGraph, risks, parallel: parallelWork !== null })
    : null;
  /** @type {Array<Record<string, unknown>>} */
  const lanes = [];
  if (parallelWork) {
    // Ticket-level dependencies reference ticket ids; the executable lane
    // graph must reference lane ids, so remap them (drop dangling ticket
    // references only when the graph already omitted the dependency).
    const laneByTicket = new Map(parallelWork.lanes.flatMap((entry) => entry.tickets.map((ticket) => [ticket, entry.id])));
    const writerLanes = parallelWork.lanes.map((entry) => ({
      ...entry,
      ticketDependencies: Array.isArray(entry.dependsOn) ? [...entry.dependsOn] : [],
      dependsOn: (Array.isArray(entry.dependsOn) ? entry.dependsOn : [])
        .map((dependency) => laneByTicket.get(dependency) ?? null)
        .filter((dependency) => typeof dependency === "string"),
      // Parallel ticket writers retain disjoint ownership and each performs
      // the writer-owned anti-slop phases on its own surfaces.
      antiSlopPhases: writerPhaseContracts.map((phase) => ({ ...phase })),
    }));
    const integrationLane = lane({
      id: "integration",
      role: "orchestrator",
      type: "integration-barrier",
      execution: "sequential-after-writers",
      model: models.parent,
      ownership: contract.scope,
      contract,
      checks: parallelWork.integrationChecks,
      stopCondition: "Integrate every terminal writer lane, verify ancestry and conflicts, then run the declared integration checks exactly once.",
      phase: "integration",
      dependsOn: writerLanes.map((entry) => entry.id),
      writerCount: 0,
      integrationChecksRunCount: 1,
    });
    lanes.push(...writerLanes, integrationLane);
    lanes.push(lane({
      id: "review-standards",
      role: "reviewer",
      type: "independent-review",
      execution: "sequential-after-integration",
      model: models.reviewer,
      ownership: contract.scope,
      contract,
      checks: contract.checks,
      stopCondition: "Review the integrated diff against repository standards, architecture, correctness, regressions, maintainability, and missing tests; do not edit.",
      independent: true,
      readOnly: true,
      reviewFocus: "standards",
      phase: "post-integration-review",
      dependsOn: ["integration"],
    }));
    const parallelSpecialistIds = specialistLaneIds(risks);
    lanes.push(...antiSlopReviewLanes(contract, {
      reviewDependsOn: ["integration"],
      correctionDependsOn: ["review-standards", "review-test-value", ...parallelSpecialistIds],
      correctionStopSuffix: correctionStopSuffix([
        "the standards review",
        "the test-value review",
        ...risks.map((risk) => `the ${risk.id} specialist review`),
      ]),
    }, correctionContract).map((entry) => ({
      ...entry,
      execution: entry.id === "review-test-value"
        ? "sequential-after-integration"
        : entry.id === "correction"
          ? "sequential-after-review"
          : "sequential-after-correction",
      phase: entry.id === "review-test-value"
        ? "post-integration-review"
        : entry.id === "correction"
          ? "post-integration-correction"
          : "post-integration-verification",
    })));
    lanes.push(...specialistLanes(risks, contract).map((specialist) => ({ ...specialist, phase: "post-integration-review", dependsOn: ["integration"] })));
  } else if (computerUse.requested && computerUse.qaOnly) {
    lanes.push(computerUseRunnerLane(contract.authorizationBoundaries, executionPlan, true));
    lanes.push(verificationJudgmentLane(contract));
  } else if (mode === "direct") {
    lanes.push(lane({ id: "direct", role: "fast_implementer", type: "direct-fast-execution", model: models.writer, modelRoute: fastChainRoute("fast-execution"), ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition, readOnly: signals.readOnly === true }));
  } else if (codeMode.eligible) {
    lanes.push(lane({ id: "analysis", role: "docs_researcher", type: "analysis", execution: "code-mode-attempt", executionPreference: "code-mode", executionFallback: "sequential-read-only-tools", model: models.research, ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition, readOnly: true }));
    lanes.push(...specialistLanes(risks, contract));
  } else if (readOnlyRun) {
    // Any non-trivial read-only run owns no writable surface regardless of its
    // declared kind: the work routes to a single read-only analysis lane, with
    // a Code Mode attempt preference only when the lane is eligible.
    lanes.push(lane({ id: "analysis", role: "docs_researcher", type: "analysis", execution: "sequential", model: models.research, ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition, readOnly: true }));
    lanes.push(...specialistLanes(risks, contract));
  } else {
    const writeSpecialistIds = specialistLaneIds(risks);
    lanes.push(lane({ id: "writer", role: writerIdentity.role, type: writerIdentity.type, execution: "sequential", model: models.writer, modelRoute: fastChainRoute("implementation-default"), ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition, readOnly: false, antiSlopPhases: writerPhaseContracts.map((phase) => ({ ...phase })), dependsOn: [] }));
    // Selected specialist reviews run after the writer and gate the correction
    // lane, so their blocker/high findings cannot be bypassed.
    lanes.push(...antiSlopReviewLanes(contract, {
      reviewDependsOn: ["writer", ...writeSpecialistIds],
      correctionDependsOn: ["review-test-value", ...writeSpecialistIds],
      correctionStopSuffix: correctionStopSuffix([
        "the test-value review",
        ...risks.map((risk) => `the ${risk.id} specialist review`),
      ]),
    }, correctionContract));
    lanes.push(...specialistLanes(risks, contract, ["writer"]));
  }
  if (simplifyCode.selected && mode !== "direct" && mode !== "parallel" && !computerUse.qaOnly) lanes.push(lane({ id: "simplify-code", role: "simplify-code", type: "simplification-review", execution: "sequential", model: models.reviewer, ownership: contract.scope, contract, checks: contract.checks, stopCondition: "Return safe deletion, reuse, native, or installed-dependency suggestions without editing.", readOnly: true, dependsOn: readOnlyRun ? [] : ["writer"] }));
  if (computerUse.requested && !computerUse.qaOnly) {
    const execution = computerUseRunnerLane(
      contract.authorizationBoundaries,
      executionPlan,
      computerUse.readOnly || executionPlan?.sideEffectMode === "none",
    );
    const judgment = verificationJudgmentLane(contract);
    const dependsOn = antiSlopApplicable
      ? ["review-objective-verification"]
      : mode === "direct"
        ? ["direct"]
        : [];
    lanes.push({
      ...execution,
      ...(mode === "parallel" ? { phase: "post-correction-product-verification" } : {}),
      dependsOn,
    });
    lanes.push({ ...judgment, dependsOn: ["computer-use-execution"] });
  }
  const topology = trustedTopologyExpectations
    ? buildCandidateAntiSlopTopology(trustedTopologyExpectations)
    : null;
  const antiSlop = antiSlopProtocol(mode, signals, topology);
  if (readOnlyRun && lanes.some((entry) => entry.readOnly !== true)) {
    return blockedPlan(["non-trivial read-only plans cannot contain a writable lane"], contract, correctionContract);
  }
  if (readOnlyRun && computerUse.requested && (!executionPlan || executionPlan.sideEffectMode !== "none")) {
    return blockedPlan(["read-only Computer Use requires an execution plan with sideEffectMode none"], contract, correctionContract);
  }
  const laneErrors = validateAntiSlopLanes(lanes, antiSlop, trustedTopologyExpectations);
  if (laneErrors.length > 0) return blockedPlan(laneErrors, contract, correctionContract);
  const planPayload = {
    schemaVersion: 1,
    operation: "orchestration-plan",
    valid: true,
    errors: [],
    contract,
    mode,
    antiSlop,
    correctionContract,
    executionReceiptValidation: { provided: false, valid: false, errors: [] },
    lanes,
    codeMode,
    simplifyCode,
    computerUse,
    parallelWork,
    authority: {
      launchesAgents: false,
      writesFiles: false,
      externalWrites: false,
      promotion: false,
    },
    externalWriteIntents: computerUse.externalWriteIntents,
    possibleExternalSideEffects: computerUse.possibleExternalSideEffects,
    externalSideEffects: [],
  };
  const planningInputPayload = {
    taskContract: contract,
    signals,
    workGraph: input.workGraph ?? null,
    specialistRisks: risks,
    trustedTopologyExpectations,
  };
  return {
    ...planPayload,
    hostValidation: {
      schemaVersion: 1,
      contractId: hostValidationContractId,
      expectedPlanningInputSha256: sha256Canonical(planningInputPayload),
      expectedCompletePlanSha256: sha256Canonical(planPayload),
      expectedCorrectionContractSha256: sha256Canonical(correctionContract),
      trustedAntiSlopExpectations: trustedTopologyExpectations,
      retention: "host-private-and-separate-from-runtime-correction-input",
    },
  };
}

/** @param {Array<{id: string, evidence: string[], surfaces: string[]}>} risks @returns {string[]} */
function specialistLaneIds(risks) {
  return risks.map((risk) => `specialist-${risk.id}`);
}

/**
 * Correction may only terminate after it resolves, or explicitly blocks on,
 * every blocker or high finding reported by each gating review.
 * @param {string[]} reviewNames
 */
function correctionStopSuffix(reviewNames) {
  if (reviewNames.length === 0) return "";
  const list = reviewNames.length === 1
    ? reviewNames[0]
    : `${reviewNames.slice(0, -1).join(", ")}, and ${reviewNames[reviewNames.length - 1]}`;
  return ` Resolve or explicitly block on every blocker or high finding reported by ${list} before reaching a terminal state.`;
}

/** @param {Array<{id: string, evidence: string[], surfaces: string[]}>} risks @param {Record<string, unknown>} contract @param {string[]} [dependsOn] */
function specialistLanes(risks, contract, dependsOn = []) {
  return risks.map((risk) => {
    const specialist = specialistMap[risk.id];
    return lane({
      id: `specialist-${risk.id}`,
      role: specialist.role,
      type: "specialist-review",
      execution: "sequential",
      model: specialist.model,
      ownership: risk.surfaces.length > 0 ? risk.surfaces : contract.scope,
      contract,
      checks: contract.checks,
      evidence: risk.evidence,
      stopCondition: `Review the observed ${risk.id} risk and return evidence-backed findings.`,
      independent: true,
      readOnly: true,
      dependsOn: [...dependsOn],
    });
  });
}

/** @param {string[]} authorizationBoundaries @param {ReturnType<typeof validateExecutionPlanInput>} executionPlan @param {boolean} [readOnly] */
function computerUseRunnerLane(authorizationBoundaries, executionPlan, readOnly = false) {
  // Do not pass the task contract to the executor. Acceptance, checks, and
  // expected outputs are judge-only context and must stay outside runner JSON.
  const result = /** @type {Record<string, unknown>} */ ({
    id: "computer-use-execution",
    role: "computer_use_runner",
    type: "computer-use-execution",
    execution: "sequential",
    model: models.computerUseRunner,
    readOnly,
    sideEffectMode: readOnly ? "none" : executionPlan?.sideEffectMode ?? null,
    authorizationBoundaries: [...authorizationBoundaries],
    executionPlanInput: "execution-plan.json",
    executionPlanBinding: executionPlan ? {
      version: executionPlan.version,
      sha256: executionPlan.sha256,
      allowedOrigins: [...executionPlan.allowedOrigins],
      allowedPathPatterns: [...executionPlan.allowedPathPatterns],
      allowedActions: [...executionPlan.allowedActions],
      inputReferences: [...executionPlan.inputReferences],
      steps: executionPlan.steps.map((step) => ({ ...step })),
      sideEffectMode: executionPlan.sideEffectMode,
      evidencePath: executionPlan.evidencePath,
    } : null,
    verifiesPlanSha256: true,
    ignoresUntrustedInstructions: true,
    unexpectedNavigationOrAction: "stop-and-report",
    scopeExpansion: "stop-and-report",
    evidenceRoot: "host-private",
    neutralRecordShape: {
      executionStatus: ["complete", "incomplete"],
      fields: ["lastCompletedStep", "actions", "observations", "screenshots", "video", "runtimeErrors", "unexpectedStates"],
    },
    probeRequirements: ["before-execution", "after-execution"],
    semanticJudgment: false,
  });
  return result;
}

/** @param {Record<string, unknown>} contract */
function verificationJudgmentLane(contract) {
  return lane({
    id: "verification-judgment",
    role: "verification_judge",
    type: "verification-judgment",
    execution: "sequential",
    model: models.parent,
    ownership: contract.scope,
    contract,
    checks: contract.checks,
    stopCondition: "Compare neutral execution evidence with the private acceptance rubric and before/after probes; return the semantic result.",
    independent: true,
    readOnly: true,
    privateAcceptanceRubric: true,
    judgmentValues: ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"],
    evidenceInputs: ["neutral-execution-record", "before-execution-probe", "after-execution-probe"],
  });
}

/** @param {Record<string, unknown>} value */
function lane(value) {
  const contract = isRecord(value.contract) ? value.contract : {};
  return {
    ...value,
    objective: contract.objective ?? null,
    inputs: Array.isArray(contract.inputs) ? [...contract.inputs] : [],
    constraints: Array.isArray(contract.constraints) ? [...contract.constraints] : [],
    outOfScope: Array.isArray(contract.outOfScope) ? [...contract.outOfScope] : [],
    acceptance: Array.isArray(contract.acceptance) ? [...contract.acceptance] : [],
    expectedOutputs: Array.isArray(contract.expectedOutputs) ? [...contract.expectedOutputs] : [],
    protectedBoundaries: Array.isArray(contract.protectedBoundaries) ? [...contract.protectedBoundaries] : [],
    authorizationBoundaries: Array.isArray(contract.authorizationBoundaries) ? [...contract.authorizationBoundaries] : [],
    ownership: Array.isArray(value.ownership) ? [...value.ownership] : [],
    model: isRecord(value.model) ? { ...value.model } : {},
    checks: Array.isArray(value.checks) ? [...value.checks] : [],
    stopCondition: value.stopCondition ?? null,
    terminalStateRequired: true,
  };
}

/** @param {string[]} errors @param {Record<string, unknown>} [contract] @param {ReturnType<typeof buildCorrectionContract>} [correctionContract] */
function blockedPlan(errors, contract = {
  objective: "",
  scope: [],
  inputs: [],
  constraints: [],
  outOfScope: [],
  acceptance: [],
  expectedOutputs: [],
  checks: [],
  protectedBoundaries: [],
  authorizationBoundaries: [],
  stopCondition: "",
}, correctionContract = buildCorrectionContract([])) {
  return {
    schemaVersion: 1,
    operation: "orchestration-plan",
    valid: false,
    errors,
    contract,
    mode: "blocked",
    lanes: [],
    antiSlop: buildAntiSlopProtocol({ applicable: false, reason: "Invalid execution contract." }),
    correctionContract,
    executionReceiptValidation: { provided: false, valid: false, errors: [] },
    codeMode: { eligible: false, selected: false, selectionAuthority: "host-runtime", executor: null, fallback: "blocked", reason: "Invalid execution contract." },
    simplifyCode: { selected: false, reason: "Invalid execution contract." },
    computerUse: { requested: false, qaOnly: false, readOnly: false, executor: null, executorModel: null, judgmentOwner: null, judgmentRole: null, probeOrder: [], rubricVisibility: null, browserAuthority: "host-runtime", sideEffectMode: null, executionPlanBinding: null, externalWriteIntents: [], possibleExternalSideEffects: [] },
    authority: { launchesAgents: false, writesFiles: false, externalWrites: false, promotion: false },
    externalWriteIntents: [],
    possibleExternalSideEffects: [],
    externalSideEffects: [],
  };
}
