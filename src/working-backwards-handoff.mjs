// @ts-check

import { createHash } from "node:crypto";
import { WORKING_BACKWARDS_GATE_ROLES, hashWorkingBackwardsValue, normalizeWorkingBackwardsRepositoryIdentity } from "./working-backwards-gates.mjs";

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
    if (ticket.fitsFreshContext !== true && ticket.contextFit !== true) errors.push(`ticket ${ticket.id} requires affirmative fit for a fresh implementation context`);
    if (ticket.demonstrable !== true && ticket.verifiable !== true) errors.push(`ticket ${ticket.id} must be affirmatively demonstrable or verifiable`);
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
  const sourceRevision = firstString(artifact.sourceRevision);
  const sourceIdentity = normalizeWorkingBackwardsRepositoryIdentity(artifact.sourceIdentity);
  if (!id || !contentHash || artifact.status !== "approved" || artifact.stale === true || artifact.content === undefined || hashValue(artifact.content) !== contentHash || !sourceIdentity || !sourceRevision || !isRecord(artifact.lineage) || normalizeWorkingBackwardsRepositoryIdentity(artifact.lineage.sourceIdentity) !== sourceIdentity || artifact.lineage.sourceRevision !== sourceRevision) return null;
  return { id, role: firstString(artifact.role) ?? "unknown", contentHash, sourceIdentity, sourceRevision, lineage: artifact.lineage };
}

