// @ts-check

export { stopDetachedProcess } from "./bounded-process.mjs";
import { stopDetachedProcess } from "./bounded-process.mjs";

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

/** @param {string} command */
export function isReadOnlyProbeCommand(command) {
  return classifyReadOnlyProbeCommand(command) !== null;
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
  if (["cat", "head", "jq", "nl", "sed", "sha256sum", "shasum", "stat", "tail", "test", "wc"].includes(executable)) {
    if (
      executable === "sed" &&
      args.some((arg) =>
        arg === "--in-place" ||
        arg.startsWith("--in-place=") ||
        arg.startsWith("-i") ||
        /^-[A-Za-z]*i[A-Za-z]*$/.test(arg)
      )
    ) return null;
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
    if (args.some((arg) => arg === "--output" || arg.startsWith("--output="))) return null;
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

/** @param {any} report */
function hasIndependentLoadEvidence(report) {
  const commands = report?.toolEvidence?.completedCommands ?? [];
  const commandText = commands.map((/** @type {any} */ entry) => entry.command).join("\n");
  const routerRead = commandText.includes("/drive-development-flow/SKILL.md");
  const orchestrationRead = commandText.includes("/coding-orchestration/SKILL.md");
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
  return routerRead && orchestrationRead && lifecycleReads && skillAudit &&
    commandsSucceeded && classifiedActions && commandsAllowed;
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
      observed.routerLoaded?.name === "drive-development-flow" &&
      observed.routerLoaded?.loaded === true
    ) ||
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
    Array.isArray(report?.approvalEvidence) &&
    report.approvalEvidence.length > 0 &&
    report.approvalEvidence.every((/** @type {any} */ approval) =>
      ["command", "file-read"].includes(approval.requestKind) &&
      ["accept", "decline"].includes(approval.decision) &&
      (
        approval.decision === "decline" ||
        approval.requestKind === "file-read" ||
        isReadOnlyProbeCommand(approval.detail)
      )
    ) &&
    report?.stateInvariants?.repository?.gitHeadUnchanged === true &&
    report?.stateInvariants?.repository?.gitStatusUnchanged === true &&
    report?.stateInvariants?.repository?.fingerprintUnchanged === true &&
    report?.stateInvariants?.managedHome?.unchanged === true
  );
}
