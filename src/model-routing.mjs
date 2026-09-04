// @ts-check

const unavailableReasons = new Set(["quota-exhausted", "unavailable", "unsupported", "policy-blocked", "latency-budget-exceeded", "timeout"]);
const evidenceStatuses = new Set(["validated", "provisional", "runtime-required", "unproven"]);
const mappingStatuses = new Set(["mapped", "provisional", "benchmark-required", "runtime-required", "unmapped"]);
const supportedHarnesses = new Set(["opencode", "factory", "devin", "codex"]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** @param {unknown} value */
function text(value) { return typeof value === "string" && value.trim() ? value.trim() : ""; }

/**
 * Resolve a capability route without dispatching a harness or contacting a
 * provider. The roster is the policy source; unavailable candidates are
 * host-observed facts and never become implicit provider fallback.
 *
 * @param {{roster: unknown, capability?: string, routeSlot?: string, unavailable?: unknown, escalation?: boolean}} input
 */
export function resolveModelRoute(input) {
  const errors = [];
  const roster = isRecord(input) && isRecord(input.roster) ? input.roster : null;
  const capability = text(isRecord(input) ? input.capability : "");
  const routeSlot = text(isRecord(input) ? input.routeSlot : "");
  const escalation = isRecord(input) && input.escalation === true;
  if (!roster) errors.push("roster must be an object");
  if (!capability) errors.push("capability is required");
  if (!routeSlot) errors.push("routeSlot is required");
  if (!roster || errors.length) return blockedResult({ capability, routeSlot, errors });

  const route = findRoute(roster, capability, routeSlot);
  if (!route) return blockedResult({ capability, routeSlot, errors: ["no declared route matches capability and routeSlot"] });
  const candidates = Array.isArray(route.candidates) ? route.candidates : [];
  if (candidates.length === 0) return blockedResult({ capability, routeSlot, errors: ["declared route has no candidates"] });

  const unavailable = normalizeUnavailable(input.unavailable);
  if (unavailable.errors.length > 0) return blockedResult({ capability, routeSlot, errors: [...errors, ...unavailable.errors] });
  const normalizedCandidates = [];
  /** @type {string[]} */
  const candidateErrors = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const normalized = normalizeCandidate(candidates[index], index, candidateErrors);
    if (normalized) normalizedCandidates.push(normalized);
  }
  if (candidateErrors.length > 0) return blockedResult({ capability, routeSlot, errors: candidateErrors });
  /** @type {string[]} */
  const ambiguousModels = [];
  for (const [key, fact] of unavailable.map.entries()) {
    if (fact.scope !== "model" || fact.observedModel !== null) continue;
    if (normalizedCandidates.filter((candidate) => candidate.model === key).length > 1) ambiguousModels.push(key);
  }
  if (ambiguousModels.length > 0) {
    return blockedResult({
      capability,
      routeSlot,
      errors: [...errors, ...ambiguousModels.map((model) => `bare model fact "${model}" matches multiple declared candidates and fails closed`)],
    });
  }
  /** @type {Array<Record<string, unknown>>} */
  const attempts = [];
  /** @type {Array<Record<string, unknown>>} */
  const fallbackTrace = [];
  for (let index = 0; index < normalizedCandidates.length; index += 1) {
    const normalized = normalizedCandidates[index];
    const unavailableAttempt = availabilityFor(unavailable, normalized);
    if (
      normalized.requiresVerifiedRuntimeAvailability &&
      (!unavailableAttempt || unavailableAttempt.observedModel !== normalized.model)
    ) {
      const boundaryCrossed = index < normalizedCandidates.length - 1;
      const reason = unavailableAttempt?.reason ??
        (unavailableAttempt?.observedModel ? "unavailable" : "runtime-availability-unverified");
      const attempt = {
        candidateId: normalized.id,
        harness: normalized.harness,
        model: normalized.model,
        status: "skipped",
        reason,
        observedModel: unavailableAttempt?.observedModel ?? null,
        boundaryCrossed,
        boundary: normalized.independenceBoundary,
      };
      attempts.push(attempt);
      fallbackTrace.push({ ...attempt, action: boundaryCrossed ? "advance-to-declared-fallback" : "exhausted" });
      continue;
    }
    const modelMismatch = unavailableAttempt?.observedModel && unavailableAttempt.observedModel !== normalized.model;
    if (unavailableAttempt && (unavailableAttempt.reason || modelMismatch)) {
      const unavailableReason = modelMismatch ? "unavailable" : unavailableAttempt.reason;
      const boundaryCrossed = index < candidates.length - 1;
      const attempt = { candidateId: normalized.id, harness: normalized.harness, model: normalized.model, status: "skipped", reason: unavailableReason, observedModel: unavailableAttempt.observedModel ?? null, boundaryCrossed, boundary: normalized.independenceBoundary };
      attempts.push(attempt);
      fallbackTrace.push({ ...attempt, action: boundaryCrossed ? "advance-to-declared-fallback" : "exhausted" });
      continue;
    }
    const astraEscalation = escalation && normalized.harness === "codex" && normalized.model === "gpt-6-astra";
    const reasoning = astraEscalation ? "max" : normalized.reasoning;
    const receiptModel = unavailableAttempt && unavailableAttempt.observedModel ? unavailableAttempt.observedModel : null;
    const resolvedModel = receiptModel !== null && receiptModel === normalized.model ? receiptModel : null;
    const selected = {
      ...normalized,
      reasoning,
      requestedModel: normalized.requestedModel,
      resolvedModel,
      resolvedModelStatus: resolvedModel !== null ? "receipt-matched" : "receipt-required",
      escalationApplied: astraEscalation,
      invocation: invocationFor(normalized.harness, normalized.model, reasoning),
    };
    const attempt = { candidateId: normalized.id, harness: normalized.harness, model: normalized.model, status: "selected", reason: null, boundaryCrossed: false, boundary: normalized.independenceBoundary };
    attempts.push(attempt);
    fallbackTrace.push({ ...attempt, action: "select-declared-route" });
    return {
      operation: "model-route",
      valid: true,
      blocked: false,
      capability,
      routeSlot,
      selected: selected,
      attempts,
      fallbackTrace,
      authority: { dispatchAuthorized: false, providerCalls: [], source: "versioned-capability-roster" },
      errors,
    };
  }
  return blockedResult({
    capability,
    routeSlot,
    errors: [...errors, "all declared candidates are unavailable; route fails closed"],
    attempts,
    fallbackTrace,
  });
}

