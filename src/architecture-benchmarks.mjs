// @ts-check

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { validateRunRecord } from "./measurements.mjs";

export const TASK_CLASSES = Object.freeze([
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
]);
export const TASK_CLASS_NAMES = Object.freeze({
  C1: "locate-seam",
  C2: "trace-path",
  C3: "duplicate-decision",
  C4: "instruction-gate",
  C5: "test-map",
  C6: "graph-reconcile",
});
export const MODES = Object.freeze(["M0", "M1", "M2", "M3", "M4"]);
export const MODE_NAMES = Object.freeze({
  M0: "prompt-only",
  M1: "instructions",
  M2: "local-shards",
  M3: "knowledge-graph",
  M4: "normalized-index",
});

/**
 * Recompute architecture answers against their SHA-pinned suite, then convert
 * scored runs into the shared measurement-v2 contract. A generated score is
 * deliberately not accepted here because it is a derived, editable artifact.
 * Modes outside the selected baseline/treatment pair are intentionally omitted.
 * @param {unknown} suite
 * @param {unknown[]} answers
 * @param {{
 *   baselineMode?: string,
 *   treatmentMode?: string,
 *   rosterHash: string,
 *   rollbackRef: string,
 *   ticket?: string,
 *   validatedModes?: string[],
 *   provisionalModes?: string[],
 * }} options
 */
export function architectureAnswersToMeasurementRecords(suite, answers, options) {
  const scored = scoreArchitectureAnswers(suite, answers);
  const baselineMode = options.baselineMode ?? "M1";
  const treatmentMode = options.treatmentMode ?? "M3";
  if (!MODES.includes(baselineMode) || !MODES.includes(treatmentMode) || baselineMode === treatmentMode) {
    throw new Error("baselineMode and treatmentMode must be distinct architecture modes");
  }
  if (!sha256Pattern.test(options.rosterHash)) throw new Error("rosterHash must be a SHA-256 hash");
  if (!/^roster:[a-f0-9]{64}$/.test(options.rollbackRef)) {
    throw new Error("rollbackRef must be an immutable roster SHA-256 reference");
  }
  const modeStatus = new Map();
  for (const [status, modes] of [
    ["validated", options.validatedModes ?? []],
    ["provisional", options.provisionalModes ?? []],
  ]) {
    for (const mode of modes) {
      if (!MODES.includes(mode)) throw new Error(`Unknown ${status} architecture mode: ${mode}`);
      if (modeStatus.has(mode)) throw new Error(`Architecture mode ${mode} has conflicting evidence statuses`);
      modeStatus.set(mode, status);
    }
  }
  for (const mode of [baselineMode, treatmentMode]) {
    if (!modeStatus.has(mode)) {
      throw new Error(
        `Architecture mode ${mode} requires an explicit --validated-mode or --provisional-mode status`,
      );
    }
  }
  const records = scored.runs
    .filter((/** @type {any} */ run) =>
      run.status === "scored" && [baselineMode, treatmentMode].includes(run.mode)
    )
    .map((/** @type {any} */ run) => {
      const passed = run.scores.taskPass === 1;
      const evidenceStatus = modeStatus.get(run.mode);
      const cohort = run.mode === baselineMode ? "baseline" : "treatment";
      const findings =
        run.penalties.falseClaims +
        run.penalties.forbiddenClaims +
        run.penalties.unsupportedClaims +
        (passed ? 0 : 1);
      const record = {
        schemaVersion: 2,
        runId: `architecture-${run.runId}`,
        cohort,
        repository: {
          id: run.repository.id,
          commit: run.repository.commit,
          ticket: options.ticket ?? "AOH-222",
        },
        benchmark: {
          packetId: `architecture-${run.identity.packetHash}`,
          acceptanceId: `architecture-${run.identity.acceptanceHash}`,
          fixtureHash: run.identity.fixtureHash,
          rosterHash: options.rosterHash,
        },
        capability: "architecture",
        stage: run.taskClassName,
        ciPolicy: "not-required-read-only",
        terminalSliceHash: run.identity.groundTruthHash,
        startedAt: run.timestamps.startedAt,
        endedAt: run.timestamps.endedAt,
        verifiedAt: null,
        waitMs: run.telemetry.waitMs,
        result: passed ? "success" : "failure",
        evidenceStatus,
        gates: {
          requirements: "not-required",
          spec: "not-required",
          tickets: "not-required",
          ci: "not-required",
          preview: "not-required",
          humanFinal: "pending",
        },
        agents: [{
          role: run.route.role,
          routeSlot: run.route.routeSlot,
          harness: run.route.harness,
          requestedModel: run.route.requestedModel,
          resolvedModel: run.route.resolvedModel,
          reasoning: run.route.reasoning,
          durationMs: run.telemetry.durationMs,
          tokens: run.telemetry.tokens,
          costUsd: run.telemetry.costUsd,
          selectionReason: `architecture-benchmark-${run.mode.toLowerCase()}`,
          result: passed ? "success" : "failure",
          evidenceStatus,
        }],
        quality: {
          firstAttempt: { passed, findings },
          final: { passed, findings },
          reviews: 1,
          corrections: 0,
          correctionMs: 0,
          slop: run.penalties.falseClaims,
          regressions: 0,
          reopens: 0,
          ci: "not-required",
          qa: passed ? "passed" : "failed",
          preview: "not-required",
          escapedDefects: 0,
        },
        rollbackRef: cohort === "treatment" ? options.rollbackRef : null,
      };
      const errors = validateRunRecord(record);
      if (errors.length > 0) {
        throw new Error(`Architecture run ${run.runId} produced an invalid measurement record:\n- ${errors.join("\n- ")}`);
      }
      return record;
    });
  if (records.length === 0) throw new Error("No scored runs match the selected baseline/treatment modes");
  return records;
}

