// @ts-check

import { createHash } from "node:crypto";
import { readLifecycleState, runLifecycleRequest } from "./lifecycle.mjs";
import { assessWorkingBackwardsRisk } from "./working-backwards-risk.mjs";
import { createHumanLayerAdapter } from "./humanlayer-adapter.mjs";
import { prepareTicketPublication } from "./working-backwards-handoff.mjs";
import {
  createWorkingBackwardsGateReceipt,
  persistWorkingBackwardsGateReceipt,
  readWorkingBackwardsGateReceipts,
  validateWorkingBackwardsGateReceipts,
  WORKING_BACKWARDS_GATES,
  WORKING_BACKWARDS_GATE_ROLES,
  normalizeWorkingBackwardsRepositoryIdentity,
} from "./working-backwards-gates.mjs";

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
 * @property {string[]} firstValueJourney
 * @property {unknown[]} externalFaq
 * @property {unknown[]} internalFaq
 * @property {string[]} unsupportedClaims
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
 * @property {string} sourceIdentity
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
    firstValueJourney: [],
    externalFaq: [],
    internalFaq: [],
    unsupportedClaims: [],
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
    firstValueJourney: list(value.firstValueJourney),
    externalFaq: Array.isArray(value.externalFaq) ? value.externalFaq : [],
    internalFaq: Array.isArray(value.internalFaq) ? value.internalFaq : [],
    unsupportedClaims: list(value.unsupportedClaims),
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

/** @param {unknown} value */
function textList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()) : [];
}

/** @param {unknown} value */
function faqText(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!isRecord(entry)) return [];
    return [entry.question, entry.answer].filter((candidate) => typeof candidate === "string");
  });
}

/** @param {unknown} value */
function completeFaq(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => {
    if (typeof entry === "string") return entry.trim().length > 0;
    return isRecord(entry) && typeof entry.question === "string" && entry.question.trim().length > 0 && typeof entry.answer === "string" && entry.answer.trim().length > 0;
  });
}

const suspiciousClaimPattern = /(?:user quote|testimonial|\b\d+(?:\.\d+)?%|[$€£]\s?\d|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b20\d{2}[-/]\d{1,2}|external provider|guarantee[sd]?)/i;

/** @param {Record<string, unknown>} evidence @param {string} claim */
function evidenceSupportsClaim(evidence, claim) {
  const mappedClaims = [evidence.claim, ...(Array.isArray(evidence.claims) ? evidence.claims : [])].filter((value) => typeof value === "string");
  const hash = typeof evidence.contentHash === "string" ? evidence.contentHash : "";
  const embeddedContent = evidence.content;
  const nonemptyContent = typeof embeddedContent === "string"
    ? embeddedContent.trim().length > 0
    : Array.isArray(embeddedContent)
      ? embeddedContent.length > 0
      : isRecord(embeddedContent) && Object.keys(embeddedContent).length > 0;
  const integrity = nonemptyContent && /^sha256:[a-f0-9]{64}$/.test(hash) && contentHash(embeddedContent) === hash;
  return typeof evidence.id === "string" && evidence.id.trim().length > 0 && typeof evidence.source === "string" && evidence.source.trim().length > 0 && integrity && mappedClaims.includes(claim);
}

