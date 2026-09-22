// @ts-check

import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";

import { GovernanceError } from "./errors.mjs";
import { validateRequiredCapabilities } from "./adapters.mjs";
export { GovernanceError } from "./errors.mjs";

export const SCHEMA_VERSION = 1;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;

/**
 * Dynamic JSON crosses this module boundary, so the helper is deliberately
 * typed `any`. Callers must narrow with `isRecord` before touching fields.
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value */
export function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

/**
 * Canonical JSON: object keys sorted recursively, arrays preserved in order.
 * Used for every hash so callers cannot influence identity by key order.
 * @param {any} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** @param {any} value @returns {any} */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/** @param {any} value */
export function stableHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** @param {string | Buffer | Uint8Array} value */
export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value @param {string} label @returns {asserts value is Record<string, any>} */
export function assertRecord(value, label) {
  if (!isRecord(value)) throw new GovernanceError(`${label} must be an object`, "invalid", { field: label });
}

/** @param {unknown} value @param {string} label */
export function assertSafeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new GovernanceError(`${label} must be a safe identifier`, "invalid", { field: label });
}

/** @param {unknown} value @param {string} label */
export function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new GovernanceError(`${label} must be a 64-character sha256`);
}

/**
 * Reject unknown top-level fields so a caller cannot smuggle authority through
 * an unvalidated property.
 * @param {Record<string, any>} value
 * @param {readonly string[]} allowed
 * @param {string} label
 */
export function rejectUnknownKeys(value, allowed, label) {
  const permit = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permit.has(key)) throw new GovernanceError(`${label} has an unknown field: ${key}`);
  }
}

/**
 * Repository-relative canonical path. Rejects absolute paths, backslashes,
 * empty segments and traversal segments.
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
export function assertRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
    throw new GovernanceError(`${label} must be a non-empty relative path`);
  }
  if (value.includes("\\")) throw new GovernanceError(`${label} must use forward slashes`);
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new GovernanceError(`${label} is noncanonical or escapes the root`);
  }
  const normalized = resolve("/root", value);
  if (normalized !== "/root" && !normalized.startsWith(`/root${sep}`)) {
    throw new GovernanceError(`${label} escapes the root`);
  }
  return value;
}

/** @param {string} path */
export function isManagedWritePath(path) {
  const first = path.split("/")[0];
  if ([".git", ".development-system", ".codex", ".agents"].includes(first) || path === "runtime/jev-governance" || path.startsWith("runtime/jev-governance/")) return true;
  return false;
}

/** @param {string} path @param {string} label */
export function assertWritableScopePath(path, label) {
  assertRelativePath(path, label);
  if (isManagedWritePath(path)) throw new GovernanceError(`${label} targets a managed path: ${path}`);
  return path;
}

/**
 * Segment-boundary containment: `a/b` contains `a/b/c` but never `a/bc`.
 * @param {string} surface @param {string} owned */
export function pathContainedBy(surface, owned) {
  return surface === owned || surface.startsWith(`${owned}/`);
}

/** @param {string} left @param {string} right */
export function pathsOverlap(left, right) {
  return pathContainedBy(left, right) || pathContainedBy(right, left);
}

/** @param {string[]} left @param {string[]} right */
export function setsOverlap(left, right) {
  return left.some((a) => right.some((b) => pathsOverlap(a, b)));
}

/** @param {any} value @param {string} label @param {number} [min] */
function assertNonEmptyArray(value, label, min = 1) {
  if (!Array.isArray(value) || value.length < min) throw new GovernanceError(`${label} must be an array with at least ${min} entry`);
}

/**
 * @param {any} sources
 * @param {string} label
 * @returns {Array<{id:string,path:string,kind:string}>}
 */
