// @ts-check

import { createHash } from "node:crypto";
import { readLifecycleState, runLifecycleRequest } from "./lifecycle.mjs";
import { assessWorkingBackwardsRisk } from "./working-backwards-risk.mjs";
import { createHumanLayerAdapter } from "./humanlayer-adapter.mjs";
import { prepareTicketPublication } from "./working-backwards-handoff.mjs";

/** @typedef {object} Feature
 * @property {string | undefined} featureId
 * @property {string} title
 * @property {string} userOutcome
 * @property {string} actor
 * @property {string} problem
 * @property {string} scope
 * @property {string} experience
 * @property {string[]} acceptanceCriteria
 * @property {string[]} evidenceGaps
 * @property {string[]} notBuilding
 * @property {string[]} risks
 * @property {boolean} behaviorSettled
 * @property {boolean} scopeNarrow
 * @property {boolean} rollbackEasy
 * @property {boolean} singleSurface
 * @property {unknown} [riskTriggers]
 * @property {unknown} [newDomainInvariant]
 * @property {unknown} [authorization]
 * @property {unknown} [sensitiveData]
 * @property {unknown} [destructive]
 * @property {unknown} [migration]
 * @property {unknown} [backfill]
 * @property {unknown} [paidActivation]
 * @property {unknown} [externalProvider]
 * @property {unknown} [multiRepository]
 * @property {unknown} [difficultRollback]
 */

/** @typedef {object} Artifact
 * @property {string} id
 * @property {string} role
 * @property {number} version
 * @property {string} status
 * @property {string} visibility
 * @property {string} sourceRevision
 * @property {unknown} content
 * @property {string} contentHash
 * @property {{dependsOn: string[], governedBy: string[], sourceRevision: string}} lineage
 */

/** @typedef {object} ScenarioOptions
 * @property {string} home
 * @property {string} [workflowId]
 * @property {unknown} [feature]
 * @property {unknown} [featureIdea]
 * @property {unknown} [repository]
 * @property {unknown} [profile]
 * @property {unknown} [profileEvidence]
 * @property {unknown} [artifactState]
 * @property {unknown} [humanLayer]
 * @property {unknown} [riskEvidence]
 * @property {unknown} [evidence]
 * @property {unknown[]} [gateOperations]
 */

/** @typedef {object} ProfileDecision
 * @property {string} recommended
 * @property {string} selected
 * @property {string} requested
 * @property {string} reason
 * @property {string[]} hardRiskTriggers
 * @property {boolean} quickEligible
 */

const profileOrder = ["Quick", "Standard", "Complex"];

/** @type {readonly string[]} */
export const WORKING_BACKWARDS_ROLES = [
  "working-backwards-brief",
  "research-questions",
  "research-report",
  "product-contract",
  "domain-technical-design",
  "structure-outline",
  "ticket-map",
  "t3-implementation-handoff",
];

/** @type {Record<string, string[]>} */
const roleDependencies = {
  "working-backwards-brief": [],
  "research-questions": ["working-backwards-brief"],
  "research-report": ["research-questions"],
  "product-contract": ["working-backwards-brief", "research-report"],
  "domain-technical-design": ["product-contract", "research-report"],
  "risk-evidence": ["domain-technical-design"],
  "structure-outline": ["product-contract", "domain-technical-design", "risk-evidence"],
  "ticket-map": ["structure-outline"],
  "t3-implementation-handoff": ["ticket-map", "structure-outline"],
};

const quickRoles = [
  "working-backwards-brief",
  "acceptance-contract",
  "structure-outline",
  "t3-implementation-handoff",
];

const standardRoles = [...WORKING_BACKWARDS_ROLES];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {unknown} */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  const record = /** @type {Record<string, unknown>} */ (value);
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

/** @param {unknown} value */
function contentHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

