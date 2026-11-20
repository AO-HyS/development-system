// @ts-check
// `claude-light apply|undo <repo>`: a reversible light start for one product repo (DS 4.1.0, plan §4).
//
// apply merges only reduction keys into <repo>/.claude/settings.local.json (skills, plugins, MCP and connectors the
// task does not use, switched off); the profile in config/claude-light/ lists only what is kept and the rest is
// computed from the inventory of the moment (names only: never values, env, tokens or commands). Before the first
// write it saves the previous bytes (or their absence), the mode and the fingerprint of what it wrote under
// ~/.development-system/private/claude-light/<id>/. undo restores those bytes only while the file is still what apply
// wrote; otherwise it refuses and writes nothing.
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync,
  realpathSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROFILE_DIR = fileURLToPath(new URL("../config/claude-light/", import.meta.url));
const PROFILES = ["barber", "nutriplan", "planeta-aula", "casa-roca"];
const SETTINGS_RELATIVE = ".claude/settings.local.json";
const AGENT_NAMES = ["escritor-rapido", "verificador-pantalla"];
const USAGE = "claude-light apply|undo <repo-absoluto> [--agentes <carpeta-del-candidato>] [--home <dir>] [--json]";

/** @param {Buffer | string} bytes */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @typedef {{profile: string, remotes: string[], keep: {skills: string[], plugins: string[], mcp: string[]}}} Profile
 * @typedef {{path: string, sha256: string}} AgentRecord
 * @typedef {{
 *   version: 1, profile: string, root: string, existed: boolean, mode: number | null, originalSha256: string | null,
 *   lastSha256: string, claudeDirCreated: boolean, excludeLines: string[], agents: AgentRecord[],
 *   off: {skills: string[], plugins: string[], mcp: string[]}, at: string
 * }} State
 */

/** @param {string} target @returns {import("node:fs").Stats | undefined} */
function lstatOrUndefined(target) {
  try { return lstatSync(target); } catch { return undefined; }
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  const run = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return { status: run.status, stdout: run.stdout ?? "" };
}

