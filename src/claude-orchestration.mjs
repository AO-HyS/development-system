// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { probeCoach, probeReviewDifficulty } from "./claude-orchestration-coach-probe.mjs";

const guardRelative = ".codex/development-system/runtime/claude-orchestration/roster-guard.mjs";
const policyRelative = ".codex/development-system/runtime/claude-orchestration/policy.json";
const stopGateRelative = ".codex/development-system/runtime/report-gate/stop-gate.mjs";
/** The Stop gate resolves HOME at run time so the settings entry stays portable. */
const stopGateCommand = `node "$HOME/${stopGateRelative}" --harness claude`;
const settingsRelative = ".claude/settings.json";
export const stateRelative = ".development-system/claude-orchestration/state.json";
const manifestRelative = ".development-system/installed-manifest.json";
const ledgerRelative = ".development-system/private/runs/claude-orchestration";
export const managedEnv = /** @type {const} */ ({
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
  // Compact near 300K tokens instead of the 1M window: every call rereads the whole context.
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000",
});
/**
 * Top-level settings keys the installation owns. Claude Code gives the skill listing 1 % of the context window and,
 * when it overflows, announces the least used skills as bare names. Measured 17 Nov 2026 in fresh sessions: at the default
 * 77 of 250 skills carried a description (30K characters); at 0.03 all 250 did (87K), with 3 % of that budget left. 0.05
 * leaves room for the skills a product repository adds. `development-system doctor` reports what the last session
 * really announced.
 */
export const managedSettings = /** @type {const} */ ({ skillListingBudgetFraction: 0.05 });
/**
 * DS 3.0.0 wires no roster-guard event (PreToolUse, PostToolUse, SubagentStop) and no Stop → stop-gate event. Enabling
 * removes those managed entries left by an older version and keeps every other hook; the runtime files may stay
 * installed, unwired. A contract rollback restores the previous settings bytes, entries included.
 * @type {{ event: string, matcher: string | undefined, timeout: number, statusMessage: string | undefined, target: "guard" | "stopGate" }[]}
 */
const managedEvents = [];

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
    stopGate: insideHome(home, stopGateRelative),
    settings: insideHome(home, settingsRelative),
    state: insideHome(home, stateRelative),
    manifest: insideHome(home, manifestRelative),
    ledger: insideHome(home, ledgerRelative),
    command: `node ${shellQuote(guard)}`,
    stopCommand: stopGateCommand,
  };
}

/** @param {ReturnType<typeof paths>} managed @param {typeof managedEvents[number]} spec */
function commandFor(managed, spec) {
  return spec.target === "stopGate" ? managed.stopCommand : managed.command;
}

