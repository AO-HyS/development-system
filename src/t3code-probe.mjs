// @ts-check

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

export { stopDetachedProcess } from "./bounded-process.mjs";
import { stopDetachedProcess } from "./bounded-process.mjs";
import { resolveSkillProbeMetadata } from "./skill-probe-metadata.mjs";

export const requiredT3CodeLifecycleSkills = [
  "wayfinder",
  "grill-with-docs",
  "to-spec",
  "to-tickets",
  "flow-implement",
  "flow-code-review",
];

/**
 * Resolve the T3 live probe against the exact contract and catalog installed
 * in HOME. A checkout default or historical evidence fixture must never choose
 * the runtime contract implicitly.
 *
 * @param {{installedManifest: unknown, installedLock: unknown, installedCatalog: unknown}} input
 */
export function resolveT3CodeProbeMetadata(input) {
  const manifest = input.installedManifest && typeof input.installedManifest === "object" && !Array.isArray(input.installedManifest)
    ? input.installedManifest
    : {};
  const contractVersion = "contractVersion" in manifest ? manifest.contractVersion : undefined;
  const coreSource = "source" in manifest && manifest.source && typeof manifest.source === "object" && !Array.isArray(manifest.source)
    ? manifest.source
    : {};
  const coreCommit = "commit" in coreSource ? coreSource.commit : undefined;
  if (typeof contractVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(contractVersion)) {
    throw new Error("Installed Development System manifest has no valid contract version");
  }
  if (typeof coreCommit !== "string" || !/^[a-f0-9]{40}$/.test(coreCommit)) {
    throw new Error("Installed Development System manifest has no exact source commit");
  }
  const manifestArtifacts = "artifacts" in manifest && Array.isArray(manifest.artifacts)
    ? manifest.artifacts
    : [];
  const catalogArtifacts = manifestArtifacts.filter((artifact) =>
    artifact &&
    typeof artifact === "object" &&
    !Array.isArray(artifact) &&
    artifact.logicalName === "skill-catalog"
  );
  if (catalogArtifacts.length !== 1) {
    throw new Error("Installed Development System manifest must bind exactly one skill catalog");
  }
  const catalogSourcePath = catalogArtifacts[0].sourcePath;
  const catalogVersionMatch = typeof catalogSourcePath === "string"
    ? /^catalog\/(\d+\.\d+\.\d+)\.json$/.exec(catalogSourcePath)
    : null;
  if (!catalogVersionMatch) {
    throw new Error("Installed Development System manifest has no exact skill catalog version");
  }
  const skills = resolveSkillProbeMetadata({
    installedLock: input.installedLock,
    codexCatalog: input.installedCatalog,
  });
  if (skills.sourceCommit !== coreCommit) {
    throw new Error("Installed contract and skill catalog source commits do not match");
  }
  if (skills.catalogVersion !== catalogVersionMatch[1]) {
    throw new Error("Installed manifest and skill catalog versions do not match");
  }
  return { contractVersion, catalogVersion: skills.catalogVersion, sourceCommit: coreCommit };
}

/**
 * Select an installed T3 Code server entrypoint. New desktop builds keep the
 * server inside app.asar and must run it through Electron's Node mode; older
 * builds expose the same entrypoint under app.asar.unpacked.
 *
 * @param {{explicitCli?: string, explicitExecutable?: string, nodeExecutable: string, candidates: Array<{entrypoint: string, availabilityPath?: string, executable?: string, electronRunAsNode?: boolean}>, exists: (path: string) => boolean}} input
 */
export function resolveT3CodeServerRuntime(input) {
  if (input.explicitCli) {
    return {
      executable: input.explicitExecutable ?? input.nodeExecutable,
      argsPrefix: [input.explicitCli],
      environment: input.explicitExecutable ? { ELECTRON_RUN_AS_NODE: "1" } : {},
    };
  }
  for (const candidate of input.candidates) {
    if (!input.exists(candidate.availabilityPath ?? candidate.entrypoint)) continue;
    if (candidate.executable && !input.exists(candidate.executable)) continue;
    return {
      executable: candidate.executable ?? input.nodeExecutable,
      argsPrefix: [candidate.entrypoint],
      environment: candidate.electronRunAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {},
    };
  }
  throw new Error("T3 Code server entrypoint is not installed in a supported stable or nightly application path");
}