const suiteFields = new Set(["schemaVersion", "suiteId", "repositories", "cases"]);
const repositoryFields = new Set(["id", "commit", "exclusions", "modes"]);
const caseFields = new Set([
  "id",
  "repositoryId",
  "taskClass",
  "packetHash",
  "acceptanceHash",
  "fixtureHash",
  "groundTruthHash",
  "expected",
  "forbiddenClaims",
  "unsupportedClaims",
]);
const expectedFields = new Set([
  "canonicalPaths",
  "symbols",
  "edges",
  "instructionFacts",
  "gateFacts",
]);
const claimSetFields = new Set([
  "paths",
  "symbols",
  "edges",
  "instructionFacts",
  "gateFacts",
]);
const symbolFields = new Set(["path", "name"]);
const edgeFields = new Set(["from", "to", "kind"]);
const answerFields = new Set([
  "schemaVersion",
  "runId",
  "caseId",
  "repository",
  "identity",
  "mode",
  "route",
  "startedAt",
  "endedAt",
  "tokens",
  "costUsd",
  "waitMs",
  "claims",
]);
const routeFields = new Set([
  "routeSlot",
  "role",
  "harness",
  "requestedModel",
  "resolvedModel",
  "reasoning",
]);
const evidenceFields = new Set(["path", "startLine", "endLine"]);
const pathClaimFields = new Set(["path", "evidenceRefs"]);
const symbolClaimFields = new Set(["path", "name", "evidenceRefs"]);
const edgeClaimFields = new Set(["from", "to", "kind", "evidenceRefs"]);
const factClaimFields = new Set(["id", "evidenceRefs"]);
const generatedOutputFields = new Set([
  "schemaVersion",
  "operation",
  "suiteId",
  "generatedAt",
  "availability",
  "runs",
  "aggregates",
]);
const availabilityFields = new Set(["scored", "unavailable"]);
const scoredRunFields = new Set([
  "runId",
  "caseId",
  "repository",
  "taskClass",
  "taskClassName",
  "mode",
  "modeName",
  "route",
  "identity",
  "timestamps",
  "telemetry",
  "status",
  "scores",
  "penalties",
]);
const scoredRepositoryFields = new Set(["id", "commit"]);
const identityFields = new Set([
  "packetHash",
  "acceptanceHash",
  "fixtureHash",
  "groundTruthHash",
]);
const timestampFields = new Set(["startedAt", "endedAt"]);
const telemetryFields = new Set(["durationMs", "tokens", "costUsd", "waitMs"]);
const penaltyFields = new Set(["falseClaims", "forbiddenClaims", "unsupportedClaims"]);
const scoreNames = [
  "canonicalHitAt1",
  "pathRecall",
  "symbolRecall",
  "edgePrecision",
  "edgeRecall",
  "instructionCoverage",
  "gateCoverage",
  "validEvidenceRatio",
  "falseClaimRate",
  "taskPass",
];
const aggregateFields = new Set([
  "repository",
  "taskClass",
  "taskClassName",
  "mode",
  "modeName",
  "role",
  "model",
  "harness",
  "identity",
  "n",
  "mean",
  "passRate",
]);
const aggregateMeanFields = new Set([
  ...scoreNames,
  "durationMs",
  "tokens",
  "costUsd",
  "waitMs",
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/#+-]{0,127}$/;
const factPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const edgeKindPattern = /^[a-z][a-z0-9-]{0,63}$/;
const forbiddenPrivacyKey = /prompt|secret|password|apikey|sourcesnippet|narrative|transcript|modeloutput/i;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {Record<string, any>} value @param {Set<string>} allowed @param {string} path @param {string[]} errors */
function rejectUnknown(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}${key} is not allowed`);
  }
}

/** @param {unknown} value @param {string} path @param {string[]} errors */
function rejectPrivacyFields(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivacyFields(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (forbiddenPrivacyKey.test(key.replaceAll(/[^a-z0-9]/gi, ""))) {
      errors.push(`${nestedPath} is forbidden by the privacy-safe schema`);
    }
    rejectPrivacyFields(nested, nestedPath, errors);
  }
}

/** @param {unknown} value */
function isUtcTimestamp(value) {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

/** @param {unknown} value */
function isNonNegativeIntegerOrNull(value) {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** @param {unknown} value */
function isNonNegativeNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

/**
 * Normalize a repository-relative path deterministically without consulting the filesystem.
 * @param {string} value
 */
export function normalizeArchitecturePath(value) {
  const normalized = value.trim().normalize("NFC").replaceAll("\\", "/");
  const segments = normalized.split("/");
  while (segments[0] === "." || segments[0] === "") segments.shift();
  /** @type {string[]} */
  const resolved = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return "";
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

/** @param {string} value */
function isCanonicalInputPath(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  const normalized = normalizeArchitecturePath(trimmed);
  return normalized.length > 0 && !trimmed.split(/[\\/]/).includes("..");
}

/** @param {string} value */
function normalizeIdentifier(value) {
  return value.trim().normalize("NFC");
}

/** @param {string} value */
function normalizeCodeRef(value) {
  const hash = value.indexOf("#");
  if (hash === -1) return normalizeArchitecturePath(value);
  return `${normalizeArchitecturePath(value.slice(0, hash))}#${normalizeIdentifier(value.slice(hash + 1))}`;
}

/** @param {string} value */
function isCanonicalCodeRef(value) {
  const parts = value.trim().split("#");
  if (parts.length > 2 || !isCanonicalInputPath(parts[0])) return false;
  return parts.length === 1 || identifierPattern.test(parts[1]);
}

/** @param {unknown} value @returns {string} */
function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** @param {any} symbol */
function normalizedSymbol(symbol) {
  return {
    path: normalizeArchitecturePath(symbol.path),
    name: normalizeIdentifier(symbol.name),
  };
}

/** @param {any} edge */
function normalizedEdge(edge) {
  return {
    from: normalizeCodeRef(edge.from),
    to: normalizeCodeRef(edge.to),
    kind: normalizeIdentifier(edge.kind),
  };
}

/** @param {any} expected */
function normalizedExpected(expected) {
  return {
    canonicalPaths: expected.canonicalPaths.map(normalizeArchitecturePath),
    symbols: expected.symbols.map(normalizedSymbol),
    edges: expected.edges.map(normalizedEdge),
    instructionFacts: expected.instructionFacts.map(normalizeIdentifier),
    gateFacts: expected.gateFacts.map(normalizeIdentifier),
  };
}

/** @param {any} claims */
function normalizedClaimSet(claims) {
  return {
    paths: claims.paths.map(normalizeArchitecturePath),
    symbols: claims.symbols.map(normalizedSymbol),
    edges: claims.edges.map(normalizedEdge),
    instructionFacts: claims.instructionFacts.map(normalizeIdentifier),
    gateFacts: claims.gateFacts.map(normalizeIdentifier),
  };
}

/**
 * Hash only canonical ground-truth fields. Array order remains meaningful.
 * @param {{expected: any, forbiddenClaims: any, unsupportedClaims: any}} truth
 * @param {{repositoryId: string, repositoryCommit: string, caseId: string}} identity
 */
export function hashGroundTruth(truth, identity) {
  const canonical = {
    identity: {
      repositoryId: normalizeIdentifier(identity.repositoryId),
      repositoryCommit: identity.repositoryCommit,
      caseId: normalizeIdentifier(identity.caseId),
    },
    expected: normalizedExpected(truth.expected),
    forbiddenClaims: normalizedClaimSet(truth.forbiddenClaims),
    unsupportedClaims: normalizedClaimSet(truth.unsupportedClaims),
  };
  return createHash("sha256").update(stableSerialize(canonical)).digest("hex");
}

/** @param {unknown} value @param {string} path @param {string[]} errors */
function validatePathArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !isCanonicalInputPath(entry)) {
      errors.push(`${path}[${index}] must be a repository-relative path`);
    }
  });
}

