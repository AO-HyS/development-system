// @ts-check

import { createHash } from "node:crypto";

/** @typedef {Record<string, unknown>} RecordValue */
/** @typedef {RecordValue & {
 * id: string | undefined,
 * title: string | undefined,
 * dependsOn: string[],
 * acceptanceCriteria: string[],
 * checks: string[],
 * outcome: string | undefined,
 * status: string,
 * index: number,
 * fitsFreshContext?: boolean,
 * contextFit?: boolean,
 * demonstrable?: boolean,
 * verifiable?: boolean,
 * }} NormalizedTicket */

const terminalStatuses = new Set(["closed", "completed", "done", "merged", "released"]);

/** @param {unknown} value @returns {value is RecordValue} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {string[]} */
function stringList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/** @param {unknown} value @returns {unknown} */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableValue(entry)]));
}

/** @param {unknown} value @returns {string} */
function hashValue(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

/** @param {...unknown} values @returns {string | undefined} */
function firstString(...values) {
  const found = values.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof found === "string" ? found.trim() : undefined;
}

/** @param {unknown} source @returns {RecordValue[]} */
function extractTickets(source) {
  if (Array.isArray(source)) return source.filter(isRecord);
  if (!isRecord(source)) return [];
  const nested = [source.tickets, source.slices, source.structureOutline, source.ticketMap];
  for (const candidate of nested) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
    if (isRecord(candidate)) {
      const extracted = extractTickets(candidate);
      if (extracted.length > 0) return extracted;
    }
  }
  return [];
}

/** @param {RecordValue} ticket @param {number} index @returns {NormalizedTicket} */
function normalizeTicket(ticket, index) {
  const id = firstString(ticket.id, ticket.sliceId, ticket.key);
  const dependsOn = stringList(ticket.dependsOn ?? ticket.blockedBy ?? ticket.dependencies);
  const acceptanceCriteria = stringList(ticket.acceptanceCriteria ?? ticket.acceptance ?? ticket.criteria);
  const checks = stringList(ticket.focusedChecks ?? ticket.checks ?? ticket.verification);
  const outcome = firstString(ticket.outcome, ticket.userOutcome, ticket.value, ticket.description);
  const status = (firstString(ticket.status) ?? "ready-for-agent").toLowerCase();
  return {
    ...ticket,
    id,
    title: firstString(ticket.title),
    dependsOn,
    acceptanceCriteria,
    checks,
    outcome,
    status,
    index,
  };
}

