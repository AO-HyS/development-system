// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const guardRelative = ".codex/development-system/runtime/claude-orchestration/roster-guard.mjs";
const policyRelative = ".codex/development-system/runtime/claude-orchestration/policy.json";
const settingsRelative = ".claude/settings.json";
const stateRelative = ".development-system/claude-orchestration/state.json";
const manifestRelative = ".development-system/installed-manifest.json";
const ledgerRelative = ".development-system/private/runs/claude-orchestration";
const managedEnv = /** @type {const} */ ({
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
});
const managedEvents = /** @type {const} */ ([
  { event: "PreToolUse", matcher: "Agent|Read|.*[Ss]creenshot.*", timeout: 20, statusMessage: "Checking roster and image budget" },
  { event: "PostToolUse", matcher: "Agent", timeout: 5, statusMessage: undefined },
  { event: "SubagentStop", matcher: undefined, timeout: 5, statusMessage: undefined },
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

/** @param {Buffer} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** @param {any} value */
function serialize(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

/** @param {string} home */
function paths(home) {
  const guard = insideHome(home, guardRelative);
  return {
    guard,
    policy: insideHome(home, policyRelative),
    settings: insideHome(home, settingsRelative),
    state: insideHome(home, stateRelative),
    manifest: insideHome(home, manifestRelative),
    ledger: insideHome(home, ledgerRelative),
    command: `node ${shellQuote(guard)}`,
  };
}

/** @param {ReturnType<typeof paths>} managed */
async function artifactFindings(managed) {
  /** @type {string[]} */
  const findings = [];
  const contents = await readOptional(managed.manifest);
  if (contents === null) return ["Development System installation is missing: no installed manifest"];
  /** @type {any} */
  let manifest;
  try { manifest = parseObject(contents, "Installed manifest"); }
  catch (error) { return [`Installed manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`]; }
  const artifacts = /** @type {any[]} */ (Array.isArray(manifest.artifacts) ? manifest.artifacts : []);
  for (const [label, destination, path] of [["guard", guardRelative, managed.guard], ["policy", policyRelative, managed.policy]]) {
    const artifact = artifacts.find((entry) => entry && entry.destination === destination);
    if (!artifact) { findings.push(`Installed manifest does not declare the ${label} at ${destination}`); continue; }
    const actual = await readOptional(path);
    if (actual === null) {
      findings.push(label === "guard" ? "Installed guard is missing" : `Installed ${label} is missing at ${destination}`);
    } else if (sha256(actual) !== artifact.sha256) {
      findings.push(`Installed ${label} hash does not match the installed manifest`);
    }
  }
  return findings;
}

/** @param {string} command @param {typeof managedEvents[number]} spec */
function managedEntry(command, spec) {
  /** @type {Record<string, unknown>} */
  const hook = { type: "command", command, timeout: spec.timeout };
  if (spec.statusMessage) hook.statusMessage = spec.statusMessage;
  /** @type {Record<string, unknown>} */
  const entry = {};
  if (spec.matcher !== undefined) entry.matcher = spec.matcher;
  entry.hooks = [hook];
  return entry;
}

/**
 * Removes only hook objects whose command equals the managed command. An entry is dropped
 * only when its hooks array becomes empty; with `prune`, event arrays and the hooks object
 * emptied by the removal are dropped too.
 * @param {any} container @param {string} command @param {boolean} prune
 */
function withoutManaged(container, command, prune) {
  if (!container || typeof container !== "object" || Array.isArray(container)) return container;
  /** @type {Record<string, any>} */
  const hooks = { ...container };
  let removedAny = false;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    let removed = false;
    const next = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) { next.push(entry); continue; }
      const kept = /** @type {any[]} */ (entry.hooks).filter((hook) => !(hook && typeof hook === "object" && hook.command === command));
      if (kept.length === entry.hooks.length) { next.push(entry); continue; }
      removed = true;
      if (kept.length > 0) next.push({ ...entry, hooks: kept });
    }
    if (!removed) continue;
    removedAny = true;
    if (prune && next.length === 0) delete hooks[event];
    else hooks[event] = next;
  }
  if (prune && removedAny && Object.keys(hooks).length === 0) return undefined;
  return hooks;
}

/** @param {any} container @param {string} command */
function hasManagedHook(container, command) {
  if (!container || typeof container !== "object" || Array.isArray(container)) return false;
  return Object.values(container).some((entries) => Array.isArray(entries) && entries.some((entry) =>
    entry && typeof entry === "object" && Array.isArray(entry.hooks)
    && entry.hooks.some((/** @type {any} */ hook) => hook && typeof hook === "object" && hook.command === command)));
}