/** @param {unknown} featureInput @param {Feature} feature @param {Record<string, unknown>} repository @param {string} profile */
function validateDefinition(featureInput, feature, repository, profile) {
  const raw = isRecord(featureInput) ? featureInput : {};
  const productErrors = [];
  const technicalErrors = [];
  if (!feature.problem.trim()) productErrors.push("missing current customer problem");
  if (!feature.scope.trim()) productErrors.push("missing explicit scope");
  if (feature.firstValueJourney.length === 0) productErrors.push("missing first-value journey");
  if (!completeFaq(feature.externalFaq)) productErrors.push("missing or incomplete external FAQ");
  if (!completeFaq(feature.internalFaq)) productErrors.push("missing or incomplete internal FAQ");
  if (feature.acceptanceCriteria.length === 0) productErrors.push("missing observable acceptance criteria");
  if (feature.evidenceGaps.length > 0) productErrors.push(`unresolved evidence gaps: ${feature.evidenceGaps.join("; ")}`);
  if (raw.productFactsResolved !== true && profile !== "Quick") productErrors.push("product facts are not explicitly resolved");
  const suspiciousClaims = [feature.title, feature.userOutcome, feature.experience, ...faqText(feature.externalFaq), ...faqText(feature.internalFaq)].filter((claim) => suspiciousClaimPattern.test(claim));
  const claimsRequiringEvidence = [...new Set([...feature.unsupportedClaims, ...suspiciousClaims])];
  const claimEvidence = Array.isArray(raw.claimEvidence) ? raw.claimEvidence.filter(isRecord) : [];
  const unsupported = claimsRequiringEvidence.filter((claim) => !claimEvidence.some((evidence) => evidenceSupportsClaim(evidence, claim)));
  if (unsupported.length > 0) productErrors.push(`unsupported quote, metric, price, date, or external capability claims: ${unsupported.join("; ")}`);
  const normalizedScope = feature.scope.trim().toLowerCase();
  if (normalizedScope && feature.notBuilding.some((entry) => entry.trim().toLowerCase() === normalizedScope)) productErrors.push("scope contradicts not-building boundary");
  if (textList(raw.scopeContradictions).length > 0) productErrors.push("explicit scope contradiction remains unresolved");
  if (typeof repository.identity !== "string" || repository.identity.trim().length === 0) productErrors.push("missing repository identity");
  if (typeof (repository.revision ?? repository.baseRevision) !== "string") productErrors.push("missing repository revision");
  if (typeof repository.observed !== "string" || repository.observed.trim().length === 0) productErrors.push("missing current repository observation");
  if (profile !== "Quick" && raw.technicalFactsResolved !== true) technicalErrors.push("technical facts are not explicitly resolved");
  return {
    ok: productErrors.length === 0 && technicalErrors.length === 0,
    product: { ok: productErrors.length === 0, errors: productErrors },
    technical: { ok: technicalErrors.length === 0, errors: technicalErrors },
    errors: [...productErrors, ...technicalErrors],
  };
}

/** @param {Feature} feature @param {Record<string, unknown>} repository */
function researchQuestions(feature, repository) {
  const questions = [];
  if (!feature.problem) questions.push("What customer problem is observed today, and where is it visible?");
  if (!feature.scope) questions.push("Which user-visible boundary is in scope, and what is excluded?");
  if (feature.acceptanceCriteria.length === 0) questions.push("What observable result proves the customer reached value?");
  if (typeof repository.observed !== "string" || repository.observed.trim().length === 0) questions.push("What behavior does the current code and runtime demonstrate?");
  for (const gap of feature.evidenceGaps) questions.push(`What evidence resolves this gap: ${gap}?`);
  for (const claim of feature.unsupportedClaims) questions.push(`What primary evidence supports or rejects this claim: ${claim}?`);
  if (questions.length === 0) questions.push("Which current-state constraints could invalidate the settled customer journey?");
  return questions;
}

/** @param {Record<string, unknown>} raw @param {string} key @param {string} unknown */
function resolvedFacts(raw, key, unknown) {
  const value = raw[key];
  if (Array.isArray(value) && value.length > 0) return value;
  return [{ status: raw.technicalFactsResolved === true ? "not-applicable" : "unknown", detail: unknown }];
}