/** @param {unknown} value @param {string} path @param {string[]} errors */
function validateSymbols(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}].`;
    if (!isRecord(entry)) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    rejectUnknown(entry, symbolFields, itemPath, errors);
    if (typeof entry.path !== "string" || !isCanonicalInputPath(entry.path)) {
      errors.push(`${itemPath}path must be a repository-relative path`);
    }
    if (typeof entry.name !== "string" || !identifierPattern.test(entry.name)) {
      errors.push(`${itemPath}name must be a controlled identifier`);
    }
  });
}

/** @param {unknown} value @param {string} path @param {string[]} errors */
function validateEdges(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}].`;
    if (!isRecord(entry)) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    rejectUnknown(entry, edgeFields, itemPath, errors);
    for (const field of ["from", "to"]) {
      if (typeof entry[field] !== "string" || !isCanonicalCodeRef(entry[field])) {
        errors.push(`${itemPath}${field} must be a controlled code reference`);
      }
    }
    if (typeof entry.kind !== "string" || !edgeKindPattern.test(entry.kind)) {
      errors.push(`${itemPath}kind must be a controlled edge kind`);
    }
  });
}

/** @param {unknown} value @param {string} path @param {string[]} errors */
function validateFacts(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !factPattern.test(entry)) {
      errors.push(`${path}[${index}] must be a controlled fact identifier`);
    }
  });
}

/** @param {unknown} value @param {string} path @param {string[]} errors @param {boolean} expected */
function validateGroundTruthSet(value, path, errors, expected) {
  if (!isRecord(value)) {
    errors.push(`${path.slice(0, -1)} must be an object`);
    return;
  }
  rejectUnknown(value, expected ? expectedFields : claimSetFields, path, errors);
  validatePathArray(value[expected ? "canonicalPaths" : "paths"], `${path}${expected ? "canonicalPaths" : "paths"}`, errors);
  validateSymbols(value.symbols, `${path}symbols`, errors);
  validateEdges(value.edges, `${path}edges`, errors);
  validateFacts(value.instructionFacts, `${path}instructionFacts`, errors);
  validateFacts(value.gateFacts, `${path}gateFacts`, errors);
}

/**
 * Validate the strict suite and its SHA-pinned ground truth.
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateArchitectureSuite(value) {
  /** @type {string[]} */
  const errors = [];
  rejectPrivacyFields(value, "", errors);
  if (!isRecord(value)) return [...errors, "suite must be an object"];
  rejectUnknown(value, suiteFields, "", errors);
  if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (typeof value.suiteId !== "string" || !identifierPattern.test(value.suiteId)) {
    errors.push("suiteId must be a controlled identifier");
  }

  const repositoryIds = new Set();
  const repositoriesById = new Map();
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) {
    errors.push("repositories must be a non-empty array");
  } else {
    value.repositories.forEach((repository, index) => {
      const path = `repositories[${index}].`;
      if (!isRecord(repository)) {
        errors.push(`${path.slice(0, -1)} must be an object`);
        return;
      }
      rejectUnknown(repository, repositoryFields, path, errors);
      if (typeof repository.id !== "string" || !identifierPattern.test(repository.id)) {
        errors.push(`${path}id must be a controlled identifier`);
      } else if (repositoryIds.has(repository.id)) {
        errors.push(`${path}id duplicates repository ${repository.id}`);
      } else {
        repositoryIds.add(repository.id);
        repositoriesById.set(repository.id, repository);
      }
      if (typeof repository.commit !== "string" || !commitPattern.test(repository.commit)) {
        errors.push(`${path}commit must be an exact lowercase 40-character Git commit`);
      }
      validatePathArray(repository.exclusions, `${path}exclusions`, errors);
      if (!isRecord(repository.modes)) {
        errors.push(`${path}modes must be an object`);
      } else {
        rejectUnknown(repository.modes, new Set(MODES), `${path}modes.`, errors);
        for (const mode of MODES) {
          if (typeof repository.modes[mode] !== "boolean") {
            errors.push(`${path}modes.${mode} must be boolean`);
          }
        }
      }
    });
  }

  const caseIds = new Set();
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    errors.push("cases must be a non-empty array");
  } else {
    value.cases.forEach((benchmarkCase, index) => {
      const path = `cases[${index}].`;
      if (!isRecord(benchmarkCase)) {
        errors.push(`${path.slice(0, -1)} must be an object`);
        return;
      }
      rejectUnknown(benchmarkCase, caseFields, path, errors);
      if (typeof benchmarkCase.id !== "string" || !identifierPattern.test(benchmarkCase.id)) {
        errors.push(`${path}id must be a controlled identifier`);
      } else if (caseIds.has(benchmarkCase.id)) {
        errors.push(`${path}id duplicates case ${benchmarkCase.id}`);
      } else {
        caseIds.add(benchmarkCase.id);
      }
      if (typeof benchmarkCase.repositoryId !== "string" || !repositoryIds.has(benchmarkCase.repositoryId)) {
        errors.push(`${path}repositoryId must reference a declared repository`);
      }
      if (!TASK_CLASSES.includes(benchmarkCase.taskClass)) {
        errors.push(`${path}taskClass must be one of ${TASK_CLASSES.join(", ")}`);
      }
      for (const field of ["packetHash", "acceptanceHash", "fixtureHash", "groundTruthHash"]) {
        if (typeof benchmarkCase[field] !== "string" || !sha256Pattern.test(benchmarkCase[field])) {
          errors.push(`${path}${field} must be a lowercase SHA-256 hash`);
        }
      }
      validateGroundTruthSet(benchmarkCase.expected, `${path}expected.`, errors, true);
      validateGroundTruthSet(benchmarkCase.forbiddenClaims, `${path}forbiddenClaims.`, errors, false);
      validateGroundTruthSet(benchmarkCase.unsupportedClaims, `${path}unsupportedClaims.`, errors, false);
      if (
        isRecord(benchmarkCase.expected) &&
        Array.isArray(benchmarkCase.expected.canonicalPaths) &&
        benchmarkCase.expected.canonicalPaths.length === 0
      ) {
        errors.push(`${path}expected.canonicalPaths must not be empty`);
      }
      try {
        const repository = repositoriesById.get(benchmarkCase.repositoryId);
        const computed = hashGroundTruth(/** @type {any} */ (benchmarkCase), {
          repositoryId: benchmarkCase.repositoryId,
          repositoryCommit: repository?.commit,
          caseId: benchmarkCase.id,
        });
        if (benchmarkCase.groundTruthHash !== computed) {
          errors.push(`${path}groundTruthHash does not match canonical ground truth (${computed})`);
        }
      } catch {
        // Structural errors above explain why the hash could not be computed.
      }
    });
  }
  return errors;
}