/** @param {ReturnType<typeof paths>} managed */
function managedCommands(managed) {
  return [managed.command, managed.stopCommand];
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
  for (const [label, destination, path] of [["guard", guardRelative, managed.guard], ["policy", policyRelative, managed.policy], ["stop gate", stopGateRelative, managed.stopGate]]) {
    const artifact = artifacts.find((entry) => entry && entry.destination === destination);
    // Unwired since 3.0.0: a version may leave these runtime files out; one it declares must match.
    if (!artifact && managedEvents.length === 0) continue;
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
 * Removes only hook objects whose command equals one of the managed commands. An entry is dropped
 * only when its hooks array becomes empty; with `prune`, event arrays and the hooks object
 * emptied by the removal are dropped too.
 * @param {any} container @param {string[]} commands @param {boolean} prune
 */
function withoutManaged(container, commands, prune) {
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
      const kept = /** @type {any[]} */ (entry.hooks).filter((hook) => !(hook && typeof hook === "object" && commands.includes(hook.command)));
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

/** @param {any} settings @param {ReturnType<typeof paths>} managed */
function mergedSettings(settings, managed) {
  // With nothing to add back, an event (or the hooks object) the removal empties is dropped; unrelated ones stay as written.
  const unwired = managedEvents.length === 0;
  const base = withoutManaged(settings.hooks, managedCommands(managed), unwired);
  /** @type {Record<string, any>} */
  const hooks = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const spec of managedEvents) {
    const existing = Array.isArray(hooks[spec.event]) ? hooks[spec.event] : [];
    hooks[spec.event] = [...existing, managedEntry(commandFor(managed, spec), spec)];
  }
  const env = settings.env && typeof settings.env === "object" && !Array.isArray(settings.env) ? { ...settings.env } : {};
  Object.assign(env, managedEnv);
  const next = { ...settings, ...managedSettings, hooks, env };
  if (unwired && (base === undefined || base === null)) delete next.hooks;
  return next;
}

/**
 * @param {any} settings @param {string[]} commands
 * @param {Record<string, {before: string | null, installed: string}>} envState
 * @param {Record<string, {before: unknown, installed: unknown}>} [topState] managed top-level keys; null `before` means absent
 */
function structuralRollback(settings, commands, envState, topState) {
  const next = { ...settings };
  for (const [key, record] of Object.entries(topState ?? {})) {
    if (next[key] !== record.installed) continue;
    if (record.before === null) delete next[key];
    else next[key] = record.before;
  }
  const hooks = withoutManaged(settings.hooks, commands, true);
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
  // `top` exists since 4.0.0; a snapshot written by an older version has none.
  if (state.top !== undefined && (!state.top || typeof state.top !== "object")) throw new Error("Claude orchestration activation snapshot is invalid");
  return /** @type {{schema: 1, settings: {before: string | null, installed: string}, env: Record<string, {before: string | null, installed: string}>, top?: Record<string, {before: unknown, installed: unknown}>}} */ (state);
}

/**
 * Runs the installed guard once on crafted PreToolUse input: an Agent dispatch of `subagentType`, or with `delegate`
 * a T3 delegate_task carrying that task text and role.
 * @param {string} home @param {string} guard @param {string} subagentType @param {{task: string, role?: string}} [delegate]
 * @param {string} [prompt] the Agent prompt
 */
function probe(home, guard, subagentType, delegate, prompt = "audit probe") {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, HOME: home };
  delete env.TYPESAFE_API_KEY;
  delete env.CLAUDE_ROSTER_GUARD;
  const input = JSON.stringify({
    session_id: "audit",
    hook_event_name: "PreToolUse",
    tool_name: delegate ? "mcp__t3-code__delegate_task" : "Agent",
    cwd: home,
    tool_input: delegate ? { task: delegate.task, ...(delegate.role ? { role: delegate.role } : {}) } : { subagent_type: subagentType, description: "audit probe", prompt },
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
  for (const path of [managed.guard, managed.policy, managed.stopGate, managed.settings, managed.state]) {
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
        if (hook?.command === commandFor(managed, spec)) matches.push({ entry, hook });
      }
    }
    if (matches.length !== 1) { findings.push(`${spec.event} has ${matches.length} managed hooks; expected exactly one`); continue; }
    const [{ entry, hook }] = matches;
    if (entry.matcher !== spec.matcher) findings.push(`${spec.event} managed hook has matcher ${JSON.stringify(entry.matcher)}; expected ${JSON.stringify(spec.matcher)}`);
    if (hook.type !== "command" || hook.timeout !== spec.timeout) findings.push(`${spec.event} managed hook must be a command with timeout ${spec.timeout}`);
  }
  for (const [label, command] of [["roster guard", managed.command], ["stop gate", managed.stopCommand]]) {
    if (!managedEvents.some((spec) => commandFor(managed, spec) === command) && hasManagedHook(settings.hooks, command)) {
      findings.push(`Claude Code settings still wire the ${label}; this version does not`);
    }
  }
  const missingTarget = "managed hook targets a missing guard";
  if (hasManagedHook(settings.hooks, managed.command) && (await readOptional(managed.guard)) === null && !findings.includes(missingTarget)) {
    findings.push(missingTarget);
  }
  if (hasManagedHook(settings.hooks, managed.stopCommand) && (await readOptional(managed.stopGate)) === null) {
    findings.push("managed Stop hook targets a missing stop gate");
  }
  for (const [key, value] of Object.entries(managedEnv)) {
    if (settings.env?.[key] !== value) findings.push(`env ${key} is ${JSON.stringify(settings.env?.[key])}; expected ${JSON.stringify(value)}`);
  }
  for (const [key, value] of Object.entries(managedSettings)) {
    if (settings[key] !== value) findings.push(`setting ${key} is ${JSON.stringify(settings[key])}; expected ${JSON.stringify(value)}`);
  }
  /** @type {ReturnType<typeof probe>[]} */
  const probes = [];
  /** @type {string[]} */
  const sideEffects = [];
  // An unwired guard enforces nothing, so its probes prove nothing about this installation.
  if (managedEvents.some((spec) => spec.target === "guard") && (await readOptional(managed.guard)) !== null) {
    const denied = probe(resolvedHome, managed.guard, "general-purpose");
    const allowed = probe(resolvedHome, managed.guard, "code-mapper");
    // The review brake on T3 delegate_task: a non-review task passes untouched (no output); a review without
    // `Review kind:` is denied before any reservation, so neither probe reaches GitHub or a ledger.
    const plainDelegate = probe(resolvedHome, managed.guard, "delegate_task:implementation", { task: "Objective: audit probe", role: "implementation" });
    const reviewDelegate = probe(resolvedHome, managed.guard, "delegate_task:review", { task: "Objective: audit probe", role: "review" });
    // Fable reviewer admitted for security; retired plan-reviewer denied.
    const primaryReviewer = probe(resolvedHome, managed.guard, "reviewer", undefined, "Review kind: security\nObjective: audit probe");
    const retiredReviewer = probe(resolvedHome, managed.guard, "plan-reviewer");
    probes.push(denied, allowed, plainDelegate, reviewDelegate, primaryReviewer, retiredReviewer);
    if (!denied.denied) findings.push("Guard probe did not deny general-purpose");
    if (allowed.status !== 0 || allowed.denied) findings.push("Guard probe did not allow code-mapper");
    if (plainDelegate.status !== 0 || plainDelegate.output.trim() !== "") findings.push("Guard probe did not pass a non-review delegate_task untouched");
    if (!reviewDelegate.denied) findings.push("Guard probe did not deny a review delegate_task without Review kind (installed guard predates the review brake)");
    if (primaryReviewer.status !== 0 || primaryReviewer.denied) findings.push("Guard probe denied reviewer with Review kind: security (guard predates the Fable reviewer)");
    if (!retiredReviewer.denied) findings.push("Guard probe did not deny the retired plan-reviewer");
    findings.push(...probeCoach(resolvedHome, managed.guard), ...probeReviewDifficulty(resolvedHome, managed.guard));
    sideEffects.push(`Guard probes append ledger lines and coach sessions under ${managed.ledger}`);
  }
  const ok = findings.length === 0;
  return { ok, operation: "claude-orchestration-audit", status: ok ? "healthy" : "unhealthy", findings, probes, sideEffects };
}

/** @param {{home: string}} options */
export async function enableClaudeOrchestration({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of [managed.guard, managed.policy, managed.stopGate, managed.settings, managed.state, managed.manifest]) {
    await assertNoSymlinkParents(resolvedHome, path);
  }
  const preconditions = await artifactFindings(managed);
  if (preconditions.length > 0) throw new Error(`Claude orchestration cannot be enabled:\n- ${preconditions.join("\n- ")}`);
  const current = await readOptional(managed.settings);
  const settings = parseObject(current, "Claude Code settings");
  const stateBytes = await readOptional(managed.state);
  const state = parseState(stateBytes);
  const installed = serialize(mergedSettings(settings, managed));
  const unchanged = current !== null && current.equals(installed);
  if (unchanged && state) {
    return { ...(await auditClaudeOrchestration({ home: resolvedHome })), operation: "claude-orchestration-enable", changed: false };
  }
  const matchesInstalled = state !== null && current !== null && current.equals(Buffer.from(state.settings.installed, "base64"));
  /** @type {string | null} */
  let before;
  if (!state) {
    if (current === null) before = null;
    else if (managedCommands(managed).some((command) => hasManagedHook(settings.hooks, command))) {
      const next = { ...settings };
      const hooks = withoutManaged(settings.hooks, managedCommands(managed), true);
      if (hooks === undefined) delete next.hooks;
      else next.hooks = hooks;
      before = serialize(next).toString("base64");
    } else before = current.toString("base64");
  } else if (matchesInstalled) before = state.settings.before;
  else before = current === null ? null : serialize(structuralRollback(settings, managedCommands(managed), state.env, state.top)).toString("base64");
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
  /** @type {Record<string, {before: unknown, installed: unknown}>} */
  const top = {};
  for (const [key, value] of Object.entries(managedSettings)) {
    const stored = state?.top?.[key];
    const existing = settings[key];
    // A value the operator wrote over the installed one becomes the value a rollback returns to.
    if (stored && !matchesInstalled && existing !== undefined && existing !== stored.installed) top[key] = { before: existing, installed: value };
    else top[key] = { before: stored ? stored.before : existing === undefined ? null : existing, installed: value };
  }
  const nextState = { schema: 1, settings: { before, installed: installed.toString("base64") }, env, top };
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
    await writeAtomic(managed.settings, serialize(structuralRollback(settings, managedCommands(managed), state.env, state.top)));
    status = "structurally-restored";
  }
  await unlink(managed.state);
  return { ok: true, operation: "claude-orchestration-rollback", status, externalSideEffects: [] };
}
