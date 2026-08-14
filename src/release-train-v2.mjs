// @ts-check

import { selectApplicableQualityChecks } from "./stack-quality-profiles.mjs";

const phaseIds = Object.freeze([
  "changed-validation",
  "integrated-certification",
  "preview",
  "data-operations",
  "promotion",
  "production-smoke",
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

/** @param {string[]} changed @param {string[]} owned */
function affected(changed, owned) {
  return changed.some((surface) => owned.some((candidate) => surface === candidate || surface.startsWith(`${candidate}/`) || candidate.startsWith(`${surface}/`)));
}

/** @param {unknown} value */
function duration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { status: "observed", durationMs: value }
    : { status: "unproven", durationMs: null };
}

/**
 * Plan and evaluate a provider-aware release without contacting providers.
 * @param {Record<string, unknown>} input
 */
export function planReleaseTrain(input) {
  /** @type {string[]} */
  const errors = [];
  const revision = typeof input.revision === "string" ? input.revision : "";
  if (!/^[a-f0-9]{40}$/i.test(revision)) errors.push("revision must be an exact Git commit");
  const changedSurfaces = strings(input.changedSurfaces);
  if (changedSurfaces.length === 0) errors.push("changedSurfaces must identify at least one affected surface");

  const explicitRegistry = Array.isArray(input.checkRegistry) ? input.checkRegistry.filter(isRecord) : [];
  const qualityInput = isRecord(input.quality) ? input.quality : null;
  const qualitySelection = qualityInput ? selectApplicableQualityChecks(qualityInput) : null;
  if (qualitySelection && !qualitySelection.valid) {
    errors.push(...qualitySelection.errors.map((error) => `quality: ${error}`));
  }
  /** @type {Record<string, unknown>[]} */
  const qualityRegistry = [];
  if (qualitySelection?.valid) {
    for (const check of qualitySelection.checks) {
      if (!check) continue;
      qualityRegistry.push({
        id: check.oracle,
        command: null,
        evidenceKey: check.oracle,
        surfaces: check.surfaceIds,
        ruleIds: check.ruleIds,
        source: "stack-quality-profile",
      });
    }
  }
  const registry = [...explicitRegistry, ...qualityRegistry];
  /** @type {Record<string, unknown>[]} */
  const selected = [];
  /** @type {{id: unknown, reason: string}[]} */
  const skippedChecks = [];
  const evidenceKeys = new Set();
  for (const check of registry) {
    if (!affected(changedSurfaces, strings(check.surfaces))) continue;
    const evidenceKey = typeof check.evidenceKey === "string" && check.evidenceKey.trim() ? check.evidenceKey.trim() : String(check.id ?? "");
    if (evidenceKeys.has(evidenceKey)) {
      skippedChecks.push({ id: check.id, reason: `duplicate-evidence:${evidenceKey}` });
      continue;
    }
    evidenceKeys.add(evidenceKey);
    selected.push({
      id: check.id,
      command: check.command ?? null,
      evidenceKey,
      surfaces: strings(check.surfaces),
      ruleIds: strings(check.ruleIds),
      source: check.source ?? "repository",
    });
  }

  const buildArtifact = isRecord(input.buildArtifact) ? input.buildArtifact : {};
  const artifactReusable = buildArtifact.revision === revision
    && typeof buildArtifact.id === "string"
    && typeof buildArtifact.hash === "string"
    && /^sha256:[a-f0-9]{64}$/i.test(buildArtifact.hash);
  const rawProviders = Array.isArray(input.providers) ? input.providers.filter(isRecord) : [];
  const providerIds = new Set();
  for (const provider of rawProviders) {
    const id = typeof provider.id === "string" ? provider.id.trim() : "";
    if (!id) errors.push("every provider requires a non-empty unique id");
    else if (providerIds.has(id)) errors.push(`provider id must be unique: ${id}`);
    else providerIds.add(id);
  }
  const providers = rawProviders.map((provider) => {
    const providerSurfaces = strings(provider.surfaces);
    const isAffected = affected(changedSurfaces, providerSurfaces);
    if (!isAffected) return {
      id: provider.id,
      type: provider.type,
      status: "skipped-unaffected",
      reason: "no-owned-surface-changed",
      destination: provider.destination ?? null,
      destinations: {
        preview: provider.previewDestination ?? null,
        production: provider.productionDestination ?? null,
      },
      build: { action: "skip", provenance: null },
    };
    const credentialsReady = provider.credentials === "ready";
    const reuse = provider.acceptsBuildArtifact === true && artifactReusable;
    return {
      id: provider.id,
      type: provider.type,
      status: credentialsReady ? "planned" : "blocked-credentials",
      reason: credentialsReady ? null : "provider-credentials-unavailable",
      destination: provider.destination ?? null,
      destinations: {
        preview: provider.previewDestination ?? null,
        production: provider.productionDestination ?? null,
      },
      build: reuse
        ? { action: "reuse", provenance: { artifactId: buildArtifact.id, hash: buildArtifact.hash, revision } }
        : { action: provider.acceptsBuildArtifact === true ? "build" : "provider-rebuild", provenance: { revision, providerForcedRebuild: provider.acceptsBuildArtifact !== true } },
    };
  });

  const dataOperations = Array.isArray(input.dataOperations) ? input.dataOperations.filter(isRecord) : [];
  for (const operation of dataOperations) {
    const id = String(operation.id ?? "data-operation");
    if (operation.dryRun !== true) errors.push(`${id} requires a successful dry run`);
    if (!Number.isSafeInteger(operation.order) || Number(operation.order) < 1) errors.push(`${id} requires an explicit positive order`);
    if (typeof operation.rollback !== "string" || !operation.rollback.trim()) errors.push(`${id} requires a rollback plan`);
    if (operation.risk === "high" && operation.authorized !== true) errors.push(`${id} requires separate high-risk authorization`);
  }
  const dataBlocked = dataOperations.length > 0 && errors.some((error) => dataOperations.some((operation) => error.startsWith(String(operation.id ?? "data-operation"))));
  const results = isRecord(input.results) ? input.results : {};
  const timings = isRecord(results.timings) ? results.timings : {};
  const relevantProviders = providers.filter((provider) => provider.status !== "skipped-unaffected");
  const providerBlocked = relevantProviders.some((provider) => provider.status === "blocked-credentials");
  const phases = phaseIds.map((id) => {
    let status = "planned";
    let reason = null;
    if (id === "changed-validation" && selected.length === 0) {
      status = "skipped";
      reason = "no-applicable-check";
    } else if (id === "preview" && relevantProviders.length === 0) {
      status = "skipped";
      reason = "no-deploy-contract";
    } else if (id === "preview" && providerBlocked) {
      status = "partially-blocked";
      reason = "one-or-more-provider-lanes-blocked";
    } else if (id === "data-operations" && dataOperations.length === 0) {
      status = "skipped";
      reason = "no-data-operation";
    } else if (id === "data-operations" && dataBlocked) {
      status = "blocked";
      reason = "data-safety-contract-incomplete";
    } else if (id === "promotion") {
      status = "awaiting-authorization";
      reason = "promotion-is-operation-specific";
    } else if (id === "production-smoke" && relevantProviders.length === 0) {
      status = "skipped";
      reason = "no-deploy-contract";
    }
    return { id, status, reason, duration: duration(timings[id]) };
  });

  const providerResults = isRecord(results.providers) ? results.providers : {};
  const relevantProviderIds = relevantProviders.map((provider) => String(provider.id ?? "")).filter(Boolean);
  const providersById = new Map(relevantProviders.map((provider) => [String(provider.id ?? ""), provider]));
  const exactEvidence = (/** @type {string} */ stage) => errors.length === 0
    && relevantProviderIds.length > 0
    && relevantProviderIds.every((id) => {
    const entry = isRecord(providerResults[id]) ? providerResults[id] : {};
    const evidence = isRecord(entry[stage]) ? entry[stage] : {};
    const provider = providersById.get(id);
    /** @type {Record<string, unknown>} */
    const destinations = isRecord(provider?.destinations) ? provider.destinations : {};
    const expectedDestination = stage === "preview" ? destinations["preview"] : destinations["production"];
    return evidence.revision === revision
      && evidence.providerEvidence === true
      && typeof expectedDestination === "string"
      && expectedDestination.trim()
      && typeof evidence.destination === "string"
      && evidence.destination === expectedDestination
      && (stage !== "smoke" || evidence.ok === true);
  });
  const preview = exactEvidence("preview") ? "proven" : "unproven";
  const production = exactEvidence("production") ? "proven" : "unproven";
  const smoke = production === "proven" && exactEvidence("smoke") ? "proven" : "unproven";
  const rollbackInput = isRecord(input.rollback) ? input.rollback : {};
  const rollbackProven = typeof rollbackInput.handle === "string" && rollbackInput.handle.trim() && rollbackInput.revision === revision;

  return {
    schemaVersion: 1,
    operation: "release-train-v2",
    valid: errors.length === 0,
    errors,
    revision,
    changedSurfaces,
    checks: { selected, skipped: skippedChecks },
    providers,
    dataOperations: dataOperations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      order: operation.order,
      dryRun: operation.dryRun === true,
      rollback: operation.rollback ?? null,
      authorization: operation.risk === "high" ? operation.authorized === true ? "authorized" : "missing" : "not-required",
    })),
    phases,
    sharedEvidence: { status: "planned", selectedCheckCount: selected.length },
    outcome: { git: results.git ?? "unproven", preview, production, smoke },
    rollback: rollbackProven
      ? { status: "proven", handle: rollbackInput.handle, revision }
      : { status: "unproven", handle: null, revision: null },
    nextAction: errors.length > 0
      ? "Resolve the data or input contract errors"
      : providerBlocked
        ? "Continue healthy provider lanes and repair only blocked credentials"
        : "Run the selected phases and attach exact provider evidence",
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