/** @param {unknown} value @param {string} path @param {string[]} errors */
function validateEvidenceRefs(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}].`;
    if (!isRecord(entry)) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    rejectUnknown(entry, evidenceFields, itemPath, errors);
    if (typeof entry.path !== "string" || !isCanonicalInputPath(entry.path)) {
      errors.push(`${itemPath}path must be a repository-relative path`);
    }
    if (!Number.isSafeInteger(entry.startLine) || entry.startLine < 1) {
      errors.push(`${itemPath}startLine must be a positive integer`);
    }
    if (!Number.isSafeInteger(entry.endLine) || entry.endLine < entry.startLine) {
      errors.push(`${itemPath}endLine must be an integer at or after startLine`);
    }
  });
}

/** @param {unknown} value @param {string} path @param {Set<string>} fields @param {string[]} errors */
function validateClaimArray(value, path, fields, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}].`;
    if (!isRecord(entry)) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    rejectUnknown(entry, fields, itemPath, errors);
    if (fields.has("path") && (typeof entry.path !== "string" || !isCanonicalInputPath(entry.path))) {
      errors.push(`${itemPath}path must be a repository-relative path`);
    }
    if (fields.has("name") && (typeof entry.name !== "string" || !identifierPattern.test(entry.name))) {
      errors.push(`${itemPath}name must be a controlled identifier`);
    }
    if (fields.has("from")) {
      for (const field of ["from", "to"]) {
        if (typeof entry[field] !== "string" || !isCanonicalCodeRef(entry[field])) {
          errors.push(`${itemPath}${field} must be a controlled code reference`);
        }
      }
      if (typeof entry.kind !== "string" || !edgeKindPattern.test(entry.kind)) {
        errors.push(`${itemPath}kind must be a controlled edge kind`);
      }
    }
    if (fields.has("id") && (typeof entry.id !== "string" || !factPattern.test(entry.id))) {
      errors.push(`${itemPath}id must be a controlled fact identifier`);
    }
    validateEvidenceRefs(entry.evidenceRefs, `${itemPath}evidenceRefs`, errors);
  });
}

/**
 * Validate one strict structured candidate answer.
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateArchitectureAnswer(value) {
  /** @type {string[]} */
  const errors = [];
  rejectPrivacyFields(value, "", errors);
  if (!isRecord(value)) return [...errors, "answer must be an object"];
  rejectUnknown(value, answerFields, "", errors);
  if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  for (const field of ["runId", "caseId"]) {
    if (typeof value[field] !== "string" || !identifierPattern.test(value[field])) {
      errors.push(`${field} must be a controlled identifier`);
    }
  }
  if (!isRecord(value.repository)) {
    errors.push("repository must be an object");
  } else {
    rejectUnknown(value.repository, scoredRepositoryFields, "repository.", errors);
    if (typeof value.repository.id !== "string" || !identifierPattern.test(value.repository.id)) {
      errors.push("repository.id must be a controlled identifier");
    }
    if (typeof value.repository.commit !== "string" || !commitPattern.test(value.repository.commit)) {
      errors.push("repository.commit must be an exact lowercase 40-character Git commit");
    }
  }
  validateScoreIdentity(value.identity, "identity.", errors);
  if (!MODES.includes(value.mode)) errors.push(`mode must be one of ${MODES.join(", ")}`);
  if (!isRecord(value.route)) {
    errors.push("route must be an object");
  } else {
    rejectUnknown(value.route, routeFields, "route.", errors);
    for (const field of routeFields) {
      if (typeof value.route[field] !== "string" || !identifierPattern.test(value.route[field])) {
        errors.push(`route.${field} must be a controlled identifier`);
      }
    }
  }
  for (const field of ["startedAt", "endedAt"]) {
    if (!isUtcTimestamp(value[field])) errors.push(`${field} must be an ISO-8601 UTC timestamp`);
  }
  if (
    isUtcTimestamp(value.startedAt) &&
    isUtcTimestamp(value.endedAt) &&
    Date.parse(value.endedAt) < Date.parse(value.startedAt)
  ) {
    errors.push("endedAt must not be before startedAt");
  }
  for (const field of ["tokens", "waitMs"]) {
    if (!isNonNegativeIntegerOrNull(value[field])) {
      errors.push(`${field} must be a non-negative integer or null`);
    }
  }
  if (!isNonNegativeNumberOrNull(value.costUsd)) {
    errors.push("costUsd must be a non-negative number or null");
  }
  if (!isRecord(value.claims)) {
    errors.push("claims must be an object");
  } else {
    rejectUnknown(value.claims, claimSetFields, "claims.", errors);
    validateClaimArray(value.claims.paths, "claims.paths", pathClaimFields, errors);
    validateClaimArray(value.claims.symbols, "claims.symbols", symbolClaimFields, errors);
    validateClaimArray(value.claims.edges, "claims.edges", edgeClaimFields, errors);
    validateClaimArray(value.claims.instructionFacts, "claims.instructionFacts", factClaimFields, errors);
    validateClaimArray(value.claims.gateFacts, "claims.gateFacts", factClaimFields, errors);
  }
  return errors;
}

/** @param {string} inputPath */
async function answerFiles(inputPath) {
  const absolute = resolve(inputPath);
  const details = await stat(absolute);
  if (details.isFile()) return [absolute];
  if (!details.isDirectory()) throw new Error(`Answer input is not a file or directory: ${absolute}`);
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const nested = resolve(absolute, entry.name);
    if (entry.isDirectory()) files.push(...await answerFiles(nested));
    else if (entry.isFile() && [".json", ".jsonl"].includes(extname(entry.name))) files.push(nested);
  }
  return files.sort();
}

/** @param {unknown} value */
function isGeneratedArchitectureOutput(value) {
  return validateArchitectureScore(value).length === 0;
}

/** @param {string} path */
async function readAnswerFile(path) {
  const text = await readFile(path, "utf8");
  /** @type {unknown[]} */
  let values;
  if (extname(path) === ".jsonl") {
    values = text.split("\n").flatMap((line, index) => {
      if (line.trim() === "") return [];
      try {
        return [JSON.parse(line)];
      } catch (error) {
        throw new Error(`${path}:${index + 1} is invalid JSON: ${/** @type {Error} */ (error).message}`);
      }
    });
  } else {
    try {
      const parsed = JSON.parse(text);
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      throw new Error(`${path} is invalid JSON: ${/** @type {Error} */ (error).message}`);
    }
  }
  return values.filter((entry) => !isGeneratedArchitectureOutput(entry));
}

/**
 * Recursively load candidate answers and reject duplicate run IDs.
 * @param {string|string[]} inputs
 */