/** @param {Record<string, unknown>} options @param {ProfileDecision} profile @param {Feature} feature @param {ReturnType<typeof assessWorkingBackwardsRisk>} risk @returns {Map<string, unknown>} */
function artifactContent(options, profile, feature, risk) {
  const repository = isRecord(options.repository) ? /** @type {Record<string, unknown>} */ (options.repository) : {};
  const rawFeature = isRecord(options.feature ?? options.featureIdea) ? /** @type {Record<string, unknown>} */ (options.feature ?? options.featureIdea) : {};
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
    unsupportedClaims: feature.unsupportedClaims,
    notBuilding: feature.notBuilding,
    firstValueJourney: feature.firstValueJourney,
    externalFaq: feature.externalFaq,
    internalFaq: feature.internalFaq,
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
    ["research-questions", { questions: researchQuestions(feature, repository), solutionFree: true }],
    ["research-report", { mode: "current-state", observed, repositoryRevision: repository.revision ?? repository.baseRevision ?? "unknown", answeredQuestions: researchQuestions(feature, repository), unknowns: feature.evidenceGaps }],
    ["product-contract", { mode: "future-state", userOutcome: feature.userOutcome, actor: feature.actor, acceptanceCriteria: criteria, scope: feature.scope, errors: resolvedFacts(rawFeature, "errors", "Error behavior requires an explicit decision."), recovery: resolvedFacts(rawFeature, "recovery", "Recovery behavior requires an explicit decision."), permissions: resolvedFacts(rawFeature, "permissions", "Permission behavior requires an explicit decision."), outOfScope: feature.notBuilding, unknowns: feature.evidenceGaps }],
    ["domain-technical-design", { mode: "future-state", entities: resolvedFacts(rawFeature, "entities", "Domain entities require an explicit decision."), relationships: resolvedFacts(rawFeature, "relationships", "Relationships require an explicit decision."), invariants: resolvedFacts(rawFeature, "invariants", "Invariants require an explicit decision."), reads: resolvedFacts(rawFeature, "reads", "Read contracts require an explicit decision."), writes: resolvedFacts(rawFeature, "writes", "Write contracts require an explicit decision."), events: resolvedFacts(rawFeature, "events", "Event contracts require an explicit decision."), migrations: resolvedFacts(rawFeature, "migrations", "Migration applicability requires an explicit decision."), security: resolvedFacts(rawFeature, "security", "Security applicability requires an explicit decision."), rejectedDecisions: resolvedFacts(rawFeature, "rejectedDecisions", "Rejected alternatives require an explicit decision.") }],
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
  const aliases = new Map([
    ["approve-product-contract", "product"],
    ["product-contract-approved", "product"],
    ["approve-requirements", "product"],
    ["approve-technical-contract", "technical"],
    ["technical-contract-approved", "technical"],
    ["approve-spec-plan", "technical"],
    ["approve-implementation-map", "implementationMap"],
    ["implementation-map-approved", "implementationMap"],
    ["approve-tickets", "implementationMap"],
  ]);
  const text = String(operation).trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (/\b(?:not|no|deny|denied|decline|revoke|cancel)\b/i.test(String(operation))) return { gate: null, reason: "negated-or-revoked-gate-operation" };
  const gate = aliases.get(text) ?? null;
  return { gate, reason: gate ? null : "unknown-or-ambiguous-gate-operation" };
}

/**
 * @param {ScenarioOptions} options
 * @param {Artifact[]} artifacts
 * @param {{product: {ok: boolean, errors: string[]}, technical: {ok: boolean, errors: string[]}}} definitionValidation
 * @param {ReturnType<typeof assessWorkingBackwardsRisk>} risk
 * @param {Record<string, unknown>[]} initialReceipts
 */
