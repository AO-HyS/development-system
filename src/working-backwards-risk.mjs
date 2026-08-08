// @ts-check

/**
 * Risk assessment for the Working Backwards profile selector.
 *
 * This module deliberately has no I/O. Callers provide the feature facts and
 * risk evidence; the returned decision is suitable for a lifecycle adapter to
 * consume without granting any lifecycle or delivery authority.
 */

/** @typedef {"Quick" | "Standard" | "Complex"} WorkingBackwardsProfile */
/** @typedef {"adr" | "prototype" | "migration" | "security" | "rollout"} RiskEvidenceType */

/** @typedef {object} RiskEvidenceRequirement
 * @property {string} id
 * @property {RiskEvidenceType} type
 * @property {string} trigger
 * @property {string} description
 */

/** @typedef {object} RiskEvidenceCheck
 * @property {RiskEvidenceRequirement} requirement
 * @property {"satisfied" | "missing" | "contradictory"} status
 * @property {string} reason
 */

/** @typedef {object} RiskOverride
 * @property {WorkingBackwardsProfile | undefined} requestedProfile
 * @property {string} rationale
 * @property {boolean} deliberate
 * @property {boolean} accepted
 * @property {string} reason
 */

/** @typedef {object} WorkingBackwardsRiskResult
 * @property {boolean} ok
 * @property {WorkingBackwardsProfile} minimumProfile
 * @property {WorkingBackwardsProfile} recommendedProfile
 * @property {WorkingBackwardsProfile} selectedProfile
 * @property {WorkingBackwardsProfile | undefined} requestedProfile
 * @property {string[]} hardRiskTriggers
 * @property {boolean} quickEligible
 * @property {RiskOverride} override
 * @property {RiskEvidenceRequirement[]} requestedEvidence
 * @property {RiskEvidenceCheck[]} evidenceChecks
 * @property {RiskEvidenceRequirement[]} unresolvedArtifacts
 * @property {RiskEvidenceRequirement | undefined} smallestUnresolvedArtifact
 * @property {{status: "approved" | "not-required" | "blocked", reason: string, unresolvedArtifact?: RiskEvidenceRequirement}} technicalGate
 */

/** @typedef {object} RiskAssessmentInput
 * @property {unknown} [feature]
 * @property {unknown} [repository]
 * @property {unknown} [profile]
 * @property {unknown} [profileOverride]
 * @property {unknown} [override]
 * @property {unknown} [riskEvidence]
 * @property {unknown} [evidence]
 */

/** @typedef {object} RiskInterface
 * @property {(input?: RiskAssessmentInput) => WorkingBackwardsRiskResult} assess
 * @property {(input?: RiskAssessmentInput) => WorkingBackwardsRiskResult} evaluate
 * @property {readonly string[]} hardTriggers
 */

/** @type {readonly string[]} */
export const WORKING_BACKWARDS_HARD_RISK_TRIGGERS = Object.freeze([
  "domain-invariant",
  "authorization",
  "sensitive-data",
  "destructive-behavior",
  "migration",
  "backfill",
  "paid-activation",
  "external-provider-uncertainty",
  "multi-repository",
  "difficult-rollback",
]);

/** @type {readonly RiskEvidenceType[]} */
export const WORKING_BACKWARDS_RISK_EVIDENCE_TYPES = Object.freeze([
  "adr",
  "prototype",
  "migration",
  "security",
  "rollout",
]);

/** @type {WorkingBackwardsProfile[]} */
const profileOrder = ["Quick", "Standard", "Complex"];
const falseWords = new Set(["", "false", "no", "none", "n/a", "not applicable", "sin riesgo"]);
const acceptedEvidenceStatuses = new Set(["approved", "complete", "completed", "verified", "satisfied", "valid", "present"]);
const contradictoryEvidenceStatuses = new Set(["contradictory", "conflicting", "conflict", "invalid", "rejected", "stale", "superseded"]);

