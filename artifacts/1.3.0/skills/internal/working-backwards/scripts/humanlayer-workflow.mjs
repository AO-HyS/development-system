#!/usr/bin/env node

// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const WORKING_BACKWARDS_PHASES = Object.freeze([
  { role: "customer-story", label: "Future Customer Story", checkpoint: "document", fileStem: "customer-story" },
  { role: "research-questions", label: "Research Questions", checkpoint: "document", fileStem: "research-questions" },
  { role: "research-report", label: "Research Report", checkpoint: "document", fileStem: "research" },
  { role: "product-contract", label: "Product Contract", checkpoint: "product", fileStem: "product-contract" },
  { role: "technical-contract", label: "Technical Contract", checkpoint: "technical", fileStem: "technical-contract" },
  { role: "implementation-map", label: "Implementation Map", checkpoint: "implementation", fileStem: "implementation-map" },
  { role: "t3-handoff", label: "T3 Handoff", checkpoint: null, fileStem: "t3-handoff" },
]);

const formalOperations = Object.freeze({
  product: "approve-product-contract",
  technical: "approve-technical-contract",
  implementation: "approve-implementation-map",
});

const negativePattern = /\b(?:no|nunca|todavia no|aun no|rechazo|revoco|denegado|not|never|reject|revoke|don't|do not)\b/iu;
const ambiguousPattern = /\b(?:quiza|tal vez|a lo mejor|supongo|maybe|perhaps|probably)\b/iu;
const historicalPattern = /\b(?:habia|anteriormente|previamente|previously|already)\b|\bya\b[\s\S]*\b(?:aprobad|approved)\b/iu;
const revisionPattern = /\b(?:pero|aunque|excepto|cambia|cambiar|ajusta|ajustar|corrige|corregir|modifica|modificar|however|but|except|change|adjust|revise|fix)\b/iu;
const firstPersonApprovalPattern = /^(?:yo\s+)?(?:apruebo|lo apruebo|i approve)(?=\b|[,.!])/iu;
const standaloneApprovalPattern = /^(?:aprobado|approved)(?:[,.]?\s*(?:sigue|continua|adelante|avanza|next|continue|go ahead))?[.!]?$/iu;
const conversationalApprovalPattern = /\b(?:si|yes|claro|perfecto|listo|correcto|todo correcto|todo bien|de acuerdo|se ve bien|esta bien|me funciona|looks good|all good|okay|ok)\b/iu;
const advancePattern = /\b(?:sigue|seguir|continua|continuar|adelante|avanza|avanzar|pasemos al siguiente|next|continue|go ahead|move on)\b/iu;
const formalGateTermPattern = /\b(?:producto|product|tecnico|technical|tickets?|implementation map|mapa de implementacion)\b/giu;
const quotedOrReportedPattern = /["“”'‘’]|\b(?:dijo|dice|dicen|menciono|me dijeron|said|says|reported|reports)\b/iu;

/** @param {string} message */
export function classifyApproval(message) {
  const normalized = typeof message === "string" ? message.trim().replace(/\s+/g, " ") : "";
  const semantic = normalized.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const formalGateTerms = new Set([...semantic.matchAll(formalGateTermPattern)].map((match) => match[0]));
  const accepted = normalized.length > 0
    && normalized.length <= 160
    && !/[?¿]/u.test(normalized)
    && !quotedOrReportedPattern.test(semantic)
    && !negativePattern.test(semantic)
    && !ambiguousPattern.test(semantic)
    && !historicalPattern.test(semantic)
    && !revisionPattern.test(semantic)
    && formalGateTerms.size < 2
    && (firstPersonApprovalPattern.test(semantic) || standaloneApprovalPattern.test(semantic) || (conversationalApprovalPattern.test(semantic) && advancePattern.test(semantic)));
  return {
    accepted,
    normalized,
    reason: accepted ? "explicit-approval-at-active-checkpoint" : "feedback-or-ambiguous-language",
  };
}

/** @param {unknown} value @returns {unknown} */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
}

/** @param {unknown} value */
function hashValue(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

/** @param {unknown} candidate */
function isIsoDate(candidate) {
  return typeof candidate === "string" && !Number.isNaN(Date.parse(candidate));
}

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} taskDir */
function workflowId(taskDir) {
  const value = basename(taskDir);
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("HumanLayer task directory must have a path-safe slug");
  const directoryHash = createHash("sha256").update(resolve(taskDir)).digest("hex").slice(0, 12);
  return `${normalized.slice(0, 115)}-${directoryHash}`;
}

/** @param {string} content */
function roleFromFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/u);
  if (!match) return null;
  const role = match[1].match(/^working_backwards_role:\s*['"]?([a-z0-9-]+)['"]?\s*$/imu)?.[1] ?? null;
  return WORKING_BACKWARDS_PHASES.some((phase) => phase.role === role) ? role : null;
}

/** @param {string} content @param {string} key */
function frontmatterValue(content, key) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/u);
  if (!match) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return match[1].match(new RegExp(`^${escaped}:\\s*['\"]?([^'\"\\n]+)['\"]?\\s*$`, "imu"))?.[1]?.trim() ?? null;
}