/** @type {Record<string, RegExp[]>} */
const influencePatterns = {
  wayfinder: [/\bdecisions?\b/i, /\b(?:one\b.*\bticket|multiple\b.*\btickets)\b/i],
  "grill-with-docs": [/\bgrill(?:ing)?\b/i, /\bdomain[- ]model/i],
  "to-spec": [/\bsynthesi[sz]e\b/i, /\bwithout\b.*\binterview/i],
  "to-tickets": [/\b(?:tracer[- ]bullet|vertical slices?)\b/i, /\bblock(?:er|ing)s?\b/i],
  "flow-implement": [/\b(?:terminal slice|binary done condition)\b/i, /\b(?:stop|boundar)/i],
  "flow-code-review": [/\bstandards\b/i, /\bspec\b/i, /\b(?:blind|separate|independent(?:ly)?)\b/i],
};

/** @param {string} command */
export function isReadOnlyProbeCommand(command) {
  return classifyReadOnlyProbeCommand(command) !== null;
}

/**
 * @param {string} detail
 * @param {string[]} allowedPaths
 * @returns {string | null}
 */
export function resolveAllowedProbeFileRead(detail, allowedPaths) {
  let candidate = detail.trim();
  try {
    const parsed = JSON.parse(candidate);
    candidate = typeof parsed?.path === "string" ? parsed.path : "";
  } catch {
    if (
      (candidate.startsWith('"') && candidate.endsWith('"')) ||
      (candidate.startsWith("'") && candidate.endsWith("'"))
    ) candidate = candidate.slice(1, -1);
  }
  if (!candidate || !isAbsolute(candidate)) return null;
  try {
    const resolvedCandidate = realpathSync(candidate);
    const allowed = new Set(allowedPaths.map((path) => realpathSync(path)));
    return allowed.has(resolvedCandidate) ? resolvedCandidate : null;
  } catch {
    return null;
  }
}

