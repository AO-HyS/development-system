// @ts-check

import { readFileSync } from "node:fs";

const catalogPath = new URL("../artifacts/1.5.0/quality/stack-quality-profiles.json", import.meta.url);
/** @type {unknown} */
const parsedCatalog = JSON.parse(readFileSync(catalogPath, "utf8"));

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {Record<string, unknown>} record @param {string} key */
function requiredRecord(record, key) {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`stack quality catalog requires ${key}`);
  return value;
}

/** @param {Record<string, unknown>} record @param {string} key */
function requiredString(record, key) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`stack quality catalog requires ${key}`);
  return value;
}

/** @param {Record<string, unknown>} record @param {string} key */
function requiredStrings(record, key) {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`stack quality catalog requires ${key} as nonempty strings`);
  }
  return value;
}

function loadCatalog() {
  if (!isRecord(parsedCatalog)) throw new Error("stack quality catalog must be an object");
  const profiles = requiredRecord(parsedCatalog, "profiles");
  const rules = requiredRecord(parsedCatalog, "rules");
  const sources = requiredRecord(parsedCatalog, "sources");
  const oracles = requiredRecord(parsedCatalog, "oracles");
  if (parsedCatalog.contractVersion !== "1.5.0") throw new Error("stack quality catalog must target contract 1.5.0");

  const dimensions = ["composition", "performance", "locality", "modules", "interfaces", "state", "dataFetching", "platformBoundaries"];
  for (const [profileId, profileValue] of Object.entries(profiles)) {
    if (!isRecord(profileValue)) throw new Error(`profile ${profileId} must be an object`);
    const profileDimensions = requiredRecord(profileValue, "dimensions");
    for (const dimension of dimensions) requiredString(profileDimensions, dimension);
    for (const ruleId of requiredStrings(profileValue, "ruleIds")) {
      if (!isRecord(rules[ruleId])) throw new Error(`profile ${profileId} references unknown rule ${ruleId}`);
    }
    for (const sourceId of requiredStrings(profileValue, "sourceIds")) {
      if (!isRecord(sources[sourceId])) throw new Error(`profile ${profileId} references unknown source ${sourceId}`);
    }
  }
  for (const [ruleId, ruleValue] of Object.entries(rules)) {
    if (!isRecord(ruleValue)) throw new Error(`rule ${ruleId} must be an object`);
    const oracle = requiredString(ruleValue, "oracle");
    if (typeof oracles[oracle] !== "string") throw new Error(`rule ${ruleId} references unknown oracle ${oracle}`);
    for (const sourceId of requiredStrings(ruleValue, "sourceIds")) {
      const source = sources[sourceId];
      if (!isRecord(source)) throw new Error(`rule ${ruleId} references unknown source ${sourceId}`);
      const kind = requiredString(source, "kind");
      if (!new Set(["primary", "standard", "product-evidence"]).has(kind)) {
        throw new Error(`source ${sourceId} has unsupported authority ${kind}`);
      }
      requiredString(source, "title");
      requiredString(source, "url");
    }
  }
  return parsedCatalog;
}

const catalog = loadCatalog();
const profiles = requiredRecord(catalog, "profiles");
const rules = requiredRecord(catalog, "rules");
const sources = requiredRecord(catalog, "sources");
const profileOrder = Object.keys(profiles);

export function getStackQualityCatalog() {
  return structuredClone(catalog);
}

