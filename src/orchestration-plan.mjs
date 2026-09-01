// @ts-check

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
  return errors.length === 0;
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
  if (errors.length > 0) return blockedPlan(errors, contract);

  const mode = signals.trivial === true ? "direct" : typeof signals.specialistRisk === "string" && specialistMap[signals.specialistRisk.toLowerCase()] ? "specialist" : "sequential";
  const codeMode = mode === "direct"
    ? { eligible: false, selected: false, selectionAuthority: "host-runtime", preference: null, executor: null, fallback: "direct", reason: "Direct work does not use a Code Mode analysis lane." }
    : codeModeDecision(signals);
  const simplifyCode = simplifyDecision(signals);
  /** @type {Array<Record<string, unknown>>} */
  const lanes = [];
  if (mode === "direct") {
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
  if (simplifyCode.selected && mode !== "direct") lanes.push(lane({ id: "simplify-code", role: "simplify-code", type: "simplification-review", execution: "sequential", model: models.reviewer, ownership: contract.scope, contract, checks: contract.checks, stopCondition: "Return safe deletion, reuse, native, or installed-dependency suggestions without editing.", readOnly: true }));
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
    authority: {
      launchesAgents: false,
      writesFiles: false,
      externalWrites: false,
      promotion: false,
    },
    externalWriteIntents: [],
    externalSideEffects: [],
  };
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
    authority: { launchesAgents: false, writesFiles: false, externalWrites: false, promotion: false },
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
