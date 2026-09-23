// @ts-check
import { isAbsolute, relative, resolve, sep } from "node:path";

const WRITER_CONFIG = Object.freeze([
  'approval_policy="never"',
  "sandbox_workspace_write.network_access=false",
  "sandbox_workspace_write.writable_roots=[]",
  "sandbox_workspace_write.exclude_tmpdir_env_var=true",
  "sandbox_workspace_write.exclude_slash_tmp=true",
]);

/** New Luna 6 child routes require Fast; historical routes keep their argv.
 * @param {string} model */
export function requiredCodexServiceTier(model) {
  return model === "gpt-6-luna" ? "priority" : null;
}

/** Keep the positional prompt outside Codex's variadic image option.
 * Explicit --sandbox selects the legacy policy even with inherited
 * default_permissions; pin every writable-root/network expansion for writers.
 * Managed permission profiles are rejected by the pre-launch requirements probe.
 * https://learn.chatgpt.com/docs/permissions
 * @param {{role?:string,model:string,reasoning:string|null,candidateRoot:string,schemaPath?:string|null,imagePaths?:string[],prompt:string}} input */
export function codexArguments({ role, model, reasoning, candidateRoot, schemaPath, imagePaths = [], prompt }) {
  const tier = requiredCodexServiceTier(model);
  return ["exec", "--json", "--sandbox", role === "writer" ? "workspace-write" : "read-only", "--model", model,
    "-c", `model_reasoning_effort="${reasoning}"`,
    ...(tier ? ["-c", `service_tier="${tier}"`] : []),
    ...(role === "writer" ? WRITER_CONFIG.flatMap((config) => ["-c", config]) : []), "--cd", candidateRoot,
    ...(schemaPath ? ["--output-schema", schemaPath] : []), ...imagePaths.flatMap((path) => ["--image", path]), "--", prompt];
}

/** Validate only the permitted options; prompt contents never grant authority.
 * Historical read-only observations may omit --json, --cd or the delimiter.
 * Writers must match the complete current builder, including all restrictions.
 * @param {string[]} argv
 * @param {{role:string,model:string,reasoning:string|null,candidateRoot:string}} expected */
export function matchesCodexCommand(argv, { role, model, reasoning, candidateRoot }) {
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string" || arg.includes("\0")) || argv[0] !== "exec") return false;
  const writer = role === "writer";
  const effort = `model_reasoning_effort="${reasoning}"`;
  const tier = requiredCodexServiceTier(model);
  const allowedConfig = new Set([effort, ...(tier ? [`service_tier="${tier}"`] : []), ...(writer ? WRITER_CONFIG : [])]);
  const configs = new Set();
  /** @type {Map<string,string|true>} */ const options = new Map();
  /** @type {string[]} */ const imagePaths = [];
  let prompt, delimited = false;
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--") {
      if (index !== argv.length - 2) return false;
      prompt = argv[index + 1]; delimited = true;
      break;
    }
    if (flag === "--json") {
      if (options.has(flag)) return false;
      options.set(flag, true);
      continue;
    }
    if (["--sandbox", "--model", "--cd", "--output-schema", "--image", "-c"].includes(flag)) {
      const value = argv[++index];
      if (value === undefined || !value.length || value.startsWith("-")) return false;
      if (flag === "-c") {
        if (!allowedConfig.has(value) || configs.has(value)) return false;
        configs.add(value);
      } else if (flag === "--image") {
        if (imagePaths.includes(value)) return false;
        imagePaths.push(value);
      } else {
        if (options.has(flag)) return false;
        options.set(flag, value);
      }
      continue;
    }
    // Only old read-only records can have one terminal positional prompt.
    if (writer || flag.startsWith("-") || index !== argv.length - 1 || ["resume", "fork", "review", "help"].includes(flag)) return false;
    prompt = flag;
  }
  if (options.get("--model") !== model || options.get("--sandbox") !== (writer ? "workspace-write" : "read-only") || !configs.has(effort) || tier && !configs.has(`service_tier="${tier}"`)) return false;
  if (options.has("--cd") && options.get("--cd") !== candidateRoot) return false;
  if (!writer) return configs.size === allowedConfig.size;
  if (!delimited || prompt === undefined || !options.has("--json") || options.get("--cd") !== candidateRoot || configs.size !== allowedConfig.size) return false;
  const expected = codexArguments({ role, model, reasoning, candidateRoot, schemaPath: /** @type {string|undefined} */ (options.get("--output-schema")), imagePaths, prompt });
  return argv.length === expected.length && argv.every((arg, index) => arg === expected[index]);
}

/** The actual configRequirements/read response, never caller-supplied policy.
 * Missing named-profile fields cannot establish support for the legacy flags.
 * @param {any} result */
export function allowsCodexWriterRequirements(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).length !== 1 || !Object.hasOwn(result, "requirements")) return false;
  const requirements = result.requirements;
  if (requirements === null) return true;
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) return false;
  if (!["allowedPermissionProfiles", "defaultPermissions"].every((key) => Object.hasOwn(requirements, key) && requirements[key] === null)) return false;
  return [["allowedApprovalPolicies", "never"], ["allowedSandboxModes", "workspace-write"]].every(([key, required]) =>
    !Object.hasOwn(requirements, key) || requirements[key] === null
    || Array.isArray(requirements[key]) && requirements[key].every((/** @type {any} */ value) => typeof value === "string") && requirements[key].includes(required));
}

/** Check effective turn permissions, not merely the requested argv. The normal
 * resolved permission_profile has type managed; that does not identify an
 * administrator-managed config. Its actual writable entries must be confined.
 * @param {any} metadata @param {string} candidateRoot */
export function matchesCodexWriterPermissions(metadata, candidateRoot) {
  const sandbox = metadata?.sandbox_policy;
  if (metadata?.approval_policy !== "never" || !sandbox || sandbox.type !== "workspace-write" || sandbox.network_access !== false
    || sandbox.exclude_tmpdir_env_var !== true || sandbox.exclude_slash_tmp !== true
    || Object.hasOwn(sandbox, "writable_roots") && (!Array.isArray(sandbox.writable_roots) || sandbox.writable_roots.length !== 0)) return false;
  const profile = metadata.permission_profile;
  if (!profile || profile.type !== "managed" || profile.network !== "restricted" || profile.file_system?.type !== "restricted" || !Array.isArray(profile.file_system.entries)
    || Object.keys(profile).some((key) => !["type", "network", "file_system"].includes(key)) || Object.keys(profile.file_system).some((key) => !["type", "entries"].includes(key))) return false;
  return profile.file_system.entries.every((/** @type {any} */ entry) => {
    if (!entry || !["read", "write", "deny"].includes(entry.access) || !entry.path || !["path", "special"].includes(entry.path.type)) return false;
    if (entry.access !== "write") return true;
    if (entry.path.type !== "path" || typeof entry.path.path !== "string" || !isAbsolute(entry.path.path) || resolve(entry.path.path) !== entry.path.path) return false;
    const path = relative(candidateRoot, resolve(entry.path.path));
    return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  });
}
