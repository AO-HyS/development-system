// @ts-check
// One serialized, recoverable installation. Backups contain only declared managed
// destinations; they remain private and never enter a report or package.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadPackageSource, verifyPackageFile } from './package-source.mjs';
import { auditGlobalGuardrails } from './guardrails.mjs';
import { auditClaudeOrchestration, managedEnv } from './claude-orchestration.mjs';
import { auditReportGate } from './report-gate.mjs';

const statePath = '.development-system/shared-installation.json';
const journalPath = '.development-system/shared-installation-pending.json';
const lockPath = '.development-system/shared-installation-lock.sqlite';
const launchers = ['.local/bin/development-system', '.local/bin/aohys-development-system'];
// Shared host settings files: the owner may add their own keys (env, plugins, permissions, autoMode).
// Only an allowlist of owner keys is free; everything else (hooks, disableAllHooks, allowManagedHooksOnly,
// unknown future keys) stays protected, so a change that can turn hooks off is still drift
// (friction whole-file-drift-on-shared-settings, 2026-11-03; review DS188-01).
const ownerEditableSettings = new Set(['.claude/settings.json', '.codex/hooks.json']);
const ownerKeys = new Set(['$schema', 'env', 'enabledPlugins', 'extraKnownMarketplaces', 'pluginConfigs', 'effortLevel', 'model',
  'autoUpdatesChannel', 'skipDangerousModePermissionPrompt', 'skipAutoPermissionPrompt', 'permissions', 'autoMode', 'theme',
  'outputStyle', 'language', 'alwaysThinkingEnabled', 'showThinkingSummaries', 'fastMode', 'autoCompactWindow', 'modelSettings',
  'spinnerTipsEnabled', 'viewMode', 'tui', 'voice', 'voiceEnabled', 'cleanupPeriodDays', 'attribution', 'includeCoAuthoredBy',
  'enableAllProjectMcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers', 'autoMemoryEnabled', 'editorMode', 'verbose',
  'prefersReducedMotion', 'timeFormat', 'timeZone', 'feedbackSurveyRate']);
/** Hook commands the installers own, by their installed paths; an owner's own hook with a similar file name is not managed
 * (reviews DS188-02, codex:4462244185). */