export async function ingestArchitectureAnswers(inputs) {
  const paths = Array.isArray(inputs) ? inputs : [inputs];
  /** @type {any[]} */
  const answers = [];
  for (const input of paths) {
    for (const path of await answerFiles(input)) {
      const values = await readAnswerFile(path);
      for (const value of values) {
        const errors = validateArchitectureAnswer(value);
        if (errors.length > 0) throw new Error(`${path} has an invalid architecture answer:\n- ${errors.join("\n- ")}`);
        answers.push(value);
      }
    }
  }
  const seen = new Set();
  for (const entry of answers) {
    if (seen.has(entry.runId)) throw new Error(`duplicate runId: ${entry.runId}`);
    seen.add(entry.runId);
  }
  return answers;
}

/** @param {any} item */
function symbolKey(item) {
  const value = normalizedSymbol(item);
  return `${value.path}#${value.name}`;
}

/** @param {any} item */
function edgeKey(item) {
  const value = normalizedEdge(item);
  return `${value.from}\u0000${value.kind}\u0000${value.to}`;
}

/** @param {any} expected @param {any} claimSet */
function truthSets(expected, claimSet) {
  return {
    paths: new Set((expected ? claimSet.canonicalPaths : claimSet.paths).map(normalizeArchitecturePath)),
    symbols: new Set(claimSet.symbols.map(symbolKey)),
    edges: new Set(claimSet.edges.map(edgeKey)),
    instructionFacts: new Set(claimSet.instructionFacts.map(normalizeIdentifier)),
    gateFacts: new Set(claimSet.gateFacts.map(normalizeIdentifier)),
  };
}

/** @param {Set<string>} claimed @param {Set<string>} expected */
function recall(claimed, expected) {
  if (expected.size === 0) return 1;
  let hits = 0;
  for (const value of expected) if (claimed.has(value)) hits += 1;
  return hits / expected.size;
}

/** @param {Set<string>} claimed @param {Set<string>} expected */
function precision(claimed, expected) {
  if (claimed.size === 0) return expected.size === 0 ? 1 : 0;
  let hits = 0;
  for (const value of claimed) if (expected.has(value)) hits += 1;
  return hits / claimed.size;
}

/** @param {any} claims */
function claimedSets(claims) {
  return {
    paths: new Set(claims.paths.map((/** @type {any} */ item) => normalizeArchitecturePath(item.path))),
    symbols: new Set(claims.symbols.map(symbolKey)),
    edges: new Set(claims.edges.map(edgeKey)),
    instructionFacts: new Set(claims.instructionFacts.map((/** @type {any} */ item) => normalizeIdentifier(item.id))),
    gateFacts: new Set(claims.gateFacts.map((/** @type {any} */ item) => normalizeIdentifier(item.id))),
  };
}

/** @param {any} claim @param {Set<string>} validPaths @param {string[]} exclusions */
function claimHasValidEvidence(claim, validPaths, exclusions) {
  return claim.evidenceRefs.length > 0 && claim.evidenceRefs.every((/** @type {any} */ reference) => {
    const path = normalizeArchitecturePath(reference.path);
    const excluded = exclusions.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    return validPaths.has(path) && !excluded;
  });
}

/** @param {any} answer @param {any} benchmarkCase @param {any} repository */
function scoreAnswer(answer, benchmarkCase, repository) {
  const expected = truthSets(true, benchmarkCase.expected);
  const forbidden = truthSets(false, benchmarkCase.forbiddenClaims);
  const unsupported = truthSets(false, benchmarkCase.unsupportedClaims);
  const claimed = claimedSets(answer.claims);
  /** @type {Array<"paths"|"symbols"|"edges"|"instructionFacts"|"gateFacts">} */
  const categories = ["paths", "symbols", "edges", "instructionFacts", "gateFacts"];
  let falseClaims = 0;
  let totalClaims = 0;
  let forbiddenClaims = 0;
  let unsupportedClaims = 0;
  for (const category of categories) {
    for (const value of claimed[category]) {
      totalClaims += 1;
      if (!expected[category].has(value)) falseClaims += 1;
      if (forbidden[category].has(value)) forbiddenClaims += 1;
      if (unsupported[category].has(value)) unsupportedClaims += 1;
    }
  }
  const allClaims = categories.flatMap((category) => answer.claims[category]);
  const validPaths = expected.paths;
  const exclusions = repository.exclusions.map(normalizeArchitecturePath);
  const evidenceValid = allClaims.filter((claim) => claimHasValidEvidence(claim, validPaths, exclusions)).length;
  const scores = {
    canonicalHitAt1: answer.claims.paths.length > 0 &&
      normalizeArchitecturePath(answer.claims.paths[0].path) === [...expected.paths][0] ? 1 : 0,
    pathRecall: recall(claimed.paths, expected.paths),
    symbolRecall: recall(claimed.symbols, expected.symbols),
    edgePrecision: precision(claimed.edges, expected.edges),
    edgeRecall: recall(claimed.edges, expected.edges),
    instructionCoverage: recall(claimed.instructionFacts, expected.instructionFacts),
    gateCoverage: recall(claimed.gateFacts, expected.gateFacts),
    validEvidenceRatio: allClaims.length === 0 ? 0 : evidenceValid / allClaims.length,
    falseClaimRate: totalClaims === 0 ? 0 : falseClaims / totalClaims,
    taskPass: 0,
  };
  scores.taskPass = (
    scores.canonicalHitAt1 === 1 &&
    scores.pathRecall >= 0.8 &&
    scores.symbolRecall >= 0.8 &&
    scores.edgePrecision >= 0.8 &&
    scores.edgeRecall >= 0.8 &&
    scores.instructionCoverage >= 0.8 &&
    scores.gateCoverage >= 0.8 &&
    scores.validEvidenceRatio === 1 &&
    scores.falseClaimRate === 0 &&
    forbiddenClaims === 0 &&
    unsupportedClaims === 0
  ) ? 1 : 0;
  return { scores, penalties: { falseClaims, forbiddenClaims, unsupportedClaims } };
}

/** @param {(number|null)[]} values */
function nullableMean(values) {
  if (values.some((value) => value === null)) return null;
  return values.map((value) => /** @type {number} */ (value)).reduce((sum, value) => sum + value, 0) / values.length;
}