/** @param {unknown} value @returns {RecordValue} */
function normalizeRepository(value) {
  const repository = isRecord(value) ? value : {};
  return {
    identity: normalizeWorkingBackwardsRepositoryIdentity(firstString(repository.identity, repository.repoIdentity, repository.repository, repository.path)),
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

class PartialPublicationError extends Error {
  /** @param {RecordValue} receipt @param {unknown} cause */
  constructor(receipt, cause) {
    super(`Ticket publication partially failed at ${String(receipt.failedSliceId)}`, { cause });
    this.name = "PartialPublicationError";
    this.code = "WORKING_BACKWARDS_PARTIAL_PUBLICATION";
    this.receipt = receipt;
  }
}

/** @param {RecordValue} body */
function publicationResumeReceipt(body) {
  return { ...body, receiptHash: hashValue(body) };
}

/** @param {RecordValue} receipt */
function validPublicationResumeReceipt(receipt) {
  const body = {
    schemaVersion: receipt.schemaVersion,
    operation: receipt.operation,
    intentId: receipt.intentId,
    failedSliceId: receipt.failedSliceId,
    created: receipt.created,
    reconciled: receipt.reconciled,
    safeToResume: receipt.safeToResume,
    nextDependencyOrder: receipt.nextDependencyOrder,
    authorityConsumed: receipt.authorityConsumed,
    authorityReceipt: receipt.authorityReceipt,
    implementationAuthorized: receipt.implementationAuthorized,
  };
  return receipt.schemaVersion === 1 && receipt.operation === "publish-approved-tickets" && receipt.safeToResume === true && receipt.authorityConsumed === true && (typeof receipt.authorityReceipt === "string" || isRecord(receipt.authorityReceipt)) && receipt.implementationAuthorized === false && receipt.receiptHash === hashValue(body);
}

/** @param {unknown} value @param {string} workflowId @param {RecordValue[]} artifacts @param {unknown} ticketMap @param {RecordValue} repository */
function validateGateReceipts(value, workflowId, artifacts, ticketMap, repository) {
  const required = ["product", "technical", "implementationMap"];
  const receipts = Array.isArray(value) ? value.filter(isRecord) : [];
  const errors = [];
  if (receipts.length !== 3) errors.push("complete persisted gate receipts are required");
  for (const gate of required) {
    const receipt = receipts.find((candidate) => candidate.gate === gate);
    if (!receipt) {
      errors.push(`missing ${gate} gate receipt`);
      continue;
    }
    if (receipt.workflowId !== workflowId) errors.push(`${gate} gate receipt workflow mismatch`);
    if (receipt.repositoryIdentity !== repository.identity || receipt.repositoryRevision !== repository.baseRevision) errors.push(`${gate} gate receipt repository mismatch`);
    const snapshots = Array.isArray(receipt.artifacts) ? receipt.artifacts.filter(isRecord) : [];
    if (snapshots.length === 0) errors.push(`${gate} gate receipt has no artifact snapshots`);
    const roles = WORKING_BACKWARDS_GATE_ROLES[/** @type {keyof typeof WORKING_BACKWARDS_GATE_ROLES} */ (gate)];
    if (!snapshots.some((snapshot) => roles.includes(String(snapshot.role)))) errors.push(`${gate} gate receipt has no governing artifact role`);
    const receiptBody = {
      schemaVersion: receipt.schemaVersion,
      workflowId: receipt.workflowId,
      gate: receipt.gate,
      repositoryIdentity: receipt.repositoryIdentity,
      repositoryRevision: receipt.repositoryRevision,
      artifacts: receipt.artifacts,
      approvedAt: receipt.approvedAt,
    };
    if (receipt.receiptHash !== hashWorkingBackwardsValue(receiptBody)) errors.push(`${gate} gate receipt integrity failure`);
    for (const snapshot of snapshots) {
      const artifact = artifacts.find((candidate) => candidate.id === snapshot.id && candidate.role === snapshot.role);
      if (!artifact || artifact.contentHash !== snapshot.contentHash || artifact.sourceIdentity !== repository.identity || snapshot.sourceIdentity !== repository.identity || artifact.sourceRevision !== repository.baseRevision || snapshot.sourceRevision !== repository.baseRevision || JSON.stringify(stableValue(artifact.lineage)) !== JSON.stringify(stableValue(snapshot.lineage))) errors.push(`${gate} gate receipt artifact drift: ${String(snapshot.id)}`);
    }
  }
  const implementation = receipts.find((candidate) => candidate.gate === "implementationMap");
  if (implementation && implementation.ticketMapHash !== hashValue(ticketMap)) errors.push("Implementation Map receipt is not bound to the exact ticket-map hash");
  const approvedTicketMap = Array.isArray(implementation?.artifacts) ? implementation.artifacts.find((artifact) => isRecord(artifact) && artifact.role === "ticket-map") : null;
  if (implementation && (!approvedTicketMap || approvedTicketMap.contentHash !== implementation.ticketMapHash)) errors.push("Implementation Map receipt ticket-map artifact does not match its bound hash");
  const snapshottedIds = new Set(receipts.flatMap((receipt) => Array.isArray(receipt.artifacts) ? receipt.artifacts.filter(isRecord).map((artifact) => artifact.id) : []));
  if (artifacts.some((artifact) => !snapshottedIds.has(artifact.id))) errors.push("approved governing artifact set is incomplete");
  return { ok: errors.length === 0, errors, receipts };
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
  const artifacts = extractArtifacts(options.approvedArtifacts ?? options.artifacts);
  const governingArtifacts = artifacts.map(approvedArtifactRef).filter((artifact) => artifact !== null);
  if (artifacts.length === 0 || governingArtifacts.length !== artifacts.length) {
    return { ok: false, operation: "prepare-ticket-publication", errors: ["a nonempty complete governing artifact set must be approved, non-stale, and hash-verified"], externalSideEffects: [] };
  }
  const repository = normalizeRepository(options.repository);
  if (!repository.identity || !repository.baseRevision) return { ok: false, operation: "prepare-ticket-publication", errors: ["repository identity and base revision are required"], externalSideEffects: [] };
  const workflowId = firstString(options.workflowId) ?? "working-backwards";
  const gateValidation = validateGateReceipts(options.gateReceipts, workflowId, artifacts, ticketMap, repository);
  if (!gateValidation.ok) return { ok: false, operation: "prepare-ticket-publication", errors: gateValidation.errors, externalSideEffects: [] };
  const intentBody = {
    workflowId,
    repository,
    governingArtifacts,
    gateReceipts: gateValidation.receipts,
    gateReceiptsHash: hashValue(gateValidation.receipts),
    ticketMapHash: hashValue(ticketMap),
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
  const approval = isRecord(options.publicationApproval) ? options.publicationApproval : null;
  if (!approval || approval.authorized !== true || approval.intentId !== intent.intentId) throw new Error("Explicit ticket publication authorization must bind the exact intent ID");
  const tracker = isRecord(options.tracker) ? options.tracker : null;
  const createIssue = tracker?.createIssue ?? tracker?.createTicket;
  if (typeof createIssue !== "function") throw new Error("Publication requires an injected tracker createIssue function");
  const lookupIssue = tracker?.findByIdempotencyKey ?? tracker?.lookupIssue;
  const tickets = Array.isArray(intent.tickets) ? intent.tickets.filter(isRecord) : [];
  const resumeReceipt = isRecord(options.resumeReceipt) ? options.resumeReceipt : null;
  const authority = isRecord(options.authority) ? options.authority : null;
  let authorityReceipt = resumeReceipt?.authorityReceipt ?? null;
  if (resumeReceipt && resumeReceipt.intentId !== intent.intentId) throw new Error("Resume receipt does not match publication intent");
  if (resumeReceipt && !validPublicationResumeReceipt(resumeReceipt)) throw new Error("Resume receipt integrity is invalid");
  if (resumeReceipt) {
    if (typeof lookupIssue !== "function") throw new Error("Publication resume requires tracker reconciliation by idempotency key");
    if (typeof authority?.validateResume !== "function") throw new Error("Publication resume requires injected authority validation");
    const validation = await authority.validateResume({ intentId: intent.intentId, authorityReceipt: resumeReceipt.authorityReceipt, publicationReceipt: resumeReceipt });
    if (validation !== true && (!isRecord(validation) || validation.valid !== true || validation.intentId !== intent.intentId)) throw new Error("Publication resume authority validation failed");
  } else {
    if (typeof authority?.consumeIntent !== "function") throw new Error("Publication requires an injected one-shot intent authority");
    const consumed = await authority.consumeIntent({ intentId: intent.intentId, operation: "publish-approved-tickets" });
    if (!isRecord(consumed) || consumed.consumed !== true || consumed.intentId !== intent.intentId || !(typeof consumed.resumeToken === "string" || isRecord(consumed.resumeToken))) throw new Error("Publication intent authority must return an opaque consumed-intent receipt");
    authorityReceipt = consumed.resumeToken;
  }
  const created = Array.isArray(resumeReceipt?.created) ? resumeReceipt.created.filter(isRecord).map((entry) => ({ ...entry })) : [];
  const reconciled = /** @type {RecordValue[]} */ ([]);
  const trackerIds = new Map(created.map((entry) => [String(entry.sliceId), entry.id]));
  /** @param {RecordValue} ticket @param {unknown} cause */
  const partialFailure = (ticket, cause) => new PartialPublicationError(publicationResumeReceipt({
    schemaVersion: 1,
    operation: "publish-approved-tickets",
    intentId: intent.intentId,
    failedSliceId: ticket.id,
    created,
    reconciled,
    safeToResume: true,
    nextDependencyOrder: tickets.filter((candidate) => !trackerIds.has(String(candidate.id))).map((candidate) => candidate.id),
    authorityConsumed: true,
    authorityReceipt,
    implementationAuthorized: false,
  }), cause);
  for (const ticket of tickets) {
    if (trackerIds.has(String(ticket.id))) continue;
    const idempotencyKey = hashValue({ intentId: intent.intentId, sliceId: ticket.id });
    const dependencies = stringList(ticket.dependsOn).map((sliceId) => trackerIds.get(sliceId) ?? sliceId);
    let existing = null;
    try {
      existing = typeof lookupIssue === "function" ? await lookupIssue({ idempotencyKey, intentId: intent.intentId, sliceId: ticket.id }) : null;
    } catch (error) {
      throw partialFailure(ticket, error);
    }
    if (isRecord(existing) && firstString(existing.id, existing.identifier)) {
      const trackerId = firstString(existing.id, existing.identifier);
      trackerIds.set(String(ticket.id), trackerId);
      const entry = { sliceId: ticket.id, id: trackerId, status: firstString(existing.status) ?? "reconciled", idempotencyKey };
      created.push(entry);
      reconciled.push(entry);
      continue;
    }
    let result;
    try {
      result = await createIssue({
        sliceId: ticket.id,
        title: firstString(ticket.title) ?? ticket.id,
        outcome: ticket.outcome,
        acceptanceCriteria: ticket.acceptanceCriteria,
        checks: ticket.checks,
        dependsOn: dependencies,
        idempotencyKey,
        intentId: intent.intentId,
        sourceTicket: ticket,
      });
    } catch (error) {
      throw partialFailure(ticket, error);
    }
    if (!isRecord(result) || !firstString(result.id, result.identifier)) {
      throw partialFailure(ticket, new Error(`Tracker did not return an identifier for ${String(ticket.id)}`));
    }
    const trackerId = firstString(result.id, result.identifier);
    trackerIds.set(String(ticket.id), trackerId);
    created.push({ sliceId: ticket.id, id: trackerId, status: firstString(result.status) ?? "created", idempotencyKey });
  }
  const trackerState = normalizeTrackerState({ status: "published", issues: created });
  return {
    ok: true,
    operation: "publish-approved-tickets",
    publicationAuthorized: true,
    consumedIntentId: intent.intentId,
    created,
    reconciled,
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
  return refs.filter(isRecord).map((ref) => ({ id: firstString(ref.id), role: firstString(ref.role) ?? "unknown", contentHash: firstString(ref.contentHash, ref.hash), sourceIdentity: normalizeWorkingBackwardsRepositoryIdentity(ref.sourceIdentity), sourceRevision: firstString(ref.sourceRevision) })).filter((ref) => ref.id && ref.contentHash && ref.sourceIdentity && ref.sourceRevision);
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
  const artifactInput = options.approvedArtifacts ?? options.artifacts;
  const rawArtifacts = extractArtifacts(artifactInput);
  const verifiedArtifacts = rawArtifacts.map(approvedArtifactRef).filter((artifact) => artifact !== null);
  if (rawArtifacts.length === 0 || rawArtifacts.length !== verifiedArtifacts.length) throw new Error("T3 handoff requires a nonempty approved, non-stale, hash-verified artifact set");
  const artifactRefs = verifiedArtifacts;
  const repository = normalizeRepository(options.repository ?? intent?.repository);
  if (!repository.identity || !repository.baseRevision) throw new Error("T3 handoff requires repository identity and base revision");
  const trackerState = normalizeTrackerState(options.trackerState ?? publication?.trackerState);
  if (trackerState.status === "unknown") throw new Error("T3 handoff requires tracker state");
  const workflowId = firstString(options.workflowId, intent?.workflowId) ?? "working-backwards";
  const gateValidation = validateGateReceipts(options.gateReceipts ?? intent?.gateReceipts, workflowId, rawArtifacts, options.ticketMap ?? intent?.tickets ?? options.tickets, repository);
  if (!gateValidation.ok) throw new Error(`T3 handoff requires complete gate receipts: ${gateValidation.errors.join("; ")}`);
  const firstSliceId = firstString(options.firstTerminalSlice, options.firstTerminalSliceId) ?? validation.frontier[0];
  if (!firstSliceId || !validation.frontier.includes(firstSliceId)) throw new Error("First terminal slice must be in the executable frontier");
  const ticket = validation.tickets.find((candidate) => candidate.id === firstSliceId);
  const body = {
    schemaVersion: 1,
    operation: "t3-implementation-handoff",
    visibility: "private",
    workflowId,
    approvedArtifacts: artifactRefs,
    gateReceipts: gateValidation.receipts,
    gateReceiptsHash: hashValue(gateValidation.receipts),
    repository,
    tracker: trackerState,
    frontier: validation.frontier,
    blockingEdges: validation.blockingEdges,
    firstTerminalSlice: { id: firstSliceId, title: firstString(ticket?.title) ?? firstSliceId, outcome: ticket?.outcome, acceptanceCriteria: ticket?.acceptanceCriteria ?? [], dependsOn: ticket?.dependsOn ?? [] },
    firstTerminalSliceId: firstSliceId,
    checks: stringList(options.checks ?? options.focusedChecks),
    risks: stringList(options.risks),
    gates: { product: "receipt-bound", technical: "receipt-bound", implementationMap: "receipt-bound", implementPreview: "required" },
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
  return extractArtifacts(value).map((artifact) => ({ id: firstString(artifact.id), contentHash: firstString(artifact.contentHash, artifact.hash), sourceIdentity: normalizeWorkingBackwardsRepositoryIdentity(artifact.sourceIdentity), sourceRevision: firstString(artifact.sourceRevision), status: firstString(artifact.status), stale: artifact.stale === true, integrity: artifact.content !== undefined && hashValue(artifact.content) === firstString(artifact.contentHash, artifact.hash) })).filter((artifact) => artifact.id);
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
    if (!actual || actual.status !== "approved" || actual.stale || !actual.integrity || actual.contentHash !== expected.contentHash || actual.sourceIdentity !== expectedRepository.identity || expected.sourceIdentity !== expectedRepository.identity || actual.sourceRevision !== expectedRepository.baseRevision || expected.sourceRevision !== expectedRepository.baseRevision) drift.push(`governing artifact drift: ${expected.id}`);
  }
  const currentGateReceipts = Array.isArray(options.gateReceipts) ? options.gateReceipts.filter(isRecord) : [];
  if (!Array.isArray(handoff?.gateReceipts) || handoff.gateReceipts.length !== 3 || handoff.gateReceiptsHash !== hashValue(handoff.gateReceipts)) drift.push("handoff gate receipt evidence is invalid");
  if (currentGateReceipts.length !== 3 || hashValue(currentGateReceipts) !== handoff?.gateReceiptsHash) drift.push("current gate receipt drift");
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
