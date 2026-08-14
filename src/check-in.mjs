// @ts-check

const sources = new Set([
  "repository",
  "linear",
  "pull-request",
  "ci",
  "preview",
  "release",
  "observability",
  "blocker",
  "development-run",
]);
const capabilities = new Set(["mobile", "computer", "local-device", "promotion-authorization"]);
const checkInPattern = /\b(?:ya\s+llegue|estoy\s+en\s+(?:el\s+)?(?:celular|movil)|tengo\s+(?:media\s+hora|\d+\s+minutos?)|check[ -]?in)\b/iu;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** @param {string} value */
function semantic(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Recognize the natural-language check-in surface without granting any write
 * or promotion authority.
 * @param {unknown} request
 */
export function detectCheckInRequest(request) {
  const raw = text(request) ?? "";
  const normalized = semantic(raw);
  const duration = normalized.match(/\btengo\s+(?:(media)\s+hora|(\d+)\s+minutos?)\b/u);
  const availableMinutes = duration?.[1] ? 30 : duration?.[2] ? Number(duration[2]) : null;
  const device = /** @type {"mobile" | "computer"} */ (
    /\b(?:celular|movil)\b/u.test(normalized) ? "mobile" : "computer"
  );
  return {
    activated: checkInPattern.test(normalized),
    operation: "check-in",
    device,
    availableMinutes,
    authorization: { externalWrites: false, promotion: false },
  };
}

/** @param {unknown} value */
function instant(value) {
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {Record<string, unknown>} evidence @param {number | null} nowMs @param {number} defaultMaxAgeMinutes */
function normalizeEvidence(evidence, nowMs, defaultMaxAgeMinutes) {
  const source = text(evidence.source);
  const observedAt = instant(evidence.observedAt);
  const configuredAge = typeof evidence.maxAgeMinutes === "number" && Number.isFinite(evidence.maxAgeMinutes) && evidence.maxAgeMinutes >= 0
    ? evidence.maxAgeMinutes
    : defaultMaxAgeMinutes;
  const ageMinutes = observedAt === null || nowMs === null ? null : Math.max(0, (nowMs - observedAt) / 60_000);
  const freshness = ageMinutes === null ? "unproven" : ageMinutes > configuredAge ? "stale" : "fresh";
  const action = isRecord(evidence.action) ? evidence.action : null;
  const capability = action ? text(action.capability) : null;
  return {
    id: text(evidence.id) ?? "unidentified-evidence",
    repository: text(evidence.repository) ?? "unknown-repository",
    source: source && sources.has(source) ? source : "unknown",
    subject: text(evidence.subject) ?? text(evidence.id) ?? "unknown-subject",
    claim: text(evidence.claim) ?? "workflow-state",
    state: text(evidence.state),
    observedAt: text(evidence.observedAt),
    freshness,
    ageMinutes,
    revision: text(evidence.revision),
    destination: text(evidence.destination),
    providerEvidence: evidence.providerEvidence === true,
    url: text(evidence.url),
    requiresHuman: evidence.requiresHuman === true,
    action: action ? {
      title: text(action.title),
      reason: text(action.reason),
      capability: capability && capabilities.has(capability) ? capability : null,
      minutes: typeof action.minutes === "number" && Number.isFinite(action.minutes) && action.minutes >= 0 ? action.minutes : null,
      priority: typeof action.priority === "number" && Number.isFinite(action.priority) ? action.priority : 0,
      open: text(action.open) ?? text(evidence.url),
    } : null,
  };
}

/** @param {ReturnType<typeof normalizeEvidence>[]} evidence */
function conflictsFor(evidence) {
  /** @type {Map<string, ReturnType<typeof normalizeEvidence>[]>} */
  const groups = new Map();
  for (const item of evidence) {
    const key = `${item.repository}\u0000${item.subject}\u0000${item.claim}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].flatMap((items) => {
    const states = [...new Set(items.map((item) => item.state).filter((state) => state !== null))];
    if (states.length < 2) return [];
    return [{
      repository: items[0].repository,
      subject: items[0].subject,
      claim: items[0].claim,
      states,
      evidenceIds: items.map((item) => item.id),
      resolution: "human-verification-required",
    }];
  });
}

/** @param {ReturnType<typeof normalizeEvidence>[]} evidence @param {ReturnType<typeof conflictsFor>} conflicts */
function productionTruth(evidence, conflicts) {
  const repositories = [...new Set(evidence.map((item) => item.repository))];
  return repositories.map((repository) => {
    const items = evidence.filter((item) => item.repository === repository);
    const conflict = conflicts.find((item) => item.repository === repository && item.claim === "production-state");
    const proven = items.find((item) => item.source === "release"
      && item.destination === "production"
      && item.providerEvidence
      && item.freshness === "fresh"
      && ["deployed", "healthy", "smoke-passed"].includes(item.state ?? ""));
    return {
      repository,
      status: conflict ? "conflicting" : proven ? "proven" : "unproven",
      evidenceId: conflict ? null : proven?.id ?? null,
      reason: conflict ? "conflicting-provider-production-evidence" : proven ? "provider-production-evidence" : "no-current-provider-production-evidence",
    };
  });
}

/** @param {string} capability @param {"mobile" | "computer"} device */
function deviceFit(capability, device) {
  if (capability === "promotion-authorization") return 3;
  if (device === "mobile") return capability === "mobile" ? 4 : capability === "computer" ? 1 : 0;
  return capability === "computer" ? 4 : capability === "mobile" ? 3 : capability === "local-device" ? 2 : 0;
}

/**
 * Reconcile already-collected provider-neutral evidence into a bounded,
 * deterministic, read-only decision surface. Collection and external writes
 * remain the responsibility of explicit adapters outside this module.
 * @param {Record<string, unknown>} input
 */
export function buildCheckIn(input) {
  const request = detectCheckInRequest(input.request);
  const now = text(input.now);
  const nowMs = instant(now);
  const scope = isRecord(input.scope) ? input.scope : {};
  const scopeKind = scope.kind === "repository" ? "repository" : "global";
  const selectedRepository = text(scope.repository);
  const maxActions = typeof input.maxActions === "number" && Number.isInteger(input.maxActions)
    ? Math.max(1, Math.min(5, input.maxActions))
    : 3;
  const defaultMaxAgeMinutes = typeof input.freshnessMinutes === "number" && Number.isFinite(input.freshnessMinutes) && input.freshnessMinutes >= 0
    ? input.freshnessMinutes
    : 24 * 60;
  const errors = [];
  if (nowMs === null) errors.push("now must be a valid deterministic timestamp");
  if (scopeKind === "repository" && !selectedRepository) errors.push("repository scope requires scope.repository");
  if (!Array.isArray(input.evidence)) errors.push("evidence must be an array");

  const normalized = (Array.isArray(input.evidence) ? input.evidence : [])
    .filter(isRecord)
    .map((item) => normalizeEvidence(item, nowMs, defaultMaxAgeMinutes))
    .filter((item) => scopeKind === "global" || item.repository === selectedRepository);
  const conflicts = conflictsFor(normalized);
  const candidates = normalized
    .filter((item) => item.requiresHuman && item.action?.title && item.action.reason && item.action.capability)
    .map((item) => {
      const conflict = conflicts.find((candidate) => candidate.evidenceIds.includes(item.id));
      return {
      id: item.id,
      reconciliationKey: `${item.repository}\u0000${item.subject}\u0000${item.claim}`,
      repository: item.repository,
      title: item.action?.title ?? "",
      whyNow: conflict ? `La evidencia de ${item.claim} es contradictoria y requiere verificacion humana.` : item.action?.reason ?? "",
      capability: item.action?.capability ?? "computer",
      estimatedMinutes: item.action?.minutes ?? null,
      open: item.action?.open ? { kind: item.source === "preview" ? "preview" : item.source === "development-run" ? "reader" : "evidence", href: item.action.open } : null,
      evidenceIds: conflict?.evidenceIds ?? [item.id],
      freshness: item.freshness,
      conflict: conflict !== undefined,
      priority: item.action?.priority ?? 0,
      fit: deviceFit(item.action?.capability ?? "computer", request.device),
      };
    })
    .filter((action) => request.availableMinutes === null || action.estimatedMinutes === null || action.estimatedMinutes <= request.availableMinutes)
    .sort((left, right) => Number(right.conflict) - Number(left.conflict)
      || Number(left.freshness !== "fresh") - Number(right.freshness !== "fresh")
      || right.fit - left.fit
      || right.priority - left.priority
      || left.id.localeCompare(right.id));
  const uniqueCandidates = candidates.filter((action, index, all) => all.findIndex((candidate) => candidate.reconciliationKey === action.reconciliationKey) === index);
  const actions = uniqueCandidates.slice(0, maxActions).map(({ priority: _priority, fit: _fit, reconciliationKey: _key, ...action }) => action);
  const deferred = uniqueCandidates.slice(maxActions).map(({ priority: _priority, fit: _fit, reconciliationKey: _key, ...action }) => action);
  const staleEvidence = normalized.filter((item) => item.freshness === "stale").map((item) => item.id);
  const unprovenEvidence = normalized.filter((item) => item.freshness === "unproven" || item.state === null).map((item) => item.id);
  const nothingToDo = actions.length === 0;

  return {
    schemaVersion: 1,
    operation: "check-in",
    valid: errors.length === 0,
    errors,
    activated: request.activated,
    context: {
      scope: scopeKind,
      repository: scopeKind === "repository" ? selectedRepository : null,
      device: request.device,
      availableMinutes: request.availableMinutes,
      asOf: now,
    },
    summary: nothingToDo ? "No hay acciones humanas demostradas ahora." : `${actions.length} accion(es) requieren atencion humana ahora.`,
    actions,
    deferred,
    evidence: {
      items: normalized,
      stale: staleEvidence,
      unproven: unprovenEvidence,
      conflicts,
      production: productionTruth(normalized, conflicts),
    },
    privateReport: {
      format: "development-system-private-report/v1",
      section: "check-in",
      summary: nothingToDo ? "nothing-to-do" : "human-actions-required",
      actionIds: actions.map((action) => action.id),
    },
    readOnly: true,
    externalWriteIntents: [],
    externalSideEffects: [],
    authorization: { promotionGranted: false },
  };
}