/** @param {number[]} values */
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** @param {any[]} runs */
function aggregateRuns(runs) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const run of runs.filter((/** @type {any} */ entry) => entry.status === "scored")) {
    const key = stableSerialize({
      repository: run.repository.id,
      taskClass: run.taskClass,
      mode: run.mode,
      role: run.route.role,
      resolvedModel: run.route.resolvedModel,
      harness: run.route.harness,
      ...run.identity,
    });
    const entries = groups.get(key) ?? [];
    entries.push(run);
    groups.set(key, entries);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, entries]) => {
    const first = entries[0];
    const scoreMean = Object.fromEntries(
      scoreNames.map((name) => [name, mean(entries.map((/** @type {any} */ entry) => entry.scores[name]))]),
    );
    return {
      repository: first.repository.id,
      taskClass: first.taskClass,
      taskClassName: first.taskClassName,
      mode: first.mode,
      modeName: first.modeName,
      role: first.route.role,
      model: first.route.resolvedModel,
      harness: first.route.harness,
      identity: first.identity,
      n: entries.length,
      mean: {
        ...scoreMean,
        durationMs: mean(entries.map((/** @type {any} */ entry) => entry.telemetry.durationMs)),
        tokens: nullableMean(entries.map((/** @type {any} */ entry) => entry.telemetry.tokens)),
        costUsd: nullableMean(entries.map((/** @type {any} */ entry) => entry.telemetry.costUsd)),
        waitMs: nullableMean(entries.map((/** @type {any} */ entry) => entry.telemetry.waitMs)),
      },
      passRate: scoreMean.taskPass,
    };
  });
}

/**
 * Score structured answers against one validated suite.
 * @param {unknown} suite
 * @param {unknown[]} answers
 * @param {{validateAnswers?: boolean}} [options]
 */
export function scoreArchitectureAnswers(suite, answers, options = {}) {
  const suiteErrors = validateArchitectureSuite(suite);
  if (suiteErrors.length > 0) throw new Error(`Invalid architecture suite:\n- ${suiteErrors.join("\n- ")}`);
  const typedSuite = /** @type {any} */ (suite);
  const seen = new Set();
  /** @type {any[]} */
  const runs = [];
  for (const rawAnswer of answers) {
    if (options.validateAnswers !== false) {
      const errors = validateArchitectureAnswer(rawAnswer);
      if (errors.length > 0) throw new Error(`Invalid architecture answer:\n- ${errors.join("\n- ")}`);
    }
    const answer = /** @type {any} */ (rawAnswer);
    if (seen.has(answer.runId)) throw new Error(`duplicate runId: ${answer.runId}`);
    seen.add(answer.runId);
    const benchmarkCase = typedSuite.cases.find((/** @type {any} */ entry) => entry.id === answer.caseId);
    if (!benchmarkCase) throw new Error(`run ${answer.runId} references unknown caseId ${answer.caseId}`);
    const repository = typedSuite.repositories.find((/** @type {any} */ entry) => entry.id === benchmarkCase.repositoryId);
    const identity = {
      packetHash: benchmarkCase.packetHash,
      acceptanceHash: benchmarkCase.acceptanceHash,
      fixtureHash: benchmarkCase.fixtureHash,
      groundTruthHash: benchmarkCase.groundTruthHash,
    };
    if (
      answer.repository.id !== repository.id ||
      answer.repository.commit !== repository.commit
    ) {
      throw new Error(
        `run ${answer.runId} repository binding does not match suite case ${answer.caseId}`,
      );
    }
    if (stableSerialize(answer.identity) !== stableSerialize(identity)) {
      throw new Error(
        `run ${answer.runId} identity binding does not match suite case ${answer.caseId}`,
      );
    }
    const base = {
      runId: answer.runId,
      caseId: answer.caseId,
      repository: { id: repository.id, commit: repository.commit },
      taskClass: benchmarkCase.taskClass,
      taskClassName: TASK_CLASS_NAMES[/** @type {keyof typeof TASK_CLASS_NAMES} */ (benchmarkCase.taskClass)],
      mode: answer.mode,
      modeName: MODE_NAMES[/** @type {keyof typeof MODE_NAMES} */ (answer.mode)],
      route: answer.route,
      identity,
      timestamps: { startedAt: answer.startedAt, endedAt: answer.endedAt },
      telemetry: {
        durationMs: Date.parse(answer.endedAt) - Date.parse(answer.startedAt),
        tokens: answer.tokens,
        costUsd: answer.costUsd,
        waitMs: answer.waitMs,
      },
    };
    if (!repository.modes[answer.mode]) {
      runs.push({ ...base, status: "unavailable", scores: null, penalties: null });
      continue;
    }
    runs.push({ ...base, status: "scored", ...scoreAnswer(answer, benchmarkCase, repository) });
  }
  const scored = runs.filter((entry) => entry.status === "scored").length;
  return {
    schemaVersion: 1,
    operation: "architecture-benchmark-score",
    suiteId: typedSuite.suiteId,
    generatedAt: new Date().toISOString(),
    availability: { scored, unavailable: runs.length - scored },
    runs,
    aggregates: aggregateRuns(runs),
  };
}

