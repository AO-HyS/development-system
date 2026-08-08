// @ts-check

import { createHash } from "node:crypto";

const signalKeys = [
  "activeOperationalTime", "humanAttention", "tokens", "authoritativeCost",
  "revisions", "corrections", "checks", "reviewBlockers",
  "planToCodeDeviation", "privacy", "synchronization", "worktree", "authorization",
];
const sideEffectKeys = ["privacy", "synchronization", "worktree", "authorization"];
const classifications = ["caught", "not-caught", "not-applicable"];

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
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];
}

/** @param {unknown} value @returns {unknown} */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
}

/** @param {unknown} value */
function hashValue(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

/** @param {Record<string, unknown>} source @param {string} key */
function normalizeDisposition(source, key) {
  const value = record(source[key]);
  const status = value.status === "observed" || value.status === "unavailable" ? value.status : "invalid";
  return { status, value: value.value ?? null, reason: typeof value.reason === "string" ? value.reason : null };
}

/** @param {unknown} input */
function validateEvaluation(input) {
  const source = record(input);
  const errors = [];
  const dogfood = record(source.dogfood);
  const provenance = Array.isArray(dogfood.provenance) ? dogfood.provenance.filter(isRecord) : [];
  if (strings(dogfood.reconstructedFrom).length < 4 || dogfood.chatHistoryRequired !== false) errors.push("dogfood reconstruction provenance is incomplete");
  if (provenance.length === 0 || provenance.some((entry) => typeof entry.id !== "string" || typeof entry.source !== "string" || !/^sha256:[a-f0-9]{64}$/.test(String(entry.contentHash)) || entry.content === undefined || hashValue(entry.content) !== entry.contentHash)) errors.push("dogfood provenance hashes are required");
  const cases = Array.isArray(source.historicalCases) ? source.historicalCases.filter(isRecord) : [];
  if (cases.length !== 2) errors.push("exactly two historical validation replay records are required");
  for (const entry of cases) {
    const id = typeof entry.id === "string" ? entry.id : "unknown";
    if (entry.label !== "historical-validation-case") errors.push(`${id} must retain the historical-validation-case label`);
    const chain = Array.isArray(entry.artifactChain) ? entry.artifactChain.filter(isRecord) : [];
    if (chain.length < 3 || chain.some((artifact) => typeof artifact.role !== "string" || !/^sha256:[a-f0-9]{64}$/.test(String(artifact.contentHash)) || artifact.content === undefined || hashValue(artifact.content) !== artifact.contentHash)) errors.push(`${id} replay artifact chain is incomplete`);
    const assessments = Array.isArray(entry.knownReworkAssessment) ? entry.knownReworkAssessment.filter(isRecord) : [];
    if (assessments.length === 0 || assessments.some((assessment) => !classifications.includes(String(assessment.classification)) || typeof assessment.rationale !== "string")) errors.push(`${id} known-rework assessment is incomplete`);
    if (strings(entry.unavailableFields).length === 0) errors.push(`${id} must record unavailable fields`);
  }
  const signals = record(source.signals);
  for (const key of signalKeys) {
    const disposition = normalizeDisposition(signals, key);
    if (disposition.status === "invalid") errors.push(`${key} signal availability disposition is missing`);
    if (disposition.status === "unavailable" && !disposition.reason) errors.push(`${key} unavailable signal requires a reason`);
    if (disposition.status === "observed" && disposition.value === null) errors.push(`${key} observed signal requires a value`);
  }
  const comparison = record(source.comparison);
  if (strings(comparison.paths).length !== 2 || strings(comparison.limitations).length === 0) errors.push("comparison paths and unmatched limitations are required");
  const sideEffects = record(source.sideEffects);
  for (const key of sideEffectKeys) {
    const disposition = normalizeDisposition(sideEffects, key);
    if (disposition.status === "invalid" || (disposition.status === "unavailable" && !disposition.reason) || (disposition.status === "observed" && disposition.value === null)) errors.push(`${key} side-effect disposition is incomplete`);
  }
  return { ok: errors.length === 0, errors, source, dogfood, provenance, cases, signals, comparison, sideEffects };
}

/**
 * Validate and normalize deterministic dogfood evidence. Incomplete evidence
 * fails closed and cannot recommend a pilot.
 * @param {unknown} input
 */
export function evaluateWorkingBackwards(input = {}) {
  const validation = validateEvaluation(input);
  const historicalCases = validation.cases.map((entry) => {
    const assessments = Array.isArray(entry.knownReworkAssessment) ? entry.knownReworkAssessment.filter(isRecord) : [];
    const distinct = [...new Set(assessments.map((assessment) => String(assessment.classification)))];
    return {
      id: typeof entry.id === "string" ? entry.id : "unknown",
      label: "historical-validation-case",
      evidenceAtTime: strings(entry.evidenceAtTime),
      artifactChain: Array.isArray(entry.artifactChain) ? entry.artifactChain.filter(isRecord) : [],
      knownRework: strings(entry.knownRework),
      knownReworkAssessment: assessments,
      classification: distinct.length === 1 ? distinct[0] : "mixed",
      observedValidation: record(entry.observedValidation),
      unavailableFields: strings(entry.unavailableFields),
    };
  });
  const signals = Object.fromEntries(signalKeys.map((key) => [key, normalizeDisposition(validation.signals, key)]));
  const sideEffects = Object.fromEntries(sideEffectKeys.map((key) => [key, normalizeDisposition(validation.sideEffects, key)]));
  return {
    ok: validation.ok,
    errors: validation.errors,
    schemaVersion: 2,
    operation: "working-backwards-evaluation",
    evaluationType: "dogfood-and-historical-validation",
    dogfood: {
      reconstructedFrom: strings(validation.dogfood.reconstructedFrom),
      chatHistoryRequired: validation.dogfood.chatHistoryRequired === true,
      provenance: validation.provenance,
      unavailableFields: strings(validation.dogfood.unavailableFields),
    },
    historicalCases,
    comparison: {
      mode: "unmatched-descriptive",
      paths: strings(validation.comparison.paths),
      limitations: strings(validation.comparison.limitations),
      unavailableFields: strings(validation.comparison.unavailableFields),
    },
    signals,
    sideEffects,
    claims: { causal: "prohibited", defaultRollout: "prohibited" },
    recommendation: validation.ok ? "bounded-live-pilot-only" : "not-ready",
    ticket07: { status: "blocked", requires: { selectedRealProductFeature: true, authorization: true } },
    implementationAuthorized: false,
    externalSideEffects: [],
  };
}

export const evaluateWorkingBackwardsEvidence = evaluateWorkingBackwards;
