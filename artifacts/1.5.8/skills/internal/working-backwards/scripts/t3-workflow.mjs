#!/usr/bin/env node

// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { buildTechnicalReaderModel, renderTechnicalReaderHtml, renderTechnicalReaderLibraryHtml } from "./t3-reader.mjs";

export const WORKING_BACKWARDS_PHASES = Object.freeze([
  { role: "product-grill", label: "Product Grill With Docs", checkpoint: "document", fileStem: "product-grill" },
  { role: "customer-story", label: "Future Customer Story", checkpoint: "document", fileStem: "customer-story" },
  { role: "technical-grill", label: "Technical Grill With Docs", checkpoint: "document", fileStem: "technical-grill" },
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
const noChangeApprovalPattern = /\b(?:no\s+(?:tengo|hay|necesito|quiero|veo)\s+(?:ningun(?:a|os|as)?\s+)?(?:cambios?|ajustes?|correcciones?|comentarios?)|no\s+hace\s+falta\s+(?:cambiar|ajustar|corregir)\s+nada|sin\s+cambios?|nada\s+que\s+(?:cambiar|ajustar|corregir))\b/iu;
const firstPersonApprovalPattern = /^(?:yo\s+)?(?:apruebo|lo apruebo|i approve)(?=\b|[,.!])/iu;
const standaloneApprovalPattern = /^(?:aprobado|approved)(?:[,.]?\s*(?:sigue|continua|adelante|avanza|next|continue|go ahead))?[.!]?$/iu;
const directConversationalApprovalPattern = /^(?:si|yes|claro|perfecto(?:\s+todo(?:\s+aqui)?)?|excelente|listo|correcto|muy bien|todo(?:\s+(?:esto|lo\s+recomendado))?\s+(?:esta\s+)?(?:muy\s+)?bien|todo correcto|de acuerdo|se ve (?:muy )?bien|esta (?:muy )?bien|me (?:gusta(?:\s+como\s+quedo)?|parece (?:muy )?(?:bien|correcto|perfecto))|por mi (?:esta )?(?:muy )?(?:bien|correcto|perfecto)|lo veo (?:muy )?bien|ya quedo|suena (?:muy )?bien|looks good|all good|okay|ok)[.!]*$/iu;
const conversationalApprovalPattern = /\b(?:si|yes|claro|perfecto|listo|correcto|todo correcto|todo bien|de acuerdo|se ve bien|esta bien|me funciona|me parece (?:muy )?(?:bien|correcto|perfecto)|por mi (?:esta )?(?:muy )?(?:bien|correcto|perfecto)|lo veo (?:muy )?bien|ya quedo|looks good|all good|okay|ok)\b/iu;
const advancePattern = /\b(?:sigue|seguir|continua|continuar|adelante|avanza|avanzar|dale|date|vamos a (?:lo que sigue|la siguiente (?:fase|etapa))|pasemos al siguiente|puedes (?:seguir|continuar|avanzar|pasar al siguiente)|next|continue|go ahead|move on)\b/iu;
const standaloneAdvancePattern = /^(?:adelante|dale|date|continua(?:\s+con\s+(?:el|la)\s+siguiente\s+(?:documento|fase|etapa|paso))?|sigue(?:\s+con\s+lo\s+que\s+sigue)?|vamos\s+a\s+(?:lo\s+que\s+sigue|la\s+siguiente\s+(?:fase|etapa))|pasemos\s+al\s+siguiente|next|continue|go ahead|move on)[.!]*$/iu;
const formalGateTermPattern = /\b(?:producto|product|tecnico|technical|tickets?|implementation map|mapa de implementacion)\b/giu;
const quotedOrReportedPattern = /["“”'‘’]|\b(?:dijo|dice|dicen|menciono|me dijeron|said|says|reported|reports)\b/iu;
const managedReaderMarker = '<meta name="generator" content="development-system-technical-reader">';
const legacyManagedReaderSignature = Object.freeze([
  '<meta name="robots" content="noindex,nofollow">',
  '<meta name="referrer" content="no-referrer">',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';',
  '<main class="reader-layout">',
  'data-mobile-reader',
  'data-theme-toggle',
]);

/** @param {string} message */
export function classifyApproval(message) {
  const normalized = typeof message === "string" ? message.trim().replace(/\s+/g, " ") : "";
  const semantic = normalized.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const safetySemantic = semantic.replace(noChangeApprovalPattern, " ").replace(/\s+/g, " ").trim();
  const formalGateTerms = new Set([...semantic.matchAll(formalGateTermPattern)].map((match) => match[0]));
  const accepted = normalized.length > 0
    && normalized.length <= 160
    && !/[?¿]/u.test(normalized)
    && !quotedOrReportedPattern.test(semantic)
    && !negativePattern.test(safetySemantic)
    && !ambiguousPattern.test(semantic)
    && !historicalPattern.test(semantic)
    && !revisionPattern.test(safetySemantic)
    && formalGateTerms.size < 2
    && (firstPersonApprovalPattern.test(semantic)
      || standaloneApprovalPattern.test(semantic)
      || directConversationalApprovalPattern.test(semantic)
      || standaloneAdvancePattern.test(semantic)
      || (noChangeApprovalPattern.test(semantic) && advancePattern.test(semantic))
      || (conversationalApprovalPattern.test(semantic) && advancePattern.test(semantic)));
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

/** @param {string} workspaceDir */
function workflowSlug(workspaceDir) {
  const value = basename(workspaceDir);
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("T3 Code Working Backwards workspace must have a path-safe slug");
  return normalized;
}

/** @param {string} workspaceDir */
function workflowId(workspaceDir) {
  const normalized = workflowSlug(workspaceDir);
  const directoryHash = createHash("sha256").update(resolve(workspaceDir)).digest("hex").slice(0, 12);
  return `${normalized.slice(0, 115)}-${directoryHash}`;
}

/** @param {string} slug */
function humanizeWorkflowSlug(slug) {
  return slug.replace(/[._-]+/gu, " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("es"));
}

/** @param {string} initiativeName @param {string} fallback */
function readerFileName(initiativeName, fallback) {
  const slug = initiativeName.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || fallback;
  return `${slug}.html`;
}

/** @param {string} html */
function isManagedTechnicalReader(html) {
  return html.includes(managedReaderMarker) || legacyManagedReaderSignature.every((part) => html.includes(part));
}

/** @param {string} path */
async function inspectTechnicalReaderOwnership(path) {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) return { managed: false, collision: { path, reason: "symbolic-link" } };
    if (!entry.isFile()) return { managed: false, collision: { path, reason: "non-regular-entry" } };
    const html = await readFile(path, "utf8");
    if (!isManagedTechnicalReader(html)) return { managed: false, collision: { path, reason: "unmanaged-regular-file" } };
    return { managed: true, collision: null };
  } catch (error) {
    if (isMissing(error)) return { managed: false, collision: null };
    throw error;
  }
}

/** @param {{path: string, reason: string}} collision */
function technicalReaderDestinationCollision(collision) {
  return Object.assign(new Error(`Technical Reader destination collision (${collision.reason}): ${collision.path}`), {
    code: "TECHNICAL_READER_DESTINATION_COLLISION",
    ...collision,
  });
}

/** @param {Awaited<ReturnType<typeof inspectT3Workflow>>} status */
async function retireLegacyWorkflowReader(status) {
  const legacyReaderPath = resolve(status.workspaceDir, "index.html");
  if (legacyReaderPath === status.readerPath || legacyReaderPath === status.readerLibraryPath) {
    return { retiredReaderPath: null, readerIndexCollision: null };
  }
  const ownership = await inspectTechnicalReaderOwnership(legacyReaderPath);
  if (ownership.collision) return { retiredReaderPath: null, readerIndexCollision: ownership.collision };
  if (!ownership.managed) return { retiredReaderPath: null, readerIndexCollision: null };
  try {
    await unlink(legacyReaderPath);
    return { retiredReaderPath: legacyReaderPath, readerIndexCollision: null };
  } catch (error) {
    if (isMissing(error)) return { retiredReaderPath: null, readerIndexCollision: null };
    throw error;
  }
}

/** @param {string} fromDir @param {string} target */
function localRelativeHref(fromDir, target) {
  return relative(fromDir, target).split(sep).map((segment) => encodeURIComponent(segment)).join("/");
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
  return resolve(home, ".development-system", "private", "working-backwards", id, "t3-workflow.json");
}

/** @param {string} home @param {string} workspaceDir */
function assertPrivateWorkspacePath(home, workspaceDir) {
  const root = resolve(home, ".development-system", "private", "working-backwards");
  const target = resolve(workspaceDir);
  const pathFromRoot = relative(root, target);
  if (!pathFromRoot || pathFromRoot === "." || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || resolve(root, pathFromRoot) !== target) {
    throw new Error("T3 Code Working Backwards workspace must be inside private Development System HOME");
  }
  return { root, target, segments: pathFromRoot.split(sep).filter(Boolean) };
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

/**
 * Validate every existing component before any private workspace read or write.
 * Missing suffixes are allowed because `render` creates them later.
 * @param {string} home
 * @param {string} workspaceDir
 */
async function assertSafePrivateWorkspacePath(home, workspaceDir) {
  const privatePath = assertPrivateWorkspacePath(home, workspaceDir);
  let current = resolve(home);
  if (!(await existsWithoutSymlink(current))) return privatePath;
  for (const segment of [".development-system", "private", "working-backwards", ...privatePath.segments]) {
    current = resolve(current, segment);
    if (!(await existsWithoutSymlink(current))) break;
  }
  return privatePath;
}

/** @param {string} workspaceDir */
async function readArtifacts(workspaceDir) {
  /** @type {Record<string, {role: string, path: string, fileName: string, contentHash: string}>} */
  const byRole = {};
  let entries;
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".md")).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(workspaceDir, entry.name);
    const content = await readFile(path, "utf8");
    const role = roleFromFrontmatter(content);
    if (!role) continue;
    if (role === "t3-handoff") throw new Error("The T3 handoff is private and cannot live in the T3 Code planning workspace");
    if (byRole[role]) throw new Error(`T3 Code Working Backwards workspace has more than one ${role} artifact`);
    byRole[role] = { role, path, fileName: entry.name, content, contentHash: hashValue(content) };
  }
  return WORKING_BACKWARDS_PHASES.flatMap((phase) => byRole[phase.role] ? [byRole[phase.role]] : []);
}

/** @param {unknown} value */
function approvals(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];
}

