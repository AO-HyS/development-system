// @ts-check

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, readFile, realpath, rename, unlink } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { GovernanceError, isRecord, sha256Hex, stableHash } from "./schemas.mjs";

const execFileAsync = promisify(execFile);

export const REGISTRY_SCHEMA_VERSION = 1;
export const RUN_SCHEMA_VERSION = 1;
const LOCK_WAIT_MS = 2000;
const LOCK_RETRY_MS = 25;
const LOCK_PROTOCOL = "development-system-lock-v2";
const MAX_LOCK_BYTES = 16384;
const MAX_SNAPSHOT_ENTRIES = 20000;

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return error instanceof Error && /** @type {NodeJS.ErrnoException} */ (error).code === code;
}

/** @param {string | undefined} home @returns {string} */
export function resolveHome(home) {
  if (home !== undefined && (typeof home !== "string" || home.trim().length === 0)) throw new GovernanceError("home must be a non-empty path");
  return resolve(home ?? homedir());
}

/** @param {string} home */
export function governanceHome(home) {
  return join(resolveHome(home), ".development-system", "governance");
}

/** @param {string} home */
export function registryPath(home) {
  return join(governanceHome(home), "registry.json");
}

/** @param {string} home */
export function runsDirectory(home) {
  return join(governanceHome(home), "runs");
}

/** @param {string} home @param {string} runId */
export function runDirectoryFor(home, runId) {
  return join(runsDirectory(home), runId);
}

/** @param {string} runDirectory */
export function runSnapshotPath(runDirectory) {
  return join(runDirectory, "run.json");
}

/** @param {string} code @returns {never} */
function lockError(code) { throw new GovernanceError("Governance lock operation failed", code); }

/** @param {import("node:fs").BigIntStats} left @param {import("node:fs").BigIntStats} right */
function sameInode(left, right) { return left.dev === right.dev && left.ino === right.ino; }

/** @param {string} path */
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** A private directory prevents other users from replacing mutex sidecars.
 * This is a local, same-host protocol, not a distributed filesystem lock.
 * @param {string} path */
async function privateLockDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  const stat = await lstat(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) lockError("lock-unknown");
  if ((stat.mode & 0o777n) !== 0o700n) await chmod(path, 0o700);
}

/** Never open/close the DB with fs: POSIX may release another connection's
 * process-wide SQLite locks when any descriptor for that inode is closed.
 * @param {string} path */
async function mutexFileStat(path) {
  try {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) lockError("lock-unknown");
    return stat;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** @param {unknown} error */
function sqliteBusy(error) {
  return error instanceof Error && /** @type {{errcode?:number}} */ (error).errcode === 5;
}

/** @param {number} deadline @param {number} retryMs */
async function retryLock(deadline, retryMs) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) lockError("lock-timeout");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(retryMs, remaining)));
}

/** Read a bounded, stable, regular file without following a symlink or waiting
 * on a FIFO. Only this compatibility file is opened through fs, never the DB.
 * @param {string} path @param {number} [limit] */
async function inspectLock(path, limit = MAX_LOCK_BYTES) {
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit)) lockError("lock-unknown");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || !sameInode(before, stat) || stat.size > BigInt(limit)) lockError("lock-unknown");
      const buffer = Buffer.alloc(limit + 1);
      let length = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        length += bytesRead;
        if (length > limit) lockError("lock-unknown");
        if (bytesRead === 0) break;
      }
      const after = await handle.stat({ bigint: true });
      if (after.size !== BigInt(length) || stat.size !== after.size || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs) lockError("lock-unknown");
      return { stat, bytes: buffer.subarray(0, length) };
    } finally { await handle.close(); }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    if (error instanceof GovernanceError) throw error;
    lockError("lock-unknown");
  }
}

/** @param {Buffer} bytes */
function parseLock(bytes) {
  try {
    const record = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(record) || !Number.isSafeInteger(record.pid) || record.pid <= 0
      || typeof record.acquiredAt !== "string" || !Number.isFinite(Date.parse(record.acquiredAt))) lockError("lock-unknown");
    const keys = Object.keys(record).sort().join(",");
    if (keys === "acquiredAt,pid") return { kind: "legacy", record };
    if (keys !== "acquiredAt,hostname,mutexDev,mutexIno,pid,protocol,token" || record.protocol !== LOCK_PROTOCOL
      || typeof record.token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(record.token)
      || typeof record.hostname !== "string" || record.hostname.length === 0
      || typeof record.mutexDev !== "string" || !/^(0|[1-9][0-9]*)$/u.test(record.mutexDev)
      || typeof record.mutexIno !== "string" || !/^[1-9][0-9]*$/u.test(record.mutexIno)) lockError("lock-unknown");
    return { kind: "v2", record };
  } catch { lockError("lock-unknown"); }
}

