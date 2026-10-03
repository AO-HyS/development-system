// @ts-check
import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
/** @param {unknown} value @returns {value is string} */
const revision = (value) => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
/** @param {unknown} value @returns {value is string} */
const timestamp = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
/** Evidence is a bounded pointer collection, never transcript text. @param {unknown} value @returns {value is string[]} */
const evidence = (value) => Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every((item) => typeof item === "string" && item.length <= 1000 && /^(?:https?:\/\/|\/|thread:|session:|artifact:|sha256:)/.test(item) && !/[\r\n]/.test(item) && !/(?:token|secret|password|api[_-]?key)=/i.test(item));
/** @param {string} value */
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
/** @param {unknown} error */
const missing = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
/** @typedef {{repositoryId:string,sessionId:string,revision:string|null,updatedAt:string|null,evidence:string[]}} Session */
/** @typedef {{repositoryId:string,changeId:string,revision:string,status:string,evidence:string[],prUrl?:string}} Recommendation */
/** @typedef {{schemaVersion:1,sessions:Record<string,Session>,recommendations:Record<string,Recommendation>}} Ledger */

/** Reject symlinks and non-directory parents, including the requested HOME itself. @param {string} home */
async function privateDirectory(home) {
  const root = resolve(home);
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error("Steward HOME must be a real directory without symlink parents");
  let directory = root;
  for (const part of [".development-system", "steward"]) {
    directory = resolve(directory, part);
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || !(await realpath(directory)).startsWith(`${root}${sep}`)) throw new Error("Unsafe Steward state directory");
  }
  return directory;
}
/** @param {string} path */
async function assertRegular(path) {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error("Steward state path must be a regular file"); }
  catch (error) { if (!missing(error)) throw error; }
}
/** @param {unknown} value @param {Set<string>} allowedIds @returns {Ledger} */
function validateLedger(value, allowedIds) {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.sessions) || !record(value.recommendations)) throw new Error("Invalid Steward retro ledger");
  for (const [key, item] of Object.entries(value.sessions)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !record(item) || !allowedIds.has(String(item.repositoryId)) || !identifier(item.sessionId) || !(revision(item.revision) || timestamp(item.updatedAt)) || !evidence(item.evidence)) throw new Error("Invalid Steward session ledger entry");
    if (key !== fingerprint(`${item.repositoryId}:${item.sessionId}:${item.revision ?? ""}:${item.updatedAt ?? ""}`)) throw new Error("Steward session fingerprint mismatch");
  }
  for (const [key, item] of Object.entries(value.recommendations)) {
    if (!record(item) || !allowedIds.has(String(item.repositoryId)) || !identifier(item.changeId) || !revision(item.revision) || !["pending", "open-pr", "resolved", "no-change"].includes(String(item.status)) || !evidence(item.evidence) || key !== fingerprint(`${item.repositoryId}:${item.changeId}`)) throw new Error("Invalid Steward recommendation ledger entry");
    if (item.status === "open-pr" && (typeof item.prUrl !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(item.prUrl))) throw new Error("Invalid verified PR receipt in ledger");
  }
  return /** @type {Ledger} */ (/** @type {unknown} */ (value));
}

/**
 * Local-only ledger reconciliation: collection completion does not imply publication.
 * @param {unknown} input
 * @param {ReturnType<typeof import('./development-steward.mjs').buildDevelopmentStewardReview>} review
 * @param {{home:string,allowedIds:Set<string>}} options
 */
