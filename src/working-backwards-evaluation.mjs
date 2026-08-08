// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function record(value) {
  return isRecord(value) ? value : {};
}

/** @param {unknown} value */
function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

/** @param {Record<string, unknown>} source @param {string} key */
function signal(source, key) {
  const value = source[key];
  if (isRecord(value)) return value;
  return { status: value === undefined || value === null ? "unavailable" : "observed", value: value ?? null };
}

/**
 * Normalize dogfood and historical evidence without inventing measurements or
 * collapsing distinct signals into a score. The evaluator is pure so the same
 * evidence always yields the same report.
 * @param {unknown} input
 */
export function evaluateWorkingBackwards(input = {}) {
  const source = record(input);
  const dogfood = record(source.dogfood);
  const comparison = record(source.comparison);
  const signalSource = record(source.signals);
  const cases = Array.isArray(source.historicalCases) ? source.historicalCases.filter(isRecord) : [];
  const historicalCases = cases.map((entry) => ({
    id: typeof entry.id === "string" ? entry.id : "unknown",
    label: "historical-validation-case",
    evidenceAtTime: strings(entry.evidenceAtTime),
    knownRework: strings(entry.knownRework),
    classification: ["caught", "not-caught", "not-applicable"].includes(String(entry.classification)) ? entry.classification : "not-applicable",
    observedValidation: record(entry.observedValidation),
    unavailableFields: strings(entry.unavailableFields),
  }));
  const signals = Object.fromEntries([
    "activeOperationalTime",
    "humanAttention",
    "tokens",
    "authoritativeCost",
    "revisions",
    "corrections",
    "checks",
    "reviewBlockers",
    "planToCodeDeviation",
    "privacy",
    "synchronization",
    "worktree",
    "authorization",
  ].map((key) => [key, signal(signalSource, key)]));

  return {
    schemaVersion: 1,
    operation: "working-backwards-evaluation",
    evaluationType: "dogfood-and-historical-validation",
    dogfood: {
      reconstructedFrom: strings(dogfood.reconstructedFrom),
      chatHistoryRequired: dogfood.chatHistoryRequired === true,
      unavailableFields: strings(dogfood.unavailableFields),
    },
    historicalCases,
    comparison: {
      mode: "unmatched-descriptive",
      paths: strings(comparison.paths),
      unavailableFields: strings(comparison.unavailableFields),
    },
    signals,
    claims: { causal: "prohibited", defaultRollout: "prohibited" },
    recommendation: "bounded-live-pilot-only",
    ticket07: {
      status: "blocked",
      requires: { selectedRealProductFeature: true, authorization: true },
    },
    implementationAuthorized: false,
    externalSideEffects: [],
  };
}

export const evaluateWorkingBackwardsEvidence = evaluateWorkingBackwards;