/** @param {unknown} feature @returns {Feature} */
function normalizeFeature(feature) {
  if (typeof feature === "string") return {
    featureId: undefined,
    title: feature,
    userOutcome: feature,
    actor: "persona usuaria",
    problem: "",
    scope: "",
    experience: feature,
    acceptanceCriteria: [],
    evidenceGaps: [],
    notBuilding: [],
    risks: [],
    behaviorSettled: false,
    scopeNarrow: false,
    rollbackEasy: false,
    singleSurface: false,
  };
  if (!isRecord(feature)) throw new Error("working-backwards requires a feature idea");
  const value = /** @type {Record<string, unknown>} */ (feature);
  /** @type {(candidate: unknown) => string[]} */
  const list = (candidate) => Array.isArray(candidate)
    ? candidate.filter((entry) => typeof entry === "string")
    : [];
  const userOutcome = value.userOutcome ?? value.desiredOutcome ?? value.outcome;
  if (typeof userOutcome !== "string" || userOutcome.trim().length === 0) {
    throw new Error("working-backwards requires feature.userOutcome");
  }
  return {
    featureId: typeof value.featureId === "string" ? value.featureId : undefined,
    title: typeof value.title === "string" ? value.title : userOutcome,
    userOutcome: userOutcome.trim(),
    actor: typeof value.actor === "string" ? value.actor : "persona usuaria",
    problem: typeof value.problem === "string" ? value.problem : "",
    scope: typeof value.scope === "string" ? value.scope : "",
    experience: typeof value.experience === "string" ? value.experience : userOutcome.trim(),
    acceptanceCriteria: list(value.acceptanceCriteria),
    evidenceGaps: list(value.evidenceGaps),
    notBuilding: list(value.notBuilding),
    risks: list(value.risks),
    behaviorSettled: value.behaviorSettled === true,
    scopeNarrow: value.scopeNarrow === true,
    rollbackEasy: value.rollbackEasy === true,
    singleSurface: value.singleSurface === true,
  };
}

/** @param {Record<string, unknown>} feature @param {Record<string, unknown>} repository */
function findHardRiskTriggers(feature, repository) {
  const triggers = [];
  const riskValues = [
    ...(Array.isArray(feature.risks) ? feature.risks : []),
    ...(Array.isArray(feature.riskTriggers) ? feature.riskTriggers : []),
    ...(Array.isArray(repository.riskTriggers) ? repository.riskTriggers : []),
  ].map((entry) => String(entry).toLowerCase());
  const booleanTriggers = /** @type {[string, unknown][]} */ ([
    ["domain-invariant", feature.newDomainInvariant],
    ["authorization", feature.authorization],
    ["sensitive-data", feature.sensitiveData],
    ["destructive-behavior", feature.destructive],
    ["migration", feature.migration],
    ["backfill", feature.backfill],
    ["paid-activation", feature.paidActivation],
    ["external-provider", feature.externalProvider],
    ["multi-repository", feature.multiRepository],
    ["difficult-rollback", feature.difficultRollback],
  ]);
  for (const [name, enabled] of booleanTriggers) if (enabled === true) triggers.push(name);
  const patterns = /** @type {[string, RegExp][]} */ ([
    ["domain-invariant", /invariant|invariante|entidad nueva/],
    ["authorization", /authoriz|permiso|autentic/],
    ["sensitive-data", /sensitive|sensible|personal data|datos personales/],
    ["destructive-behavior", /destruct|delete|elimin/],
    ["migration", /migration|migracion|backfill/],
    ["paid-activation", /paid|pago|cost|costo/],
    ["external-provider", /provider|proveedor|webhook/],
    ["multi-repository", /multi.?repo|multiple repos/],
    ["difficult-rollback", /difficult rollback|irreversible|dificil de revertir/],
  ]);
  for (const [name, pattern] of patterns) {
    if (riskValues.some((value) => pattern.test(value)) && !triggers.includes(name)) triggers.push(name);
  }
  return triggers;
}

/** @param {{feature?: unknown, repository?: unknown, profile?: unknown, profileEvidence?: unknown}} options @returns {ProfileDecision} */
export function recommendWorkingBackwardsProfile(options = {}) {
  const { feature, repository = {}, profile, profileEvidence } = options;
  const normalizedFeature = normalizeFeature(feature);
  const normalizedRepository = isRecord(repository) ? /** @type {Record<string, unknown>} */ (repository) : {};
  const hardRiskTriggers = findHardRiskTriggers(normalizedFeature, normalizedRepository);
  const quickEligible =
    normalizedFeature.behaviorSettled &&
    normalizedFeature.scopeNarrow &&
    normalizedFeature.rollbackEasy &&
    normalizedFeature.singleSurface &&
    hardRiskTriggers.length === 0;
  const recommended = hardRiskTriggers.length > 0 ? "Complex" : quickEligible ? "Quick" : "Standard";
  const requested =
    typeof profile === "string"
      ? profile
      : isRecord(profileEvidence) && typeof /** @type {Record<string, unknown>} */ (profileEvidence).selected === "string"
        ? /** @type {string} */ (/** @type {Record<string, unknown>} */ (profileEvidence).selected)
        : recommended;
  const requestedProfile = profileOrder.includes(requested) ? requested : recommended;
  const selected =
    hardRiskTriggers.length > 0 && requestedProfile !== "Complex"
      ? "Complex"
      : profileOrder.indexOf(requestedProfile) < profileOrder.indexOf(recommended)
        ? recommended
        : requestedProfile;
  const reason = hardRiskTriggers.length
    ? `Hard risk triggers require at least Complex: ${hardRiskTriggers.join(", ")}.`
    : recommended === "Quick"
      ? "Behavior is settled, narrow, reversible, and limited to one surface."
      : "Evidence does not justify Quick; Standard is the default definition depth.";
  return {
    recommended,
    selected,
    requested: requestedProfile,
    reason,
    hardRiskTriggers,
    quickEligible,
  };
}

