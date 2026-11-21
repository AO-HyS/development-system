// @ts-check
// Single authority for linking T3 Code Antigravity ACP profiles (`~/.t3/userdata/providers/antigravity/<profile>/config/`)
// to the canonical `~/.gemini/config/` managed by Development System 4.2.0+.
// State, write-ahead journal (`pending.json`), and snapshots live under `.development-system/antigravity-link/`
// and are intentionally outside `shared-installation.mjs#managedPaths` so linking after `setup` never causes drift.
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const stateRelative = ".development-system/antigravity-link/state.json";
const pendingRelative = ".development-system/antigravity-link/pending.json";
const snapshotsRelative = ".development-system/antigravity-link/snapshots";
const lockRelative = ".development-system/shared-installation-lock.sqlite";
const providersRootRelative = ".t3/userdata/providers/antigravity";

export const ANTIGRAVITY_DS_ARTIFACTS = /** @type {const} */ (["AGENTS.md", "rules", "hooks.json", "skills.json"]);
export const ANTIGRAVITY_MCP_ARTIFACT = "mcp_config.json";

/** @param {string|Buffer} bytes */
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** @param {string} path */
async function statOrNull(path) {
  try { return await lstat(path); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null; throw error; }
}

/** @param {string} path */
async function jsonOrNull(path) {
  return (await statOrNull(path)) ? JSON.parse(await readFile(path, "utf8")) : null;
}

/** @param {string} file @param {unknown} data */
async function atomicJson(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}

