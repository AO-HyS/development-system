// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

/** @param {string[]} left @param {string[]} right */
function overlaps(left, right) {
  return left.some((owned) => right.some((candidate) => owned === candidate || owned.startsWith(`${candidate}/`) || candidate.startsWith(`${owned}/`)));
}

/**
 * Build a conflict-aware execution plan. This function plans observable work;
 * it never creates worktrees, agents, branches, or pull requests.
 * @param {Record<string, unknown>} input
 */
export function planParallelWork(input) {
  /** @type {string[]} */
  const errors = [];
  const rawTickets = Array.isArray(input.tickets) ? input.tickets : [];
  const repository = isRecord(input.repository) ? input.repository : {};
  /** @type {Array<Record<string, unknown> & {id: string, surfaces: string[], dependencies: string[], checks: string[], status: string, agent: Record<string, unknown>}>} */
  const tickets = rawTickets.filter(isRecord).map((ticket) => ({
    ...ticket,
    id: typeof ticket.id === "string" ? ticket.id.trim() : "",
    surfaces: strings(ticket.surfaces),
    dependencies: strings(ticket.dependencies),
    checks: strings(ticket.checks),
    status: typeof ticket.status === "string" ? ticket.status : "pending",
    agent: isRecord(ticket.agent) ? ticket.agent : {},
  }));
  if (input.explicitlyInvoked !== true) errors.push("parallel-work requires explicit invocation");
  if (typeof repository.identity !== "string" || !repository.identity.trim()) errors.push("repository.identity is required");
  if (typeof repository.revision !== "string" || !repository.revision.trim()) errors.push("repository.revision is required");
  if (tickets.length < 2) errors.push("parallel-work requires at least two tickets");
  if (tickets.length !== rawTickets.length) errors.push("every ticket must be an object");
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  if (byId.size !== tickets.length || byId.has("")) errors.push("ticket IDs must be present and unique");

  for (const ticket of tickets) {
    if (ticket.surfaces.length === 0) errors.push(`${ticket.id || "ticket"} requires owned surfaces`);
    if (typeof ticket.acceptance !== "string" || !ticket.acceptance.trim()) errors.push(`${ticket.id || "ticket"} requires acceptance evidence`);
    if (ticket.checks.length === 0) errors.push(`${ticket.id || "ticket"} requires focused checks`);
    if (typeof ticket.stopCondition !== "string" || !ticket.stopCondition.trim()) errors.push(`${ticket.id || "ticket"} requires a stop condition`);
    if (!ticket.dependencies.every((dependency) => byId.has(dependency))) errors.push(`${ticket.id || "ticket"} has an unknown dependency`);
    if (!["pending", "running", "completed", "failed"].includes(ticket.status)) errors.push(`${ticket.id || "ticket"} has an unsupported status`);
    const resolvedModel = ticket.agent.resolvedModel;
    if (typeof resolvedModel !== "string" || !resolvedModel.trim() || resolvedModel === "inherit") errors.push(`${ticket.id || "ticket"} requires an explicit resolved model`);
    for (const field of ["role", "harness", "reasoning"]) {
      if (typeof ticket.agent[field] !== "string" || !ticket.agent[field].trim()) errors.push(`${ticket.id || "ticket"} agent.${field} is required`);
    }
  }

  /** @type {Map<string, 0 | 1 | 2>} */
  const visits = new Map();
  /** @type {string[]} */
  const order = [];
  /** @param {string} id */
  function visit(id) {
    if (visits.get(id) === 2) return;
    if (visits.get(id) === 1) {
      errors.push(`dependency cycle includes ${id}`);
      return;
    }
    visits.set(id, 1);
    const ticket = byId.get(id);
    if (ticket) for (const dependency of ticket.dependencies) visit(dependency);
    visits.set(id, 2);
    if (!order.includes(id)) order.push(id);
  }
  for (const ticket of tickets) visit(ticket.id);

  /** @type {Map<string, string>} */
  const parent = new Map(tickets.map((ticket) => [ticket.id, ticket.id]));
  /** @param {string} id @returns {string} */
  function find(id) {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    /** @type {string} */
    const root = find(current);
    parent.set(id, root);
    return root;
  }
  /** @param {string} left @param {string} right */
  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  }
  for (let left = 0; left < tickets.length; left += 1) {
    for (let right = left + 1; right < tickets.length; right += 1) {
      const first = tickets[left];
      const second = tickets[right];
      if (overlaps(first.surfaces, second.surfaces) || first.dependencies.includes(second.id) || second.dependencies.includes(first.id)) union(first.id, second.id);
    }
  }

  const failed = new Set(tickets.filter((ticket) => ticket.status === "failed").map((ticket) => ticket.id));
  /** @type {Map<string, string>} */
  const blocked = new Map([...failed].map((id) => [id, "local-failure"]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const ticket of tickets) {
      if (blocked.has(ticket.id)) continue;
      const failedDependency = ticket.dependencies.find((dependency) => blocked.has(dependency));
      if (failedDependency) {
        blocked.set(ticket.id, `failed-dependency:${failedDependency}`);
        changed = true;
      }
    }
  }
  if (input.sharedBaseHealthy === false) {
    for (const ticket of tickets.filter((ticket) => ticket.status !== "completed")) blocked.set(ticket.id, "shared-base-unhealthy");
  }

  const frontier = order.filter((id) => {
    const ticket = byId.get(id);
    return ticket && ["pending", "running"].includes(ticket.status) && !blocked.has(id) && ticket.dependencies.every((dependency) => byId.get(dependency)?.status === "completed");
  });
  /** @type {Map<string, string[]>} */
  const components = new Map();
  for (const id of order) {
    const root = find(id);
    components.set(root, [...(components.get(root) ?? []), id]);
  }
  const lanes = [...components.values()].map((ids, index) => {
    const laneTickets = ids.map((id) => /** @type {Record<string, unknown>} */ (byId.get(id)));
    const currentTicket = ids.find((id) => frontier.includes(id)) ?? null;
    const current = currentTicket ? byId.get(currentTicket) : laneTickets.find((ticket) => ticket.status !== "completed" && !blocked.has(String(ticket.id)));
    const agent = isRecord(current?.agent) ? current.agent : isRecord(laneTickets[0]?.agent) ? laneTickets[0].agent : {};
    return {
      id: `lane-${index + 1}`,
      tickets: ids,
      currentTicket,
      status: currentTicket ? "active" : ids.every((id) => byId.get(id)?.status === "completed") ? "completed" : "blocked-or-waiting",
      ownership: [...new Set(laneTickets.flatMap((ticket) => /** @type {string[]} */ (ticket.surfaces)))].sort(),
      writerCount: 1,
      branch: current?.branch ?? null,
      worktree: current?.worktree ?? null,
      agent: {
        role: agent.role ?? null,
        harness: agent.harness ?? null,
        resolvedModel: agent.resolvedModel ?? null,
        reasoning: agent.reasoning ?? null,
      },
      checks: current?.checks ?? [],
      stopCondition: current?.stopCondition ?? null,
    };
  });

  const deliveryInput = isRecord(input.delivery) ? input.delivery : {};
  const separate = deliveryInput.strategy === "separate-pull-requests";
  const separationReason = typeof deliveryInput.separationReason === "string" && deliveryInput.separationReason.trim() ? deliveryInput.separationReason.trim() : null;
  if (separate && !separationReason) errors.push("separate pull requests require an explicit separation reason");
  const integration = isRecord(input.integration) ? input.integration : {};
  const baseRevision = typeof integration.baseRevision === "string" ? integration.baseRevision : null;
  const currentRevision = typeof integration.currentRevision === "string" ? integration.currentRevision : null;
  const conflicts = strings(integration.conflicts);
  const ancestry = baseRevision !== null && currentRevision !== null && baseRevision === currentRevision
    ? "same"
    : typeof integration.ancestry === "string" && ["descendant", "diverged"].includes(integration.ancestry)
      ? integration.ancestry
      : "unproven";
  const diffVerified = integration.diffVerified === true || ancestry === "same";
  const integrationEvidenceComplete = baseRevision !== null
    && currentRevision !== null
    && Array.isArray(integration.conflicts)
    && ancestry !== "unproven"
    && diffVerified;
  if (!integrationEvidenceComplete) errors.push("integration requires revisions, verified ancestry/diff, and an explicit conflicts array");
  if (currentRevision !== null && typeof repository.revision === "string" && repository.revision !== currentRevision) {
    errors.push("repository.revision must match integration.currentRevision");
  }
  const diverged = ancestry === "diverged";
  const allCompleted = tickets.length > 0 && tickets.every((ticket) => ticket.status === "completed");
  const candidateStatus = !integrationEvidenceComplete
    ? "blocked-unverified-integration"
    : conflicts.length > 0 && diverged
    ? "blocked-conflicts-and-divergence"
    : conflicts.length > 0
      ? "blocked-conflicts"
      : diverged
        ? "blocked-divergence"
        : allCompleted && errors.length === 0
          ? "coherent"
          : "in-progress";
  const activeLanes = lanes.filter((lane) => lane.status === "active");

  return {
    schemaVersion: 1,
    operation: "parallel-work",
    valid: errors.length === 0,
    errors,
    frontier,
    lanes,
    activeLanes,
    blockedTickets: [...blocked.entries()].map(([id, reason]) => ({ id, reason })),
    delivery: separate
      ? { strategy: "separate-pull-requests", branchCount: lanes.length, pullRequestCount: lanes.length, separationReason }
      : { strategy: "single-integrated-candidate", branchCount: 1, pullRequestCount: 1, separationReason: null },
    candidate: {
      status: candidateStatus,
      coherent: candidateStatus === "coherent",
      baseRevision,
      currentRevision,
      ancestry,
      diffVerified,
      conflicts,
    },
    evidence: {
      ticketCount: tickets.length,
      laneCount: lanes.length,
      activeLaneCount: activeLanes.length,
      blockedCount: blocked.size,
    },
    nextAction: candidateStatus.startsWith("blocked")
      ? "Verify ancestry and reconcile divergence or conflicts before claiming a candidate"
      : activeLanes.length > 0
        ? "Run only the active lane tickets with their declared writers"
        : allCompleted
          ? "Integrate and review the single candidate"
          : "Resolve the reported blockers",
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