/** @param {unknown} value @param {string} path @param {string[]} errors */
function validateScoreIdentity(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path.slice(0, -1)} must be an object`);
    return;
  }
  rejectUnknown(value, identityFields, path, errors);
  for (const field of identityFields) {
    if (typeof value[field] !== "string" || !sha256Pattern.test(value[field])) {
      errors.push(`${path}${field} must be a lowercase SHA-256 hash`);
    }
  }
}

/** @param {unknown} value */
function isRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** @param {any} run @param {any} aggregate */
function runMatchesAggregate(run, aggregate) {
  return run.status === "scored" &&
    run.repository.id === aggregate.repository &&
    run.taskClass === aggregate.taskClass &&
    run.mode === aggregate.mode &&
    run.route.role === aggregate.role &&
    run.route.resolvedModel === aggregate.model &&
    run.route.harness === aggregate.harness &&
    [...identityFields].every((field) => run.identity[field] === aggregate.identity[field]);
}

/**
 * Validate a generated score/report before it can be skipped or re-emitted.
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateArchitectureScore(value) {
  /** @type {string[]} */
  const errors = [];
  rejectPrivacyFields(value, "", errors);
  if (!isRecord(value)) return [...errors, "architecture benchmark score must be an object"];
  rejectUnknown(value, generatedOutputFields, "", errors);
  if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!["architecture-benchmark-score", "architecture-benchmark-report"].includes(value.operation)) {
    errors.push("operation must be architecture-benchmark-score or architecture-benchmark-report");
  }
  if (typeof value.suiteId !== "string" || !identifierPattern.test(value.suiteId)) {
    errors.push("suiteId must be a controlled identifier");
  }
  if (!isUtcTimestamp(value.generatedAt)) {
    errors.push("generatedAt must be an ISO-8601 UTC timestamp");
  }

  if (!isRecord(value.availability)) {
    errors.push("availability must be an object");
  } else {
    rejectUnknown(value.availability, availabilityFields, "availability.", errors);
    for (const field of availabilityFields) {
      if (!Number.isSafeInteger(value.availability[field]) || value.availability[field] < 0) {
        errors.push(`availability.${field} must be a non-negative integer`);
      }
    }
  }

  const runIds = new Set();
  if (!Array.isArray(value.runs)) {
    errors.push("runs must be an array");
  } else {
    value.runs.forEach((run, index) => {
      const path = `runs[${index}].`;
      if (!isRecord(run)) {
        errors.push(`${path.slice(0, -1)} must be an object`);
        return;
      }
      rejectUnknown(run, scoredRunFields, path, errors);
      for (const field of ["runId", "caseId"]) {
        if (typeof run[field] !== "string" || !identifierPattern.test(run[field])) {
          errors.push(`${path}${field} must be a controlled identifier`);
        }
      }
      if (typeof run.runId === "string") {
        if (runIds.has(run.runId)) errors.push(`${path}runId duplicates ${run.runId}`);
        runIds.add(run.runId);
      }
      if (!isRecord(run.repository)) {
        errors.push(`${path}repository must be an object`);
      } else {
        rejectUnknown(run.repository, scoredRepositoryFields, `${path}repository.`, errors);
        if (typeof run.repository.id !== "string" || !identifierPattern.test(run.repository.id)) {
          errors.push(`${path}repository.id must be a controlled identifier`);
        }
        if (typeof run.repository.commit !== "string" || !commitPattern.test(run.repository.commit)) {
          errors.push(`${path}repository.commit must be an exact lowercase 40-character Git commit`);
        }
      }
      if (!TASK_CLASSES.includes(run.taskClass)) {
        errors.push(`${path}taskClass must be one of ${TASK_CLASSES.join(", ")}`);
      } else if (run.taskClassName !== TASK_CLASS_NAMES[/** @type {keyof typeof TASK_CLASS_NAMES} */ (run.taskClass)]) {
        errors.push(`${path}taskClassName does not match taskClass`);
      }
      if (!MODES.includes(run.mode)) {
        errors.push(`${path}mode must be one of ${MODES.join(", ")}`);
      } else if (run.modeName !== MODE_NAMES[/** @type {keyof typeof MODE_NAMES} */ (run.mode)]) {
        errors.push(`${path}modeName does not match mode`);
      }
      if (!isRecord(run.route)) {
        errors.push(`${path}route must be an object`);
      } else {
        rejectUnknown(run.route, routeFields, `${path}route.`, errors);
        for (const field of routeFields) {
          if (typeof run.route[field] !== "string" || !identifierPattern.test(run.route[field])) {
            errors.push(`${path}route.${field} must be a controlled identifier`);
          }
        }
      }
      validateScoreIdentity(run.identity, `${path}identity.`, errors);
      if (!isRecord(run.timestamps)) {
        errors.push(`${path}timestamps must be an object`);
      } else {
        rejectUnknown(run.timestamps, timestampFields, `${path}timestamps.`, errors);
        for (const field of timestampFields) {
          if (!isUtcTimestamp(run.timestamps[field])) {
            errors.push(`${path}timestamps.${field} must be an ISO-8601 UTC timestamp`);
          }
        }
        if (
          isUtcTimestamp(run.timestamps.startedAt) &&
          isUtcTimestamp(run.timestamps.endedAt) &&
          Date.parse(run.timestamps.endedAt) < Date.parse(run.timestamps.startedAt)
        ) {
          errors.push(`${path}timestamps.endedAt must not be before startedAt`);
        }
      }
      if (!isRecord(run.telemetry)) {
        errors.push(`${path}telemetry must be an object`);
      } else {
        rejectUnknown(run.telemetry, telemetryFields, `${path}telemetry.`, errors);
        if (!Number.isSafeInteger(run.telemetry.durationMs) || run.telemetry.durationMs < 0) {
          errors.push(`${path}telemetry.durationMs must be a non-negative integer`);
        }
        for (const field of ["tokens", "waitMs"]) {
          if (!isNonNegativeIntegerOrNull(run.telemetry[field])) {
            errors.push(`${path}telemetry.${field} must be a non-negative integer or null`);
          }
        }
        if (!isNonNegativeNumberOrNull(run.telemetry.costUsd)) {
          errors.push(`${path}telemetry.costUsd must be a non-negative number or null`);
        }
      }
      if (!["scored", "unavailable"].includes(run.status)) {
        errors.push(`${path}status must be scored or unavailable`);
      }
      if (run.status === "scored") {
        if (!isRecord(run.scores)) {
          errors.push(`${path}scores must be an object for a scored run`);
        } else {
          rejectUnknown(run.scores, new Set(scoreNames), `${path}scores.`, errors);
          for (const field of scoreNames) {
            if (!isRate(run.scores[field])) errors.push(`${path}scores.${field} must be between 0 and 1`);
          }
          if (![0, 1].includes(run.scores.taskPass)) {
            errors.push(`${path}scores.taskPass must be 0 or 1`);
          }
        }
        if (!isRecord(run.penalties)) {
          errors.push(`${path}penalties must be an object for a scored run`);
        } else {
          rejectUnknown(run.penalties, penaltyFields, `${path}penalties.`, errors);
          for (const field of penaltyFields) {
            if (!Number.isSafeInteger(run.penalties[field]) || run.penalties[field] < 0) {
              errors.push(`${path}penalties.${field} must be a non-negative integer`);
            }
          }
        }
      } else {
        if (run.scores !== null) errors.push(`${path}scores must be null for an unavailable run`);
        if (run.penalties !== null) errors.push(`${path}penalties must be null for an unavailable run`);
      }
    });
  }

  if (!Array.isArray(value.aggregates)) {
    errors.push("aggregates must be an array");
  } else {
    value.aggregates.forEach((aggregate, index) => {
      const path = `aggregates[${index}].`;
      if (!isRecord(aggregate)) {
        errors.push(`${path.slice(0, -1)} must be an object`);
        return;
      }
      rejectUnknown(aggregate, aggregateFields, path, errors);
      for (const field of ["repository", "role", "model", "harness"]) {
        if (typeof aggregate[field] !== "string" || !identifierPattern.test(aggregate[field])) {
          errors.push(`${path}${field} must be a controlled identifier`);
        }
      }
      if (!TASK_CLASSES.includes(aggregate.taskClass)) {
        errors.push(`${path}taskClass must be one of ${TASK_CLASSES.join(", ")}`);
      } else if (aggregate.taskClassName !== TASK_CLASS_NAMES[/** @type {keyof typeof TASK_CLASS_NAMES} */ (aggregate.taskClass)]) {
        errors.push(`${path}taskClassName does not match taskClass`);
      }
      if (!MODES.includes(aggregate.mode)) {
        errors.push(`${path}mode must be one of ${MODES.join(", ")}`);
      } else if (aggregate.modeName !== MODE_NAMES[/** @type {keyof typeof MODE_NAMES} */ (aggregate.mode)]) {
        errors.push(`${path}modeName does not match mode`);
      }
      validateScoreIdentity(aggregate.identity, `${path}identity.`, errors);
      if (!Number.isSafeInteger(aggregate.n) || aggregate.n < 1) {
        errors.push(`${path}n must be a positive integer`);
      }
      if (!isRecord(aggregate.mean)) {
        errors.push(`${path}mean must be an object`);
      } else {
        rejectUnknown(aggregate.mean, aggregateMeanFields, `${path}mean.`, errors);
        for (const field of scoreNames) {
          if (!isRate(aggregate.mean[field])) errors.push(`${path}mean.${field} must be between 0 and 1`);
        }
        if (
          typeof aggregate.mean.durationMs !== "number" ||
          !Number.isFinite(aggregate.mean.durationMs) ||
          aggregate.mean.durationMs < 0
        ) {
          errors.push(`${path}mean.durationMs must be a non-negative number`);
        }
        for (const field of ["tokens", "costUsd", "waitMs"]) {
          if (!isNonNegativeNumberOrNull(aggregate.mean[field])) {
            errors.push(`${path}mean.${field} must be a non-negative number or null`);
          }
        }
      }
      if (!isRate(aggregate.passRate)) errors.push(`${path}passRate must be between 0 and 1`);
      if (isRecord(aggregate.mean) && aggregate.passRate !== aggregate.mean.taskPass) {
        errors.push(`${path}passRate must equal mean.taskPass`);
      }
      if (Array.isArray(value.runs) && isRecord(aggregate.identity)) {
        const matchingRuns = value.runs.filter((run) =>
          isRecord(run) &&
          isRecord(run.repository) &&
          isRecord(run.route) &&
          isRecord(run.identity) &&
          runMatchesAggregate(run, aggregate)
        ).length;
        if (aggregate.n !== matchingRuns) {
          errors.push(`${path}n must equal matching scored runs (${matchingRuns})`);
        }
      }
    });
  }

  if (isRecord(value.availability) && Array.isArray(value.runs)) {
    const scored = value.runs.filter((run) => isRecord(run) && run.status === "scored").length;
    const unavailable = value.runs.filter((run) => isRecord(run) && run.status === "unavailable").length;
    if (value.availability.scored !== scored) {
      errors.push(`availability.scored must equal scored runs (${scored})`);
    }
    if (value.availability.unavailable !== unavailable) {
      errors.push(`availability.unavailable must equal unavailable runs (${unavailable})`);
    }
  }
  if (errors.length === 0 && stableSerialize(value.aggregates) !== stableSerialize(aggregateRuns(value.runs))) {
    errors.push("aggregates must exactly match deterministic aggregation of scored runs");
  }
  return errors;
}

/** @param {any} scored @returns {any} */
export function buildArchitectureReport(scored) {
  if (
    !isRecord(scored) ||
    scored.schemaVersion !== 1 ||
    !["architecture-benchmark-score", "architecture-benchmark-report"].includes(scored.operation) ||
    !Array.isArray(scored.runs) ||
    !Array.isArray(scored.aggregates)
  ) {
    throw new Error("Scored input is not an architecture benchmark score");
  }
  return {
    ...scored,
    operation: "architecture-benchmark-report",
    generatedAt: new Date().toISOString(),
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

/** @param {any} report */
function renderArchitectureHtml(report) {
  const rows = report.aggregates.map((/** @type {any} */ row) => `<tr>
