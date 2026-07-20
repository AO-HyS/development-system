// @ts-check

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
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
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "")
    .toLowerCase();
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
    !state.evidence.every(isValidEvidence) ||
    !Array.isArray(state.authorizations) ||
    !state.authorizations.every(isValidAuthorization)
  ) {
    throw new Error("Lifecycle state schema is invalid");
  }
  return /** @type {LifecycleState} */ (candidate);
}

/** @param {unknown} candidate */
function isRecord(candidate) {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

/** @param {unknown} candidate */
function isIsoDate(candidate) {
  return typeof candidate === "string" && !Number.isNaN(Date.parse(candidate));
}

/** @param {unknown} candidate */
function isValidEvidence(candidate) {
  if (!isRecord(candidate)) return false;
  const evidence = /** @type {Record<string, unknown>} */ (candidate);
  return (
    typeof evidence.id === "string" &&
    isIsoDate(evidence.recordedAt) &&
    typeof evidence.operation === "string" &&
    typeof evidence.request === "string" &&
    ["explicit-human-request", "implement-preview", "operation-specific"].includes(
      /** @type {string} */ (evidence.authorization),
    ) &&
    typeof evidence.stageBefore === "string" &&
    lifecycleStages.has(evidence.stageBefore) &&
    typeof evidence.stageAfter === "string" &&
    lifecycleStages.has(evidence.stageAfter)
  );
}

/** @param {unknown} candidate */
function isValidAuthorization(candidate) {
  if (!isRecord(candidate)) return false;
  const authorization = /** @type {Record<string, unknown>} */ (candidate);
  return (
    typeof authorization.id === "string" &&
    typeof authorization.operation === "string" &&
    sensitiveOperations.has(authorization.operation) &&
    isIsoDate(authorization.grantedAt) &&
    typeof authorization.request === "string" &&
    (authorization.consumedAt === null || isIsoDate(authorization.consumedAt))
  );
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

/** @param {string} lockPath */
async function recoverStaleLock(lockPath) {
  const recoveryPath = `${lockPath}.recovery`;
  if (!(await acquireRecoveryGuard(recoveryPath))) return false;
  try {
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (
        !lock ||
        typeof lock !== "object" ||
        typeof lock.pid !== "number" ||
        !Number.isInteger(lock.pid) ||
        lock.pid <= 0 ||
        !isIsoDate(lock.createdAt)
      ) {
        const status = await lstat(lockPath);
        if (Date.now() - status.mtimeMs < 30_000) return false;
      } else {
        try {
          process.kill(lock.pid, 0);
          if (Date.now() - Date.parse(lock.createdAt) < 300_000) return false;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) return false;
        }
      }
      await unlink(lockPath);
      return true;
    } catch (error) {
      if (isMissing(error)) return true;
      if (error instanceof SyntaxError) {
        const status = await lstat(lockPath);
        if (Date.now() - status.mtimeMs < 30_000) return false;
        await unlink(lockPath);
        return true;
      }
      throw error;
    }
  } finally {
    await rmdir(recoveryPath);
  }
}

/** @param {string} recoveryPath */
async function acquireRecoveryGuard(recoveryPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(recoveryPath);
      return true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      let status;
      try {
        status = await lstat(recoveryPath);
      } catch (statusError) {
        if (isMissing(statusError)) continue;
        throw statusError;
      }
      if (Date.now() - status.mtimeMs < 30_000) return false;
      try {
        await rmdir(recoveryPath);
      } catch (removeError) {
        if (!(removeError instanceof Error && "code" in removeError && removeError.code === "ENOENT")) {
          return false;
        }
      }
    }
  }
  return false;
}

/**
 * @template T
 * @param {{home: string, workflowId: string}} options
 * @param {() => Promise<T> | T} onBusy
 * @param {() => Promise<T>} callback
 */