function validateSources(sources, label) {
  assertNonEmptyArray(sources, label);
  /** @type {Set<string>} */ const ids = new Set();
  return sources.map((/** @type {any} */ source, /** @type {number} */ index) => {
    assertRecord(source, `${label}[${index}]`);
    rejectUnknownKeys(source, ["id", "path", "kind"], `${label}[${index}]`);
    assertSafeId(source.id, `${label}[${index}].id`);
    if (ids.has(source.id)) throw new GovernanceError(`${label} ids must be unique`);
    ids.add(source.id);
    assertRelativePath(source.path, `${label}[${index}].path`);
    if (!["spec", "ticket", "rule"].includes(source.kind)) throw new GovernanceError(`${label}[${index}].kind must be spec, ticket or rule`);
    return { id: source.id, path: source.path, kind: source.kind };
  });
}

/**
 * @param {any} tickets
 * @param {any} criteria
 */
function validateTicketsAndCriteria(tickets, criteria) {
  assertNonEmptyArray(tickets, "contract.tickets");
  assertNonEmptyArray(criteria, "contract.criteria");
  /** @type {Set<string>} */ const ticketIds = new Set();
  /** @type {Array<{id:string,dependsOn:string[]}>} */
  const normalizedTickets = tickets.map((/** @type {any} */ ticket, /** @type {number} */ index) => {
    assertRecord(ticket, `contract.tickets[${index}]`);
    rejectUnknownKeys(ticket, ["id", "dependsOn"], `contract.tickets[${index}]`);
    assertSafeId(ticket.id, `contract.tickets[${index}].id`);
    if (ticketIds.has(ticket.id)) throw new GovernanceError("contract.tickets ids must be unique");
    ticketIds.add(ticket.id);
    if (!isStringArray(ticket.dependsOn)) throw new GovernanceError(`contract.tickets[${index}].dependsOn must be a string array`);
    for (const dependency of ticket.dependsOn) assertSafeId(dependency, `contract.tickets[${index}].dependsOn`);
    return { id: ticket.id, dependsOn: [...ticket.dependsOn] };
  });
  for (const ticket of normalizedTickets) {
    if (ticket.dependsOn.includes(ticket.id)) throw new GovernanceError(`ticket ${ticket.id} cannot depend on itself`);
    for (const dependency of ticket.dependsOn) {
      if (!ticketIds.has(dependency)) throw new GovernanceError(`ticket ${ticket.id} depends on missing ticket ${dependency}`);
    }
  }
  // Acyclic check via depth-first visiting set.
  /** @type {Set<string>} */ const visiting = new Set();
  /** @type {Set<string>} */ const visited = new Set();
  /** @type {Map<string, string[]>} */ const graph = new Map(normalizedTickets.map((ticket) => [ticket.id, ticket.dependsOn]));
  /** @param {string} id */
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new GovernanceError(`ticket dependency cycle includes ${id}`);
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ticketIds) visit(id);

  /** @type {Set<string>} */ const criterionIds = new Set();
  /** @type {Map<string, number>} */ const perTicket = new Map();
  const normalizedCriteria = criteria.map((/** @type {any} */ criterion, /** @type {number} */ index) => {
    assertRecord(criterion, `contract.criteria[${index}]`);
    rejectUnknownKeys(criterion, ["id", "ticketId", "requirement", "evidenceRequired", "evidenceKind", "requiredCapabilities"], `contract.criteria[${index}]`);
    assertSafeId(criterion.id, `contract.criteria[${index}].id`);
    if (criterionIds.has(criterion.id)) throw new GovernanceError("contract.criteria ids must be unique");
    criterionIds.add(criterion.id);
    if (typeof criterion.ticketId !== "string" || !ticketIds.has(criterion.ticketId)) throw new GovernanceError(`contract.criteria[${index}].ticketId must reference a ticket`);
    if (!isNonEmptyString(criterion.requirement)) throw new GovernanceError(`contract.criteria[${index}].requirement must be a non-empty string`);
    if (!isNonEmptyString(criterion.evidenceRequired)) throw new GovernanceError(`contract.criteria[${index}].evidenceRequired must be a non-empty string`);
    if (criterion.evidenceKind !== undefined && !["check", "observation", "visual"].includes(criterion.evidenceKind)) throw new GovernanceError("Criterion evidence kind is unsupported", "invalid", { field: "contract.criteria.evidenceKind" });
    const requiredCapabilities = criterion.requiredCapabilities === undefined ? [] : validateRequiredCapabilities(criterion.requiredCapabilities);
    perTicket.set(criterion.ticketId, (perTicket.get(criterion.ticketId) ?? 0) + 1);
    return { id: criterion.id, ticketId: criterion.ticketId, requirement: criterion.requirement.trim(), evidenceRequired: criterion.evidenceRequired.trim(), evidenceKind: criterion.evidenceKind ?? "check", requiredCapabilities };
  });
  for (const ticket of normalizedTickets) {
    if ((perTicket.get(ticket.id) ?? 0) < 1) throw new GovernanceError(`ticket ${ticket.id} requires at least one criterion`);
  }
  return { tickets: normalizedTickets, criteria: normalizedCriteria };
}