async function applyExplicitGates(options, artifacts, definitionValidation, risk, initialReceipts) {
  const operations = Array.isArray(options.gateOperations) ? options.gateOperations : [];
  const receipts = [];
  const humanLayer = isRecord(options.humanLayer) ? /** @type {Record<string, unknown>} */ (options.humanLayer) : null;
  if (humanLayer && (humanLayer.comments || humanLayer.taskStatus || humanLayer.autoAdvance)) {
    receipts.push({ adapter: "humanlayer", accepted: false, reason: "feedback-only" });
  }
  let state = await readLifecycleState({ home: options.home, workflowId: options.workflowId ?? "working-backwards" });
  let gateReceipts = [...initialReceipts];
  const stageOrder = ["idle", "requirements_in_progress", "requirements_approved", "spec_plan_ready", "spec_plan_approved", "tickets_ready", "tickets_approved", "delivery_authorized", "pre_release_ready"];
  for (const requested of operations) {
    const requestRecord = isRecord(requested) ? /** @type {Record<string, unknown>} */ (requested) : null;
    const raw = requestRecord ? requestRecord.gate ?? requestRecord.operation : requested;
    const normalized = normalizeGate(raw);
    const gate = normalized.gate;
    if (!gate || (requestRecord && requestRecord.source === "humanlayer")) {
      receipts.push({ adapter: "development-system", gate: gate ?? null, accepted: false, reason: requestRecord?.source === "humanlayer" ? "feedback-only" : normalized.reason });
      continue;
    }
    const index = WORKING_BACKWARDS_GATES.indexOf(gate);
    const gateBlocked = gate === "product"
      ? !definitionValidation.product.ok
      : gate === "technical"
        ? !definitionValidation.technical.ok || risk.technicalGate.status === "blocked"
        : !gateReceipts.some((receipt) => receipt.gate === "technical");
    if (gateBlocked) {
      const errors = gate === "product"
        ? definitionValidation.product.errors
        : gate === "technical"
          ? [...definitionValidation.technical.errors, ...(risk.technicalGate.status === "blocked" ? [risk.technicalGate.reason] : [])]
          : ["prior gates are not approved"];
      receipts.push({ adapter: "development-system", gate, accepted: false, reason: "gate-evidence-blocked", errors });
      continue;
    }
    const requiredPrior = WORKING_BACKWARDS_GATES.slice(0, index);
    if (!requiredPrior.every((prior) => gateReceipts.some((receipt) => receipt.gate === prior))) {
      receipts.push({ adapter: "development-system", gate, accepted: false, reason: "prior-gate-receipt-required" });
      continue;
    }
    const requests = [
      ["start_requirements", "Inicia grill-with-docs para Working Backwards"],
      ["approve_requirements", "Apruebo los requisitos de Working Backwards"],
      ["create_spec_plan", "Genera el spec y Local Visual Plan con Working Backwards"],
      ["approve_spec_plan", "Apruebo el spec y el Local Visual Plan de Working Backwards"],
      ["create_tickets", "Convierte el spec aprobado a tickets con Working Backwards"],
      ["approve_tickets", "Apruebo los tickets de Working Backwards"],
    ];
    const requiredStage = ["requirements_approved", "spec_plan_approved", "tickets_approved"][index];
    let accepted = stageOrder.indexOf(state.stage) >= stageOrder.indexOf(requiredStage);
    if (!accepted) {
      const start = index * 2;
      for (let requestIndex = start; requestIndex <= start + 1; requestIndex += 1) {
        const response = await runLifecycleRequest({ home: options.home, workflowId: options.workflowId ?? "working-backwards", mode: "transition", request: requests[requestIndex][1] });
        if (!response.ok) {
          receipts.push({ adapter: "development-system", gate, accepted: false, reason: response.transition?.reason ?? "gate-denied" });
          break;
        }
        state = response.state;
      }
      accepted = stageOrder.indexOf(state.stage) >= stageOrder.indexOf(requiredStage);
    }
    if (!accepted) continue;
    const gateReceipt = createWorkingBackwardsGateReceipt({
      workflowId: options.workflowId ?? "working-backwards",
      gate,
      repositoryIdentity: normalizeWorkingBackwardsRepositoryIdentity((/** @type {Record<string, unknown>} */ (options.repository ?? {})).identity) ?? "unknown",
      repositoryRevision: String((/** @type {Record<string, unknown>} */ (options.repository ?? {})).revision ?? (/** @type {Record<string, unknown>} */ (options.repository ?? {})).baseRevision ?? "unknown"),
      artifacts: /** @type {Record<string, unknown>[]} */ (artifacts),
    });
    gateReceipts = await persistWorkingBackwardsGateReceipt({ home: options.home, workflowId: options.workflowId ?? "working-backwards", receipt: gateReceipt });
    receipts.push({ adapter: "development-system", gate, accepted: true, status: "approved", receiptHash: gateReceipt.receiptHash });
  }
  return { state, receipts, gateReceipts };
}

