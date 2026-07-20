// @ts-check

import { isDeepStrictEqual } from "node:util";

const expectedPilots = new Set(["nutri-plan", "the-barber-central", "aohys.com"]);
const managedMutationScope = [
  ".development-system/repository.json",
  ".codex/development-system/repository.md",
  ".factory/development-system/repository.md",
];
const harnesses = ["codex", "t3code", "factory"];
const commandKinds = ["review", "validation", "qa", "preview"];
const prohibitedOperations = ["merge", "release", "production", "paidActivation", "canonicalHomeSync"];
const pilotScenarios = new Map([
  ["nutri-plan", "nutriplan-read-only"],
  ["the-barber-central", "barber-read-only"],
  ["aohys.com", "aohys-nested-read-only"],
]);

/** @param {unknown} value */
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {number} length */
function hex(value, length) {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "i").test(value);
}

/** @param {unknown} value */
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value */
function artifactReference(value) {
  const record = /** @type {any} */ (value);
  return object(record) && nonEmpty(record.path) && /^evidence\//.test(record.path) && hex(record.sha256, 64);
}

/** @param {any} reference @param {any} observed */
function artifactBound(reference, observed) {
  return artifactReference(reference) && object(observed) &&
    observed.path === reference.path && observed.sha256 === reference.sha256 && object(observed.document);
}

/**
 * Validate the comparable evidence packet for the three authorized pilots.
 * The validator intentionally fails closed: structural preparation without live
 * harness evidence, a reviewable preview, recovery, or the private recap cannot
 * advance the candidate to the human gate.
 * @param {any} document
 * @param {any} [verification]
 */