/** @param {ReturnType<typeof parseLock>} owner @param {import("node:fs").BigIntStats} mutexStat */
function recoverableLock(owner, mutexStat) {
  if (owner.kind === "v2") {
    // Acquiring this exact permanent DB proves the old critical section ended.
    // PID reuse (including this process) is irrelevant for a v2 record.
    if (owner.record.hostname !== hostname() || owner.record.mutexDev !== String(mutexStat.dev)
      || owner.record.mutexIno !== String(mutexStat.ino)) lockError("lock-unknown");
    return true;
  }
  try { process.kill(owner.record.pid, 0); return false; }
  catch (error) {
    if (hasCode(error, "ESRCH")) return true;
    lockError("lock-unknown"); // EPERM and indeterminate ownership never authorize recovery.
  }
}

/** Publish a complete receipt: a killed writer can leave only an unused temp,
 * never a partial authoritative receipt. Existing receipts are not overwritten.
 * @param {string} path @param {string} bytes */
async function publishLockReceipt(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeImmutablePrivate(temporary, bytes);
  try { await link(temporary, path); }
  finally { await unlink(temporary); }
}

/** Resume the one pending archive under the permanent DB mutex. Crash windows
 * before/after rename are distinguishable by inode and retained bytes. Storage
 * failures remain blocked while present, without scanning historical receipts.
 * @param {string} path @param {string} directory @param {import("node:fs").BigIntStats} mutexStat */
async function resumeLockRecovery(path, directory, mutexStat) {
  const pendingPath = join(directory, "recovery-pending.json");
  try {
    const pending = await inspectLock(pendingPath, MAX_LOCK_BYTES * 4);
    if (!pending) return;
    const observation = JSON.parse(pending.bytes.toString("utf8"));
    if (!isRecord(observation) || observation.state !== "observed"
      || typeof observation.recoveryId !== "string" || !/^recovery-[0-9a-f-]{36}$/u.test(observation.recoveryId)
      || typeof observation.rawBytes !== "string") lockError("lock-recovery-failed");
    const original = Buffer.from(observation.rawBytes, "base64");
    if (original.length > MAX_LOCK_BYTES || sha256Hex(original) !== observation.sha256
      || original.length !== observation.size || observation.hostname !== hostname()
      || observation.mutexDev !== String(mutexStat.dev) || observation.mutexIno !== String(mutexStat.ino)) lockError("lock-recovery-failed");
    const recovery = join(directory, observation.recoveryId);
    const stat = await lstat(recovery);
    if (!stat.isDirectory() || stat.isSymbolicLink()) lockError("lock-recovery-failed");
    const observed = await inspectLock(join(recovery, "observed.json"), MAX_LOCK_BYTES * 4);
    if (!observed || !observed.bytes.equals(pending.bytes)) lockError("lock-recovery-failed");
    const orphanPath = join(recovery, "orphan.lock");
    let orphan = await inspectLock(orphanPath);
    let state = "recovered";
    if (!orphan) {
      const current = await inspectLock(path);
      if (current && String(current.stat.dev) === observation.dev && String(current.stat.ino) === observation.ino
        && current.bytes.equals(original)) {
        if (!recoverableLock(parseLock(current.bytes), mutexStat)) lockError("lock-recovery-failed");
        await rename(path, orphanPath);
        orphan = await inspectLock(orphanPath);
      } else {
        // Another compatibility owner replaced/removed it before the move.
        // Preserve the observation, but never move the replacement.
        state = "aborted";
      }
    }
    if (state === "recovered" && (!orphan || !orphan.bytes.equals(original)
      || String(orphan.stat.dev) !== observation.dev || String(orphan.stat.ino) !== observation.ino)) lockError("lock-recovery-failed");
    await syncDirectory(resolve(path, ".."));
    await syncDirectory(recovery);
    const receiptPath = join(recovery, `${state}.json`);
    const completed = await inspectLock(receiptPath);
    const observationHash = sha256Hex(pending.bytes);
    if (completed) {
      const receipt = JSON.parse(completed.bytes.toString("utf8"));
      if (receipt.state !== state || receipt.recoveryId !== observation.recoveryId
        || receipt.observationHash !== observationHash || receipt.sha256 !== observation.sha256) lockError("lock-recovery-failed");
    } else {
      await publishLockReceipt(receiptPath, `${JSON.stringify({ state, recoveryId: observation.recoveryId,
        completedAt: new Date().toISOString(), observationHash, sha256: observation.sha256 })}\n`);
    }
    await syncDirectory(recovery);
    await unlink(pendingPath);
    await syncDirectory(directory);
  } catch { lockError("lock-recovery-failed"); }
}

