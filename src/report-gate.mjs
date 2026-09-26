// @ts-check

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Codex Stop hook that asks for the completion report once per session (Claude Code gets it through claude-orchestration). */
const marker = "AOHYS_REPORT_GATE=1";
const engineRelative = ".codex/development-system/runtime/report-gate/stop-gate.mjs";
const configRelative = ".codex/hooks.json";
/** HOME-relative activation snapshot; a contract rollback refuses while it exists. */
export const reportGateStateRelative = ".development-system/private/report-gate/state.json";
const stateRelative = reportGateStateRelative;
const timeout = 10;
const statusMessage = "Checking completion report";

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

/** @param {Buffer | null} contents @param {string} label @returns {any} */
function parseObject(contents, label) {
  if (contents === null) return {};
  const value = JSON.parse(contents.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value;
}

/** @param {string} path @param {Buffer} contents @param {number} [mode] */
async function writeAtomic(path, contents, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode });
  await rename(temporary, path);
  await chmod(path, mode);
}

/** @param {string} path @param {Buffer | null} contents */
async function restoreBytes(path, contents) {
  if (contents === null) await unlink(path).catch((error) => { if (!missing(error)) throw error; });
  else await writeAtomic(path, contents);
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** @param {any} value */
function serialize(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

/** @param {string} home */
function paths(home) {
  const engine = insideHome(home, engineRelative);
  return {
    engine,
    config: insideHome(home, configRelative),
    state: insideHome(home, stateRelative),
    command: `${marker} node ${shellQuote(engine)} --harness codex`,
  };
}

/** @param {any} entry */
function isManagedEntry(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return false;
  return /** @type {any[]} */ (entry.hooks).some((hook) => hook && typeof hook === "object" && typeof hook.command === "string" && hook.command.includes(marker));
}

/** @param {any} container @param {string} command */
function mergedHooks(container, command) {
  const hooks = container && typeof container === "object" && !Array.isArray(container) ? { ...container } : {};
  const stop = Array.isArray(hooks.Stop) ? /** @type {any[]} */ (hooks.Stop) : [];
  hooks.Stop = [
    ...stop.filter((entry) => !isManagedEntry(entry)),
    { hooks: [{ type: "command", command, timeout, statusMessage }] },
  ];
  return hooks;
}

/** @param {any} config */
function withoutManaged(config) {
  const next = { ...config };
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) return next;
  const hooks = { ...config.hooks };
  if (Array.isArray(hooks.Stop)) {
    hooks.Stop = /** @type {any[]} */ (hooks.Stop).filter((entry) => !isManagedEntry(entry));
    if (hooks.Stop.length === 0) delete hooks.Stop;
  }
  if (Object.keys(hooks).length === 0) delete next.hooks;
  else next.hooks = hooks;
  return next;
}

/** @param {any} config @param {string} command */
function managedMatches(config, command) {
  const stop = Array.isArray(config?.hooks?.Stop) ? /** @type {any[]} */ (config.hooks.Stop) : [];
  return stop.flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : [])
    .filter((/** @type {any} */ hook) => typeof hook?.command === "string" && hook.command.includes(marker))
    .map((/** @type {any} */ hook) => ({ hook, exact: hook.type === "command" && hook.command === command && hook.timeout === timeout })));
}

/** @param {Buffer | null} contents */
function parseState(contents) {
  if (contents === null) return null;
  const state = JSON.parse(contents.toString("utf8"));
  if (state?.schemaVersion !== 1 || typeof state.installed !== "string" || (state.before !== null && typeof state.before !== "string")) {
    throw new Error("Report gate activation snapshot is invalid");
  }
  return /** @type {{schemaVersion: 1, before: string | null, installed: string}} */ (state);
}