/** @param {string} command @returns {Array<{type: "read" | "search" | "list", command: string}> | null} */
export function classifyReadOnlyProbeCommand(command) {
  if (!command || /[\r\n]|\0|`|\$\(|<\(|>\(|(?:^|[^&])&(?!&)|>>?|\\\n/.test(command)) return null;
  let unwrapped = command.trim();
  if (unwrapped.startsWith("/bin/zsh -lc ")) {
    unwrapped = unwrapped.slice("/bin/zsh -lc ".length).trim();
    const quote = unwrapped[0];
    if (["'", '"'].includes(quote)) {
      if (unwrapped.at(-1) !== quote) return null;
      unwrapped = unwrapped.slice(1, -1);
      if (quote === '"') unwrapped = unwrapped.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else if (/\s/.test(unwrapped)) {
      return null;
    }
  }
  const segments = splitShellSegments(unwrapped);
  if (!segments || segments.length === 0) return null;
  const actions = [];
  for (const segment of segments) {
    const tokens = tokenizeShellWords(segment);
    if (!tokens || tokens.length === 0) return null;
    const classification = classifyReadOnlyArgv(tokens);
    if (!classification) return null;
    actions.push({ type: classification, command: segment.trim() });
  }
  return actions;
}

/** @param {string} command @returns {string[] | null} */
function splitShellSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    const pair = command.slice(index, index + 2);
    if (character === ";" || character === "|" || pair === "&&" || pair === "||") {
      if (current.trim()) segments.push(current);
      else return null;
      current = "";
      if (pair === "&&" || pair === "||") index += 1;
      continue;
    }
    current += character;
  }
  if (quote || escaped) return null;
  if (current.trim()) segments.push(current);
  else if (segments.length > 0) return null;
  return segments;
}

/** @param {string} value @returns {string[] | null} */
function tokenizeShellWords(value) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let started = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      started = true;
    } else if (character === "\\") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (quote || escaped) return null;
  if (started) tokens.push(current);
  return tokens;
}

/** @param {string[]} argv @returns {"read" | "search" | "list" | null} */
function classifyReadOnlyArgv(argv) {
  const executable = argv[0].replace(/^\/usr\/bin\//, "");
  const args = argv.slice(1);
  if (executable === "pwd" && args.length === 0) return "list";
  if (executable === "sed") {
    if (
      args.length < 3 ||
      args[0] !== "-n" ||
      !/^\d+(?:,\d+)?p$/.test(args[1]) ||
      args.slice(2).some((arg) => arg.startsWith("-"))
    ) return null;
    return "read";
  }
  if (["cat", "head", "nl", "sha256sum", "shasum", "stat", "tail", "test", "wc"].includes(executable)) {
    if (args.some((arg) => arg === "--output" || arg.startsWith("--output="))) return null;
    return "read";
  }
  if (executable === "ls") return "list";
  if (executable === "rg") {
    if (args.some((arg) => arg === "--pre" || arg.startsWith("--pre="))) return null;
    return "search";
  }
  if (executable === "find") {
    if (args.some((arg) =>
      ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]
        .some((flag) => arg === flag || arg.startsWith(`${flag}=`))
    )) return null;
    return "search";
  }
  if (executable === "git") {
    if (!["diff", "rev-parse", "status"].includes(args[0])) return null;
    if (args.some((arg) =>
      arg === "--output" ||
      arg.startsWith("--output=") ||
      arg === "--ext-diff" ||
      arg === "--textconv"
    )) return null;
    return "read";
  }
  if (executable === "./bin/development-system") {
    if (!["audit", "audit-skills"].includes(args[0])) return null;
    if (args.some((arg) => arg === "--output" || arg.startsWith("--output="))) return null;
    return "read";
  }
  return null;
}

/** @param {string} url @param {RequestInit} [options] @param {number} [timeoutMs] */
export async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 5_000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  return { response, body };
}

/** @param {unknown} error */
function classifyPollingFailure(error) {
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && /json/i.test(error.message))
  ) return "invalid-json";
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError" || /abort|timeout/i.test(error.message))
  ) return "http-timeout";
  return "http-error";
}

/**
 * Poll a T3 Code thread without discarding the last usable snapshot when an
 * HTTP request times out or returns invalid JSON. Failure evidence is bounded
 * and categorical so reports do not retain response bodies or secrets.
 *
 * @param {{
 *   timeoutMs: number,
 *   fetchSnapshot: () => Promise<any>,
 *   inspectSnapshot: (snapshot: any) => Promise<boolean> | boolean,
 *   intervalMs?: number,
 *   now?: () => number,
 *   sleep?: (milliseconds: number) => Promise<void>,
 * }} input
 */
export async function pollT3CodeThread(input) {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("T3Code thread polling timeout must be positive");
  }
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
  );
  const intervalMs = input.intervalMs ?? 1_000;
  const deadline = now() + input.timeoutMs;
  let snapshot = null;
  let completed = false;
  let failureCount = 0;
  /** @type {string[]} */
  const recentFailureKinds = [];

  while (now() < deadline) {
    try {
      const candidate = await input.fetchSnapshot();
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new SyntaxError("T3Code thread response is not a JSON object");
      }
      snapshot = candidate;
      if (await input.inspectSnapshot(candidate)) {
        completed = true;
        break;
      }
    } catch (error) {
      failureCount += 1;
      recentFailureKinds.push(classifyPollingFailure(error));
      if (recentFailureKinds.length > 3) recentFailureKinds.shift();
    }
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(intervalMs, remainingMs));
  }

  return {
    snapshot,
    completed,
    pollingFailures: {
      count: failureCount,
      recentKinds: recentFailureKinds,
    },
  };
}

/** @param {any} report */
function hasIndependentLoadEvidence(report) {
  const commands = report?.toolEvidence?.completedCommands ?? [];
  const commandText = commands.map((/** @type {any} */ entry) => entry.command).join("\n");
  const hostAudit = report?.hostEvidence?.skillAudit;
  const allowedFiles = Array.isArray(report?.allowedFileReads) ? report.allowedFileReads : [];
  const evidenceArgumentIndex = Array.isArray(hostAudit?.command)
    ? hostAudit.command.indexOf("--evidence")
    : -1;
  const boundEvidence = allowedFiles.find((/** @type {any} */ file) =>
    file.path === hostAudit?.evidencePath
  );
  const validHostAudit =
    hostAudit?.exitCode === 0 &&
    hostAudit?.healthy === true &&
    hostAudit?.result?.ok === true &&
    typeof hostAudit?.outputSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(hostAudit.outputSha256) &&
    createHash("sha256")
      .update(`${JSON.stringify(hostAudit.result)}\n`)
      .digest("hex") === hostAudit.outputSha256 &&
    typeof hostAudit?.evidenceSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(hostAudit.evidenceSha256) &&
    evidenceArgumentIndex >= 0 &&
    hostAudit.command[evidenceArgumentIndex + 1] === hostAudit.evidencePath &&
    boundEvidence?.sha256 === hostAudit.evidenceSha256 &&
    Array.isArray(hostAudit?.command) &&
    hostAudit.command[0] === "./bin/development-system" &&
    hostAudit.command[1] === "audit-skills" &&
    hostAudit.command.includes("--evidence");
  /** @param {string} text */
  const requiredReads = (text) =>
    text.includes("/drive-development-flow/SKILL.md") &&
    text.includes("/coding-orchestration/SKILL.md") &&
    requiredT3CodeLifecycleSkills.every((skill) => text.includes(`/${skill}/SKILL.md`)) &&
    text.includes(hostAudit?.outputPath ?? "\u0000");
  const commandsSucceeded = commands.length > 0 &&
    commands.every((/** @type {any} */ entry) => entry.exitCode === 0);
  const observedActions = commands.every((/** @type {any} */ entry) =>
    Array.isArray(entry.commandActions) &&
    entry.commandActions.length > 0 &&
    entry.commandActions.every((/** @type {any} */ action) =>
      ["read", "search", "list"].includes(String(action.type).toLowerCase())
    )
  );
  const classifiedActions = commands.every((/** @type {any} */ entry) =>
    Array.isArray(entry.policyActions) &&
    entry.policyActions.length > 0 &&
    entry.policyActions.every((/** @type {any} */ action) =>
      ["read", "search", "list"].includes(String(action.type).toLowerCase())
    )
  );
  const commandsAllowed = commands.every((/** @type {any} */ entry) => {
    const classification = classifyReadOnlyProbeCommand(entry.command);
    return classification !== null &&
      JSON.stringify(classification) === JSON.stringify(entry.policyActions);
  });
  const completedEvidence = requiredReads(commandText) && validHostAudit &&
    commandsSucceeded && observedActions && classifiedActions && commandsAllowed;
  if (completedEvidence) return true;

  if (report?.application?.environmentCapabilities?.agentActivityPublishing !== false) return false;
  const acceptedCommands = (report?.approvalEvidence ?? []).filter((/** @type {any} */ approval) =>
    approval.requestKind === "command" && approval.decision === "accept"
  );
  const approvedTargets = new Set();
  for (const approval of acceptedCommands) {
    const actions = classifyReadOnlyProbeCommand(approval.detail);
    if (!actions) return false;
    for (const action of actions) {
      const tokens = tokenizeShellWords(action.command);
      if (!tokens || tokens[0].replace(/^\/usr\/bin\//, "") !== "cat") continue;
      const targets = tokens.slice(1);
      if (targets.length === 0 || targets.some((target) => target.startsWith("-"))) continue;
      for (const target of targets) {
        if (isAbsolute(target)) approvedTargets.add(target);
      }
    }
  }
  const requiredSuffixes = [
    "/drive-development-flow/SKILL.md",
    "/coding-orchestration/SKILL.md",
    ...requiredT3CodeLifecycleSkills.map((skill) => `/${skill}/SKILL.md`),
  ];
  const allowedTargets = new Set(allowedFiles
    .filter((/** @type {any} */ file) =>
      typeof file?.path === "string" && /^[a-f0-9]{64}$/.test(String(file?.sha256 ?? ""))
    )
    .map((/** @type {any} */ file) => file.path));
  const requiredTargetPaths = requiredSuffixes.map((suffix) =>
    [...allowedTargets].find((path) => path.endsWith(suffix))
  );
  return commands.length === 0 && acceptedCommands.length > 0 && validHostAudit &&
    requiredTargetPaths.every((path) => typeof path === "string" && approvedTargets.has(path)) &&
    approvedTargets.has(hostAudit.outputPath) &&
    [...approvedTargets].every((path) => allowedTargets.has(path)) &&
    acceptedCommands.every((/** @type {any} */ approval) => isReadOnlyProbeCommand(approval.detail));
}

/** @param {any} report */
export function evaluateT3CodeProbe(report) {
  const observed = report?.observed ?? {};
  const skillAuditHealthy =
    observed.skillAuditHealthy === true ||
    observed.skillAuditHealthy?.healthy === true ||
    observed.skillAuditHealthy?.status === true;
  const routerLoaded =
    observed.routerLoaded === true ||
    observed.routerLoaded === "drive-development-flow" ||
    (
      observed.routerLoaded?.name === "drive-development-flow" &&
      observed.routerLoaded?.loaded === true
    ) ||
    (
      Array.isArray(observed.routerLoaded) &&
      observed.routerLoaded.includes("drive-development-flow") &&
      observed.routerLoaded.includes("coding-orchestration")
    );
  const healthyManagedHome = (/** @type {any} */ snapshot) =>
    snapshot?.installation?.ok === true &&
    snapshot?.installation?.status === "healthy" &&
    snapshot?.installation?.contractVersion === report?.contractVersion &&
    snapshot?.installation?.source?.commit === report?.sourceCommit &&
    snapshot?.skills?.ok === true &&
    snapshot?.skills?.status === "healthy" &&
    snapshot?.skills?.catalogVersion === report?.catalogVersion &&
    snapshot?.skills?.sourceCommit === report?.sourceCommit;
  return (
    report?.failure === null &&
    healthyManagedHome(report?.stateInvariants?.managedHome?.before) &&
    healthyManagedHome(report?.stateInvariants?.managedHome?.after) &&
    routerLoaded &&
    skillAuditHealthy &&
    Array.isArray(observed.lifecycleSkills) &&
    requiredT3CodeLifecycleSkills.every((skill) => observed.lifecycleSkills.includes(skill)) &&
    observed.influenceSignatures &&
    requiredT3CodeLifecycleSkills.every((skill) =>
      typeof observed.influenceSignatures[skill] === "string" &&
      influencePatterns[skill].every((/** @type {RegExp} */ pattern) =>
        pattern.test(observed.influenceSignatures[skill])
      )
    ) &&
    hasIndependentLoadEvidence(report) &&
    observed.model === report?.requestedModel?.model &&
    report?.observedThreadModel?.model === report?.requestedModel?.model &&
    report?.requestedRuntimeMode === "approval-required" &&
    Array.isArray(report?.approvalEvidence) &&
    report.approvalEvidence.every((/** @type {any} */ approval) =>
      ["command", "file-read"].includes(approval.requestKind) &&
      ["accept", "decline"].includes(approval.decision) &&
      (
        approval.decision === "decline" ||
        (
          approval.requestKind === "file-read" &&
          typeof approval.resolvedPath === "string" &&
          report?.allowedFileReads?.some((/** @type {any} */ file) =>
            file.path === approval.resolvedPath &&
            /^[a-f0-9]{64}$/.test(file.sha256)
          )
        ) ||
        isReadOnlyProbeCommand(approval.detail)
      )
    ) &&
    report?.stateInvariants?.repository?.gitHeadUnchanged === true &&
    report?.stateInvariants?.repository?.gitStatusUnchanged === true &&
    report?.stateInvariants?.repository?.fingerprintUnchanged === true &&
    report?.stateInvariants?.managedHome?.unchanged === true
  );
}