/** @param {unknown} input */
export function selectStackQualityProfiles(input) {
  const value = isRecord(input) ? input : {};
  const requested = Array.isArray(value.capabilities)
    ? value.capabilities.filter((capability) => typeof capability === "string")
    : [];
  const errors = [];
  if (!Array.isArray(value.capabilities) || requested.length !== value.capabilities.length) {
    errors.push("capabilities must be an array of profile identifiers");
  }
  const selected = new Set(requested);
  if (value.newMobile === true && !["expo-react-native", "ios", "android"].some((profile) => selected.has(profile))) {
    selected.add(requiredString(catalog, "defaultNewMobileProfile"));
  }
  for (const capability of selected) {
    if (!Object.hasOwn(profiles, capability)) errors.push(`unsupported stack capability: ${capability}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    selected: profileOrder.filter((profile) => selected.has(profile)),
    defaultApplied: value.newMobile === true && !requested.some((profile) => ["expo-react-native", "ios", "android"].includes(profile)),
  };
}

/**
 * Select the smallest oracle set for explicitly changed stack surfaces.
 * Input: { capabilities: string[], changedSurfaces: { id: string, capabilities: string[] }[], newMobile?: boolean }
 * Output groups stable rule and surface identifiers by provider-neutral oracle name.
 * @param {unknown} input
 */
export function selectApplicableQualityChecks(input) {
  const value = isRecord(input) ? input : {};
  const selection = selectStackQualityProfiles({ capabilities: value.capabilities, newMobile: value.newMobile });
  const changedSurfaces = Array.isArray(value.changedSurfaces) ? value.changedSurfaces : [];
  const errors = [...selection.errors];
  /** @type {Map<string, {oracle: string, ruleIds: string[], surfaceIds: string[]}>} */
  const grouped = new Map();

  for (const [index, surfaceValue] of changedSurfaces.entries()) {
    if (!isRecord(surfaceValue)) {
      errors.push(`changedSurfaces[${index}] must be an object`);
      continue;
    }
    const id = typeof surfaceValue.id === "string" && surfaceValue.id.length > 0 ? surfaceValue.id : "";
    const capabilities = Array.isArray(surfaceValue.capabilities)
      ? surfaceValue.capabilities.filter((capability) => typeof capability === "string")
      : [];
    if (!id) errors.push(`changedSurfaces[${index}].id is required`);
    if (!Array.isArray(surfaceValue.capabilities) || capabilities.length !== surfaceValue.capabilities.length || capabilities.length === 0) {
      errors.push(`changedSurfaces[${index}].capabilities must contain profile identifiers`);
      continue;
    }
    for (const capability of capabilities) {
      if (!selection.selected.includes(capability)) {
        errors.push(`changed surface ${id || index} uses undeclared capability: ${capability}`);
        continue;
      }
      const profile = profiles[capability];
      if (!isRecord(profile)) continue;
      for (const ruleId of requiredStrings(profile, "ruleIds")) {
        const oracle = requiredString(ruleDefinition(ruleId), "oracle");
        const group = grouped.get(oracle) ?? { oracle, ruleIds: [], surfaceIds: [] };
        if (!group.ruleIds.includes(ruleId)) group.ruleIds.push(ruleId);
        if (id && !group.surfaceIds.includes(id)) group.surfaceIds.push(id);
        grouped.set(oracle, group);
      }
    }
  }

  const oracleOrder = Object.keys(requiredRecord(catalog, "oracles"));
  return {
    schemaVersion: 1,
    contractVersion: requiredString(catalog, "contractVersion"),
    operation: "select-applicable-quality-checks",
    valid: errors.length === 0,
    errors,
    profiles: selection.selected,
    changedSurfaceIds: changedSurfaces.filter(isRecord).map((surface) => typeof surface.id === "string" ? surface.id : "").filter(Boolean),
    checks: oracleOrder.filter((oracle) => grouped.has(oracle)).map((oracle) => grouped.get(oracle)),
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}

/** @param {string} ruleId */
function ruleDefinition(ruleId) {
  const rule = rules[ruleId];
  if (!isRecord(rule)) throw new Error(`unknown stack quality rule ${ruleId}`);
  return rule;
}

/** @param {string} ruleId */
function ruleSources(ruleId) {
  return requiredStrings(ruleDefinition(ruleId), "sourceIds").map((sourceId) => {
    const source = sources[sourceId];
    if (!isRecord(source)) throw new Error(`unknown stack quality source ${sourceId}`);
    return {
      id: sourceId,
      kind: requiredString(source, "kind"),
      title: requiredString(source, "title"),
      url: requiredString(source, "url"),
    };
  });
}

/** @param {string} ruleId @param {string} detail @param {Record<string, unknown>} [extra] */
function reportItem(ruleId, detail, extra = {}) {
  const rule = ruleDefinition(ruleId);
  return {
    ruleId,
    oracle: requiredString(rule, "oracle"),
    detail,
    sources: ruleSources(ruleId),
    ...extra,
  };
}

/** @param {unknown} candidate @param {string} repository @param {string} ruleId @param {string | null} exactPath */
function validateException(candidate, repository, ruleId, exactPath) {
  if (!isRecord(candidate) || candidate.ruleId !== ruleId) return { matches: false, valid: false, reason: "rule does not match" };
  const scope = typeof candidate.scope === "string" ? candidate.scope : "";
  const rationale = typeof candidate.rationale === "string" ? candidate.rationale : "";
  const evidence = typeof candidate.evidence === "string" ? candidate.evidence : "";
  if (candidate.repository !== repository) return { matches: true, valid: false, reason: "exception repository does not match the audit repository" };
  if (!scope || scope === "*" || !rationale || !evidence) return { matches: true, valid: false, reason: "exception requires a narrow scope, rationale, and evidence" };
  const policy = requiredString(ruleDefinition(ruleId), "exceptionPolicy");
  if (policy === "none") return { matches: true, valid: false, reason: "this rule does not permit exceptions" };
  if (policy === "version-pin" && (typeof candidate.pinnedVersion !== "string" || candidate.pinnedVersion.length === 0)) {
    return { matches: true, valid: false, reason: "version-pin exceptions require pinnedVersion" };
  }
  if (policy === "narrow-external-adapter") {
    const adapterPath = /(^|\/)(adapters?|integrations?|boundaries)(\/|$)/i.test(scope);
    if (candidate.boundary !== "external" || exactPath === null || scope !== exactPath || !adapterPath) {
      return { matches: true, valid: false, reason: "type-erasure exceptions must name the exact external adapter path" };
    }
  }
  return { matches: true, valid: true, reason: "documented exception" };
}

/** @param {unknown[]} exceptions @param {string} repository @param {string} ruleId @param {string | null} exactPath */
function matchingException(exceptions, repository, ruleId, exactPath) {
  for (const candidate of exceptions) {
    const result = validateException(candidate, repository, ruleId, exactPath);
    if (result.matches) return { candidate, ...result };
  }
  return null;
}

const typeErasurePatterns = [
  { name: "explicit any", pattern: /(?:\bas\s+any\b|:\s*any\b|<\s*any\s*>|\bany\s*\[\]|\b(?:Array|Promise)\s*<\s*any\s*>|[=|,&?]\s*any\b|\bany\s*[|,&>]|\b(?:extends|keyof)\s+any\b)/ },
  { name: "double assertion", pattern: /\bas\s+(?:unknown|never|[A-Za-z_$][\w$]*(?:<[^>]+>)?)\s+as\s+[A-Za-z_$]/ },
];

/** @param {Record<string, unknown>} file */
function typeErasureViolations(file) {
  const path = typeof file.path === "string" ? file.path : "";
  const content = typeof file.content === "string" ? file.content : "";
  if (!/\.(?:ts|tsx|mts|cts)$/.test(path) || file.ownership === "external") return [];
  const violations = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (/@ts-(?:ignore|nocheck|expect-error)/.test(line)) {
      violations.push({ path, line: index + 1, kind: "TypeScript suppression" });
    }
    const code = line
      .replace(/(['"])(?:\\.|(?!\1).)*\1/g, "")
      .replace(/\/\/.*$/, "");
    for (const entry of typeErasurePatterns) {
      if (entry.pattern.test(code)) violations.push({ path, line: index + 1, kind: entry.name });
    }
  }
  return violations;
}

/**
 * Evaluate supplied repository facts without reading or modifying the repository.
 * @param {unknown} input
 */
export function auditStackQuality(input) {
  const value = isRecord(input) ? input : {};
  const repository = typeof value.repository === "string" && value.repository.length > 0 ? value.repository : "";
  const selection = selectStackQualityProfiles({ capabilities: value.capabilities, newMobile: value.newMobile });
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const exceptions = Array.isArray(value.exceptions) ? value.exceptions : [];
  const files = Array.isArray(value.files) ? value.files.filter(isRecord) : [];
  const findings = [];
  const recommendations = [];
  const acceptedExceptions = [];
  const unprovenEvidence = [];
  const errors = [...selection.errors];
  if (!repository) errors.push("repository is required");

  /** @type {string[]} */
  const selectedRuleIds = [];
  for (const profileId of selection.selected) {
    const profile = profiles[profileId];
    if (!isRecord(profile)) continue;
    for (const ruleId of requiredStrings(profile, "ruleIds")) {
      if (!selectedRuleIds.includes(ruleId)) selectedRuleIds.push(ruleId);
    }
  }

  if (selectedRuleIds.includes("quality.no-type-erasure")) {
    if (files.length === 0) {
      unprovenEvidence.push(reportItem("quality.no-type-erasure", "changed owned TypeScript content was not supplied"));
    }
    for (const file of files) {
      for (const violation of typeErasureViolations(file)) {
        const exception = matchingException(exceptions, repository, "quality.no-type-erasure", violation.path);
        if (exception?.valid) {
          acceptedExceptions.push(reportItem("quality.no-type-erasure", exception.reason, { scope: violation.path, exception: exception.candidate }));
        } else {
          findings.push(reportItem("quality.no-type-erasure", `${violation.kind} in owned TypeScript`, { path: violation.path, line: violation.line }));
          if (exception?.matches) findings.push(reportItem("quality.no-type-erasure", `invalid exception: ${exception.reason}`, { scope: violation.path }));
        }
      }
    }
  }

  for (const ruleId of selectedRuleIds) {
    if (ruleId === "quality.no-type-erasure") continue;
    const observation = evidence[ruleId];
    if (!isRecord(observation) || observation.status === "unproven") {
      unprovenEvidence.push(reportItem(ruleId, "responsible oracle evidence was not supplied"));
      continue;
    }
    const status = typeof observation.status === "string" ? observation.status : "unproven";
    const detail = typeof observation.detail === "string" && observation.detail.length > 0
      ? observation.detail
      : "oracle supplied no detail";
    if (status === "pass") continue;
    if (status === "recommendation") {
      recommendations.push(reportItem(ruleId, detail));
      continue;
    }
    if (status !== "fail") {
      unprovenEvidence.push(reportItem(ruleId, `unsupported oracle status: ${status}`));
      continue;
    }
    const exception = matchingException(exceptions, repository, ruleId, null);
    if (exception?.valid) {
      acceptedExceptions.push(reportItem(ruleId, detail, { scope: isRecord(exception.candidate) ? exception.candidate.scope : null, exception: exception.candidate }));
    } else {
      const level = requiredString(ruleDefinition(ruleId), "level");
      const target = level === "recommendation" ? recommendations : findings;
      target.push(reportItem(ruleId, detail));
      if (exception?.matches) findings.push(reportItem(ruleId, `invalid exception: ${exception.reason}`));
    }
  }

  const status = findings.length > 0
    ? "failed"
    : unprovenEvidence.length > 0
      ? "unproven"
      : recommendations.length > 0
        ? "passed-with-recommendations"
        : "passed";
  return {
    schemaVersion: 1,
    contractVersion: requiredString(catalog, "contractVersion"),
    operation: "audit-stack-quality",
    valid: errors.length === 0,
    errors,
    repository,
    status,
    profiles: selection.selected,
    defaultMobileProfileApplied: selection.defaultApplied,
    evaluatedRuleIds: selectedRuleIds,
    findings,
    recommendations,
    exceptions: acceptedExceptions,
    unprovenEvidence,
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
