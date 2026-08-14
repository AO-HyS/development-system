// @ts-check

export const primaryRepositoryAllowlist = Object.freeze([
  { id: "aohys", repository: "AO-HyS/aohys.com", name: "AO HyS" },
  { id: "casa-roca", repository: "corrortiz/casa-roca", name: "Casa Roca" },
  { id: "the-barber-central", repository: "AO-HyS/the-barber-central", name: "The Barber Central" },
  { id: "nutri-plan", repository: "AO-HyS/nutri-plan", name: "NutriPlan" },
  { id: "eteria", repository: "AO-HyS/eteria", name: "ETERIA" },
]);

const allowedIds = new Set(primaryRepositoryAllowlist.map((repository) => repository.id));
const reviewedAreas = Object.freeze([
  "skills", "codex-security", "react", "tanstack", "shadcn", "convex",
  "cloudflare", "expo-mobile", "posthog", "release-train",
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getDevelopmentStewardSchedule() {
  return {
    schemaVersion: 1,
    operation: "development-steward-schedule",
    cadence: "weekly",
    runner: "macos-launchd-codex-exec",
    localTime: { weekday: "monday", hour: 9, minute: 0 },
    activation: "development-steward-schedule-enable",
    audit: "development-steward-schedule-audit",
    disable: "development-steward-schedule-disable",
    sessionRequired: false,
    repositoryIds: primaryRepositoryAllowlist.map((repository) => repository.id),
    reviewedAreas: [...reviewedAreas],
    output: "private-report-for-check-in",
    autoMerge: false,
    productionAuthorized: false,
  };
}

/** @param {Record<string, unknown>} item */
function normalizeUpstream(item) {
  const current = text(item.current);
  const candidate = text(item.candidate);
  const diff = text(item.diff);
  const changelog = text(item.changelog);
  const reviewable = Boolean(current && candidate && current !== candidate && diff && changelog);
  return {
    id: text(item.id) ?? "unknown-upstream",
    current,
    candidate,
    diff,
    changelog,
    stars: typeof item.stars === "number" && Number.isFinite(item.stars) ? item.stars : null,
    status: reviewable ? "reviewable" : "unproven",
    reason: reviewable ? null : "exact-current-candidate-diff-and-changelog-required",
  };
}

/**
 * Reconcile one scheduled, read-only Development Steward run.
 * Collection adapters provide evidence; this core never contacts or mutates a repository.
 * @param {unknown} input
 */
export function buildDevelopmentStewardReview(input) {
  const value = isRecord(input) ? input : {};
  /** @type {string[]} */
  const errors = [];
  const observedAt = text(value.observedAt);
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) errors.push("observedAt must be a deterministic timestamp");
  const supplied = Array.isArray(value.repositories) ? value.repositories.filter(isRecord) : [];
  for (const repository of supplied) {
    const id = text(repository.id) ?? "unknown";
    if (!allowedIds.has(id)) errors.push(`repository not allowlisted: ${id}`);
  }
  const byId = new Map(supplied.filter((repository) => allowedIds.has(text(repository.id) ?? "")).map((repository) => [text(repository.id), repository]));
  const repositories = primaryRepositoryAllowlist.map((allowlisted) => {
    const repository = byId.get(allowlisted.id);
    if (!repository) return {
      ...allowlisted,
      status: "unproven",
      revision: null,
      error: "repository-evidence-missing",
      upstream: [],
      evaluations: [],
    };
    const revision = text(repository.revision);
    const localError = text(repository.error);
    const verifiedRevision = revision && /^[a-f0-9]{40}$/i.test(revision) ? revision : null;
    const evaluations = Array.isArray(repository.evaluations) ? repository.evaluations.filter(isRecord).map((evaluation) => ({
      id: text(evaluation.id) ?? "unknown-evaluation",
      area: text(evaluation.area) ?? "unknown",
      state: text(evaluation.state) ?? "unproven",
      summary: text(evaluation.summary) ?? "Evidence missing.",
      deterministic: evaluation.deterministic === true,
      safeUpdate: evaluation.safeUpdate === true,
      focusedChecks: Array.isArray(evaluation.focusedChecks) ? evaluation.focusedChecks.filter((check) => typeof check === "string" && check.trim()) : [],
      device: evaluation.device === "mobile" ? "mobile" : "computer",
    })) : [];
    const upstream = Array.isArray(repository.upstream) ? repository.upstream.filter(isRecord).map(normalizeUpstream) : [];
    const needsAction = evaluations.some((evaluation) => evaluation.state === "action-needed") || upstream.some((item) => item.status === "reviewable");
    return {
      ...allowlisted,
      revision: verifiedRevision,
      status: localError || repository.status === "blocked"
        ? "blocked-local"
        : verifiedRevision === null
          ? "unproven"
          : needsAction
            ? "action-needed"
            : "healthy",
      error: localError ?? (verifiedRevision === null ? "repository-revision-unproven" : null),
      upstream,
      evaluations,
    };
  });

  const reportItems = repositories.flatMap((repository) => {
    if (repository.status === "blocked-local") return [{ repositoryId: repository.id, title: `${repository.name}: collection blocked`, detail: repository.error ?? "Unknown local blocker.", device: "computer", state: "blocked" }];
    if (repository.status === "unproven") return [{ repositoryId: repository.id, title: `${repository.name}: evidence unproven`, detail: repository.error ?? "Repository freshness evidence is missing.", device: "computer", state: "unproven" }];
    const evaluationItems = repository.evaluations.filter((evaluation) => evaluation.state === "action-needed").map((evaluation) => ({
      repositoryId: repository.id,
      title: `${repository.name}: ${evaluation.id}`,
      detail: evaluation.summary,
      device: evaluation.device,
      state: "action-needed",
    }));
    const upstreamItems = repository.upstream.filter((item) => item.status === "reviewable").map((item) => ({
      repositoryId: repository.id,
      title: `${repository.name}: review ${item.id} ${item.current} → ${item.candidate}`,
      detail: `Pinned diff: ${item.diff}. Changelog: ${item.changelog}`,
      device: "computer",
      state: "action-needed",
    }));
    return [...evaluationItems, ...upstreamItems];
  }).slice(0, 5);
  const draftChanges = repositories.flatMap((repository) => repository.evaluations
    .filter((evaluation) => evaluation.state === "action-needed" && evaluation.deterministic && evaluation.safeUpdate && evaluation.focusedChecks.length > 0)
    .map((evaluation) => ({
      repositoryId: repository.id,
      evaluationId: evaluation.id,
      action: "prepare-branch-and-draft-pr",
      focusedChecks: evaluation.focusedChecks,
      autoMerge: false,
      releaseAuthorized: false,
      productionAuthorized: false,
    })));
  const checkInEvidence = reportItems.map((item, index) => ({
    id: `development-steward:${item.repositoryId}:${index + 1}`,
    source: "repository",
    repository: item.repositoryId,
    observedAt,
    subject: item.title,
    claim: "human-action",
    state: item.state,
    requiresHuman: true,
    providerEvidence: false,
    action: { title: item.title, reason: item.detail, capability: item.device, minutes: item.device === "mobile" ? 5 : 15 },
  }));

  return {
    schemaVersion: 1,
    contractVersion: "1.5.0",
    operation: "development-steward",
    valid: errors.length === 0,
    errors,
    observedAt,
    schedule: getDevelopmentStewardSchedule(),
    repositories,
    report: {
      visibility: "private-home",
      title: "Development Steward weekly review",
      summary: reportItems.length === 0 ? "No primary repository needs proven human action." : `${reportItems.length} bounded items need attention.`,
      items: reportItems,
    },
    checkInEvidence,
    draftChanges,
    authorization: { draftPreparationOnly: true, mergeGranted: false, releaseGranted: false, productionGranted: false },
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