/** @param {any} capacity */
function validateCapacity(capacity) {
  assertRecord(capacity, "contract.capacity");
  rejectUnknownKeys(capacity, ["total", "providers"], "contract.capacity");
  if (!Number.isSafeInteger(capacity.total) || capacity.total < 1) throw new GovernanceError("contract.capacity.total must be a positive integer");
  assertRecord(capacity.providers, "contract.capacity.providers");
  const providers = capacity.providers;
  if (Object.keys(providers).length === 0) throw new GovernanceError("contract.capacity.providers must name at least one provider");
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const [provider, value] of Object.entries(providers)) {
    assertSafeId(provider, "contract.capacity.providers key");
    if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 1) throw new GovernanceError(`contract.capacity.providers.${provider} must be a positive integer`);
    normalized[provider] = /** @type {number} */ (value);
  }
  return { total: capacity.total, providers: normalized };
}

/**
 * @param {unknown} input
 * @param {{endpoint:string}} policy
 */
export function validateContract(input, policy) {
  assertRecord(input, "contract");
  rejectUnknownKeys(input, ["id", "root", "hostRoot", "baseSha", "endpoint", "authorization", "sources", "tickets", "criteria", "capacity", "requiredCapabilities", "taskKind"], "contract");
  assertSafeId(input.id, "contract.id");
  if (!isNonEmptyString(input.root) || !isAbsolute(input.root)) throw new GovernanceError("contract.root must be an absolute path");
  if (input.hostRoot !== undefined && (!isNonEmptyString(input.hostRoot) || !isAbsolute(input.hostRoot))) throw new GovernanceError("contract.hostRoot must be an absolute path");
  if (typeof input.baseSha !== "string" || !GIT_SHA.test(input.baseSha)) throw new GovernanceError("contract.baseSha must be a 40-character Git SHA");
  if (typeof input.endpoint !== "string" || !["local accepted", "PR", "production"].includes(input.endpoint)) throw new GovernanceError("contract.endpoint must be the retained delivery endpoint: local accepted, PR or production");
  if (!isNonEmptyString(input.authorization)) throw new GovernanceError("contract.authorization must retain a non-empty user instruction");
  if (input.requiredCapabilities === undefined) throw new GovernanceError("Declare the required host capabilities before beginning a run", "declaration_missing", { field: "contract.requiredCapabilities" });
  const requiredCapabilities = validateRequiredCapabilities(input.requiredCapabilities);
  if (input.taskKind !== undefined && !["implementation", "audit"].includes(input.taskKind)) throw new GovernanceError("Task kind must be implementation or audit", "invalid", { field: "contract.taskKind" });
  const sources = validateSources(input.sources, "contract.sources");
  const { tickets, criteria } = validateTicketsAndCriteria(input.tickets, input.criteria);
  const capacity = validateCapacity(input.capacity);
  return {
    id: input.id,
    requiredCapabilities,
    taskKind: input.taskKind ?? "implementation",
    root: input.root,
    hostRoot: input.hostRoot ?? input.root,
    baseSha: input.baseSha,
    endpoint: input.endpoint,
    authorization: input.authorization.trim(),
    sources,
    tickets,
    criteria,
    capacity,
  };
}