/** @type {Record<string, {keys: readonly string[], patterns: readonly RegExp[], evidence: readonly {type: RiskEvidenceType, description: string}[]}>} */
const triggerDefinitions = {
  "domain-invariant": {
    keys: ["domainInvariant", "newDomainInvariant", "newEntity", "invariant", "domainRule"],
    patterns: [/domain[ -]?invariant/i, /invariante/i, /new entity/i, /nueva entidad/i],
    evidence: [{ type: "adr", description: "ADR de invariantes y límites de dominio" }],
  },
  authorization: {
    keys: ["authorization", "authorisation", "permissions", "accessControl", "authz"],
    patterns: [/authoriz/i, /permiso/i, /permission/i, /access control/i, /control de acceso/i],
    evidence: [{ type: "security", description: "evidencia de revisión de autorización y permisos" }],
  },
  "sensitive-data": {
    keys: ["sensitiveData", "personalData", "pii", "phi", "confidentialData"],
    patterns: [/sensitive data/i, /datos sensibles/i, /personal data/i, /datos personales/i, /pii/i, /phi/i],
    evidence: [{ type: "security", description: "evidencia de revisión de datos sensibles" }],
  },
  "destructive-behavior": {
    keys: ["destructive", "destructiveBehavior", "deletion", "deletesData", "irreversible"],
    patterns: [/destruct/i, /delete/i, /elimin/i, /irreversible/i, /irreversible/i],
    evidence: [{ type: "rollout", description: "plan de rollout, recuperación y eliminación segura" }],
  },
  migration: {
    keys: ["migration", "schemaMigration", "dataMigration"],
    patterns: [/migration/i, /migraci[oó]n/i, /schema change/i, /cambio de esquema/i],
    evidence: [{ type: "migration", description: "plan de migración, compatibilidad y verificación" }],
  },
  backfill: {
    keys: ["backfill", "dataBackfill", "backfillJob"],
    patterns: [/backfill/i, /relleno de datos/i, /carga retrospectiva/i],
    evidence: [{ type: "migration", description: "plan de backfill, límites, idempotencia y recuperación" }],
  },
  "paid-activation": {
    keys: ["paidActivation", "economicActivation", "realCost", "billing", "billable"],
    patterns: [/paid/i, /pago/i, /cost/i, /costo/i, /billing/i, /factur/i],
    evidence: [{ type: "rollout", description: "plan de rollout con límites de coste y desactivación" }],
  },
  "external-provider-uncertainty": {
    keys: ["externalProvider", "providerUncertainty", "externalProviderUncertainty", "thirdParty", "webhook"],
    patterns: [/external provider/i, /proveedor externo/i, /provider uncertainty/i, /incertidumbre.*proveedor/i, /third[- ]party/i, /webhook/i],
    evidence: [{ type: "prototype", description: "prototipo verificable de contrato y fallos del proveedor" }],
  },
  "multi-repository": {
    keys: ["multiRepository", "multipleRepositories", "crossRepository"],
    patterns: [/multi.?repo/i, /multiple repositor/i, /varios repositorio/i, /m[uú]ltiples repositorio/i],
    evidence: [{ type: "rollout", description: "plan de rollout coordinado entre repositorios" }],
  },
  "difficult-rollback": {
    keys: ["difficultRollback", "rollbackDifficult", "hardToRollback", "irreversibleChange"],
    patterns: [/difficult rollback/i, /hard to rollback/i, /dif[ií]cil.*revert/i, /irreversible/i],
    evidence: [{ type: "rollout", description: "plan de rollback probado y sus límites" }],
  },
};

