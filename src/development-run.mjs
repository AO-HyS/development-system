// @ts-check

const phases = Object.freeze([
  "discovery",
  "definition",
  "implementation",
  "review",
  "correction",
  "checks",
  "ci",
  "provider",
  "agent-wait",
  "human-wait",
]);
const phaseSet = new Set(phases);
const intervalKinds = new Set(["start", "end"]);
const orchestrationModes = new Set(["direct", "sequential", "multi-agent-v2", "fallback"]);
const laneStates = new Set(["integrated", "discarded", "blocked-with-owner", "not-started"]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is number} */
function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** @param {unknown} value @returns {value is number} */
function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** @param {{start: number, end: number}[]} intervals */
function mergedIntervals(intervals) {
  const sorted = intervals
    .filter((interval) => interval.end >= interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  /** @type {{start: number, end: number}[]} */
  const merged = [];
  let start = null;
  let end = null;
  for (const interval of sorted) {
    if (start === null || end === null) {
      start = interval.start;
      end = interval.end;
    } else if (interval.start <= end) {
      end = Math.max(end, interval.end);
    } else {
      merged.push({ start, end });
      start = interval.start;
      end = interval.end;
    }
  }
  if (start !== null && end !== null) merged.push({ start, end });
  return merged;
}

/** @param {{start: number, end: number}[]} intervals */
function unionDuration(intervals) {
  return mergedIntervals(intervals).reduce((total, interval) => total + interval.end - interval.start, 0);
}

/** @param {{start: number, end: number}[]} included @param {{start: number, end: number}[]} excluded */
function durationExcluding(included, excluded) {
  const exclusions = mergedIntervals(excluded);
  let total = 0;
  for (const interval of mergedIntervals(included)) {
    let cursor = interval.start;
    for (const exclusion of exclusions) {
      if (exclusion.end <= cursor || exclusion.start >= interval.end) continue;
      total += Math.max(0, Math.min(exclusion.start, interval.end) - cursor);
      cursor = Math.max(cursor, exclusion.end);
      if (cursor >= interval.end) break;
    }
    total += Math.max(0, interval.end - cursor);
  }
  return total;
}

/** @param {unknown} value */
function measured(value) {
  return value === undefined || value === null
    ? { status: "unproven", value: null }
    : { status: "observed", value };
}

/** @param {number | null} evidenceMs @param {unknown} delayReason */
function speedAssessment(evidenceMs, delayReason) {
  if (evidenceMs === null) return { status: "unproven", durationMs: null, reason: null };
  if (evidenceMs <= 300_000) return { status: "met", durationMs: evidenceMs, reason: null };
  if (evidenceMs <= 600_000) return { status: "missed-within-exception", durationMs: evidenceMs, reason: null };
  const reason = typeof delayReason === "string" && delayReason.trim() ? delayReason.trim() : null;
  return {
    status: reason ? "missed-exception-documented" : "missed-exception-undocumented",
    durationMs: evidenceMs,
    reason,
  };
}

/**
 * Build one provider-neutral development-run record from monotonic events.
 * Overlapping intervals are unioned, so concurrency never inflates totals.
 * @param {Record<string, unknown>} input
 */
export function buildDevelopmentRun(input) {
  /** @type {string[]} */
  const errors = [];
  const repository = isRecord(input.repository) ? input.repository : {};
  const model = isRecord(input.model) ? input.model : {};
  const events = Array.isArray(input.events) ? input.events.filter(isRecord) : [];
  if (events.length === 0) errors.push("events must contain at least one monotonic event");
  for (const [field, value] of [
    ["runId", input.runId],
    ["objectiveId", input.objectiveId],
    ["route", input.route],
    ["repository.identity", repository.identity],
    ["repository.revision", repository.revision],
    ["harness", input.harness],
    ["model.requested", model.requested],
    ["model.resolved", model.resolved],
    ["model.reasoning", model.reasoning],
  ]) {
    if (typeof value !== "string" || !value.trim()) errors.push(`${field} is required`);
  }
  if (model.resolved === "inherit") errors.push("model.resolved must be the observed runtime model, not inherit");
  if (!Array.isArray(input.tickets) || !input.tickets.every((ticket) => typeof ticket === "string" && ticket.trim())) {
    errors.push("tickets must be an array of identifiers");
  }
  const orchestration = isRecord(input.orchestration) ? input.orchestration : null;
  const lanes = orchestration && Array.isArray(orchestration.lanes) ? orchestration.lanes.filter(isRecord) : [];
  if (orchestration) {
    if (!orchestrationModes.has(String(orchestration.mode))) errors.push("orchestration.mode is unsupported");
    if (typeof orchestration.concurrentAgents !== "number" || !Number.isInteger(orchestration.concurrentAgents) || orchestration.concurrentAgents < 0) {
      errors.push("orchestration.concurrentAgents must be a non-negative integer");
    } else if (orchestration.concurrentAgents > 3 && (typeof orchestration.concurrencyException !== "string" || !orchestration.concurrencyException.trim())) {
      errors.push("more than three concurrent agents requires orchestration.concurrencyException");
    }
    /** @type {Record<string, unknown>[]} */
    const writers = [];
    for (const [index, lane] of lanes.entries()) {
      if (typeof lane.id !== "string" || !lane.id.trim()) errors.push(`orchestration.lanes[${index}].id is required`);
      if (!laneStates.has(String(lane.status))) errors.push(`orchestration.lanes[${index}].status is not terminal`);
      if (lane.status === "blocked-with-owner" && (typeof lane.owner !== "string" || !lane.owner.trim())) errors.push(`orchestration.lanes[${index}].owner is required`);
      if (typeof lane.role !== "string" || !lane.role.trim()) errors.push(`orchestration.lanes[${index}].role is required`);
      if (typeof lane.resolvedModel !== "string" || !lane.resolvedModel.trim() || lane.resolvedModel === "inherit") errors.push(`orchestration.lanes[${index}].resolvedModel must be an explicit runtime model`);
      if (!nonNegativeInteger(lane.depth) || lane.depth < 1) errors.push(`orchestration.lanes[${index}].depth must be a positive integer`);
      if (orchestration.mode === "multi-agent-v2" && lane.depth !== 1) errors.push(`orchestration.lanes[${index}].depth must be 1 for multi-agent-v2`);
      if (typeof lane.isWriter !== "boolean") errors.push(`orchestration.lanes[${index}].isWriter must be boolean`);
      if (lane.isWriter === true) {
        writers.push(lane);
        if (typeof lane.writerOwnership !== "string" || !lane.writerOwnership.trim()) errors.push(`orchestration.lanes[${index}].writerOwnership is required for writers`);
      } else if (lane.writerOwnership !== undefined && lane.writerOwnership !== null && (typeof lane.writerOwnership !== "string" || !lane.writerOwnership.trim())) {
        errors.push(`orchestration.lanes[${index}].writerOwnership must be empty for non-writers`);
      }
      if (!nonNegativeInteger(lane.correctionCount)) errors.push(`orchestration.lanes[${index}].correctionCount must be a non-negative integer`);
    }
    if (writers.length > 1) {
      const exception = isRecord(orchestration.parallelWriterException) ? orchestration.parallelWriterException : {};
      const integrationOrder = Array.isArray(exception.integrationOrder) ? exception.integrationOrder : [];
      const writerIds = writers.map((lane) => lane.id);
      const completeIntegrationOrder = integrationOrder.length === writerIds.length &&
        integrationOrder.every((id) => typeof id === "string" && writerIds.includes(id)) &&
        new Set(integrationOrder).size === writerIds.length;
      if (
        exception.disjointOwnership !== true ||
        typeof exception.justification !== "string" ||
        !exception.justification.trim() ||
        !completeIntegrationOrder
      ) {
        errors.push("multiple writers require explicit disjoint ownership, justification, and complete integrationOrder");
      }
    }
  }

  /** @type {Map<string, {phase: string, start: number}>} */
  const open = new Map();
  /** @type {Record<string, {start: number, end: number}[]>} */
  const phaseIntervals = Object.fromEntries(phases.map((phase) => [phase, []]));
  let previous = -1;
  let retries = 0;
  let resumptions = 0;
  let firstEvidenceAt = null;

  for (const [index, event] of events.entries()) {
    const phase = typeof event.phase === "string" ? event.phase : "";
    const kind = typeof event.kind === "string" ? event.kind : "";
    const id = typeof event.id === "string" ? event.id : "";
    const at = event.monotonicMs;
    if (!phaseSet.has(phase)) errors.push(`events[${index}].phase is unsupported`);
    if (!id) errors.push(`events[${index}].id is required`);
    if (!nonNegativeNumber(at)) {
      errors.push(`events[${index}].monotonicMs must be a non-negative number`);
      continue;
    }
    if (at < previous) errors.push(`events[${index}] breaks monotonic ordering`);
    previous = at;
    if (kind === "resume") {
      resumptions += 1;
      continue;
    }
    if (kind === "functional-evidence") {
      firstEvidenceAt = firstEvidenceAt === null ? at : Math.min(firstEvidenceAt, at);
      continue;
    }
    if (!intervalKinds.has(kind)) {
      errors.push(`events[${index}].kind is unsupported`);
      continue;
    }
    const attempt = nonNegativeNumber(event.attempt) ? event.attempt : 1;
    const key = `${phase}\u0000${id}\u0000${attempt}`;
    if (kind === "start") {
      if (open.has(key)) errors.push(`events[${index}] duplicates an open interval`);
      else open.set(key, { phase, start: at });
      continue;
    }
    const started = open.get(key);
    if (!started) {
      errors.push(`events[${index}] ends an interval without a matching start`);
      continue;
    }
    if (at < started.start) errors.push(`events[${index}] ends before its monotonic start`);
    else phaseIntervals[phase].push({ start: started.start, end: at });
    open.delete(key);
    if (event.outcome === "failed") retries += 1;
  }
  for (const key of open.keys()) errors.push(`interval ${key.replaceAll("\u0000", "/")} has no end event`);

  const allIntervals = phases.flatMap((phase) => phaseIntervals[phase]);
  const activeIntervals = phases
    .filter((phase) => !["agent-wait", "human-wait", "ci", "provider"].includes(phase))
    .flatMap((phase) => phaseIntervals[phase]);
  const waitIntervals = ["agent-wait", "human-wait", "ci", "provider"].flatMap((phase) => phaseIntervals[phase]);
  const firstAt = events.length > 0 && nonNegativeNumber(events[0].monotonicMs) ? events[0].monotonicMs : 0;
  const lastAt = events.reduce((maximum, event) => nonNegativeNumber(event.monotonicMs) ? Math.max(maximum, event.monotonicMs) : maximum, firstAt);
  const evidenceDuration = firstEvidenceAt === null ? null : Math.max(0, firstEvidenceAt - firstAt);
  const speed = speedAssessment(evidenceDuration, input.delayReason);
  if (speed.status === "missed-exception-undocumented") errors.push("functional evidence above ten minutes requires a recorded delay reason");

  return {
    schemaVersion: 1,
    operation: "development-run",
    valid: errors.length === 0,
    errors,
    identity: {
      runId: input.runId,
      objectiveId: input.objectiveId,
      route: input.route,
      tickets: input.tickets,
      repository: { identity: repository.identity, revision: repository.revision },
      harness: input.harness,
      model: { requested: model.requested, resolved: model.resolved, reasoning: model.reasoning },
    },
    timestamps: events.map((event) => ({ id: event.id, kind: event.kind, phase: event.phase, monotonicMs: event.monotonicMs })),
    phases: Object.fromEntries(phases.map((phase) => [phase, phaseIntervals[phase].length === 0
      ? { status: "unproven", durationMs: null, intervals: 0 }
      : { status: "observed", durationMs: unionDuration(phaseIntervals[phase]), intervals: phaseIntervals[phase].length }])),
    timing: {
      wallMs: events.length === 0 ? null : lastAt - firstAt,
      measuredUnionMs: allIntervals.length === 0 ? null : unionDuration(allIntervals),
      activeUnionMs: activeIntervals.length === 0 ? null : durationExcluding(activeIntervals, waitIntervals),
      waitUnionMs: waitIntervals.length === 0 ? null : unionDuration(waitIntervals),
    },
    retries,
    resumptions,
    speed: { functionalEvidence: speed },
    telemetry: {
      tokens: measured(input.tokens),
      costUsd: measured(input.costUsd),
      runtime: measured(input.runtime),
      provider: measured(input.telemetryProvider),
    },
    quality: input.quality === undefined ? { status: "unproven", value: null } : { status: "observed", value: input.quality },
    orchestration: orchestration ? {
      status: "observed",
      mode: orchestration.mode,
      concurrentAgents: orchestration.concurrentAgents,
      lanes: lanes.map((lane) => ({
        id: lane.id,
        status: lane.status,
        owner: lane.owner ?? null,
        role: lane.role,
        resolvedModel: lane.resolvedModel,
        depth: lane.depth,
        isWriter: lane.isWriter,
        writerOwnership: lane.writerOwnership ?? null,
        correctionCount: lane.correctionCount,
      })),
      writerCount: lanes.filter((lane) => lane.isWriter === true).length,
      parallelWriterException: isRecord(orchestration.parallelWriterException) ? {
        disjointOwnership: orchestration.parallelWriterException.disjointOwnership === true,
        justification: orchestration.parallelWriterException.justification ?? null,
        integrationOrder: Array.isArray(orchestration.parallelWriterException.integrationOrder)
          ? [...orchestration.parallelWriterException.integrationOrder]
          : [],
      } : null,
      allLanesTerminal: lanes.every((lane) => laneStates.has(String(lane.status))),
    } : { status: "unproven", mode: null, concurrentAgents: null, lanes: [], allLanesTerminal: null },
    consumers: ["check-in", "development-steward", "release-train"],
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}

/**
 * @param {Record<string, unknown>} identity
 * @param {{clock?: () => number}} [options]
 */
export function createDevelopmentRunRecorder(identity, options = {}) {
  const clock = options.clock ?? (() => performance.now());
  /** @type {Record<string, unknown>[]} */
  const events = [];
  return {
    /** @param {string} phase @param {string} id @param {Record<string, unknown>} [extra] */
    start(phase, id, extra = {}) {
      events.push({ ...extra, id, phase, kind: "start", monotonicMs: clock() });
    },
    /** @param {string} phase @param {string} id @param {Record<string, unknown>} [extra] */
    end(phase, id, extra = {}) {
      events.push({ ...extra, id, phase, kind: "end", monotonicMs: clock() });
    },
    /** @param {string} phase @param {string} kind @param {string} id @param {Record<string, unknown>} [extra] */
    point(phase, kind, id, extra = {}) {
      events.push({ ...extra, id, phase, kind, monotonicMs: clock() });
    },
    snapshot() {
      return buildDevelopmentRun({ ...identity, events: [...events] });
    },
  };
}
