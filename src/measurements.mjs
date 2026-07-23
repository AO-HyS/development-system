// @ts-check

import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const runFields = new Set([
  "schemaVersion",
  "runId",
  "cohort",
  "repository",
  "benchmark",
  "capability",
  "stage",
  "ciPolicy",
  "terminalSliceHash",
  "startedAt",
  "endedAt",
  "verifiedAt",
  "waitMs",
  "result",
  "evidenceStatus",
  "gates",
  "agents",
  "quality",
  "rollbackRef",
]);
const repositoryFields = new Set(["id", "commit", "ticket"]);
const benchmarkFields = new Set(["packetId", "acceptanceId", "fixtureHash", "rosterHash"]);
const gateFields = new Set(["requirements", "spec", "tickets", "ci", "preview", "humanFinal"]);
const agentFields = new Set([
  "role",
  "routeSlot",
  "harness",
  "requestedModel",
  "resolvedModel",
  "reasoning",
  "durationMs",
  "tokens",
  "costUsd",
  "selectionReason",
  "result",
  "evidenceStatus",
]);
const qualityFields = new Set([
  "firstAttempt",
  "final",
  "reviews",
  "corrections",
  "correctionMs",
  "slop",
  "regressions",
  "reopens",
  "ci",
  "qa",
  "preview",
  "escapedDefects",
]);
const attemptFields = new Set(["passed", "findings"]);
const resultValues = new Set(["success", "failure", "incomplete", "timeout", "permission-blocked"]);
const evidenceValues = new Set(["validated", "provisional", "incomplete", "timeout", "permission-blocked"]);
const gateValues = new Set(["passed", "pending", "blocked", "not-required"]);
const checkValues = new Set(["passed", "failed", "not-run", "not-required", "blocked"]);
const ciPolicyValues = new Set(["required", "not-required-read-only"]);
const ciOptionalCapabilities = new Set(["architecture", "research"]);
const forbiddenPrivacyKey = /prompt|secret|clinical|privatecontent|apikey|password|patient|diagnosis/i;
const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const codeIdentifierPattern = /^[a-z][a-z0-9-]{0,63}$/;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const gitCommitPattern = /^[a-f0-9]{40}$/i;
const rollbackPattern = /^(?:git:[a-f0-9]{40}|roster:[a-f0-9]{64})$/i;

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} key */
function normalizedKey(key) {
  return key.replaceAll(/[^a-z0-9]/gi, "");
}

/**
 * Reject sensitive payload categories before ordinary schema errors, at any depth.
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} errors
 */
function rejectPrivacyFields(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivacyFields(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (forbiddenPrivacyKey.test(normalizedKey(key))) {
      errors.push(`${nestedPath} is forbidden by the privacy-safe schema`);
    }
    rejectPrivacyFields(nested, nestedPath, errors);
  }
}

/**
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {string} path
 * @param {string[]} errors
 */
function rejectUnknownFields(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}${key} is not allowed`);
  }
}

/**
 * @param {any} object
 * @param {string} field
 * @param {string} path
 * @param {string[]} errors
 */
function requireCount(object, field, path, errors) {
  const value = object?.[field];
  if (!Number.isSafeInteger(value) || value < 0) {
    errors.push(`${path}${field} must be a non-negative integer`);
  }
}

/**
 * @param {any} object
 * @param {string} field
 * @param {string} path
 * @param {string[]} errors
 */
function requireNullableCount(object, field, path, errors) {
  if (object?.[field] !== null) requireCount(object, field, path, errors);
}

/**
 * @param {any} object
 * @param {string} field
 * @param {string} path
 * @param {string[]} errors
 * @param {RegExp} [pattern]
 */
function requireIdentifier(object, field, path, errors, pattern = stableIdentifierPattern) {
  const value = object?.[field];
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${path}${field} must be a controlled identifier`);
  }
}

