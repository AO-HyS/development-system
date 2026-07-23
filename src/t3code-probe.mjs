// @ts-check

export const requiredT3CodeLifecycleSkills = [
  "wayfinder",
  "grill-with-docs",
  "to-spec",
  "to-tickets",
  "flow-implement",
  "flow-code-review",
];

/** @type {Record<string, RegExp[]>} */
const influencePatterns = {
  wayfinder: [/\bdecisions?\b/i, /\b(?:one ticket|multiple\b.*\btickets)\b/i],
  "grill-with-docs": [/\bgrill(?:ing)?\b/i, /\bdomain[- ]model/i],
  "to-spec": [/\bsynthesi[sz]e\b/i, /\bwithout\b.*\binterview/i],
  "to-tickets": [/\btracer[- ]bullet\b/i, /\bblocking\b/i],
  "flow-implement": [/\bterminal slice\b/i, /\b(?:stop|boundar)/i],
  "flow-code-review": [/\bstandards\b/i, /\bspec\b/i, /\b(?:blind|separate|independent)\b/i],
};

const forbiddenCommand =
  /(?:^|[;&|]\s*|\s)(?:rm|mv|cp|install|sync-skills|rollback(?:-skills)?|lifecycle-execute|curl|wget|gh|linear|osascript|open|node|python\d*|perl|ruby|git\s+(?:commit|push|checkout|switch|reset|clean))(?=\s|$)/i;

const readOnlyCommandStart =
  /^(?:set\s+-[a-z]+\s*$|(?:\/usr\/bin\/)?(?:cat|find|head|jq|ls|nl|pwd|rg|sed|sha256sum|shasum|stat|tail|test|wc)\b|git\s+(?:diff|rev-parse|status)\b|\.\/bin\/development-system\s+(?:audit|audit-skills)\b)/i;

/** @param {string} command */
export function isReadOnlyProbeCommand(command) {
  if (
    !command ||
    forbiddenCommand.test(command) ||
    /(?:^|[^<])>>?|`|\$\(|\bfind\b[^\n]*(?:-delete|-exec)\b/i.test(command)
  ) return false;
  const unwrapped = command
    .replace(/^\/bin\/zsh\s+-lc\s+/, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
  const segments = splitShellSegments(unwrapped)
    .map((segment) => segment.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return segments.length > 0 && segments.every((segment) => readOnlyCommandStart.test(segment));
}

/** @param {string} command */
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
      current = "";
      if (pair === "&&" || pair === "||") index += 1;
      continue;
    }
    current += character;
  }
  if (current.trim()) segments.push(current);
  return segments;
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

/** @param {import("node:child_process").ChildProcess} child @param {number} [graceMs] */
export async function stopDetachedProcess(child, graceMs = 3_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  /** @param {NodeJS.Signals} signal */
  const signalGroup = (signal) => {
    try {
      if (!child.pid) throw new Error("Child process has no process id");
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  /** @param {number} timeoutMs */
  const waitForExit = (timeoutMs) =>
    Promise.race([
      new Promise((resolvePromise) => child.once("exit", () => resolvePromise(true))),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
    ]);

  signalGroup("SIGTERM");
  if (await waitForExit(graceMs)) return;
  signalGroup("SIGKILL");
  if (!await waitForExit(graceMs)) {
    throw new Error("Detached T3Code process group did not exit after SIGKILL");
  }
}

/** @param {any} report */
function hasIndependentLoadEvidence(report) {
  const commands = report?.toolEvidence?.completedCommands ?? [];
  const commandText = commands.map((/** @type {any} */ entry) => entry.command).join("\n");
  const routerRead = commandText.includes("/drive-development-flow/SKILL.md");
  const lifecycleReads = requiredT3CodeLifecycleSkills.every((skill) =>
    commandText.includes(`/${skill}/SKILL.md`)
  );
  const skillAudit = commands.some((/** @type {any} */ entry) =>
    entry.exitCode === 0 &&
    entry.command.includes("audit-skills") &&
    entry.command.includes("--evidence")
  );
  const commandsSucceeded = commands.length > 0 &&
    commands.every((/** @type {any} */ entry) => entry.exitCode === 0);
  const noMutationActions = commands.every((/** @type {any} */ entry) =>
    (entry.commandActions ?? []).every((/** @type {any} */ action) =>
      !["create", "delete", "edit", "move", "write"].includes(String(action.type).toLowerCase())
    )
  );
  const commandsAllowed = commands.every((/** @type {any} */ entry) =>
    isReadOnlyProbeCommand(entry.command)
  );
  return routerRead && lifecycleReads && skillAudit && commandsSucceeded && noMutationActions && commandsAllowed;
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
    (
      Array.isArray(observed.routerLoaded) &&
      observed.routerLoaded.includes("drive-development-flow") &&
      observed.routerLoaded.includes("coding-orchestration")
    );
  return (
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
    (report?.approvalEvidence ?? []).every((/** @type {any} */ approval) =>
      ["command", "file-read"].includes(approval.requestKind) &&
      approval.decision === "accept"
    ) &&
    report?.stateInvariants?.repository?.gitHeadUnchanged === true &&
    report?.stateInvariants?.repository?.gitStatusUnchanged === true &&
    report?.stateInvariants?.repository?.fingerprintUnchanged === true &&
    report?.stateInvariants?.managedHome?.unchanged === true
  );
}