/** @param {string} home @param {string} id */
function privateStatePath(home, id) {
  return resolve(home, ".development-system", "private", "working-backwards", id, "humanlayer-workflow.json");
}

/** @param {string} path */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** @param {string} taskDir */
async function readArtifacts(taskDir) {
  /** @type {Record<string, {role: string, path: string, fileName: string, contentHash: string}>} */
  const byRole = {};
  let entries;
  try {
    entries = await readdir(taskDir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".md")).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(taskDir, entry.name);
    const content = await readFile(path, "utf8");
    const role = roleFromFrontmatter(content);
    if (!role) continue;
    if (role === "t3-handoff") throw new Error("The T3 handoff is private and cannot live in the HumanLayer task directory");
    if (byRole[role]) throw new Error(`HumanLayer task has more than one ${role} artifact`);
    byRole[role] = { role, path, fileName: entry.name, content, contentHash: hashValue(content) };
  }
  return WORKING_BACKWARDS_PHASES.flatMap((phase) => byRole[phase.role] ? [byRole[phase.role]] : []);
}

/** @param {unknown} value */
function approvals(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];
}

const canonicalRoles = Object.freeze({
  "customer-story": ["working-backwards-brief"],
  "research-questions": ["research-questions"],
  "research-report": ["research-report"],
  "product-contract": ["product-contract"],
  "technical-contract": ["domain-technical-design"],
  "implementation-map": ["structure-outline", "ticket-map"],
  "t3-handoff": ["t3-implementation-handoff"],
});

const gateRoles = Object.freeze({
  product: ["working-backwards-brief", "research-questions", "research-report", "product-contract", "acceptance-contract"],
  technical: ["acceptance-contract", "product-contract", "domain-technical-design", "risk-evidence"],
  implementationMap: ["structure-outline", "ticket-map"],
});

/** @param {Record<string, unknown>} receipt */
function receiptBody(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    workflowId: receipt.workflowId,
    gate: receipt.gate,
    repositoryIdentity: receipt.repositoryIdentity,
    repositoryRevision: receipt.repositoryRevision,
    artifacts: receipt.artifacts,
    approvedAt: receipt.approvedAt,
  };
}

/** @param {string} value */
function normalizeRepositoryIdentity(value) {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "").replace(/\.git$/iu, "").toLowerCase();
}

/** @param {Record<string, unknown>} receipt */
function validGateReceipt(receipt) {
  if (receipt.schemaVersion !== 1 || !["product", "technical", "implementationMap"].includes(String(receipt.gate))) return false;
  if (typeof receipt.repositoryIdentity !== "string" || normalizeRepositoryIdentity(receipt.repositoryIdentity) !== receipt.repositoryIdentity) return false;
  if (typeof receipt.repositoryRevision !== "string" || typeof receipt.approvedAt !== "string" || !Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) return false;
  return receipt.receiptHash === hashValue(receiptBody(receipt));
}

/** @param {Awaited<ReturnType<typeof readArtifacts>>} artifacts @param {string} id @param {string} identity @param {string} revision */
function canonicalArtifactSnapshots(artifacts, id, identity, revision) {
  const snapshots = [];
  for (const artifact of artifacts) {
    for (const role of canonicalRoles[artifact.role] ?? []) {
      snapshots.push({
        id: `${id}:${role}`,
        role,
        contentHash: artifact.contentHash,
        sourceIdentity: identity,
        sourceRevision: revision,
        lineage: {
          dependsOn: snapshots.slice(-1).map((entry) => entry.id),
          governedBy: [],
          sourceIdentity: identity,
          sourceRevision: revision,
        },
      });
    }
  }
  return snapshots;
}

