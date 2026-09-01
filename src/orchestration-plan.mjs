// @ts-check

import { createHash } from "node:crypto";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
}

/** @param {Record<string, unknown>} contract @param {string} name @param {string[]} errors @param {boolean} required */
function contractStrings(contract, name, errors, required = false) {
  const value = contract[name];
  if (value === undefined && !required) return [];
  const normalized = strings(value);
  if ((required && normalized.length === 0) || (value !== undefined && !Array.isArray(value))) {
    errors.push(`taskContract.${name} requires an array of strings`);
  }
  return normalized;
}

const models = Object.freeze({
  parent: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "high" },
  writer: { requested: "gpt-5.6-luna", resolved: "gpt-5.6-luna", reasoning: "high" },
  reviewer: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "medium" },
  security: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "xhigh" },
  performance: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "medium" },
  visual: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "high" },
  backend: { requested: "gpt-5.6-sol", resolved: "gpt-5.6-sol", reasoning: "medium" },
  research: { requested: "gpt-5.6-luna", resolved: "gpt-5.6-luna", reasoning: "xhigh" },
  computerUseRunner: { requested: "gpt-5.6-luna", resolved: "gpt-5.6-luna", reasoning: "max" },
});

/** @type {Record<string, {role: string, model: {requested: string, resolved: string, reasoning: string}}>} */
const specialistMap = Object.freeze({
  security: { role: "security_reviewer", model: models.security },
  performance: { role: "performance_auditor", model: models.performance },
  visual: { role: "visual_reviewer", model: models.visual },
  ui: { role: "visual_reviewer", model: models.visual },
  backend: { role: "backend_specialist", model: models.backend },
  data: { role: "backend_specialist", model: models.backend },
});

const analysisKinds = new Set(["research", "audit", "operations-analysis", "operations_analysis"]);
const simplifySignals = [
  "explicitlyRequested",
  "newAbstractions",
  "duplicateLogic",
  "addedDependencies",
  "complexityIncrease",
];

/** @param {Record<string, unknown>} contract @param {string[]} errors */
function validateContract(contract, errors) {
  const objective = typeof contract.objective === "string" ? contract.objective.trim() : "";
  const scope = contractStrings(contract, "scope", errors, true);
  const inputs = contractStrings(contract, "inputs", errors);
  const constraints = contractStrings(contract, "constraints", errors);
  const outOfScope = contractStrings(contract, "outOfScope", errors);
  const acceptance = contractStrings(contract, "acceptance", errors, true);
  const expectedOutputs = contractStrings(contract, "expectedOutputs", errors, true);
  const checks = contractStrings(contract, "checks", errors, true);
  const protectedBoundaries = contractStrings(contract, "protectedBoundaries", errors);
  const authorizationBoundaries = contractStrings(contract, "authorizationBoundaries", errors, true);
  const stopCondition = typeof contract.stopCondition === "string" ? contract.stopCondition.trim() : "";
  if (!objective) errors.push("taskContract.objective is required");
  if (scope.length === 0) errors.push("taskContract.scope requires at least one owned surface");
  if (acceptance.length === 0) errors.push("taskContract.acceptance requires observable criteria");
  if (expectedOutputs.length === 0) errors.push("taskContract.expectedOutputs requires expected outputs");
  if (checks.length === 0) errors.push("taskContract.checks requires at least one focused check");
  if (authorizationBoundaries.length === 0) errors.push("taskContract.authorizationBoundaries requires explicit boundaries");
  if (!stopCondition) errors.push("taskContract.stopCondition is required");
  return {
    objective,
    scope,
    inputs,
    constraints,
    outOfScope,
    acceptance,
    expectedOutputs,
    checks,
    protectedBoundaries,
    authorizationBoundaries,
    stopCondition,
  };
}

