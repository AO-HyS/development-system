// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const marker = "AOHYS_GLOBAL_AGENT_GUARDRAILS=1";
const stateRelative = ".development-system/guardrails/state.json";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guardCatalogVersion = "0.50.0";
/** The Codex adapter also accepts the 1.5.2 engine (catalog 0.13.0); only the 0.50.0 engine understands --harness claude. */
const legacyCodexCatalogVersion = "0.13.0";
/** Codex hooks also cover T3 Codex threads; Claude Code reads its user settings. */
const adapters = /** @type {const} */ ([
  { key: "codex", config: ".codex/hooks.json", engine: ".agents/skills/global-agent-guardrails/scripts/command-guard.mjs", matcher: "Bash|exec", label: "Codex" },
  { key: "claude", config: ".claude/settings.json", engine: ".claude/skills/global-agent-guardrails/scripts/command-guard.mjs", matcher: "Bash|Monitor", label: "Claude Code" },
]);

/** @param {unknown} error */
function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} home @param {string} candidate */
function insideHome(home, candidate) {
  if (isAbsolute(candidate)) throw new Error(`Managed path must be relative to HOME: ${candidate}`);
  const root = resolve(home);
  const path = resolve(root, candidate);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Managed path escapes HOME: ${candidate}`);
  return path;
}

/** @param {string} home @param {string} path */
async function assertNoSymlinkParents(home, path) {
  const root = resolve(home);
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Managed parent is a symbolic link: ${current}`);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
  }
}

/** @param {string} path @returns {Promise<Buffer | null>} */
async function readOptional(path) {
  try { return await readFile(path); }
  catch (error) { if (missing(error)) return null; throw error; }
}

/** @param {string} path */
async function existsFile(path) {
  try { await lstat(path); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}

/** @param {Buffer | null} contents @param {string} label @returns {any} */
function parseObject(contents, label) {
  if (contents === null) return {};
  const value = JSON.parse(contents.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value;
}

/** @param {Buffer | null} contents */
function priorRollbackSnapshot(contents) {
  if (contents === null) return null;
  try {
    const state = JSON.parse(contents.toString("utf8"));
    if (![2, 3].includes(state?.schemaVersion) || !state.files) return null;
    /** @type {Record<string, string | null>} */
    const snapshot = {};
    for (const { key } of adapters) {
      const file = state.files[key];
      if (file === undefined && key !== "codex") continue;
      if (!file || typeof file !== "object" || !("before" in file)) return null;
      if (file.before !== null && typeof file.before !== "string") return null;
      snapshot[key] = file.before;
    }
    return snapshot;
  } catch {
    return null;
  }
}

/** @param {string} path @param {Buffer} contents @param {number} [mode] */
async function writeAtomic(path, contents, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode });
  await rename(temporary, path);
  await chmod(path, mode);
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** @param {string} engine @param {string} harness */
function managedCommand(engine, harness) {
  return `${marker} node ${shellQuote(engine)} hook --harness ${harness}`;
}

/** @param {any} entry */
function isManagedEntry(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return false;
  const entryHooks = /** @type {any[]} */ (entry.hooks);
  return entryHooks.some((hook) => hook && typeof hook === "object" && typeof hook.command === "string" && hook.command.includes(marker));
}

/** @param {any} container @param {string} matcher @param {string} command */
function mergedHooks(container, matcher, command) {
  const hooks = container && typeof container === "object" && !Array.isArray(container) ? { ...container } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? /** @type {any[]} */ (hooks.PreToolUse) : [];
  const existing = preToolUse.filter((entry) => !isManagedEntry(entry));
  hooks.PreToolUse = [
    ...existing,
    {
      matcher,
      hooks: [{ type: "command", command, timeout: 5, statusMessage: "Checking destructive-command policy" }],
    },
  ];
  return hooks;
}

/** @param {string} home */
function paths(home) {
  return {
    codexConfig: insideHome(home, adapters[0].config),
    codexEngine: insideHome(home, adapters[0].engine),
    claudeConfig: insideHome(home, adapters[1].config),
    claudeEngine: insideHome(home, adapters[1].engine),
    state: insideHome(home, stateRelative),
  };
}

/** @param {string} path */
async function engineInstalled(path) {
  return Boolean((await lstat(path).catch((error) => { if (missing(error)) return null; throw error; }))?.isFile());
}

/** Codex is always managed; Claude Code only once its catalogued guard skill is installed. */
/** @param {ReturnType<typeof paths>} managed */
async function activeAdapters(managed) {
  const all = adapterPaths(managed);
  const claude = all.find((adapter) => adapter.key === "claude");
  return claude && await engineInstalled(claude.enginePath) ? all : all.filter((adapter) => adapter.key !== "claude");
}

/** @param {string} version */
async function guardHashes(version) {
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, `catalog/${version}.json`), "utf8"));
  const declared = /** @type {any[]} */ (catalog.skills).find((skill) => skill.logicalName === "global-agent-guardrails");
  if (!declared) throw new Error(`Catalog ${version} does not declare global-agent-guardrails`);
  return new Map(/** @type {any[]} */ (declared.variants).map((variant) => [variant.harness, variant.folderSha256]));
}

