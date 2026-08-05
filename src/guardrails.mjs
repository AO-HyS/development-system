// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const marker = "AOHYS_GLOBAL_AGENT_GUARDRAILS=1";
const stateRelative = ".development-system/guardrails/state.json";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
    if (state?.schemaVersion !== 2 || !state.files) return null;
    /** @type {Record<string, string | null>} */
    const snapshot = {};
    for (const key of ["codex", "factory"]) {
      const file = state.files[key];
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

/** @param {string} engine @param {"codex" | "factory"} harness */
function managedCommand(engine, harness) {
  return `${marker} node ${shellQuote(engine)} hook --harness ${harness}`;
}

/** @param {any} entry */
function isManagedEntry(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return false;
  const entryHooks = /** @type {any[]} */ (entry.hooks);
  return entryHooks.some((hook) => hook && typeof hook === "object" && typeof hook.command === "string" && hook.command.includes(marker));
}

/** @param {any} container @param {string} matcher @param {string} command @param {boolean} [factory] */
function mergedHooks(container, matcher, command, factory = false) {
  const hooks = container && typeof container === "object" && !Array.isArray(container) ? { ...container } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? /** @type {any[]} */ (hooks.PreToolUse) : [];
  const existing = preToolUse.filter((entry) => !isManagedEntry(entry));
  hooks.PreToolUse = [
    ...existing,
    {
      matcher,
      ...(factory ? { commandRegex: ".*" } : {}),
      hooks: [{ type: "command", command, timeout: 5, statusMessage: "Checking destructive-command policy" }],
    },
  ];
  return hooks;
}

/** @param {string} home */
function paths(home) {
  return {
    codexConfig: insideHome(home, ".codex/hooks.json"),
    factoryConfig: insideHome(home, ".factory/settings.json"),
    codexEngine: insideHome(home, ".agents/skills/global-agent-guardrails/scripts/command-guard.mjs"),
    factoryEngine: insideHome(home, ".factory/skills/global-agent-guardrails/scripts/command-guard.mjs"),
    state: insideHome(home, stateRelative),
  };
}

/** @param {string} path */
async function assertEngine(path) {
  const status = await lstat(path).catch((error) => { if (missing(error)) return null; throw error; });
  if (!status?.isFile()) throw new Error(`Guard engine is not installed: ${path}`);
}

/** @param {any} config @param {string} command @param {string} matcher @param {boolean} [factory] */
function exactEntry(config, command, matcher, factory = false) {
  if (!Array.isArray(config?.hooks?.PreToolUse)) return false;
  const preToolUse = /** @type {any[]} */ (config.hooks.PreToolUse);
  return preToolUse.some((entry) => {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return false;
    if (entry.matcher !== matcher || (factory && entry.commandRegex !== ".*")) return false;
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
  for (const engine of [managed.codexEngine, managed.factoryEngine]) {
    try { await assertEngine(engine); } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  try {
    const catalog = JSON.parse(await readFile(resolve(repositoryRoot, "catalog/0.5.1.json"), "utf8"));
    const catalogSkills = /** @type {any[]} */ (catalog.skills);
    const declared = catalogSkills.find((skill) => skill.logicalName === "global-agent-guardrails");
    if (!declared) problems.push("Catalog 0.5.1 does not declare global-agent-guardrails");
    else {
      const variants = /** @type {any[]} */ (declared.variants);
      const expectedByHarness = new Map(variants.map((variant) => [variant.harness, variant.folderSha256]));
      for (const [harness, directory] of [["codex", dirname(dirname(managed.codexEngine))], ["factory", dirname(dirname(managed.factoryEngine))]]) {
        if (await existsFile(directory) && await directoryHash(directory) !== expectedByHarness.get(harness)) {
          problems.push(`${harness} guard skill bytes do not match catalog 0.5.1`);
        }
      }
    }
  } catch (error) {
    problems.push(`Cannot verify guard catalog hash: ${error instanceof Error ? error.message : String(error)}`);
  }
  let codex = {};
  let factory = {};
  try { codex = parseObject(await readOptional(managed.codexConfig), "Codex hooks"); }
  catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  try { factory = parseObject(await readOptional(managed.factoryConfig), "Factory settings"); }
  catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  const codexCommand = managedCommand(managed.codexEngine, "codex");
  const factoryCommand = managedCommand(managed.factoryEngine, "factory");
  if (!exactEntry(codex, codexCommand, "Bash|exec")) problems.push("Codex managed PreToolUse hook is missing or drifted");
  if (!exactEntry(factory, factoryCommand, "Execute", true)) problems.push("Factory managed PreToolUse hook is missing or drifted");
  for (const [label, engine] of [["Codex", managed.codexEngine], ["Factory", managed.factoryEngine]]) {
    if (!(await readOptional(engine))) continue;
    const safe = probe(engine, "git status --short");
    const blocked = probe(engine, "git reset --hard");
    if (safe.status !== 0) problems.push(`${label} guard did not allow the safe probe`);
    if (blocked.status !== 2) problems.push(`${label} guard did not block the destructive probe`);
  }
  return {
    ok: problems.length === 0,
    operation: "guardrails-audit",
    status: problems.length === 0 ? "healthy" : "invalid",
    adapters: { codex: "PreToolUse Bash|exec", t3code: "inherits Codex", factory: "PreToolUse Execute" },
    paths: managed,
    problems,
    externalSideEffects: [],
  };
}

/** @param {{home: string}} options */
export async function enableGlobalGuardrails({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of Object.values(managed)) await assertNoSymlinkParents(resolvedHome, path);
  await assertEngine(managed.codexEngine);
  await assertEngine(managed.factoryEngine);
  const before = {
    codex: await readOptional(managed.codexConfig),
    factory: await readOptional(managed.factoryConfig),
    state: await readOptional(managed.state),
  };
  const codex = parseObject(before.codex, "Codex hooks");
  const factory = parseObject(before.factory, "Factory settings");
  const codexCommand = managedCommand(managed.codexEngine, "codex");
  const factoryCommand = managedCommand(managed.factoryEngine, "factory");
  if (exactEntry(codex, codexCommand, "Bash|exec") && exactEntry(factory, factoryCommand, "Execute", true)) {
    return { ...(await auditGlobalGuardrails({ home: resolvedHome })), operation: "guardrails-enable", changed: false };
  }
  const nextCodex = { ...codex, hooks: mergedHooks(codex.hooks, "Bash|exec", codexCommand) };
  const nextFactory = { ...factory, hooks: mergedHooks(factory.hooks, "Execute", factoryCommand, true) };
  const installed = {
    codex: Buffer.from(`${JSON.stringify(nextCodex, null, 2)}\n`),
    factory: Buffer.from(`${JSON.stringify(nextFactory, null, 2)}\n`),
  };
  const priorSnapshot = priorRollbackSnapshot(before.state);
  const state = {
    schemaVersion: 2,
    operation: "global-guardrails-enable",
    installedAt: new Date().toISOString(),
    files: {
      codex: {
        before: priorSnapshot?.codex ?? (before.codex === null ? null : before.codex.toString("base64")),
        installed: installed.codex.toString("base64"),
      },
      factory: {
        before: priorSnapshot?.factory ?? (before.factory === null ? null : before.factory.toString("base64")),
        installed: installed.factory.toString("base64"),
      },
    },
  };
  async function restorePriorBytes() {
    /** @type {{path: string, contents: Buffer | null}[]} */
    const priorFiles = [
      { path: managed.codexConfig, contents: before.codex },
      { path: managed.factoryConfig, contents: before.factory },
      { path: managed.state, contents: before.state },
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
    await writeAtomic(managed.state, Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
    await writeAtomic(managed.codexConfig, installed.codex);
    await writeAtomic(managed.factoryConfig, installed.factory);
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
  for (const path of [managed.codexConfig, managed.factoryConfig, managed.state]) {
    await assertNoSymlinkParents(resolvedHome, path);
  }
  const contents = await readOptional(managed.state);
  if (contents === null) throw new Error("No guardrail activation snapshot exists");
  const state = JSON.parse(contents.toString("utf8"));
  if (state?.schemaVersion !== 2 || !state.files || !("codex" in state.files) || !("factory" in state.files)) {
    throw new Error("Guardrail activation snapshot is invalid");
  }
  const entries = [];
  for (const [key, path] of [["codex", managed.codexConfig], ["factory", managed.factoryConfig]]) {
    const file = state.files[key];
    if (!file || typeof file !== "object" || !("before" in file) || typeof file.installed !== "string") {
      throw new Error(`Guardrail snapshot contains invalid ${key} metadata`);
    }
    const before = file.before === null ? null : typeof file.before === "string" ? Buffer.from(file.before, "base64") : null;
    if (file.before !== null && before === null) throw new Error(`Guardrail snapshot contains invalid ${key} prior bytes`);
    const installed = Buffer.from(file.installed, "base64");
    const current = await readOptional(path);
    if (current === null || !current.equals(installed)) {
      throw new Error(`Refusing guardrail rollback because ${key} configuration changed after activation`);
    }
    entries.push({ path, before });
  }
  for (const { path, before } of entries) {
    if (before === null) await unlink(path).catch((error) => { if (!missing(error)) throw error; });
    else await writeAtomic(path, before);
  }
  await unlink(managed.state);
  return { ok: true, operation: "guardrails-rollback", status: "restored", externalSideEffects: [] };
}