/** @param {unknown} value @param {string} label */
export function validateObservation(value, label) {
  assertRecord(value, label);
  rejectUnknownKeys(value, ["kind", "sessionId", "model", "reasoning", "cwd", "transcriptPath", "observedAt"], label);
  if (value.kind !== "session") throw new GovernanceError(`${label}.kind must be "session"`);
  assertSafeId(value.sessionId, `${label}.sessionId`);
  if (!isNonEmptyString(value.model)) throw new GovernanceError(`${label}.model must be a non-empty string`);
  if (!isNonEmptyString(value.cwd)) throw new GovernanceError(`${label}.cwd must be a non-empty string`);
  if (!isNonEmptyString(value.transcriptPath)) throw new GovernanceError(`${label}.transcriptPath must be a non-empty string`);
  return {
    kind: "session",
    sessionId: value.sessionId,
    model: value.model.trim(),
    reasoning: isNonEmptyString(value.reasoning) ? value.reasoning.trim() : null,
    cwd: value.cwd.trim(),
    transcriptPath: value.transcriptPath.trim(),
    observedAt: isNonEmptyString(value.observedAt) ? value.observedAt.trim() : new Date().toISOString(),
  };
}

/**
 * Activation is adapter-supplied and may not override the stored observation.
 * @param {unknown} activation
 * @param {ReturnType<typeof validateObservation>} observation
 */
export function validateActivation(activation, observation) {
  assertRecord(activation, "activation");
  rejectUnknownKeys(activation, ["sessionId", "model", "reasoning", "transcriptPath"], "activation");
  if (activation.sessionId !== observation.sessionId) throw new GovernanceError("activation.sessionId must match the stored host observation");
  if (activation.model !== undefined && activation.model !== observation.model) throw new GovernanceError("activation cannot override the observed model");
  if (activation.reasoning !== undefined && activation.reasoning !== observation.reasoning) throw new GovernanceError("activation cannot override the observed reasoning");
  if (activation.transcriptPath !== undefined && activation.transcriptPath !== observation.transcriptPath) throw new GovernanceError("activation cannot override the observed transcript provenance");
  return { sessionId: observation.sessionId };
}

/** @param {any} route @param {string} label */
export function validateRoute(route, label) {
  assertRecord(route, label);
  rejectUnknownKeys(route, ["role", "provider", "model", "reasoning", "capabilities"], label);
  if (!isNonEmptyString(route.role)) throw new GovernanceError(`${label}.role is required`);
  if (!isNonEmptyString(route.provider)) throw new GovernanceError(`${label}.provider is required`);
  if (!isNonEmptyString(route.model)) throw new GovernanceError(`${label}.model is required`);
  if (route.reasoning !== null && !isNonEmptyString(route.reasoning)) throw new GovernanceError(`${label}.reasoning must be a string or null`);
  if (route.capabilities !== undefined && !isStringArray(route.capabilities)) throw new GovernanceError(`${label}.capabilities must be a string array`);
  return {
    role: route.role.trim(),
    provider: route.provider.trim(),
    model: route.model.trim(),
    reasoning: route.reasoning === null ? null : route.reasoning.trim(),
    capabilities: Array.isArray(route.capabilities) ? [...route.capabilities] : [],
  };
}