/** @param {string} path @param {NonNullable<Awaited<ReturnType<typeof inspectLock>>>} observed
 * @param {string} directory @param {import("node:fs").BigIntStats} mutexStat */
async function archiveOrphan(path, observed, directory, mutexStat) {
  const recoveryId = `recovery-${randomUUID()}`;
  const recovery = join(directory, recoveryId);
  try {
    await mkdir(recovery, { mode: 0o700 });
    await syncDirectory(directory);
    const observation = `${JSON.stringify({ state: "observed", recoveryId, observedAt: new Date().toISOString(),
      observerPid: process.pid, hostname: hostname(), dev: String(observed.stat.dev), ino: String(observed.stat.ino),
      mutexDev: String(mutexStat.dev), mutexIno: String(mutexStat.ino), rawBytes: observed.bytes.toString("base64"),
      sha256: sha256Hex(observed.bytes), size: observed.bytes.length })}\n`;
    await writeImmutablePrivate(join(recovery, "observed.json"), observation);
    await syncDirectory(recovery);
    await link(join(recovery, "observed.json"), join(directory, "recovery-pending.json"));
    await syncDirectory(directory);
    await resumeLockRecovery(path, directory, mutexStat);
  } catch { lockError("lock-recovery-failed"); }
}

/** Publish complete metadata atomically for compatibility with old runtimes.
 * The unique owner file remains linked until our critical section finishes.
 * @param {string} path @param {string} directory @param {import("node:fs").BigIntStats} mutexStat
 * @param {number} deadline @param {number} retryMs */
async function acquireCompatibilityLock(path, directory, mutexStat, deadline, retryMs) {
  const token = randomUUID();
  const ownerPath = join(directory, `owner-${token}.json`);
  const bytes = Buffer.from(`${JSON.stringify({ protocol: LOCK_PROTOCOL, token, pid: process.pid,
    acquiredAt: new Date().toISOString(), hostname: hostname(), mutexDev: String(mutexStat.dev), mutexIno: String(mutexStat.ino) })}\n`);
  await writeImmutablePrivate(ownerPath, bytes);
  const owner = await inspectLock(ownerPath);
  if (!owner) lockError("lock-unknown");
  let published = false;
  let retried = false;
  try {
    for (;;) {
      try { await link(ownerPath, path); published = true; return { ...owner, ownerPath, token }; }
      catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
      if (retried && Date.now() >= deadline) lockError("lock-timeout");
      retried = true;
      const existing = await inspectLock(path);
      if (existing && recoverableLock(parseLock(existing.bytes), mutexStat)) {
        await archiveOrphan(path, existing, directory, mutexStat);
        // An old runtime can acquire the gap; exclusive publication must retry.
        continue;
      }
      await retryLock(deadline, retryMs);
    }
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    lockError("lock-unknown");
  } finally {
    if (!published) {
      try { await unlink(ownerPath); }
      catch { lockError("lock-release-failed"); }
    }
  }
}

/** @param {string} path @param {Awaited<ReturnType<typeof acquireCompatibilityLock>>} owner */
async function releaseCompatibilityLock(path, owner) {
  try {
    const current = await inspectLock(path);
    const source = await inspectLock(owner.ownerPath);
    if (!current || !sameInode(current.stat, owner.stat) || !current.bytes.equals(owner.bytes)
      || !source || !sameInode(source.stat, owner.stat) || !source.bytes.equals(owner.bytes)
      || parseLock(current.bytes).record.token !== owner.token) lockError("lock-release-failed");
    await unlink(path);
    await unlink(owner.ownerPath);
  } catch { lockError("lock-release-failed"); }
}