/** @param {Record<string, unknown>} roster @param {string} capability @param {string} routeSlot */
function findRoute(roster, capability, routeSlot) {
  const routes = Array.isArray(roster.routes) ? roster.routes : [];
  const route = routes.find(
    (entry) =>
      isRecord(entry) &&
      entry.capability === capability &&
      (entry.routeSlot === routeSlot || (Array.isArray(entry.aliases) && entry.aliases.includes(routeSlot))),
  );
  if (!route) return null;
  if (typeof route.chain === "string") {
    const chains = isRecord(roster.chains) ? roster.chains : {};
    const shared = chains[route.chain];
    if (!Array.isArray(shared) || shared.length === 0) return { ...route, candidates: [] };
    return { ...route, candidates: shared };
  }
  return route;
}

/**
 * Normalize host-observed availability facts. Array and object observation
 * forms behave symmetrically. Malformed entries and unsupported reasons fail
 * closed instead of being silently ignored.
 *
 * @param {unknown} value @returns {{map: Map<string, {reason: string|null, observedModel: string|null, scope: string, consumed: boolean}>, errors: string[]}}
 */
function normalizeUnavailable(value) {
  /** @type {Map<string, {reason: string|null, observedModel: string|null, scope: string, consumed: boolean}>} */
  const map = new Map();
  /** @type {string[]} */
  const errors = [];
  /** @param {string} key @param {string|null} reason @param {string|null} observedModel */
  function record(key, reason, observedModel) {
    if (map.has(key)) { errors.push(`duplicate availability fact for "${key}"`); return; }
    map.set(key, { reason, observedModel, scope: key.includes(":") ? "bound" : "model", consumed: false });
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isRecord(entry)) { errors.push("availability entries must be objects"); continue; }
      const key = text(entry.candidateId) || text(entry.id) || (text(entry.harness) && text(entry.model) ? `${text(entry.harness)}:${text(entry.model)}` : text(entry.model));
      const reason = text(entry.reason);
      const observedModel = text(entry.observedModel) || text(entry.resolvedModel);
      if (!key) { errors.push(observedModel ? "observed-model entries require candidateId, id, or harness:model" : "availability entries require candidateId, id, or harness:model"); continue; }
      if (reason && !unavailableReasons.has(reason)) { errors.push(`unsupported unavailable reason: ${reason}`); continue; }
      if (!reason && !observedModel) { errors.push("availability entries require a typed reason or an observed model"); continue; }
      record(key, reason || null, observedModel || null);
    }
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (!isRecord(entry)) {
        const code = text(entry);
        if (!unavailableReasons.has(code)) { errors.push("availability values must be objects or typed reasons"); continue; }
        record(key, code, null);
        continue;
      }
      const reason = text(entry.reason);
      const observedModel = text(entry.observedModel) || text(entry.resolvedModel);
      if (reason && !unavailableReasons.has(reason)) { errors.push(`unsupported unavailable reason: ${reason}`); continue; }
      if (!reason && !observedModel) { errors.push("availability entries require a typed reason or an observed model"); continue; }
      record(key, reason || null, observedModel || null);
    }
  } else if (value !== null && value !== undefined) {
    errors.push("unavailable must be an array or object");
  }
  return { map, errors };
}

