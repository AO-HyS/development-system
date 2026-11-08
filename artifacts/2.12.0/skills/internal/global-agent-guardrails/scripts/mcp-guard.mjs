// @ts-check
// MCP spend guard (DS 2.12.0, policy 2.5.0). Precedence: stop list > generic executors (exact targets) > exact allow list > stop as unknown.
// No server is exempt and no name pattern grants: an unlisted server or tool stops.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const policy = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "references", "mcp-policy.json"), "utf8"));

/** @param {string} category @param {string} detail */
function stopped(category, detail) {
  const reason = policy.categories[category] ?? policy.categories.unknown;
  return { allowed: false, ruleId: category === "unknown" ? "mcp-unknown" : `mcp-${category}`, reason: `${reason} ${detail} Ask the owner, or use a listed read tool.` };
}

const ALLOWED = { allowed: true, ruleId: null, reason: null };

/**
 * Evaluate one MCP tool call. Returns null when the tool is not an MCP tool.
 * @param {string} tool @param {any} input
 * @param {(command: string) => { allowed: boolean, ruleId: string | null, reason: string | null }} evaluateShell
 */
export function evaluateMcp(tool, input, evaluateShell) {
  if (!tool.startsWith("mcp__")) return null;
  const parts = tool.split("__");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("__")) return stopped("unknown", `Tool \`${tool}\` has no server and tool name.`);
  const server = parts[1];
  const name = parts.slice(2).join("__");
  const stopCategory = policy.stop?.[server]?.[name];
  if (stopCategory) return stopped(stopCategory, `Tool: ${server}/${name}.`);
  const executor = policy.executors?.[server]?.[name];
  if (executor) return evaluateExecutor(server, name, executor, input ?? {}, evaluateShell);
  if (Array.isArray(policy.allow?.[server]) && policy.allow[server].includes(name)) return ALLOWED;
  return stopped("unknown", `Tool: ${server}/${name}.`);
}

/**
 * @param {string} server @param {string} name @param {any} executor @param {any} input
 * @param {(command: string) => { allowed: boolean, ruleId: string | null, reason: string | null }} evaluateShell
 */
function evaluateExecutor(server, name, executor, input, evaluateShell) {
  if (server === "github" && name === "merge_pull_request") {
    // The same merge pass as `gh pr merge`: the pass names repository, number and head.
    const { owner, repo, pullNumber, sha } = input;
    const safe = (/** @type {unknown} */ value) => typeof value === "string" || typeof value === "number" ? String(value) : "";
    if (!/^[A-Za-z0-9_.-]+$/u.test(safe(owner)) || !/^[A-Za-z0-9_.-]+$/u.test(safe(repo)) || !/^[0-9]+$/u.test(safe(pullNumber))) {
      return stopped("unknown", "merge_pull_request needs literal owner, repo and pullNumber.");
    }
    const head = /^[0-9a-f]{40}$/u.test(safe(sha)) ? ` --match-head-commit ${safe(sha)}` : "";
    return evaluateShell(`gh pr merge ${safe(pullNumber)} -R ${safe(owner)}/${safe(repo)}${head}`);
  }
  const note = executor.note ? ` (${executor.note})` : "";
  if (!executor.parameter) return stopped("unknown", `${server}/${name} is stopped.${note}`);
  const value = input[executor.parameter];
  if (typeof value !== "string" || !value.trim()) return stopped("unknown", `${server}/${name} has no ${executor.parameter}.`);
  const text = value.trim();
  const reads = /** @type {string[]} */ (executor.readCalls ?? []);
  if (server === "posthog") {
    // Exact targets only (no name patterns): `<read command> [words]` or `call [--json] <listed read> [one JSON object]`.
    if (/[\n\r]/u.test(text)) return stopped("unknown", "posthog exec runs one command per call.");
    const word = /^([a-z]+)(?:\s|$)/u.exec(text)?.[1] ?? "";
    if ((executor.readCommands ?? []).includes(word)) return ALLOWED;
    const call = /^call\s+(?:--json\s+)?([a-z0-9-]+)(?:\s+([\s\S]+))?$/u.exec(text);
    if (call && reads.includes(call[1]) && jsonObjectOrNothing(call[2])) return ALLOWED;
    return stopped("unknown", `posthog exec \`${text.slice(0, 80)}\` is not a listed read.`);
  }
  if (reads.includes(text)) return ALLOWED;
  return stopped("unknown", `${server}/${name} \`${text.slice(0, 80)}\` is not a listed read.${note}`);
}

/** @param {string | undefined} rest */
function jsonObjectOrNothing(rest) {
  if (rest === undefined) return true;
  try {
    const parsed = JSON.parse(rest);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export const mcpPolicyVersion = policy.policyVersion;