/** Bounded acquisition using a permanent SQLite OS mutex for the full critical
 * section. Never delete or replace its database, even when the owner crashes.
 * The compatibility file bridges older runtimes that know only exclusive open.
 * @param {string} path @param {() => Promise<any>} action
 * @param {{waitMs?: number, retryMs?: number}} [options] */
export async function withLock(path, action, options = {}) {
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const retryMs = options.retryMs ?? LOCK_RETRY_MS;
  if (!Number.isFinite(waitMs) || waitMs < 0 || !Number.isFinite(retryMs) || retryMs <= 0) lockError("invalid");
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); }
  catch { lockError("lock-runtime-unavailable"); }
  if (typeof DatabaseSync !== "function") lockError("lock-runtime-unavailable");
  const deadline = Date.now() + waitMs;
  const directory = `${path}.mutex`;
  const databasePath = join(directory, "mutex.sqlite");
  /** @type {import("node:sqlite").DatabaseSync | undefined} */ let database;
  let transaction = false;
  try {
    let mutexStat;
    try {
      await mkdir(resolve(path, ".."), { recursive: true });
      await privateLockDirectory(directory);
      const before = await mutexFileStat(databasePath);
      database = new DatabaseSync(databasePath);
      database.exec("PRAGMA busy_timeout = 0");
      mutexStat = await mutexFileStat(databasePath);
      if (!mutexStat || (before && !sameInode(before, mutexStat))) lockError("lock-unknown");
      if ((mutexStat.mode & 0o777n) !== 0o600n) await chmod(databasePath, 0o600);
      for (;;) {
        try { database.exec("BEGIN IMMEDIATE"); transaction = true; break; }
        catch (error) {
          if (!sqliteBusy(error)) throw error;
          await retryLock(deadline, retryMs);
        }
      }
      const current = await mutexFileStat(databasePath);
      if (!current || !sameInode(current, mutexStat)) lockError("lock-unknown");
      await resumeLockRecovery(path, directory, mutexStat);
    } catch (error) {
      if (error instanceof GovernanceError) throw error;
      lockError("lock-unknown");
    }
    const owner = await acquireCompatibilityLock(path, directory, mutexStat, deadline, retryMs);
    try { return await action(); }
    finally { await releaseCompatibilityLock(path, owner); }
  } finally {
    try {
      if (transaction) {
        try { database?.exec("ROLLBACK"); }
        catch { lockError("lock-release-failed"); }
      }
    } finally {
      try { database?.close(); }
      catch { lockError("lock-release-failed"); }
    }
  }
}

/** @param {string} home @param {() => Promise<any>} action */
export function withHomeLock(home, action) {
  return withLock(join(governanceHome(home), "registry.lock"), action);
}

/** @param {string} runDirectory @param {() => Promise<any>} action */
export function withRunLock(runDirectory, action) {
  return withLock(join(runDirectory, "run.lock"), action);
}

/**
 * Atomic checksummed snapshot write: temporary file, fsync, rename, directory
 * fsync. The prior committed snapshot survives a failure before rename.
 * @param {string} path @param {Record<string, any>} payload
 */
export async function writeSnapshot(path, payload) {
  const envelope = { ...payload, checksum: stableHash(payload) };
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  const directoryHandle = await open(resolve(path, ".."), "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

/**
 * @param {string} path
 * @param {string} label
 * @returns {Promise<Record<string, any>>}
 */
export async function readSnapshot(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) throw new GovernanceError(`${label} does not exist`, "missing");
    throw error;
  }
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GovernanceError(`${label} is not valid JSON`, "corrupt");
  }
  if (!isRecord(parsed) || typeof parsed.checksum !== "string") throw new GovernanceError(`${label} envelope is malformed`, "corrupt");
  const { checksum, ...payload } = parsed;
  if (checksum !== stableHash(payload)) throw new GovernanceError(`${label} checksum mismatch`, "corrupt");
  return payload;
}

/** @returns {Promise<Record<string, any>>} */
async function emptyRegistry() {
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, revision: 0, sessions: {}, runs: {} };
}

/** @param {string} home @returns {Promise<Record<string, any>>} */
export async function readRegistry(home) {
  try {
    const registry = await readSnapshot(registryPath(home), "governance registry");
    if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION || !isRecord(registry.sessions) || !isRecord(registry.runs)) {
      throw new GovernanceError("governance registry has an unsupported shape", "corrupt");
    }
    return registry;
  } catch (error) {
    if (error instanceof GovernanceError && error.code === "missing") return emptyRegistry();
    throw error;
  }
}

