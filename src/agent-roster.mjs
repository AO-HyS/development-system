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
  // Older published rosters remain schemaVersion 1; extended profiles are optional
  // there, but once supplied every generated host must agree with this source.
  if (input.hostProfiles !== undefined) {
    const profiles = input.hostProfiles;
    if (!isRecord(profiles) || profiles.schemaVersion !== 1) errors.push('hostProfiles.schemaVersion must be 1');
    else {
      const instructions = profiles.instructions;
      if (!isRecord(instructions) || !nonEmpty(instructions.codex) || !nonEmpty(instructions.claude)) errors.push('hostProfiles.instructions requires both host sections');
      const codex = profiles.codex;
      if (!isRecord(codex) || !isRecord(codex.roles) || Object.keys(codex.roles).length === 0) errors.push('hostProfiles.codex.roles must be non-empty');
      else for (const [name, role] of Object.entries(codex.roles)) {
        if (!isRecord(role) || !nonEmpty(role.model) || !reasoningLevels.has(String(role.reasoningEffort)) || !['default', 'priority'].includes(String(role.serviceTier))) errors.push(`Invalid Codex role profile: ${name}`);
      }
      const claude = profiles.claude;
      if (!isRecord(claude) || !isRecord(claude.policy) || !isRecord(claude.policy.roster) || !isRecord(claude.agents)) errors.push('hostProfiles.claude requires policy roster and agent templates');
      else {
        const policy = claude.policy;
        const requiredWriterFields = ['Objective:', 'Root:', 'Revision:', 'Owned paths:', 'Settled decisions:', 'Actions:', 'Authorization:', 'Checks:', 'Stop conditions:', 'Evidence receipt:', 'Done when:'];
        const writerMarkers = policy.writerMarkers;
        if (!Array.isArray(writerMarkers) || requiredWriterFields.some((field) => !writerMarkers.includes(field))) errors.push('Protected writers require the complete execution contract fields');
        if (!isRecord(policy.jev) || policy.jev.mode !== 'off') errors.push('Normal generated Claude dispatch must disable automatic Jev');
        if (!isRecord(policy.primaryVisualReview) || policy.primaryVisualReview.enabled !== true || policy.primaryVisualReview.role !== 'visual-reviewer' || policy.primaryVisualReview.fresh !== true || policy.primaryVisualReview.sourceWrites !== false) errors.push('Primary visual review must be enabled, fresh and read-only');
        if (policy.haiku55 !== undefined) {
          const selection = policy.haiku55;
          const namedRoles = ['Explore', 'code-mapper', 'docs-researcher', 'mechanical-worker', 'exact-implementer'];
          const writerRoles = ['mechanical-worker', 'exact-implementer'];
          if (!isRecord(selection) || selection.model !== 'claude-haiku-5-5'
            || selection.effort !== 'medium' || selection.requiresObservedRuntime !== true
            || !Array.isArray(selection.roles) || selection.roles.length === 0
            || selection.roles.some(name => !namedRoles.includes(String(name)))
            || new Set(selection.roles).size !== selection.roles.length
            || !Array.isArray(selection.sourceWriters)
            || selection.sourceWriters.length !== writerRoles.length
            || writerRoles.some(name => !/** @type {unknown[]} */ (selection.sourceWriters).includes(name))) {
            errors.push('Haiku 5.5 requires pinned medium effort, observed runtime and approved named roles/writers');
          }
          if (Array.isArray(policy.otherAgentsRequireModel) && policy.otherAgentsRequireModel.some(model => /haiku/i.test(String(model)))) errors.push('Haiku plugin models are not admitted');
          if (isRecord(selection) && Array.isArray(selection.roles)) {
            for (const name of selection.roles) {
              const role = /** @type {Record<string, unknown>} */ (policy.roster)[String(name)];
              if (!isRecord(role) || role.model !== selection.model || Boolean(role.writer) !== writerRoles.includes(String(name))) errors.push(`Haiku role/model boundary mismatch: ${name}`);
              if (!String(claude.agents[String(name)]).includes('effort: medium\n')) errors.push(`Haiku role effort mismatch: ${name}`);
            }
          }
        }
        for (const [name, role] of Object.entries(/** @type {Record<string, unknown>} */ (policy.roster))) {
          if (!isRecord(role)) { errors.push(`Invalid Claude role: ${name}`); continue; }
          if (/haiku/i.test(String(role.model)) && (!isRecord(policy.haiku55) || !Array.isArray(policy.haiku55.roles) || !policy.haiku55.roles.includes(name) || role.model !== 'claude-haiku-5-5')) errors.push(`Unapproved Haiku role: ${name}`);
          const template = claude.agents[name];
          if (!nonEmpty(template) || !String(template).includes(`model: ${role.model}\n`)) errors.push(`Claude agent template/model mismatch: ${name}`);
          if (role.writer === true) {
            if (Array.isArray(policy.readOnlyModels) && policy.readOnlyModels.includes(role.model)) errors.push(`Writer model is read-only: ${name}`);
            if (!String(template).includes('roster-guard.mjs" writer-bash')) errors.push(`Writer Git protection missing: ${name}`);
            if (role.model === 'sonnet' && !['mechanical-worker', 'exact-implementer', 'implementer'].includes(name)) errors.push(`Sonnet writer must be a named protected role: ${name}`);
          }
        }
        for (const name of Object.keys(claude.agents)) if (!(name in /** @type {Record<string, unknown>} */ (policy.roster))) errors.push(`Claude template lacks role: ${name}`);
      }
      if (!isRecord(profiles.t3) || profiles.t3.sourceWritersAdmitted !== false) errors.push('Unverified T3 source writers must remain unadmitted');
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
