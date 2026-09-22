// @ts-check
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { assertLockRuntimeAvailable } from "./runtime-requirements.mjs";

const marker = "AOHYS_JEV_GOVERNANCE=1";
const events = ["PreToolUse", "PostToolUse", "SessionStart", "SubagentStart", "SubagentStop", "Stop", "Interrupt"];
/** @param {unknown} error */
const absent = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
/** @param {string} path */
async function optional(path) { try { return await readFile(path, "utf8"); } catch (error) { if (absent(error)) return null; throw error; } }
/** @param {string} value */
const quote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
/** @param {string} home */
function paths(home) {
  return { hooks: resolve(home, ".codex/hooks.json"), engine: resolve(home, ".codex/development-system/governance-runtime/hook-launcher.mjs"), state: resolve(home, ".development-system/governance-hooks.json") };
}
/** @param {string} home @param {string} path */
async function regularPath(home, path) {
  let current = resolve(home);
  for (const part of relative(current, path).split(sep)) {
    current = resolve(current, part);
    const stat = await lstat(current).catch((error) => { if (absent(error)) return null; throw error; });
    if (stat?.isSymbolicLink()) throw new Error(`Governance installation refuses symbolic link: ${current}`);
  }
}
/** @param {string|null} contents */
function parseConfig(contents) {
  const config = contents === null ? {} : JSON.parse(contents);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Codex hooks must be an object");
  if (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks))) throw new Error("Codex hooks.hooks must be an object");
  return config;
}
/** @param {string} path @param {string|null} contents */
async function atomic(path, contents) {
  if (contents === null) { await unlink(path).catch((error) => { if (!absent(error)) throw error; }); return; }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, contents, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
  finally { await unlink(temporary).catch((error) => { if (!absent(error)) throw error; }); }
}
/** @param {string} home */
function definitions(home) {
  const { engine } = paths(home);
  const command = `${marker} ${quote(process.execPath)} ${quote(engine)} --home ${quote(resolve(home))}`;
  return Object.fromEntries(events.map((event) => [event, {
    ...(["PreToolUse", "PostToolUse"].includes(event) ? { matcher: ".*" } : {}),
    hooks: [{ type: "command", command, timeout: event === "Interrupt" ? 3 : 15, statusMessage: "Checking Jev governance" }],
  }]));
}
/** @param {any} hook */
const managed = (hook) => typeof hook?.command === "string" && hook.command.startsWith(`${marker} `);
/** Preserve other handlers even when sharing a group with ours. @param {any} config @param {string} home */
function merge(config, home) {
  const hooks = { ...config.hooks };
  for (const [event, definition] of Object.entries(definitions(home))) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) throw new Error(`Malformed hook list: ${event}`);
    hooks[event] = (hooks[event] ?? []).flatMap((/** @type {any} */ group) => {
      if (!group || !Array.isArray(group.hooks)) throw new Error(`Malformed hook group: ${event}`);
      const retained = group.hooks.filter((/** @type {any} */ hook) => !managed(hook));
      return retained.length ? [{ ...group, hooks: retained }] : [];
    });
    hooks[event].push(definition);
  }
  return { ...config, hooks };
}

/** Config audit is deliberately not a claim of trusted or executed hooks. @param {{home:string}} options */
export async function auditGovernanceHooks({ home }) {
  home = resolve(home);
  const files = paths(home);
  const problems = [];
  try {
    for (const path of Object.values(files)) await regularPath(home, path);
    if (!(await lstat(files.engine)).isFile()) problems.push("Governance launcher is not a regular file");
    const config = parseConfig(await optional(files.hooks));
    for (const [event, expected] of Object.entries(definitions(home))) {
      const groups = config.hooks?.[event];
      if (!Array.isArray(groups) || groups.filter((group) => JSON.stringify(group) === JSON.stringify(expected)).length !== 1) problems.push(`Managed ${event} definition missing or drifted`);
    }
  } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  return { ok: problems.length === 0, operation: "governance-hooks-audit", status: problems.length ? "invalid" : "installed", trust: "host-verification-required", operationalEnforcement: "not-established-by-installation", paths: files, problems };
}

/** @param {{home:string}} options */
export async function enableGovernanceHooks({ home }) {
  await assertLockRuntimeAvailable();
  home = resolve(home);
  const files = paths(home);
  for (const path of Object.values(files)) await regularPath(home, path);
  if (!(await lstat(files.engine)).isFile()) throw new Error("Install the governance runtime before its hooks");
  const before = { hooks: await optional(files.hooks), state: await optional(files.state) };
  const next = JSON.stringify(merge(parseConfig(before.hooks), home), null, 2) + "\n";
  if (next === before.hooks) return { ...(await auditGovernanceHooks({ home })), changed: false };
  const prior = before.state === null ? null : JSON.parse(before.state);
  if (prior && (prior.schemaVersion !== 1 || !(prior.before === null || typeof prior.before === "string") || typeof prior.installed !== "string")) throw new Error("Invalid governance hook recovery snapshot");
  // Preserve the earliest rollback boundary only while its installed bytes match.
  const original = prior?.installed === before.hooks ? prior.before : before.hooks;
  const state = { schemaVersion: 1, before: original, installed: next, installedAt: new Date().toISOString() };
  try {
    await atomic(files.state, JSON.stringify(state, null, 2) + "\n");
    await atomic(files.hooks, next);
    const audit = await auditGovernanceHooks({ home });
    if (!audit.ok) throw new Error(audit.problems.join("; "));
    return { ...audit, operation: "governance-hooks-enable", changed: true };
  } catch (error) {
    await atomic(files.hooks, before.hooks);
    await atomic(files.state, before.state);
    throw error;
  }
}

/** @param {{home:string}} options */
export async function rollbackGovernanceHooks({ home }) {
  home = resolve(home);
  const files = paths(home);
  for (const path of [files.hooks, files.state]) await regularPath(home, path);
  const bytes = await optional(files.state);
  if (bytes === null) return { ok: true, operation: "governance-hooks-rollback", changed: false };
  const state = JSON.parse(bytes);
  if (state.schemaVersion !== 1 || typeof state.installed !== "string" || !(state.before === null || typeof state.before === "string")) throw new Error("Invalid governance hook recovery snapshot");
  if (await optional(files.hooks) !== state.installed) throw new Error("Governance rollback refuses to overwrite hooks changed after installation");
  await atomic(files.hooks, state.before);
  await atomic(files.state, null);
  return { ok: true, operation: "governance-hooks-rollback", changed: true };
}

/** Keep hooks active when the accompanying contract rollback fails.
 * @template T
 * @param {{home:string, rollback:()=>Promise<T>}} options
 */
export async function withGovernanceHookRollback({ home, rollback }) {
  home = resolve(home);
  const files = paths(home);
  for (const path of [files.hooks, files.state]) await regularPath(home, path);
  const before = { hooks: await optional(files.hooks), state: await optional(files.state) };
  const result = await rollbackGovernanceHooks({ home });
  const after = { hooks: await optional(files.hooks), state: await optional(files.state) };
  try { return await rollback(); }
  catch (error) {
    if (result.changed) {
      if (await optional(files.hooks) !== after.hooks || await optional(files.state) !== after.state) {
        throw new Error("Contract rollback failed and hook configuration changed concurrently; preserve it and reconcile the saved installation before continuing", { cause: error });
      }
      await atomic(files.state, before.state);
      await atomic(files.hooks, before.hooks);
    }
    throw error;
  }
}