/** @param {string} role @param {string} workflowId */
function artifactId(role, workflowId) {
  return `${workflowId}:${role}`;
}

/** @param {Record<string, unknown>} options @param {ProfileDecision} profile @param {Feature} feature @param {ReturnType<typeof assessWorkingBackwardsRisk>} risk @returns {Map<string, unknown>} */
function artifactContent(options, profile, feature, risk) {
  const repository = isRecord(options.repository) ? /** @type {Record<string, unknown>} */ (options.repository) : {};
  const observed = typeof repository.observed === "string" ? repository.observed : "Estado actual pendiente de observar.";
  const criteria = feature.acceptanceCriteria.length > 0
    ? feature.acceptanceCriteria
    : [feature.userOutcome];
  const brief = {
    title: feature.title,
    actor: feature.actor,
    userOutcome: feature.userOutcome,
    problem: feature.problem,
    experience: feature.experience,
    scope: feature.scope,
    risks: feature.risks,
    evidenceGaps: feature.evidenceGaps,
    notBuilding: feature.notBuilding,
  };
  if (profile.selected === "Quick") {
    return /** @type {Map<string, unknown>} */ (new Map(/** @type {[string, unknown][]} */ ([
      ["working-backwards-brief", brief],
      ["acceptance-contract", { behavior: feature.userOutcome, acceptanceCriteria: criteria, scope: feature.scope }],
      ["structure-outline", { mode: "future-state", slices: [{ id: "slice-1", outcome: feature.userOutcome, acceptanceCriteria: criteria }] }],
      ["t3-implementation-handoff", { mode: "candidate", profile: profile.selected, firstSlice: "slice-1", acceptanceCriteria: criteria }],
    ])));
  }
  const contents = /** @type {Map<string, unknown>} */ (new Map(/** @type {[string, unknown][]} */ ([
    ["working-backwards-brief", brief],
    ["research-questions", { questions: ["¿Qué comportamiento existe hoy?", "¿Qué evidencia falta para validar el resultado?"], solutionFree: true }],
    ["research-report", { mode: "current-state", observed, repositoryRevision: repository.revision ?? repository.baseRevision ?? "unknown", answeredQuestions: ["¿Qué comportamiento existe hoy?", "¿Qué evidencia falta para validar el resultado?"] }],
    ["product-contract", { mode: "future-state", userOutcome: feature.userOutcome, actor: feature.actor, acceptanceCriteria: criteria, scope: feature.scope, errors: [], recovery: [], permissions: [], outOfScope: feature.notBuilding }],
    ["domain-technical-design", { mode: "future-state", entities: [], relationships: [], invariants: [], reads: [], writes: [], events: [], migrations: [], security: [], rejectedDecisions: [] }],
    ["structure-outline", { mode: "future-state", slices: [{ id: "slice-1", outcome: feature.userOutcome, acceptanceCriteria: criteria, dependsOn: [] }] }],
    ["ticket-map", { mode: "future-state", status: "draft", tickets: [{ id: "slice-1", title: feature.title, outcome: feature.userOutcome, acceptanceCriteria: criteria, checks: [], dependsOn: [], status: "ready-for-agent", fitsFreshContext: true, verifiable: true }] }],
    ["t3-implementation-handoff", { mode: "candidate", profile: profile.selected, firstSlice: "slice-1", acceptanceCriteria: criteria, implementationAuthorized: false }],
  ])));
  if (risk.hardRiskTriggers.length > 0) {
    contents.set("risk-evidence", {
      mode: "risk-specific",
      hardRiskTriggers: risk.hardRiskTriggers,
      requirements: risk.requestedEvidence,
      checks: risk.evidenceChecks,
      technicalGate: risk.technicalGate,
    });
  }
  return contents;
}