/** @param {ReturnType<typeof paths>} managed */
function adapterPaths(managed) {
  return adapters.map((adapter) => ({
    ...adapter,
    configPath: adapter.key === "codex" ? managed.codexConfig : managed.claudeConfig,
    enginePath: adapter.key === "codex" ? managed.codexEngine : managed.claudeEngine,
  }));
}

/** @param {string} path */
async function assertEngine(path) {
  const status = await lstat(path).catch((error) => { if (missing(error)) return null; throw error; });
  if (!status?.isFile()) throw new Error(`Guard engine is not installed: ${path}`);
}

/** @param {any} config @param {string} command @param {string} matcher */
function exactEntry(config, command, matcher) {
  if (!Array.isArray(config?.hooks?.PreToolUse)) return false;
  const preToolUse = /** @type {any[]} */ (config.hooks.PreToolUse);
  return preToolUse.some((entry) => {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return false;
    if (entry.matcher !== matcher) return false;
    const entryHooks = /** @type {any[]} */ (entry.hooks);
    return entryHooks.some((hook) =>
      hook?.type === "command" && hook?.command === command && hook?.timeout === 5);
  });
}

/** @param {string} directory */
async function directoryHash(directory) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} current */
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Guard skill contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(directory);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(directory, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** @param {string} engine @param {string} command */
function probe(engine, command) {
  return spawnSync(process.execPath, [engine, "check", "--command", command], { encoding: "utf8" });
}

/** @param {{home: string}} options */
export async function auditGlobalGuardrails({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  const problems = [];
  for (const path of Object.values(managed)) {
    try { await assertNoSymlinkParents(resolvedHome, path); }
    catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  /** @type {Map<string, Set<string>>} */
  const expectedByHarness = new Map();
  try {
    for (const version of [guardCatalogVersion, legacyCodexCatalogVersion]) {
      for (const [harness, hash] of await guardHashes(version)) {
        if (version === legacyCodexCatalogVersion && harness !== "codex") continue;
        expectedByHarness.set(harness, (expectedByHarness.get(harness) ?? new Set()).add(hash));
      }
    }
  } catch (error) {
    problems.push(`Cannot verify guard catalog hash: ${error instanceof Error ? error.message : String(error)}`);
  }
  const audited = await activeAdapters(managed);
  for (const adapter of audited) {
    try { await assertEngine(adapter.enginePath); } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    try {
      const directory = dirname(dirname(adapter.enginePath));
      if (await existsFile(directory) && !expectedByHarness.get(adapter.key)?.has(await directoryHash(directory))) {
        problems.push(`${adapter.key} guard skill bytes do not match a catalogued guard version`);
      }
    } catch (error) {
      problems.push(`Cannot hash ${adapter.key} guard skill: ${error instanceof Error ? error.message : String(error)}`);
    }
    let config = {};
    try { config = parseObject(await readOptional(adapter.configPath), `${adapter.label} hooks`); }
    catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    if (!exactEntry(config, managedCommand(adapter.enginePath, adapter.key), adapter.matcher)) {
      problems.push(`${adapter.label} managed PreToolUse hook is missing or drifted`);
    }
    if (await readOptional(adapter.enginePath)) {
      const safe = probe(adapter.enginePath, "git status --short");
      const blocked = probe(adapter.enginePath, "git reset --hard");
      if (safe.status !== 0) problems.push(`${adapter.label} guard did not allow the safe probe`);
      if (blocked.status !== 2) problems.push(`${adapter.label} guard did not block the destructive probe`);
    }
  }
  return {
    ok: problems.length === 0,
    operation: "guardrails-audit",
    status: problems.length === 0 ? "healthy" : "invalid",
    adapters: Object.fromEntries([...audited.map((adapter) => [adapter.key, `PreToolUse ${adapter.matcher}`]), ["t3code", audited.length > 1 ? "inherits its Codex or Claude Code provider" : "inherits Codex"]]),
    paths: managed,
    problems,
    externalSideEffects: [],
  };
}

/** @param {{home: string}} options */
export async function enableGlobalGuardrails({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  const managedAdapters = await activeAdapters(managed);
  for (const path of Object.values(managed)) await assertNoSymlinkParents(resolvedHome, path);
  for (const adapter of managedAdapters) await assertEngine(adapter.enginePath);
  const state = await readOptional(managed.state);
  /** @type {Record<string, Buffer | null>} */
  const before = {};
  /** @type {Record<string, Buffer>} */
  const installed = {};
  for (const adapter of managedAdapters) {
    before[adapter.key] = await readOptional(adapter.configPath);
    const config = parseObject(before[adapter.key], `${adapter.label} hooks`);
    const command = managedCommand(adapter.enginePath, adapter.key);
    if (!exactEntry(config, command, adapter.matcher)) {
      installed[adapter.key] = Buffer.from(`${JSON.stringify({ ...config, hooks: mergedHooks(config.hooks, adapter.matcher, command) }, null, 2)}\n`);
    }
  }
  if (Object.keys(installed).length === 0) {
    return { ...(await auditGlobalGuardrails({ home: resolvedHome })), operation: "guardrails-enable", changed: false };
  }
  const priorSnapshot = priorRollbackSnapshot(state);
  /** @type {Record<string, {before: string | null, installed: string}>} */
  const files = {};
  for (const adapter of managedAdapters) {
    const current = /** @type {Buffer | null} */ (before[adapter.key]);
    const prior = priorSnapshot && adapter.key in priorSnapshot ? priorSnapshot[adapter.key] : undefined;
    files[adapter.key] = {
      before: prior !== undefined ? prior : current === null ? null : current.toString("base64"),
      installed: (installed[adapter.key] ?? current ?? Buffer.alloc(0)).toString("base64"),
    };
  }
  const nextState = { schemaVersion: 3, operation: "global-guardrails-enable", installedAt: new Date().toISOString(), files };
  async function restorePriorBytes() {
    /** @type {{path: string, contents: Buffer | null}[]} */
    const priorFiles = [
      ...managedAdapters.filter((adapter) => adapter.key in installed).map((adapter) => ({ path: adapter.configPath, contents: before[adapter.key] })),
      { path: managed.state, contents: state },
    ];
    for (const { path, contents } of priorFiles) {
      if (contents === null) {
        await unlink(path).catch((error) => { if (!missing(error)) throw error; });
      } else {
        await writeAtomic(path, contents);
      }
    }
  }

  try {
    await writeAtomic(managed.state, Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`));
    for (const adapter of managedAdapters) {
      if (installed[adapter.key]) await writeAtomic(adapter.configPath, installed[adapter.key]);
    }
    const audit = await auditGlobalGuardrails({ home: resolvedHome });
    if (!audit.ok) throw new Error(`Guardrail activation failed verification:\n- ${audit.problems.join("\n- ")}`);
    return { ...audit, operation: "guardrails-enable", changed: true, statePath: managed.state };
  } catch (error) {
    await restorePriorBytes();
    throw error;
  }
}

/** @param {{home: string}} options */
export async function rollbackGlobalGuardrails({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of [managed.codexConfig, managed.claudeConfig, managed.state]) {
    await assertNoSymlinkParents(resolvedHome, path);
  }
  const contents = await readOptional(managed.state);
  if (contents === null) throw new Error("No guardrail activation snapshot exists");
  const state = JSON.parse(contents.toString("utf8"));
  if (![2, 3].includes(state?.schemaVersion) || !state.files || !("codex" in state.files)) {
    throw new Error("Guardrail activation snapshot is invalid");
  }
  const entries = [];
  for (const { key, configPath: path } of adapterPaths(managed)) {
    if (key !== "codex" && !(key in state.files)) continue;
    const file = state.files[key];
    if (!file || typeof file !== "object" || !("before" in file) || typeof file.installed !== "string") {
      throw new Error(`Guardrail snapshot contains invalid ${key} metadata`);
    }
    const before = file.before === null ? null : typeof file.before === "string" ? Buffer.from(file.before, "base64") : null;
    if (file.before !== null && before === null) throw new Error(`Guardrail snapshot contains invalid ${key} prior bytes`);
    const installed = Buffer.from(file.installed, "base64");
    const current = await readOptional(path);
    if (current !== null && current.equals(installed)) {
      entries.push({ path, before });
    } else if (key === "claude" && current === null) {
      // Settings were removed after activation, so the managed hook is already gone.
    } else if (key === "claude") {
      // Claude Code rewrites its user settings (plugins, preferences); remove only the managed hook.
      const settings = parseObject(current, "Claude Code settings");
      const preToolUse = /** @type {any[]} */ (Array.isArray(settings.hooks?.PreToolUse) ? settings.hooks.PreToolUse : []);
      const hooks = { ...settings.hooks, PreToolUse: preToolUse.filter((entry) => !isManagedEntry(entry)) };
      if (hooks.PreToolUse.length === 0) delete hooks.PreToolUse;
      const next = { ...settings, hooks };
      if (Object.keys(hooks).length === 0) delete next.hooks;
      entries.push({ path, before: Buffer.from(`${JSON.stringify(next, null, 2)}\n`) });
    } else {
      throw new Error(`Refusing guardrail rollback because ${key} configuration changed after activation`);
    }
  }
  for (const { path, before } of entries) {
    if (before === null) await unlink(path).catch((error) => { if (!missing(error)) throw error; });
    else await writeAtomic(path, before);
  }
  await unlink(managed.state);
  return { ok: true, operation: "guardrails-rollback", status: "restored", externalSideEffects: [] };
}
