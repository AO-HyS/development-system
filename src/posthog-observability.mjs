// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

/** @param {unknown} value @returns {Record<string, unknown>[]} */
function records(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** @param {string} code @param {"critical" | "high" | "medium"} severity @param {string} title @param {string} action @param {string[]} [evidenceIds] */
function finding(code, severity, title, action, evidenceIds = []) {
  return { code, severity, title, action, evidenceIds: [...new Set(evidenceIds)].sort() };
}

/** @param {string} value */
function sharedEvidenceId(value) {
  return /^[A-Za-z0-9._:-]{1,120}$/.test(value) ? value : "redacted-evidence-id";
}

/**
 * Classify an already-collected observation. Raw properties and replay links
 * are deliberately excluded from the returned evidence model.
 * @param {Record<string, unknown>} observation
 * @param {Set<string>} productionEnvironments
 * @param {Set<string>} canonicalHosts
 * @param {string | null} release
 */
function classifyObservation(observation, productionEnvironments, canonicalHosts, release) {
  const id = text(observation.id) ?? "unidentified-observation";
  const environment = text(observation.environment);
  const host = text(observation.host);
  const observedRelease = text(observation.release);
  const actorType = text(observation.actorType);
  const kind = text(observation.kind);

  let classification = "eligible-production-signal";
  if (actorType === "bot") classification = "bot-traffic";
  else if (actorType === "validation") classification = "expected-validation";
  else if (!environment || !productionEnvironments.has(environment)) classification = "preview-contamination";
  else if (!host || !canonicalHosts.has(host)) classification = "noncanonical-host";
  else if (release && observedRelease !== release) classification = "release-mismatch";
  else if (kind === "exception") classification = "production-error";

  return {
    id,
    classification,
    kind,
    environment,
    host,
    release: observedRelease,
    event: text(observation.event),
    metric: text(observation.metric),
  };
}

/** @param {Record<string, unknown>} error */
function automationDecision(error) {
  const id = text(error.id) ?? "unidentified-error";
  const reproduction = isRecord(error.reproduction) ? error.reproduction : {};
  const rootCause = isRecord(error.rootCause) ? error.rootCause : {};
  const regressionTest = isRecord(error.regressionTest) ? error.regressionTest : {};
  const revision = text(reproduction.revision);
  const steps = strings(reproduction.steps);
  const module = text(rootCause.module);
  const explanation = text(rootCause.explanation);
  const regressionTestPath = text(regressionTest.path);
  const fingerprint = text(error.fingerprint);
  const observationId = text(error.observationId);
  const eligible = reproduction.status === "passed"
    && fingerprint !== null
    && observationId !== null
    && /^[a-f0-9]{40}$/i.test(revision ?? "")
    && steps.length > 0
    && rootCause.status === "bounded"
    && module !== null
    && explanation !== null
    && regressionTest.status === "passed"
    && regressionTestPath !== null;

  return {
    id,
    fingerprint,
    decision: eligible ? "prepare-draft-fix" : "investigate",
    reason: eligible
      ? "deterministic-reproduction-bounded-root-cause-and-regression-test"
      : "automation-evidence-incomplete-or-ambiguous",
    evidencePacket: eligible ? {
      fingerprint,
      observationId,
      revision,
      reproductionSteps: steps,
      rootCause: { module, explanation },
      regressionTestPath,
    } : null,
    draftCreated: false,
  };
}

/** @param {ReturnType<typeof finding>} item @param {Record<string, unknown>[]} routes */
function alertFor(item, routes) {
  const route = routes.find((candidate) => strings(candidate.findingCodes).includes(item.code));
  const owner = route ? text(route.owner) : null;
  const destination = route ? text(route.destination) : null;
  const runbook = route ? text(route.runbook) : null;
  const threshold = route ? text(route.threshold) : null;
  const actionable = owner !== null && destination !== null && runbook !== null && threshold !== null;
  return {
    findingCode: item.code,
    status: actionable ? "routed" : "unproven",
    routeId: actionable ? text(route?.id) : null,
    owner: actionable ? owner : null,
    destination: actionable ? destination : null,
    runbook: actionable ? runbook : null,
    threshold: actionable ? threshold : null,
  };
}

/**
 * Audit supplied PostHog configuration and observations without contacting
 * PostHog, a repository, or any external provider.
 * @param {Record<string, unknown>} input
 */
export function auditPostHogObservability(input) {
  /** @type {string[]} */
  const errors = [];
  const repository = text(input.repository);
  const now = text(input.now);
  if (!repository) errors.push("repository is required");
  if (!now || !Number.isFinite(Date.parse(now))) errors.push("now must be a deterministic timestamp");

  const policy = isRecord(input.policy) ? input.policy : {};
  const instrumentation = isRecord(input.instrumentation) ? input.instrumentation : {};
  const productionEnvironments = new Set(strings(policy.productionEnvironments));
  const canonicalHosts = new Set(strings(policy.canonicalHosts));
  const requiredConversions = strings(policy.conversionEvents);
  const requiredWebVitals = strings(policy.requiredWebVitals);
  const requiredParity = strings(policy.parityCapabilities);
  const minimumEligibleEvents = typeof policy.minimumEligibleEvents === "number"
    && Number.isInteger(policy.minimumEligibleEvents)
    && policy.minimumEligibleEvents >= 0
    ? policy.minimumEligibleEvents
    : 1;
  if (productionEnvironments.size === 0) errors.push("policy.productionEnvironments is required");
  if (canonicalHosts.size === 0) errors.push("policy.canonicalHosts is required");

  /** @type {ReturnType<typeof finding>[]} */
  const findings = [];
  const enabledEnvironments = strings(instrumentation.enabledEnvironments);
  const unexpectedEnvironments = enabledEnvironments.filter((environment) => !productionEnvironments.has(environment));
  if (unexpectedEnvironments.length > 0) {
    findings.push(finding("instrumentation-not-production-only", "high", "Instrumentation is enabled outside production", "Disable capture for non-production environments."));
  }
  const configuredHosts = strings(instrumentation.canonicalHosts);
  if (configuredHosts.length === 0 || configuredHosts.some((host) => !canonicalHosts.has(host))) {
    findings.push(finding("canonical-host-contract-missing", "high", "Canonical host filtering is incomplete", "Restrict production capture to the declared canonical hosts."));
  }
  const identity = isRecord(instrumentation.identity) ? instrumentation.identity : {};
  if (identity.anonymous !== true || identity.authenticated !== true) {
    findings.push(finding("identity-incomplete", "high", "Anonymous and authenticated identity continuity is not proven", "Provide explicit anonymous and authenticated identity evidence."));
  }
  const probe = isRecord(instrumentation.probe) ? instrumentation.probe : {};
  if (probe.status === "failed") {
    findings.push(finding("instrumentation-broken", "critical", "The explicit instrumentation probe failed", "Repair the production capture path and rerun the same deterministic probe."));
  }
  const configuredConversions = strings(instrumentation.conversionEvents);
  const missingConversions = requiredConversions.filter((event) => !configuredConversions.includes(event));
  if (missingConversions.length > 0) {
    findings.push(finding("conversion-event-missing", "high", "Required conversion events are not configured", `Configure the missing conversion events: ${missingConversions.join(", ")}.`));
  }
  if (instrumentation.exceptionCapture !== true) {
    findings.push(finding("exception-capture-missing", "critical", "Production exception capture is not proven", "Enable privacy-reviewed production exception capture."));
  }

  const release = text(instrumentation.release);
  if (!release) findings.push(finding("release-identity-missing", "high", "Release identity is not configured", "Bind events and exceptions to an immutable release identity."));
  const sourceMaps = records(instrumentation.sourceMaps);
  if (release && !sourceMaps.some((sourceMap) => sourceMap.release === release && sourceMap.status === "uploaded")) {
    findings.push(finding("source-map-missing", "high", "The active release has no proven source map", "Upload and verify the source map for the exact active release."));
  }
  const configuredVitals = strings(instrumentation.webVitals);
  const missingVitals = requiredWebVitals.filter((metric) => !configuredVitals.includes(metric));
  if (missingVitals.length > 0) {
    findings.push(finding("web-vitals-missing", "medium", "Required Web Vitals are not configured", `Capture the missing metrics: ${missingVitals.join(", ")}.`));
  }
  const replay = isRecord(instrumentation.replay) ? instrumentation.replay : {};
  const sensitiveProperties = new Set(["email", "name", "phone", "address", "token", "authorization", "password"]);
  const exposedProperties = strings(replay.capturedProperties).filter((property) => sensitiveProperties.has(property.toLowerCase()));
  if (replay.enabled === true && (replay.maskAllText !== true || replay.blockAllMedia !== true || exposedProperties.length > 0)) {
    findings.push(finding("replay-privacy-unsafe", "critical", "Session replay privacy controls are incomplete", "Mask text, block media, and remove sensitive event properties before enabling replay."));
  }

  const observationClassifications = records(input.observations)
    .map((observation) => classifyObservation(observation, productionEnvironments, canonicalHosts, release));
  const evidenceIds = (/** @type {string} */ classification) => observationClassifications
    .filter((item) => item.classification === classification)
    .map((item) => item.id);
  const productionErrorIds = records(input.observations)
    .filter((observation) => observation.kind === "exception"
      && observation.actorType !== "bot"
      && observation.actorType !== "validation"
      && typeof observation.environment === "string"
      && productionEnvironments.has(observation.environment)
      && typeof observation.host === "string"
      && canonicalHosts.has(observation.host))
    .map((observation) => text(observation.id) ?? "unidentified-observation");
  if (evidenceIds("preview-contamination").length > 0) {
    findings.push(finding("preview-contamination", "high", "Non-production traffic reached the production project", "Separate preview keys or disable capture outside production.", evidenceIds("preview-contamination")));
  }
  if (evidenceIds("noncanonical-host").length > 0) {
    findings.push(finding("noncanonical-host-traffic", "high", "Production signals arrived from a noncanonical host", "Verify host filtering before treating the traffic as product evidence.", evidenceIds("noncanonical-host")));
  }
  if (evidenceIds("release-mismatch").length > 0) {
    findings.push(finding("release-mismatch", "high", "Observed signals do not match the configured release", "Align runtime release identity and uploaded source maps.", evidenceIds("release-mismatch")));
  }
  if (productionErrorIds.length > 0) {
    findings.push(finding("production-error", "critical", "A real production exception was observed", "Route the fingerprint with the minimum reproduction packet.", productionErrorIds));
  }

  const signalCounts = {
    eligible: evidenceIds("eligible-production-signal").length + productionErrorIds.length,
    bots: evidenceIds("bot-traffic").length,
    expectedValidation: evidenceIds("expected-validation").length,
    productionErrors: productionErrorIds.length,
  };
  const investigations = signalCounts.eligible < minimumEligibleEvents
    ? [{ code: "insufficient-sample", decision: "investigate", observedEligibleEvents: signalCounts.eligible, requiredEligibleEvents: minimumEligibleEvents, inference: "instrumentation-health-unproven" }]
    : [];

  const alertRoutes = records(input.alertRoutes);
  const alerts = findings.map((item) => alertFor(item, alertRoutes));
  const automation = records(input.errors).map(automationDecision);
  const legacyProviders = records(input.legacyProviders).map((provider) => {
    const parity = isRecord(provider.parity) ? provider.parity : {};
    const sameRepository = provider.repository === repository;
    const missingCapabilities = requiredParity.filter((capability) => parity[capability] !== true);
    const proven = sameRepository && requiredParity.length > 0 && missingCapabilities.length === 0;
    return {
      provider: text(provider.provider),
      repository: text(provider.repository),
      parityStatus: proven ? "proven" : "unproven",
      missingCapabilities,
      retirementEligible: proven,
      requiredAction: proven ? "separate-retirement-decision" : "keep-provider",
      retirementPerformed: false,
    };
  });

  const severityOrder = { critical: 0, high: 1, medium: 2 };
  findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.code.localeCompare(right.code));
  const checkInFindings = findings.map((item) => ({
    id: `posthog:${item.code}`,
    repository,
    source: "observability",
    subject: `posthog:${item.code}`,
    claim: item.code,
    state: "requires-attention",
    observedAt: now,
    requiresHuman: true,
    severity: item.severity,
    action: {
      title: item.title,
      reason: item.action,
      capability: "computer",
      minutes: null,
      priority: item.severity === "critical" ? 100 : item.severity === "high" ? 80 : 60,
    },
    evidenceIds: item.evidenceIds.map(sharedEvidenceId),
    privacy: "sanitized-no-replay-no-pii-no-event-properties",
  }));

  return {
    schemaVersion: 1,
    contractVersion: "1.5.0",
    operation: "posthog-observability-audit",
    repository,
    asOf: now,
    valid: errors.length === 0,
    errors,
    status: errors.length > 0 || findings.length > 0 ? "failed" : investigations.length > 0 ? "unproven" : "passed",
    findings,
    investigations,
    observationClassifications,
    signalCounts,
    alerts,
    automation,
    legacyProviders,
    checkInFindings,
    readOnly: true,
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