/** @param {Record<string, unknown>} signals @param {string[]} errors */
function validateSignals(signals, errors) {
  if (typeof signals.trivial !== "boolean") errors.push("signals.trivial must be an explicit boolean");
  if (signals.readOnly !== undefined && typeof signals.readOnly !== "boolean") errors.push("signals.readOnly must be boolean");
  if (signals.structuredToolHeavy !== undefined && typeof signals.structuredToolHeavy !== "boolean") errors.push("signals.structuredToolHeavy must be boolean");
  if (signals.codeModeEvidence !== undefined && !isRecord(signals.codeModeEvidence)) errors.push("signals.codeModeEvidence must be an object");
  if (signals.specialistRisk !== undefined && typeof signals.specialistRisk !== "string") errors.push("signals.specialistRisk must be a string");
  if (signals.diffRisk !== undefined && !isRecord(signals.diffRisk)) errors.push("signals.diffRisk must be an object");
  if (signals.computerUse !== undefined && typeof signals.computerUse !== "boolean") errors.push("signals.computerUse must be boolean");
  if (signals.browserAcceptance !== undefined && typeof signals.browserAcceptance !== "boolean") errors.push("signals.browserAcceptance must be boolean");
  if (signals.qaOnly !== undefined && typeof signals.qaOnly !== "boolean") errors.push("signals.qaOnly must be boolean");
  if (signals.verificationOnly !== undefined && typeof signals.verificationOnly !== "boolean") errors.push("signals.verificationOnly must be boolean");
  return errors.length === 0;
}

/** @param {unknown} value @returns {string[]} */
function requiredStrings(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim())
    ? value.map((entry) => entry.trim())
    : [];
}

const computerUseActions = new Set([
  "navigate",
  "click",
  "type",
  "select",
  "submit-form",
  "scroll",
  "wait",
  "capture-screenshot",
  "record-video",
  "stop-recording",
]);
const observationOnlyActions = new Set([
  "navigate",
  "scroll",
  "wait",
  "capture-screenshot",
  "record-video",
  "stop-recording",
]);
const executionPlanKeys = new Set([
  "version",
  "allowedOrigins",
  "allowedPathPatterns",
  "allowedActions",
  "inputReferences",
  "steps",
  "sideEffectMode",
  "evidencePath",
  "sha256",
]);
const executionStepKeys = new Set(["id", "action", "target", "inputRef"]);

/** @param {unknown} value */
function executionSteps(value) {
  if (!Array.isArray(value)) return [];
  /** @type {Array<{id: string, action: string, target?: string, inputRef?: string}>} */
  const result = [];
  for (const entry of value) {
    if (!isRecord(entry)) return [];
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const action = typeof entry.action === "string" ? entry.action.trim() : "";
    const target = typeof entry.target === "string" ? entry.target.trim() : undefined;
    const inputRef = typeof entry.inputRef === "string" ? entry.inputRef.trim() : undefined;
    if (!id || !action) return [];
    result.push({ id, action, ...(target ? { target } : {}), ...(inputRef ? { inputRef } : {}) });
  }
  return result;
}

/** @param {Record<string, unknown>} candidate */
function executionPlanPayload(candidate) {
  return {
    version: typeof candidate.version === "string" ? candidate.version.trim() : candidate.version,
    allowedOrigins: requiredStrings(candidate.allowedOrigins),
    allowedPathPatterns: requiredStrings(candidate.allowedPathPatterns),
    allowedActions: requiredStrings(candidate.allowedActions),
    inputReferences: requiredStrings(candidate.inputReferences),
    steps: executionSteps(candidate.steps),
    sideEffectMode: candidate.sideEffectMode,
    evidencePath: typeof candidate.evidencePath === "string" ? candidate.evidencePath.trim() : candidate.evidencePath,
  };
}

/** @param {Record<string, unknown>} candidate */
function expectedExecutionPlanHash(candidate) {
  return createHash("sha256").update(JSON.stringify(executionPlanPayload(candidate))).digest("hex");
}

