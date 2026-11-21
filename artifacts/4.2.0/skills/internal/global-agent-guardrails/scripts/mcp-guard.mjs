// @ts-check
// MCP spend guard (DS 4.2.0 / policy 2.0.0). Precedence:
//   discovery confinement (when AOHYS_MCP_DISCOVERY_DENY_ALL=1) > stop list > generic executors > allowed.
// Supports Claude/Codex (`mcp__<server>__<tool>`), Antigravity eager (`mcp_<server>_<tool>`),
// and Antigravity lazy (`call_mcp_tool` with `{ ServerName, ToolName, Arguments }`).
// Under DS 4.2.0, MCP pull-request merges (`github/merge_pull_request`, `t3-code/pull_request_merge`,
// `linear/merge_diff`) are unconditionally stopped because commit statuses bind to a commit SHA, not a PR+base tuple.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const policy = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "references", "mcp-policy.json"), "utf8"));

/** Bidirectional server aliases bridging Antigravity/Codex direct names and Claude plugin/connector prefixes. @type {Record<string, string>} */
const SERVER_ALIASES = {
  vercel: "plugin_vercel_vercel",
  linear: "plugin_linear_linear",
  convex: "plugin_convex_convex",
  exa: "plugin_exa_exa",
  resend: "claude_ai_Resend",
  gmail: "claude_ai_Gmail",
  google_calendar: "claude_ai_Google_Calendar",
  google_drive: "claude_ai_Google_Drive",
  notion: "claude_ai_Notion",
  "mercadopago-mcp-server": "mercadopago",
  // Reverse aliases: Claude Code plugin/connector prefixes -> canonical keys added in 4.2.0
  plugin_sentry_sentry: "sentry",
  plugin_expo_expo: "expo",
  plugin_cloudflare_cloudflare: "cloudflare",
  claude_ai_Stripe: "stripe",
  plugin_stripe_stripe: "stripe",
  plugin_posthog_posthog: "posthog",
  plugin_mercadopago_mercadopago: "mercadopago",
  plugin_github_github: "github",
  plugin_mobbin_mobbin: "mobbin",
  plugin_context7_context7: "context7",
  plugin_shadcn_shadcn: "shadcn",
};

/** All known server prefixes (direct keys + aliases), sorted longest-first for unambiguous `mcp_<server>_<tool>` splitting. */
const KNOWN_SERVERS = [...new Set([
  ...Object.keys(policy.stop ?? {}),
  ...Object.keys(policy.executors ?? {}),
  ...Object.keys(policy.allow ?? {}),
  ...Object.keys(SERVER_ALIASES),
])].sort((a, b) => b.length - a.length);

/** @param {string} category @param {string} detail */
function stopped(category, detail) {
  const reason = policy.categories[category] ?? policy.categories.unknown;
  return { allowed: false, ruleId: category === "unknown" ? "mcp-unknown" : `mcp-${category}`, reason: `${reason} ${detail} Ask the owner, or use a listed read tool.` };
}

const ALLOWED = { allowed: true, ruleId: null, reason: null };

/** Parse `AOHYS_MCP_DISCOVERY_ALLOW` (JSON `{ server: [tool, ...] }`) when discovery confinement is active. */
function discoveryAllowlist() {
  const raw = process.env.AOHYS_MCP_DISCOVERY_ALLOW;
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return /** @type {Record<string, string[]>} */ (parsed);
  } catch {
    return null;
  }
}

/**
 * Resolve `(server, toolName)` for Claude/Codex (`mcp__s__t`), Antigravity eager (`mcp_s_t`),
 * or Antigravity lazy (`call_mcp_tool`). Returns `null` when not an MCP tool, or `{ invalid: string }` on malformed lazy call.
 * @param {string} tool @param {any} input
 */