<td>${escapeHtml(row.repository)}</td>
<td>${escapeHtml(`${row.taskClass} ${row.taskClassName}`)}</td>
<td>${escapeHtml(`${row.mode} ${row.modeName}`)}</td>
<td>${escapeHtml(row.role)}</td>
<td>${escapeHtml(row.model)}</td>
<td>${escapeHtml(row.harness)}</td>
<td>${escapeHtml(row.n)}</td>
<td>${escapeHtml(row.mean.taskPass.toFixed(3))}</td>
<td>${escapeHtml(row.mean.falseClaimRate.toFixed(3))}</td>
<td>${escapeHtml(row.mean.validEvidenceRatio.toFixed(3))}</td>
</tr>`).join("\n");
  const unavailableRows = report.runs
    .filter((/** @type {any} */ run) => run.status === "unavailable")
    .map((/** @type {any} */ run) => `<li>${escapeHtml(`${run.repository.id} / ${run.caseId} / ${run.mode} ${run.modeName}`)}</li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Architecture benchmark</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#161616;background:#fafafa}
table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #ddd;padding:.5rem;text-align:left}
th{background:#f0f0f0}code{font-family:ui-monospace,monospace}
</style>
</head>
<body>
<h1>Architecture benchmark</h1>
<p>Suite <code>${escapeHtml(report.suiteId)}</code>. Scored ${escapeHtml(report.availability.scored)}; unavailable ${escapeHtml(report.availability.unavailable)}.</p>
<table>
<thead><tr><th>Repository</th><th>Class</th><th>Mode</th><th>Role</th><th>Model</th><th>Harness</th><th>N</th><th>Pass rate</th><th>False claims</th><th>Valid evidence</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${unavailableRows ? `<h2>Unavailable modes</h2><ul>${unavailableRows}</ul>` : ""}
</body>
</html>
`;
}

/** @param {any} value @param {string} outputDirectory @param {boolean} html */
async function writeOutput(value, outputDirectory, html) {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const jsonPath = resolve(directory, "architecture-benchmark.json");
  await writeFile(jsonPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(jsonPath, 0o600);
  if (!html) return { jsonPath };
  const htmlPath = resolve(directory, "index.html");
  await writeFile(htmlPath, renderArchitectureHtml(value), { encoding: "utf8", mode: 0o600 });
  await chmod(htmlPath, 0o600);
  return { jsonPath, htmlPath };
}

/** @param {any} scored @param {string} outputDirectory */
export async function writeArchitectureScore(scored, outputDirectory) {
  return writeOutput(scored, outputDirectory, false);
}

/** @param {any} report @param {string} outputDirectory */
export async function writeArchitectureReport(report, outputDirectory) {
  return writeOutput(report, outputDirectory, true);
}

/** @param {string} path */
export async function readArchitectureSuite(path) {
  let value;
  try {
    value = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`${resolve(path)} is invalid JSON: ${/** @type {Error} */ (error).message}`);
  }
  const errors = validateArchitectureSuite(value);
  if (errors.length > 0) throw new Error(`Invalid architecture suite:\n- ${errors.join("\n- ")}`);
  return value;
}

/** @param {string} path */
export async function readArchitectureScore(path) {
  let value;
  try {
    value = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`${resolve(path)} is invalid JSON: ${/** @type {Error} */ (error).message}`);
  }
  const errors = validateArchitectureScore(value);
  if (errors.length > 0) {
    throw new Error(`Invalid architecture benchmark score:\n- ${errors.join("\n- ")}`);
  }
  return buildArchitectureReport(value);
}