/** Atomic write: temp file in the same directory, fsync, rename. @param {string} target @param {Buffer | string} bytes @param {number} mode */
function writeAtomic(target, bytes, mode) {
  const temporary = `${target}.${process.pid}.tmp`;
  const descriptor = openSync(temporary, "wx", mode);
  try {
    writeSync(descriptor, typeof bytes === "string" ? Buffer.from(bytes) : bytes);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
  closeSync(descriptor);
  try { chmodSync(temporary, mode); renameSync(temporary, target); } catch (error) { rmSync(temporary, { force: true }); throw error; }
}

/** @param {string} root */
function selectProfile(root) {
  /** @type {string[]} */
  const remotes = git(root, ["config", "--get-regexp", "^remote\\..*\\.url$"]).stdout.split("\n")
    .flatMap((line) => {
      const match = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/iu.exec(line.trim().split(/\s+/u)[1] ?? "");
      return match ? [match[1].toLowerCase()] : [];
    });
  for (const name of PROFILES) {
    /** @type {Profile} */
    const profile = JSON.parse(readFileSync(path.join(PROFILE_DIR, `${name}.json`), "utf8"));
    if (profile.remotes.some((remote) => remotes.includes(remote.toLowerCase()))) return profile;
  }
  throw new Error(`claude-light: ${root} has no GitHub remote declared by a profile (${PROFILES.join(", ")}); nothing was written`);
}

/** Names only: never values. @param {string} file @param {(parsed: Record<string, any>) => unknown} pick @returns {string[]} */
function readKeyNames(file, pick) {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const picked = isObject(parsed) ? pick(parsed) : undefined;
  return isObject(picked) ? Object.keys(picked) : [];
}

/** @param {string} root @param {string} home @param {Profile} profile */
function computeOff(root, home, profile) {
  const keep = profile.keep;
  const ownSkills = new Set(existsSync(path.join(root, ".claude/skills")) ? readdirSync(path.join(root, ".claude/skills")) : []);
  const skillsDir = path.join(home, ".claude/skills");
  const skills = (existsSync(skillsDir) ? readdirSync(skillsDir) : [])
    .filter((name) => !name.startsWith(".") && name !== "synced" && !keep.skills.includes(name) && !ownSkills.has(name)).sort();
  const plugins = readKeyNames(path.join(home, ".claude/settings.json"), (parsed) => parsed.enabledPlugins)
    .filter((id) => !keep.plugins.includes(id)).sort();
  const mcp = readKeyNames(path.join(home, ".claude.json"), (parsed) => parsed.mcpServers)
    .filter((id) => !keep.mcp.includes(id)).sort();
  return { skills, plugins, mcp };
}

/** @param {Record<string, any>} old @param {{skills: string[], plugins: string[], mcp: string[]}} off */
function mergeSettings(old, off) {
  const out = { ...old };
  if (old.enabledPlugins !== undefined && !isObject(old.enabledPlugins)) throw new Error("claude-light: enabledPlugins in the existing file is not an object; nothing was written");
  if (old.skillOverrides !== undefined && !isObject(old.skillOverrides)) throw new Error("claude-light: skillOverrides in the existing file is not an object; nothing was written");
  if (old.permissions !== undefined && !isObject(old.permissions)) throw new Error("claude-light: permissions in the existing file is not an object; nothing was written");
  if (old.permissions?.deny !== undefined && !Array.isArray(old.permissions.deny)) throw new Error("claude-light: permissions.deny in the existing file is not a list; nothing was written");
  if (off.plugins.length > 0) out.enabledPlugins = { ...old.enabledPlugins, ...Object.fromEntries(off.plugins.map((id) => [id, false])) };
  out.disableClaudeAiConnectors = true;
  if (off.skills.length > 0) out.skillOverrides = { ...old.skillOverrides, ...Object.fromEntries(off.skills.map((name) => [name, "off"])) };
  const deny = [...(old.permissions?.deny ?? [])];
  for (const id of off.mcp) if (!deny.includes(`mcp__${id}__*`)) deny.push(`mcp__${id}__*`);
  if (deny.length > 0) out.permissions = { ...old.permissions, deny };
  return out;
}

/** Findings the owner must see: a kept service the existing file already blocks. @param {Record<string, any>} old @param {Profile} profile */
function carencias(old, profile) {
  /** @type {string[]} */
  const notes = [];
  for (const id of profile.keep.mcp) if ((old.permissions?.deny ?? []).some((/** @type {unknown} */ entry) => typeof entry === "string" && entry.startsWith(`mcp__${id}__`))) notes.push(`existing deny blocks kept MCP ${id}`);
  for (const id of profile.keep.plugins) if (old.enabledPlugins?.[id] === false) notes.push(`plugin ${id} was already off (left off)`);
  return notes;
}

/** @param {string} home @param {string} root @param {string} profile */
function stateLocation(home, root, profile) {
  const directory = path.join(home, ".development-system/private/claude-light", `${profile}-${sha256(root).slice(0, 10)}`);
  return { directory, state: path.join(directory, "state.json"), backup: path.join(directory, "previous.bytes") };
}

/** @param {string} directory */
function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

/** @param {string} root @param {string} relative @returns {boolean} true when git already ignores it */
function isIgnored(root, relative) {
  const status = git(root, ["check-ignore", "-q", "--", relative]).status;
  if (status === 0) return true;
  if (status === 1) return false;
  throw new Error(`claude-light: git check-ignore failed for ${relative}; nothing was written`);
}

/**
 * The file to edit for .git/info/exclude. A link is followed, so the link stays and its target keeps its own mode.
 * @param {string} root
 */
function excludePath(root) {
  const resolved = git(root, ["rev-parse", "--git-path", "info/exclude"]).stdout.trim();
  if (!resolved) throw new Error("claude-light: cannot locate .git/info/exclude; nothing was written");
  const file = path.resolve(root, resolved);
  const stat = lstatOrUndefined(file);
  if (stat?.isSymbolicLink()) {
    try { return realpathSync(file); } catch { throw new Error("claude-light: .git/info/exclude is a broken link; nothing was written"); }
  }
  if (stat && !stat.isFile()) throw new Error("claude-light: .git/info/exclude is not a regular file; nothing was written");
  return file;
}

/** @param {string} root @param {string} line */
function addExcludeLine(root, line) {
  const file = excludePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split("\n").includes(line)) return false;
  writeAtomic(file, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${line}\n`, existsSync(file) ? statSync(file).mode & 0o777 : 0o644);
  return true;
}

/** @param {string} root @param {string} line */
function removeExcludeLine(root, line) {
  const file = excludePath(root);
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split("\n");
  const index = lines.indexOf(line);
  if (index < 0) return;
  lines.splice(index, 1);
  writeAtomic(file, lines.join("\n"), statSync(file).mode & 0o777);
}

/**
 * Refuses when a folder between the repository root and `relative` is a link or not a folder, so nothing is read,
 * written or deleted outside the checkout through a parent link.
 * @param {string} root @param {string} relative
 */
function assertPlainParents(root, relative) {
  let current = root;
  for (const part of path.dirname(relative).split(path.sep).filter((piece) => piece && piece !== ".")) {
    current = path.join(current, part);
    const stat = lstatOrUndefined(current);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error(`claude-light: ${path.relative(root, current)} is a link or not a directory; nothing was written`);
  }
}

/** @param {string} directory @returns {{[name: string]: string} | undefined} */
function findAgentSources(directory) {
  const base = path.resolve(directory);
  for (const candidate of ["claude/agents", ".claude/agents", "artifacts/4.1.0/claude/agents", "."]) {
    const folder = path.join(base, candidate);
    if (AGENT_NAMES.every((name) => existsSync(path.join(folder, `${name}.md`)))) {
      return Object.fromEntries(AGENT_NAMES.map((name) => [name, path.join(folder, `${name}.md`)]));
    }
  }
  return undefined;
}

/** @param {string} value */
function readState(value) { return /** @type {State} */ (JSON.parse(readFileSync(value, "utf8"))); }

/**
 * @param {{root: string, home?: string, agentsFrom?: string}} options
 */
export function applyClaudeLight({ root: requested, home = homedir(), agentsFrom }) {
  if (!path.isAbsolute(requested)) throw new Error("claude-light apply needs an absolute <repo> path");
  const root = realpathSync(requested);
  if (path.resolve(git(root, ["rev-parse", "--show-toplevel"]).stdout.trim() || "/nonexistent") !== root) throw new Error(`claude-light: ${requested} is not the root of a Git checkout; nothing was written`);
  const profile = selectProfile(root);
  const claudeDirectory = path.join(root, ".claude");
  const target = path.join(root, SETTINGS_RELATIVE);
  const claudeStat = lstatOrUndefined(claudeDirectory);
  if (claudeStat && (claudeStat.isSymbolicLink() || !claudeStat.isDirectory())) throw new Error("claude-light: .claude is a link or not a directory; nothing was written");
  const targetStat = lstatOrUndefined(target);
  if (targetStat && (targetStat.isSymbolicLink() || !targetStat.isFile())) throw new Error(`claude-light: ${SETTINGS_RELATIVE} is a link or not a regular file; nothing was written`);
  const sources = agentsFrom === undefined ? undefined : findAgentSources(agentsFrom);
  if (agentsFrom !== undefined && !sources) throw new Error(`claude-light: ${agentsFrom} does not hold ${AGENT_NAMES.map((name) => `${name}.md`).join(" and ")}; nothing was written`);
  if (sources) assertPlainParents(root, path.join(".claude/agents", `${AGENT_NAMES[0]}.md`));
  excludePath(root);

  const location = stateLocation(home, root, profile.profile);
  const previousBytes = targetStat ? readFileSync(target) : undefined;
  /** @type {Record<string, any>} */
  let old = {};
  if (previousBytes) {
    try { old = JSON.parse(previousBytes.toString("utf8")); } catch { throw new Error(`claude-light: ${SETTINGS_RELATIVE} is not valid JSON; nothing was written`); }
    if (!isObject(old)) throw new Error(`claude-light: ${SETTINGS_RELATIVE} is not a JSON object; nothing was written`);
  }
  const existingState = existsSync(location.state) ? readState(location.state) : undefined;
  if (existingState && (previousBytes ? sha256(previousBytes) : "") !== existingState.lastSha256) {
    throw new Error(`claude-light: ${SETTINGS_RELATIVE} changed since the last apply; run undo or reconcile by hand. Nothing was written`);
  }
  const off = computeOff(root, home, profile);
  const merged = mergeSettings(old, off);
  const bytes = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
  const sameAsCurrent = previousBytes !== undefined && previousBytes.equals(bytes);

  /** @type {State} */
  const state = existingState ?? {
    version: 1, profile: profile.profile, root, existed: previousBytes !== undefined,
    mode: targetStat ? targetStat.mode & 0o777 : null, originalSha256: previousBytes ? sha256(previousBytes) : null,
    lastSha256: "", claudeDirCreated: claudeStat === undefined, excludeLines: [], agents: [], off, at: new Date().toISOString(),
  };
  state.lastSha256 = sha256(bytes);
  state.off = off;
  state.at = new Date().toISOString();

  // Agents first (cheap to roll back), then backup, then the settings write.
  /** @type {string[]} */
  const agentNotes = [];
  /** @type {AgentRecord[]} */
  const placed = [];
  if (sources) {
    for (const name of AGENT_NAMES) {
      const destination = path.join(claudeDirectory, "agents", `${name}.md`);
      const relative = path.relative(root, destination);
      const source = readFileSync(sources[name]);
      const stat = lstatOrUndefined(destination);
      if (stat && (stat.isSymbolicLink() || !stat.isFile())) { agentNotes.push(`${relative}: link or not a file, kept`); continue; }
      if (stat) {
        const same = sha256(readFileSync(destination)) === sha256(source);
        agentNotes.push(`${relative}: ${same ? "already there with the same bytes, not claimed" : "someone else's file, kept"}`);
        continue;
      }
      placed.push({ path: relative, sha256: sha256(source) });
    }
  }

  ensurePrivateDirectory(path.dirname(location.directory));
  ensurePrivateDirectory(location.directory);
  if (!existingState && previousBytes) writeAtomic(location.backup, previousBytes, 0o600);
  // Ignore rules are read before anything is added, so a line is added only for a path git does not ignore yet.
  /** @type {string[]} */
  const excludeToAdd = [];
  if (!isIgnored(root, SETTINGS_RELATIVE)) excludeToAdd.push(`/${SETTINGS_RELATIVE}`);
  for (const record of placed) if (!isIgnored(root, record.path)) excludeToAdd.push(`/${record.path}`);
  state.agents.push(...placed);
  writeAtomic(location.state, `${JSON.stringify({ ...state, excludeLines: [...state.excludeLines, ...excludeToAdd.filter((line) => !state.excludeLines.includes(line))] }, null, 2)}\n`, 0o600);
  const finalState = { ...state, excludeLines: [...state.excludeLines, ...excludeToAdd.filter((line) => !state.excludeLines.includes(line))] };
  /** @type {string[]} */
  const written = [];
  try {
    for (const line of finalState.excludeLines) addExcludeLine(root, line);
    if (!claudeStat) mkdirSync(claudeDirectory, { mode: 0o755 });
    if (!sameAsCurrent) writeAtomic(target, bytes, state.mode ?? 0o600);
    for (const record of placed) {
      const destination = path.join(root, record.path);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeAtomic(destination, readFileSync(/** @type {Record<string, string>} */ (sources)[path.basename(record.path, ".md")]), 0o644);
      written.push(destination);
    }
  } catch (error) {
    for (const file of written) rmSync(file, { force: true });
    if (!existingState) {
      if (previousBytes) writeAtomic(target, previousBytes, state.mode ?? 0o600); else rmSync(target, { force: true });
      rmSync(location.state, { force: true }); rmSync(location.backup, { force: true });
    }
    throw error;
  }
  return {
    ok: true, operation: "claude-light apply", profile: profile.profile, root, target: SETTINGS_RELATIVE,
    changed: !sameAsCurrent, created: !previousBytes,
    off: { skills: off.skills.length, plugins: off.plugins.length, mcp: off.mcp.length },
    backup: state.existed ? location.backup : null, state: location.state,
    excludeAdded: excludeToAdd, agents: placed.map((record) => record.path), notes: [...agentNotes, ...carencias(old, profile)],
  };
}

/** @param {{root: string, home?: string}} options */
export function undoClaudeLight({ root: requested, home = homedir() }) {
  if (!path.isAbsolute(requested)) throw new Error("claude-light undo needs an absolute <repo> path");
  const root = realpathSync(requested);
  if (path.resolve(git(root, ["rev-parse", "--show-toplevel"]).stdout.trim() || "/nonexistent") !== root) throw new Error(`claude-light: ${requested} is not the root of a Git checkout; nothing was written`);
  const profile = selectProfile(root);
  const location = stateLocation(home, root, profile.profile);
  if (!existsSync(location.state)) throw new Error(`claude-light: no apply is recorded for ${root}; nothing was written`);
  const state = readState(location.state);
  assertPlainParents(root, SETTINGS_RELATIVE);
  for (const record of state.agents) assertPlainParents(root, record.path);
  excludePath(root);
  const target = path.join(root, SETTINGS_RELATIVE);
  const stat = lstatOrUndefined(target);
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) throw new Error(`claude-light: ${SETTINGS_RELATIVE} is a link or not a regular file; nothing was written`);
  const currentSha = stat ? sha256(readFileSync(target)) : "";
  const untouchedOriginal = state.existed ? currentSha === state.originalSha256 : !stat;
  if (currentSha !== state.lastSha256 && !untouchedOriginal) {
    throw new Error(`claude-light: ${SETTINGS_RELATIVE} changed after apply; both states are kept for you to reconcile (previous bytes: ${location.backup}). Nothing was written`);
  }
  if (state.existed && !untouchedOriginal) {
    if (!existsSync(location.backup)) throw new Error(`claude-light: the backup ${location.backup} is missing; nothing was written`);
    const previous = readFileSync(location.backup);
    if (sha256(previous) !== state.originalSha256) throw new Error(`claude-light: the backup ${location.backup} no longer matches its fingerprint; nothing was written`);
    writeAtomic(target, previous, state.mode ?? 0o600);
  } else if (!state.existed && stat) {
    unlinkSync(target);
  }
  /** @type {string[]} */
  const removedAgents = [], keptAgents = [];
  for (const record of state.agents) {
    const file = path.join(root, record.path);
    const agentStat = lstatOrUndefined(file);
    if (!agentStat) continue;
    if (agentStat.isFile() && !agentStat.isSymbolicLink() && sha256(readFileSync(file)) === record.sha256) { unlinkSync(file); removedAgents.push(record.path); } else keptAgents.push(record.path);
  }
  for (const line of state.excludeLines) {
    const relative = line.slice(1);
    if (relative === SETTINGS_RELATIVE || removedAgents.includes(relative) || !existsSync(path.join(root, relative))) removeExcludeLine(root, line);
  }
  for (const directory of [path.join(root, ".claude/agents"), ...(state.claudeDirCreated ? [path.join(root, ".claude")] : [])]) {
    try { rmdirSync(directory); } catch { /* not empty or absent: leave it */ }
  }
  rmSync(location.directory, { recursive: true, force: true });
  return {
    ok: true, operation: "claude-light undo", profile: profile.profile, root,
    restored: state.existed && !untouchedOriginal ? "previous bytes" : state.existed ? "already the previous bytes" : "removed the file apply created",
    agentsRemoved: removedAgents, agentsKept: keptAgents,
  };
}

/** @param {string[]} args */
export function runClaudeLightCommand(args) {
  const json = args.includes("--json");
  const action = args[0];
  if (action !== "apply" && action !== "undo") throw new Error(`Usage: development-system ${USAGE}`);
  /** @type {string[]} */
  const positional = [];
  /** @type {string | undefined} */
  let home, agentsFrom;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") continue;
    if (arg === "--home" || (arg === "--agentes" && action === "apply")) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--home") home = path.resolve(value); else agentsFrom = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option for claude-light ${action}: ${arg}`);
    positional.push(arg);
  }
  if (positional.length !== 1) throw new Error(`Usage: development-system ${USAGE}`);
  if (action === "apply") {
    const result = applyClaudeLight({ root: positional[0], home, agentsFrom });
    const lines = [
      `claude-light apply: profile ${result.profile}; ${result.changed ? "wrote" : "already in place:"} ${result.target}${result.created ? " (new file)" : ""}`,
      `off: ${result.off.skills} skills, ${result.off.plugins} plugins, ${result.off.mcp} MCP; connectors off`,
      `backup: ${result.backup ?? "none (the file did not exist)"}; state: ${result.state}`,
      ...(result.excludeAdded.length > 0 ? [`.git/info/exclude += ${result.excludeAdded.join(", ")}`] : []),
      ...(result.agents.length > 0 ? [`agents placed: ${result.agents.join(", ")}`] : []),
      ...result.notes.map((note) => `note: ${note}`),
    ];
    return { result, output: json ? JSON.stringify(result) : lines.join("\n"), json };
  }
  const result = undoClaudeLight({ root: positional[0], home });
  const lines = [
    `claude-light undo: profile ${result.profile}; ${result.restored}`,
    ...(result.agentsRemoved.length > 0 ? [`agents removed: ${result.agentsRemoved.join(", ")}`] : []),
    ...(result.agentsKept.length > 0 ? [`agents kept (bytes differ): ${result.agentsKept.join(", ")}`] : []),
  ];
  return { result, output: json ? JSON.stringify(result) : lines.join("\n"), json };
}