/** @param {string} pattern */
function pathPatternRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("**", "\0").replaceAll("*", "[^/]*").replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`, "u");
}

/** @param {string} target @param {string[]} allowedOrigins @param {string[]} allowedPathPatterns */
function navigationAllowed(target, allowedOrigins, allowedPathPatterns) {
  if (target.startsWith("//") || target.includes("\\") || /%(?:2e|2f|5c)/iu.test(target) || allowedOrigins.length === 0) return false;
  try {
    const url = new URL(target, `${allowedOrigins[0]}/`);
    if (!allowedOrigins.includes(url.origin) || url.username || url.password || url.search || url.hash) return false;
    return allowedPathPatterns.some((pattern) => pathPatternRegex(pattern).test(url.pathname));
  } catch {
    return false;
  }
}

/** @param {Record<string, unknown>} signals @param {string[]} errors */
function validateExecutionPlanInput(signals, errors) {
  const requested = signals.computerUse === true || signals.browserAcceptance === true;
  if (!requested) return null;
  const candidate = isRecord(signals.executionPlan) ? signals.executionPlan : null;
  if (!candidate) {
    errors.push("signals.executionPlan is required for Computer Use verification");
    return null;
  }
  if (Object.keys(candidate).some((key) => !executionPlanKeys.has(key))) {
    errors.push("signals.executionPlan contains unknown properties");
  }
  if (Array.isArray(candidate.steps) && candidate.steps.some((step) => isRecord(step) && Object.keys(step).some((key) => !executionStepKeys.has(key)))) {
    errors.push("signals.executionPlan.steps contains unknown properties");
  }
  const version = typeof candidate.version === "string" ? candidate.version.trim() : "";
  const allowedOrigins = requiredStrings(candidate.allowedOrigins);
  const allowedPathPatterns = requiredStrings(candidate.allowedPathPatterns);
  const allowedActions = requiredStrings(candidate.allowedActions);
  const inputReferences = requiredStrings(candidate.inputReferences);
  const steps = executionSteps(candidate.steps);
  const evidencePath = typeof candidate.evidencePath === "string" ? candidate.evidencePath.trim() : "";
  const sha256 = typeof candidate.sha256 === "string" ? candidate.sha256.trim() : "";
  const sideEffectMode = candidate.sideEffectMode;
  if (version !== "1") errors.push("signals.executionPlan.version must equal 1");
  if (allowedOrigins.length === 0) errors.push("signals.executionPlan.allowedOrigins requires an array of origins");
  if (allowedPathPatterns.length === 0) errors.push("signals.executionPlan.allowedPathPatterns requires an array of path patterns");
  if (allowedActions.length === 0) errors.push("signals.executionPlan.allowedActions requires an action allowlist");
  if (allowedOrigins.some((origin) => {
    try {
      const url = new URL(origin);
      return !["http:", "https:"].includes(url.protocol) || url.origin !== origin || Boolean(url.username || url.password);
    } catch {
      return true;
    }
  })) errors.push("signals.executionPlan.allowedOrigins must contain normalized HTTP(S) origins only");
  if (allowedPathPatterns.some((pattern) => !pattern.startsWith("/") || pattern.includes("..") || pattern.includes("?") || pattern.includes("#"))) {
    errors.push("signals.executionPlan.allowedPathPatterns must contain origin-relative safe path patterns");
  }
  if (!Array.isArray(candidate.inputReferences) || inputReferences.some((entry) => !/^(fixture|host|session|vault)\.[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(entry))) {
    errors.push("signals.executionPlan.inputReferences must use opaque fixture, host, session, or vault reference identifiers");
  }
  if (steps.length === 0) errors.push("signals.executionPlan.steps requires neutral executable steps");
  if (new Set(steps.map((step) => step.id)).size !== steps.length) errors.push("signals.executionPlan.steps requires unique ids");
  if (allowedActions.some((action) => !computerUseActions.has(action))) {
    errors.push("signals.executionPlan.allowedActions contains an unsupported action");
  }
  if (steps.some((step) => !allowedActions.includes(step.action))) {
    errors.push("signals.executionPlan.steps contains an action outside allowedActions");
  }
  if (steps.some((step) => step.inputRef && !inputReferences.includes(step.inputRef))) {
    errors.push("signals.executionPlan.steps contains an inputRef outside inputReferences");
  }
  if (steps.some((step) => step.action === "navigate" && (!step.target || !navigationAllowed(step.target, allowedOrigins, allowedPathPatterns)))) {
    errors.push("signals.executionPlan navigate targets must match allowedOrigins and allowedPathPatterns");
  }
  if (steps.some((step) => ["click", "type", "select", "submit-form"].includes(step.action) && !step.target)) {
    errors.push("signals.executionPlan interactive steps require a target");
  }
  if (steps.some((step) => ["type", "select"].includes(step.action) && !step.inputRef)) {
    errors.push("signals.executionPlan type and select steps require an opaque inputRef");
  }
  if (!/^\$HOME\/\.development-system\/private\/verification\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._\/-]+)?$/u.test(evidencePath) || evidencePath.includes("..")) {
    errors.push("signals.executionPlan.evidencePath must use the private verification evidence root");
  }
  if (!/^[a-f0-9]{64}$/u.test(sha256) || sha256 !== expectedExecutionPlanHash(candidate)) {
    errors.push("signals.executionPlan.sha256 must bind the canonical plan payload excluding sha256");
  }
  if (sideEffectMode !== "none" && sideEffectMode !== "authorized-writes") {
    errors.push("signals.executionPlan.sideEffectMode must be none or authorized-writes");
  }
  const noneModeAction = allowedActions.find((action) => !observationOnlyActions.has(action));
  if (sideEffectMode === "none" && noneModeAction) {
    errors.push("signals.executionPlan.sideEffectMode none permits navigation/capture actions only");
  }
  const intents = requiredStrings(signals.externalWriteIntents);
  const possibleSideEffects = requiredStrings(signals.possibleExternalSideEffects);
  if (sideEffectMode === "authorized-writes") {
    if (intents.length === 0) errors.push("authorized-writes requires scoped externalWriteIntents");
    if (possibleSideEffects.length === 0) errors.push("authorized-writes requires possibleExternalSideEffects");
    errors.push("authorized-writes cannot be authorized by the pure planner; the host must consume and verify an opaque receipt before dispatch");
  } else if (intents.length > 0 || possibleSideEffects.length > 0 || (isRecord(signals.externalWriteAuthorization) && signals.externalWriteAuthorization.granted === true)) {
    errors.push("sideEffectMode none cannot declare external writes or possible side effects");
  }
  if (signals.sideEffectMode !== undefined && signals.sideEffectMode !== sideEffectMode) {
    errors.push("signals.sideEffectMode must match signals.executionPlan.sideEffectMode");
  }
  return {
    version,
    allowedOrigins,
    allowedPathPatterns,
    allowedActions,
    inputReferences,
    steps,
    sideEffectMode,
    evidencePath,
    sha256,
    externalWriteIntents: intents,
    possibleExternalSideEffects: possibleSideEffects,
  };
}

/** @param {Record<string, unknown>} signals @param {ReturnType<typeof validateExecutionPlanInput>} executionPlan */
function computerUseDecision(signals, executionPlan) {
  const requested = signals.computerUse === true || signals.browserAcceptance === true;
  const qaOnly = requested && (signals.qaOnly === true || signals.verificationOnly === true);
  return {
    requested,
    qaOnly,
    executor: requested ? "computer_use_runner" : null,
    executorModel: requested ? models.computerUseRunner : null,
    judgmentOwner: requested ? "orchestrator" : null,
    judgmentRole: requested ? "verification_judge" : null,
    probeOrder: requested ? ["before-execution", "computer-use-execution", "after-execution"] : [],
    rubricVisibility: requested ? "private-to-orchestrator" : null,
    browserAuthority: "host-runtime",
    sideEffectMode: executionPlan?.sideEffectMode ?? null,
    executionPlanBinding: executionPlan ? {
      version: executionPlan.version,
      sha256: executionPlan.sha256,
      allowedOrigins: [...executionPlan.allowedOrigins],
      allowedPathPatterns: [...executionPlan.allowedPathPatterns],
      allowedActions: [...executionPlan.allowedActions],
      inputReferences: [...executionPlan.inputReferences],
      steps: executionPlan.steps.map((step) => ({ ...step })),
      sideEffectMode: executionPlan.sideEffectMode,
      evidencePath: executionPlan.evidencePath,
    } : null,
    externalWriteIntents: executionPlan?.externalWriteIntents ?? [],
    possibleExternalSideEffects: executionPlan?.possibleExternalSideEffects ?? [],
  };
}

/** @param {Record<string, unknown>} signals */
function codeModeDecision(signals) {
  const kind = typeof signals.kind === "string" ? signals.kind.trim().toLowerCase() : "";
  const readOnly = signals.readOnly === true;
  const structuredToolHeavy = signals.structuredToolHeavy === true;
  const base = { selected: false, selectionAuthority: "host-runtime" };
  if (!analysisKinds.has(kind)) {
    return { ...base, eligible: false, preference: null, fallback: "sequential-read-only-tools", reason: "Code Mode is reserved for explicit research, audit, or operations analysis." };
  }
  if (!readOnly) {
    return { ...base, eligible: false, preference: null, fallback: "sequential", reason: "Code Mode requires a read-only lane." };
  }
  if (!structuredToolHeavy) {
    return { ...base, eligible: false, preference: null, fallback: "sequential-read-only-tools", reason: "The lane is not structured-tool-heavy." };
  }
  return {
    ...base,
    eligible: true,
    preference: "code-mode",
    fallback: "sequential-read-only-tools",
    reason: "The task is eligible for a host-selected Code Mode attempt; the planner cannot activate or select it.",
  };
}

/** @param {Record<string, unknown>} signals */
function simplifyDecision(signals) {
  const diffRisk = isRecord(signals.diffRisk) ? signals.diffRisk : {};
  const signal = simplifySignals.find((name) => diffRisk[name] === true);
  if (!signal) return { selected: false, reason: "No explicit simplification-risk signal was supplied." };
  return { selected: true, reason: `Explicit diff-risk signal: ${signal}.` };
}

/**
 * Build a deterministic, side-effect-free execution plan. It validates an
 * explicit task contract and observed capabilities; it never launches agents
 * or providers and never grants delivery authority.
 * @param {unknown} input
 */
export function planOrchestration(input) {
  const errors = [];
  if (!isRecord(input)) {
    return blockedPlan(["orchestration input must be an object"]);
  }
  const contractInput = isRecord(input.taskContract) ? input.taskContract : isRecord(input.contract) ? input.contract : null;
  const signals = isRecord(input.signals) ? input.signals : null;
  if (!contractInput) errors.push("taskContract is required");
  if (!signals) errors.push("signals is required");
  if (contractInput === null || signals === null) return blockedPlan(errors);
  const contract = validateContract(contractInput, errors);
  validateSignals(signals, errors);
  const executionPlan = validateExecutionPlanInput(signals, errors);
  if (errors.length > 0) return blockedPlan(errors, contract);

  const computerUse = computerUseDecision(signals, executionPlan);
  const mode = computerUse.qaOnly
    ? "verification"
    : signals.trivial === true ? "direct" : typeof signals.specialistRisk === "string" && specialistMap[signals.specialistRisk.toLowerCase()] ? "specialist" : "sequential";
  const codeMode = mode === "direct" || mode === "verification"
    ? { eligible: false, selected: false, selectionAuthority: "host-runtime", preference: null, executor: null, fallback: "direct", reason: "Direct work does not use a Code Mode analysis lane." }
    : codeModeDecision(signals);
  const simplifyCode = simplifyDecision(signals);
  /** @type {Array<Record<string, unknown>>} */
  const lanes = [];
  if (computerUse.requested && computerUse.qaOnly) {
    lanes.push(computerUseRunnerLane(contract.authorizationBoundaries, executionPlan));
    lanes.push(verificationJudgmentLane(contract));
  } else if (mode === "direct") {
    lanes.push(lane({ id: "direct", role: "orchestrator", type: "direct", model: models.parent, ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition }));
  } else if (codeMode.eligible) {
    lanes.push(lane({ id: "analysis", role: "docs_researcher", type: "analysis", execution: "code-mode-attempt", executionPreference: "code-mode", executionFallback: "sequential-read-only-tools", model: models.research, ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition, readOnly: true }));
    const specialist = typeof signals.specialistRisk === "string" ? specialistMap[signals.specialistRisk.toLowerCase()] : undefined;
    if (specialist) lanes.push(lane({ id: "specialist", role: specialist.role, type: "specialist-review", execution: "sequential", model: specialist.model, ownership: contract.scope, contract, checks: contract.checks, stopCondition: `Review the observed ${signals.specialistRisk} risk and return evidence-backed findings.`, independent: true, readOnly: true }));
  } else if (analysisKinds.has(typeof signals.kind === "string" ? signals.kind.trim().toLowerCase() : "") && signals.readOnly === true) {
    lanes.push(lane({ id: "analysis", role: "docs_researcher", type: "analysis", execution: "sequential", model: models.research, ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition, readOnly: true }));
    const specialist = typeof signals.specialistRisk === "string" ? specialistMap[signals.specialistRisk.toLowerCase()] : undefined;
    if (specialist) lanes.push(lane({ id: "specialist", role: specialist.role, type: "specialist-review", execution: "sequential", model: specialist.model, ownership: contract.scope, contract, checks: contract.checks, stopCondition: `Review the observed ${signals.specialistRisk} risk and return evidence-backed findings.`, independent: true, readOnly: true }));
  } else {
    lanes.push(lane({ id: "writer", role: "fast_implementer", type: "writer", execution: "sequential", model: models.writer, ownership: contract.scope, contract, checks: contract.checks, stopCondition: contract.stopCondition, readOnly: false }));
    lanes.push(lane({ id: "review", role: "reviewer", type: "independent-review", execution: "sequential", model: models.reviewer, ownership: contract.scope, contract, checks: contract.checks, stopCondition: "Report actionable correctness and regression findings; do not edit.", independent: true, readOnly: true }));
    const specialist = typeof signals.specialistRisk === "string" ? specialistMap[signals.specialistRisk.toLowerCase()] : undefined;
    if (specialist) lanes.push(lane({ id: "specialist", role: specialist.role, type: "specialist-review", execution: "sequential", model: specialist.model, ownership: contract.scope, contract, checks: contract.checks, stopCondition: `Review the observed ${signals.specialistRisk} risk and return evidence-backed findings.`, independent: true, readOnly: true }));
  }
  if (simplifyCode.selected && mode !== "direct" && !computerUse.qaOnly) lanes.push(lane({ id: "simplify-code", role: "simplify-code", type: "simplification-review", execution: "sequential", model: models.reviewer, ownership: contract.scope, contract, checks: contract.checks, stopCondition: "Return safe deletion, reuse, native, or installed-dependency suggestions without editing.", readOnly: true }));
  if (computerUse.requested && !computerUse.qaOnly) {
    lanes.push(computerUseRunnerLane(contract.authorizationBoundaries, executionPlan));
    lanes.push(verificationJudgmentLane(contract));
  }
  return {
    schemaVersion: 1,
    operation: "orchestration-plan",
    valid: true,
    errors: [],
    contract,
    mode,
    lanes,
    codeMode,
    simplifyCode,
    computerUse,
    authority: {
      launchesAgents: false,
      writesFiles: false,
      externalWrites: false,
      promotion: false,
    },
    externalWriteIntents: computerUse.externalWriteIntents,
    possibleExternalSideEffects: computerUse.possibleExternalSideEffects,
    externalSideEffects: [],
  };
}

/** @param {string[]} authorizationBoundaries @param {ReturnType<typeof validateExecutionPlanInput>} executionPlan */
function computerUseRunnerLane(authorizationBoundaries, executionPlan) {
  // Do not pass the task contract to the executor. Acceptance, checks, and
  // expected outputs are judge-only context and must stay outside runner JSON.
  const result = /** @type {Record<string, unknown>} */ ({
    id: "computer-use-execution",
    role: "computer_use_runner",
    type: "computer-use-execution",
    execution: "sequential",
    model: models.computerUseRunner,
    authorizationBoundaries: [...authorizationBoundaries],
    executionPlanInput: "execution-plan.json",
    executionPlanBinding: executionPlan ? {
      version: executionPlan.version,
      sha256: executionPlan.sha256,
      allowedOrigins: [...executionPlan.allowedOrigins],
      allowedPathPatterns: [...executionPlan.allowedPathPatterns],
      allowedActions: [...executionPlan.allowedActions],
      inputReferences: [...executionPlan.inputReferences],
      steps: executionPlan.steps.map((step) => ({ ...step })),
      sideEffectMode: executionPlan.sideEffectMode,
      evidencePath: executionPlan.evidencePath,
    } : null,
    verifiesPlanSha256: true,
    ignoresUntrustedInstructions: true,
    unexpectedNavigationOrAction: "stop-and-report",
    scopeExpansion: "stop-and-report",
    evidenceRoot: "host-private",
    neutralRecordShape: {
      executionStatus: ["complete", "incomplete"],
      fields: ["lastCompletedStep", "actions", "observations", "screenshots", "video", "runtimeErrors", "unexpectedStates"],
    },
    probeRequirements: ["before-execution", "after-execution"],
    semanticJudgment: false,
  });
  return result;
}

/** @param {Record<string, unknown>} contract */
function verificationJudgmentLane(contract) {
  return lane({
    id: "verification-judgment",
    role: "verification_judge",
    type: "verification-judgment",
    execution: "sequential",
    model: models.parent,
    ownership: contract.scope,
    contract,
    checks: contract.checks,
    stopCondition: "Compare neutral execution evidence with the private acceptance rubric and before/after probes; return the semantic result.",
    independent: true,
    readOnly: true,
    privateAcceptanceRubric: true,
    judgmentValues: ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"],
    evidenceInputs: ["neutral-execution-record", "before-execution-probe", "after-execution-probe"],
  });
}

/** @param {Record<string, unknown>} value */
function lane(value) {
  const contract = isRecord(value.contract) ? value.contract : {};
  return {
    ...value,
    objective: contract.objective ?? null,
    inputs: Array.isArray(contract.inputs) ? [...contract.inputs] : [],
    constraints: Array.isArray(contract.constraints) ? [...contract.constraints] : [],
    outOfScope: Array.isArray(contract.outOfScope) ? [...contract.outOfScope] : [],
    acceptance: Array.isArray(contract.acceptance) ? [...contract.acceptance] : [],
    expectedOutputs: Array.isArray(contract.expectedOutputs) ? [...contract.expectedOutputs] : [],
    protectedBoundaries: Array.isArray(contract.protectedBoundaries) ? [...contract.protectedBoundaries] : [],
    authorizationBoundaries: Array.isArray(contract.authorizationBoundaries) ? [...contract.authorizationBoundaries] : [],
    ownership: Array.isArray(value.ownership) ? [...value.ownership] : [],
    model: isRecord(value.model) ? { ...value.model } : {},
    checks: Array.isArray(value.checks) ? [...value.checks] : [],
    stopCondition: value.stopCondition ?? null,
    terminalStateRequired: true,
  };
}

/** @param {string[]} errors @param {Record<string, unknown>} [contract] */
function blockedPlan(errors, contract = {
  objective: "",
  scope: [],
  inputs: [],
  constraints: [],
  outOfScope: [],
  acceptance: [],
  expectedOutputs: [],
  checks: [],
  protectedBoundaries: [],
  authorizationBoundaries: [],
  stopCondition: "",
}) {
  return {
    schemaVersion: 1,
    operation: "orchestration-plan",
    valid: false,
    errors,
    contract,
    mode: "blocked",
    lanes: [],
    codeMode: { eligible: false, selected: false, selectionAuthority: "host-runtime", executor: null, fallback: "blocked", reason: "Invalid execution contract." },
    simplifyCode: { selected: false, reason: "Invalid execution contract." },
    computerUse: { requested: false, qaOnly: false, executor: null, executorModel: null, judgmentOwner: null, judgmentRole: null, probeOrder: [], rubricVisibility: null, browserAuthority: "host-runtime", sideEffectMode: null, executionPlanBinding: null, externalWriteIntents: [], possibleExternalSideEffects: [] },
    authority: { launchesAgents: false, writesFiles: false, externalWrites: false, promotion: false },
    externalWriteIntents: [],
    possibleExternalSideEffects: [],
    externalSideEffects: [],
  };
}
