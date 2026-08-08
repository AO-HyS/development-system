// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const WORKING_BACKWARDS_GATES = Object.freeze(["product", "technical", "implementationMap"]);

/** @param {unknown} value */
export function normalizeWorkingBackwardsRepositoryIdentity(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
}

export const WORKING_BACKWARDS_GATE_ROLES = Object.freeze({
  product: Object.freeze(["working-backwards-brief", "research-questions", "research-report", "product-contract", "acceptance-contract"]),
  technical: Object.freeze(["acceptance-contract", "product-contract", "domain-technical-design", "risk-evidence"]),
  implementationMap: Object.freeze(["structure-outline", "ticket-map"]),
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {unknown} */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
}

/** @param {unknown} value */
export function hashWorkingBackwardsValue(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

/** @param {string} workflowId */
function assertWorkflowId(workflowId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workflowId)) throw new Error("workflowId must be a path-safe identifier");
}

/** @param {string} home @param {string} workflowId */
function receiptPath(home, workflowId) {
  assertWorkflowId(workflowId);
  const root = resolve(home);
  const target = resolve(root, ".development-system", "private", "working-backwards", workflowId, "gate-receipts.json");
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Working Backwards receipt path escapes HOME");
  return target;
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

/** @param {string} home @param {string} workflowId */
async function ensurePrivateDirectory(home, workflowId) {
  const root = resolve(home);
  if (!(await existsWithoutSymlink(root))) await mkdir(root, { mode: 0o700 });
  let current = root;
  for (const segment of [".development-system", "private", "working-backwards", workflowId]) {
    current = resolve(current, segment);
    if (!(await existsWithoutSymlink(current))) await mkdir(current, { mode: 0o700 });
    await chmod(current, 0o700);
  }
}

/** @param {unknown} value */
function normalizeReceiptFile(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.workflowId !== "string" || !Array.isArray(value.receipts)) {
    throw new Error("Invalid Working Backwards gate receipt file");
  }
  const receipts = value.receipts.filter(isRecord);
  if (receipts.some((receipt) => !WORKING_BACKWARDS_GATES.includes(String(receipt.gate)))) throw new Error("Invalid Working Backwards gate receipt");
  if (receipts.some((receipt) => !hasValidReceiptIntegrity(receipt))) throw new Error("Invalid Working Backwards gate receipt integrity");
  return { workflowId: value.workflowId, receipts };
}