const canonicalRoles = Object.freeze({
  "product-grill": ["product-grill-evidence"],
  "customer-story": ["working-backwards-brief"],
  "technical-grill": ["technical-grill-evidence"],
  "research-questions": ["research-questions"],
  "research-report": ["research-report"],
  "product-contract": ["product-contract"],
  "technical-contract": ["domain-technical-design"],
  "implementation-map": ["structure-outline", "ticket-map"],
  "t3-handoff": ["t3-implementation-handoff"],
});

const gateRoles = Object.freeze({
  product: ["product-grill-evidence", "working-backwards-brief", "research-questions", "research-report", "product-contract", "acceptance-contract"],
  technical: ["technical-grill-evidence", "acceptance-contract", "product-contract", "domain-technical-design", "risk-evidence"],
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
 * T3 Code gate cannot overwrite a simultaneous lifecycle operation.
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

/**
 * Drift revokes every descendant authorization in the shared lifecycle. This
 * reconciliation is intentionally safety-increasing: a later lifecycle
 * execute cannot keep using a superseded terminal slice.
 * @param {string} home
 * @param {string} id
 * @param {number} invalidIndex
 * @param {string} reason
 */
async function invalidateLifecycleAfterDrift(home, id, invalidIndex, reason) {
  const productIndex = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === "product-contract");
  const technicalIndex = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === "technical-contract");
  const implementationIndex = WORKING_BACKWARDS_PHASES.findIndex((phase) => phase.role === "implementation-map");
  const allowedStage = invalidIndex <= productIndex
    ? "requirements_in_progress"
    : invalidIndex <= technicalIndex
      ? "spec_plan_ready"
      : invalidIndex <= implementationIndex
        ? "tickets_ready"
        : "tickets_approved";
  await ensurePrivateDirectory(home, id);
  await withLifecycleLock(home, id, async () => {
    const path = lifecycleStatePath(home, id);
    const existing = await readJson(path);
    if (!existing) return;
    if (existing.schemaVersion !== 1 || existing.workflowId !== id || !lifecycleStages.includes(existing.stage) || !Array.isArray(existing.evidence) || !Array.isArray(existing.authorizations)) {
      throw new Error("Lifecycle state schema is invalid");
    }
    const stageMustRewind = lifecycleStages.indexOf(existing.stage) > lifecycleStages.indexOf(allowedStage);
    if (!stageMustRewind && !existing.terminalSlice && existing.authorizations.length === 0) return;
    const recordedAt = new Date().toISOString();
    const stageBefore = existing.stage;
    const next = {
      ...existing,
      stage: stageMustRewind ? allowedStage : existing.stage,
      terminalSlice: null,
      authorizations: [],
      evidence: [...existing.evidence, {
        id: randomUUID(),
        recordedAt,
        operation: "invalidate_working_backwards_drift",
        request: reason,
        authorization: "system-invalidation",
        stageBefore,
        stageAfter: stageMustRewind ? allowedStage : existing.stage,
      }],
    };
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await chmod(path, 0o600);
  });
}