/** @param {NormalizedTicket[]} tickets */
function dependencyDetails(tickets) {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const errors = [];
  const edges = [];
  const reverse = new Map();
  for (const ticket of tickets) {
    if (typeof ticket.id !== "string" || ticket.id.length === 0) {
      errors.push(`ticket ${String(ticket.index)} must have an id`);
      continue;
    }
    const seenDependencies = new Set();
    for (const dependency of ticket.dependsOn) {
      if (dependency === ticket.id) errors.push(`ticket ${ticket.id} cannot depend on itself`);
      if (seenDependencies.has(dependency)) errors.push(`ticket ${ticket.id} repeats dependency ${dependency}`);
      seenDependencies.add(dependency);
      if (!byId.has(dependency)) errors.push(`ticket ${ticket.id} depends on unknown ticket ${dependency}`);
      edges.push({ from: dependency, to: ticket.id });
      const dependents = reverse.get(dependency) ?? [];
      dependents.push(ticket.id);
      reverse.set(dependency, dependents);
    }
  }
  const indegree = new Map(tickets.map((ticket) => [ticket.id, ticket.dependsOn.filter((dependency) => byId.has(dependency)).length]));
  const queue = tickets.filter((ticket) => indegree.get(ticket.id) === 0).map((ticket) => ticket.id);
  const dependencyOrder = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    dependencyOrder.push(id);
    for (const dependent of reverse.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  if (dependencyOrder.length !== tickets.length) errors.push("ticket dependencies contain a cycle");
  const frontier = tickets
    .filter((ticket) => !terminalStatuses.has(ticket.status))
    .filter((ticket) => ticket.dependsOn.every((dependency) => {
      const dependencyTicket = byId.get(dependency);
      return dependencyTicket !== undefined && terminalStatuses.has(dependencyTicket.status);
    }))
    .map((ticket) => ticket.id);
  return { errors, edges, dependencyOrder, frontier, byId };
}

/**
 * Validate that a Structure Outline / ticket map is made of end-to-end slices
 * and expose its native blocking graph and executable frontier.
 * @param {unknown} input
 */
export function validateVerticalTicketSlices(input) {
  const rawTickets = extractTickets(input);
  const tickets = rawTickets.map(normalizeTicket);
  const errors = [];
  if (rawTickets.length === 0) errors.push("ticket map requires at least one ticket slice");
  const ids = new Set();
  for (const ticket of tickets) {
    if (typeof ticket.id !== "string" || ticket.id.length === 0) continue;
    if (ids.has(ticket.id)) errors.push(`ticket id ${ticket.id} is duplicated`);
    ids.add(ticket.id);
    if (typeof ticket.outcome !== "string" || ticket.outcome.length === 0) errors.push(`ticket ${ticket.id} requires an observable outcome`);
    if (ticket.acceptanceCriteria.length === 0 && ticket.checks.length === 0) errors.push(`ticket ${ticket.id} requires acceptance criteria or focused checks`);
    if (ticket.fitsFreshContext === false || ticket.contextFit === false) errors.push(`ticket ${ticket.id} does not fit a fresh implementation context`);
    if (ticket.demonstrable === false && ticket.verifiable === false) errors.push(`ticket ${ticket.id} must be demonstrable or verifiable`);
  }
  const details = dependencyDetails(tickets);
  errors.push(...details.errors);
  return {
    ok: errors.length === 0,
    errors,
    tickets,
    dependencyOrder: details.dependencyOrder,
    blockingEdges: details.edges,
    frontier: details.frontier,
  };
}

/** @param {unknown} input */
export function assertValidVerticalTicketSlices(input) {
  const result = validateVerticalTicketSlices(input);
  if (!result.ok) throw new Error(`Invalid vertical ticket slices: ${result.errors.join("; ")}`);
  return result;
}

/** @param {unknown} value @returns {RecordValue[]} */
function extractArtifacts(value) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.artifacts)) return value.artifacts.filter(isRecord);
  return [];
}

/** @param {RecordValue} artifact @returns {RecordValue | null} */
function approvedArtifactRef(artifact) {
  const id = firstString(artifact.id);
  const contentHash = firstString(artifact.contentHash, artifact.hash);
  if (!id || !contentHash || artifact.status !== "approved") return null;
  return { id, role: firstString(artifact.role) ?? "unknown", contentHash };
}

/** @param {unknown} value @returns {RecordValue} */
function normalizeRepository(value) {
  const repository = isRecord(value) ? value : {};
  return {
    identity: firstString(repository.identity, repository.repoIdentity, repository.repository, repository.path),
    baseRevision: firstString(repository.baseRevision, repository.revision, repository.sha),
  };
}

/** @param {unknown} value @returns {RecordValue} */
function normalizeTrackerState(value) {
  if (!isRecord(value)) return { status: "unknown", issues: [] };
  const issues = Array.isArray(value.issues)
    ? value.issues.filter(isRecord).map((issue) => ({
        sliceId: firstString(issue.sliceId, issue.ticketId, issue.sourceId),
        id: firstString(issue.id, issue.identifier),
        status: firstString(issue.status) ?? "unknown",
      }))
    : [];
  const state = { status: firstString(value.status) ?? "unknown", issues };
  return { ...state, snapshotHash: firstString(value.snapshotHash) ?? hashValue(state) };
}

/** @param {RecordValue} source */
function isPublicationApproved(source) {
  return source.publicationApproval === true || source.publicationAuthorized === true || source.authorizePublication === true || (isRecord(source.approval) && source.approval.publication === true);
}

