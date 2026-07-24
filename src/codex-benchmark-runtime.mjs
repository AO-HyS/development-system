// @ts-check

const forbiddenLongFlags = [
  "--ignore-user-config",
  "--ephemeral",
  "--profile",
  "--config",
  "--enable",
  "--disable",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--ignore-rules",
  "--add-dir",
  "--output-last-message",
];
const forbiddenShortFlags = ["-p", "-c", "-o"];
const reasoningLevels = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

/**
 * Build a benchmark-scoped Codex invocation. Authentication and repository
 * instructions still come from the canonical CODEX_HOME, while unrelated
 * user MCP/plugin configuration is excluded from the measured process.
 * @param {string[]} forwardedArgs
 */
export function buildCodexBenchmarkArgs(forwardedArgs) {
  if (!Array.isArray(forwardedArgs) || forwardedArgs.length === 0) {
    throw new Error("At least one codex exec argument is required");
  }
  /** @type {string[]} */
  const controlledArgs = [];
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const argument = forwardedArgs[index];
    if (typeof argument !== "string" || argument.length === 0) {
      throw new Error("Codex benchmark arguments must be non-empty strings");
    }
    if (argument === "--reasoning") {
      const reasoning = forwardedArgs[index + 1];
      if (typeof reasoning !== "string" || !reasoningLevels.has(reasoning)) {
        throw new Error(`--reasoning must be one of ${[...reasoningLevels].join(", ")}`);
      }
      controlledArgs.push("--config", `model_reasoning_effort="${reasoning}"`);
      index += 1;
      continue;
    }
    if (argument === "--sandbox" || argument === "-s") {
      const sandbox = forwardedArgs[index + 1];
      if (typeof sandbox !== "string" || !["read-only", "workspace-write"].includes(sandbox)) {
        throw new Error("--sandbox must be read-only or workspace-write");
      }
      controlledArgs.push(argument, sandbox);
      index += 1;
      continue;
    }
    if (argument.startsWith("--sandbox=")) {
      const sandbox = argument.slice("--sandbox=".length);
      if (!["read-only", "workspace-write"].includes(sandbox)) {
        throw new Error("--sandbox must be read-only or workspace-write");
      }
    }
    if (
      forbiddenLongFlags.some((flag) =>
        argument === flag || argument.startsWith(`${flag}=`)
      ) ||
      forbiddenShortFlags.some((flag) =>
        argument === flag || argument.startsWith(flag)
      )
    ) {
      throw new Error(`${argument} is managed by the benchmark runtime`);
    }
    controlledArgs.push(argument);
  }
  return ["exec", "--ignore-user-config", "--ephemeral", ...controlledArgs];
}

export const CODEX_BENCHMARK_ENVIRONMENT = Object.freeze({
  attribution: "environment-overhead",
  configScope: "process",
  preservesCanonicalCodexHome: true,
});
