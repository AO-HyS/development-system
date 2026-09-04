// @ts-check

import { readFileSync } from "node:fs";

export const agentRosterPath = new URL("../config/agent-roster.json", import.meta.url);
const reasoningLevels = new Set(["low", "medium", "high", "xhigh", "max"]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} input */
export function validateAgentRoster(input) {
  const errors = [];
  if (!isRecord(input)) return { valid: false, errors: ["roster must be an object"] };
  if (input.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(input.routes) || input.routes.length === 0) errors.push("routes must be a non-empty array");
  const routeIds = new Set();
  const slots = new Set();
  const candidateIds = new Set();
  for (const [routeIndex, route] of (Array.isArray(input.routes) ? input.routes : []).entries()) {
    if (!isRecord(route)) { errors.push(`routes[${routeIndex}] must be an object`); continue; }
    for (const field of ["id", "label", "role", "capability", "routeSlot", "when"]) {
      if (!nonEmpty(route[field])) errors.push(`routes[${routeIndex}].${field} is required`);
    }
    if (!Array.isArray(route.does) || route.does.length === 0 || route.does.some((entry) => !nonEmpty(entry))) {
      errors.push(`routes[${routeIndex}].does must be a non-empty string array`);
    }
    if (nonEmpty(route.id)) {
      if (routeIds.has(route.id)) errors.push(`duplicate route id: ${route.id}`);
      routeIds.add(route.id);
    }
    const declaredSlots = [route.routeSlot, ...(Array.isArray(route.aliases) ? route.aliases : [])];
    for (const slot of declaredSlots) {
      if (!nonEmpty(slot)) { errors.push(`routes[${routeIndex}].aliases must contain strings`); continue; }
      if (slots.has(slot)) errors.push(`duplicate route slot or alias: ${slot}`);
      slots.add(slot);
    }
    if (!Array.isArray(route.candidates) || route.candidates.length === 0) {
      errors.push(`routes[${routeIndex}].candidates must be a non-empty array`);
      continue;
    }
    for (const [candidateIndex, candidate] of route.candidates.entries()) {
      if (!isRecord(candidate)) { errors.push(`routes[${routeIndex}].candidates[${candidateIndex}] must be an object`); continue; }
      for (const field of ["id", "harness", "model", "reasoning", "evidenceStatus", "mappingStatus", "independenceBoundary"]) {
        if (!nonEmpty(candidate[field])) errors.push(`routes[${routeIndex}].candidates[${candidateIndex}].${field} is required`);
      }
      if (nonEmpty(candidate.id)) {
        if (candidateIds.has(candidate.id)) errors.push(`duplicate candidate id: ${candidate.id}`);
        candidateIds.add(candidate.id);
      }
      if (nonEmpty(candidate.reasoning) && !reasoningLevels.has(/** @type {string} */ (candidate.reasoning))) {
        errors.push(`routes[${routeIndex}].candidates[${candidateIndex}].reasoning is unsupported: ${candidate.reasoning}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function loadAgentRoster() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(agentRosterPath, "utf8"));
  } catch (error) {
    throw new Error(`Agent roster could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const validation = validateAgentRoster(parsed);
  if (!validation.valid) throw new Error(`Agent roster is invalid:\n- ${validation.errors.join("\n- ")}`);
  return parsed;
}

export const agentRoster = loadAgentRoster();

/** @param {string} routeSlot */
export function rosterRoute(routeSlot) {
  const routes = /** @type {Array<Record<string, unknown>>} */ (agentRoster.routes);
  const route = routes.find((entry) => entry.routeSlot === routeSlot || (Array.isArray(entry.aliases) && entry.aliases.includes(routeSlot)));
  if (!route) throw new Error(`Agent roster has no route for slot: ${routeSlot}`);
  return route;
}

/** @param {string} routeSlot */
export function rosterModel(routeSlot) {
  const route = rosterRoute(routeSlot);
  const candidate = /** @type {Array<Record<string, unknown>>} */ (route.candidates)[0];
  return Object.freeze({
    requested: /** @type {string} */ (candidate.model),
    resolved: null,
    reasoning: /** @type {string} */ (candidate.reasoning),
  });
}

/** @param {string} routeSlot */
export function rosterChain(routeSlot) {
  const route = rosterRoute(routeSlot);
  return Object.freeze(/** @type {Array<Record<string, unknown>>} */ (route.candidates).map((candidate) => Object.freeze({
    harness: candidate.harness,
    model: candidate.model,
    reasoning: candidate.reasoning,
    ...(candidate.requiresVerifiedRuntimeAvailability === true ? { requiresVerifiedRuntimeAvailability: true } : {}),
    ...(candidate.fallbackOnly === true ? { fallbackOnly: true } : {}),
    ...(isRecord(candidate.serviceTier) ? { serviceTier: { ...candidate.serviceTier } } : {}),
  })));
}
