// @ts-check

/** @typedef {"blocker" | "high" | "medium" | "low"} Severity */
/** @typedef {"violation" | "recommendation" | "authorization-gate"} FindingKind */
/**
 * @typedef {object} GuardianFinding
 * @property {string} ruleId
 * @property {Severity} severity
 * @property {FindingKind} kind
 * @property {string} category
 * @property {string} subject
 * @property {string} detail
 * @property {string} evidence
 * @property {{path: string, line: number | null} | null} location
 * @property {string[]} focusedCheckIds
 */
/**
 * @typedef {object} FocusedCheck
 * @property {string} id
 * @property {string} category
 * @property {string} subject
 * @property {string} command
 * @property {string} proves
 */

const severityRank = new Map([
  ["blocker", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {string} key */
function stringValue(value, key) {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : "";
}

/** @param {Record<string, unknown>} value */
function subjectOf(value) {
  return stringValue(value, "id") || stringValue(value, "name") || stringValue(value, "path") || "unknown";
}

/** @param {Record<string, unknown>} value */
function locationOf(value) {
  const path = stringValue(value, "path");
  if (!path) return null;
  const line = Number.isInteger(value.line) && Number(value.line) > 0 ? Number(value.line) : null;
  return { path, line };
}

/** @param {Record<string, unknown>} value @param {string} fallback */
function evidenceOf(value, fallback) {
  return stringValue(value, "evidence") || fallback;
}

/** @param {string} value */
function slug(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "unknown";
}

/** @param {unknown} value */
function records(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * Evaluate supplied Convex review facts without reading or mutating a repository,
 * deployment, storage provider, scheduler, or database.
 *
 * Missing evidence never becomes a pass. Collectors should supply stable ids,
 * exact paths/lines, and concrete evidence for every claimed state.
 *
 * @param {unknown} input
 */
export function auditConvexGuardian(input) {
  const value = isRecord(input) ? input : {};
  const repository = stringValue(value, "repository");
  const errors = [];
  /** @type {GuardianFinding[]} */
  const findings = [];
  /** @type {{category: string, subject: string, detail: string}[]} */
  const unprovenEvidence = [];
  /** @type {Map<string, FocusedCheck>} */
  const focusedChecks = new Map();

  if (!repository) errors.push("repository is required");

  /** @param {GuardianFinding} finding @param {FocusedCheck[]} checks */
  function report(finding, checks) {
    findings.push(finding);
    for (const check of checks) focusedChecks.set(check.id, check);
  }

  /** @param {string} category @param {string} subject @param {string} detail */
  function unproven(category, subject, detail) {
    unprovenEvidence.push({ category, subject, detail });
  }

  const functions = records(value.functions);
  if (!Array.isArray(value.functions)) errors.push("functions must be an array");
  if (functions.length === 0) unproven("inventory", repository || "repository", "no Convex function inventory was supplied");

  for (const fn of functions) {
    const subject = subjectOf(fn);
    const kind = stringValue(fn, "kind");
    const visibility = stringValue(fn, "visibility");
    const location = locationOf(fn);
    const checkPrefix = `convex-function-${slug(subject)}`;

    if (!kind || !["query", "mutation", "action", "httpAction"].includes(kind)) {
      unproven("functions", subject, "function kind is missing or unsupported");
    }
    if (!visibility || !["public", "internal"].includes(visibility)) {
      unproven("functions", subject, "function visibility is missing or unsupported");
    }

    if (visibility === "public") {
      const auth = isRecord(fn.auth) ? fn.auth : null;
      const authStatus = auth ? stringValue(auth, "status") : "";
      if (authStatus === "missing" || authStatus === "bypassed") {
        report({
          ruleId: "convex.auth.required",
          severity: "blocker",
          kind: "violation",
          category: "auth",
          subject,
          detail: "Public Convex function does not enforce authorization at its trust boundary.",
          evidence: auth ? evidenceOf(auth, `auth status: ${authStatus}`) : "auth status: missing",
          location,
          focusedCheckIds: [`${checkPrefix}-auth`],
        }, [{
          id: `${checkPrefix}-auth`,
          category: "auth",
          subject,
          command: `Run focused authorization tests for ${subject}`,
          proves: "unauthorized callers are rejected and authorized callers are scoped to permitted records",
        }]);
      } else if (authStatus === "not-required") {
        if (!auth || !stringValue(auth, "rationale") || auth.boundaryTest !== true) {
          unproven("auth", subject, "an intentionally public function requires a rationale and a verified boundary test");
        }
      } else if (authStatus !== "verified") {
        unproven("auth", subject, "authorization evidence for the public function was not supplied");
      }

      if (fn.dangerousExposure === true || fn.internalOnly === true) {
        report({
          ruleId: "convex.public.exposure",
          severity: "blocker",
          kind: "violation",
          category: "auth",
          subject,
          detail: "Internal or privileged behavior is exposed as a public Convex function.",
          evidence: evidenceOf(fn, "function inventory marks this public surface as privileged"),
          location,
          focusedCheckIds: [`${checkPrefix}-exposure`],
        }, [{
          id: `${checkPrefix}-exposure`,
          category: "auth",
          subject,
          command: `Exercise the public API boundary for ${subject}`,
          proves: "privileged behavior is unreachable through the public function registry",
        }]);
      }
    }

    const validators = isRecord(fn.validators) ? fn.validators : null;
    if (!validators) {
      unproven("validators", subject, "argument and return validator evidence was not supplied");
    } else {
      for (const field of ["args", "returns"]) {
        const status = stringValue(validators, field);
        if (status === "missing" || status === "incomplete") {
          const label = field === "args" ? "argument" : "return";
          report({
            ruleId: `convex.validators.${field}`,
            severity: "high",
            kind: "violation",
            category: "validators",
            subject,
            detail: `Convex function has a ${status} ${label} validator.`,
            evidence: evidenceOf(validators, `${field} validator status: ${status}`),
            location,
            focusedCheckIds: [`${checkPrefix}-validators`],
          }, [{
            id: `${checkPrefix}-validators`,
            category: "validators",
            subject,
            command: `Run validator contract tests for ${subject}`,
            proves: "invalid arguments and invalid return shapes are rejected at the function boundary",
          }]);
        } else if (status !== "complete") {
          unproven("validators", subject, `${labelForValidator(field)} validator completeness was not proven`);
        }
      }
    }

    const reads = records(fn.reads);
    for (const read of reads) {
      const readSubject = `${subject}:${subjectOf(read)}`;
      const readLocation = locationOf(read) ?? location;
      const indexStatus = stringValue(read, "indexStatus");
      if (["missing", "wrong-order", "filter-after-scan"].includes(indexStatus) || read.usesIndex === false) {
        report({
          ruleId: "convex.reads.index",
          severity: "high",
          kind: "violation",
          category: "indexes",
          subject: readSubject,
          detail: "Query does not use an index whose field order matches the read pattern.",
          evidence: evidenceOf(read, indexStatus ? `index status: ${indexStatus}` : "usesIndex: false"),
          location: readLocation,
          focusedCheckIds: [`${checkPrefix}-reads`],
        }, [readFocusedCheck(checkPrefix, subject)]);
      } else if (!indexStatus && read.usesIndex !== true) {
        unproven("indexes", readSubject, "index selection evidence was not supplied");
      }

      if (read.collectsAll === true || read.bounded === false) {
        report({
          ruleId: "convex.reads.bounded",
          severity: "high",
          kind: "violation",
          category: "bounded-reads",
          subject: readSubject,
          detail: "Query can materialize an unbounded result set.",
          evidence: evidenceOf(read, read.collectsAll === true ? "collectsAll: true" : "bounded: false"),
          location: readLocation,
          focusedCheckIds: [`${checkPrefix}-reads`],
        }, [readFocusedCheck(checkPrefix, subject)]);
      } else if (read.bounded !== true) {
        unproven("bounded-reads", readSubject, "a concrete result bound was not supplied");
      }

      if (read.expectsMany === true && read.paginated !== true) {
        report({
          ruleId: "convex.reads.pagination",
          severity: "high",
          kind: "violation",
          category: "pagination",
          subject: readSubject,
          detail: "A potentially large result set is not paginated.",
          evidence: evidenceOf(read, "expectsMany: true; paginated is not true"),
          location: readLocation,
          focusedCheckIds: [`${checkPrefix}-reads`],
        }, [readFocusedCheck(checkPrefix, subject)]);
      }
    }

    const limits = isRecord(fn.limits) ? fn.limits : null;
    if (limits?.status === "violated") {
      report({
        ruleId: "convex.function.limits",
        severity: "high",
        kind: "violation",
        category: "limits",
        subject,
        detail: "Observed execution exceeds a declared Convex function limit.",
        evidence: evidenceOf(limits, "function limit status: violated"),
        location,
        focusedCheckIds: [`${checkPrefix}-limits`],
      }, [{
        id: `${checkPrefix}-limits`,
        category: "limits",
        subject,
        command: `Run a bounded production-shaped fixture for ${subject}`,
        proves: "documents scanned, bytes, execution time, and scheduled work remain within declared limits",
      }]);
    } else if (!limits || limits.status !== "verified") {
      unproven("limits", subject, "function-limit evidence was not supplied");
    }

    if (kind === "action" || kind === "httpAction") {
      const action = isRecord(fn.action) ? fn.action : null;
      if (action?.directDatabaseAccess === true || action?.unboundedExternalCall === true) {
        report({
          ruleId: "convex.actions.boundary",
          severity: "high",
          kind: "violation",
          category: "actions",
          subject,
          detail: action.directDatabaseAccess === true
            ? "Action crosses the database boundary instead of calling a validated query or mutation."
            : "Action performs an external call without an explicit timeout or bound.",
          evidence: evidenceOf(action, action.directDatabaseAccess === true ? "directDatabaseAccess: true" : "unboundedExternalCall: true"),
          location,
          focusedCheckIds: [`${checkPrefix}-action`],
        }, [{
          id: `${checkPrefix}-action`,
          category: "actions",
          subject,
          command: `Run the action boundary fixture for ${subject}`,
          proves: "database access uses validated functions and external calls are bounded and failure-aware",
        }]);
      } else if (!action || action.status !== "verified") {
        unproven("actions", subject, "action boundary evidence was not supplied");
      }
    }

    const schedule = isRecord(fn.scheduling) ? fn.scheduling : null;
    if (schedule && (schedule.idempotent === false || schedule.bounded === false)) {
      report({
        ruleId: "convex.scheduling.safe",
        severity: "high",
        kind: "violation",
        category: "scheduling",
        subject,
        detail: "Scheduled work is not both idempotent and bounded.",
        evidence: evidenceOf(schedule, `idempotent: ${String(schedule.idempotent)}; bounded: ${String(schedule.bounded)}`),
        location,
        focusedCheckIds: [`${checkPrefix}-schedule`],
      }, [{
        id: `${checkPrefix}-schedule`,
        category: "scheduling",
        subject,
        command: `Run duplicate-delivery and maximum-batch fixtures for ${subject}`,
        proves: "retries are idempotent and each scheduled invocation has a finite work bound",
      }]);
    }
  }

  const collectionInventories = [
    ["subscriptions", "subscription and invalidation inventory was not supplied"],
    ["writes", "write-contention inventory was not supplied"],
    ["dataOperations", "migration and backfill inventory was not supplied"],
    ["componentCandidates", "official-capability comparison inventory was not supplied"],
    ["storage", "storage ownership inventory was not supplied"],
  ];
  for (const [field, detail] of collectionInventories) {
    if (!Array.isArray(value[field])) unproven(field, repository || "repository", detail);
  }

  for (const subscription of records(value.subscriptions)) {
    const subject = subjectOf(subscription);
    if (subscription.scope === "broad" || subscription.invalidationFanout === "unbounded") {
      report({
        ruleId: "convex.subscriptions.scope",
        severity: "medium",
        kind: "violation",
        category: "subscriptions",
        subject,
        detail: "Reactive subscription has a broad dependency set or unbounded invalidation fanout.",
        evidence: evidenceOf(subscription, `scope: ${String(subscription.scope)}; invalidationFanout: ${String(subscription.invalidationFanout)}`),
        location: locationOf(subscription),
        focusedCheckIds: [`convex-subscription-${slug(subject)}`],
      }, [{
        id: `convex-subscription-${slug(subject)}`,
        category: "subscriptions",
        subject,
        command: `Measure invalidations for subscription ${subject}`,
        proves: "a representative write invalidates only the intended bounded subscriber set",
      }]);
    } else if (subscription.scope !== "bounded" || subscription.invalidationFanout !== "bounded") {
      unproven("subscriptions", subject, "bounded subscription scope and invalidation fanout were not proven");
    }
  }

  for (const write of records(value.writes)) {
    const subject = subjectOf(write);
    if (write.contention === "hotspot" || write.sharedDocument === true || write.unboundedFanout === true) {
      report({
        ruleId: "convex.writes.contention",
        severity: "high",
        kind: "violation",
        category: "contention",
        subject,
        detail: "Write pattern creates a shared-document hotspot or unbounded transaction fanout.",
        evidence: evidenceOf(write, `contention: ${String(write.contention)}; sharedDocument: ${String(write.sharedDocument)}`),
        location: locationOf(write),
        focusedCheckIds: [`convex-contention-${slug(subject)}`],
      }, [{
        id: `convex-contention-${slug(subject)}`,
        category: "contention",
        subject,
        command: `Run concurrent mutation fixture for ${subject}`,
        proves: "representative concurrent writes avoid repeatable transaction conflicts and bounded fanout is preserved",
      }]);
    } else if (write.contention !== "bounded" || write.sharedDocument !== false || write.unboundedFanout !== false) {
      unproven("contention", subject, "bounded contention and transaction fanout were not proven");
    }
  }

  for (const operation of records(value.dataOperations)) {
    const subject = subjectOf(operation);
    const operationKind = stringValue(operation, "kind");
    const isDataOperation = operation.destructive === true || ["migration", "backfill"].includes(operationKind);
    if (!isDataOperation) {
      if (!operationKind) unproven("migrations", subject, "data operation kind was not supplied");
      continue;
    }
    const missing = [];
    if (operation.plan !== true) missing.push("plan");
    if (operation.rollback !== true) missing.push("rollback");
    if (operation.dryRun !== true) missing.push("dry run");
    if ((operation.destructive === true || operationKind === "backfill") && operation.separateAuthorization !== true) {
      missing.push("separate authorization");
    }
    if (missing.length > 0) {
      report({
        ruleId: "convex.data-operation.authorization",
        severity: "blocker",
        kind: "authorization-gate",
        category: "migrations",
        subject,
        detail: `Migration or backfill is missing: ${missing.join(", ")}.`,
        evidence: evidenceOf(operation, `missing safeguards: ${missing.join(", ")}`),
        location: locationOf(operation),
        focusedCheckIds: [`convex-data-operation-${slug(subject)}`],
      }, [{
        id: `convex-data-operation-${slug(subject)}`,
        category: "migrations",
        subject,
        command: `Review the isolated dry-run packet for ${subject}`,
        proves: "the operation has ordering, bounded batches, rollback evidence, and separate authorization before execution",
      }]);
    }
  }

  for (const candidate of records(value.componentCandidates)) {
    const subject = subjectOf(candidate);
    if (candidate.customImplementation === true && candidate.fit === "confirmed" && stringValue(candidate, "officialAlternative")) {
      report({
        ruleId: "convex.components.prefer-official",
        severity: "medium",
        kind: "recommendation",
        category: "components",
        subject,
        detail: `Review the official ${stringValue(candidate, "officialAlternative")} capability before maintaining custom infrastructure.`,
        evidence: evidenceOf(candidate, "collector confirmed a current official capability fit"),
        location: locationOf(candidate),
        focusedCheckIds: [`convex-component-${slug(subject)}`],
      }, [{
        id: `convex-component-${slug(subject)}`,
        category: "components",
        subject,
        command: `Compare ${subject} with the current official ${stringValue(candidate, "officialAlternative")} contract`,
        proves: "the official capability is current and meets ownership, reliability, migration, and rollback requirements",
      }]);
    } else if (candidate.customImplementation === true && candidate.fit !== "rejected") {
      unproven("components", subject, "current official-capability fit was not confirmed");
    }
  }

  for (const storage of records(value.storage)) {
    const subject = subjectOf(storage);
    const dataKind = stringValue(storage, "kind");
    const provider = stringValue(storage, "provider");
    const binary = ["file", "image", "binary", "static-asset"].includes(dataKind);
    const domain = ["domain-record", "relationship"].includes(dataKind);
    if ((binary && provider === "convex" && storage.cloudflareFit === "confirmed") || (domain && provider === "cloudflare")) {
      report({
        ruleId: "convex.storage.boundary",
        severity: "medium",
        kind: "recommendation",
        category: "storage",
        subject,
        detail: binary
          ? "Binary or static content has a confirmed Cloudflare fit; review the boundary while keeping domain metadata and relationships in Convex. No storage change is authorized."
          : "Domain records or relationships belong in Convex rather than object storage. No storage change is authorized.",
        evidence: evidenceOf(storage, `kind: ${dataKind}; provider: ${provider}`),
        location: locationOf(storage),
        focusedCheckIds: [`convex-storage-${slug(subject)}`],
      }, [{
        id: `convex-storage-${slug(subject)}`,
        category: "storage",
        subject,
        command: `Review the storage ownership fixture for ${subject}`,
        proves: "binary delivery and domain relationships have explicit providers, lifecycle, rollback, and authorization boundaries",
      }]);
    } else if (!["file", "image", "binary", "static-asset", "domain-record", "relationship"].includes(dataKind)
      || !["convex", "cloudflare"].includes(provider)) {
      unproven("storage", subject, "a supported storage kind and provider ownership were not supplied");
    }

    if (storage.proposedChange === true) {
      const missing = [];
      if (storage.plan !== true) missing.push("plan");
      if (storage.rollback !== true) missing.push("rollback");
      if (storage.separateAuthorization !== true) missing.push("separate authorization");
      if (missing.length > 0) {
        report({
          ruleId: "convex.storage.authorization",
          severity: "blocker",
          kind: "authorization-gate",
          category: "storage",
          subject,
          detail: `Proposed storage change is missing: ${missing.join(", ")}.`,
          evidence: evidenceOf(storage, `missing safeguards: ${missing.join(", ")}`),
          location: locationOf(storage),
          focusedCheckIds: [`convex-storage-${slug(subject)}`],
        }, [{
          id: `convex-storage-${slug(subject)}`,
          category: "storage",
          subject,
          command: `Review the storage ownership fixture for ${subject}`,
          proves: "binary delivery and domain relationships have explicit providers, lifecycle, rollback, and authorization boundaries",
        }]);
      }
    }
  }

  findings.sort(compareFindings);
  unprovenEvidence.sort((left, right) => `${left.category}\0${left.subject}\0${left.detail}`.localeCompare(`${right.category}\0${right.subject}\0${right.detail}`));
  const orderedChecks = [...focusedChecks.values()].sort((left, right) => left.id.localeCompare(right.id));
  const status = findings.some((finding) => finding.kind !== "recommendation")
    ? "failed"
    : findings.length > 0
      ? "passed-with-recommendations"
      : unprovenEvidence.length > 0
        ? "unproven"
        : "passed";

  return {
    schemaVersion: 1,
    contractVersion: "1.5.0",
    operation: "audit-convex-guardian",
    valid: errors.length === 0,
    errors,
    repository,
    status,
    readOnly: true,
    findings,
    focusedChecks: orderedChecks,
    unprovenEvidence,
    authorization: {
      migrationGranted: false,
      backfillGranted: false,
      storageChangeGranted: false,
    },
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}

/** @param {string} field */
function labelForValidator(field) {
  return field === "args" ? "argument" : "return";
}

/** @param {string} checkPrefix @param {string} subject @returns {FocusedCheck} */
function readFocusedCheck(checkPrefix, subject) {
  return {
    id: `${checkPrefix}-reads`,
    category: "reads",
    subject,
    command: `Run production-shaped query fixtures for ${subject}`,
    proves: "index selection, field order, pagination, and maximum result bounds match expected cardinality",
  };
}

/** @param {GuardianFinding} left @param {GuardianFinding} right */
function compareFindings(left, right) {
  const rank = (severityRank.get(left.severity) ?? 99) - (severityRank.get(right.severity) ?? 99);
  if (rank !== 0) return rank;
  const leftLocation = left.location ? `${left.location.path}:${String(left.location.line ?? 0).padStart(8, "0")}` : "~";
  const rightLocation = right.location ? `${right.location.path}:${String(right.location.line ?? 0).padStart(8, "0")}` : "~";
  return `${leftLocation}\0${left.ruleId}\0${left.subject}`.localeCompare(`${rightLocation}\0${right.ruleId}\0${right.subject}`);
}
