// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const developmentStewardLaunchAgentLabel = "com.aohys.development-steward";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = resolve(repositoryRoot, "artifacts/1.41.0/skills/internal/development-steward");

/** @param {unknown} error */
function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} value */
function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** @param {Buffer | string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} home @param {string} candidate */
function insideHome(home, candidate) {
  if (isAbsolute(candidate)) throw new Error(`Managed scheduler path must be relative to HOME: ${candidate}`);
  const root = resolve(home);
  const path = resolve(root, candidate);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Managed scheduler path escapes HOME: ${candidate}`);
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
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Managed scheduler parent is a symbolic link: ${current}`);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
  }
}

/** @param {string} path @param {Buffer | string} contents @param {number} [mode] */
async function writeAtomic(path, contents, mode = 0o600) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
  await chmod(path, mode);
}

/** @param {string} path */
async function readOptional(path) {
  try { return await readFile(path); }
  catch (error) { if (missing(error)) return null; throw error; }
}

/** @param {string} path */
async function removeIfPresent(path) {
  try { await unlink(path); }
  catch (error) { if (!missing(error)) throw error; }
}

/** @param {string} path */
async function executablePath(path) {
  if (!isAbsolute(path)) throw new Error(`Scheduler executable must be an absolute path: ${path}`);
  const resolved = await realpath(path);
  await access(resolved, constants.X_OK);
  return resolved;
}

/** @param {string} path @param {string} label */
async function existingDirectory(path, label) {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  const resolved = await realpath(path);
  if (!(await stat(resolved)).isDirectory()) throw new Error(`${label} must be a directory: ${path}`);
  return resolved;
}

/** @param {{home: string}} options */
export function getDevelopmentStewardSchedulerPaths({ home }) {
  const resolvedHome = resolve(home);
  return Object.freeze({
    home: resolvedHome,
    privateDirectory: insideHome(resolvedHome, ".development-system/steward"),
    runner: insideHome(resolvedHome, ".development-system/steward/runner.mjs"),
    prompt: insideHome(resolvedHome, ".development-system/steward/prompt.md"),
    stewardContract: insideHome(resolvedHome, ".development-system/steward/development-steward.mjs"),
    checkInContract: insideHome(resolvedHome, ".development-system/steward/check-in.mjs"),
    retroModule: insideHome(resolvedHome, ".development-system/steward/steward-retro.mjs"),
    mistakesModule: insideHome(resolvedHome, ".development-system/steward/mistakes.mjs"),
    state: insideHome(resolvedHome, ".development-system/steward/scheduler-state.json"),
    reports: insideHome(resolvedHome, ".development-system/steward/reports"),
    report: insideHome(resolvedHome, ".development-system/steward/reports/latest.json"),
    stdout: insideHome(resolvedHome, ".development-system/steward/runner.stdout.log"),
    stderr: insideHome(resolvedHome, ".development-system/steward/runner.stderr.log"),
    launchAgent: insideHome(resolvedHome, `Library/LaunchAgents/${developmentStewardLaunchAgentLabel}.plist`),
  });
}

/**
 * @param {{nodePath: string, codexPath: string, runnerPath: string, promptPath: string, stewardContractPath: string, checkInContractPath: string, reportPath: string, workingDirectory: string, stdoutPath: string, stderrPath: string}} options
 */