/** @param {unknown} input */
export function validateProposal(input) {
  assertRecord(input, "proposal");
  rejectUnknownKeys(input, ["id", "phase", "action", "actorId", "attemptId", "objective", "requirementIds", "sourceIds", "readSet", "writeSet", "dependsOn", "route", "toolName", "toolInput", "evidenceRefs", "observations"], "proposal");
  assertSafeId(input.id, "proposal.id");
  if (!isNonEmptyString(input.phase)) throw new GovernanceError("proposal.phase is required", "invalid", { field: "proposal.phase" });
  if (!isNonEmptyString(input.action)) throw new GovernanceError("proposal.action is required", "invalid", { field: "proposal.action" });
  assertSafeId(input.actorId, "proposal.actorId");
  if (input.attemptId !== null && input.attemptId !== undefined) assertSafeId(input.attemptId, "proposal.attemptId");
  if (!isNonEmptyString(input.objective)) throw new GovernanceError("proposal.objective is required", "invalid", { field: "proposal.objective" });
  if (!isStringArray(input.requirementIds)) throw new GovernanceError("proposal.requirementIds must be a string array", "invalid", { field: "proposal.requirementIds" });
  if (!isStringArray(input.sourceIds)) throw new GovernanceError("proposal.sourceIds must be a string array", "invalid", { field: "proposal.sourceIds" });
  if (!isStringArray(input.readSet)) throw new GovernanceError("proposal readSet must be a string array", "invalid", { field: "proposal.readSet" });
  if (!isStringArray(input.writeSet)) throw new GovernanceError("proposal writeSet must be a string array", "invalid", { field: "proposal.writeSet" });
  for (const path of input.readSet) assertRelativePath(path, "proposal.readSet");
  for (const path of input.writeSet) assertWritableScopePath(path, "proposal.writeSet");
  if (!isStringArray(input.dependsOn)) throw new GovernanceError("proposal.dependsOn must be a string array", "invalid", { field: "proposal.dependsOn" });
  if (input.evidenceRefs !== undefined && !isStringArray(input.evidenceRefs)) throw new GovernanceError("proposal.evidenceRefs must be a string array");
  if (input.observations !== undefined && !isStringArray(input.observations)) throw new GovernanceError("proposal.observations must be a string array");
  if (!isNonEmptyString(input.toolName)) throw new GovernanceError("proposal.toolName is required", "invalid", { field: "proposal.toolName" });
  if (!isRecord(input.toolInput)) throw new GovernanceError("proposal.toolInput must be an object", "invalid", { field: "proposal.toolInput" });
  return {
    id: input.id,
    phase: input.phase.trim(),
    action: input.action.trim(),
    actorId: input.actorId,
    attemptId: input.attemptId ?? null,
    objective: input.objective.trim(),
    requirementIds: [...input.requirementIds],
    sourceIds: [...input.sourceIds],
    readSet: [...(input.readSet ?? [])],
    writeSet: [...(input.writeSet ?? [])],
    dependsOn: [...input.dependsOn],
    route: validateRoute(input.route, "proposal.route"),
    toolName: input.toolName.trim(),
    toolInput: structuredClone(input.toolInput),
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    observations: [...(input.observations ?? [])],
  };
}

/** @param {unknown} input */
export function validateAction(input) {
  assertRecord(input, "action");
  rejectUnknownKeys(input, ["actorId", "attemptId", "toolName", "toolInput"], "action");
  assertSafeId(input.actorId, "action.actorId");
  if (input.attemptId !== null && input.attemptId !== undefined) assertSafeId(input.attemptId, "action.attemptId");
  if (!isNonEmptyString(input.toolName)) throw new GovernanceError("action.toolName is required");
  if (!isRecord(input.toolInput)) throw new GovernanceError("action.toolInput must be an object");
  return {
    actorId: input.actorId,
    attemptId: input.attemptId ?? null,
    toolName: input.toolName.trim(),
    toolInput: structuredClone(input.toolInput),
  };
}

/** @param {unknown} input */
export function validateTransition(input) {
  assertRecord(input, "transition");
  rejectUnknownKeys(input, ["to", "reason", "boundaryId"], "transition");
  if (!isNonEmptyString(input.to)) throw new GovernanceError("transition.to is required", "invalid", { field: "transition.to" });
  if (!isNonEmptyString(input.reason)) throw new GovernanceError("transition.reason is required", "invalid", { field: "transition.reason" });
  assertSafeId(input.boundaryId, "transition.boundaryId");
  return { to: input.to.trim(), reason: input.reason.trim(), boundaryId: input.boundaryId };
}

/** @param {unknown} input */
export function validateOutcome(input) {
  assertRecord(input, "outcome");
  rejectUnknownKeys(input, ["status", "reason", "boundaryId"], "outcome");
  if (!["accepted", "blocked", "interrupted"].includes(input.status)) throw new GovernanceError("outcome.status must be accepted, blocked or interrupted", "invalid", { field: "outcome.status" });
  if (!isNonEmptyString(input.reason)) throw new GovernanceError("outcome.reason is required", "invalid", { field: "outcome.reason" });
  assertSafeId(input.boundaryId, "outcome.boundaryId");
  return { status: input.status, reason: input.reason.trim(), boundaryId: input.boundaryId };
}