/** @param {unknown} value */
function isUtcTimestamp(value) {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

/**
 * Validate one strict, content-minimized run record.
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateRunRecord(value) {
  /** @type {string[]} */
  const errors = [];
  rejectPrivacyFields(value, "", errors);
  if (!isRecord(value)) return [...errors, "run record must be an object"];
  rejectUnknownFields(value, runFields, "", errors);
  if (value.schemaVersion !== 2) errors.push("schemaVersion must equal 2");
  for (const field of ["runId", "cohort", "capability", "stage"]) requireIdentifier(value, field, "", errors);
  if (!ciPolicyValues.has(value.ciPolicy)) {
    errors.push(`ciPolicy must be one of: ${[...ciPolicyValues].join(", ")}`);
  }
  if (typeof value.terminalSliceHash !== "string" || !sha256Pattern.test(value.terminalSliceHash)) {
    errors.push("terminalSliceHash must be a SHA-256 hash");
  }

  if (!isRecord(value.repository)) {
    errors.push("repository must be an object");
  } else {
    rejectUnknownFields(value.repository, repositoryFields, "repository.", errors);
    for (const field of ["id", "ticket"]) requireIdentifier(value.repository, field, "repository.", errors);
    if (
      typeof value.repository.commit === "string" &&
      !gitCommitPattern.test(value.repository.commit)
    ) {
      errors.push("repository.commit must be a 40-character Git commit");
    }
    if (typeof value.repository.commit !== "string") errors.push("repository.commit must be a 40-character Git commit");
  }

  if (!isRecord(value.benchmark)) {
    errors.push("benchmark must be an object");
  } else {
    rejectUnknownFields(value.benchmark, benchmarkFields, "benchmark.", errors);
    for (const field of ["packetId", "acceptanceId"]) {
      requireIdentifier(value.benchmark, field, "benchmark.", errors);
    }
    for (const field of ["fixtureHash", "rosterHash"]) {
      if (typeof value.benchmark[field] !== "string" || !sha256Pattern.test(value.benchmark[field])) {
        errors.push(`benchmark.${field} must be a SHA-256 hash`);
      }
    }
  }

  for (const field of ["startedAt", "endedAt"]) {
    if (!isUtcTimestamp(value[field])) errors.push(`${field} must be an ISO-8601 UTC timestamp`);
  }
  if (value.verifiedAt !== null && !isUtcTimestamp(value.verifiedAt)) {
    errors.push("verifiedAt must be an ISO-8601 UTC timestamp or null");
  }
  if (
    typeof value.startedAt === "string" &&
    typeof value.endedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt)) &&
    Number.isFinite(Date.parse(value.endedAt)) &&
    Date.parse(value.endedAt) < Date.parse(value.startedAt)
  ) {
    errors.push("endedAt must not be before startedAt");
  }
  if (
    isUtcTimestamp(value.startedAt) &&
    isUtcTimestamp(value.endedAt) &&
    isUtcTimestamp(value.verifiedAt) &&
    (Date.parse(value.verifiedAt) < Date.parse(value.startedAt) ||
      Date.parse(value.verifiedAt) > Date.parse(value.endedAt))
  ) {
    errors.push("verifiedAt must be between startedAt and endedAt");
  }
  requireNullableCount(value, "waitMs", "", errors);
  if (!resultValues.has(value.result)) errors.push(`result must be one of: ${[...resultValues].join(", ")}`);
  if (!evidenceValues.has(value.evidenceStatus)) {
    errors.push(`evidenceStatus must be one of: ${[...evidenceValues].join(", ")}`);
  }
  for (const status of ["timeout", "permission-blocked", "incomplete"]) {
    if ((value.result === status) !== (value.evidenceStatus === status)) {
      errors.push(`${status} evidenceStatus must match result`);
    }
  }
  if (!isRecord(value.gates)) {
    errors.push("gates must be an object");
  } else {
    rejectUnknownFields(value.gates, gateFields, "gates.", errors);
    for (const field of gateFields) {
      if (!gateValues.has(value.gates[field])) {
        errors.push(`gates.${field} must be one of: ${[...gateValues].join(", ")}`);
      }
    }
    if (value.ciPolicy === "required" && value.gates.ci === "not-required") {
      errors.push("ciPolicy required does not permit gates.ci not-required");
    }
    if (value.ciPolicy === "not-required-read-only" && value.gates.ci !== "not-required") {
      errors.push("ciPolicy not-required-read-only requires gates.ci not-required");
    }
  }
  if (
    value.ciPolicy === "not-required-read-only" &&
    !ciOptionalCapabilities.has(value.capability)
  ) {
    errors.push("ciPolicy not-required-read-only is allowed only for architecture or research");
  }

  if (!Array.isArray(value.agents) || value.agents.length === 0) {
    errors.push("agents must be a non-empty array");
  } else {
    value.agents.forEach((agent, index) => {
      const path = `agents[${index}].`;
      if (!isRecord(agent)) {
        errors.push(`${path.slice(0, -1)} must be an object`);
        return;
      }
      rejectUnknownFields(agent, agentFields, path, errors);
      for (const field of [
        "role",
        "routeSlot",
        "harness",
        "requestedModel",
        "resolvedModel",
        "reasoning",
      ]) {
        requireIdentifier(agent, field, path, errors);
      }
      requireIdentifier(agent, "selectionReason", path, errors, codeIdentifierPattern);
      if (agent.resolvedModel === "inherit") {
        errors.push(`${path}resolvedModel must identify the explicit runtime model`);
      }
      requireCount(agent, "durationMs", path, errors);
      requireNullableCount(agent, "tokens", path, errors);
      if (agent.costUsd !== null && (typeof agent.costUsd !== "number" || !Number.isFinite(agent.costUsd) || agent.costUsd < 0)) {
        errors.push(`${path}costUsd must be a non-negative number or null`);
      }
      if (!resultValues.has(agent.result)) {
        errors.push(`${path}result must be one of: ${[...resultValues].join(", ")}`);
      }
      if (!evidenceValues.has(agent.evidenceStatus)) {
        errors.push(`${path}evidenceStatus must be one of: ${[...evidenceValues].join(", ")}`);
      }
      for (const status of ["timeout", "permission-blocked", "incomplete"]) {
        if ((agent.result === status) !== (agent.evidenceStatus === status)) {
          errors.push(`${path}${status} evidenceStatus must match result`);
        }
      }
    });
  }

  if (!isRecord(value.quality)) {
    errors.push("quality must be an object");
  } else {
    rejectUnknownFields(value.quality, qualityFields, "quality.", errors);
    for (const field of ["firstAttempt", "final"]) {
      const attempt = value.quality[field];
      const path = `quality.${field}.`;
      if (!isRecord(attempt)) {
        errors.push(`${path.slice(0, -1)} must be an object`);
      } else {
        rejectUnknownFields(attempt, attemptFields, path, errors);
        if (typeof attempt.passed !== "boolean") errors.push(`${path}passed must be boolean`);
        requireCount(attempt, "findings", path, errors);
      }
    }
    for (const field of [
      "reviews",
      "corrections",
      "correctionMs",
      "slop",
      "regressions",
      "reopens",
      "escapedDefects",
    ]) {
      requireCount(value.quality, field, "quality.", errors);
    }
    for (const field of ["ci", "qa", "preview"]) {
      if (!checkValues.has(value.quality[field])) {
        errors.push(`quality.${field} must be one of: ${[...checkValues].join(", ")}`);
      }
    }
    if (typeof value.quality.final?.passed === "boolean") {
      if (value.result === "success" && !value.quality.final.passed) {
        errors.push("quality.final.passed must be true when result is success");
      }
      if (value.result !== "success" && value.quality.final.passed) {
        errors.push("quality.final.passed must be false when result is not success");
      }
    }
  }

  if (value.rollbackRef !== null && (typeof value.rollbackRef !== "string" || !rollbackPattern.test(value.rollbackRef))) {
    errors.push("rollbackRef must be null, git:<40hex>, or roster:<64hex>");
  }
  return errors;
}