export function buildDevelopmentStewardLaunchAgent(options) {
  const argumentsList = [
    options.nodePath,
    options.runnerPath,
    "--node", options.nodePath,
    "--codex", options.codexPath,
    "--prompt", options.promptPath,
    "--steward-contract", options.stewardContractPath,
    "--check-in-contract", options.checkInContractPath,
    "--report", options.reportPath,
    "--working-directory", options.workingDirectory,
  ];
  for (const path of [options.nodePath, options.codexPath, options.runnerPath, options.promptPath, options.stewardContractPath, options.checkInContractPath, options.reportPath, options.workingDirectory, options.stdoutPath, options.stderrPath]) {
    if (!isAbsolute(path)) throw new Error(`LaunchAgent paths must be absolute: ${path}`);
  }
  const programArguments = argumentsList.map((argument) => `      <string>${xml(argument)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${developmentStewardLaunchAgentLabel}</string>
    <key>ProgramArguments</key>
    <array>
${programArguments}
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Weekday</key><integer>2</integer>
      <key>Hour</key><integer>9</integer>
      <key>Minute</key><integer>0</integer>
    </dict>
    <key>RunAtLoad</key><false/>
    <key>ProcessType</key><string>Background</string>
    <key>WorkingDirectory</key><string>${xml(options.workingDirectory)}</string>
    <key>StandardOutPath</key><string>${xml(options.stdoutPath)}</string>
    <key>StandardErrorPath</key><string>${xml(options.stderrPath)}</string>
  </dict>
</plist>
`;
}

/** @param {string[]} args */
function defaultLaunchctl(args) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", shell: false });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** @param {{status: number, stdout?: string, stderr?: string}} result */
function notLoaded(result) {
  return result.status !== 0 && /could not find service|service not found|no such process/i.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

/** @param {string[]} args @param {(args: string[]) => Promise<{status: number, stdout?: string, stderr?: string}> | {status: number, stdout?: string, stderr?: string}} launchctl */
async function runLaunchctl(args, launchctl) {
  return await launchctl(args);
}

/** @param {string} path */
async function mode(path) {
  return (await stat(path)).mode & 0o777;
}

/**
 * Install and load the weekly macOS LaunchAgent. Existing unmanaged files fail closed.
 * @param {{home: string, projectsRoot: string, codexPath: string, nodePath?: string, uid?: number, launchctl?: typeof defaultLaunchctl}} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function installDevelopmentStewardScheduler(options) {
  throw new Error("Legacy launchd scheduler activation is retired: T3 owns weekly Development Steward scheduling. Use the T3 scheduler; audit and disable remain available. No scheduler files were written.");
}

/**
 * @param {{home: string, uid?: number, launchctl?: typeof defaultLaunchctl}} options
 */
export async function auditDevelopmentStewardScheduler(options) {
  const home = await existingDirectory(options.home, "HOME");
  const paths = getDevelopmentStewardSchedulerPaths({ home });
  /** @type {string[]} */
  const problems = [];
  const stateBytes = await readOptional(paths.state);
  if (stateBytes === null) {
    const orphaned = [];
    for (const [name, path] of Object.entries({
      runner: paths.runner,
      prompt: paths.prompt,
      stewardContract: paths.stewardContract,
      checkInContract: paths.checkInContract,
      mistakesModule: paths.mistakesModule,
      retroModule: paths.retroModule,
      launchAgent: paths.launchAgent,
      stdout: paths.stdout,
      stderr: paths.stderr,
    })) {
      if (await readOptional(path) !== null) orphaned.push(name);
    }
    if (orphaned.length > 0) {
      return { status: "drifted", valid: false, loaded: false, problems: [`scheduler state is missing for managed files: ${orphaned.join(", ")}`], paths };
    }
    return { status: "disabled", valid: true, loaded: false, problems, paths };
  }
  let state;
  try { state = JSON.parse(stateBytes.toString("utf8")); }
  catch { return { status: "drifted", valid: false, loaded: false, problems: ["scheduler state is not valid JSON"], paths }; }
  if (state.schemaVersion !== 1 || state.label !== developmentStewardLaunchAgentLabel) problems.push("scheduler state contract is invalid");
  /** @type {Record<string, string>} */
  const managedFiles = { runner: paths.runner, prompt: paths.prompt, stewardContract: paths.stewardContract, checkInContract: paths.checkInContract, mistakesModule: paths.mistakesModule, retroModule: paths.retroModule, launchAgent: paths.launchAgent };
  for (const key of ["runner", "prompt", "stewardContract", "checkInContract", "mistakesModule", "retroModule", "launchAgent"]) {
    const expected = state.files?.[key];
    if (key === "retroModule" && !expected && state.contractVersion !== "1.41.0") {
      if (await readOptional(managedFiles[key]) !== null) problems.push("unmanaged retroModule exists");
      continue;
    }
    const managedPath = managedFiles[key];
    if (!expected || typeof expected.path !== "string" || typeof expected.sha256 !== "string") {
      problems.push(`${key} is missing from scheduler state`);
      continue;
    }
    if (expected.path !== managedPath) {
      problems.push(`${key} path is not the managed HOME path`);
      continue;
    }
    const contents = await readOptional(expected.path);
    if (contents === null) problems.push(`${key} is missing`);
    else {
      if (sha256(contents) !== expected.sha256) problems.push(`${key} bytes drifted`);
      if (await mode(expected.path) !== 0o600) problems.push(`${key} permissions are not 0600`);
    }
  }
  if (await mode(paths.privateDirectory).catch(() => null) !== 0o700) problems.push("private scheduler directory permissions are not 0700");
  if (await mode(paths.reports).catch(() => null) !== 0o700) problems.push("private report directory permissions are not 0700");
  for (const [name, path] of [["stdout log", paths.stdout], ["stderr log", paths.stderr]]) {
    const currentMode = await mode(path).catch(() => null);
    if (currentMode !== 0o600) problems.push(`${name} permissions are not 0600`);
  }
  const reportMode = await mode(paths.report).catch(() => null);
  if (reportMode !== null && reportMode !== 0o600) problems.push("private report permissions are not 0600");

  let loaded = false;
  if (options.launchctl || process.platform === "darwin") {
    const uid = options.uid ?? process.getuid?.();
    if (!Number.isInteger(uid) || Number(uid) < 0) problems.push("a numeric macOS uid is required to audit launchd");
    else {
      const result = await runLaunchctl(["print", `gui/${uid}/${developmentStewardLaunchAgentLabel}`], options.launchctl ?? defaultLaunchctl);
      loaded = result.status === 0;
      if (!loaded && !notLoaded(result)) problems.push(`launchctl print failed: ${(result.stderr ?? result.stdout ?? "").trim()}`);
      else if (!loaded) problems.push("LaunchAgent is installed but not loaded");
    }
  } else problems.push("launchd runtime was not audited on this platform");
  return { status: problems.length === 0 ? "healthy" : "drifted", valid: problems.length === 0, loaded, problems, paths };
}

/**
 * Disable a managed scheduler while preserving private reports. Drifted or unmanaged files fail closed.
 * @param {{home: string, uid?: number, launchctl?: typeof defaultLaunchctl}} options
 */
export async function disableDevelopmentStewardScheduler(options) {
  const audit = await auditDevelopmentStewardScheduler(options);
  if (audit.status === "disabled") return { status: "disabled", alreadyDisabled: true, paths: audit.paths };
  const nonRuntimeProblems = audit.problems.filter((problem) => problem !== "LaunchAgent is installed but not loaded" && problem !== "launchd runtime was not audited on this platform");
  if (nonRuntimeProblems.length > 0) throw new Error(`Refusing to disable a drifted scheduler: ${nonRuntimeProblems.join("; ")}`);
  const uid = options.uid ?? process.getuid?.();
  if (!Number.isInteger(uid) || Number(uid) < 0) throw new Error("A numeric macOS uid is required");
  const launchctl = options.launchctl ?? defaultLaunchctl;
  const unloaded = await runLaunchctl(["bootout", `gui/${uid}/${developmentStewardLaunchAgentLabel}`], launchctl);
  if (unloaded.status !== 0 && !notLoaded(unloaded)) throw new Error(`launchctl bootout failed: ${(unloaded.stderr ?? unloaded.stdout ?? "").trim()}`);
  for (const path of [audit.paths.launchAgent, audit.paths.runner, audit.paths.prompt, audit.paths.stewardContract, audit.paths.checkInContract, audit.paths.mistakesModule, audit.paths.retroModule, audit.paths.state, audit.paths.stdout, audit.paths.stderr]) {
    await removeIfPresent(path);
  }
  return { status: "disabled", alreadyDisabled: false, reportsPreservedAt: audit.paths.reports, paths: audit.paths };
}