/** @param {unknown} input */
export function validatePreToolEvent(input) {
  assertRecord(input, "preToolEvent");
  if (!isNonEmptyString(input.session_id)) throw new GovernanceError("preToolEvent.session_id is required");
  if (input.hook_event_name !== undefined && input.hook_event_name !== "PreToolUse") throw new GovernanceError("preToolEvent.hook_event_name must be PreToolUse");
  if (!isNonEmptyString(input.tool_name)) throw new GovernanceError("preToolEvent.tool_name is required");
  if (input.tool_input !== undefined && !isRecord(input.tool_input)) throw new GovernanceError("preToolEvent.tool_input must be an object");
  return {
    sessionId: input.session_id,
    turnId: isNonEmptyString(input.turn_id) ? input.turn_id : null,
    toolUseId: isNonEmptyString(input.tool_use_id) ? input.tool_use_id : null,
    toolName: input.tool_name.trim(),
    toolInput: isRecord(input.tool_input) ? input.tool_input : {},
    model: isNonEmptyString(input.model) ? input.model.trim() : null,
    reasoning: isNonEmptyString(input.reasoning) ? input.reasoning.trim() : null,
    cwd: isNonEmptyString(input.cwd) ? input.cwd : null,
  };
}

export const HOST_EVENT_KINDS = Object.freeze(["hook", "process-start", "process-exit", "interruption"]);

/**
 * Closed host-event union. `hook` carries an actual Codex event shape, so it
 * tolerates the host's additional fields and normalizes snake_case. The adapter
 * is the only caller; raw user JSON never reaches this function.
 * @param {unknown} input
 */