export function parseMcpToolCall(tool, input) {
  if (tool === "call_mcp_tool") {
    const server = typeof input?.ServerName === "string" ? input.ServerName.trim() : "";
    const name = typeof input?.ToolName === "string" ? input.ToolName.trim() : "";
    if (!server || !name) return { invalid: "call_mcp_tool requires literal ServerName and ToolName." };
    const args = input?.Arguments && typeof input.Arguments === "object" && !Array.isArray(input.Arguments) ? input.Arguments : {};
    return { server, name, args };
  }
  if (tool.startsWith("mcp__")) {
    const parts = tool.split("__");
    if (parts.length < 3 || !parts[1] || !parts.slice(2).join("__")) return { invalid: `Malformed MCP tool name: ${tool}` };
    return { server: parts[1], name: parts.slice(2).join("__"), args: input ?? {} };
  }
  if (tool.startsWith("mcp_")) {
    const rest = tool.slice(4);
    for (const prefix of KNOWN_SERVERS) {
      if (rest.startsWith(`${prefix}_`) && rest.length > prefix.length + 1) {
        return { server: prefix, name: rest.slice(prefix.length + 1), args: input ?? {} };
      }
    }
    const splitAt = rest.indexOf("_");
    if (splitAt <= 0 || splitAt >= rest.length - 1) return { invalid: `Malformed Antigravity MCP tool name: ${tool}` };
    return { server: rest.slice(0, splitAt), name: rest.slice(splitAt + 1), args: input ?? {} };
  }
  return null;
}

/**
 * Evaluate one MCP tool call. Returns null when the tool is not an MCP tool.
 * @param {string} tool @param {any} input
 * @param {(command: string) => { allowed: boolean, ruleId: string | null, reason: string | null }} evaluateShell
 */
export function evaluateMcp(tool, input, evaluateShell) {
  const parsed = parseMcpToolCall(tool, input);
  if (parsed === null) return null;
  if ("invalid" in parsed) return stopped("unknown", parsed.invalid);
  return evaluateMcpCall(parsed.server, parsed.name, parsed.args, evaluateShell);
}

/**
 * Evaluate a resolved `(server, name, input)` MCP call.
 * @param {string} rawServer @param {string} name @param {any} input
 * @param {(command: string) => { allowed: boolean, ruleId: string | null, reason: string | null }} evaluateShell
 */
export function evaluateMcpCall(rawServer, name, input, evaluateShell) {
  const canonicalServer = SERVER_ALIASES[rawServer] ?? rawServer;

  // Strict discovery confinement (DS 4.2.0 R3-H1): deny every MCP tool except an explicit non-empty read allowlist.
  if (process.env.AOHYS_MCP_DISCOVERY_DENY_ALL === "1") {
    const allowlist = discoveryAllowlist();
    const serverAllowed = allowlist ? [...(allowlist[rawServer] ?? []), ...(allowlist[canonicalServer] ?? [])] : [];
    if (serverAllowed.length > 0 && serverAllowed.includes(name)) {
      // Still enforce stop list below so a stopped tool can never slip into discovery.
    } else {
      return {
        allowed: false,
        ruleId: "mcp-discovery-confined",
        reason: `MCP discovery confinement active: ${rawServer}/${name} is not in the explicit non-empty read allowlist.`,
      };
    }
  }

  const stopCategory = policy.stop?.[rawServer]?.[name] ?? policy.stop?.[canonicalServer]?.[name];
  if (stopCategory) return stopped(stopCategory, `Tool: ${rawServer}/${name}.`);

  const executor = policy.executors?.[rawServer]?.[name] ?? policy.executors?.[canonicalServer]?.[name];
  if (executor) return evaluateExecutor(canonicalServer, name, executor, input ?? {}, evaluateShell);

  return ALLOWED;
}

/**
 * @param {string} server @param {string} name @param {any} executor @param {any} input
 * @param {(command: string) => { allowed: boolean, ruleId: string | null, reason: string | null }} evaluateShell
 */
function evaluateExecutor(server, name, executor, input, evaluateShell) {
  const note = executor.note ? ` (${executor.note})` : "";
  if (!executor.parameter) return stopped("unknown", `${server}/${name} is stopped.${note}`);
  const value = input[executor.parameter];
  if (typeof value !== "string" || !value.trim()) return stopped("unknown", `${server}/${name} has no ${executor.parameter}.`);
  const text = value.trim();
  const reads = /** @type {string[]} */ (executor.readCalls ?? []);
  if (server === "posthog") {
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