/** @param {{home: string}} options */
export async function auditReportGate({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  /** @type {string[]} */
  const problems = [];
  for (const path of [managed.engine, managed.config, managed.state]) {
    try { await assertNoSymlinkParents(resolvedHome, path); }
    catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  const engine = await lstat(managed.engine).catch(() => null);
  if (!engine?.isFile()) problems.push(`Report gate engine is not installed: ${managed.engine}`);
  let config = {};
  try { config = parseObject(await readOptional(managed.config), "Codex hooks"); }
  catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  const matches = managedMatches(config, managed.command);
  if (matches.length !== 1 || !matches[0].exact) problems.push(`Codex Stop has ${matches.length} report-gate hooks; expected exactly one with timeout ${timeout}`);
  if (engine?.isFile()) {
    const result = spawnSync(process.execPath, [managed.engine, "--harness", "codex"], {
      input: JSON.stringify({ session_id: "audit", stop_hook_active: true, transcript_path: "", cwd: resolvedHome }),
      env: { ...process.env, HOME: resolvedHome },
      encoding: "utf8",
      timeout: 10000,
    });
    if (result.status !== 0 || (result.stdout ?? "").trim() !== "") problems.push("Report gate did not allow the stop_hook_active probe silently");
  }
  return {
    ok: problems.length === 0,
    operation: "report-gate-audit",
    status: problems.length === 0 ? "healthy" : "invalid",
    paths: managed,
    problems,
    externalSideEffects: [],
  };
}

/** @param {{home: string}} options */
export async function enableReportGate({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of [managed.engine, managed.config, managed.state]) await assertNoSymlinkParents(resolvedHome, path);
  const engine = await lstat(managed.engine).catch(() => null);
  if (!engine?.isFile()) throw new Error(`Report gate engine is not installed: ${managed.engine}`);
  const current = await readOptional(managed.config);
  const config = parseObject(current, "Codex hooks");
  const stateBytes = await readOptional(managed.state);
  const state = parseState(stateBytes);
  const matches = managedMatches(config, managed.command);
  if (matches.length === 1 && matches[0].exact && state) {
    return { ...(await auditReportGate({ home: resolvedHome })), operation: "report-gate-enable", changed: false };
  }
  const installed = serialize({ ...config, hooks: mergedHooks(config.hooks, managed.command) });
  /** @type {string | null} */
  let before;
  if (state && current !== null && current.equals(Buffer.from(state.installed, "base64"))) before = state.before;
  else if (current === null) before = null;
  else if (matches.length > 0) before = serialize(withoutManaged(config)).toString("base64");
  else before = current.toString("base64");
  const nextState = { schemaVersion: 1, operation: "report-gate-enable", installedAt: new Date().toISOString(), before, installed: installed.toString("base64") };
  try {
    await writeAtomic(managed.state, serialize(nextState));
    await writeAtomic(managed.config, installed);
    const audit = await auditReportGate({ home: resolvedHome });
    if (!audit.ok) throw new Error(`Report gate activation failed verification:\n- ${audit.problems.join("\n- ")}`);
    return { ...audit, operation: "report-gate-enable", changed: true, statePath: managed.state };
  } catch (error) {
    await restoreBytes(managed.config, current);
    await restoreBytes(managed.state, stateBytes);
    throw error;
  }
}

/** @param {{home: string}} options */
export async function rollbackReportGate({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of [managed.config, managed.state]) await assertNoSymlinkParents(resolvedHome, path);
  const state = parseState(await readOptional(managed.state));
  if (!state) throw new Error("No report gate activation snapshot exists");
  const current = await readOptional(managed.config);
  let status;
  if (current === null) {
    status = "nothing-to-restore";
  } else if (current.equals(Buffer.from(state.installed, "base64"))) {
    await restoreBytes(managed.config, state.before === null ? null : Buffer.from(state.before, "base64"));
    status = "restored";
  } else {
    // Codex hooks changed after activation; remove only the managed Stop entry.
    await writeAtomic(managed.config, serialize(withoutManaged(parseObject(current, "Codex hooks"))));
    status = "structurally-restored";
  }
  await unlink(managed.state);
  return { ok: true, operation: "report-gate-rollback", status, externalSideEffects: [] };
}
