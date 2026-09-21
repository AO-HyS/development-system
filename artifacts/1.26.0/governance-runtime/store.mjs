// @ts-check

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { GovernanceError, isRecord, sha256Hex, stableHash } from "./schemas.mjs";

const execFileAsync = promisify(execFile);

export const REGISTRY_SCHEMA_VERSION = 1;
export const RUN_SCHEMA_VERSION = 1;
const LOCK_WAIT_MS = 2000;
const LOCK_RETRY_MS = 25;
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

/**
 * Bounded exclusive lock. A crashed holder leaves the lock in place; there is
 * deliberately no stale-PID auto-release.
 * @param {string} path
 * @param {() => Promise<any>} action
 * @param {{waitMs?: number, retryMs?: number}} [options]
 */
export async function withLock(path, action, options = {}) {
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const retryMs = options.retryMs ?? LOCK_RETRY_MS;
  await mkdir(resolve(path, ".."), { recursive: true });
  const deadline = Date.now() + waitMs;
  /** @type {Awaited<ReturnType<typeof open>> | null} */
  let handle = null;
  for (;;) {
    try {
      handle = await open(path, "wx", 0o600);
      break;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      if (Date.now() >= deadline) throw new GovernanceError(`lock is held and the bounded wait expired: ${path}`, "lock-timeout");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
    }
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
    return await action();
  } finally {
    await handle.close();
    await unlink(path).catch(() => {});
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