/** @param {string} content */
function implementationTickets(content) {
  const body = content.replace(/^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/u, "");
  const headings = [...body.matchAll(/^##\s+`?([A-Za-z][A-Za-z0-9._-]*)`?(?:\s*(?:[-—:]|\s)\s*.*)?$/gmu)];
  return headings.map((heading, index) => {
    const start = /** @type {number} */ (heading.index) + heading[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    return { id: heading[1], body: body.slice(start, end) };
  });
}

/** @param {string} content @param {string} firstSlice */
function validateFirstExecutableSlice(content, firstSlice) {
  const tickets = implementationTickets(content);
  const matches = tickets.filter((ticket) => ticket.id === firstSlice);
  if (matches.length !== 1) throw new Error(`Implementation Map first slice must identify exactly one ticket heading: ${firstSlice}`);
  const section = matches[0].body.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const headings = [...section.matchAll(/^#{3,4}[ \t]+(outcome|resultado|objetivo|acceptance|aceptacion|criterios? de aceptacion|checks?|verificacion|validacion|pruebas?|dependencies|dependencias)[ \t]*:?[ \t]*(.*)$/gimu)];
  /** @type {Record<string, string>} */
  const bodies = {};
  const aliases = new Map([
    ["outcome", "outcome"], ["resultado", "outcome"], ["objetivo", "outcome"],
    ["acceptance", "acceptance"], ["aceptacion", "acceptance"], ["criterio de aceptacion", "acceptance"], ["criterios de aceptacion", "acceptance"],
    ["check", "checks"], ["checks", "checks"], ["verificacion", "checks"], ["validacion", "checks"], ["prueba", "checks"], ["pruebas", "checks"],
    ["dependencies", "dependencies"], ["dependencias", "dependencies"],
  ]);
  for (const [index, heading] of headings.entries()) {
    const key = aliases.get(heading[1].toLowerCase());
    if (!key) continue;
    const start = /** @type {number} */ (heading.index) + heading[0].length;
    const end = headings[index + 1]?.index ?? section.length;
    bodies[key] = `${heading[2] ?? ""}\n${section.slice(start, end)}`.trim();
  }
  const placeholder = /^(?:[-*]\s*)?(?:todo|tbd|pendiente|por definir|n\/a)?[.!]?$/iu;
  const missing = ["outcome", "acceptance", "checks", "dependencies"].filter((key) => !bodies[key] || placeholder.test(bodies[key]));
  if (missing.length > 0) throw new Error(`Implementation Map first slice is not executable; missing: ${missing.join(", ")}`);
  const dependencies = bodies.dependencies.replace(/^[-*]\s*/gmu, "").trim();
  if (!/^(?:none|ninguna?s?|no aplica|n\/a|\[\])(?:[.!])?$/iu.test(dependencies)) {
    throw new Error("Implementation Map first slice must have no unresolved dependencies");
  }
  return matches[0];
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
  if (!firstSlice || !approvedFirstSlice || firstSlice !== approvedFirstSlice || !expected.implementationMapContent) return false;
  try {
    validateFirstExecutableSlice(expected.implementationMapContent, approvedFirstSlice);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect the progressive T3 Code surface without changing it.
 * @param {{home?: string, workspaceDir: string, repositoryIdentity?: string, repositoryRevision?: string, initiativeName?: string}} input
 */
export async function inspectT3Workflow(input) {
  const home = resolve(input.home ?? homedir());
  const workspaceDir = resolve(input.workspaceDir);
  const privatePath = await assertSafePrivateWorkspacePath(home, workspaceDir);
  const slug = workflowSlug(workspaceDir);
  const id = workflowId(workspaceDir);
  const statePath = privateStatePath(home, id);
  const gateReceiptPath = resolve(statePath, "..", "gate-receipts.json");
  const privateHandoffPath = resolve(statePath, "..", "t3-handoff.md");
  const persisted = await readJson(statePath);
  const artifacts = await readArtifacts(workspaceDir);
  const declaredInitiative = artifacts.map((artifact) => frontmatterValue(artifact.content, "initiative_name") ?? frontmatterValue(artifact.content, "initiative")).find(Boolean) ?? null;
  const initiativeName = input.initiativeName?.trim() || (typeof persisted?.initiativeName === "string" ? persisted.initiativeName.trim() : "") || declaredInitiative || humanizeWorkflowSlug(slug);
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
  const observedIdentity = input.repositoryIdentity
    ? normalizeRepositoryIdentity(input.repositoryIdentity)
    : typeof persisted?.repositoryIdentity === "string"
      ? normalizeRepositoryIdentity(persisted.repositoryIdentity)
      : null;
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
  if (invalidIndex >= 0) await invalidateLifecycleAfterDrift(home, id, invalidIndex, invalidReason ?? "working-backwards-drift");
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
    workflowSlug: slug,
    initiativeName,
    workspaceDir,
    readerPath: resolve(workspaceDir, readerFileName(initiativeName, slug)),
    readerLibraryPath: resolve(privatePath.root, "index.html"),
    readerLibraryCatalogPath: resolve(privatePath.root, "reader-library.json"),
    repositoryIdentity: observedIdentity,
    repositoryRevision: input.repositoryRevision ?? null,
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

/** @param {string} action @param {string} phaseLabel */
function readerNextAction(action, phaseLabel) {
  if (action === "create-artifact") return `Crear ${phaseLabel}`;
  if (action === "review-artifact") return `Revisar y aprobar ${phaseLabel}`;
  if (action === "create-private-handoff") return "Crear el handoff privado para T3 Code";
  return "Working Backwards terminó; el handoff está listo para Implement Preview";
}

/** @param {Awaited<ReturnType<typeof inspectT3Workflow>>} status */
export function renderT3Reader(status) {
  const approved = new Set(status.documentApprovals.map((approval) => approval.role));
  const artifactByRole = new Map(status.artifacts.map((artifact) => [artifact.role, artifact]));
  const displayArtifact = status.currentPhase.role === "t3-handoff"
    ? null
    : status.currentArtifact ?? status.artifacts.at(-1) ?? null;
  const displayPhase = WORKING_BACKWARDS_PHASES.find((phase) => phase.role === displayArtifact?.role) ?? status.currentPhase;
  const displayIsActive = displayArtifact?.role === status.currentPhase.role && status.action === "review-artifact";
  const markdown = status.currentPhase.role === "t3-handoff"
    ? `# T3 Handoff privado

El handoff permanece en el directorio privado del workflow. Estado: ${status.action === "handoff-ready" ? "listo y vinculado" : "pendiente"}.

> [!IMPORTANT]
> La implementación continúa sin autorización hasta un Implement Preview explícito.`
    : displayArtifact?.content ?? `# ${status.currentPhase.label}

Este documento todavía no se ha creado.`;
  const artifacts = WORKING_BACKWARDS_PHASES.map((phase) => {
    const artifact = artifactByRole.get(phase.role);
    const complete = approved.has(phase.role) || (phase.role === "t3-handoff" && status.action === "handoff-ready");
    const active = phase.role === status.currentPhase.role && !complete;
    return {
      id: phase.role,
      label: phase.label,
      state: complete ? "complete" : active ? "active" : "pending",
      fileName: artifact?.fileName ?? null,
    };
  });
  const model = buildTechnicalReaderModel({
    language: "es",
    productName: "Working Backwards",
    workflow: {
      id: status.workflowId,
      name: status.initiativeName,
      slug: status.workflowSlug,
      profile: status.profile,
      action: readerNextAction(status.action, status.currentPhase.label),
      implementationAuthorized: status.implementationAuthorized,
      repository: status.repositoryIdentity,
      revision: status.repositoryRevision,
      libraryHref: localRelativeHref(status.workspaceDir, status.readerLibraryPath),
    },
    document: {
      type: displayPhase.label,
      status: displayIsActive ? "En revisión" : displayArtifact ? "Aprobado" : status.action === "handoff-ready" ? "Listo" : "Pendiente",
      profile: status.profile,
      repository: status.repositoryIdentity,
      sourceFile: displayArtifact?.fileName ?? null,
      markdown,
    },
    artifacts,
  });
  return renderTechnicalReaderHtml(model);
}

/** @param {string} action @param {string | null} invalidFrom */
function readerLibraryStatus(action, invalidFrom) {
  if (invalidFrom) return "needs-review";
  if (action === "handoff-ready") return "ready";
  if (action === "review-artifact") return "in-review";
  return "in-progress";
}

/** @param {unknown} value @param {string} fallback */
function readerLibraryDate(value, fallback) {
  return isIsoDate(value) ? new Date(String(value)).toISOString() : fallback;
}

/**
 * Upsert one metadata-only entry and regenerate the private library HTML.
 * The library never stores Markdown bodies or gate receipts.
 * @param {{home?: string, now?: () => string}} input
 * @param {Awaited<ReturnType<typeof inspectT3Workflow>>} status
 */
async function writeReaderLibrary(input, status) {
  const home = resolve(input.home ?? homedir());
  const timestamp = typeof input.now === "function" ? input.now() : new Date().toISOString();
  if (!isIsoDate(timestamp)) throw new Error("Technical Reader library timestamp must be an ISO date");
  return withLifecycleLock(home, "technical-reader-library", async () => {
    for (const path of [status.readerLibraryCatalogPath, status.readerLibraryPath]) {
      await existsWithoutSymlink(path);
    }
    const existing = await readJson(status.readerLibraryCatalogPath);
    if (existing && (existing.schemaVersion !== 1 || !Array.isArray(existing.entries))) {
      throw new Error("Technical Reader library catalog is invalid");
    }
    const priorEntries = Array.isArray(existing?.entries) ? existing.entries.filter((entry) => entry && typeof entry === "object") : [];
    const previous = priorEntries.find((entry) => entry.id === status.workflowId) ?? null;
    const declaredCreatedAt = status.artifacts.map((artifact) => frontmatterValue(artifact.content, "created_at") ?? frontmatterValue(artifact.content, "createdAt")).find(Boolean);
    const entry = {
      id: status.workflowId,
      name: status.initiativeName,
      slug: status.workflowSlug,
      repository: status.repositoryIdentity,
      phase: status.currentPhase.label,
      phaseRole: status.currentPhase.role,
      status: readerLibraryStatus(status.action, status.invalidFrom),
      createdAt: readerLibraryDate(previous?.createdAt ?? declaredCreatedAt, timestamp),
      updatedAt: new Date(timestamp).toISOString(),
      nextAction: readerNextAction(status.action, status.currentPhase.label),
      readerHref: localRelativeHref(resolve(status.readerLibraryPath, ".."), status.readerPath),
    };
    const retained = priorEntries.filter((candidate) => candidate.id !== status.workflowId).map((candidate) => ({
      id: typeof candidate.id === "string" ? candidate.id : "",
      name: typeof candidate.name === "string" ? candidate.name : "",
      slug: typeof candidate.slug === "string" ? candidate.slug : "",
      repository: typeof candidate.repository === "string" ? candidate.repository : null,
      phase: typeof candidate.phase === "string" ? candidate.phase : "",
      phaseRole: typeof candidate.phaseRole === "string" ? candidate.phaseRole : "",
      status: typeof candidate.status === "string" ? candidate.status : "",
      createdAt: readerLibraryDate(candidate.createdAt, timestamp),
      updatedAt: readerLibraryDate(candidate.updatedAt, timestamp),
      nextAction: typeof candidate.nextAction === "string" ? candidate.nextAction : "",
      readerHref: typeof candidate.readerHref === "string" ? candidate.readerHref : "",
    })).filter((candidate) => candidate.id && candidate.slug && candidate.readerHref);
    const catalog = { schemaVersion: 1, generatedAt: new Date(timestamp).toISOString(), entries: [...retained, entry].sort((left, right) => left.slug.localeCompare(right.slug)) };
    const catalogTemporary = `${status.readerLibraryCatalogPath}.${randomUUID()}.tmp`;
    const htmlTemporary = `${status.readerLibraryPath}.${randomUUID()}.tmp`;
    await writeFile(catalogTemporary, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await writeFile(htmlTemporary, renderTechnicalReaderLibraryHtml({ language: "es", entries: catalog.entries }), { encoding: "utf8", mode: 0o600 });
    await chmod(catalogTemporary, 0o600);
    await chmod(htmlTemporary, 0o600);
    await rename(catalogTemporary, status.readerLibraryCatalogPath);
    await rename(htmlTemporary, status.readerLibraryPath);
    await chmod(status.readerLibraryCatalogPath, 0o600);
    await chmod(status.readerLibraryPath, 0o600);
    return { readerLibraryPath: status.readerLibraryPath, readerLibraryCatalogPath: status.readerLibraryCatalogPath };
  });
}

/** @param {{home?: string, workspaceDir: string, repositoryIdentity?: string, repositoryRevision?: string, initiativeName?: string, now?: () => string}} input */
export async function writeT3Reader(input) {
  const workspaceDir = resolve(input.workspaceDir);
  const home = resolve(input.home ?? homedir());
  const privatePath = assertPrivateWorkspacePath(home, workspaceDir);
  let current = resolve(home);
  for (const segment of [".development-system", "private", "working-backwards", ...privatePath.segments]) {
    current = resolve(current, segment);
    if (!(await existsWithoutSymlink(current))) await mkdir(current, { mode: 0o700 });
    await chmod(current, 0o700);
  }
  const status = await inspectT3Workflow(input);
  const destinationOwnership = await inspectTechnicalReaderOwnership(status.readerPath);
  if (destinationOwnership.collision) throw technicalReaderDestinationCollision(destinationOwnership.collision);
  const temporary = `${status.readerPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, renderT3Reader(status), { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, status.readerPath);
  await chmod(status.readerPath, 0o600);
  const retirement = await retireLegacyWorkflowReader(status);
  const library = await writeReaderLibrary(input, status);
  return { ...status, ...library, readerWritten: true, ...retirement, localWrites: [status.readerPath, library.readerLibraryCatalogPath, library.readerLibraryPath] };
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
 * @param {{home?: string, workspaceDir: string, message: string, repositoryIdentity?: string, repositoryRevision?: string, repositoryPath?: string, initiativeName?: string, now?: () => string}} input
 */
export async function recordT3Turn(input) {
  const before = await inspectT3Workflow(input);
  const approval = classifyApproval(input.message);
  if (!approval.accepted || before.action !== "review-artifact" || !before.currentArtifact || before.currentPhase.checkpoint === null) {
    return { ...before, approval: { ...approval, accepted: false, kind: null } };
  }
  const checkpoint = before.currentPhase.checkpoint;
  if (checkpoint === "implementation") {
    const firstSlice = frontmatterValue(before.currentArtifact.content, "working_backwards_first_slice");
    if (!firstSlice) throw new Error("Implementation Map approval requires working_backwards_first_slice in its frontmatter");
    validateFirstExecutableSlice(before.currentArtifact.content, firstSlice);
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
    source: "t3-code-live-session",
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
    initiativeName: before.initiativeName,
    profile: prior?.profile ?? "Standard",
    workspaceDir: before.workspaceDir,
    repositoryIdentity: operation ? repositoryIdentity : prior?.repositoryIdentity ?? (input.repositoryIdentity ? normalizeRepositoryIdentity(input.repositoryIdentity) : null),
    repositoryRevision: operation ? input.repositoryRevision.trim() : prior?.repositoryRevision ?? input.repositoryRevision ?? null,
    repositoryPath: input.repositoryPath ? resolve(input.repositoryPath) : prior?.repositoryPath ?? null,
    approvedFirstSlice: checkpoint === "implementation" ? frontmatterValue(before.currentArtifact.content, "working_backwards_first_slice") : prior?.approvedFirstSlice ?? null,
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
  const after = await writeT3Reader(input);
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
    else if (key === "--workspace-dir") options.workspaceDir = value;
    else if (key === "--message") options.message = value;
    else if (key === "--repository-identity") options.repositoryIdentity = value;
    else if (key === "--repository-revision") options.repositoryRevision = value;
    else if (key === "--repository-path") options.repositoryPath = value;
    else if (key === "--initiative-name") options.initiativeName = value;
    else throw new Error(`Unknown option ${key}`);
  }
  if (!options.workspaceDir) throw new Error("--workspace-dir is required");
  return { command, options };
}

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));
  const result = command === "status"
    ? await inspectT3Workflow(options)
    : command === "turn"
      ? await recordT3Turn(options)
      : command === "render"
        ? await writeT3Reader(options)
        : (() => { throw new Error("Usage: t3-workflow.mjs <status|turn|render> --workspace-dir <path> [options]"); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
