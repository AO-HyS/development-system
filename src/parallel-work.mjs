// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {unknown} value @returns {string[]} */
function strings(value) { return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : []; }
/** @param {string[]} left @param {string[]} right */
function overlaps(left, right) { return left.some((owned) => right.some((candidate) => owned === candidate || owned.startsWith(`${candidate}/`) || candidate.startsWith(`${owned}/`))); }
/** @param {string} value */
function safeSurface(value) {
  return value.length > 0 &&
    value !== "." &&
    !value.startsWith("/") &&
    !value.startsWith("~") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

/**
 * Build a deterministic dependency-aware execution plan. This pure planner
 * cannot launch agents, create worktrees, write files, or promote code.
 * @param {Record<string, unknown>} input
 */
export function planParallelWork(input) {
  /** @type {string[]} */
  const errors = [];
  const rawTickets = Array.isArray(input.tickets) ? input.tickets : [];
  /** @type {Record<string, unknown>} */
  const repository = isRecord(input.repository) ? input.repository : {};
  /** @type {Array<Record<string, unknown> & {id: string, kind: string, surfaces: string[], dependencies: string[], capabilities: string[], checks: string[], status: string, agent: Record<string, unknown>}>} */
  const tickets = rawTickets.filter(isRecord).map((ticket) => ({
    ...ticket,
    id: typeof ticket.id === "string" ? ticket.id.trim() : "",
    kind: typeof ticket.kind === "string" && ticket.kind.trim() ? ticket.kind.trim() : "implementation",
    surfaces: strings(ticket.surfaces), dependencies: strings(ticket.dependencies), capabilities: strings(ticket.capabilities), checks: strings(ticket.checks),
    status: typeof ticket.status === "string" ? ticket.status : "pending",
    agent: isRecord(ticket.agent) ? ticket.agent : {},
  }));
  if (input.explicitlyInvoked !== true && input.initiativeAuthorized !== true) errors.push("parallel-work requires explicit invocation or an authorized initiative");
  if (typeof repository.identity !== "string" || !repository.identity.trim()) errors.push("repository.identity is required");
  if (typeof repository.revision !== "string" || !/^[a-f0-9]{40,64}$/u.test(repository.revision.trim())) errors.push("repository.revision requires an exact Git object id");
  if (tickets.length < 2) errors.push("parallel-work requires at least two tickets");
  if (tickets.length !== rawTickets.length) errors.push("every ticket must be an object");
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  if (byId.size !== tickets.length || byId.has("")) errors.push("ticket IDs must be present and unique");
  for (const ticket of tickets) {
    if (ticket.surfaces.length === 0) errors.push(`${ticket.id || "ticket"} requires owned surfaces`);
    if (ticket.surfaces.some((surface) => !safeSurface(surface))) errors.push(`${ticket.id || "ticket"} contains an unsafe owned surface`);
    if (typeof ticket.acceptance !== "string" || !ticket.acceptance.trim()) errors.push(`${ticket.id || "ticket"} requires acceptance evidence`);
    if (ticket.checks.length === 0) errors.push(`${ticket.id || "ticket"} requires focused checks`);
    if (typeof ticket.stopCondition !== "string" || !ticket.stopCondition.trim()) errors.push(`${ticket.id || "ticket"} requires a stop condition`);
    if (!ticket.dependencies.every((dependency) => byId.has(dependency))) errors.push(`${ticket.id || "ticket"} has an unknown dependency`);
    if (!["pending", "running", "completed", "failed"].includes(ticket.status)) errors.push(`${ticket.id || "ticket"} has an unsupported status`);
    const modelRoute = isRecord(ticket.agent.modelRoute) ? ticket.agent.modelRoute : null;
    const hasExplicitRoute = modelRoute !== null && Array.isArray(modelRoute.chain) && modelRoute.chain.length > 0 && modelRoute.subordinate === true;
    if (!hasExplicitRoute && (typeof ticket.agent.resolvedModel !== "string" || !ticket.agent.resolvedModel.trim() || ticket.agent.resolvedModel === "inherit")) errors.push(`${ticket.id || "ticket"} requires an explicit resolved model or subordinate model route`);
    for (const field of ["role", "harness", "reasoning"]) if (typeof ticket.agent[field] !== "string" || !ticket.agent[field].trim()) errors.push(`${ticket.id || "ticket"} agent.${field} is required`);
  }
  for (const ticket of tickets.filter((entry) => entry.status === "running")) {
    const incomplete = ticket.dependencies.filter((dependency) => byId.get(dependency)?.status !== "completed");
    if (incomplete.length > 0) errors.push(`running ticket ${ticket.id} has incomplete dependencies:${incomplete.join(",")}`);
  }

  /** @type {Map<string, 0 | 1 | 2>} */ const visits = new Map();
  /** @type {string[]} */ const order = [];
  /** @param {string} id */
  function visit(id) {
    if (visits.get(id) === 2) return;
    if (visits.get(id) === 1) { errors.push(`dependency cycle includes ${id}`); return; }
    visits.set(id, 1);
    const ticket = byId.get(id);
    if (ticket) for (const dependency of ticket.dependencies) visit(dependency);
    visits.set(id, 2);
    if (!order.includes(id)) order.push(id);
  }
  for (const ticket of tickets) visit(ticket.id);

  const failed = new Set(tickets.filter((ticket) => ticket.status === "failed").map((ticket) => ticket.id));
  const blocked = new Map([...failed].map((id) => [id, "local-failure"]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const ticket of tickets) {
      if (blocked.has(ticket.id)) continue;
      const failedDependency = ticket.dependencies.find((dependency) => blocked.has(dependency));
      if (failedDependency) { blocked.set(ticket.id, `failed-dependency:${failedDependency}`); changed = true; }
    }
  }
  if (input.sharedBaseHealthy === false) for (const ticket of tickets.filter((ticket) => ticket.status !== "completed")) blocked.set(ticket.id, "shared-base-unhealthy");

  const frontier = order.filter((id) => {
    const ticket = byId.get(id);
    return ticket && ["pending", "running"].includes(ticket.status) && !blocked.has(id) && ticket.dependencies.every((dependency) => byId.get(dependency)?.status === "completed");
  });
  const requestedCapacity = Number.isInteger(input.maxConcurrentWriters) ? Number(input.maxConcurrentWriters) : 3;
  const capacity = Math.max(1, Math.min(requestedCapacity, Math.max(1, tickets.length)));
  /** @type {string[]} */ const executableFrontier = [];
  /** @type {Array<{id: string, reason: string}>} */ const waitingTickets = [];
  const readyRunning = frontier.filter((id) => byId.get(id)?.status === "running");
  const readyPending = frontier.filter((id) => byId.get(id)?.status === "pending");
  if (readyRunning.length > capacity) errors.push(`running tickets exceed maxConcurrentWriters:${capacity}`);
  for (const id of [...readyRunning, ...readyPending]) {
    const ticket = byId.get(id);
    if (!ticket) continue;
    const conflict = executableFrontier.find((selected) => overlaps(ticket.surfaces, byId.get(selected)?.surfaces ?? []));
    if (conflict) {
      if (ticket.status === "running") errors.push(`running ticket ${id} overlaps running ticket ${conflict}`);
      waitingTickets.push({ id, reason: `surface-conflict:${conflict}` });
      continue;
    }
    if (executableFrontier.length >= capacity) { waitingTickets.push({ id, reason: `capacity:${capacity}` }); continue; }
    executableFrontier.push(id);
  }
  for (const id of order) {
    const ticket = byId.get(id);
    if (!ticket || ticket.status === "completed" || blocked.has(id) || frontier.includes(id)) continue;
    const incomplete = ticket.dependencies.filter((dependency) => byId.get(dependency)?.status !== "completed");
    if (incomplete.length > 0) waitingTickets.push({ id, reason: `dependencies-incomplete:${incomplete.join(",")}` });
  }

  // Every ticket has one durable lane. Surface locks choose which lanes may be
  // active together; dependency edges never permanently union future work.
  const lanes = order.map((id, index) => {
    const current = byId.get(id);
    const currentTicket = executableFrontier.includes(id) ? id : null;
    const agent = current?.agent ?? {};
    return {
      id: `lane-${index + 1}`, tickets: [id], currentTicket, dependsOn: current?.dependencies ?? [],
      phase: currentTicket ? "execute" : current?.status === "completed" ? "complete" : "wait",
      status: currentTicket ? "active" : current?.status === "completed" ? "completed" : "blocked-or-waiting",
      ownership: [...(current?.surfaces ?? [])].sort(), writerCount: 1, terminalStateRequired: true,
      branch: current?.branch ?? null, worktree: current?.worktree ?? null,
      agent: { role: agent.role ?? null, harness: agent.harness ?? null, requestedModel: agent.requestedModel ?? null, modelRoute: agent.modelRoute ?? null, resolvedModel: agent.resolvedModel ?? null, reasoning: agent.reasoning ?? null },
      capabilities: current?.capabilities ?? [], checks: current?.checks ?? [], stopCondition: current?.stopCondition ?? null,
      bundle: isRecord(current?.bundle) ? current.bundle : null,
    };
  });

  /** @type {Record<string, unknown>} */
  const deliveryInput = isRecord(input.delivery) ? input.delivery : {};
  const separate = deliveryInput.strategy === "separate-pull-requests";
  const separationReason = typeof deliveryInput.separationReason === "string" && deliveryInput.separationReason.trim() ? deliveryInput.separationReason.trim() : null;
  if (separate && !separationReason) errors.push("separate pull requests require an explicit separation reason");
  /** @type {Record<string, unknown>} */
  const integration = isRecord(input.integration) ? input.integration : {};
  const baseRevision = typeof integration.baseRevision === "string" && /^[a-f0-9]{40,64}$/u.test(integration.baseRevision) ? integration.baseRevision : null;
  const currentRevision = typeof integration.currentRevision === "string" && /^[a-f0-9]{40,64}$/u.test(integration.currentRevision) ? integration.currentRevision : null;
  const conflicts = strings(integration.conflicts);
  const ancestry = baseRevision !== null && currentRevision !== null && baseRevision === currentRevision ? "same" : typeof integration.ancestry === "string" && ["descendant", "diverged"].includes(integration.ancestry) ? integration.ancestry : "unproven";
  const diffVerified = integration.diffVerified === true || ancestry === "same";
  const integrationEvidenceComplete = baseRevision !== null && currentRevision !== null && Array.isArray(integration.conflicts) && ancestry !== "unproven" && diffVerified;
  if (!integrationEvidenceComplete) errors.push("integration requires revisions, verified ancestry/diff, and an explicit conflicts array");
  if (currentRevision !== null && typeof repository.revision === "string" && repository.revision !== currentRevision) errors.push("repository.revision must match integration.currentRevision");
  const integrationChecks = strings(input.integrationChecks);
  if (input.initiativeAuthorized === true && integrationChecks.length === 0) errors.push("authorized initiatives require integrationChecks");
  const diverged = ancestry === "diverged";
  const allCompleted = tickets.length > 0 && tickets.every((ticket) => ticket.status === "completed");
  const candidateStatus = !integrationEvidenceComplete ? "blocked-unverified-integration" : conflicts.length > 0 && diverged ? "blocked-conflicts-and-divergence" : conflicts.length > 0 ? "blocked-conflicts" : diverged ? "blocked-divergence" : allCompleted && errors.length === 0 ? "coherent" : "in-progress";
  const activeLanes = lanes.filter((lane) => lane.status === "active");
  return {
    schemaVersion: 2, operation: "parallel-work", valid: errors.length === 0, errors, frontier, executableFrontier, waitingTickets, maxConcurrentWriters: capacity,
    lanes, activeLanes, blockedTickets: [...blocked.entries()].map(([id, reason]) => ({ id, reason })), integrationChecks,
    delivery: separate ? { strategy: "separate-pull-requests", branchCount: lanes.length, pullRequestCount: lanes.length, separationReason } : { strategy: "single-integrated-candidate", branchCount: 1, pullRequestCount: 1, separationReason: null },
    candidate: { status: candidateStatus, coherent: candidateStatus === "coherent", baseRevision, currentRevision, ancestry, diffVerified, conflicts },
    evidence: { ticketCount: tickets.length, laneCount: lanes.length, activeLaneCount: activeLanes.length, blockedCount: blocked.size, waitingCount: waitingTickets.length },
    nextAction: candidateStatus.startsWith("blocked") ? "Verify ancestry and reconcile divergence or conflicts before claiming a candidate" : activeLanes.length > 0 ? "Run only the executable frontier with declared lane ownership and focused checks" : allCompleted ? "Run integration checks once, then review the single candidate" : "Resolve the reported blockers",
    authorization: {
      dispatchAuthorized: false,
      hostVerificationRequired: true,
      requiredProofs: ["current-user-authorization", "git-revision", "path-confinement"],
      binding: { repository: repository.identity ?? null, revision: repository.revision ?? null, workItemIds: tickets.map((ticket) => ticket.id) },
    },
    authority: { launchesAgents: false, writesFiles: false, externalWrites: false, promotion: false }, externalWriteIntents: [], externalSideEffects: [],
  };
}
