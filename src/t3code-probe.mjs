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
  wayfinder: [/\bdecisions?\b/i, /\bone ticket\b/i],
  "grill-with-docs": [/\bgrill(?:ing)?\b/i, /\bdomain[- ]model/i],
  "to-spec": [/\bsynthesi[sz]e\b/i, /\bwithout\b.*\binterview/i],
  "to-tickets": [/\btracer[- ]bullet\b/i, /\bblocking\b/i],
  "flow-implement": [/\bterminal slice\b/i, /\b(?:stop|boundar)/i],
  "flow-code-review": [/\bstandards\b/i, /\bspec\b/i, /\b(?:separate|independent)\b/i],
};

const forbiddenCommand =
  /(?:^|[;&|]\s*|\s)(?:rm|mv|cp|install|sync-skills|rollback(?:-skills)?|lifecycle-execute|curl|wget|gh|linear|osascript|open|git\s+(?:commit|push|checkout|switch|reset|clean))(?=\s|$)/i;

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
  const commandsAllowed = commands.every((/** @type {any} */ entry) => !forbiddenCommand.test(entry.command));
  return routerRead && lifecycleReads && skillAudit && commandsSucceeded && noMutationActions && commandsAllowed;
}

/** @param {any} report */
export function evaluateT3CodeProbe(report) {
  const observed = report?.observed ?? {};
  const skillAuditHealthy =
    observed.skillAuditHealthy === true ||
    observed.skillAuditHealthy?.healthy === true;
  return (
    observed.routerLoaded === true &&
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
    report?.stateInvariants?.repository?.gitHeadUnchanged === true &&
    report?.stateInvariants?.repository?.gitStatusUnchanged === true &&
    report?.stateInvariants?.repository?.fingerprintUnchanged === true &&
    report?.stateInvariants?.managedHome?.unchanged === true
  );
}