/** @param {string[]} roles @param {string} role */
function dependenciesFor(roles, role) {
  return (roleDependencies[role] ?? []).filter((dependency) => roles.includes(dependency));
}

/** @param {Record<string, unknown>} options @returns {Record<string, unknown>[]} */
function readArtifactState(options) {
  const state = options.artifactState;
  if (Array.isArray(state)) return state.filter(isRecord).map((entry) => /** @type {Record<string, unknown>} */ (entry));
  if (isRecord(state) && Array.isArray(state.artifacts)) {
    const artifacts = /** @type {unknown[]} */ (state.artifacts);
    return artifacts.filter(isRecord).map((entry) => /** @type {Record<string, unknown>} */ (entry));
  }
  return [];
}

/** @param {unknown} operation */
function normalizeGate(operation) {
  const text = String(operation).toLowerCase().replace(/[_\s]+/g, "-");
  if (/product|requirements/.test(text) && /approved|approve/.test(text)) return "product";
  if (/technical|spec|plan/.test(text) && /approved|approve/.test(text)) return "technical";
  if (/implementation|map|ticket/.test(text) && /approved|approve/.test(text)) return "implementationMap";
  return null;
}

/** @param {ScenarioOptions} options */
async function applyExplicitGates(options) {
  const operations = Array.isArray(options.gateOperations) ? options.gateOperations : [];
  const receipts = [];
  const humanLayer = isRecord(options.humanLayer) ? /** @type {Record<string, unknown>} */ (options.humanLayer) : null;
  if (humanLayer && (humanLayer.comments || humanLayer.taskStatus || humanLayer.autoAdvance)) {
    receipts.push({ adapter: "humanlayer", accepted: false, reason: "feedback-only" });
  }
  let state = await readLifecycleState({ home: options.home, workflowId: options.workflowId ?? "working-backwards" });
  const canonical = ["product", "technical", "implementationMap"];
  for (const requested of operations) {
    const requestRecord = isRecord(requested) ? /** @type {Record<string, unknown>} */ (requested) : null;
    const raw = requestRecord ? requestRecord.gate ?? requestRecord.operation : requested;
    const gate = normalizeGate(raw);
    if (!gate || (requestRecord && requestRecord.source === "humanlayer")) continue;
    const index = canonical.indexOf(gate);
    if (index < 0) continue;
    const requests = [
      ["start_requirements", "Inicia grill-with-docs para Working Backwards"],
      ["approve_requirements", "Apruebo los requisitos de Working Backwards"],
      ["create_spec_plan", "Genera el spec y Local Visual Plan con Working Backwards"],
      ["approve_spec_plan", "Apruebo el spec y el Local Visual Plan de Working Backwards"],
      ["create_tickets", "Convierte el spec aprobado a tickets con Working Backwards"],
      ["approve_tickets", "Apruebo los tickets de Working Backwards"],
    ];
    const requiredStage = ["requirements_approved", "spec_plan_approved", "tickets_approved"][index];
    if (state.stage === requiredStage) {
      receipts.push({ adapter: "development-system", gate, accepted: true, status: "already-approved" });
      continue;
    }
    const start = index * 2;
    for (let requestIndex = start; requestIndex <= start + 1; requestIndex += 1) {
      const response = await runLifecycleRequest({ home: options.home, workflowId: options.workflowId ?? "working-backwards", mode: "transition", request: requests[requestIndex][1] });
      if (!response.ok) {
        receipts.push({ adapter: "development-system", gate, accepted: false, reason: response.transition?.reason ?? "gate-denied" });
        break;
      }
      state = response.state;
    }
    if (state.stage === requiredStage) receipts.push({ adapter: "development-system", gate, accepted: true, status: "approved" });
  }
  return { state, receipts };
}