/** @param {string} inputPath */
async function measurementFiles(inputPath) {
  const absolute = resolve(inputPath);
  const details = await stat(absolute);
  if (details.isFile()) return [absolute];
  if (!details.isDirectory()) throw new Error(`Measurement input is not a file or directory: ${absolute}`);
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const nested = resolve(absolute, entry.name);
    if (entry.isDirectory()) files.push(...await measurementFiles(nested));
    else if (entry.isFile() && [".json", ".jsonl"].includes(extname(entry.name))) files.push(nested);
  }
  return files.sort();
}

/**
 * @param {string} path
 * @returns {Promise<unknown[]>}
 */
async function readMeasurementFile(path) {
  const text = await readFile(path, "utf8");
  if (extname(path) === ".jsonl") {
    return text.split("\n").flatMap((line, index) => {
      if (line.trim().length === 0) return [];
      try {
        return [JSON.parse(line)];
      } catch (error) {
        throw new Error(`${path}:${index + 1} is invalid JSON: ${/** @type {Error} */ (error).message}`);
      }
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is invalid JSON: ${/** @type {Error} */ (error).message}`);
  }
  if (
    isRecord(parsed) &&
    parsed.schemaVersion === 2 &&
    parsed.operation === "measurement-scorecard"
  ) {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Load one or more JSON/JSONL files or directories, then validate the batch.
 * @param {string[]} inputPaths
 * @returns {Promise<any[]>}
 */
export async function ingestRunRecords(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error("At least one measurement input is required");
  }
  const files = (await Promise.all(inputPaths.map(measurementFiles))).flat().sort();
  if (files.length === 0) throw new Error("No .json or .jsonl measurement files were found");
  /** @type {any[]} */
  const records = [];
  for (const file of files) {
    const values = await readMeasurementFile(file);
    values.forEach((value, index) => {
      const errors = validateRunRecord(value);
      if (errors.length > 0) {
        throw new Error(`Invalid measurement record ${file}#${index + 1}:\n${errors.join("\n")}`);
      }
      records.push(value);
    });
  }
  if (records.length === 0) throw new Error("No run records were found in measurement inputs");
  const seen = new Set();
  for (const current of records) {
    if (seen.has(current.runId)) throw new Error(`Duplicate runId: ${current.runId}`);
    seen.add(current.runId);
  }
  return records;
}