/** @param {{home: string, workflowId: string}} options */
export async function readWorkingBackwardsGateReceipts(options) {
  const path = receiptPath(options.home, options.workflowId);
  try {
    const parsed = normalizeReceiptFile(JSON.parse(await readFile(path, "utf8")));
    if (parsed.workflowId !== options.workflowId) throw new Error("Working Backwards receipt workflow mismatch");
    return parsed.receipts;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** @param {Record<string, unknown>} artifact */
function artifactSnapshot(artifact) {
  return {
    id: artifact.id,
    role: artifact.role,
    contentHash: artifact.contentHash,
    sourceIdentity: artifact.sourceIdentity,
    sourceRevision: artifact.sourceRevision,
    lineage: artifact.lineage,
  };
}

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

/** @param {Record<string, unknown>} receipt */
function hasValidReceiptIntegrity(receipt) {
  if (receipt.schemaVersion !== 1 || typeof receipt.workflowId !== "string" || normalizeWorkingBackwardsRepositoryIdentity(receipt.repositoryIdentity) !== receipt.repositoryIdentity || typeof receipt.repositoryRevision !== "string" || typeof receipt.approvedAt !== "string") return false;
  const gate = String(receipt.gate);
  if (!WORKING_BACKWARDS_GATES.includes(gate) || !Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) return false;
  const roles = WORKING_BACKWARDS_GATE_ROLES[/** @type {keyof typeof WORKING_BACKWARDS_GATE_ROLES} */ (gate)];
  if (!receipt.artifacts.some((artifact) => isRecord(artifact) && roles.includes(String(artifact.role)))) return false;
  if (receipt.artifacts.some((artifact) => !isRecord(artifact) || typeof artifact.id !== "string" || typeof artifact.role !== "string" || typeof artifact.contentHash !== "string" || artifact.sourceIdentity !== receipt.repositoryIdentity || typeof artifact.sourceRevision !== "string" || !isRecord(artifact.lineage) || artifact.lineage.sourceIdentity !== receipt.repositoryIdentity || artifact.lineage.sourceRevision !== artifact.sourceRevision)) return false;
  return receipt.receiptHash === hashWorkingBackwardsValue(receiptBody(receipt));
}

/** @param {{workflowId: string, gate: string, repositoryIdentity: string, repositoryRevision: string, artifacts: Record<string, unknown>[], approvedAt?: string}} options */
export function createWorkingBackwardsGateReceipt(options) {
  if (!WORKING_BACKWARDS_GATES.includes(options.gate)) throw new Error("Unknown Working Backwards gate");
  const roles = WORKING_BACKWARDS_GATE_ROLES[/** @type {keyof typeof WORKING_BACKWARDS_GATE_ROLES} */ (options.gate)];
  const artifacts = options.artifacts.filter((artifact) => roles.includes(String(artifact.role))).map(artifactSnapshot);
  if (artifacts.length === 0) throw new Error(`${options.gate} gate has no artifacts to approve`);
  const repositoryIdentity = normalizeWorkingBackwardsRepositoryIdentity(options.repositoryIdentity);
  if (!repositoryIdentity) throw new Error("Working Backwards gate receipt requires repository identity");
  if (artifacts.some((artifact) => artifact.sourceIdentity !== repositoryIdentity || artifact.sourceRevision !== options.repositoryRevision || !isRecord(artifact.lineage) || artifact.lineage.sourceIdentity !== repositoryIdentity || artifact.lineage.sourceRevision !== options.repositoryRevision)) throw new Error(`${options.gate} gate artifacts do not match repository identity and revision`);
  const body = {
    schemaVersion: 1,
    workflowId: options.workflowId,
    gate: options.gate,
    repositoryIdentity,
    repositoryRevision: options.repositoryRevision,
    artifacts,
    approvedAt: options.approvedAt ?? new Date().toISOString(),
  };
  return {
    ...body,
    receiptHash: hashWorkingBackwardsValue(body),
    ...(options.gate === "implementationMap"
      ? { ticketMapHash: artifacts.find((artifact) => artifact.role === "ticket-map")?.contentHash ?? null }
      : {}),
  };
}

/** @param {{home: string, workflowId: string, receipt: Record<string, unknown>}} options */
export async function persistWorkingBackwardsGateReceipt(options) {
  const gate = String(options.receipt.gate);
  const gateIndex = WORKING_BACKWARDS_GATES.indexOf(gate);
  if (gateIndex < 0) throw new Error("Unknown Working Backwards gate");
  if (!hasValidReceiptIntegrity(options.receipt)) throw new Error("Cannot persist an invalid Working Backwards gate receipt");
  const existing = await readWorkingBackwardsGateReceipts(options);
  const priorRequired = WORKING_BACKWARDS_GATES.slice(0, gateIndex);
  if (!priorRequired.every((required) => existing.some((receipt) => receipt.gate === required))) {
    throw new Error(`Cannot persist ${gate} before prior Working Backwards gates`);
  }
  const retained = existing.filter((receipt) => WORKING_BACKWARDS_GATES.indexOf(String(receipt.gate)) < gateIndex);
  const receipts = [...retained, options.receipt];
  await ensurePrivateDirectory(options.home, options.workflowId);
  const path = receiptPath(options.home, options.workflowId);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, workflowId: options.workflowId, receipts }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
  return receipts;
}

/** @param {unknown} left @param {unknown} right */
function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

/**
 * @param {{receipts: Record<string, unknown>[], artifacts: Record<string, unknown>[], repositoryIdentity: string, repositoryRevision: string, artifactStateSupplied: boolean}} options
 */
export function validateWorkingBackwardsGateReceipts(options) {
  if (options.receipts.length === 0) return { validReceipts: [], invalidFrom: null, reason: null };
  if (!options.artifactStateSupplied) return { validReceipts: [], invalidFrom: "product", reason: "artifact state is required to restore gate approval" };
  const repositoryIdentity = normalizeWorkingBackwardsRepositoryIdentity(options.repositoryIdentity);
  const validReceipts = [];
  for (const gate of WORKING_BACKWARDS_GATES) {
    const receipt = options.receipts.find((candidate) => candidate.gate === gate);
    if (!receipt) return { validReceipts, invalidFrom: gate, reason: `missing ${gate} gate receipt` };
    if (!hasValidReceiptIntegrity(receipt)) return { validReceipts, invalidFrom: gate, reason: `${gate} gate receipt integrity failure` };
    if (receipt.workflowId === undefined || receipt.repositoryIdentity !== repositoryIdentity || receipt.repositoryRevision !== options.repositoryRevision) {
      return { validReceipts, invalidFrom: gate, reason: "repository identity or revision drift" };
    }
    const snapshots = Array.isArray(receipt.artifacts) ? receipt.artifacts.filter(isRecord) : [];
    if (snapshots.length === 0) return { validReceipts, invalidFrom: gate, reason: `${gate} receipt has no artifact snapshots` };
    for (const snapshot of snapshots) {
      const current = options.artifacts.find((artifact) => artifact.id === snapshot.id && artifact.role === snapshot.role);
      if (!current || current.contentHash !== snapshot.contentHash || current.sourceIdentity !== repositoryIdentity || current.sourceIdentity !== snapshot.sourceIdentity || current.sourceRevision !== options.repositoryRevision || current.sourceRevision !== snapshot.sourceRevision || !sameValue(current.lineage, snapshot.lineage)) {
        return { validReceipts, invalidFrom: gate, reason: `artifact drift: ${String(snapshot.id)}` };
      }
    }
    validReceipts.push(receipt);
  }
  return { validReceipts, invalidFrom: null, reason: null };
}