/** @param {any} settings @param {string} command */
function mergedSettings(settings, command) {
  const base = withoutManaged(settings.hooks, command, false);
  /** @type {Record<string, any>} */
  const hooks = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const spec of managedEvents) {
    const existing = Array.isArray(hooks[spec.event]) ? hooks[spec.event] : [];
    hooks[spec.event] = [...existing, managedEntry(command, spec)];
  }
  const env = settings.env && typeof settings.env === "object" && !Array.isArray(settings.env) ? { ...settings.env } : {};
  Object.assign(env, managedEnv);
  return { ...settings, hooks, env };
}

/**
 * @param {any} settings @param {string} command
 * @param {Record<string, {before: string | null, installed: string}>} envState
 */
function structuralRollback(settings, command, envState) {
  const next = { ...settings };
  const hooks = withoutManaged(settings.hooks, command, true);
  if (hooks === undefined) delete next.hooks;
  else if ("hooks" in settings) next.hooks = hooks;
  if (settings.env && typeof settings.env === "object" && !Array.isArray(settings.env)) {
    const env = { ...settings.env };
    let changed = false;
    for (const [key, record] of Object.entries(envState ?? {})) {
      if (env[key] !== record.installed) continue;
      changed = true;
      if (record.before === null) delete env[key];
      else env[key] = record.before;
    }
    if (changed && Object.keys(env).length === 0) delete next.env;
    else next.env = env;
  }
  return next;
}

/** @param {Buffer | null} contents */
function parseState(contents) {
  if (contents === null) return null;
  const state = JSON.parse(contents.toString("utf8"));
  if (state?.schema !== 1 || !state.settings || typeof state.settings.installed !== "string" || !state.env || typeof state.env !== "object") {
    throw new Error("Claude orchestration activation snapshot is invalid");
  }
  return /** @type {{schema: 1, settings: {before: string | null, installed: string}, env: Record<string, {before: string | null, installed: string}>}} */ (state);
}