/**
 * Caller must already hold the home lock.
 * @param {string} home @param {Record<string, any>} registry
 */
export async function writeRegistry(home, registry) {
  const payload = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: (Number.isSafeInteger(registry.revision) ? registry.revision : 0) + 1,
    sessions: registry.sessions ?? {},
    runs: registry.runs ?? {},
    passiveTools: registry.passiveTools ?? {},
  };
  await writeSnapshot(registryPath(home), payload);
  return payload;
}

/** @param {string} home @param {string} sessionId @returns {Promise<Record<string, any> | null>} */
export async function readSessionObservation(home, sessionId) {
  const registry = await readRegistry(home);
  return isRecord(registry.sessions[sessionId]) ? registry.sessions[sessionId] : null;
}

/** @param {string} home @param {string} sessionId @param {{includeFinished?:boolean}} [options] @returns {Promise<string | null>} */
export async function registryRunDirectory(home, sessionId, options = {}) {
  const registry = await readRegistry(home);
  const matches = Object.values(registry.runs).filter((/** @type {any} */ entry) => entry.rootSessionId === sessionId || entry.childSessionIds?.includes(sessionId));
  let entry = matches.find((/** @type {any} */ candidate) => candidate.finished !== true);
  if (!entry) for (const candidate of matches) {
    const run = await loadRun(candidate.runDirectory);
    if (hasUnresolvedOwnership(run)) { entry = candidate; break; }
  }
  if (!entry && options.includeFinished) entry = matches.at(-1);
  return isRecord(entry) && typeof entry.runDirectory === "string" ? entry.runDirectory : null;
}

/** @param {string} runDirectory @returns {Promise<Record<string, any>>} */
export async function loadRun(runDirectory) {
  const snapshot = await readSnapshot(runSnapshotPath(runDirectory), "governance run");
  if (snapshot.schemaVersion !== RUN_SCHEMA_VERSION || !isRecord(snapshot.run)) throw new GovernanceError("governance run has an unsupported shape", "corrupt");
  return snapshot.run;
}

/** @param {string} runDirectory @param {Record<string, any>} run */
export async function saveRun(runDirectory, run) {
  await writeSnapshot(runSnapshotPath(runDirectory), { schemaVersion: RUN_SCHEMA_VERSION, run });
}

/** @param {string} root @returns {Promise<string>} */
export async function readGitHead(root) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 5000 });
    return stdout.trim();
  } catch {
    throw new GovernanceError("root is not a readable Git repository", "git");
  }
}

/**
 * @param {string} root @param {string} relativePath
 * @returns {Promise<{sha256:string, size:number, mode:number}>}
 */
export async function hashRegularFile(root, relativePath) {
  const absolute = resolveInsideRoot(root, relativePath);
  await assertNoSymlinkAncestors(root, relativePath);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new GovernanceError(`source ${relativePath} must not be a symlink`);
  if (!stat.isFile()) throw new GovernanceError(`source ${relativePath} must be a regular file`);
  const bytes = await readFile(absolute);
  return { sha256: sha256Hex(bytes), size: bytes.length, mode: stat.mode & 0o777 };
}

/** @param {string} root @param {string} relativePath */
function resolveInsideRoot(root, relativePath) {
  if (isAbsolute(relativePath)) throw new GovernanceError(`path ${relativePath} must be relative`);
  const absolute = resolve(root, relativePath);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new GovernanceError(`path ${relativePath} escapes the root`);
  return absolute;
}

/** @param {string} root @param {string} relativePath */
async function assertNoSymlinkAncestors(root, relativePath) {
  let current = root;
  for (const part of relativePath.split("/")) {
    if (!part || part === "." || part === "..") throw new GovernanceError("noncanonical snapshot path");
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new GovernanceError("symlink path components are unsupported"); }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
}

/**
 * Deterministic filesystem snapshot covering missing/deleted/untracked files
 * and modes. Directories recurse sorted; symlinks and escape paths reject.
 * @param {string} root
 * @param {string[]} paths
 * @returns {Promise<Array<{path:string,state:"file"|"directory"|"missing",mode:number|null,sha256:string|null,size:number|null}>>}
 */