const lifecycleStages = ["idle", "requirements_in_progress", "requirements_approved", "spec_plan_ready", "spec_plan_approved", "tickets_ready", "tickets_approved", "delivery_authorized", "pre_release_ready"];
const lifecycleTransitions = Object.freeze({
  product: [
    ["start_requirements", "requirements_in_progress", "Inicia Working Backwards desde la historia futura del usuario"],
    ["approve_requirements", "requirements_approved", "Apruebo el Product Contract de Working Backwards"],
  ],
  technical: [
    ["create_spec_plan", "spec_plan_ready", "Genera el Technical Contract de Working Backwards"],
    ["approve_spec_plan", "spec_plan_approved", "Apruebo el Technical Contract de Working Backwards"],
  ],
  implementationMap: [
    ["create_tickets", "tickets_ready", "Genera el Implementation Map de Working Backwards"],
    ["approve_tickets", "tickets_approved", "Apruebo el Implementation Map de Working Backwards"],
  ],
});

/** @param {string} home @param {string} id */
function lifecycleStatePath(home, id) {
  return resolve(home, ".development-system", "lifecycles", `${id}.json`);
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
        if (!isMissing(removeError)) return false;
      }
    }
  }
  return false;
}

/** @param {string} lockPath */
async function recoverStaleLock(lockPath) {
  const recoveryPath = `${lockPath}.recovery`;
  if (!(await acquireRecoveryGuard(recoveryPath))) return false;
  try {
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (!lock || typeof lock !== "object" || typeof lock.pid !== "number" || !Number.isInteger(lock.pid) || lock.pid <= 0 || !isIsoDate(lock.createdAt)) {
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

/**
 * Share the canonical lifecycle lock filename and ownership protocol so a
 * HumanLayer gate cannot overwrite a simultaneous lifecycle operation.
 * @template T
 * @param {string} home
 * @param {string} id
 * @param {() => Promise<T>} callback
 */
async function withLifecycleLock(home, id, callback) {
  const directory = resolve(home, ".development-system", "lifecycles");
  if (!(await existsWithoutSymlink(directory))) await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const lockPath = `${lifecycleStatePath(home, id)}.lock`;
  const token = randomUUID();
  let handle;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`, "utf8");
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
      if (attempt === 49) throw new Error("Lifecycle transition is already in progress");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  if (!handle) throw new Error("Lifecycle transition is already in progress");
  try {
    return await callback();
  } finally {
    await handle.close();
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (lock?.token === token) await unlink(lockPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

/** @param {string} home @param {string} id @param {"product" | "technical" | "implementationMap"} gate @param {string} acceptedAt */
async function executeLifecycleGate(home, id, gate, acceptedAt) {
  await ensurePrivateDirectory(home, id);
  return withLifecycleLock(home, id, async () => {
    const path = lifecycleStatePath(home, id);
    const existing = await readJson(path);
    const state = existing ?? { schemaVersion: 1, workflowId: id, stage: "idle", optionalStage: null, terminalSlice: null, evidence: [], authorizations: [] };
    if (state.schemaVersion !== 1 || state.workflowId !== id || !lifecycleStages.includes(state.stage) || !Array.isArray(state.evidence) || !Array.isArray(state.authorizations)) {
      throw new Error("Lifecycle state schema is invalid");
    }
    const transitions = lifecycleTransitions[gate];
    for (const [operation, stageAfter, request] of transitions) {
      if (lifecycleStages.indexOf(state.stage) >= lifecycleStages.indexOf(stageAfter)) continue;
      const stageBefore = state.stage;
      state.stage = stageAfter;
      state.evidence.push({
        id: randomUUID(),
        recordedAt: acceptedAt,
        operation,
        request,
        authorization: "explicit-human-request",
        stageBefore,
        stageAfter,
      });
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await chmod(path, 0o600);
    return state;
  });
}

/** @param {string} content @param {{workflowId: string, gateReceiptPath: string, repositoryIdentity: string | null, repositoryRevision: string | undefined, receipts: Record<string, unknown>[], implementationMapContent: string | null}} expected */
function validPrivateHandoff(content, expected) {
  const receiptByGate = new Map(expected.receipts.map((receipt) => [receipt.gate, receipt]));
  const implementationReceipt = receiptByGate.get("implementationMap");
  const required = {
    working_backwards_role: "t3-handoff",
    workflow_id: expected.workflowId,
    gate_receipt_path: expected.gateReceiptPath,
    repository_identity: expected.repositoryIdentity,
    repository_revision: expected.repositoryRevision,
    product_receipt_hash: receiptByGate.get("product")?.receiptHash,
    technical_receipt_hash: receiptByGate.get("technical")?.receiptHash,
    implementation_map_receipt_hash: implementationReceipt?.receiptHash,
    implementation_map_hash: implementationReceipt?.ticketMapHash,
    implementationAuthorized: "false",
    requiresImplementPreview: "true",
  };
  if (Object.values(required).some((value) => typeof value !== "string" || value.length === 0)) return false;
  if (Object.entries(required).some(([key, value]) => frontmatterValue(content, key) !== value)) return false;
  const firstSlice = frontmatterValue(content, "first_slice");
  const approvedFirstSlice = expected.implementationMapContent ? frontmatterValue(expected.implementationMapContent, "working_backwards_first_slice") : null;
  return Boolean(firstSlice && approvedFirstSlice && firstSlice === approvedFirstSlice);
}

/**
 * Inspect the progressive HumanLayer surface without changing it.
 * @param {{home?: string, taskDir: string, repositoryIdentity?: string, repositoryRevision?: string}} input
 */
export async function inspectWorkflow(input) {
  const home = resolve(input.home ?? homedir());
  const taskDir = resolve(input.taskDir);
  const id = workflowId(taskDir);
  const statePath = privateStatePath(home, id);
  const gateReceiptPath = resolve(statePath, "..", "gate-receipts.json");
  const privateHandoffPath = resolve(statePath, "..", "t3-handoff.md");
  const persisted = await readJson(statePath);
  const artifacts = await readArtifacts(taskDir);
  const artifactByRole = new Map(artifacts.map((artifact) => [artifact.role, artifact]));
  const gateReceiptFile = await readJson(gateReceiptPath);
  const savedGateReceipts = approvals(gateReceiptFile?.receipts).filter(validGateReceipt);
  let privateHandoffInvalid = false;
  try {
    const content = await readFile(privateHandoffPath, "utf8");
    const valid = validPrivateHandoff(content, {
      workflowId: id,
      gateReceiptPath,
      repositoryIdentity: input.repositoryIdentity ? normalizeRepositoryIdentity(input.repositoryIdentity) : null,
      repositoryRevision: input.repositoryRevision,
      receipts: savedGateReceipts,
      implementationMapContent: artifactByRole.get("implementation-map")?.content ?? null,
    });
    if (valid) artifactByRole.set("t3-handoff", { role: "t3-handoff", path: privateHandoffPath, fileName: "t3-handoff.md", content, contentHash: hashValue(content) });
    else privateHandoffInvalid = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const savedApprovals = approvals(persisted?.documentApprovals);
  let invalidIndex = -1;
  for (let index = 0; index < savedApprovals.length; index += 1) {
    const approval = savedApprovals[index];
    const artifact = artifactByRole.get(approval.role);
    if (!artifact || artifact.contentHash !== approval.contentHash) {
      invalidIndex = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === approval.role);
      break;
    }
  }
  let invalidReason = invalidIndex >= 0 ? "artifact-drift" : null;
  const observedIdentity = input.repositoryIdentity ? normalizeRepositoryIdentity(input.repositoryIdentity) : null;
  if (observedIdentity && input.repositoryRevision) {
    for (const receipt of savedGateReceipts) {
      if (receipt.repositoryIdentity !== observedIdentity || receipt.repositoryRevision !== input.repositoryRevision) {
        const role = receipt.gate === "product" ? "product-contract" : receipt.gate === "technical" ? "technical-contract" : "implementation-map";
        const index = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === role);
        if (invalidIndex < 0 || index < invalidIndex) invalidIndex = index;
        invalidReason = "repository-drift";
      }
    }
  }
  const effectiveApprovals = savedApprovals.filter((approval) => {
    const index = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === approval.role);
    const phase = WORKING_BACKWARDS_PHASES[index];
    const formalReceipt = phase?.checkpoint === "product"
      ? savedGateReceipts.find((receipt) => receipt.gate === "product")
      : phase?.checkpoint === "technical"
        ? savedGateReceipts.find((receipt) => receipt.gate === "technical")
        : phase?.checkpoint === "implementation"
          ? savedGateReceipts.find((receipt) => receipt.gate === "implementationMap")
          : null;
    const formalReceiptMatches = !formalReceipt || (Array.isArray(formalReceipt.artifacts) && formalReceipt.artifacts.some((snapshot) => snapshot && typeof snapshot === "object" && snapshot.contentHash === approval.contentHash));
    const requiredFormalReceiptExists = !["product", "technical", "implementation"].includes(String(phase?.checkpoint)) || Boolean(formalReceipt);
    return index >= 0 && (invalidIndex < 0 || index < invalidIndex) && artifactByRole.get(approval.role)?.contentHash === approval.contentHash && requiredFormalReceiptExists && formalReceiptMatches;
  });
  const approvedRoles = new Set(effectiveApprovals.map((approval) => approval.role));
  let currentPhase = WORKING_BACKWARDS_PHASES.find((phase) => {
    if (!artifactByRole.has(phase.role)) return true;
    return phase.checkpoint !== null && !approvedRoles.has(phase.role);
  }) ?? WORKING_BACKWARDS_PHASES.at(-1);
  if (invalidIndex >= 0) currentPhase = WORKING_BACKWARDS_PHASES[invalidIndex];
  const currentArtifact = artifactByRole.get(currentPhase.role) ?? null;
  const action = currentPhase.role === "t3-handoff" && currentArtifact
    ? "handoff-ready"
    : currentPhase.role === "t3-handoff"
      ? "create-private-handoff"
    : currentArtifact
      ? "review-artifact"
      : "create-artifact";
  const gateReceipts = savedGateReceipts.filter((receipt) => {
    const role = receipt.gate === "product" ? "product-contract" : receipt.gate === "technical" ? "technical-contract" : "implementation-map";
    const index = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === role);
    return index >= 0 && (invalidIndex < 0 || index < invalidIndex) && approvedRoles.has(role);
  });
  return {
    ok: true,
    workflow: "working-backwards",
    profile: persisted?.profile ?? "Standard",
    workflowId: id,
    taskDir,
    statePath,
    gateReceiptPath,
    privateHandoffPath,
    currentPhase,
    currentArtifact,
    action,
    artifacts,
    documentApprovals: effectiveApprovals,
    gateReceipts,
    invalidFrom: invalidIndex >= 0 ? WORKING_BACKWARDS_PHASES[invalidIndex].role : null,
    invalidReason,
    privateHandoffInvalid,
    implementationAuthorized: false,
    externalSideEffects: [],
  };
}

/** @param {string} path */
async function existsWithoutSymlink(path) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Unsafe symbolic link in Working Backwards private path: ${path}`);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** @param {string} home @param {string} id */
async function ensurePrivateDirectory(home, id) {
  let current = resolve(home);
  if (!(await existsWithoutSymlink(current))) await mkdir(current, { mode: 0o700 });
  for (const segment of [".development-system", "private", "working-backwards", id]) {
    current = resolve(current, segment);
    if (!(await existsWithoutSymlink(current))) await mkdir(current, { mode: 0o700 });
    await chmod(current, 0o700);
  }
}

/** @param {string} home @param {string} id @param {string} path @param {unknown} value */
async function writePrivateJson(home, id, path, value) {
  await ensurePrivateDirectory(home, id);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/**
 * Record an approval only when a draft artifact is the active checkpoint and
 * the entire user message is an unambiguous approval phrase.
 * @param {{home?: string, taskDir: string, message: string, repositoryIdentity?: string, repositoryRevision?: string, now?: () => string}} input
 */
export async function recordHumanLayerTurn(input) {
  const before = await inspectWorkflow(input);
  const approval = classifyApproval(input.message);
  if (!approval.accepted || before.action !== "review-artifact" || !before.currentArtifact || before.currentPhase.checkpoint === null) {
    return { ...before, approval: { ...approval, accepted: false, kind: null } };
  }
  const checkpoint = before.currentPhase.checkpoint;
  if (checkpoint === "implementation" && !frontmatterValue(before.currentArtifact.content, "working_backwards_first_slice")) {
    throw new Error("Implementation Map approval requires working_backwards_first_slice in its frontmatter");
  }
  const operation = checkpoint === "document" ? null : formalOperations[checkpoint];
  if (operation && (!input.repositoryIdentity?.trim() || !input.repositoryRevision?.trim())) {
    throw new Error("formal Working Backwards approval requires repository identity and revision");
  }
  const prior = await readJson(before.statePath);
  const phaseIndex = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === before.currentPhase.role);
  const retainedDocuments = before.documentApprovals.filter((entry) => {
    const index = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === entry.role);
    return index >= 0 && index < phaseIndex;
  });
  const acceptedAt = typeof input.now === "function" ? input.now() : new Date().toISOString();
  const documentApproval = {
    role: before.currentPhase.role,
    artifactPath: before.currentArtifact.path,
    contentHash: before.currentArtifact.contentHash,
    acceptedAt,
    source: "humanlayer-live-session",
  };
  const retainedGates = before.gateReceipts.filter((receipt) => {
    const role = receipt.gate === "product" ? "product-contract" : receipt.gate === "technical" ? "technical-contract" : "implementation-map";
    const index = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === role);
    return index >= 0 && index < phaseIndex;
  });
  const gate = checkpoint === "product" ? "product" : checkpoint === "technical" ? "technical" : checkpoint === "implementation" ? "implementationMap" : null;
  const repositoryIdentity = operation ? normalizeRepositoryIdentity(input.repositoryIdentity) : null;
  const currentArtifacts = before.artifacts.filter((artifact) => {
    const index = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === artifact.role);
    return index >= 0 && index <= phaseIndex;
  });
  const allSnapshots = operation ? canonicalArtifactSnapshots(currentArtifacts, before.workflowId, repositoryIdentity, input.repositoryRevision.trim()) : [];
  const governingSnapshots = gate ? allSnapshots.filter((artifact) => gateRoles[gate].includes(artifact.role)) : [];
  const gateBody = operation ? {
    schemaVersion: 1,
    workflowId: before.workflowId,
    gate,
    repositoryIdentity,
    repositoryRevision: input.repositoryRevision.trim(),
    artifacts: governingSnapshots,
    approvedAt: acceptedAt,
  } : null;
  const gateReceipt = gateBody ? {
    ...gateBody,
    receiptHash: hashValue(receiptBody(gateBody)),
    ...(gate === "implementationMap"
      ? { ticketMapHash: governingSnapshots.find((artifact) => artifact.role === "ticket-map")?.contentHash ?? null }
      : {}),
  } : null;
  await writePrivateJson(resolve(input.home ?? homedir()), before.workflowId, before.statePath, {
    schemaVersion: 1,
    workflow: "working-backwards",
    workflowId: before.workflowId,
    profile: prior?.profile ?? "Standard",
    taskDir: before.taskDir,
    documentApprovals: [...retainedDocuments, documentApproval],
    implementationAuthorized: false,
  });
  if (gateReceipt) {
    await executeLifecycleGate(resolve(input.home ?? homedir()), before.workflowId, gate, acceptedAt);
    await writePrivateJson(resolve(input.home ?? homedir()), before.workflowId, before.gateReceiptPath, {
      schemaVersion: 1,
      workflowId: before.workflowId,
      receipts: [...retainedGates, gateReceipt],
    });
  }
  const after = await inspectWorkflow(input);
  return {
    ...after,
    approval: {
      ...approval,
      accepted: true,
      kind: operation ? "formal-gate" : "document",
      operation,
      role: before.currentPhase.role,
    },
  };
}

function parseCli(argv) {
  const [command, ...tokens] = argv;
  const options = { home: homedir() };
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === "--home") options.home = value;
    else if (key === "--task-dir") options.taskDir = value;
    else if (key === "--message") options.message = value;
    else if (key === "--repository-identity") options.repositoryIdentity = value;
    else if (key === "--repository-revision") options.repositoryRevision = value;
    else throw new Error(`Unknown option ${key}`);
  }
  if (!options.taskDir) throw new Error("--task-dir is required");
  return { command, options };
}

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));
  const result = command === "status"
    ? await inspectWorkflow(options)
    : command === "turn"
      ? await recordHumanLayerTurn(options)
      : (() => { throw new Error("Usage: humanlayer-workflow.mjs <status|turn> --task-dir <path> [options]"); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