/** @param {RecordValue} options @param {unknown} ticketMap */
function isTicketMapApproved(options, ticketMap) {
  if (options.ticketMapApproved === true || options.ticketMapApproval === true || options.implementationMapApproved === true) return true;
  if (isRecord(options.approval) && (options.approval.ticketMap === true || options.approval.implementationMap === true)) return true;
  if (isRecord(ticketMap) && (ticketMap.approved === true || ticketMap.status === "approved")) return true;
  return false;
}

/**
 * Prepare a deterministic publication intent. This function never invokes a
 * tracker or writes repository/lifecycle state.
 * @param {RecordValue} options
 */
export function prepareTicketPublication(options = {}) {
  const ticketMap = options.ticketMap ?? options.structureOutline ?? options.tickets;
  const validation = validateVerticalTicketSlices(ticketMap);
  if (!validation.ok) return { ok: false, operation: "prepare-ticket-publication", errors: validation.errors, externalSideEffects: [] };
  const mapApproved = isTicketMapApproved(options, ticketMap);
  if (!mapApproved) return { ok: false, operation: "prepare-ticket-publication", errors: ["ticket-map approval is required before publication"], externalSideEffects: [] };
  const artifacts = extractArtifacts(options.approvedArtifacts ?? options.artifacts);
  const governingArtifacts = artifacts.map(approvedArtifactRef).filter((artifact) => artifact !== null);
  if (artifacts.length > 0 && governingArtifacts.length !== artifacts.length) {
    return { ok: false, operation: "prepare-ticket-publication", errors: ["all governing artifacts must be approved and include content hashes"], externalSideEffects: [] };
  }
  const repository = normalizeRepository(options.repository);
  if (!repository.identity || !repository.baseRevision) return { ok: false, operation: "prepare-ticket-publication", errors: ["repository identity and base revision are required"], externalSideEffects: [] };
  const intentBody = {
    workflowId: firstString(options.workflowId) ?? "working-backwards",
    repository,
    governingArtifacts,
    dependencyOrder: validation.dependencyOrder,
    frontier: validation.frontier,
    tickets: validation.dependencyOrder.map((id) => validation.tickets.find((ticket) => ticket.id === id)),
  };
  return {
    ok: true,
    operation: "prepare-ticket-publication",
    intentId: hashValue(intentBody),
    ...intentBody,
    publicationAuthorized: false,
    implementationAuthorized: false,
    repositoryWritesAuthorized: false,
    pushAuthorized: false,
    pullRequestAuthorized: false,
    promotionAuthorized: false,
    externalSideEffects: [],
  };
}

/**
 * Publish through an injected tracker adapter in topological dependency order.
 * No default tracker, network client, repository operation, or lifecycle
 * transition exists in this interface.
 * @param {RecordValue} options
 */
export async function publishApprovedTickets(options = {}) {
  const intent = isRecord(options.intent) ? options.intent : null;
  if (!intent || intent.ok !== true) throw new Error("A valid publication intent is required");
  if (!isPublicationApproved(options)) throw new Error("Explicit ticket publication authorization is required");
  const tracker = isRecord(options.tracker) ? options.tracker : null;
  const createIssue = tracker?.createIssue ?? tracker?.createTicket;
  if (typeof createIssue !== "function") throw new Error("Publication requires an injected tracker createIssue function");
  const tickets = Array.isArray(intent.tickets) ? intent.tickets.filter(isRecord) : [];
  const created = [];
  const trackerIds = new Map();
  for (const ticket of tickets) {
    const dependencies = stringList(ticket.dependsOn).map((sliceId) => trackerIds.get(sliceId) ?? sliceId);
    const result = await createIssue({
      sliceId: ticket.id,
      title: firstString(ticket.title) ?? ticket.id,
      outcome: ticket.outcome,
      acceptanceCriteria: ticket.acceptanceCriteria,
      checks: ticket.checks,
      dependsOn: dependencies,
      sourceTicket: ticket,
    });
    if (!isRecord(result) || !firstString(result.id, result.identifier)) throw new Error(`Tracker did not return an identifier for ${String(ticket.id)}`);
    const trackerId = firstString(result.id, result.identifier);
    trackerIds.set(String(ticket.id), trackerId);
    created.push({ sliceId: ticket.id, id: trackerId, status: firstString(result.status) ?? "created" });
  }
  const trackerState = normalizeTrackerState({ status: "published", issues: created });
  return {
    ok: true,
    operation: "publish-approved-tickets",
    publicationAuthorized: true,
    created,
    dependencyOrder: intent.dependencyOrder,
    frontier: intent.frontier,
    trackerState,
    externalSideEffects: ["tracker.createIssue"],
    implementationAuthorized: false,
    repositoryWritesAuthorized: false,
    pushAuthorized: false,
    pullRequestAuthorized: false,
    promotionAuthorized: false,
  };
}