/** @param {string} home @param {string} guard @param {string} subagentType */
function probe(home, guard, subagentType) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, HOME: home };
  delete env.TYPESAFE_API_KEY;
  delete env.CLAUDE_ROSTER_GUARD;
  const input = JSON.stringify({
    session_id: "audit",
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    cwd: home,
    tool_input: { subagent_type: subagentType, description: "audit probe", prompt: "audit probe" },
  });
  const result = spawnSync(process.execPath, [guard], { input, env, encoding: "utf8", timeout: 30000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { subagentType, status: result.status, denied: /"deny"/u.test(output) || /\bdeny\b/u.test(output), output: output.slice(0, 2000) };
}

/** @param {{home: string}} options */
export async function auditClaudeOrchestration({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  /** @type {string[]} */
  const findings = [];
  for (const path of [managed.guard, managed.policy, managed.settings, managed.state]) {
    try { await assertNoSymlinkParents(resolvedHome, path); }
    catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
  }
  findings.push(...(await artifactFindings(managed)));
  /** @type {any} */
  let settings = {};
  const settingsBytes = await readOptional(managed.settings);
  if (settingsBytes === null) findings.push("Claude Code settings are missing");
  else {
    try { settings = parseObject(settingsBytes, "Claude Code settings"); }
    catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
  }
  for (const spec of managedEvents) {
    const entries = /** @type {any[]} */ (Array.isArray(settings.hooks?.[spec.event]) ? settings.hooks[spec.event] : []);
    const matches = [];
    for (const entry of entries) {
      for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : []) {
        if (hook?.command === managed.command) matches.push({ entry, hook });
      }
    }
    if (matches.length !== 1) { findings.push(`${spec.event} has ${matches.length} managed hooks; expected exactly one`); continue; }
    const [{ entry, hook }] = matches;
    if (entry.matcher !== spec.matcher) findings.push(`${spec.event} managed hook has matcher ${JSON.stringify(entry.matcher)}; expected ${JSON.stringify(spec.matcher)}`);
    if (hook.type !== "command" || hook.timeout !== spec.timeout) findings.push(`${spec.event} managed hook must be a command with timeout ${spec.timeout}`);
  }
  const missingTarget = "managed hook targets a missing guard";
  if (hasManagedHook(settings.hooks, managed.command) && (await readOptional(managed.guard)) === null && !findings.includes(missingTarget)) {
    findings.push(missingTarget);
  }
  for (const [key, value] of Object.entries(managedEnv)) {
    if (settings.env?.[key] !== value) findings.push(`env ${key} is ${JSON.stringify(settings.env?.[key])}; expected ${JSON.stringify(value)}`);
  }
  /** @type {ReturnType<typeof probe>[]} */
  const probes = [];
  /** @type {string[]} */
  const sideEffects = [];
  if ((await readOptional(managed.guard)) !== null) {
    const denied = probe(resolvedHome, managed.guard, "general-purpose");
    const allowed = probe(resolvedHome, managed.guard, "code-mapper");
    probes.push(denied, allowed);
    if (!denied.denied) findings.push("Guard probe did not deny general-purpose");
    if (allowed.status !== 0 || allowed.denied) findings.push("Guard probe did not allow code-mapper");
    sideEffects.push(`Guard probes append ledger lines under ${managed.ledger}`);
  }
  const ok = findings.length === 0;
  return { ok, operation: "claude-orchestration-audit", status: ok ? "healthy" : "unhealthy", findings, probes, sideEffects };
}

/** @param {{home: string}} options */
export async function enableClaudeOrchestration({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of [managed.guard, managed.policy, managed.settings, managed.state, managed.manifest]) {
    await assertNoSymlinkParents(resolvedHome, path);
  }
  const preconditions = await artifactFindings(managed);
  if (preconditions.length > 0) throw new Error(`Claude orchestration cannot be enabled:\n- ${preconditions.join("\n- ")}`);
  const current = await readOptional(managed.settings);
  const settings = parseObject(current, "Claude Code settings");
  const stateBytes = await readOptional(managed.state);
  const state = parseState(stateBytes);
  const installed = serialize(mergedSettings(settings, managed.command));
  const unchanged = current !== null && current.equals(installed);
  if (unchanged && state) {
    return { ...(await auditClaudeOrchestration({ home: resolvedHome })), operation: "claude-orchestration-enable", changed: false };
  }
  const matchesInstalled = state !== null && current !== null && current.equals(Buffer.from(state.settings.installed, "base64"));
  /** @type {string | null} */
  let before;
  if (!state) {
    if (current === null) before = null;
    else if (hasManagedHook(settings.hooks, managed.command)) {
      const next = { ...settings };
      const hooks = withoutManaged(settings.hooks, managed.command, true);
      if (hooks === undefined) delete next.hooks;
      else next.hooks = hooks;
      before = serialize(next).toString("base64");
    } else before = current.toString("base64");
  } else if (matchesInstalled) before = state.settings.before;
  else before = current === null ? null : serialize(structuralRollback(settings, managed.command, state.env)).toString("base64");
  /** @type {Record<string, {before: string | null, installed: string}>} */
  const env = {};
  for (const [key, value] of Object.entries(managedEnv)) {
    const stored = state?.env?.[key];
    const existing = settings.env?.[key];
    if (stored && state && !matchesInstalled && typeof existing === "string" && existing !== stored.installed) {
      env[key] = { before: existing, installed: value };
    } else {
      env[key] = { before: stored ? stored.before : typeof existing === "string" ? existing : null, installed: value };
    }
  }
  const nextState = { schema: 1, settings: { before, installed: installed.toString("base64") }, env };
  try {
    await writeAtomic(managed.state, serialize(nextState));
    if (!unchanged) await writeAtomic(managed.settings, installed);
    const audit = await auditClaudeOrchestration({ home: resolvedHome });
    if (!audit.ok) throw new Error(`Claude orchestration activation failed verification:\n- ${audit.findings.join("\n- ")}`);
    return { ...audit, operation: "claude-orchestration-enable", changed: !unchanged, statePath: managed.state };
  } catch (error) {
    await restoreBytes(managed.settings, current);
    await restoreBytes(managed.state, stateBytes);
    throw error;
  }
}

/** @param {{home: string}} options */
export async function rollbackClaudeOrchestration({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of [managed.settings, managed.state]) await assertNoSymlinkParents(resolvedHome, path);
  const state = parseState(await readOptional(managed.state));
  if (!state) throw new Error("No Claude orchestration activation snapshot exists");
  const current = await readOptional(managed.settings);
  let status;
  if (current === null) {
    status = "nothing-to-restore";
  } else if (current.equals(Buffer.from(state.settings.installed, "base64"))) {
    await restoreBytes(managed.settings, state.settings.before === null ? null : Buffer.from(state.settings.before, "base64"));
    status = "restored";
  } else {
    const settings = parseObject(current, "Claude Code settings");
    await writeAtomic(managed.settings, serialize(structuralRollback(settings, managed.command, state.env)));
    status = "structurally-restored";
  }
  await unlink(managed.state);
  return { ok: true, operation: "claude-orchestration-rollback", status, externalSideEffects: [] };
}