/** @param {{stage: string}} state @param {string[]} roles */
function gateState(state, roles) {
  const stageRank = ["idle", "requirements_in_progress", "requirements_approved", "spec_plan_ready", "spec_plan_approved", "tickets_ready", "tickets_approved", "delivery_authorized", "pre_release_ready"];
  const rank = stageRank.indexOf(state.stage);
  return {
    product: { id: "product-contract-approved", status: rank >= 2 ? "approved" : "pending", requiredStage: "requirements_approved", artifactRoles: roles.filter((role) => ["working-backwards-brief", "research-questions", "research-report", "product-contract"].includes(role)) },
    technical: { id: "technical-contract-approved", status: rank >= 4 ? "approved" : "pending", requiredStage: "spec_plan_approved", artifactRoles: roles.filter((role) => ["product-contract", "domain-technical-design", "risk-evidence"].includes(role)) },
    implementationMap: { id: "implementation-map-approved", status: rank >= 6 ? "approved" : "pending", requiredStage: "tickets_approved", artifactRoles: roles.filter((role) => ["structure-outline", "ticket-map"].includes(role)) },
  };
}

/** @param {Artifact[]} artifacts @param {Record<string, unknown>[]} existing */
function applyExistingState(artifacts, existing) {
  const byRole = /** @type {Map<string, Record<string, unknown>>} */ (new Map(existing.map((entry) => [String(entry.role), entry])));
  const changedRoles = new Set();
  for (const artifact of artifacts) {
    const previous = byRole.get(artifact.role);
    if (!previous) continue;
    if (previous.content !== undefined) artifact.content = previous.content;
    if (previous.status === "approved") artifact.status = "approved";
    const actualHash = contentHash(artifact.content);
    if (previous.status === "approved" && previous.contentHash && previous.contentHash !== actualHash) changedRoles.add(artifact.role);
    if (typeof previous.visibility === "string") artifact.visibility = previous.visibility;
  }
  const affected = new Set();
  for (const role of changedRoles) {
    for (const artifact of artifacts) {
      if (!byRole.has(artifact.role) || artifact.role === role) continue;
      const queue = /** @type {string[]} */ ([artifact.role]);
      const seen = new Set();
      while (queue.length > 0) {
        const candidate = queue.shift();
        if (candidate === undefined) continue;
        if (candidate === role) {
          affected.add(artifact.role);
          break;
        }
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        for (const dependency of roleDependencies[candidate] ?? []) queue.push(dependency);
      }
    }
  }
  for (const artifact of artifacts) if (affected.has(artifact.role)) artifact.status = "stale";
  return { changedRoles, affected };
}

/** @param {Set<string>} changedRoles @param {Set<string>} affected */
function smallestResumeStage(changedRoles, affected) {
  const roles = new Set([...changedRoles, ...affected]);
  if (["working-backwards-brief", "research-questions", "research-report"].some((role) => roles.has(role))) return "requirements";
  if (["product-contract", "domain-technical-design", "risk-evidence"].some((role) => roles.has(role))) return "technical-contract";
  if (["structure-outline", "ticket-map"].some((role) => roles.has(role))) return "implementation-map";
  return null;
}

