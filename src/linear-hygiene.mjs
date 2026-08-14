// @ts-check

const openStatuses = new Set(["backlog", "open", "todo", "ready", "in progress", "in-progress", "in review", "review", "started"]);
const completedEvidenceStates = new Set(["merged", "deployed", "healthy", "smoke-passed", "released", "completed"]);
const evidenceSources = new Set(["repository", "pull-request", "deploy", "runtime"]);
const capabilities = new Set(["mobile", "computer", "local-device", "promotion-authorization"]);

export const LINEAR_PRODUCT_MAP = Object.freeze({
  aohys: Object.freeze({
    product: "AO HyS",
    team: "Aohys",
    project: "AOHYS Dashboard 100/100",
    linearKey: "AOH",
    identifierPrefix: "AO",
    titlePrefix: "[AO HyS]",
    repository: "AO-HyS/aohys.com",
  }),
  "casa-roca": Object.freeze({
    product: "Casa Roca",
    team: "Aohys",
    project: "Casa Roca",
    linearKey: "AOH",
    identifierPrefix: "CR",
    titlePrefix: "[Casa Roca]",
    repository: "corrortiz/casa-roca",
  }),
  "the-barber-central": Object.freeze({
    product: "The Barber Central",
    team: "Aohys",
    project: "The Barber Central",
    linearKey: "AOH",
    identifierPrefix: "TBC",
    titlePrefix: "[The Barber Central]",
    repository: "AO-HyS/the-barber-central",
  }),
  nutriplan: Object.freeze({
    product: "NutriPlan",
    team: "Aohys",
    project: "NutriPlan Digital",
    linearKey: "AOH",
    identifierPrefix: "NP",
    titlePrefix: "[NutriPlan]",
    repository: "AO-HyS/nutri-plan",
  }),
  eteria: Object.freeze({
    product: "ETERIA",
    team: "Aohys",
    project: "ETERIA",
    linearKey: "AOH",
    identifierPrefix: "ET",
    titlePrefix: "[ETERIA]",
    repository: "AO-HyS/eteria",
  }),
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** @param {unknown} value */
function instant(value) {
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} value */
function normalized(value) {
  return (text(value) ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** @typedef {keyof typeof LINEAR_PRODUCT_MAP} ProductId */

/** @param {unknown} value @returns {ProductId | null} */
function productId(value) {
  const candidate = text(value);
  if (candidate && Object.hasOwn(LINEAR_PRODUCT_MAP, candidate)) return /** @type {ProductId} */ (candidate);
  const semantic = normalized(value);
  const found = /** @type {ProductId | undefined} */ (Object.entries(LINEAR_PRODUCT_MAP)
    .find(([, mapping]) => normalized(mapping.product) === semantic || normalized(mapping.project) === semantic)?.[0]);
  return found ?? null;
}

/** @param {unknown} repository @returns {ProductId | null} */
function productFromRepository(repository) {
  const candidate = normalized(repository).replace(/\.git$/u, "");
  const found = /** @type {ProductId | undefined} */ (Object.entries(LINEAR_PRODUCT_MAP)
    .find(([, mapping]) => normalized(mapping.repository) === candidate)?.[0]);
  return found ?? null;
}

/** @param {Record<string, unknown>} issue @param {Record<string, unknown>[]} issueEvidence */
function targetProduct(issue, issueEvidence) {
  for (const candidate of [issue.repository, ...issueEvidence.map((item) => item.repository)]) {
    const inferred = productFromRepository(candidate);
    if (inferred) return inferred;
  }
  return productId(issue.product) ?? productId(issue.project);
}

/** @param {string} title @param {(typeof LINEAR_PRODUCT_MAP)[ProductId]} mapping */
function titled(title, mapping) {
  const base = title.replace(/^\[[^\]]+\]\s*/u, "").trim() || "Untitled work";
  return `${mapping.titlePrefix} ${base}`;
}

/** @param {Record<string, unknown>} issue @param {(typeof LINEAR_PRODUCT_MAP)[ProductId]} mapping */
function projectedIssue(issue, mapping) {
  const key = text(issue.key);
  return {
    team: mapping.team,
    project: mapping.project,
    product: mapping.product,
    repository: mapping.repository,
    title: titled(text(issue.title) ?? "Untitled work", mapping),
    displayIdentifier: `${mapping.identifierPrefix}/${key ?? "NEW"}`,
  };
}

/** @param {Record<string, unknown>} issue */
function beforeIssue(issue) {
  return {
    team: text(issue.team),
    project: text(issue.project),
    product: text(issue.product),
    repository: text(issue.repository),
    title: text(issue.title),
    status: text(issue.status),
    displayIdentifier: text(issue.displayIdentifier),
  };
}

/** @param {Record<string, unknown>} issue */
function rollbackDelete(issue) {
  const handle = text(issue.deletionExport);
  return handle
    ? { supported: true, operation: "restore-from-export", handle }
    : { supported: false, operation: null, reason: "Linear deletion has no platform restore handle; export before applying." };
}

/**
 * Audit caller-supplied Linear and delivery evidence and return a deterministic
 * cleanup preview. This function performs no collection, provider call, or
 * external mutation.
 * @param {Record<string, unknown>} input
 */
export function buildLinearHygienePlan(input) {
  const now = text(input.now);
  const nowMs = instant(now);
  const staleAfterDays = typeof input.staleAfterDays === "number" && Number.isFinite(input.staleAfterDays) && input.staleAfterDays >= 0
    ? input.staleAfterDays
    : 45;
  const errors = [];
  if (nowMs === null) errors.push("now must be a valid deterministic timestamp");
  if (!Array.isArray(input.issues)) errors.push("issues must be an array");
  if (!Array.isArray(input.evidence)) errors.push("evidence must be an array");
  const issues = (Array.isArray(input.issues) ? input.issues : []).filter(isRecord);
  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).filter(isRecord);
  const evidenceComplete = input.evidenceComplete === true;

  /** @type {Map<string, Record<string, unknown>[]>} */
  const evidenceByWork = new Map();
  for (const item of evidence) {
    const workId = text(item.workId);
    if (!workId) continue;
    evidenceByWork.set(workId, [...(evidenceByWork.get(workId) ?? []), item]);
  }
  /** @type {Map<string, Record<string, unknown>[]>} */
  const issuesByWork = new Map();
  for (const issue of issues) {
    const workId = text(issue.workId);
    if (!workId) continue;
    issuesByWork.set(workId, [...(issuesByWork.get(workId) ?? []), issue]);
  }

  const issueAudits = issues.map((issue) => {
    const id = text(issue.id) ?? text(issue.key) ?? "unidentified-issue";
    const workId = text(issue.workId);
    const matchingEvidence = workId ? evidenceByWork.get(workId) ?? [] : [];
    const target = targetProduct(issue, matchingEvidence);
    if (!target) errors.push(`cannot infer product for issue ${id}`);
    const mapping = target ? LINEAR_PRODUCT_MAP[target] : null;
    const siblings = workId ? issuesByWork.get(workId) ?? [] : [];
    const canonicalCandidates = siblings.filter((item) => item.canonical === true);
    const canonical = canonicalCandidates.length === 1 ? canonicalCandidates[0] : null;
    const canonicalId = canonical ? text(canonical.id) ?? text(canonical.key) : null;
    const duplicateProven = evidenceComplete
      && canonicalId !== null
      && issue !== canonical
      && text(issue.duplicateOf) === canonicalId;
    const stale = openStatuses.has(normalized(issue.status))
      && evidenceComplete
      && matchingEvidence.length === 0
      && nowMs !== null
      && instant(issue.updatedAt) !== null
      && (nowMs - /** @type {number} */ (instant(issue.updatedAt))) / 86_400_000 > staleAfterDays;
    const completedOutside = openStatuses.has(normalized(issue.status))
      && matchingEvidence.some((item) => evidenceSources.has(text(item.source) ?? "") && completedEvidenceStates.has(normalized(item.state)));
    const kinds = [];
    if (issue.authenticity === "fake") kinds.push("fake");
    if (duplicateProven) kinds.push("duplicate");
    else if (siblings.length > 1 && issue !== canonical) kinds.push("duplicate-unproven");
    if (stale) kinds.push("stale");
    const stalenessUnproven = !evidenceComplete
      && openStatuses.has(normalized(issue.status))
      && matchingEvidence.length === 0
      && nowMs !== null
      && instant(issue.updatedAt) !== null
      && (nowMs - /** @type {number} */ (instant(issue.updatedAt))) / 86_400_000 > staleAfterDays;
    if (stalenessUnproven) kinds.push("staleness-unproven");
    if (completedOutside) kinds.push("completed-outside-tracker");
    if (!text(issue.project) || !workId) kinds.push("orphan");
    if (mapping && ((text(issue.team) !== null && text(issue.team) !== mapping.team)
      || (text(issue.project) !== null && text(issue.project) !== mapping.project)
      || (text(issue.product) !== null && productId(issue.product) !== target))) kinds.push("wrong-product");
    if (mapping && text(issue.title) !== titled(text(issue.title) ?? "Untitled work", mapping)) kinds.push("ambiguous-name");
    return { issue, id, workId, matchingEvidence, target, mapping, kinds };
  });

  const findings = issueAudits
    .filter((audit) => audit.kinds.length > 0)
    .map((audit) => ({ issueId: audit.id, key: text(audit.issue.key), workId: audit.workId, kinds: audit.kinds }));

  /** @typedef {{operation: "create" | "update" | "move" | "close" | "delete", issueId: string | null, workId: string | null, reason: string, evidenceIds?: (string | null)[], diff: {before: Record<string, unknown> | null, after: Record<string, unknown> | null}, rollback: Record<string, unknown>}} CleanupChange */
  /** @type {CleanupChange[]} */
  const cleanupPreview = [];
  for (const audit of issueAudits) {
    const before = beforeIssue(audit.issue);
    const deleteRollback = rollbackDelete(audit.issue);
    if (evidenceComplete
      && deleteRollback.supported === true
      && (audit.kinds.includes("fake") || audit.kinds.includes("duplicate") || audit.kinds.includes("stale"))) {
      const kind = audit.kinds.find((candidate) => ["fake", "duplicate", "stale"].includes(candidate)) ?? "invalid";
      cleanupPreview.push({
        operation: "delete",
        issueId: audit.id,
        workId: audit.workId,
        reason: `${kind} Linear item should be removed instead of retained as deprecated clutter.`,
        diff: { before, after: null },
        rollback: deleteRollback,
      });
      continue;
    }
    if (!audit.mapping) continue;
    const projected = projectedIssue(audit.issue, audit.mapping);
    if (audit.kinds.includes("wrong-product") || audit.kinds.includes("orphan")) {
      cleanupPreview.push({
        operation: "move",
        issueId: audit.id,
        workId: audit.workId,
        reason: "Repository evidence maps this work to a different or missing product project.",
        diff: { before, after: { ...before, ...projected } },
        rollback: { supported: true, operation: "move-back", fields: before },
      });
    } else if (audit.kinds.includes("completed-outside-tracker")) {
      cleanupPreview.push({
        operation: "close",
        issueId: audit.id,
        workId: audit.workId,
        reason: "Git, pull-request, deploy, or runtime evidence shows completion while Linear remains open.",
        evidenceIds: audit.matchingEvidence.map((item) => text(item.id)).filter(Boolean),
        diff: { before, after: { ...before, status: "Completed", ...projected } },
        rollback: { supported: true, operation: "reopen", status: before.status },
      });
    } else if (audit.kinds.includes("ambiguous-name")) {
      cleanupPreview.push({
        operation: "update",
        issueId: audit.id,
        workId: audit.workId,
        reason: "The shared AOH key needs a product-visible title and display identifier.",
        diff: { before, after: { ...before, title: projected.title, displayIdentifier: projected.displayIdentifier } },
        rollback: { supported: true, operation: "restore-fields", fields: { title: before.title, displayIdentifier: before.displayIdentifier } },
      });
    }
  }

  const trackedWork = new Set(issues.map((issue) => text(issue.workId)).filter(Boolean));
  for (const item of evidence) {
    const workId = text(item.workId);
    if (!workId || trackedWork.has(workId) || item.trackable !== true) continue;
    const target = productFromRepository(item.repository) ?? productId(item.product);
    if (!target) {
      errors.push(`cannot infer product for untracked work ${workId}`);
      continue;
    }
    const mapping = LINEAR_PRODUCT_MAP[target];
    const after = {
      team: mapping.team,
      project: mapping.project,
      product: mapping.product,
      repository: mapping.repository,
      title: titled(text(item.title) ?? workId, mapping),
      displayIdentifier: `${mapping.identifierPrefix}/NEW`,
      status: completedEvidenceStates.has(normalized(item.state)) ? "Completed" : "Todo",
    };
    cleanupPreview.push({
      operation: "create",
      issueId: null,
      workId,
      reason: "Verified trackable work has no corresponding Linear issue.",
      evidenceIds: [text(item.id)].filter(Boolean),
      diff: { before: null, after },
      rollback: { supported: true, operation: "delete-created-issue" },
    });
  }

  const operationOrder = new Map(["delete", "move", "close", "update", "create"].map((operation, index) => [operation, index]));
  cleanupPreview.sort((left, right) => (operationOrder.get(left.operation) ?? 99) - (operationOrder.get(right.operation) ?? 99)
    || (left.issueId ?? left.workId ?? "").localeCompare(right.issueId ?? right.workId ?? ""));
  const deletedIds = new Set(cleanupPreview.filter((change) => change.operation === "delete").map((change) => change.issueId));
  const cleanView = issueAudits
    .filter((audit) => audit.mapping
      && !deletedIds.has(audit.id)
      && !audit.kinds.includes("fake")
      && !audit.kinds.includes("duplicate"))
    .map((audit) => ({
      issueId: audit.id,
      workId: audit.workId,
      key: text(audit.issue.key),
      ...projectedIssue(audit.issue, /** @type {(typeof LINEAR_PRODUCT_MAP)[ProductId]} */ (audit.mapping)),
      status: audit.kinds.includes("completed-outside-tracker") ? "Completed" : text(audit.issue.status),
      url: text(audit.issue.url),
    }));
  const checkInEvidence = issueAudits.flatMap((audit) => {
    if (!audit.mapping
      || deletedIds.has(audit.id)
      || audit.kinds.includes("fake")
      || audit.kinds.includes("duplicate")
      || !isRecord(audit.issue.humanAction)) return [];
    const action = audit.issue.humanAction;
    const capability = text(action.capability);
    if (!text(action.title) || !text(action.reason) || !capability || !capabilities.has(capability)) return [];
    return [{
      id: `linear-hygiene:${audit.id}`,
      repository: audit.mapping.repository,
      source: "linear",
      subject: audit.workId ?? audit.id,
      claim: "workflow-state",
      state: audit.kinds.includes("completed-outside-tracker") ? "completed" : text(audit.issue.status),
      observedAt: text(audit.issue.updatedAt),
      url: text(audit.issue.url),
      requiresHuman: true,
      providerEvidence: false,
      action: {
        title: text(action.title),
        reason: text(action.reason),
        capability,
        minutes: typeof action.minutes === "number" && Number.isFinite(action.minutes) ? action.minutes : null,
        priority: typeof action.priority === "number" && Number.isFinite(action.priority) ? action.priority : 0,
        open: text(action.open) ?? text(audit.issue.url),
      },
    }];
  });

  return {
    schemaVersion: 1,
    operation: "linear-hygiene-audit",
    valid: errors.length === 0,
    errors,
    asOf: now,
    productMap: LINEAR_PRODUCT_MAP,
    findings,
    cleanupPreview,
    cleanView,
    checkInEvidence,
    reconciliation: {
      sources: [...evidenceSources],
      runtimeEvidenceUsed: evidence.some((item) => text(item.source) === "runtime"),
      productionClaims: 0,
      productionCalls: 0,
      canonicalCodeSource: "git",
      canonicalProductionSource: "provider-runtime-evidence",
      linearRole: "operational-tracker",
      evidenceCollectionComplete: evidenceComplete,
    },
    readOnly: true,
    externalWriteIntents: [],
    externalSideEffects: [],
    authorization: { linearMutationGranted: false, destructiveCleanupGranted: false },
  };
}