/** @param {string} home @param {string} rel @param {boolean} [leaf] */
async function confined(home, rel, leaf = false) {
  if (isAbsolute(rel) || rel.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid antigravity-link path: ${rel}`);
  }
  const target = resolve(home, rel);
  if (!target.startsWith(home + sep)) throw new Error(`antigravity-link path escapes HOME: ${rel}`);
  let current = home;
  const parts = rel.split("/");
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const stat = await statOrNull(current);
    if (!stat) continue;
    if (index === parts.length - 1 && leaf) continue;
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) {
      throw new Error(`Unsafe antigravity-link parent: ${rel}`);
    }
  }
  return target;
}

/** Hash files, modes, symlinks, or directories without following symlinks. @param {string} file @returns {Promise<string|null>} */
async function integrity(file) {
  const stat = await statOrNull(file);
  if (!stat) return null;
  if (stat.isSymbolicLink()) return hash(`link:${await readlink(file)}`);
  if (stat.isFile()) return hash(`${stat.mode & 0o777}:${hash(await readFile(file))}`);
  if (!stat.isDirectory()) throw new Error(`Unsupported antigravity-link entry: ${file}`);
  const rows = [];
  for (const child of (await readdir(file)).sort()) rows.push([child, await integrity(resolve(file, child))]);
  return hash(JSON.stringify(rows));
}

/** Acquire the same kernel-owned SQLite lock as `shared-installation.mjs`. @param {string} home */
async function acquireLock(home) {
  if ((await realpath(home)) !== home) throw new Error("antigravity-link HOME must be a canonical real directory");
  const lock = await confined(home, lockRelative);
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  const existing = await statOrNull(lock);
  if (existing && (!existing.isFile() || existing.nlink !== 1)) throw new Error("Unsafe shared installation lock file");
  const database = new DatabaseSync(lock);
  try {
    database.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch (error) {
    database.close();
    throw new Error("Another process owns the shared installation transaction", { cause: error });
  }
  return async () => { try { database.exec("ROLLBACK"); } finally { database.close(); } };
}

/**
 * Discover real T3 Antigravity provider profiles under `<home>/.t3/userdata/providers/antigravity/<profile>/config`.
 * Never follows symlinked provider directories or config directories.
 * @param {string} home
 */
export async function discoverAntigravityProfiles(home) {
  const resolvedHome = resolve(home);
  const providersStat = await statOrNull(resolve(resolvedHome, providersRootRelative));
  if (!providersStat) return [];
  const providersRoot = await confined(resolvedHome, providersRootRelative);
  if (!providersStat.isDirectory() || providersStat.isSymbolicLink()) return [];
  const entries = (await readdir(providersRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  /** @type {Array<{profileId: string, configRelative: string, configPath: string}>} */
  const profiles = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const configRelative = `${providersRootRelative}/${entry.name}/config`;
    const configPath = resolve(resolvedHome, configRelative);
    const configStat = await statOrNull(configPath);
    if (!configStat || configStat.isSymbolicLink() || !configStat.isDirectory()) continue;
    profiles.push({ profileId: entry.name, configRelative, configPath });
  }
  return profiles;
}

/** @param {string} home */
export async function hasPendingAntigravityLink(home) {
  const resolvedHome = resolve(home);
  return Boolean(await statOrNull(await confined(resolvedHome, pendingRelative, true)));
}

/**
 * Restore entries listed in a journal (idempotent: skips entries already equal to `beforeHash`).
 * @param {string} home
 * @param {any} pending
 */
async function restorePendingJournal(home, pending) {
  if (!pending || pending.schemaVersion !== 1 || !Array.isArray(pending.entries)) {
    throw new Error("Invalid antigravity-link pending journal");
  }
  const snapshotRoot = await confined(home, pending.snapshotRelative);
  for (const entry of pending.entries) {
    await confined(home, entry.targetRelative, true);
    if (entry.beforeHash !== null) {
      const backup = await confined(home, `${pending.snapshotRelative}/${entry.backup}`, true);
      if ((await integrity(backup)) !== entry.beforeHash) {
        throw new Error(`antigravity-link backup integrity mismatch: ${entry.targetRelative}`);
      }
    }
  }
  pending.phase = "restoring";
  await atomicJson(await confined(home, pendingRelative), pending);

  for (const entry of [...pending.entries].reverse()) {
    const target = await confined(home, entry.targetRelative, true);
    if ((await integrity(target)) === entry.beforeHash) continue;
    const stage = resolve(snapshotRoot, `restore-${randomUUID()}`);
    if (entry.beforeHash !== null) {
      await cp(await confined(home, `${pending.snapshotRelative}/${entry.backup}`, true), stage, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
      });
      if ((await integrity(stage)) !== entry.beforeHash) {
        throw new Error(`antigravity-link staged recovery mismatch: ${entry.targetRelative}`);
      }
    }
    const trash = resolve(snapshotRoot, `retired-${randomUUID()}`);
    if (await statOrNull(target)) await rename(target, trash);
    if (entry.beforeHash !== null) {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rename(stage, target);
    }
    await rm(trash, { recursive: true, force: true });
  }
}

/**
 * Link a T3 Code Antigravity ACP profile's `config/` entries to `<home>/.gemini/config/`.
 * Never touches `config.json` or `projects/`.
 * @param {{home: string, profile?: string, includeMcp?: boolean, lockHeld?: boolean}} options
 */
export async function linkAntigravityProfile(options) {
  const home = resolve(options.home);
  const includeMcp = options.includeMcp !== false;
  const releaseLock = options.lockHeld ? async () => {} : await acquireLock(home);
  try {
    if (await statOrNull(await confined(home, pendingRelative, true))) {
      throw new Error("Incomplete antigravity-link transaction exists; run development-system recover-shared first");
    }
    const profiles = await discoverAntigravityProfiles(home);
    if (profiles.length === 0) {
      throw new Error(`No T3 Antigravity provider profile found under ${resolve(home, providersRootRelative)}`);
    }
    let selected;
    if (options.profile) {
      if (!/^[a-zA-Z0-9._-]+$/u.test(options.profile)) {
        throw new Error(`Invalid Antigravity profile id: ${options.profile}`);
      }
      selected = profiles.find((item) => item.profileId === options.profile);
      if (!selected) {
        throw new Error(`Antigravity profile not found: ${options.profile} (available: ${profiles.map((p) => p.profileId).join(", ")})`);
      }
    } else if (profiles.length === 1) {
      selected = profiles[0];
    } else {
      throw new Error(`Multiple T3 Antigravity profiles found (${profiles.map((p) => p.profileId).join(", ")}); specify --profile <id>`);
    }

    // Verify all 4 DS artifacts exist in ~/.gemini/config before mutating.
    for (const name of ANTIGRAVITY_DS_ARTIFACTS) {
      const sourcePath = await confined(home, `.gemini/config/${name}`, true);
      if (!(await statOrNull(sourcePath))) {
        throw new Error(`Canonical Antigravity artifact is missing: .gemini/config/${name}. Run development-system setup first.`);
      }
    }

    /** @type {string[]} */
    const artifactsToLink = [...ANTIGRAVITY_DS_ARTIFACTS];
    let mcpLinked = false;
    if (includeMcp) {
      const mcpSource = await confined(home, `.gemini/config/${ANTIGRAVITY_MCP_ARTIFACT}`, true);
      if (await statOrNull(mcpSource)) {
        artifactsToLink.push(ANTIGRAVITY_MCP_ARTIFACT);
        mcpLinked = true;
      }
    }

    const previousState = await jsonOrNull(await confined(home, stateRelative));
    const priorProfile = previousState?.profiles?.[selected.profileId] ?? null;
    const priorEntriesByName = new Map(
      Array.isArray(priorProfile?.entries) ? priorProfile.entries.map((/** @type {any} */ e) => [e.name, e]) : [],
    );

    const snapshotId = `${Date.now()}-${randomUUID()}`;
    const snapshotRelative = `${snapshotsRelative}/${snapshotId}`;
    const snapshotRoot = await confined(home, snapshotRelative);
    await mkdir(resolve(snapshotRoot, "entries"), { recursive: true, mode: 0o700 });

    /** @type {Array<{name: string, targetRelative: string, sourceRelative: string, isDsArtifact: boolean, beforeHash: string | null, backup: string | null, afterHash: string | null}>} */
    const entries = [];
    for (const [index, name] of artifactsToLink.entries()) {
      const targetRelative = `${selected.configRelative}/${name}`;
      const sourceRelative = `.gemini/config/${name}`;
      const targetPath = await confined(home, targetRelative, true);
      const currentHash = await integrity(targetPath);
      const prior = /** @type {any} */ (priorEntriesByName.get(name));
      // Preserve the original pre-link bytes if this artifact is already linked and unchanged since our last link.
      if (prior && prior.afterHash === currentHash && priorProfile?.snapshotRelative) {
        let beforeHash = prior.beforeHash ?? null;
        let backup = null;
        if (beforeHash !== null && prior.backup) {
          const priorBackup = await confined(home, `${priorProfile.snapshotRelative}/${prior.backup}`, true);
          if ((await integrity(priorBackup)) === beforeHash) {
            backup = `entries/${index}`;
            await cp(priorBackup, resolve(snapshotRoot, backup), { recursive: true, dereference: false, verbatimSymlinks: true });
          } else {
            beforeHash = currentHash;
            if (currentHash !== null) {
              backup = `entries/${index}`;
              await cp(targetPath, resolve(snapshotRoot, backup), { recursive: true, dereference: false, verbatimSymlinks: true });
            }
          }
        }
        entries.push({ name, targetRelative, sourceRelative, isDsArtifact: name !== ANTIGRAVITY_MCP_ARTIFACT, beforeHash, backup, afterHash: null });
      } else {
        const backup = currentHash !== null ? `entries/${index}` : null;
        if (backup) {
          await cp(targetPath, resolve(snapshotRoot, backup), { recursive: true, dereference: false, verbatimSymlinks: true });
        }
        entries.push({ name, targetRelative, sourceRelative, isDsArtifact: name !== ANTIGRAVITY_MCP_ARTIFACT, beforeHash: currentHash, backup, afterHash: null });
      }
    }

    const pending = {
      schemaVersion: 1,
      operation: "link",
      phase: "prepared",
      profileId: selected.profileId,
      snapshotId,
      snapshotRelative,
      previousState,
      entries,
    };
    const pendingPath = await confined(home, pendingRelative);
    await atomicJson(pendingPath, pending);

    try {
      pending.phase = "applying";
      await atomicJson(pendingPath, pending);

      for (const entry of entries) {
        const targetPath = await confined(home, entry.targetRelative, true);
        const sourcePath = await confined(home, entry.sourceRelative, true);
        const linkDestination = relative(dirname(targetPath), sourcePath);
        const tempLink = `${targetPath}.${randomUUID()}.tmp`;
        const trash = resolve(snapshotRoot, `swap-${randomUUID()}`);
        await symlink(linkDestination, tempLink);
        if (await statOrNull(targetPath)) await rename(targetPath, trash);
        await rename(tempLink, targetPath);
        await rm(trash, { recursive: true, force: true });
        entry.afterHash = await integrity(targetPath);
      }

      // If the profile was previously linked with MCP and is now re-linked with --sin-mcp,
      // retain the prior MCP entry and carry its original backup into the new snapshot so
      // `antigravity-unlink --include-mcp` can still restore the pre-link MCP config (Codex P2 / Opus N6).
      const carriedEntries = [];
      if (!mcpLinked) {
        const priorMcp = /** @type {any} */ (priorEntriesByName.get(ANTIGRAVITY_MCP_ARTIFACT));
        if (priorMcp && priorProfile?.snapshotRelative) {
          let backup = null;
          if (priorMcp.beforeHash !== null && priorMcp.backup) {
            const priorBackup = await confined(home, `${priorProfile.snapshotRelative}/${priorMcp.backup}`, true);
            if ((await integrity(priorBackup)) === priorMcp.beforeHash) {
              backup = `entries/${entries.length}`;
              await cp(priorBackup, resolve(snapshotRoot, backup), { recursive: true, dereference: false, verbatimSymlinks: true });
            }
          }
          carriedEntries.push({ ...priorMcp, backup });
        }
      }

      const nextProfiles = { ...(previousState?.profiles ?? {}) };
      nextProfiles[selected.profileId] = {
        profileId: selected.profileId,
        configRelative: selected.configRelative,
        linkedAt: new Date().toISOString(),
        snapshotId,
        snapshotRelative,
        entries: [...entries, ...carriedEntries],
      };
      const nextState = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        profiles: nextProfiles,
      };
      await atomicJson(await confined(home, stateRelative), nextState);
      await rm(pendingPath, { force: true });

      return {
        ok: true,
        operation: "antigravity-link",
        profileId: selected.profileId,
        linkedArtifacts: entries.map((e) => e.name),
        mcpLinked,
        snapshotRelative,
      };
    } catch (error) {
      try {
        await restorePendingJournal(home, pending);
        await rm(pendingPath, { force: true });
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `antigravity-link failed and restore failed; pending journal retained at ${pendingRelative}`,
        );
      }
      throw error;
    }
  } finally {
    await releaseLock();
  }
}

/**
 * Prevalidate antigravity-link rollback before shared-installation rollback mutates anything.
 * @param {{home: string, dsOnly?: boolean}} options
 */
export async function prevalidateAntigravityRollback({ home, dsOnly = true }) {
  const resolvedHome = resolve(home);
  const pending = await jsonOrNull(await confined(resolvedHome, pendingRelative, true));
  if (pending) {
    if (pending.schemaVersion !== 1 || !Array.isArray(pending.entries)) {
      throw new Error("Invalid antigravity-link pending journal");
    }
    for (const entry of pending.entries) {
      await confined(resolvedHome, entry.targetRelative, true);
      if (entry.beforeHash !== null) {
        const backup = await confined(resolvedHome, `${pending.snapshotRelative}/${entry.backup}`, true);
        if ((await integrity(backup)) !== entry.beforeHash) {
          throw new Error(`antigravity-link pending backup integrity mismatch: ${entry.targetRelative}`);
        }
      }
    }
  }
  const state = await jsonOrNull(await confined(resolvedHome, stateRelative, true));
  if (!state?.profiles) return;
  for (const profile of Object.values(state.profiles)) {
    const entries = Array.isArray(profile?.entries) ? profile.entries : [];
    for (const entry of entries) {
      if (dsOnly && !entry.isDsArtifact) continue;
      await confined(resolvedHome, entry.targetRelative, true);
      if (entry.beforeHash !== null) {
        const backup = await confined(resolvedHome, `${profile.snapshotRelative}/${entry.backup}`, true);
        if ((await integrity(backup)) !== entry.beforeHash) {
          throw new Error(`antigravity-link backup integrity mismatch: ${entry.targetRelative}`);
        }
      }
    }
  }
}

/**
 * Recover an interrupted `antigravity-link` or `antigravity-unlink` transaction from `pending.json`.
 * @param {{home: string, lockHeld?: boolean}} options
 */
export async function recoverAntigravityLink({ home, lockHeld = false }) {
  const resolvedHome = resolve(home);
  const releaseLock = lockHeld ? async () => {} : await acquireLock(resolvedHome);
  try {
    const pendingPath = await confined(resolvedHome, pendingRelative);
    const pending = await jsonOrNull(pendingPath);
    if (!pending) return { ok: true, operation: "antigravity-link-recover", recovered: false };
    await restorePendingJournal(resolvedHome, pending);
    if (pending.operation === "link") {
      if (pending.previousState) {
        await atomicJson(await confined(resolvedHome, stateRelative), pending.previousState);
      } else {
        await rm(await confined(resolvedHome, stateRelative, true), { force: true });
      }
    } else if (pending.operation === "unlink" && pending.nextState !== undefined) {
      if (pending.nextState) {
        await atomicJson(await confined(resolvedHome, stateRelative), pending.nextState);
      } else {
        await rm(await confined(resolvedHome, stateRelative, true), { force: true });
      }
    }
    await rm(pendingPath, { force: true });
    return { ok: true, operation: "antigravity-link-recover", recovered: true, profileId: pending.profileId ?? null };
  } finally {
    await releaseLock();
  }
}

/**
 * Unlink (revert) linked artifacts in one or all T3 Antigravity ACP profiles.
 * During DS rollback (`dsOnly: true` / `includeMcp: false`), only DS artifacts (`AGENTS.md`, `rules`,
 * `hooks.json`, `skills.json`) are reverted; `mcp_config.json` stays intact unless `includeMcp: true`.
 * @param {{home: string, profile?: string, includeMcp?: boolean, allProfiles?: boolean, lockHeld?: boolean}} options
 */
export async function unlinkAntigravityProfile(options) {
  const home = resolve(options.home);
  const includeMcp = options.includeMcp === true;
  const releaseLock = options.lockHeld ? async () => {} : await acquireLock(home);
  try {
    if (await statOrNull(await confined(home, pendingRelative, true))) {
      await recoverAntigravityLink({ home, lockHeld: true });
    }
    const statePath = await confined(home, stateRelative);
    const state = await jsonOrNull(statePath);
    if (!state?.profiles || Object.keys(state.profiles).length === 0) {
      return { ok: true, operation: "antigravity-unlink", changed: false, revertedProfiles: [] };
    }
    const profileIds = options.profile
      ? [options.profile]
      : options.allProfiles || Object.keys(state.profiles).length === 1
        ? Object.keys(state.profiles).sort()
        : (() => {
            throw new Error(`Multiple linked Antigravity profiles exist (${Object.keys(state.profiles).sort().join(", ")}); specify --profile <id>`);
          })();

    /** @type {string[]} */
    const revertedProfiles = [];
    for (const profileId of profileIds) {
      const profile = state.profiles[profileId];
      if (!profile) {
        if (options.profile) throw new Error(`Antigravity profile is not linked: ${profileId}`);
        continue;
      }
      const allEntries = Array.isArray(profile.entries) ? profile.entries : [];
      const toRevert = allEntries.filter((/** @type {any} */ entry) => includeMcp || entry.isDsArtifact);
      const remaining = allEntries.filter((/** @type {any} */ entry) => !includeMcp && !entry.isDsArtifact);
      if (toRevert.length === 0) continue;

      const nextProfiles = { ...state.profiles };
      if (remaining.length > 0) {
        nextProfiles[profileId] = { ...profile, entries: remaining };
      } else {
        delete nextProfiles[profileId];
      }
      const nextState = Object.keys(nextProfiles).length > 0
        ? { schemaVersion: 1, updatedAt: new Date().toISOString(), profiles: nextProfiles }
        : null;

      const pendingPath = await confined(home, pendingRelative);
      const pending = {
        schemaVersion: 1,
        operation: "unlink",
        phase: "restoring",
        profileId,
        snapshotId: profile.snapshotId,
        snapshotRelative: profile.snapshotRelative,
        nextState,
        entries: toRevert,
      };
      await atomicJson(pendingPath, pending);
      await restorePendingJournal(home, pending);
      if (nextState) {
        await atomicJson(statePath, nextState);
      } else {
        await rm(statePath, { force: true });
      }
      await rm(pendingPath, { force: true });
      state.profiles = nextProfiles;
      revertedProfiles.push(profileId);
    }

    return {
      ok: true,
      operation: "antigravity-unlink",
      changed: revertedProfiles.length > 0,
      includeMcp,
      revertedProfiles,
    };
  } finally {
    await releaseLock();
  }
}

/**
 * Audit T3 Antigravity ACP profiles against `<home>/.gemini/config/`.
 * Reports degraded (`ok: false`) if `pending.json` exists or any active ACP profile is missing
 * or out-of-sync for any of the 4 DS artifacts (`AGENTS.md`, `rules`, `hooks.json`, `skills.json`).
 * @param {{home: string}} options
 */
export async function auditAntigravityLink({ home }) {
  const resolvedHome = resolve(home);
  /** @type {string[]} */
  const problems = [];
  if (await statOrNull(await confined(resolvedHome, pendingRelative, true))) {
    problems.push("Incomplete antigravity-link transaction; run development-system recover-shared");
  }
  const profiles = await discoverAntigravityProfiles(resolvedHome);
  /** @type {Array<{profileId: string, synced: boolean, mcpLinked: boolean, missingOrDrifted: string[]}>} */
  const reportProfiles = [];

  for (const profile of profiles) {
    /** @type {string[]} */
    const missingOrDrifted = [];
    for (const name of ANTIGRAVITY_DS_ARTIFACTS) {
      const sourcePath = await confined(resolvedHome, `.gemini/config/${name}`, true);
      const targetPath = await confined(resolvedHome, `${profile.configRelative}/${name}`, true);
      const sourceStat = await statOrNull(sourcePath);
      const targetStat = await statOrNull(targetPath);
      if (!sourceStat || !targetStat) {
        missingOrDrifted.push(name);
        continue;
      }
      try {
        const [sourceReal, targetReal] = await Promise.all([realpath(sourcePath), realpath(targetPath)]);
        if (sourceReal === targetReal) continue;
        // Also accept byte-identical copies if a profile copied instead of symlinked.
        if ((await integrity(sourceReal)) !== (await integrity(targetReal))) {
          missingOrDrifted.push(name);
        }
      } catch {
        missingOrDrifted.push(name);
      }
    }
    let mcpLinked = false;
    try {
      const mcpSource = await confined(resolvedHome, `.gemini/config/${ANTIGRAVITY_MCP_ARTIFACT}`, true);
      const mcpTarget = await confined(resolvedHome, `${profile.configRelative}/${ANTIGRAVITY_MCP_ARTIFACT}`, true);
      if ((await statOrNull(mcpSource)) && (await statOrNull(mcpTarget))) {
        mcpLinked = (await realpath(mcpSource)) === (await realpath(mcpTarget));
      }
    } catch {
      mcpLinked = false;
    }
    if (missingOrDrifted.length > 0) {
      problems.push(`Antigravity ACP profile ${profile.profileId} is out-of-sync (${missingOrDrifted.join(", ")}); run development-system antigravity-link`);
    }
    reportProfiles.push({
      profileId: profile.profileId,
      synced: missingOrDrifted.length === 0,
      mcpLinked,
      missingOrDrifted,
    });
  }

  return {
    ok: problems.length === 0,
    operation: "antigravity-link-audit",
    profiles: reportProfiles,
    problems,
  };
}