/** @param {Partial<ScenarioOptions>} options */
export async function runWorkingBackwardsScenario(options = {}) {
  const featureInput = options.feature ?? options.featureIdea;
  const feature = normalizeFeature(featureInput);
  const repository = isRecord(options.repository) ? /** @type {Record<string, unknown>} */ (options.repository) : {};
  const risk = assessWorkingBackwardsRisk({
    feature: featureInput,
    repository,
    profile: options.profile ?? (isRecord(options.profileEvidence) ? options.profileEvidence : undefined),
    riskEvidence: options.riskEvidence ?? options.evidence,
  });
  const profile = {
    ...risk,
    recommended: risk.recommendedProfile,
    selected: risk.selectedProfile,
    requested: risk.requestedProfile ?? risk.recommendedProfile,
    reason: risk.hardRiskTriggers.length > 0
      ? `Hard risk triggers require at least Complex: ${risk.hardRiskTriggers.join(", ")}.`
      : risk.recommendedProfile === "Quick"
        ? "Behavior is settled, narrow, reversible, and limited to one surface."
        : "Evidence does not justify Quick; Standard is the default definition depth.",
  };
  const gateOptions = /** @type {ScenarioOptions} */ ({ ...options, home: options.home ?? ".", workflowId: options.workflowId ?? feature.featureId ?? "working-backwards" });
  const gateResult = await applyExplicitGates(gateOptions);
  const roles = profile.selected === "Quick"
    ? quickRoles
    : risk.hardRiskTriggers.length > 0
      ? [...standardRoles.slice(0, 5), "risk-evidence", ...standardRoles.slice(5)]
      : standardRoles;
  const contents = artifactContent(options, profile, feature, risk);
  const existing = readArtifactState(options);
  const artifacts = /** @type {Artifact[]} */ (roles.map((role) => {
    const content = contents.get(role) ?? {};
    const dependsOn = dependenciesFor(roles, role).map((dependency) => artifactId(dependency, options.workflowId ?? feature.featureId ?? "working-backwards"));
    const visibility = role === "t3-implementation-handoff" ? "private" : "portable";
    return {
      id: artifactId(role, options.workflowId ?? feature.featureId ?? "working-backwards"),
      role,
      version: 1,
      status: role === "t3-implementation-handoff" ? "candidate" : "draft",
      visibility,
      sourceRevision: repository.revision ?? repository.baseRevision ?? "unknown",
      content,
      contentHash: contentHash(content),
      lineage: { dependsOn, governedBy: dependsOn, sourceRevision: repository.revision ?? repository.baseRevision ?? "unknown" },
    };
  }));
  const staleness = applyExistingState(artifacts, existing);
  const gates = gateState(gateResult.state, roles);
  const resumeFrom = smallestResumeStage(staleness.changedRoles, staleness.affected);
  if (resumeFrom === "requirements") gates.product.status = "pending";
  if (resumeFrom === "technical-contract") gates.technical.status = "pending";
  if (resumeFrom === "implementation-map") gates.implementationMap.status = "pending";
  if (risk.technicalGate.status === "blocked") gates.technical.status = "blocked";
  for (const artifact of artifacts) {
    if (artifact.role === "risk-evidence" && risk.technicalGate.status === "blocked") artifact.status = "blocked";
    else if (gates.product.status === "approved" && gates.product.artifactRoles.includes(artifact.role)) artifact.status = "approved";
    else if (gates.technical.status === "approved" && gates.technical.artifactRoles.includes(artifact.role)) artifact.status = "approved";
    else if (gates.implementationMap.status === "approved" && gates.implementationMap.artifactRoles.includes(artifact.role)) artifact.status = "approved";
  }
  const allGatesApproved = Object.values(gates).every((gate) => gate.status === "approved");
  const handoff = artifacts.find((artifact) => artifact.role === "t3-implementation-handoff");
  if (handoff && allGatesApproved && staleness.affected.size === 0) handoff.status = "ready";
  const featureId = feature.featureId ?? options.workflowId ?? "working-backwards";
  const ticketMapArtifact = artifacts.find((artifact) => artifact.role === "ticket-map");
  const governingArtifacts = artifacts.filter((artifact) => artifact.status === "approved" && artifact.role !== "t3-implementation-handoff");
  const publicationIntent = allGatesApproved && ticketMapArtifact
    ? prepareTicketPublication({
        workflowId: options.workflowId ?? featureId,
        ticketMap: { .../** @type {Record<string, unknown>} */ (ticketMapArtifact.content), status: "approved" },
        approvedArtifacts: governingArtifacts,
        repository,
      })
    : { ok: false, operation: "prepare-ticket-publication", errors: ["all three definition gates are required"], externalSideEffects: [] };
  const humanLayerInput = isRecord(options.humanLayer) ? options.humanLayer : {};
  const humanLayerAdapter = createHumanLayerAdapter({ config: isRecord(humanLayerInput.config) ? humanLayerInput.config : undefined });
  const humanLayerObservation = humanLayerInput.observation === undefined
    ? null
    : await humanLayerAdapter.probeReadOnly({ skill: "working-backwards", observation: humanLayerInput.observation });
  const humanLayer = {
    config: humanLayerAdapter.config,
    observation: humanLayerObservation,
    receipt: humanLayerAdapter.receipt(isRecord(humanLayerInput.receipt) ? humanLayerInput.receipt : {}),
    feedback: humanLayerAdapter.feedbackReceipt(humanLayerInput),
  };
  return {
    ok: true,
    operation: "working-backwards",
    workflowId: options.workflowId ?? featureId,
    featureId,
    profile,
    risk,
    artifacts,
    gates,
    staleArtifacts: artifacts.filter((artifact) => artifact.status === "stale").map((artifact) => artifact.id),
    resumeFrom,
    handoffEligible: allGatesApproved && staleness.affected.size === 0 && risk.technicalGate.status !== "blocked",
    publicationIntent,
    humanLayer,
    implementationAuthorized: false,
    externalSideEffects: [],
    receipts: gateResult.receipts,
    state: gateResult.state,
    nextAction: allGatesApproved ? "Implement Preview remains a separate explicit operation" : "Complete the next human gate",
  };
}

export const runWorkingBackwards = runWorkingBackwardsScenario;