/** @param {unknown} value @returns {RecordValue[]} */
function artifactRefsFrom(value) {
  const refs = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.governingArtifacts) ? value.governingArtifacts : [];
  return refs.filter(isRecord).map((ref) => ({ id: firstString(ref.id), role: firstString(ref.role) ?? "unknown", contentHash: firstString(ref.contentHash, ref.hash) })).filter((ref) => ref.id && ref.contentHash);
}

/**
 * Create a compact private handoff. It references approved artifacts rather
 * than copying their content and deliberately grants no implementation rights.
 * @param {RecordValue} options
 */
export function createT3ImplementationHandoff(options = {}) {
  const intent = isRecord(options.intent) ? options.intent : null;
  const publication = isRecord(options.publication) ? options.publication : null;
  const validation = validateVerticalTicketSlices(options.ticketMap ?? intent?.tickets ?? options.tickets);
  if (!validation.ok) throw new Error(`Cannot create handoff: ${validation.errors.join("; ")}`);
  const artifactInput = options.approvedArtifacts ?? options.artifacts ?? intent?.governingArtifacts;
  const rawArtifactRefs = Array.isArray(artifactInput) ? artifactInput.filter(isRecord) : [];
  const artifactRefs = artifactRefsFrom(artifactInput);
  if (artifactRefs.length === 0) throw new Error("T3 handoff requires approved artifact IDs and hashes");
  if (rawArtifactRefs.length !== artifactRefs.length) throw new Error("T3 handoff artifact references are incomplete");
  if (artifactRefs.some((ref) => !ref.id || !ref.contentHash)) throw new Error("T3 handoff artifact references are incomplete");
  const repository = normalizeRepository(options.repository ?? intent?.repository);
  if (!repository.identity || !repository.baseRevision) throw new Error("T3 handoff requires repository identity and base revision");
  const trackerState = normalizeTrackerState(options.trackerState ?? publication?.trackerState);
  if (trackerState.status === "unknown") throw new Error("T3 handoff requires tracker state");
  const firstSliceId = firstString(options.firstTerminalSlice, options.firstTerminalSliceId) ?? validation.frontier[0];
  if (!firstSliceId || !validation.frontier.includes(firstSliceId)) throw new Error("First terminal slice must be in the executable frontier");
  const ticket = validation.tickets.find((candidate) => candidate.id === firstSliceId);
  const gates = isRecord(options.gates) ? options.gates : { product: "approved", technical: "approved", implementationMap: "approved", publication: "approved", implementPreview: "required" };
  const body = {
    schemaVersion: 1,
    operation: "t3-implementation-handoff",
    visibility: "private",
    workflowId: firstString(options.workflowId) ?? intent?.workflowId ?? "working-backwards",
    approvedArtifacts: artifactRefs,
    repository,
    tracker: trackerState,
    frontier: validation.frontier,
    blockingEdges: validation.blockingEdges,
    firstTerminalSlice: { id: firstSliceId, title: firstString(ticket?.title) ?? firstSliceId, outcome: ticket?.outcome, acceptanceCriteria: ticket?.acceptanceCriteria ?? [], dependsOn: ticket?.dependsOn ?? [] },
    firstTerminalSliceId: firstSliceId,
    checks: stringList(options.checks ?? options.focusedChecks),
    risks: stringList(options.risks),
    gates,
  };
  return {
    ...body,
    handoffHash: hashValue(body),
    implementationAuthorized: false,
    requiresImplementPreview: true,
    repositoryWritesAuthorized: false,
    pushAuthorized: false,
    pullRequestAuthorized: false,
    promotionAuthorized: false,
    externalSideEffects: [],
  };
}