/** @param {number} value */
function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** @param {any[]} items */
function metrics(items) {
  const sampleSize = items.length;
  const runItems = [...new Map(items.map((item) => [item.record.runId, item])).values()];
  const runCount = runItems.length;
  const validatedRunCount = new Set(items
    .filter((item) =>
      item.record.evidenceStatus === "validated" &&
      item.agent.evidenceStatus === "validated"
    )
    .map((item) => item.record.runId)).size;
  const costs = items.map((item) => item.agent.costUsd);
  const waits = runItems.map((item) => item.record.waitMs);
  const tokens = items.map((item) => item.agent.tokens);
  const verificationTimes = runItems.map((item) => item.record.verifiedAt === null
    ? null
    : Date.parse(item.record.verifiedAt) - Date.parse(item.record.startedAt));
  const sum = (/** @type {(item: any) => number} */ selector) =>
    items.reduce((total, item) => total + selector(item), 0);
  const average = (/** @type {(item: any) => number} */ selector) =>
    sampleSize === 0 ? null : rounded(sum(selector) / sampleSize);
  const runSum = (/** @type {(item: any) => number} */ selector) =>
    runItems.reduce((total, item) => total + selector(item), 0);
  const runAverage = (/** @type {(item: any) => number} */ selector) =>
    runCount === 0 ? null : rounded(runSum(selector) / runCount);
  const nullableSum = (/** @type {(number | null)[]} */ values) =>
    values.some((value) => value === null)
      ? null
      : /** @type {number[]} */ (values).reduce((total, value) => total + value, 0);
  const nullableAverage = (/** @type {(number | null)[]} */ values) => {
    const total = nullableSum(values);
    return total === null || values.length === 0 ? null : rounded(total / values.length);
  };
  const rate = (/** @type {(item: any) => boolean} */ selector) =>
    sampleSize === 0 ? null : rounded(items.filter(selector).length / sampleSize);
  const runRate = (/** @type {(item: any) => boolean} */ selector) =>
    runCount === 0 ? null : rounded(runItems.filter(selector).length / runCount);
  const previewReady = (/** @type {any} */ item) =>
    item.record.gates.preview === "passed"
      ? item.record.quality.preview === "passed"
      : item.record.gates.preview === "not-required" &&
        ["not-run", "not-required"].includes(item.record.quality.preview);
  const ciReady = (/** @type {any} */ item) =>
    item.record.ciPolicy === "required" && item.record.gates.ci === "passed"
      ? item.record.quality.ci === "passed"
      : item.record.ciPolicy === "not-required-read-only" &&
        item.record.gates.ci === "not-required" &&
        ["not-run", "not-required"].includes(item.record.quality.ci);
  return {
    sampleSize,
    runCount,
    validatedRunCount,
    successRate: rate((item) => item.agent.result === "success"),
    validatedRate: rate((item) => item.agent.evidenceStatus === "validated"),
    firstAttemptPassRate: runRate((item) => item.record.quality.firstAttempt.passed),
    finalPassRate: runRate((item) => item.record.quality.final.passed),
    ciPassRate: runRate((item) => item.record.quality.ci === "passed"),
    ciReadyRate: runRate(ciReady),
    qaPassRate: runRate((item) => item.record.quality.qa === "passed"),
    previewPassRate: runRate((item) => item.record.quality.preview === "passed"),
    previewReadyRate: runRate(previewReady),
    averageDurationMs: average((item) => item.agent.durationMs),
    averageWaitMs: nullableAverage(waits),
    averageTimeToVerifiedMs: nullableAverage(verificationTimes),
    tokens: nullableSum(tokens),
    averageTokens: nullableAverage(tokens),
    costUsd: costs.some((cost) => cost === null)
      ? null
      : rounded(/** @type {number[]} */ (costs).reduce((total, cost) => total + cost, 0)),
    averageCostUsd: nullableAverage(costs),
    averageReviews: runAverage((item) => item.record.quality.reviews),
    averageCorrections: runAverage((item) => item.record.quality.corrections),
    averageCorrectionMs: runAverage((item) => item.record.quality.correctionMs),
    averageSlop: runAverage((item) => item.record.quality.slop),
    averageRegressions: runAverage((item) => item.record.quality.regressions),
    averageReopens: runAverage((item) => item.record.quality.reopens),
    averageEscapedDefects: runAverage((item) => item.record.quality.escapedDefects),
    evidence: Object.fromEntries([...evidenceValues].map((status) => [
      status,
      items.filter((item) => item.agent.evidenceStatus === status).length,
    ])),
  };
}

/** @param {any[]} items */
function comparisonMetrics(items) {
  const { tokens: _tokens, costUsd: _costUsd, ...result } = metrics(items);
  return result;
}

/** @param {any[]} items */
function routeIdentities(items) {
  const routes = new Map();
  for (const item of items) {
    const route = {
      role: item.agent.role,
      model: item.agent.resolvedModel,
      harness: item.agent.harness,
    };
    routes.set(`${route.role}\u0000${route.model}\u0000${route.harness}`, route);
  }
  return [...routes.values()].sort((left, right) =>
    `${left.role}/${left.model}/${left.harness}`
      .localeCompare(`${right.role}/${right.model}/${right.harness}`)
  );
}

/** @param {any} item */
function routeKey(item) {
  return [
    item.record.repository.id,
    item.record.capability,
    item.agent.routeSlot,
    item.agent.role,
    item.agent.resolvedModel,
    item.agent.harness,
  ].join("\u0000");
}