const managedHookCommand = /\/\.agents\/skills\/global-agent-guardrails\/scripts\/command-guard\.mjs|\/\.codex\/development-system\/runtime\/(claude-orchestration\/roster-guard|report-gate\/stop-gate)\.mjs/;
// A managed hook and its group may carry only the fields the installers write; any other field
// (if, async, asyncRewake, once, shell, ...) can narrow or defer execution (reviews DS188-02, DS188-03).
const managedHookFields = new Set(['type', 'command', 'timeout', 'statusMessage']);
const managedGroupFields = new Set(['matcher', 'hooks']);
// Environment that can change how a hook or the host runs stays protected; other owner env (API keys,
// tool settings) is free. Prefixes cover the host, our runtime and process loaders (review DS188-01).
const executionEnvPrefix = /^(CLAUDE|CODEX|AOHYS|DEVELOPMENT_SYSTEM|T3CODE|NODE|NPM|DYLD|LD|GIT|GH|XDG|TAR|UNZIP|BASH|ZSH|SHELL)(_|$)/;
const executionEnvNames = new Set(['PATH', 'HOME', 'TMPDIR', 'CDPATH', 'ENV', 'ZDOTDIR', 'IFS', 'SIMPLE_BACKUP_SUFFIX', 'UNZIPOPT', 'PERL5LIB', 'PYTHONPATH']);
/** @param {string} name */
const executionEnv = name => /HOOK/i.test(name) || Object.hasOwn(managedEnv, name) || executionEnvPrefix.test(name) || executionEnvNames.has(name);
/** @param {any} value @returns {any} */
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
/** @param {string} file @returns {Promise<any>} parsed object, or undefined when missing or not a JSON object */
async function settingsObject(file) {
  if (!(await statOrNull(file))?.isFile()) return undefined;
  try { const parsed = JSON.parse(await readFile(file, 'utf8')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined; } catch { return undefined; }
}
/** Everything outside the owner allowlist, plus env entries that can change execution. @param {any} parsed */
function protectedView(parsed) {
  const view = Object.fromEntries(Object.entries(parsed).filter(([key]) => !ownerKeys.has(key)));
  const env = parsed.env && typeof parsed.env === 'object' ? Object.fromEntries(Object.entries(parsed.env).filter(([name]) => executionEnv(name))) : {};
  return { ...view, '#env-execution': env };
}
/** @param {string} file @returns {Promise<string|null>} */
async function protectedIntegrity(file) {
  const parsed = await settingsObject(file);
  return parsed === undefined ? null : hash(`protected:${JSON.stringify(canonical(protectedView(parsed)))}`);
}
/** Managed hooks (or their groups) carrying fields that can narrow, defer or replace execution. @param {any} parsed @returns {string[]} */
function weakenedHooks(parsed) {
  const found = [];
  for (const [event, groups] of Object.entries(parsed?.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
      const managed = hooks.filter((/** @type {any} */ hook) => managedHookCommand.test(String(hook?.command ?? '')));
      if (!managed.length) continue;
      const groupExtra = Object.keys(group).filter(key => !managedGroupFields.has(key));
      if (groupExtra.length) found.push(`${event} managed hook group has ${groupExtra.join(', ')}`);
      for (const hook of managed) {
        const extra = Object.keys(hook).filter(key => !managedHookFields.has(key));
        if (extra.length || hook.type !== 'command') found.push(`${event} managed hook has ${extra.length ? extra.join(', ') : `type ${hook.type}`}`);
      }
    }
  }
  return found;
}
/** Hash of the canonical `hooks` subtree, as recorded by receipts that carry afterHooks. @param {any} parsed */
const hooksIntegrity = parsed => hash(`hooks:${JSON.stringify(canonical(parsed?.hooks ?? null))}`);
const guardBytesProblem = /guard skill bytes do not match a catalogued guard version/;
/**
 * Legacy entries (installed before afterProtected existed) are checked by the hook installers' own audits.
 * Guard bytes are excluded only when the guard skill entries themselves still match their installed hash,
 * because a newer CLI audits against its own catalog while an older guard is still installed.
 * @param {string} home @param {boolean} guardBytesIntact @returns {Promise<string[]>}
 */
async function managedHookProblems(home, guardBytesIntact) {
  const audits = await Promise.all([auditGlobalGuardrails({ home }), auditClaudeOrchestration({ home }), auditReportGate({ home })]);
  return audits.flatMap((/** @type {any} */ audit) => audit.ok ? [] : (audit.problems ?? audit.findings ?? ['managed hook audit failed']).map(String))
    .filter(problem => !(guardBytesIntact && guardBytesProblem.test(problem)));
}
const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string|Buffer} bytes */
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string} file */
async function statOrNull(file) {
  try { return await lstat(file); } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null; throw error; }
}
/** @param {string} file */
async function jsonOrNull(file) { return await statOrNull(file) ? JSON.parse(await readFile(file, 'utf8')) : null; }
/** @param {string} file @param {unknown} data */
async function atomicJson(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}
/** @param {string} home @param {string} relative @param {boolean} [leaf] */
async function confined(home, relative, leaf = false) {
  if (isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Invalid managed path: ${relative}`);
  const target = resolve(home, relative);
  if (!target.startsWith(home + sep)) throw new Error('Managed path escapes HOME');
  let current = home;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const stat = await statOrNull(current);
    if (!stat) continue;
    if (index === parts.length - 1 && leaf) continue;
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw new Error(`Unsafe managed parent: ${relative}`);
  }
  return target;
}
/** Hash files, modes and link text without following links. @param {string} file @returns {Promise<string|null>} */
async function integrity(file) {
  const stat = await statOrNull(file);
  if (!stat) return null;
  if (stat.isSymbolicLink()) return hash('link:' + await readlink(file));
  if (stat.isFile()) return hash(`${stat.mode & 0o777}:` + hash(await readFile(file)));
  if (!stat.isDirectory()) throw new Error(`Unsupported managed entry: ${file}`);
  const rows = [];
  for (const child of (await readdir(file)).sort()) rows.push([child, await integrity(resolve(file, child))]);
  return hash(JSON.stringify(rows));
}
/** @param {string} home */
async function acquire(home) {
  if (await realpath(home) !== home) throw new Error('Shared installation HOME must be a canonical real directory');
  const lock = await confined(home, lockPath);
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  const existing = await statOrNull(lock);
  if (existing && (!existing.isFile() || existing.nlink !== 1)) throw new Error('Unsafe shared installation lock file');
  const database = new DatabaseSync(lock);
  try {
    // Kernel-owned SQLite locks are released on process death, with no polling,
    // stale-PID deletion, or race-prone lock-directory reclamation.
    database.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
  } catch (error) { database.close(); throw new Error('Another process owns the shared installation transaction', { cause: error }); }
  return async () => { try { database.exec('ROLLBACK'); } finally { database.close(); } };
}
/** Legacy commands may mutate only an unadopted HOME, under the same lock.
 * @template T
 * @param {{home:string, operation:string, run:()=>Promise<T>}} options
 * @returns {Promise<T>}
 */
export async function withLegacyInstallationMutation({ home, operation, run }) {
  home = resolve(home);
  const release = await acquire(home);
  try {
    if (await statOrNull(await confined(home, statePath, true)) || await statOrNull(await confined(home, journalPath, true))) {
      throw new Error(`${operation} cannot mutate a shared or pending installation; use setup/update, rollback or recover-shared for the complete tuple`);
    }
    return await run();
  } finally { await release(); }
}
/** @param {string} root @param {string} version */
async function releaseInputs(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Contract version must be a semantic version');
  const source = loadPackageSource(root);
  if (!source) throw new Error('Installation path authority requires a verified package');
  const manifestPath = `manifests/${version}.json`;
  const declared = source.files.get(manifestPath);
  if (!declared) throw new Error('Requested manifest is not declared in package provenance');
  verifyPackageFile(source, manifestPath, declared.sha256);
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), 'utf8'));
  if (manifest.contractVersion !== version) throw new Error('Manifest version mismatch');
  const artifact = manifest.artifacts.find((/** @type {any} */ item) => item.logicalName === 'skill-catalog');
  if (!artifact) throw new Error('Shared installation requires a paired catalog');
  verifyPackageFile(source, artifact.sourcePath, artifact.sha256);
  const catalog = JSON.parse(await readFile(resolve(root, artifact.sourcePath), 'utf8'));
  return { manifest, catalog };
}
/** @param {any} manifest @param {any} catalog */
function managedPaths(manifest, catalog) {
  return [...manifest.artifacts.map((/** @type {any} */ row) => row.destination),
    ...catalog.skills.flatMap((/** @type {any} */ row) => row.variants.map((/** @type {any} */ variant) => variant.destination)),
    ...(catalog.cleanup ?? []), '.development-system/state.json', '.development-system/installed-manifest.json',
    '.development-system/snapshots', '.development-system/skills-lock.json', '.development-system/skill-sync-state.json',
    '.development-system/skill-snapshots', '.agents/.skill-lock.json', '.codex/hooks.json', '.claude/settings.json',
    '.development-system/governance-hooks.json', '.development-system/guardrails/state.json',
    '.development-system/claude-orchestration/state.json', '.development-system/private/report-gate/state.json', statePath, ...launchers];
}
/** @param {string[]} paths */
function compactPaths(paths) {
  return [...new Set(paths)].sort().filter((file, _, all) => !all.some(other => other !== file && file.startsWith(other + '/')));
}
/** @param {string} root */
export async function runtimeProvenance(root) {
  const metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const source = loadPackageSource(root);
  if (source) {
    // Runtime identity also requires the installed package bytes to match its
    // inventory, including transitive renderer assets and imported helpers.
    for (const [file, declared] of source.files) verifyPackageFile(source, file, declared.sha256);
  }
  const commit = source?.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Runtime source has no exact revision');
  const dirty = source ? false : Boolean(execFileSync('git', ['status', '--porcelain', '--', 'src', 'package.json', 'artifacts', 'manifests', 'catalog'], { cwd: root, encoding: 'utf8' }).trim());
  return { packageRoot: await realpath(root), packageVersion: metadata.version, contractVersion: metadata.contractVersion ?? metadata.version, sourceCommit: commit, sourceMode: source ? 'verified-package' : 'git-checkout', dirty };
}
/** @param {{home:string, root:string}} options */
export async function auditSharedInstallation(options) {
  const home = resolve(options.home);
  const runtime = await runtimeProvenance(options.root);
  const state = await jsonOrNull(await confined(home, statePath));
  const pending = await jsonOrNull(await confined(home, journalPath));
  const problems = [];
  if (pending) problems.push('Incomplete shared transaction; use recover-shared before delivery');
  if (!state) problems.push('Shared installation not adopted; run the verified package setup');
  if (state) {
    if (state.packageRoot !== runtime.packageRoot || state.sourceCommit !== runtime.sourceCommit || state.packageVersion !== runtime.packageVersion) problems.push('Invoked CLI differs from the active shared package');
    /** @type {any[]} */
    const settingsEntries = [];
    for (const entry of state.entries) {
      const target = await confined(home, entry.path, true);
      if (await integrity(target) === entry.after) continue;
      if (ownerEditableSettings.has(entry.path) && (await statOrNull(target))?.isFile()) { settingsEntries.push(entry); continue; }
      problems.push(`Managed drift: ${entry.path}`);
    }
    const guardBytesIntact = !problems.some(problem => problem.includes('skills/global-agent-guardrails'));
    /** @type {string[] | null} */
    let hookProblems = null;
    for (const entry of settingsEntries) {
      const target = await confined(home, entry.path, true);
      const parsed = await settingsObject(target);
      const weakened = parsed === undefined ? ['not a JSON object'] : weakenedHooks(parsed);
      if (entry.afterProtected) {
        if (weakened.length || await protectedIntegrity(target) !== entry.afterProtected) problems.push(`Managed drift: ${entry.path} (managed hooks or hook switches changed${weakened.length ? `: ${weakened.join('; ')}` : ''})`);
        continue;
      }
      // Legacy receipt: no protected hash was recorded, so only owner keys may sit beside hooks, execution env
      // may hold only the orchestration values, and a recorded hooks hash must still match (review DS188-03).
      const unknown = parsed === undefined ? [] : Object.keys(parsed).filter(key => key !== 'hooks' && !ownerKeys.has(key));
      const env = parsed?.env && typeof parsed.env === 'object' ? parsed.env : {};
      const envChanged = Object.keys(env).filter(name => executionEnv(name) && env[name] !== /** @type {any} */ (managedEnv)[name]);
      const hooksChanged = entry.afterHooks && parsed !== undefined && hooksIntegrity(parsed) !== entry.afterHooks ? ['managed hooks changed'] : [];
      hookProblems ??= await managedHookProblems(home, guardBytesIntact);
      const legacy = [...weakened, ...hooksChanged, ...unknown.map(key => `unmanaged key ${key}`), ...envChanged.map(name => `execution env ${name}`), ...hookProblems];
      if (legacy.length) problems.push(`Managed drift: ${entry.path} (${legacy.join('; ')})`);
    }
    const contract = await jsonOrNull(await confined(home, '.development-system/state.json'));
    const skills = await jsonOrNull(await confined(home, '.development-system/skills-lock.json'));
    if (contract?.currentVersion !== state.contractVersion || skills?.catalogVersion !== state.catalogVersion) problems.push('Active package, contract and catalog tuple differs');
  }
  return { operation: 'shared-installation-audit', ok: problems.length === 0, runtime, active: state ? { packageRoot: state.packageRoot, packageVersion: state.packageVersion, sourceCommit: state.sourceCommit, contractVersion: state.contractVersion, catalogVersion: state.catalogVersion } : null, problems, operationalLoading: 'requires-fresh-task-observation' };
}
/** @param {string} home @param {any} journal @param {boolean} requireAfter */
async function restore(home, journal, requireAfter) {
  if (journal?.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(journal.contractVersion ?? '') || !['prepared', 'installing', 'committed', 'restoring'].includes(journal.phase) || !/^\.development-system\/shared-snapshots\/\d{10,16}-[a-f0-9-]{36}$/.test(journal.backupRoot ?? '') || !Array.isArray(journal.entries)) throw new Error('Invalid recovery journal');
  let allowed = [];
  for (const version of [journal.contractVersion, journal.previousContractVersion].filter(Boolean)) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid recovery contract version');
    const release = await releaseInputs(runtimeRoot, version);
    allowed.push(...managedPaths(release.manifest, release.catalog));
  }
  const expected = compactPaths(allowed);
  if (JSON.stringify(journal.entries.map((/** @type {any} */ entry) => entry.path)) !== JSON.stringify(expected) || journal.entries.some((/** @type {any} */ entry, /** @type {number} */ index) => entry.backup !== `entries/${index}` || [entry.before, entry.after].some(value => value !== null && !/^[a-f0-9]{64}$/.test(value)))) throw new Error('Recovery journal declares incomplete or unauthorized paths or hashes');
  const backupRoot = await confined(home, journal.backupRoot);
  for (const entry of journal.entries) {
    const target = await confined(home, entry.path, true);
    const backup = await confined(home, `${journal.backupRoot}/${entry.backup}`, true);
    if (entry.before !== null && await integrity(backup) !== entry.before) throw new Error(`Recovery backup integrity mismatch: ${entry.path}`);
    const actual = await integrity(target);
    if (requireAfter && actual !== entry.after && actual !== entry.before && !(journal.restoring === entry.path && actual === null)) throw new Error(`Concurrent managed drift blocks rollback: ${entry.path}`);
  }
  journal.phase = 'restoring';
  await atomicJson(await confined(home, journalPath), journal);
  for (const entry of [...journal.entries].reverse()) {
    const target = await confined(home, entry.path, true);
    if (await integrity(target) === entry.before) continue;
    journal.restoring = entry.path;
    await atomicJson(await confined(home, journalPath), journal);
    const stage = resolve(backupRoot, `restore-${randomUUID()}`);
    if (entry.before !== null) {
      await cp(await confined(home, `${journal.backupRoot}/${entry.backup}`, true), stage, { recursive: true, dereference: false, verbatimSymlinks: true });
      if (await integrity(stage) !== entry.before) throw new Error(`Staged recovery integrity mismatch: ${entry.path}`);
    }
    // Move the entire existing entry atomically. Recursive deletion of a live
    // destination could be interrupted with a partial hash that cannot resume.
    const trash = resolve(backupRoot, `retired-${randomUUID()}`);
    if (await statOrNull(target)) await rename(target, trash);
    if (entry.before !== null) {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rename(stage, target);
    }
    await rm(trash, { recursive: true, force: true });
  }
  journal.restoring = null;
  await atomicJson(await confined(home, journalPath), journal);
}
/** @param {{home:string, root:string, version:string, install:()=>Promise<any>}} options */
export async function setupSharedInstallation(options) {
  const home = resolve(options.home), root = resolve(options.root);
  const release = await releaseInputs(root, options.version);
  const provenance = await runtimeProvenance(root);
  // Runtime activation is always a committed package, never a mutable checkout.
  const source = loadPackageSource(root);
  if (!source) throw new Error('Shared setup requires a verified release package. From a clean committed checkout run release:pack, then invoke the extracted package setup.');
  const releaseLock = await acquire(home);
  try {
    if (await statOrNull(await confined(home, journalPath))) throw new Error('Pending shared transaction exists; recover it before setup');
    const previous = await jsonOrNull(await confined(home, statePath));
    let paths = managedPaths(release.manifest, release.catalog);
    const previousManifest = await jsonOrNull(await confined(home, '.development-system/installed-manifest.json'));
    if (previousManifest) {
      const canonical = await releaseInputs(root, previousManifest.contractVersion);
      if (JSON.stringify(canonical.manifest.artifacts) !== JSON.stringify(previousManifest.artifacts)) throw new Error('Previous installed manifest differs from canonical declared destinations');
      paths.push(...managedPaths(canonical.manifest, canonical.catalog));
    }
    paths = compactPaths(paths);
    for (const path of launchers) {
      const target = await confined(home, path, true), stat = await statOrNull(target);
      if (stat && (!stat.isSymbolicLink() || !(await realpath(target)).startsWith(resolve(home, '.development-system/packages') + sep))) throw new Error(`Unowned launcher blocks adoption: ${path}`);
    }
    if (previous) {
      const audit = await auditSharedInstallation({ home, root: previous.packageRoot });
      if (!audit.ok) throw new Error(audit.problems.join('; '));
    }
    const backupRelative = `.development-system/shared-snapshots/${Date.now()}-${randomUUID()}`;
    const backupRoot = await confined(home, backupRelative);
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    const entries = [];
    for (const [index, path] of paths.entries()) {
      const target = await confined(home, path, true), before = await integrity(target), backup = `entries/${index}`;
      if (before !== null) {
        await mkdir(dirname(resolve(backupRoot, backup)), { recursive: true, mode: 0o700 });
        await cp(target, resolve(backupRoot, backup), { recursive: true, dereference: false, verbatimSymlinks: true });
      }
      entries.push({ path, before, backup, after: /** @type {string|null} */ (null) });
    }
    const journal = { schemaVersion: 1, contractVersion: options.version, previousContractVersion: previousManifest?.contractVersion ?? null, backupRoot: backupRelative, entries, previous, phase: 'prepared' };
    await atomicJson(await confined(home, journalPath), journal);
    try {
      const packageRelative = `.development-system/packages/${source.packageVersion}-${source.commit.slice(0, 12)}/package`;
      const packageRoot = await confined(home, packageRelative);
      const existing = await statOrNull(packageRoot);
      if (!existing) {
        const stage = `${packageRoot}.candidate-${randomUUID()}`;
        await mkdir(stage, { recursive: true, mode: 0o700 });
        try {
        for (const [file, metadata] of source.files) {
          verifyPackageFile(source, file, metadata.sha256);
          const destination = resolve(stage, file);
          await mkdir(dirname(destination), { recursive: true });
          await cp(resolve(root, file), destination, { errorOnExist: true, force: false });
        }
        await cp(resolve(root, '.development-system-package.json'), resolve(stage, '.development-system-package.json'), { errorOnExist: true, force: false });
        const stagedSource = loadPackageSource(stage);
        if (!stagedSource || stagedSource.commit !== source.commit) throw new Error('Staged package identity mismatch');
        for (const [file, metadata] of stagedSource.files) verifyPackageFile(stagedSource, file, metadata.sha256);
        await rename(stage, packageRoot);
        } finally { await rm(stage, { recursive: true, force: true }); }
      }
      const installedSource = loadPackageSource(packageRoot);
      if (!installedSource || installedSource.commit !== source.commit) throw new Error('Installed package identity mismatch');
      for (const [file, metadata] of installedSource.files) verifyPackageFile(installedSource, file, metadata.sha256);
      journal.phase = 'installing'; await atomicJson(await confined(home, journalPath), journal);
      const installation = await options.install();
      for (const path of launchers) {
        const target = await confined(home, path, true);
        await mkdir(dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        await symlink(resolve(packageRoot, 'bin/development-system.mjs'), temporary);
        await rename(temporary, target);
      }
      // Do not include state itself in drift hashes (it contains the receipt).
      for (const entry of entries) {
        const target = await confined(home, entry.path, true);
        entry.after = await integrity(target);
        if (ownerEditableSettings.has(entry.path) && entry.after !== null) {
          const weakened = weakenedHooks(await settingsObject(target));
          if (weakened.length) throw new Error(`Managed hooks in ${entry.path} would not block: ${weakened.join('; ')}`);
          /** @type {any} */ (entry).afterProtected = await protectedIntegrity(target);
        }
      }
      const state = { schemaVersion: 1, ...provenance, packageRoot, contractVersion: options.version, catalogVersion: release.catalog.catalogVersion, backupRoot: backupRelative, previous, entries: entries.filter(entry => entry.path !== statePath), installedAt: new Date().toISOString() };
      await atomicJson(await confined(home, statePath), state);
      const stateEntry = entries.find(entry => entry.path === statePath);
      if (stateEntry) stateEntry.after = await integrity(await confined(home, statePath));
      journal.entries = entries; journal.phase = 'committed';
      await atomicJson(resolve(backupRoot, 'receipt.json'), journal);
      await rm(await confined(home, journalPath));
      return { ...installation, shared: { packageRoot, packageVersion: source.packageVersion, sourceCommit: source.commit, catalogVersion: release.catalog.catalogVersion, launchers, recoverySnapshot: backupRelative } };
    } catch (error) {
      // Hold the lock while restoring the exact pre-invocation tuple.
      for (const entry of entries) entry.after = await integrity(await confined(home, entry.path, true));
      await restore(home, journal, true);
      await rm(await confined(home, journalPath));
      throw new Error(`Shared setup failed; previous complete installation restored: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  } finally { await releaseLock(); }
}
/** @param {{home:string, recover?:boolean}} options */
export async function rollbackSharedInstallation(options) {
  const home = resolve(options.home), releaseLock = await acquire(home);
  try {
    const pending = await jsonOrNull(await confined(home, journalPath));
    const state = await jsonOrNull(await confined(home, statePath));
    if (pending && !options.recover) throw new Error('Pending transaction requires recover-shared');
    if (!pending && options.recover) throw new Error('No pending shared transaction exists');
    if (!pending && !state) throw new Error('No shared installation exists');
    const journal = pending ?? await jsonOrNull(await confined(home, `${state.backupRoot}/receipt.json`));
    if (!journal) throw new Error('Recovery receipt is missing');
    await restore(home, journal, !pending || pending.phase === 'restoring');
    await rm(await confined(home, journalPath));
    return { operation: options.recover ? 'recover-shared' : 'rollback', ok: true, packageVersion: journal.previous?.packageVersion ?? null, restoredCompleteTuple: true };
  } finally { await releaseLock(); }
}
