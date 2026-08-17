// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** @param {unknown} value */
function instant(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {Record<string, unknown>[]} runs */
function metrics(runs) {
  const total = runs.length;
  /** @param {(run: Record<string, unknown>) => boolean} predicate */
  const ratio = (predicate) => total === 0 ? null : runs.filter(predicate).length / total;
  /** @param {string} field */
  const average = (field) => {
    const values = runs.map((run) => finite(run[field])).filter((value) => value !== null);
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return {
    runs: total,
    verifiedOutcomeRate: ratio((run) => run.completed === true && run.outcomeVerified === true),
    closedLaneRate: ratio((run) => finite(run.openLaneCount) === 0),
    averageWaitCount: average("waitCount"),
    averageCorrectionCount: average("correctionCount"),
    modes: Object.fromEntries(["direct", "sequential", "multi-agent-v2", "fallback"].map((mode) => [mode, runs.filter((run) => run.mode === mode).length])),
  };
}

/** @param {number | null} candidate @param {number | null} baseline @param {"higher" | "lower"} direction */
function compare(candidate, baseline, direction) {
  if (candidate === null || baseline === null) return "unproven";
  if (candidate === baseline) return "same";
  const improved = direction === "higher" ? candidate > baseline : candidate < baseline;
  return improved ? "improved" : "regressed";
}

/**
 * Evaluate a natural-work orchestration pilot without causal claims or writes.
 * @param {Record<string, unknown>} input
 */
export function evaluateOrchestrationPilot(input) {
  const errors = [];
  const now = instant(input.now);
  const startedAt = instant(input.startedAt);
  const scope = Array.isArray(input.repositories) ? [...new Set(input.repositories.filter((item) => typeof item === "string" && item.trim()))] : [];
  if (now === null) errors.push("now must be a deterministic timestamp");
  if (startedAt === null) errors.push("startedAt must be a deterministic timestamp");
  if (scope.length === 0) errors.push("repositories must contain the pilot scope");
  if (!Array.isArray(input.runs)) errors.push("runs must be an array");

  const allRuns = (Array.isArray(input.runs) ? input.runs : []).filter(isRecord);
  const runs = allRuns.filter((run) => run.nonTrivial === true && scope.includes(typeof run.repository === "string" ? run.repository : ""));
  for (const [index, run] of runs.entries()) {
    if (!['direct', 'sequential', 'multi-agent-v2', 'fallback'].includes(String(run.mode))) errors.push(`runs[${index}].mode is unsupported`);
    if (run.completed === true && finite(run.openLaneCount) !== 0) errors.push(`runs[${index}] cannot be complete with open lanes`);
  }

  const candidateRuns = runs.filter((run) => run.period === "candidate");
  const baselineRuns = runs.filter((run) => run.period === "baseline");
  const elapsedDays = now === null || startedAt === null ? null : Math.max(0, (now - startedAt) / 86_400_000);
  const checkpointReached = candidateRuns.length >= 5 || (elapsedDays !== null && elapsedDays >= 5);
  const candidate = metrics(candidateRuns);
  const baseline = metrics(baselineRuns);
  const comparisons = {
    verifiedOutcomes: compare(candidate.verifiedOutcomeRate, baseline.verifiedOutcomeRate, "higher"),
    closedLanes: compare(candidate.closedLaneRate, baseline.closedLaneRate, "higher"),
    waits: compare(candidate.averageWaitCount, baseline.averageWaitCount, "lower"),
    corrections: compare(candidate.averageCorrectionCount, baseline.averageCorrectionCount, "lower"),
  };
  const coordination = [comparisons.closedLanes, comparisons.waits, comparisons.corrections];
  const outcomesSafe = ["same", "improved"].includes(comparisons.verifiedOutcomes);
  const coordinationSafe = coordination.every((value) => value !== "regressed");
  const coordinationImproved = coordination.includes("improved");
  const comparable = baselineRuns.length > 0 && candidateRuns.length > 0;
  const decision = !checkpointReached || !comparable
    ? "collect-more"
    : outcomesSafe && coordinationSafe && coordinationImproved
      ? "retain"
      : "adjust";

  const repositories = scope.map((repository) => {
    const repositoryRuns = candidateRuns.filter((run) => run.repository === repository);
    const open = repositoryRuns.some((run) => finite(run.openLaneCount) !== 0);
    const failed = repositoryRuns.some((run) => run.completed !== true || run.outcomeVerified !== true);
    return {
      repository,
      status: repositoryRuns.length === 0 ? "unproven" : open ? "open-lanes" : failed ? "outcome-review" : "healthy",
      firstAction: repositoryRuns.length === 0
        ? { capability: "computer", title: "Run one non-trivial pilot task", reason: "No candidate evidence exists for this repository." }
        : open
          ? { capability: "computer", title: "Close or assign the open orchestration lane", reason: "A started lane lacks a terminal state." }
          : failed
            ? { capability: "computer", title: "Review the unverified outcome", reason: "Completion or functional evidence is incomplete." }
            : null,
    };
  });

  return {
    schemaVersion: 1,
    contractVersion: "1.5.7",
    operation: "orchestrator-pilot",
    valid: errors.length === 0,
    errors,
    checkpoint: { reached: checkpointReached, elapsedDays, qualifyingRuns: candidateRuns.length, rule: "five-runs-or-five-days" },
    baseline,
    candidate,
    comparisons,
    decision,
    causalClaim: false,
    repositories,
    checkInFindings: repositories.filter((item) => item.firstAction !== null).map((item) => ({ repository: item.repository, action: item.firstAction })),
    readOnly: true,
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