const triggerAliases = new Map([
  ["domain-invariants", "domain-invariant"],
  ["domain-rule", "domain-invariant"],
  ["destructive", "destructive-behavior"],
  ["external-provider", "external-provider-uncertainty"],
  ["provider-uncertainty", "external-provider-uncertainty"],
  ["multi-repo", "multi-repository"],
  ["rollback", "difficult-rollback"],
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function record(value) {
  return isRecord(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {unknown} value */
function enabled(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return !falseWords.has(value.trim().toLowerCase());
  if (typeof value === "number") return value > 0;
  if (Array.isArray(value)) return value.length > 0 && value.some(enabled);
  if (!isRecord(value)) return Boolean(value);
  const candidate = record(value);
  for (const key of ["enabled", "required", "affected", "present", "uncertain", "new", "changed"]) {
    if (key in candidate) return enabled(candidate[key]);
  }
  return Object.keys(candidate).length > 0;
}

/** @param {unknown} value @returns {string[]} */
function textValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (!isRecord(value)) return [];
  const candidate = record(value);
  return Object.entries(candidate).flatMap(([key, entry]) => [key, ...textValues(entry)]);
}

/** @param {unknown} value @returns {string | undefined} */
function canonicalTrigger(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-").replace(/\s+/g, "-");
  if (WORKING_BACKWARDS_HARD_RISK_TRIGGERS.includes(normalized)) return normalized;
  return triggerAliases.get(normalized);
}

/** @param {unknown} value @returns {value is RiskEvidenceType} */
function isEvidenceType(value) {
  return typeof value === "string" && WORKING_BACKWARDS_RISK_EVIDENCE_TYPES.includes(/** @type {RiskEvidenceType} */ (value));
}

/** @param {Record<string, unknown>} feature @param {Record<string, unknown>} repository */
function detectTriggers(feature, repository) {
  const explicit = new Set();
  const riskSources = [
    feature.risks,
    feature.riskTriggers,
    feature.risk,
    repository.risks,
    repository.riskTriggers,
    repository.risk,
  ];
  for (const source of riskSources) {
    if (Array.isArray(source)) {
      for (const entry of source) {
        const candidate = isRecord(entry) ? record(entry) : {};
        const named = canonicalTrigger(candidate.trigger ?? candidate.name ?? candidate.type ?? candidate.category ?? entry);
        if (named && enabled(candidate.enabled ?? candidate.required ?? candidate.value ?? true)) explicit.add(named);
        for (const text of textValues(entry)) {
          for (const [trigger, definition] of Object.entries(triggerDefinitions)) {
            if (definition.patterns.some((pattern) => pattern.test(text))) explicit.add(trigger);
          }
        }
      }
    } else {
      for (const text of textValues(source)) {
        const named = canonicalTrigger(text);
        if (named) explicit.add(named);
        for (const [trigger, definition] of Object.entries(triggerDefinitions)) {
          if (definition.patterns.some((pattern) => pattern.test(text))) explicit.add(trigger);
        }
      }
    }
  }

  for (const [trigger, definition] of Object.entries(triggerDefinitions)) {
    if (definition.keys.some((key) => enabled(feature[key]) || enabled(repository[key]))) explicit.add(trigger);
  }
  const repositories = repository.repositories;
  if (Array.isArray(repositories) && repositories.length > 1) explicit.add("multi-repository");
  if (typeof repository.repositoryCount === "number" && repository.repositoryCount > 1) explicit.add("multi-repository");
  return WORKING_BACKWARDS_HARD_RISK_TRIGGERS.filter((trigger) => explicit.has(trigger));
}

/** @param {unknown} value @returns {WorkingBackwardsProfile | undefined} */
function normalizeProfile(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return profileOrder.find((profile) => profile.toLowerCase() === normalized);
}

/** @param {RiskAssessmentInput} input */
function overrideDetails(input) {
  const raw = input.profileOverride ?? input.override ?? input.profile;
  const candidate = isRecord(raw) ? record(raw) : {};
  const requestedProfile = normalizeProfile(isRecord(raw) ? candidate.profile ?? candidate.selectedProfile ?? candidate.selected : raw);
  const rationale = typeof candidate.rationale === "string" ? candidate.rationale.trim() : "";
  return { requestedProfile, rationale, deliberate: raw !== undefined, candidate };
}

/** @param {unknown} value @param {RiskEvidenceType | undefined} typeHint @param {string | undefined} triggerHint @param {{type: RiskEvidenceType, trigger?: string, value?: unknown}[]} output */
function collectEvidence(value, typeHint, triggerHint, output) {
  if (Array.isArray(value)) {
    for (const entry of value) collectEvidence(entry, typeHint, triggerHint, output);
    return;
  }
  if (!isRecord(value)) {
    if (typeHint) output.push({ type: typeHint, trigger: triggerHint, value });
    return;
  }
  const candidate = record(value);
  const explicitType = isEvidenceType(candidate.type)
    ? /** @type {RiskEvidenceType} */ (candidate.type)
    : typeHint;
  const explicitTrigger = canonicalTrigger(candidate.trigger ?? candidate.forTrigger ?? triggerHint);
  if (explicitType || "status" in candidate || "approved" in candidate || "verified" in candidate || "complete" in candidate || "contradictory" in candidate || "valid" in candidate) {
    output.push({ type: explicitType ?? "adr", trigger: explicitTrigger, value: candidate });
  }
  for (const [key, entry] of Object.entries(candidate)) {
    if (["type", "trigger", "forTrigger", "status", "approved", "verified", "complete", "contradictory", "valid", "consistent", "id", "description", "content"].includes(key)) continue;
    const nestedType = isEvidenceType(key)
      ? /** @type {RiskEvidenceType} */ (key)
      : typeHint;
    const nestedTrigger = canonicalTrigger(key) ?? explicitTrigger;
    if (nestedType || nestedTrigger) collectEvidence(entry, nestedType, nestedTrigger, output);
  }
}

/** @param {unknown} value */
function evidenceEntries(value) {
  /** @type {{type: RiskEvidenceType, trigger?: string, value?: unknown}[]} */
  const entries = [];
  collectEvidence(value, undefined, undefined, entries);
  return entries;
}

/** @param {unknown} value */
function evidenceState(value) {
  const candidate = record(value);
  if (candidate.contradictory === true || candidate.consistent === false || candidate.valid === false) return "contradictory";
  const status = typeof candidate.status === "string" ? candidate.status.trim().toLowerCase() : "";
  if (contradictoryEvidenceStatuses.has(status)) return "contradictory";
  if (acceptedEvidenceStatuses.has(status) || candidate.approved === true || candidate.verified === true || candidate.complete === true || candidate.satisfied === true || candidate.present === true) return "satisfied";
  if (candidate.value === true) return "satisfied";
  return "missing";
}

/** @param {RiskEvidenceRequirement} requirement @param {{type: RiskEvidenceType, trigger?: string, value?: unknown}[]} entries @returns {{status: "satisfied" | "missing" | "contradictory", reason: string}} */
function checkEvidence(requirement, entries) {
  const relevant = entries.filter((entry) => entry.type === requirement.type && (!entry.trigger || entry.trigger === requirement.trigger));
  if (relevant.some((entry) => evidenceState(entry.value) === "satisfied")) return { status: "satisfied", reason: "Required risk evidence is present and accepted." };
  if (relevant.some((entry) => evidenceState(entry.value) === "contradictory")) return { status: "contradictory", reason: "Risk evidence conflicts or is explicitly invalid." };
  return { status: "missing", reason: "Required risk evidence has not been supplied." };
}

/** @param {string[]} triggers */
function requirementsFor(triggers) {
  /** @type {RiskEvidenceRequirement[]} */
  const requirements = [];
  for (const trigger of triggers) {
    for (const evidence of triggerDefinitions[trigger].evidence) {
      requirements.push({
        id: `working-backwards-risk:${trigger}:${evidence.type}`,
        type: evidence.type,
        trigger,
        description: evidence.description,
      });
    }
  }
  return requirements;
}

/**
 * Assess the minimum Working Backwards profile and risk-specific technical
 * evidence. This is pure and deterministic: no state, clock, network, or
 * lifecycle operation is accessed.
 * @param {RiskAssessmentInput} [input]
 * @returns {WorkingBackwardsRiskResult}
 */
export function assessWorkingBackwardsRisk(input = {}) {
  const feature = record(input.feature);
  const repository = record(input.repository);
  const hardRiskTriggers = detectTriggers(feature, repository);
  const quickEligible = feature.behaviorSettled === true && feature.scopeNarrow === true && feature.rollbackEasy === true && feature.singleSurface === true && hardRiskTriggers.length === 0;
  const recommendedProfile = /** @type {WorkingBackwardsProfile} */ (hardRiskTriggers.length > 0 ? "Complex" : quickEligible ? "Quick" : "Standard");
  const minimumProfile = /** @type {WorkingBackwardsProfile} */ (recommendedProfile);
  const override = overrideDetails(input);
  const requestedProfile = override.requestedProfile;
  const selectedProfile = /** @type {WorkingBackwardsProfile} */ (requestedProfile && profileOrder.indexOf(requestedProfile) >= profileOrder.indexOf(minimumProfile)
    ? requestedProfile
    : minimumProfile);
  const overrideAccepted = !override.deliberate || (requestedProfile !== undefined && profileOrder.indexOf(requestedProfile) >= profileOrder.indexOf(minimumProfile));
  const overrideResult = /** @type {RiskOverride} */ ({
    requestedProfile,
    rationale: override.rationale,
    deliberate: override.deliberate,
    accepted: overrideAccepted,
    reason: !override.deliberate
      ? "No human profile override was supplied."
      : overrideAccepted
        ? "Human profile selection is retained because it does not weaken the minimum risk profile."
        : `Human profile selection cannot downshift below ${minimumProfile}; the minimum is preserved.`,
  });

  const requestedEvidence = requirementsFor(hardRiskTriggers);
  const entries = evidenceEntries(input.riskEvidence ?? input.evidence);
  /** @type {RiskEvidenceCheck[]} */
  const evidenceChecks = /** @type {RiskEvidenceCheck[]} */ (requestedEvidence.map((requirement) => {
    const check = checkEvidence(requirement, entries);
    return { requirement, status: check.status, reason: check.reason };
  }));
  const unresolvedArtifacts = evidenceChecks.filter((check) => check.status !== "satisfied").map((check) => check.requirement);
  const smallestUnresolvedArtifact = unresolvedArtifacts[0];
  const technicalGate = /** @type {WorkingBackwardsRiskResult["technicalGate"]} */ (hardRiskTriggers.length === 0
    ? { status: "not-required", reason: "No hard Complex risk trigger is present." }
    : smallestUnresolvedArtifact
      ? { status: "blocked", reason: evidenceChecks.find((check) => check.requirement.id === smallestUnresolvedArtifact.id)?.reason ?? "Risk evidence is unresolved.", unresolvedArtifact: smallestUnresolvedArtifact }
      : { status: "approved", reason: "All risk-specific evidence required by the detected triggers is accepted." });

  return {
    ok: technicalGate.status !== "blocked",
    minimumProfile,
    recommendedProfile,
    selectedProfile,
    requestedProfile,
    hardRiskTriggers,
    quickEligible,
    override: overrideResult,
    requestedEvidence,
    evidenceChecks,
    unresolvedArtifacts,
    smallestUnresolvedArtifact,
    technicalGate,
  };
}

export const evaluateWorkingBackwardsRisk = assessWorkingBackwardsRisk;
export const recommendWorkingBackwardsRisk = assessWorkingBackwardsRisk;

/** Small adapter surface for the parent Working Backwards coordinator. */
export const WORKING_BACKWARDS_RISK_INTERFACE = /** @type {RiskInterface} */ (Object.freeze({
  assess: assessWorkingBackwardsRisk,
  evaluate: assessWorkingBackwardsRisk,
  hardTriggers: WORKING_BACKWARDS_HARD_RISK_TRIGGERS,
}));

export const workingBackwardsRiskInterface = WORKING_BACKWARDS_RISK_INTERFACE;
