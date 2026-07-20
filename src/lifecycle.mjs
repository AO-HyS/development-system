// @ts-check

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const workflowIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const lifecycleStages = new Set([
  "idle",
  "requirements_in_progress",
  "requirements_approved",
  "spec_plan_ready",
  "spec_plan_approved",
  "tickets_ready",
  "tickets_approved",
  "delivery_authorized",
  "pre_release_ready",
]);

/**
 * @typedef {object} LifecycleEvidence
 * @property {string} id
 * @property {string} recordedAt
 * @property {string} operation
 * @property {string} request
 * @property {"explicit-human-request" | "implement-preview" | "operation-specific"} authorization
 * @property {string} stageBefore
 * @property {string} stageAfter
 */

/**
 * @typedef {object} LifecycleState
 * @property {1} schemaVersion
 * @property {string} workflowId
 * @property {string} stage
 * @property {string | null} optionalStage
 * @property {string | null} terminalSlice
 * @property {LifecycleEvidence[]} evidence
 * @property {{id: string, operation: string, grantedAt: string, request: string, consumedAt: string | null}[]} authorizations
 */

/** @param {string} value */
function normalized(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** @param {string} workflowId */
function assertWorkflowId(workflowId) {
  if (!workflowIdPattern.test(workflowId)) {
    throw new Error("workflowId must be a path-safe identifier");
  }
}

/** @param {string} home @param {string} workflowId */
function lifecyclePath(home, workflowId) {
  assertWorkflowId(workflowId);
  return resolve(home, ".development-system", "lifecycles", `${workflowId}.json`);
}

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} home @param {string} workflowId */
async function assertSafeLifecyclePath(home, workflowId) {
  const resolvedHome = resolve(home);
  const target = lifecyclePath(resolvedHome, workflowId);
  const components = relative(resolvedHome, target).split(sep).filter(Boolean);
  let current = resolvedHome;
  for (const component of components) {
    current = resolve(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Symbolic link escapes the selected HOME boundary: ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

/** @param {unknown} candidate @param {string} workflowId */
function validateState(candidate, workflowId) {
  if (!candidate || typeof candidate !== "object") throw new Error("Lifecycle state schema is invalid");
  const state = /** @type {Record<string, unknown>} */ (candidate);
  if (
    state.schemaVersion !== 1 ||
    state.workflowId !== workflowId ||
    typeof state.stage !== "string" ||
    !lifecycleStages.has(state.stage) ||
    (state.optionalStage !== null && state.optionalStage !== "wayfinder") ||
    (state.terminalSlice !== null && typeof state.terminalSlice !== "string") ||
    !Array.isArray(state.evidence) ||
    !Array.isArray(state.authorizations)
  ) {
    throw new Error("Lifecycle state schema is invalid");
  }
  return /** @type {LifecycleState} */ (candidate);
}

/** @param {string} home @param {string} workflowId @param {LifecycleState} state */
async function writeState(home, workflowId, state) {
  await assertSafeLifecyclePath(home, workflowId);
  const path = lifecyclePath(home, workflowId);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

/** @param {{home: string, workflowId: string}} options */
export async function readLifecycleState(options) {
  await assertSafeLifecyclePath(options.home, options.workflowId);
  const path = lifecyclePath(options.home, options.workflowId);
  try {
    return validateState(JSON.parse(await readFile(path, "utf8")), options.workflowId);
  } catch (error) {
    if (isMissing(error)) {
      return /** @type {LifecycleState} */ ({
        schemaVersion: 1,
        workflowId: options.workflowId,
        stage: "idle",
        optionalStage: null,
        terminalSlice: null,
        evidence: [],
        authorizations: [],
      });
    }
    throw error;
  }
}

/** @param {string} request */
function recommendStage(request) {
  const text = normalized(request);
  if (/\b(enorme|huge|foggy|inciert[oa]|sin (una )?ruta|unclear)\b/.test(text)) return "wayfinder";
  return "grill-with-docs";
}

/** @param {string} request */
function explicitTransition(request) {
  const text = normalized(request);
  if (/\b(invoca|ejecuta|inicia|activa|run|invoke)\b.*\bwayfinder\b/.test(text)) {
    return "invoke_wayfinder";
  }
  /** @type {[string, RegExp][]} */
  const sensitiveRequestPatterns = [
    ["merge", /\b(merge|fusion)\b/],
    ["release", /\b(release|publicacion)\b/],
    ["production", /\b(produccion|production)\b/],
    ["paid_activation", /\b(activacion pagada|paid activation|activar.*(pago|costo))\b/],
    ["destructive_operation", /\b(operacion destructiva|destructive operation|eliminacion destructiva)\b/],
  ];
  for (const operation of sensitiveRequestPatterns) {
    if (/\b(autorizo|autoriza|authorize|approve)\b/.test(text) && operation[1].test(text)) {
      return `authorize_${operation[0]}`;
    }
  }
  if (/\b(implementa|implement|autoriza|authorize)\b.*\b(preview|vista previa)\b/.test(text)) {
    return "authorize_implement_preview";
  }
  if (/\b(apruebo|aprueba|approve)\b.*\b(requisitos|requirements)\b/.test(text)) {
    return "approve_requirements";
  }
  if (/\b(apruebo|aprueba|approve)\b.*\b(spec|plan)\b/.test(text)) {
    return "approve_spec_plan";
  }
  if (/\b(apruebo|aprueba|approve)\b.*\b(tickets?)\b/.test(text)) {
    return "approve_tickets";
  }
  if (/\b(to-spec)\b|\b(genera|crea|create)\b.*\b(spec)\b/.test(text)) {
    return "create_spec_plan";
  }
  if (/\b(to-tickets)\b|\b(convierte|genera|crea|create)\b.*\b(tickets?)\b/.test(text)) {
    return "create_tickets";
  }
  if (/\b(inicia|ejecuta|run|start)\b.*\b(grill-with-docs|grill)\b/.test(text)) {
    return "start_requirements";
  }
  return null;
}

const normalTransitions = new Map([
  ["start_requirements", ["idle", "requirements_in_progress"]],
  ["approve_requirements", ["requirements_in_progress", "requirements_approved"]],
  ["create_spec_plan", ["requirements_approved", "spec_plan_ready"]],
  ["approve_spec_plan", ["spec_plan_ready", "spec_plan_approved"]],
  ["create_tickets", ["spec_plan_approved", "tickets_ready"]],
  ["approve_tickets", ["tickets_ready", "tickets_approved"]],
  ["authorize_implement_preview", ["tickets_approved", "delivery_authorized"]],
]);

/**
 * @param {{home: string, workflowId: string, mode: "recommend" | "transition", request: string, terminalSlice?: string}} options
 */
export async function runLifecycleRequest(options) {
  const state = await readLifecycleState(options);
  if (options.mode === "recommend") {
    const selectedStage = recommendStage(options.request);
    return {
      ok: true,
      operation: "lifecycle-request",
      selectedStage,
      transition: { status: "recommended", operation: null },
      state,
      evidence: state.evidence,
      externalSideEffects: [],
    };
  }

  const operation = explicitTransition(options.request);
  if (!operation) {
    return {
      ok: false,
      operation: "lifecycle-request",
      selectedStage: null,
      transition: { status: "not-mapped", operation: null },
      state,
      evidence: state.evidence,
      externalSideEffects: [],
    };
  }

  const transition = normalTransitions.get(operation);
  if (transition && state.stage !== transition[0]) {
    return {
      ok: false,
      operation: "lifecycle-request",
      selectedStage: null,
      transition: {
        status: "denied",
        operation,
        reason: `${operation} requires stage ${transition[0]}`,
      },
      state,
      evidence: state.evidence,
      externalSideEffects: [],
    };
  }
  if (
    operation === "authorize_implement_preview" &&
    (!options.terminalSlice || options.terminalSlice.trim().length === 0)
  ) {
    return {
      ok: false,
      operation: "lifecycle-request",
      selectedStage: null,
      transition: {
        status: "denied",
        operation,
        reason: "Implement Preview requires an explicit terminal slice",
      },
      state,
      evidence: state.evidence,
      externalSideEffects: [],
    };
  }

  const stageAfter = transition?.[1] ?? state.stage;
  const authorizationCandidate = operation.startsWith("authorize_")
    ? operation.slice("authorize_".length)
    : "";
  const sensitiveAuthorization = sensitiveOperations.has(authorizationCandidate)
    ? authorizationCandidate
    : null;
  if (sensitiveAuthorization && state.stage !== "pre_release_ready") {
    return {
      ok: false,
      operation: "lifecycle-request",
      selectedStage: null,
      transition: {
        status: "denied",
        operation,
        reason: "Sensitive operations require the final human gate after pre-release evidence",
      },
      state,
      evidence: state.evidence,
      externalSideEffects: [],
    };
  }

  const evidence = {
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    operation,
    request: options.request,
    authorization: /** @type {const} */ ("explicit-human-request"),
    stageBefore: state.stage,
    stageAfter,
  };
  const nextState = {
    ...state,
    stage: stageAfter,
    optionalStage: operation === "invoke_wayfinder" ? "wayfinder" : state.optionalStage,
    terminalSlice:
      operation === "authorize_implement_preview"
        ? /** @type {string} */ (options.terminalSlice).trim()
        : state.terminalSlice,
    evidence: [...state.evidence, evidence],
    authorizations: sensitiveAuthorization
      ? [
          ...state.authorizations,
          {
            id: randomUUID(),
            operation: sensitiveAuthorization,
            grantedAt: evidence.recordedAt,
            request: options.request,
            consumedAt: null,
          },
        ]
      : state.authorizations,
  };
  await writeState(options.home, options.workflowId, nextState);
  return {
    ok: true,
    operation: "lifecycle-request",
    selectedStage: operation === "invoke_wayfinder" ? "wayfinder" : stageAfter,
    transition: { status: "applied", operation },
    state: nextState,
    evidence: nextState.evidence,
    externalSideEffects: [],
  };
}

const deliveryOperations = new Set([
  "implement",
  "edit",
  "test",
  "validate",
  "review",
  "correct",
  "qa",
  "commit",
  "push",
  "open_pr",
  "publish_preview",
  "update_pr",
  "generate_recap",
]);
const sensitiveOperations = new Set([
  "merge",
  "release",
  "production",
  "paid_activation",
  "destructive_operation",
]);

/** @param {{home: string, workflowId: string, operation: string}} options */
export async function executeLifecycleOperation(options) {
  const state = await readLifecycleState(options);
  const isDeliveryOperation = deliveryOperations.has(options.operation);
  const isSensitiveOperation = sensitiveOperations.has(options.operation);
  if (!isDeliveryOperation && !isSensitiveOperation) {
    throw new Error(`Unknown lifecycle operation: ${options.operation}`);
  }

  let authorization = null;
  let authorizationIndex = -1;
  if (isDeliveryOperation) {
    if (!state.terminalSlice || !["delivery_authorized", "pre_release_ready"].includes(state.stage)) {
      return deniedExecution(state, options.operation, "Implement Preview has not authorized a terminal slice");
    }
    authorization = "implement-preview";
  } else {
    authorizationIndex = state.authorizations.findIndex(
      (grant) => grant.operation === options.operation && grant.consumedAt === null,
    );
    if (state.stage !== "pre_release_ready" || authorizationIndex === -1) {
      return deniedExecution(
        state,
        options.operation,
        `No unconsumed authorization exists for ${options.operation}`,
      );
    }
    authorization = "operation-specific";
  }

  const recordedAt = new Date().toISOString();
  const nextAuthorizations = state.authorizations.map((grant, index) =>
    index === authorizationIndex ? { ...grant, consumedAt: recordedAt } : grant,
  );
  const stageAfter = options.operation === "generate_recap" ? "pre_release_ready" : state.stage;
  const evidence = {
    id: randomUUID(),
    recordedAt,
    operation: `execute_${options.operation}`,
    request: options.operation,
    authorization: /** @type {"implement-preview" | "operation-specific"} */ (authorization),
    stageBefore: state.stage,
    stageAfter,
  };
  const nextState = {
    ...state,
    stage: stageAfter,
    authorizations: nextAuthorizations,
    evidence: [...state.evidence, evidence],
  };
  await writeState(options.home, options.workflowId, nextState);
  return {
    ok: true,
    operation: "lifecycle-execute",
    execution: { status: "authorized", operation: options.operation },
    state: nextState,
    evidence: nextState.evidence,
    externalSideEffects: [{ operation: options.operation, scope: state.terminalSlice }],
  };
}

/** @param {LifecycleState} state @param {string} operation @param {string} reason */
function deniedExecution(state, operation, reason) {
  return {
    ok: false,
    operation: "lifecycle-execute",
    execution: { status: "denied", operation, reason },
    state,
    evidence: state.evidence,
    externalSideEffects: [],
  };
}