export function validateHostEvent(input) {
  assertRecord(input, "event");
  if (!HOST_EVENT_KINDS.includes(input.kind)) throw new GovernanceError("event.kind must be hook, process-start, process-exit or interruption");
  const pick = (/** @type {string} */ snake, /** @type {string} */ camel) => (input[snake] !== undefined ? input[snake] : input[camel]);
  if (input.kind === "hook") {
    const sessionId = pick("session_id", "sessionId");
    const hookEventName = pick("hook_event_name", "hookEventName");
    if (!isNonEmptyString(sessionId)) throw new GovernanceError("event.session_id is required");
    if (!["PostToolUse", "SubagentStart", "SubagentStop", "Stop"].includes(hookEventName)) throw new GovernanceError("event.hook_event_name must be PostToolUse, SubagentStart, SubagentStop or Stop");
    const changedPaths = pick("changed_paths", "changedPaths");
    if (changedPaths !== undefined && !isStringArray(changedPaths)) throw new GovernanceError("event.changed_paths must be a string array");
    const rawOutput = input.output ?? input.tool_response;
    return {
      kind: "hook",
      sessionId,
      hookEventName,
      turnId: isNonEmptyString(pick("turn_id", "turnId")) ? pick("turn_id", "turnId") : null,
      toolUseId: isNonEmptyString(pick("tool_use_id", "toolUseId")) ? pick("tool_use_id", "toolUseId") : null,
      toolName: isNonEmptyString(pick("tool_name", "toolName")) ? pick("tool_name", "toolName") : null,
      toolInput: isRecord(input.tool_input) ? input.tool_input : isRecord(input.toolInput) ? input.toolInput : {},
      rawOutput,
      output: rawOutput === undefined || rawOutput === null ? null : typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput),
      cwd: isNonEmptyString(input.cwd) ? input.cwd : null,
      model: isNonEmptyString(input.model) ? input.model : null,
      reasoning: isNonEmptyString(input.reasoning) ? input.reasoning : null,
      changedPaths: Array.isArray(changedPaths) ? [...changedPaths] : [],
      agentId: isNonEmptyString(pick("agent_id", "agentId")) ? pick("agent_id", "agentId") : null,
      parentSessionId: isNonEmptyString(pick("parent_session_id", "parentSessionId")) ? pick("parent_session_id", "parentSessionId") : null,
      attemptId: isNonEmptyString(pick("attempt_id", "attemptId")) ? pick("attempt_id", "attemptId") : null,
    };
  }
  if (input.kind === "process-start" || input.kind === "process-exit") {
    rejectUnknownKeys(input, ["kind", "attemptId", "attempt_id", "processId", "process_id", "provider", "model", "reasoning", "exitCode", "exit_code", "exitSignal", "reconciliationFailed", "terminated", "cancelled", "output", "changedPaths", "changed_paths", "candidateRoot", "processSessionId", "command"], "event");
    const attemptId = pick("attempt_id", "attemptId");
    const processId = pick("process_id", "processId");
    const exitCode = pick("exit_code", "exitCode");
    assertSafeId(attemptId, "event.attempt_id");
    if (!isNonEmptyString(processId)) throw new GovernanceError("event.process_id is required");
    if (!isNonEmptyString(input.provider)) throw new GovernanceError("event.provider is required");
    if (!isNonEmptyString(input.model)) throw new GovernanceError("event.model is required");
    if (typeof input.candidateRoot !== "string" || !isAbsolute(input.candidateRoot)) throw new GovernanceError("process event candidateRoot must be absolute");
    if (input.processSessionId !== undefined) assertSafeId(input.processSessionId, "event.processSessionId");
    if (!isRecord(input.command) || Object.keys(input.command).some((key) => !["executable", "argv"].includes(key)) || typeof input.command.executable !== "string" || !isAbsolute(input.command.executable) || !isStringArray(input.command.argv)) throw new GovernanceError("process event requires exact actual command identity");
    if (input.kind === "process-exit") {
      if (input.exitSignal !== undefined && input.exitSignal !== null && (typeof input.exitSignal !== "string" || !/^SIG[A-Z0-9]+$/u.test(input.exitSignal))) throw new GovernanceError("event.exitSignal must be an observed signal or null");
      if (!Number.isSafeInteger(exitCode) && !(exitCode === null && typeof input.exitSignal === "string")) throw new GovernanceError("event.exit_code must be an integer or null for a signalled exit");
      if (input.reconciliationFailed !== undefined && typeof input.reconciliationFailed !== "boolean") throw new GovernanceError("event.reconciliationFailed must be a boolean");
      if (typeof input.terminated !== "boolean") throw new GovernanceError("event.terminated must be a boolean");
      const changedPaths = pick("changed_paths", "changedPaths");
      if (changedPaths !== undefined && !isStringArray(changedPaths)) throw new GovernanceError("event.changed_paths must be a string array");
    }
    return {
      kind: input.kind,
      attemptId,
      processId: String(processId),
      provider: input.provider,
      model: input.model,
      reasoning: isNonEmptyString(input.reasoning) ? input.reasoning : null,
      candidateRoot: input.candidateRoot,
      processSessionId: input.processSessionId ?? null,
      command: structuredClone(input.command),
      cancelled: input.cancelled === true,
      exitCode: Number.isSafeInteger(exitCode) || exitCode === null ? exitCode : undefined,
      exitSignal: input.exitSignal ?? null,
      reconciliationFailed: input.reconciliationFailed === true,
      terminated: typeof input.terminated === "boolean" ? input.terminated : undefined,
      output: typeof input.output === "string" ? input.output : undefined,
      changedPaths: Array.isArray(pick("changed_paths", "changedPaths")) ? [...pick("changed_paths", "changedPaths")] : [],
    };
  }
  const sessionId = pick("session_id", "sessionId");
  const attemptId = pick("attempt_id", "attemptId");
  if (sessionId !== undefined) assertSafeId(sessionId, "event.session_id");
  if (attemptId !== undefined) assertSafeId(attemptId, "event.attempt_id");
  return {
    kind: "interruption",
    sessionId: sessionId ?? null,
    attemptId: attemptId ?? null,
    turnId: isNonEmptyString(pick("turn_id", "turnId")) ? pick("turn_id", "turnId") : null,
    reason: isNonEmptyString(input.reason) ? input.reason : null,
  };
}

/** @param {any} value */
export function isSha256(value) {
  return typeof value === "string" && SHA256.test(value);
}