async function withLifecycleLock(options, onBusy, callback) {
  await assertSafeLifecyclePath(options.home, options.workflowId);
  const lockPath = `${lifecyclePath(options.home, options.workflowId)}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  let handle;
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
          "utf8",
        );
      } catch (error) {
        await handle.close();
        handle = undefined;
        await unlink(lockPath);
        throw error;
      }
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (attempt === 0 && (await recoverStaleLock(lockPath))) continue;
      if (attempt === maxAttempts - 1) return onBusy();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  if (!handle) return onBusy();
  try {
    return await callback();
  } finally {
    await handle.close();
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (lock?.token === token) await unlink(lockPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
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

/** @param {string} text */
function hasNegatedAuthorizationVerb(text) {
  const authorization = /\b(autorizo|autoriza|authorize|approve|apruebo|aprueba|inicia|ejecuta|genera|crea|implementa|implement|run|invoke|start|activa)\b/.exec(text);
  if (!authorization) return false;
  const negation = /\b(no|nunca|jamas|never|not|dont)\b/.exec(text);
  return Boolean(negation && /** @type {number} */ (negation.index) < authorization.index);
}

/** @param {string} text @param {string} terms */
function isTermNegated(text, terms) {
  const authorizationPattern = /\b(autorizo|autoriza|authorize|approve|apruebo|aprueba)\b/g;
  const negationPattern = /\b(no|nunca|jamas|never|not|dont|rechazo|rechaza|reject|deny|deniego|deniega)\b/g;
  const termPattern = new RegExp(`\\b(${terms})\\b`, "g");
  const authorizationIndexes = [...text.matchAll(authorizationPattern)].map((match) => match.index);
  const negationIndexes = [...text.matchAll(negationPattern)].map((match) => match.index);
  for (const term of text.matchAll(termPattern)) {
    const authorizationIndex = authorizationIndexes.filter((index) => index < term.index).at(-1);
    if (
      authorizationIndex !== undefined &&
      negationIndexes.some((index) => index > authorizationIndex && index < term.index)
    ) {
      return true;
    }
    for (const negationIndex of negationIndexes.filter((index) => index > term.index)) {
      const between = text.slice(term.index + term[0].length, negationIndex);
      const afterNegation = text.slice(negationIndex);
      const scopedSubject = /\b(merge|fusion|release|publicacion|produccion|production|activacion pagada|paid activation|operacion destructiva|destructive operation|requisitos|requirements|spec|plan|tickets?)\b/.exec(
        afterNegation,
      );
      if (/[?.!—]/.test(between) || !scopedSubject) return true;
      if (new RegExp(`\\b(${terms})\\b`).test(scopedSubject[0])) return true;
    }
  }
  return false;
}

/** @param {string} text @param {RegExp} termPattern */
function authorizationPrecedes(text, termPattern) {
  const authorization = /\b(autorizo|autoriza|authorize|approve|apruebo|aprueba)\b/.exec(text);
  const term = termPattern.exec(text);
  return Boolean(authorization && term && authorization.index < term.index);
}

/** @param {string} request */
function explicitTransition(request) {
  const text = normalized(request);
  if (hasNegatedAuthorizationVerb(text)) return null;
  if (/\b(invoca|ejecuta|inicia|activa|run|invoke)\b.*\bwayfinder\b/.test(text)) {
    return "invoke_wayfinder";
  }
  /** @type {[string, RegExp, string][]} */
  const sensitiveRequestPatterns = [
    ["merge", /\b(merge|fusion)\b/, "merge|fusion"],
    ["release", /\b(release|publicacion)\b/, "release|publicacion"],
    ["production", /\b(produccion|production)\b/, "produccion|production"],
    ["paid_activation", /\b(activacion pagada|paid activation|activar.*(pago|costo))\b/, "activacion pagada|paid activation"],
    ["destructive_operation", /\b(operacion destructiva|destructive operation|eliminacion destructiva)\b/, "operacion destructiva|destructive operation|eliminacion destructiva"],
  ];
  for (const operation of sensitiveRequestPatterns) {
    if (
      authorizationPrecedes(text, operation[1]) &&
      !isTermNegated(text, operation[2])
    ) {
      return `authorize_${operation[0]}`;
    }
  }
  if (/\b(implementa|implement|autoriza|authorize)\b.*\b(preview|vista previa)\b/.test(text)) {
    return "authorize_implement_preview";
  }
  if (
    /\b(apruebo|aprueba|approve)\b.*\b(requisitos|requirements)\b/.test(text) &&
    !isTermNegated(text, "requisitos|requirements")
  ) {
    return "approve_requirements";
  }
  if (
    /\b(apruebo|aprueba|approve)\b/.test(text) &&
    /\bspec\b/.test(text) &&
    /\bplan\b/.test(text) &&
    authorizationPrecedes(text, /\bspec\b/) &&
    authorizationPrecedes(text, /\bplan\b/) &&
    !isTermNegated(text, "spec") &&
    !isTermNegated(text, "plan")
  ) {
    return "approve_spec_plan";
  }
  if (
    /\b(apruebo|aprueba|approve)\b.*\b(tickets?)\b/.test(text) &&
    !isTermNegated(text, "tickets?")
  ) {
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
  return runLifecycleRequestInternal(options, false);
}

/**
 * @param {{home: string, workflowId: string, mode: "recommend" | "transition", request: string, terminalSlice?: string}} options
 * @param {boolean} lockHeld
 * @returns {Promise<any>}
 */
async function runLifecycleRequestInternal(options, lockHeld) {
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
  if (!lockHeld) {
    return withLifecycleLock(
      options,
      () => ({
        ok: false,
        operation: "lifecycle-request",
        selectedStage: null,
        transition: { status: "denied", operation, reason: "Lifecycle transition is already in progress" },
        state,
        evidence: state.evidence,
        externalSideEffects: [],
      }),
      () => runLifecycleRequestInternal(options, true),
    );
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
const requiredPreReleaseEvidence = new Set([
  "implement",
  "test",
  "validate",
  "review",
  "qa",
  "commit",
  "push",
  "open_pr",
  "publish_preview",
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
  const isDeliveryOperation = deliveryOperations.has(options.operation);
  const isSensitiveOperation = sensitiveOperations.has(options.operation);
  if (!isDeliveryOperation && !isSensitiveOperation) {
    throw new Error(`Unknown lifecycle operation: ${options.operation}`);
  }
  const initialState = await readLifecycleState(options);
  if (isDeliveryOperation && (!initialState.terminalSlice || !["delivery_authorized", "pre_release_ready"].includes(initialState.stage))) {
    return deniedExecution(initialState, options.operation, "Implement Preview has not authorized a terminal slice");
  }
  if (isSensitiveOperation && (
    initialState.stage !== "pre_release_ready" ||
    !initialState.authorizations.some((grant) => grant.operation === options.operation && grant.consumedAt === null)
  )) {
    return deniedExecution(
      initialState,
      options.operation,
      `No unconsumed authorization exists for ${options.operation}`,
    );
  }
  return withLifecycleLock(
    options,
    () => deniedExecution(initialState, options.operation, "Lifecycle operation is already in progress"),
    () => executeLifecycleOperationUnlocked(options),
  );
}

/** @param {{home: string, workflowId: string, operation: string}} options */
async function executeLifecycleOperationUnlocked(options) {
  const state = await readLifecycleState(options);
  const isDeliveryOperation = deliveryOperations.has(options.operation);

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

  if (options.operation === "generate_recap") {
    const completedOperations = new Set(
      state.evidence
        .filter((entry) => entry.operation.startsWith("execute_"))
        .map((entry) => entry.operation.slice("execute_".length)),
    );
    const missing = [...requiredPreReleaseEvidence].filter(
      (operation) => !completedOperations.has(operation),
    );
    if (missing.length > 0) {
      return deniedExecution(
        state,
        options.operation,
        `Missing delivery evidence: ${missing.join(", ")}`,
      );
    }
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