export async function reconcileStewardRetro(input, review, { home, allowedIds }) {
  if (!record(input)) throw new Error("Steward input must be an object");
  const directory = await privateDirectory(home);
  const ledgerPath = resolve(directory, "retro-state.json");
  const lockPath = resolve(directory, "retro-state.lock");
  await assertRegular(ledgerPath);
  // Exclusive open: a concurrent owner fails closed; stale locks require reconciliation.
  const lock = await open(lockPath, "wx", 0o600);
  const owner = randomUUID();
  await lock.writeFile(owner);
  /** @type {string[]} */ const processed = [];
  /** @type {{sourceId:string,reason:string}[]} */ const skipped = [];
  /** @type {Ledger} */ let state = { schemaVersion: 1, sessions: {}, recommendations: {} };
  let temporary = "";
  try {
    try { state = validateLedger(JSON.parse(await readFile(ledgerPath, "utf8")), allowedIds); }
    catch (error) { if (!missing(error)) throw error; }
    /** @type {Map<string,number>} */ const counts = new Map();
    for (const item of Array.isArray(input.sessions) ? input.sessions.slice(0, 100) : []) {
      const sourceId = record(item) && identifier(item.sessionId) ? item.sessionId : "unknown-session";
      if (!record(item) || !allowedIds.has(String(item.repositoryId)) || !identifier(item.sessionId) || item.complete !== true || (item.revision != null && !revision(item.revision)) || (item.updatedAt != null && !timestamp(item.updatedAt)) || !(revision(item.revision) || timestamp(item.updatedAt)) || !evidence(item.evidence)) {
        skipped.push({ sourceId, reason: "invalid-or-incomplete-session" }); continue;
      }
      const repositoryId = String(item.repositoryId);
      const count = counts.get(repositoryId) ?? 0;
      if (count >= 10) { skipped.push({ sourceId, reason: "repository-session-bound" }); continue; }
      counts.set(repositoryId, count + 1);
      const session = { repositoryId, sessionId: item.sessionId, revision: revision(item.revision) ? item.revision : null, updatedAt: timestamp(item.updatedAt) ? item.updatedAt : null, evidence: item.evidence };
      const key = fingerprint(`${repositoryId}:${session.sessionId}:${session.revision ?? ""}:${session.updatedAt ?? ""}`);
      if (state.sessions[key]) { skipped.push({ sourceId, reason: "already-processed" }); continue; }
      state.sessions[key] = session;
      processed.push(sourceId);
    }
    for (const item of Array.isArray(input.recommendationReceipts) ? input.recommendationReceipts : []) {
      if (!record(item) || !allowedIds.has(String(item.repositoryId)) || !identifier(item.changeId) || !revision(item.revision) || item.verified !== true || !["open-pr", "resolved", "no-change"].includes(String(item.status)) || !evidence(item.evidence)) { skipped.push({ sourceId: "recommendation-receipt", reason: "unproven-receipt" }); continue; }
      const repositoryId = String(item.repositoryId);
      const repository = review.repositories.find((entry) => entry.id === repositoryId);
      if (item.status === "open-pr" && (typeof item.prUrl !== "string" || !new RegExp(`^https://github\\.com/${repository?.repository.replaceAll(".", "\\.")}/pull/\\d+$`).test(item.prUrl))) { skipped.push({ sourceId: item.changeId, reason: "invalid-pr-receipt" }); continue; }
      const key = fingerprint(`${repositoryId}:${item.changeId}`);
      if (!state.recommendations[key]) { skipped.push({ sourceId: item.changeId, reason: "unknown-recommendation-receipt" }); continue; }
      state.recommendations[key] = { repositoryId, changeId: item.changeId, revision: item.revision, status: String(item.status), evidence: item.evidence, ...(typeof item.prUrl === "string" ? { prUrl: item.prUrl } : {}) };
    }
    // Reconcile every eligible recommendation before limiting actual draft work.
    const selectedRepositories = new Set();
    const draftChanges = review.draftChanges.filter((draft) => {
      if (!identifier(draft.changeId) || !revision(draft.revision)) return false;
      const key = fingerprint(`${draft.repositoryId}:${draft.changeId}`);
      const existing = state.recommendations[key];
      if (existing && existing.status !== "pending") return false;
      state.recommendations[key] = { repositoryId: draft.repositoryId, changeId: draft.changeId, revision: draft.revision, status: "pending", evidence: existing?.evidence ?? [`artifact:revision:${draft.revision}`] };
      if (selectedRepositories.has(draft.repositoryId)) return false;
      selectedRepositories.add(draft.repositoryId);
      return true;
    });
    validateLedger(state, allowedIds);
    temporary = `${ledgerPath}.${owner}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(state, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
    await assertRegular(ledgerPath);
    await rename(temporary, ledgerPath);
    temporary = "";
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return { ledgerPath, processed, skipped, pending: Object.values(state.recommendations).filter((item) => item.status === "pending"), openPullRequests: Object.values(state.recommendations).filter((item) => item.status === "open-pr"), draftChanges, externalSideEffects: [] };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await lock.close();
    if (await readFile(lockPath, "utf8") === owner) await unlink(lockPath);
  }
}