export async function snapshotPaths(root, paths) {
  if (!Array.isArray(paths)) throw new GovernanceError("snapshotPaths requires an array of relative paths");
  /** @type {Map<string, {path:string,state:"file"|"directory"|"missing",mode:number|null,sha256:string|null,size:number|null}>} */
  const entries = new Map();
  let count = 0;
  /**
   * @param {string} relativePath
   */
  const capture = async (relativePath) => {
    if (count >= MAX_SNAPSHOT_ENTRIES) throw new GovernanceError("filesystem snapshot exceeds the entry cap");
    count += 1;
    const absolute = resolveInsideRoot(root, relativePath);
    await assertNoSymlinkAncestors(root, relativePath);
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        if (!entries.has(relativePath)) entries.set(relativePath, { path: relativePath, state: "missing", mode: null, sha256: null, size: null });
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new GovernanceError(`snapshot path ${relativePath} must not be a symlink`);
    if (stat.isDirectory()) {
      if (!entries.has(relativePath)) entries.set(relativePath, { path: relativePath, state: "directory", mode: stat.mode & 0o777, sha256: null, size: null });
      const children = (await readdir(absolute)).sort();
      for (const child of children) await capture(`${relativePath}/${child}`);
      return;
    }
    if (!stat.isFile()) throw new GovernanceError(`snapshot path ${relativePath} must be a regular file or directory`);
    const bytes = await readFile(absolute);
    entries.set(relativePath, { path: relativePath, state: "file", mode: stat.mode & 0o777, sha256: sha256Hex(bytes), size: bytes.length });
  };
  for (const relativePath of [...new Set(paths)].sort()) {
    if (typeof relativePath !== "string" || relativePath.length === 0) throw new GovernanceError("snapshot paths must be non-empty strings");
    await capture(relativePath);
  }
  return [...entries.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** @param {string} root @param {string[]} paths */
export async function hashPaths(root, paths) {
  return stableHash(await snapshotPaths(root, paths));
}

/** Versioned and non-ignored untracked candidate files. Ignored build caches
 * are never integration inputs and this is not an OS filesystem sandbox.
 * @param {string} root */
export async function snapshotRepository(root) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  const paths = [...new Set(stdout.split("\0").filter(Boolean))].sort();
  return snapshotPaths(root, paths);
}

/** @param {any[]} before @param {any[]} after */
export function repositoryDelta(before, after) {
  const previous = new Map(before.map((file) => [file.path, file]));
  const current = new Map(after.map((file) => [file.path, file]));
  return [...new Set([...previous.keys(), ...current.keys()])].filter((path) => stableHash(previous.get(path) ?? { path, state: "missing" }) !== stableHash(current.get(path) ?? { path, state: "missing" })).sort();
}

/** @param {string} directory */
export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
}

/** @param {string} path @param {number} [maxBytes] @returns {Promise<string | null>} */
export async function readBoundedText(path, maxBytes = 1024 * 1024) {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) return null;
      const bytes = await handle.readFile();
      return bytes.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** @param {string} path @returns {Promise<boolean>} */
export async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} path */
export async function canonicalDirectory(path) {
  try {
    const canonical = await realpath(path);
    const stat = await lstat(canonical);
    if (!stat.isDirectory()) throw new GovernanceError(`${path} must be a directory`);
    return canonical;
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError(`${path} must be an existing directory`);
  }
}

/** Finished registry metadata cannot hide unresolved ownership.
 * @param {any} run */
export function hasUnresolvedOwnership(run) {
  return Object.keys(run.leases ?? {}).length > 0 || (run.attempts ?? []).some((/** @type {any} */ attempt) =>
    ["running", "awaiting-post", "cancelling", "recovery-required"].includes(attempt.status) || !attempt.invocationObserved || (attempt.process && !attempt.process.terminated));
}

/** Immutable private bytes. Existing files must match exactly; never overwrite.
 * @param {string} path @param {string|Buffer} bytes */
export async function writeImmutablePrivate(path, bytes) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    const existing = await readPrivateArtifact(path, content.length);
    if (!existing.equals(content)) throw new GovernanceError("Immutable observation artifact conflicts with existing bytes", "observation_invalid");
  }
  return { path, sha256: sha256Hex(content), size: content.length };
}

/** @param {string} path @param {number} [limit] */
export async function readPrivateArtifact(path, limit = 8 * 1024 * 1024) {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw new GovernanceError("Observation artifact is missing or unavailable", "observation_missing"); }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new GovernanceError("Observation artifact exceeds its bounded size", "observation_invalid");
    return await file.readFile();
  } finally { await file.close(); }
}