/** @param {{map: Map<string, {reason: string|null, observedModel: string|null, scope: string, consumed: boolean}>}} unavailable @param {{id:string,harness:string,model:string}} candidate */
function availabilityFor(unavailable, candidate) {
  const bound = unavailable.map.get(candidate.id) ?? unavailable.map.get(`${candidate.harness}:${candidate.model}`);
  if (bound) {
    if (bound.observedModel !== null && bound.observedModel !== candidate.model) {
      return { reason: "unavailable", observedModel: bound.observedModel, scope: bound.scope, consumed: false };
    }
    return bound;
  }
  const model = unavailable.map.get(candidate.model);
  if (!model || model.consumed) return null;
  model.consumed = true;
  return model;
}

/** @param {string} harness @param {string} model @param {string} reasoning */
function invocationFor(harness, model, reasoning) {
  if (harness === "opencode") {
    return { command: "opencode", args: ["run", "--pure", "--model", model, "--variant", reasoning, "--format", "json"] };
  }
  if (harness === "factory") return { command: "droid", args: ["exec", "--model", model, "--reasoning-effort", reasoning] };
  if (harness === "devin") {
    const modelUid = model === "claude-fable-5.1"
      ? `claude-fable-5-1-${reasoning}`
      : model === "gemini-3.8-flash"
        ? `gemini-3-8-flash-${reasoning}`
        : (model === "swe-1-7" || model === "swe-1-7-lightning") && reasoning === "medium"
          ? `${model}-medium`
          : model;
    return { command: "devin", args: ["--model", modelUid, "--print"] };
  }
  return {
    command: "codex",
    args: [
      "exec",
      "--strict-config",
      "--model",
      model,
      "--config",
      `model_reasoning_effort=\"${reasoning}\"`,
      "--config",
      'service_tier="priority"',
    ],
  };
}

/** @param {unknown} value @param {number} index @param {string[]} errors */
function normalizeCandidate(value, index, errors) {
  if (!isRecord(value)) { errors.push(`candidates[${index}] must be an object`); return null; }
  const candidate = {
    id: text(value.id),
    harness: text(value.harness),
    model: text(value.model),
    requestedModel: text(value.requestedModel) || text(value.model),
    reasoning: text(value.reasoning),
    evidenceStatus: text(value.evidenceStatus),
    mappingStatus: text(value.mappingStatus),
    independenceBoundary: text(value.independenceBoundary),
    requiresVerifiedRuntimeAvailability: value.requiresVerifiedRuntimeAvailability === true,
    fallbackOnly: value.fallbackOnly === true,
    serviceTier: isRecord(value.serviceTier)
      ? { tier: text(value.serviceTier.tier), label: text(value.serviceTier.label), status: text(value.serviceTier.status) }
      : null,
  };
  for (const [key, actual] of Object.entries(candidate)) {
    if (!["requiresVerifiedRuntimeAvailability", "fallbackOnly", "serviceTier"].includes(key) && !actual) errors.push(`candidates[${index}].${key} is required`);
  }
  if (value.serviceTier !== undefined && (!candidate.serviceTier?.tier || !candidate.serviceTier.status)) {
    errors.push(`candidates[${index}].serviceTier requires tier and status`);
  }
  if (candidate.model === "inherit" || candidate.requestedModel === "inherit") errors.push(`candidates[${index}] requires an explicit model`);
  if (candidate.harness && !supportedHarnesses.has(candidate.harness)) {
    errors.push(`candidates[${index}].harness is unsupported: ${candidate.harness}`);
  }
  if (candidate.evidenceStatus && !evidenceStatuses.has(candidate.evidenceStatus)) errors.push(`candidates[${index}].evidenceStatus is unsupported`);
  if (candidate.mappingStatus && !mappingStatuses.has(candidate.mappingStatus)) errors.push(`candidates[${index}].mappingStatus is unsupported`);
  return errors.length && errors[errors.length - 1].startsWith(`candidates[${index}]`) ? null : candidate;
}

/** @param {{capability:string, routeSlot:string, errors:string[], attempts?:Array<Record<string, unknown>>, fallbackTrace?:Array<Record<string, unknown>>}} input */
function blockedResult(input) {
  return {
    operation: "model-route",
    valid: false,
    blocked: true,
    capability: input.capability,
    routeSlot: input.routeSlot,
    selected: null,
    attempts: input.attempts ?? [],
    fallbackTrace: input.fallbackTrace ?? [],
    authority: { dispatchAuthorized: false, providerCalls: [], source: "versioned-capability-roster" },
    errors: input.errors,
  };
}

export const modelRouteUnavailableReasons = [...unavailableReasons];