/** @param {unknown} value @returns {RecordValue[]} */
function currentArtifactRefs(value) {
  return extractArtifacts(value).map((artifact) => ({ id: firstString(artifact.id), contentHash: firstString(artifact.contentHash, artifact.hash), status: firstString(artifact.status) })).filter((artifact) => artifact.id);
}

/**
 * Revalidate all handoff inputs. Missing evidence is drift, so callers receive
 * a refresh request instead of an implementation authorization.
 * @param {RecordValue} options
 */
export function verifyT3HandoffFreshness(options = {}) {
  const handoff = isRecord(options.handoff) ? options.handoff : null;
  const drift = [];
  if (!handoff || handoff.visibility !== "private" || handoff.operation !== "t3-implementation-handoff") drift.push("handoff is missing or invalid");
  if (handoff && handoff.implementationAuthorized !== false) drift.push("handoff authorization is invalid");
  if (handoff && handoff.requiresImplementPreview !== true) drift.push("handoff must require Implement Preview");
  const expectedRepository = normalizeRepository(handoff?.repository);
  const currentRepository = normalizeRepository(options.repository ?? options.currentRepository);
  if (!expectedRepository.identity || !expectedRepository.baseRevision) drift.push("handoff repository evidence is incomplete");
  if (!currentRepository.identity || !currentRepository.baseRevision) drift.push("current repository evidence is missing");
  if (expectedRepository.identity !== currentRepository.identity) drift.push("repository identity drift");
  if (expectedRepository.baseRevision !== currentRepository.baseRevision) drift.push("repository base revision drift");
  const expectedTracker = normalizeTrackerState(handoff?.tracker);
  const currentTracker = normalizeTrackerState(options.trackerState ?? options.currentTrackerState);
  if (expectedTracker.status === "unknown") drift.push("handoff tracker evidence is incomplete");
  if (currentTracker.status === "unknown") drift.push("current tracker evidence is missing");
  if (expectedTracker.snapshotHash !== currentTracker.snapshotHash) drift.push("tracker state drift");
  const rawExpectedArtifacts = Array.isArray(handoff?.approvedArtifacts) ? handoff.approvedArtifacts.filter(isRecord) : [];
  const expectedArtifacts = artifactRefsFrom(handoff?.approvedArtifacts);
  const actualArtifacts = currentArtifactRefs(options.approvedArtifacts ?? options.artifacts ?? options.currentArtifacts);
  if (expectedArtifacts.length === 0 || rawExpectedArtifacts.length !== expectedArtifacts.length) drift.push("handoff governing artifact evidence is missing");
  for (const expected of expectedArtifacts) {
    const actual = actualArtifacts.find((candidate) => candidate.id === expected.id);
    if (!actual || actual.status !== "approved" || actual.contentHash !== expected.contentHash) drift.push(`governing artifact drift: ${expected.id}`);
  }
  if (!Array.isArray(handoff?.frontier) || handoff.frontier.length === 0) drift.push("handoff frontier is missing");
  const ok = drift.length === 0;
  return {
    ok,
    fresh: ok,
    stale: !ok,
    drift,
    requiresRefresh: !ok,
    implementationAuthorized: false,
    requiresImplementPreview: true,
  };
}

export const preparePublicationIntent = prepareTicketPublication;
export const publishTickets = publishApprovedTickets;
export const createT3Handoff = createT3ImplementationHandoff;
export const validateHandoffFreshness = verifyT3HandoffFreshness;