/** @param {any[]} items */
function routeGroups(items) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const item of items) {
    const key = routeKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

/** @param {any[]} items @param {string} date */
function aggregateRows(items, date) {
  const overall = {
    date,
    groupBy: "overall",
    repository: null,
    capability: null,
    routeSlot: null,
    role: null,
    model: null,
    harness: null,
    ...metrics(items),
  };
  const routes = [...routeGroups(items).values()].map((group) => ({
    date,
    groupBy: "repo/capability/route-slot/role/model/harness",
    repository: group[0].record.repository.id,
    capability: group[0].record.capability,
    routeSlot: group[0].agent.routeSlot,
    role: group[0].agent.role,
    model: group[0].agent.resolvedModel,
    harness: group[0].agent.harness,
    ...metrics(group),
  }));
  return [overall, ...routes.sort((left, right) =>
    `${left.repository}/${left.capability}/${left.routeSlot}/${left.role}/${left.model}/${left.harness}`
      .localeCompare(`${right.repository}/${right.capability}/${right.routeSlot}/${right.role}/${right.model}/${right.harness}`)
  )];
}

/** @param {any} left @param {any} right */
function metricDeltas(left, right) {
  /** @param {string} name */
  const difference = (name) => left[name] === null || right[name] === null
    ? null
    : rounded(right[name] - left[name]);
  return {
    successRate: difference("successRate"),
    firstAttemptPassRate: difference("firstAttemptPassRate"),
    finalPassRate: difference("finalPassRate"),
    ciPassRate: difference("ciPassRate"),
    ciReadyRate: difference("ciReadyRate"),
    qaPassRate: difference("qaPassRate"),
    previewReadyRate: difference("previewReadyRate"),
    averageDurationMs: difference("averageDurationMs"),
    averageWaitMs: difference("averageWaitMs"),
    averageTimeToVerifiedMs: difference("averageTimeToVerifiedMs"),
    averageTokens: difference("averageTokens"),
    averageCostUsd: difference("averageCostUsd"),
    averageCorrections: difference("averageCorrections"),
    averageCorrectionMs: difference("averageCorrectionMs"),
    averageSlop: difference("averageSlop"),
    averageRegressions: difference("averageRegressions"),
    averageReopens: difference("averageReopens"),
    averageEscapedDefects: difference("averageEscapedDefects"),
  };
}

/**
 * @param {any} baseline
 * @param {any} treatment
 * @param {number} sampleThreshold
 * @param {string | null} rollbackRef
 * @param {string | null} currentRosterHash
 * @param {boolean} comparable
 * @param {boolean} rosterAnchored
 */
function recommendation(
  baseline,
  treatment,
  sampleThreshold,
  rollbackRef,
  currentRosterHash,
  comparable,
  rosterAnchored,
) {
  if (baseline.validatedRunCount < sampleThreshold || treatment.validatedRunCount < sampleThreshold) {
    return {
      status: "insufficient-evidence",
      action: "collect-more-samples",
      sampleThreshold,
      currentRosterHash,
      rollbackRef: null,
    };
  }
  if (!comparable) {
    return {
      status: "not-comparable",
      action: "rerun-identical-packet",
      sampleThreshold,
      currentRosterHash,
      rollbackRef: null,
    };
  }
  const qualitySafe =
    treatment.successRate === 1 &&
    treatment.successRate >= baseline.successRate &&
    treatment.ciReadyRate === 1 &&
    treatment.qaPassRate === 1 &&
    treatment.previewReadyRate === 1 &&
    treatment.finalPassRate === 1 &&
    treatment.finalPassRate >= baseline.finalPassRate &&
    treatment.firstAttemptPassRate >= baseline.firstAttemptPassRate &&
    treatment.averageCorrections <= baseline.averageCorrections &&
    treatment.averageCorrectionMs <= baseline.averageCorrectionMs &&
    treatment.averageSlop === 0 &&
    treatment.averageSlop <= baseline.averageSlop &&
    treatment.averageRegressions === 0 &&
    treatment.averageRegressions <= baseline.averageRegressions &&
    treatment.averageReopens === 0 &&
    treatment.averageReopens <= baseline.averageReopens &&
    treatment.averageEscapedDefects === 0 &&
    treatment.averageEscapedDefects <= baseline.averageEscapedDefects &&
    (
      baseline.averageTimeToVerifiedMs === null ||
      (
        treatment.averageTimeToVerifiedMs !== null &&
        treatment.averageTimeToVerifiedMs <= baseline.averageTimeToVerifiedMs
      )
    );
  if (!qualitySafe) {
    return {
      status: "quality-gate-failed",
      action: "do-not-change-routing",
      sampleThreshold,
      currentRosterHash,
      rollbackRef: null,
    };
  }
  const improved = (/** @type {string} */ name) =>
    baseline[name] !== null && treatment[name] !== null && treatment[name] < baseline[name];
  const moreEfficient =
    improved("averageDurationMs") ||
    improved("averageWaitMs") ||
    improved("averageTimeToVerifiedMs") ||
    improved("averageCorrections") ||
    improved("averageCorrectionMs");
  if (!moreEfficient) {
    return {
      status: "retain-baseline",
      action: "do-not-change-routing",
      sampleThreshold,
      currentRosterHash,
      rollbackRef: null,
    };
  }
  if (!rollbackRef || !currentRosterHash) {
    return {
      status: "missing-recovery-reference",
      action: "do-not-change-routing",
      sampleThreshold,
      currentRosterHash,
      rollbackRef: null,
    };
  }
  if (!rosterAnchored) {
    return {
      status: "roster-drift",
      action: "refresh-current-roster-evidence",
      sampleThreshold,
      currentRosterHash,
      rollbackRef: null,
    };
  }
  return {
    status: "eligible",
    action: "consider-treatment",
    sampleThreshold,
    currentRosterHash,
    rollbackRef,
  };
}

/**
 * Build deterministic daily, rolling-seven-day, and comparison views.
 * The output is advisory and never reads or writes the capability roster.
 * @param {any[]} records
 * @param {{baseline?: string, treatment?: string, sampleThreshold?: number, rollbackRef?: string | null, currentRosterHash?: string | null}} [options]
 */
export function buildMeasurementScorecard(records, options = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("At least one run record is required");
  records.forEach((record, index) => {
    const errors = validateRunRecord(record);
    if (errors.length > 0) throw new Error(`Invalid run record #${index + 1}:\n${errors.join("\n")}`);
  });
  const runIds = new Set(records.map((record) => record.runId));
  if (runIds.size !== records.length) throw new Error("runId values must be unique");
  const sampleThreshold = options.sampleThreshold ?? 3;
  if (!Number.isSafeInteger(sampleThreshold) || sampleThreshold < 3) {
    throw new Error("sampleThreshold must be an integer of at least 3");
  }
  if (
    options.currentRosterHash !== undefined &&
    options.currentRosterHash !== null &&
    !/^[a-f0-9]{64}$/i.test(options.currentRosterHash)
  ) {
    throw new Error("currentRosterHash must be a SHA-256 hash");
  }
  if (
    options.rollbackRef !== undefined &&
    options.rollbackRef !== null &&
    !rollbackPattern.test(options.rollbackRef)
  ) {
    throw new Error("rollbackRef must be git:<40hex> or roster:<64hex>");
  }
  const items = records.flatMap((record) => record.agents.map((/** @type {any} */ agent) => ({ record, agent })));
  const dates = [...new Set(records.map((record) => record.startedAt.slice(0, 10)))].sort();
  const daily = dates.flatMap((date) =>
    aggregateRows(items.filter((item) => item.record.startedAt.startsWith(date)), date)
  );
  const rolling7 = dates.flatMap((date) => {
    const end = Date.parse(`${date}T23:59:59.999Z`);
    const start = end - (7 * 24 * 60 * 60 * 1_000) + 1;
    return aggregateRows(items.filter((item) => {
      const timestamp = Date.parse(item.record.startedAt);
      return timestamp >= start && timestamp <= end;
    }), date);
  });

  const baselineName = options.baseline ?? "baseline";
  const treatmentName = options.treatment ?? "treatment";
  if (!stableIdentifierPattern.test(baselineName) || !stableIdentifierPattern.test(treatmentName)) {
    throw new Error("baseline and treatment must be controlled identifiers");
  }
  /** @type {Map<string, any[]>} */
  const comparisonGroups = new Map();
  for (const item of items) {
    const key = `${item.record.repository.id}\u0000${item.record.capability}\u0000${item.agent.routeSlot}`;
    comparisonGroups.set(key, [...(comparisonGroups.get(key) ?? []), item]);
  }
  const comparisons = [...comparisonGroups.values()].map((group) => {
    const baselineItems = group.filter((item) => item.record.cohort === baselineName);
    const treatmentItems = group.filter((item) => item.record.cohort === treatmentName);
    const validatedGroup = group.filter((item) =>
      item.record.evidenceStatus === "validated" &&
      item.agent.evidenceStatus === "validated" &&
      [baselineName, treatmentName].includes(item.record.cohort)
    );
    const baselineMetrics = comparisonMetrics(baselineItems);
    const treatmentMetrics = comparisonMetrics(treatmentItems);
    const comparableIdentities = new Set(validatedGroup
      .map((item) => [
        item.record.repository.commit,
        item.record.terminalSliceHash,
        item.record.benchmark.packetId,
        item.record.benchmark.acceptanceId,
        item.record.benchmark.fixtureHash,
      ].join("\u0000")));
    const comparable = comparableIdentities.size === 1;
    const comparisonSource = validatedGroup[0] ?? null;
    const currentRosterHash = options.currentRosterHash ?? null;
    const rosterAnchored = currentRosterHash !== null && validatedGroup.every(
      (item) => item.record.benchmark.rosterHash === currentRosterHash,
    );
    const validatedTreatmentRollbackRefs = new Set(validatedGroup
      .filter((item) => item.record.cohort === treatmentName && item.record.rollbackRef !== null)
      .map((item) => item.record.rollbackRef));
    const groupRollback = options.rollbackRef !== undefined && options.rollbackRef !== null
      ? validatedTreatmentRollbackRefs.has(options.rollbackRef) ? options.rollbackRef : null
      : validatedTreatmentRollbackRefs.size === 1
        ? [...validatedTreatmentRollbackRefs][0]
        : null;
    return {
      repository: group[0].record.repository.id,
      capability: group[0].record.capability,
      routeSlot: group[0].agent.routeSlot,
      baselineRoutes: routeIdentities(
        validatedGroup.filter((item) => item.record.cohort === baselineName),
      ),
      treatmentRoutes: routeIdentities(
        validatedGroup.filter((item) => item.record.cohort === treatmentName),
      ),
      baseline: { cohort: baselineName, ...baselineMetrics },
      treatment: { cohort: treatmentName, ...treatmentMetrics },
      comparable,
      rosterAnchored,
      comparisonIdentity: comparable && comparisonSource ? {
        repositoryCommit: comparisonSource.record.repository.commit,
        terminalSliceHash: comparisonSource.record.terminalSliceHash,
        packetId: comparisonSource.record.benchmark.packetId,
        acceptanceId: comparisonSource.record.benchmark.acceptanceId,
        fixtureHash: comparisonSource.record.benchmark.fixtureHash,
      } : null,
      deltas: metricDeltas(baselineMetrics, treatmentMetrics),
      recommendation: recommendation(
        baselineMetrics,
        treatmentMetrics,
        sampleThreshold,
        groupRollback,
        currentRosterHash,
        comparable,
        rosterAnchored,
      ),
    };
  }).sort((left, right) =>
    `${left.repository}/${left.capability}/${left.routeSlot}`
      .localeCompare(`${right.repository}/${right.capability}/${right.routeSlot}`)
  );

  return {
    schemaVersion: 2,
    operation: "measurement-scorecard",
    asOf: records.map((record) => record.endedAt).sort().at(-1),
    rosterMutation: "none",
    dimensions: ["repository", "capability", "routeSlot", "role", "resolvedModel", "harness"],
    summary: {
      records: records.length,
      agentRuns: items.length,
      firstDate: dates[0],
      lastDate: dates.at(-1),
      costUsd: metrics(items).costUsd,
      evidence: metrics(items).evidence,
    },
    daily,
    rolling7,
    comparisons,
  };
}

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** @param {number | null} value */
function percentage(value) {
  return value === null ? "n/a" : `${rounded(value * 100)}%`;
}

/** @param {number | null} value */
function milliseconds(value) {
  return value === null ? "n/a" : `${rounded(value)} ms`;
}

/** @param {Record<string, number>} evidence */
function evidenceLabel(evidence) {
  return Object.entries(evidence)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}:${count}`)
    .join(" · ") || "none";
}

/** @param {{role: string, model: string, harness: string}[]} routes */
function routesLabel(routes) {
  return routes.map((route) => `${route.role}/${route.model}/${route.harness}`).join(" · ") || "none";
}

/** @param {any} scorecard */
export function renderMeasurementScorecardHtml(scorecard) {
  const evidence = Object.entries(scorecard.summary.evidence)
    .map(([status, count]) => `<li><strong>${escapeHtml(count)}</strong> ${escapeHtml(status)}</li>`)
    .join("");
  const comparisons = scorecard.comparisons.map((/** @type {any} */ comparison) => `
    <tr>
      <td>${escapeHtml(comparison.repository)}</td>
      <td>${escapeHtml(comparison.capability)}</td>
      <td>${escapeHtml(comparison.routeSlot)}</td>
      <td>${escapeHtml(routesLabel(comparison.baselineRoutes))}</td>
      <td>${escapeHtml(routesLabel(comparison.treatmentRoutes))}</td>
      <td>${escapeHtml(comparison.baseline.validatedRunCount)}</td>
      <td>${escapeHtml(comparison.treatment.validatedRunCount)}</td>
      <td>${escapeHtml(percentage(comparison.baseline.firstAttemptPassRate))} → ${escapeHtml(percentage(comparison.treatment.firstAttemptPassRate))}</td>
      <td>${escapeHtml(percentage(comparison.baseline.finalPassRate))}</td>
      <td>${escapeHtml(percentage(comparison.treatment.finalPassRate))}</td>
      <td>${escapeHtml(milliseconds(comparison.baseline.averageTimeToVerifiedMs))} → ${escapeHtml(milliseconds(comparison.treatment.averageTimeToVerifiedMs))}</td>
      <td>${escapeHtml(milliseconds(comparison.baseline.averageCorrectionMs))} → ${escapeHtml(milliseconds(comparison.treatment.averageCorrectionMs))}</td>
      <td>${escapeHtml(comparison.baseline.averageSlop)} → ${escapeHtml(comparison.treatment.averageSlop)}</td>
      <td>${escapeHtml(percentage(comparison.baseline.ciReadyRate))} → ${escapeHtml(percentage(comparison.treatment.ciReadyRate))}</td>
      <td>${escapeHtml(percentage(comparison.baseline.qaPassRate))} → ${escapeHtml(percentage(comparison.treatment.qaPassRate))}</td>
      <td>${escapeHtml(percentage(comparison.baseline.previewReadyRate))} → ${escapeHtml(percentage(comparison.treatment.previewReadyRate))}</td>
      <td>${escapeHtml(evidenceLabel(comparison.baseline.evidence))} → ${escapeHtml(evidenceLabel(comparison.treatment.evidence))}</td>
      <td>${escapeHtml(comparison.recommendation.status)}</td>
      <td>${escapeHtml(comparison.recommendation.currentRosterHash ?? "n/a")}</td>
      <td>${escapeHtml(comparison.recommendation.rollbackRef ?? "n/a")}</td>
    </tr>`).join("");
  const daily = scorecard.daily
    .filter((/** @type {any} */ row) => row.groupBy !== "overall")
    .map((/** @type {any} */ row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.repository)}</td>
      <td>${escapeHtml(row.capability)}</td>
      <td>${escapeHtml(row.routeSlot)}</td>
      <td>${escapeHtml(row.role)}</td>
      <td>${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.harness)}</td>
      <td>${escapeHtml(row.sampleSize)}</td>
      <td>${escapeHtml(percentage(row.firstAttemptPassRate))}</td>
      <td>${escapeHtml(percentage(row.finalPassRate))}</td>
      <td>${escapeHtml(milliseconds(row.averageTimeToVerifiedMs))}</td>
      <td>${escapeHtml(milliseconds(row.averageCorrectionMs))}</td>
      <td>${escapeHtml(row.averageSlop)}</td>
      <td>${escapeHtml(percentage(row.ciReadyRate))}</td>
      <td>${escapeHtml(percentage(row.qaPassRate))}</td>
      <td>${escapeHtml(percentage(row.previewReadyRate))}</td>
      <td>${escapeHtml(evidenceLabel(row.evidence))}</td>
      <td>${escapeHtml(row.costUsd ?? "unavailable")}</td>
    </tr>`).join("");
  const rolling7 = scorecard.rolling7
    .filter((/** @type {any} */ row) => row.groupBy !== "overall")
    .map((/** @type {any} */ row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.repository)}</td>
      <td>${escapeHtml(row.capability)}</td>
      <td>${escapeHtml(row.routeSlot)}</td>
      <td>${escapeHtml(row.role)}</td>
      <td>${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.harness)}</td>
      <td>${escapeHtml(row.sampleSize)}</td>
      <td>${escapeHtml(percentage(row.firstAttemptPassRate))}</td>
      <td>${escapeHtml(percentage(row.finalPassRate))}</td>
      <td>${escapeHtml(milliseconds(row.averageTimeToVerifiedMs))}</td>
      <td>${escapeHtml(milliseconds(row.averageCorrectionMs))}</td>
      <td>${escapeHtml(row.averageSlop)}</td>
      <td>${escapeHtml(percentage(row.ciReadyRate))}</td>
      <td>${escapeHtml(percentage(row.qaPassRate))}</td>
      <td>${escapeHtml(percentage(row.previewReadyRate))}</td>
      <td>${escapeHtml(evidenceLabel(row.evidence))}</td>
      <td>${escapeHtml(row.costUsd ?? "unavailable")}</td>
    </tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Measurement scorecard v2</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #eef2ff; }
    body { margin: 0; }
    main { max-width: 1120px; margin: auto; padding: 32px 20px 64px; }
    header { display: flex; justify-content: space-between; gap: 20px; align-items: start; }
    h1 { margin: 0 0 8px; font-size: clamp(1.8rem, 5vw, 3.2rem); }
    p, small { color: #a5b4d4; }
    .notice, section { background: #121a30; border: 1px solid #263556; border-radius: 14px; padding: 18px; margin-top: 20px; }
    .notice { color: #b7f7d2; }
    ul { display: flex; flex-wrap: wrap; gap: 20px; padding: 0; list-style: none; }
    .table { overflow-x: auto; }
    table { border-collapse: collapse; min-width: 760px; width: 100%; }
    th, td { border-bottom: 1px solid #263556; padding: 10px; text-align: left; }
    th { color: #a5b4d4; font-size: .78rem; text-transform: uppercase; }
  </style>
</head>
<body>
<main>
  <header><div><h1>Measurement scorecard v2</h1><p>As of ${escapeHtml(scorecard.asOf)}</p></div><small>Local static evidence</small></header>
  <div class="notice">Advisory only. Roster mutation: ${escapeHtml(scorecard.rosterMutation)}.</div>
  <section><h2>Evidence status</h2><ul>${evidence}</ul></section>
  <section class="table"><h2>Baseline vs treatment</h2><table><thead><tr><th>Repository</th><th>Capability</th><th>Route slot</th><th>Baseline route</th><th>Treatment route</th><th>Baseline validated runs</th><th>Treatment validated runs</th><th>First pass</th><th>Baseline final</th><th>Treatment final</th><th>Time to verified</th><th>Correction time</th><th>Slop</th><th>CI ready</th><th>QA</th><th>Preview</th><th>Evidence</th><th>Recommendation</th><th>Current roster</th><th>Rollback</th></tr></thead><tbody>${comparisons}</tbody></table></section>
  <section class="table"><h2>Daily routes</h2><table><thead><tr><th>Date</th><th>Repository</th><th>Capability</th><th>Route slot</th><th>Role</th><th>Model</th><th>Harness</th><th>n</th><th>First pass</th><th>Final pass</th><th>Time to verified</th><th>Correction time</th><th>Slop</th><th>CI ready</th><th>QA</th><th>Preview</th><th>Evidence</th><th>Cost USD</th></tr></thead><tbody>${daily}</tbody></table></section>
  <section class="table"><h2>Rolling 7-day routes</h2><table><thead><tr><th>Through</th><th>Repository</th><th>Capability</th><th>Route slot</th><th>Role</th><th>Model</th><th>Harness</th><th>n</th><th>First pass</th><th>Final pass</th><th>Time to verified</th><th>Correction time</th><th>Slop</th><th>CI ready</th><th>QA</th><th>Preview</th><th>Evidence</th><th>Cost USD</th></tr></thead><tbody>${rolling7}</tbody></table></section>
</main>
</body>
</html>
`;
}

/**
 * @param {any} scorecard
 * @param {string} outputDirectory
 */
export async function writeMeasurementScorecard(scorecard, outputDirectory) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await chmod(output, 0o700);
  const jsonPath = resolve(output, "scorecard.json");
  const htmlPath = resolve(output, "index.html");
  await writeFile(jsonPath, `${JSON.stringify(scorecard, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(htmlPath, renderMeasurementScorecardHtml(scorecard), { encoding: "utf8", mode: 0o600 });
  await chmod(jsonPath, 0o600);
  await chmod(htmlPath, 0o600);
  return { jsonPath, htmlPath };
}