export function validatePilotRolloutEvidence(document, verification = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!object(document)) return { ok: false, decision: "blocked", errors: ["evidence must be an object"] };
  if (document.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (document.contractVersion !== "0.7.0") errors.push("contractVersion must be 0.7.0");
  if (document.linearIssue !== "AOH-147") errors.push("linearIssue must be AOH-147");
  if (!nonEmpty(document.generatedAt) || Number.isNaN(Date.parse(document.generatedAt))) {
    errors.push("generatedAt must be an ISO timestamp");
  }

  if (!object(document.candidate)) errors.push("candidate evidence is required");
  else {
    if (!hex(document.candidate.sourceCommit, 40)) errors.push("candidate sourceCommit must be a full Git commit");
    if (verification.candidateCommitExists !== true) errors.push("candidate commit was not verified");
    if (!/^https:\/\/github\.com\/.+\/pull\/\d+$/.test(document.candidate.pullRequest ?? "")) {
      errors.push("candidate pullRequest must be a GitHub PR URL");
    }
    if (!artifactBound(document.candidate.harnessEvidence, verification.harnessEvidence)) {
      errors.push("candidate harness evidence is not bound to verified bytes");
    } else {
      const harnessDocument = verification.harnessEvidence.document;
      if (harnessDocument.ok !== true || harnessDocument.contractVersion !== "0.7.0" ||
        !Array.isArray(harnessDocument.results) || !Array.isArray(harnessDocument.failures) ||
        harnessDocument.failures.length > 0) {
        errors.push("candidate harness evidence is not a green 0.7.0 report");
      }
    }
    if (!artifactBound(document.candidate.skillEvidence, verification.skillEvidence)) {
      errors.push("candidate skill evidence is not bound to verified bytes");
    } else if (verification.skillEvidence.document.probeSucceeded !== true) {
      errors.push("candidate skill live probe did not succeed");
    }
  }

  const pilots = Array.isArray(document.pilots) ? document.pilots : [];
  const pilotNames = new Set(pilots.map((/** @type {any} */ pilot) => pilot?.name));
  if (pilots.length !== expectedPilots.size || pilotNames.size !== expectedPilots.size) {
    errors.push("pilots must contain exactly three unique repositories");
  }
  for (const name of expectedPilots) {
    if (!pilotNames.has(name)) errors.push(`missing authorized pilot ${name}`);
  }
  for (const pilot of pilots) {
    const name = nonEmpty(pilot?.name) ? pilot.name : "unnamed pilot";
    if (!expectedPilots.has(name)) errors.push(`${name} is outside the authorized pilot set`);
    const pilotVerification = verification?.pilots?.[name];
    if (!artifactBound(pilot?.attestation, pilotVerification)) {
      errors.push(`${name} attestation is not bound to verified bytes`);
    } else if (hex(pilot?.baseCommit, 40)) {
      const { attestation: _attestation, ...pilotClaims } = pilot;
      if (!isDeepStrictEqual(pilotVerification.document, pilotClaims)) {
        errors.push(`${name} attestation does not match the rollout packet`);
      }
    }
    const claims = artifactBound(pilot?.attestation, pilotVerification)
      ? pilotVerification.document
      : pilot;
    if (!hex(claims?.baseCommit, 40)) errors.push(`${name} baseCommit must be a full Git commit`);
    if (!hex(claims?.productCommit, 40)) errors.push(`${name} productCommit must be a full Git commit`);
    if (pilotVerification?.commitExists !== true) errors.push(`${name} product commit was not verified`);
    if (pilotVerification?.recapExists !== true) errors.push(`${name} private Local Visual Recap path was not verified`);
    if (!hex(claims?.auditFingerprint, 64)) errors.push(`${name} auditFingerprint must be sha256`);
    if (JSON.stringify(claims?.managedMutationScope) !== JSON.stringify(managedMutationScope)) {
      errors.push(`${name} managed mutation scope is not exact`);
    }
    if (!object(claims?.preserved) || !Array.isArray(claims.preserved.releasePolicyFiles) || !Array.isArray(claims.preserved.designFiles)) {
      errors.push(`${name} preserved release and design evidence is required`);
    }
    for (const kind of commandKinds) {
      if (!nonEmpty(claims?.commands?.[kind])) errors.push(`${name} ${kind} command is required`);
    }
    for (const harness of harnesses) {
      if (claims?.harnesses?.[harness] !== "validated") errors.push(`${name} ${harness} harness is not validated`);
    }
    if (!object(claims?.review) || claims.review.blocker !== 0 || claims.review.high !== 0 ||
      !Number.isInteger(claims.review.medium) || !Array.isArray(claims.review.mediumDispositions) ||
      claims.review.mediumDispositions.length !== claims.review.medium || !nonEmpty(claims.review.evidence)) {
      errors.push(`${name} review evidence has unresolved blocker, high, or medium findings`);
    }
    if (!object(claims?.qaSelection) || !["full", "lightweight", "omitted"].includes(claims.qaSelection.level) ||
      !nonEmpty(claims.qaSelection.reason) || !nonEmpty(claims.qaSelection.evidence)) {
      errors.push(`${name} QA selection requires a level, reason, and evidence`);
    }
    const scenario = pilotScenarios.get(name);
    const liveResults = verification?.harnessEvidence?.document?.results;
    if (scenario && (!Array.isArray(liveResults) || harnesses.some((surface) => !liveResults.some((result) =>
      result?.scenario === scenario && result?.surface === surface && result?.status === "passed"
    )))) errors.push(`${name} does not have live three-surface harness evidence`);
    if (!Array.isArray(claims?.checks) || claims.checks.length === 0 || claims.checks.some((/** @type {any} */ check) =>
      !nonEmpty(check?.id) || !nonEmpty(check?.command) || check?.status !== "passed" || !nonEmpty(check?.evidence)
    )) errors.push(`${name} checks require passed command evidence`);
    if (claims?.pullRequest?.status !== "open" || !/^https:\/\/github\.com\/.+\/pull\/\d+$/.test(claims?.pullRequest?.url ?? "")) {
      errors.push(`${name} pull request is not open and reviewable`);
    }
    if (claims?.preview?.status !== "ready" || !/^https?:\/\//.test(claims?.preview?.url ?? "")) {
      errors.push(`${name} preview is not ready`);
    }
    if (!Array.isArray(claims?.residualRisks) || claims.residualRisks.length === 0) {
      errors.push(`${name} residual risks must be explicit`);
    }
    if (claims?.rollback?.kind !== "revert-product-commit" || !nonEmpty(claims?.rollback?.command)) {
      errors.push(`${name} rollback evidence is incomplete`);
    }
    if (claims?.localVisualRecap?.status !== "written" || !nonEmpty(claims?.localVisualRecap?.privatePath)) {
      errors.push(`${name} private Local Visual Recap is missing`);
    }
    if (claims?.decision !== "ready-for-human") errors.push(`${name} has not reached ready-for-human`);
  }

  const escuela = Array.isArray(document.excludedRepositories)
    ? document.excludedRepositories.find((/** @type {any} */ entry) => entry?.name === "Escuela 360")
    : undefined;
  if (!escuela || escuela.readiness !== "unready" || escuela.inspectedAsReference !== false || escuela.modified !== false) {
    errors.push("Escuela 360 must remain explicitly unready, uninspected as a reference, and unmodified");
  }
  for (const operation of prohibitedOperations) {
    if (document?.prohibitedOperations?.[operation] !== false) {
      errors.push(`prohibited operation ${operation} must remain false`);
    }
  }
  if (document.decision !== "ready-for-human") errors.push("candidate decision must be ready-for-human");

  return { ok: errors.length === 0, decision: errors.length === 0 ? "ready-for-human" : "blocked", errors };
}