/** @param {Record<string, unknown>[]} receipts @param {string[]} roles @param {{product: {ok: boolean}, technical: {ok: boolean}}} validation @param {ReturnType<typeof assessWorkingBackwardsRisk>} risk */
function gateState(receipts, roles, validation, risk) {
  const approved = new Set(receipts.map((receipt) => receipt.gate));
  return {
    product: { id: "product-contract-approved", status: approved.has("product") ? "approved" : validation.product.ok ? "pending" : "blocked", requiredStage: "requirements_approved", artifactRoles: roles.filter((role) => WORKING_BACKWARDS_GATE_ROLES.product.includes(role)) },
    technical: { id: "technical-contract-approved", status: approved.has("technical") ? "approved" : validation.technical.ok && risk.technicalGate.status !== "blocked" ? "pending" : "blocked", requiredStage: "spec_plan_approved", artifactRoles: roles.filter((role) => WORKING_BACKWARDS_GATE_ROLES.technical.includes(role)) },
    implementationMap: { id: "implementation-map-approved", status: approved.has("implementationMap") ? "approved" : "pending", requiredStage: "tickets_approved", artifactRoles: roles.filter((role) => WORKING_BACKWARDS_GATE_ROLES.implementationMap.includes(role)) },
  };
}

/** @param {Artifact[]} artifacts @param {Record<string, unknown>[]} existing */
function applyExistingState(artifacts, existing) {
  const byRole = /** @type {Map<string, Record<string, unknown>>} */ (new Map(existing.map((entry) => [String(entry.role), entry])));
  const changedRoles = new Set();
  for (const artifact of artifacts) {
    const previous = byRole.get(artifact.role);
    if (!previous) continue;
    const actualHash = contentHash(artifact.content);
    const previousContentIntegrity = previous.content === undefined || previous.contentHash === contentHash(previous.content);
    if (previous.status === "approved" && previous.contentHash === actualHash && previousContentIntegrity) artifact.status = "approved";
    if (previous.status === "approved" && (!previousContentIntegrity || !previous.contentHash || previous.contentHash !== actualHash)) changedRoles.add(artifact.role);
    artifact.contentHash = actualHash;
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
  const featureId = feature.featureId ?? options.workflowId ?? "working-backwards";
  const workflowId = options.workflowId ?? featureId;
  const repositoryIdentity = normalizeWorkingBackwardsRepositoryIdentity(repository.identity) ?? "unknown";
  const repositoryRevision = String(repository.revision ?? repository.baseRevision ?? "unknown");
  const gateOptions = /** @type {ScenarioOptions} */ ({ ...options, home: options.home ?? ".", workflowId });
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
      sourceIdentity: repositoryIdentity,
      sourceRevision: repositoryRevision,
      content,
      contentHash: contentHash(content),
      lineage: { dependsOn, governedBy: dependsOn, sourceIdentity: repositoryIdentity, sourceRevision: repositoryRevision },
    };
  }));
  const staleness = applyExistingState(artifacts, existing);
  const definitionValidation = validateDefinition(featureInput, feature, repository, profile.selected);
  const persistedReceipts = await readWorkingBackwardsGateReceipts({ home: gateOptions.home, workflowId });
  const initialReceiptValidation = validateWorkingBackwardsGateReceipts({
    receipts: persistedReceipts,
    artifacts: /** @type {Record<string, unknown>[]} */ (artifacts),
    repositoryIdentity,
    repositoryRevision,
    artifactStateSupplied: options.artifactState !== undefined,
  });
  const gateResult = await applyExplicitGates(gateOptions, artifacts, definitionValidation, risk, initialReceiptValidation.validReceipts);
  const acceptedThisRun = gateResult.receipts.some((receipt) => receipt.accepted === true);
  const receiptValidation = !acceptedThisRun && (!Array.isArray(options.gateOperations) || options.gateOperations.length === 0)
    ? initialReceiptValidation
    : validateWorkingBackwardsGateReceipts({
        receipts: gateResult.gateReceipts,
        artifacts: /** @type {Record<string, unknown>[]} */ (artifacts),
        repositoryIdentity,
        repositoryRevision,
        artifactStateSupplied: options.artifactState !== undefined || acceptedThisRun,
      });
  const gates = gateState(receiptValidation.validReceipts, roles, definitionValidation, risk);
  let resumeFrom = smallestResumeStage(staleness.changedRoles, staleness.affected);
  if (receiptValidation.invalidFrom === "product") resumeFrom = "requirements";
  else if (receiptValidation.invalidFrom === "technical" && resumeFrom !== "requirements") resumeFrom = "technical-contract";
  else if (receiptValidation.invalidFrom === "implementationMap" && !resumeFrom) resumeFrom = "implementation-map";
  for (const artifact of artifacts) {
    artifact.status = artifact.role === "t3-implementation-handoff" ? "candidate" : "draft";
    if (staleness.affected.has(artifact.role)) artifact.status = "stale";
    else if (artifact.role === "risk-evidence" && risk.technicalGate.status === "blocked") artifact.status = "blocked";
    else if (gates.product.status === "approved" && gates.product.artifactRoles.includes(artifact.role)) artifact.status = "approved";
    else if (gates.technical.status === "approved" && gates.technical.artifactRoles.includes(artifact.role)) artifact.status = "approved";
    else if (gates.implementationMap.status === "approved" && gates.implementationMap.artifactRoles.includes(artifact.role)) artifact.status = "approved";
  }
  const allGatesApproved = Object.values(gates).every((gate) => gate.status === "approved");
  const handoff = artifacts.find((artifact) => artifact.role === "t3-implementation-handoff");
  if (handoff && allGatesApproved && staleness.affected.size === 0) handoff.status = "ready";
  const ticketMapArtifact = artifacts.find((artifact) => artifact.role === "ticket-map");
  const governingArtifacts = artifacts.filter((artifact) => artifact.status === "approved" && artifact.role !== "t3-implementation-handoff");
  const publicationIntent = allGatesApproved && ticketMapArtifact
    ? prepareTicketPublication({
        workflowId,
        ticketMap: ticketMapArtifact.content,
        approvedArtifacts: governingArtifacts,
        repository,
        gateReceipts: receiptValidation.validReceipts,
      })
    : { ok: false, operation: "prepare-ticket-publication", errors: ["all three definition gates are required"], externalSideEffects: [] };
  const humanLayerInput = isRecord(options.humanLayer) ? options.humanLayer : {};
  const humanLayerRuntime = isRecord(humanLayerInput.runtime) ? humanLayerInput.runtime : {};
  const humanLayerAdapter = createHumanLayerAdapter({ config: isRecord(humanLayerInput.config) ? humanLayerInput.config : undefined, runtime: humanLayerRuntime });
  const humanLayerObservation = typeof humanLayerRuntime.exec === "function" && typeof humanLayerRuntime.readMetadata === "function"
    ? await humanLayerAdapter.probeLocalRuntime({ skill: "working-backwards", signature: isRecord(humanLayerInput.signature) ? humanLayerInput.signature : undefined })
    : humanLayerInput.observation === undefined
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
    gateReceipts: receiptValidation.validReceipts,
    receiptValidation,
    definitionValidation,
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
