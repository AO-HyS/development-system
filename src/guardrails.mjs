// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const marker = "AOHYS_GLOBAL_AGENT_GUARDRAILS=1";
const stateRelative = ".development-system/guardrails/state.json";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Catalog 0.87.0 ships policy 3.1.0 (adds Antigravity fail-closed hook, ACP OAuth protection, multi-root test-write guard, and unconditional MCP merge stops), from artifacts/4.2.0/skills/internal/global-agent-guardrails. */
const guardCatalogVersion = "0.87.0";
/** The contract release that installs the guard of guardCatalogVersion; mismatched HOMEs are told to run its setup. */
const guardSetupVersion = "4.2.0";
/** Previous catalogued guard versions still accepted during audits of un-upgraded HOMEs. */
const legacyGuardCatalogVersions = /** @type {const} */ ([
  { version: "0.83.0", harnesses: ["codex", "claude"] },
  { version: "0.13.0", harnesses: ["codex"] },
]);
export const antigravityHookName = "development-system-guardrails";
/**
 * Codex hooks also cover T3 Codex threads; Claude Code reads its user settings; Antigravity reads
 * `.gemini/config/hooks.json` (and T3 Antigravity ACP links to it via `antigravity-link`). All three
 * execute the canonical engine under `.agents/skills/global-agent-guardrails`.
 */
const adapters = /** @type {const} */ ([
  { key: "codex", config: ".codex/hooks.json", engine: ".agents/skills/global-agent-guardrails/scripts/command-guard.mjs", installed: ".agents/skills/global-agent-guardrails", matcher: "Bash|exec|apply_patch|mcp__.*", label: "Codex" },
  { key: "claude", config: ".claude/settings.json", engine: ".agents/skills/global-agent-guardrails/scripts/command-guard.mjs", installed: ".claude/skills/global-agent-guardrails", matcher: "Bash|Monitor|Edit|Write|MultiEdit|NotebookEdit|mcp__.*", label: "Claude Code" },
  { key: "antigravity", config: ".gemini/config/hooks.json", engine: ".agents/skills/global-agent-guardrails/scripts/command-guard.mjs", installed: ".gemini/config/skills/global-agent-guardrails", matcher: "run_command|write_to_file|replace_file_content|multi_replace_file_content|write_file|edit_file|view_file|read_file|grep_search|find_by_name|list_dir|call_mcp_tool|mcp_.*", label: "Antigravity" },
]);

/** @param {unknown} error */
function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} home @param {string} candidate */
function insideHome(home, candidate) {
  if (isAbsolute(candidate)) throw new Error(`Managed path must be relative to HOME: ${candidate}`);
  const root = resolve(home);
  const path = resolve(root, candidate);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Managed path escapes HOME: ${candidate}`);
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
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Managed parent is a symbolic link: ${current}`);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
  }
}

/** @param {string} path @returns {Promise<Buffer | null>} */
async function readOptional(path) {
  try { return await readFile(path); }
  catch (error) { if (missing(error)) return null; throw error; }
}

/** @param {string} path */
async function existsFile(path) {
  try { await lstat(path); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}

/** @param {Buffer | null} contents @param {string} label @returns {any} */
function parseObject(contents, label) {
  if (contents === null) return {};
  const value = JSON.parse(contents.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value;
}

/** @param {Buffer | null} contents */
function priorRollbackSnapshot(contents) {
  if (contents === null) return null;
  try {
    const state = JSON.parse(contents.toString("utf8"));
    if (![2, 3].includes(state?.schemaVersion) || !state.files) return null;
    /** @type {Record<string, {before: string | null, installed: string | null}>} */
    const snapshot = {};
    for (const { key } of adapters) {
      const file = state.files[key];
      if (file === undefined && key !== "codex") continue;
      if (!file || typeof file !== "object" || !("before" in file)) return null;
      if (file.before !== null && typeof file.before !== "string") return null;
      snapshot[key] = { before: file.before, installed: typeof file.installed === "string" ? file.installed : null };
    }
    return snapshot;
  } catch {
    return null;
  }
}

/** @param {string} path @param {Buffer} contents @param {number} [mode] */
async function writeAtomic(path, contents, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode });
  await rename(temporary, path);
  await chmod(path, mode);
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** @param {string} engine @param {string} harness */
function managedCommand(engine, harness) {
  if (harness === "antigravity") {
    // Antigravity evaluates JSON on stdout; on missing/crashing engine emit an explicit deny decision.
    return `${marker} node ${shellQuote(engine)} hook --harness antigravity || printf '{"decision":"deny","reason":"[guard-unavailable] Guard engine missing or crashed"}\\n'`;
  }
  // `|| exit 2` fails closed: a missing, unreadable or crashing engine blocks instead of allowing.
  return `${marker} node ${shellQuote(engine)} hook --harness ${harness} || exit 2`;
}

/** @param {any} entry */
function isManagedEntry(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return false;
  const entryHooks = /** @type {any[]} */ (entry.hooks);
  return entryHooks.some((hook) => hook && typeof hook === "object" && typeof hook.command === "string" && hook.command.includes(marker));
}

/** @param {Buffer} contents @param {string} label @param {string} [adapterKey] */
function withoutManagedEntry(contents, label, adapterKey = "codex") {
  const settings = parseObject(contents, label);
  if (adapterKey === "antigravity") {
    const next = { ...settings };
    delete next[antigravityHookName];
    return Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
  }
  const preToolUse = /** @type {any[]} */ (Array.isArray(settings.hooks?.PreToolUse) ? settings.hooks.PreToolUse : []);
  const hooks = { ...settings.hooks, PreToolUse: preToolUse.filter((entry) => !isManagedEntry(entry)) };
  if (hooks.PreToolUse.length === 0) delete hooks.PreToolUse;
  const next = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
}

/** @param {any} container @param {string} matcher @param {string} command */
function mergedHooks(container, matcher, command) {
  const hooks = container && typeof container === "object" && !Array.isArray(container) ? { ...container } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? /** @type {any[]} */ (hooks.PreToolUse) : [];
  const existing = preToolUse.filter((entry) => !isManagedEntry(entry));
  hooks.PreToolUse = [
    ...existing,
    {
      matcher,
      // 10 s: the guard's own 3 s deadline plus the base lookup of a pull request merge (gh, up to 3 s).
      hooks: [{ type: "command", command, timeout: 10, statusMessage: "Checking destructive-command policy" }],
    },
  ];
  return hooks;
}

/** @param {any} config @param {string} adapterKey @param {string} matcher @param {string} command */
function withManagedAdapterConfig(config, adapterKey, matcher, command) {
  if (adapterKey === "antigravity") {
    return {
      ...config,
      [antigravityHookName]: {
        PreToolUse: [
          {
            matcher,
            hooks: [{ type: "command", command, timeout: 10 }],
          },
        ],
      },
    };
  }
  return { ...config, hooks: mergedHooks(config.hooks, matcher, command) };
}

/** @param {string} home */
function paths(home) {
  return {
    codexConfig: insideHome(home, adapters[0].config),
    codexEngine: insideHome(home, adapters[0].engine),
    claudeConfig: insideHome(home, adapters[1].config),
    claudeEngine: insideHome(home, adapters[1].engine),
    claudeSkill: insideHome(home, adapters[1].installed),
    antigravityConfig: insideHome(home, adapters[2].config),
    antigravityEngine: insideHome(home, adapters[2].engine),
    antigravitySkill: insideHome(home, adapters[2].installed),
    state: insideHome(home, stateRelative),
  };
}

/** Codex is always managed; Claude Code and Antigravity once their catalogued guard skill is installed. */
/** @param {ReturnType<typeof paths>} managed */
async function activeAdapters(managed) {
  const all = adapterPaths(managed);
  const [hasClaude, hasAntigravity] = await Promise.all([
    existsFile(managed.claudeSkill),
    existsFile(managed.antigravitySkill),
  ]);
  return all.filter((adapter) => {
    if (adapter.key === "claude") return hasClaude;
    if (adapter.key === "antigravity") return hasAntigravity;
    return true;
  });
}

/** @param {string} version */
async function guardHashes(version) {
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, `catalog/${version}.json`), "utf8"));
  const declared = /** @type {any[]} */ (catalog.skills).find((skill) => skill.logicalName === "global-agent-guardrails");
  if (!declared) throw new Error(`Catalog ${version} does not declare global-agent-guardrails`);
  return new Map(/** @type {any[]} */ (declared.variants).map((variant) => [variant.harness, variant.folderSha256]));
}

/** @param {ReturnType<typeof paths>} managed */
function adapterPaths(managed) {
  return adapters.map((adapter) => ({
    ...adapter,
    configPath:
      adapter.key === "codex"
        ? managed.codexConfig
        : adapter.key === "claude"
          ? managed.claudeConfig
          : managed.antigravityConfig,
    enginePath:
      adapter.key === "codex"
        ? managed.codexEngine
        : adapter.key === "claude"
          ? managed.claudeEngine
          : managed.antigravityEngine,
  }));
}

/** @param {string} path */
async function assertEngine(path) {
  const status = await lstat(path).catch((error) => { if (missing(error)) return null; throw error; });
  if (!status?.isFile()) throw new Error(`Guard engine is not installed: ${path}`);
}

/** @param {any} config @param {string} command @param {string} matcher @param {string} [adapterKey] */
function exactEntry(config, command, matcher, adapterKey = "codex") {
  if (adapterKey === "antigravity") {
    const block = config?.[antigravityHookName];
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const blockKeys = Object.keys(block);
    if (blockKeys.length !== 1 || blockKeys[0] !== "PreToolUse") return false;
    if (!Array.isArray(block.PreToolUse) || block.PreToolUse.length !== 1) return false;
    const entry = block.PreToolUse[0];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const entryKeys = Object.keys(entry).sort();
    if (entryKeys.length !== 2 || entryKeys[0] !== "hooks" || entryKeys[1] !== "matcher") return false;
    if (entry.matcher !== matcher) return false;
    if (!Array.isArray(entry.hooks) || entry.hooks.length !== 1) return false;
    const hook = entry.hooks[0];
    if (!hook || typeof hook !== "object" || Array.isArray(hook)) return false;
    const hookKeys = Object.keys(hook).sort();
    return (
      hookKeys.length === 3 &&
      hookKeys[0] === "command" &&
      hookKeys[1] === "timeout" &&
      hookKeys[2] === "type" &&
      hook.type === "command" &&
      hook.command === command &&
      hook.timeout === 10
    );
  }
  if (!Array.isArray(config?.hooks?.PreToolUse)) return false;
  const preToolUse = /** @type {any[]} */ (config.hooks.PreToolUse);
  return preToolUse.some((entry) => {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return false;
    if (entry.matcher !== matcher) return false;
    const entryHooks = /** @type {any[]} */ (entry.hooks);
    return entryHooks.some((hook) =>
      hook?.type === "command" && hook?.command === command && hook?.timeout === 10);
  });
}

/** @param {string} directory */
async function directoryHash(directory) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} current */
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Guard skill contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(directory);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(directory, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Probes run against the audited HOME, whose protected paths and grants the engine reads. @param {string} engine @param {string} command @param {string} home @param {string[]} [extra] */
function probe(engine, command, home, extra = []) {
  return spawnSync(process.execPath, [engine, "check", "--command", command, ...extra], { encoding: "utf8", env: { ...process.env, HOME: home } });
}

/** @param {string} engine @param {unknown} payload @param {string} home @param {string[]} [extra] */
function probePayload(engine, payload, home, extra = []) {
  return spawnSync(process.execPath, [engine, "check", "--tool-json", JSON.stringify(payload), ...extra], { encoding: "utf8", env: { ...process.env, HOME: home } });
}

/** Run an Antigravity PreToolUse hook probe over stdin and parse its fail-closed JSON decision.
 * @param {string} engine @param {string} rawStdin @param {string} home @param {Record<string, string>} [extraEnv] */
function probeAntigravityHook(engine, rawStdin, home, extraEnv = {}) {
  const result = spawnSync(process.execPath, [engine, "hook", "--harness", "antigravity"], {
    input: rawStdin,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...extraEnv },
  });
  let parsed = null;
  try { parsed = JSON.parse((result.stdout ?? "").trim()); } catch { parsed = null; }
  return { status: result.status, decision: parsed?.decision ?? null, reason: parsed?.reason ?? null };
}

/** @param {{home: string}} options */
export async function auditGlobalGuardrails({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  const problems = [];
  for (const path of Object.values(managed)) {
    try { await assertNoSymlinkParents(resolvedHome, path); }
    catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  /** @type {Map<string, Set<string>>} */
  const expectedByHarness = new Map();
  /** Hashes of the current catalogued guard; only that engine understands the latest probes. @type {Map<string, string>} */
  const currentByHarness = new Map();
  try {
    for (const [harness, hash] of await guardHashes(guardCatalogVersion)) {
      currentByHarness.set(harness, hash);
      expectedByHarness.set(harness, (expectedByHarness.get(harness) ?? new Set()).add(hash));
    }
    for (const legacy of legacyGuardCatalogVersions) {
      for (const [harness, hash] of await guardHashes(legacy.version)) {
        if (!/** @type {readonly string[]} */ (legacy.harnesses).includes(harness)) continue;
        expectedByHarness.set(harness, (expectedByHarness.get(harness) ?? new Set()).add(hash));
      }
    }
  } catch (error) {
    problems.push(`Cannot verify guard catalog hash: ${error instanceof Error ? error.message : String(error)}`);
  }
  const audited = await activeAdapters(managed);
  for (const adapter of audited) {
    try { await assertEngine(adapter.enginePath); } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    /** @type {string | null} */
    let skillHash = null;
    try {
      const directory = dirname(dirname(adapter.enginePath));
      if (await existsFile(directory)) skillHash = await directoryHash(directory);
      if (skillHash !== null && !expectedByHarness.get(adapter.key)?.has(skillHash)) {
        problems.push(`${adapter.key} guard skill bytes do not match a catalogued guard version; run \`development-system setup --version ${guardSetupVersion}\` to install the catalogued guard`);
      }
    } catch (error) {
      problems.push(`Cannot hash ${adapter.key} guard skill: ${error instanceof Error ? error.message : String(error)}`);
    }
    let config = {};
    try { config = parseObject(await readOptional(adapter.configPath), `${adapter.label} hooks`); }
    catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    if (!exactEntry(config, managedCommand(adapter.enginePath, adapter.key), adapter.matcher, adapter.key)) {
      problems.push(`${adapter.label} managed PreToolUse hook is missing or drifted`);
    }
    if (await readOptional(adapter.enginePath)) {
      const current = skillHash !== null && skillHash === currentByHarness.get(adapter.key);
      if (adapter.key === "antigravity") {
        const probeRootA = resolve(resolvedHome, "guard-probe-a");
        const probeRootB = resolve(resolvedHome, "guard-probe-b");
        const agSafe = probeAntigravityHook(
          adapter.enginePath,
          JSON.stringify({ cwd: probeRootA, workspacePaths: [probeRootA], toolCall: { id: "p1", name: "run_command", args: { CommandLine: "git status --short", Cwd: probeRootA } } }),
          resolvedHome,
        );
        if (agSafe.status !== 0 || agSafe.decision !== "allow") problems.push("Antigravity guard did not allow the safe run_command probe");
        const agDestructive = probeAntigravityHook(
          adapter.enginePath,
          JSON.stringify({ cwd: probeRootA, workspacePaths: [probeRootA], toolCall: { id: "p2", name: "run_command", args: { CommandLine: "git reset --hard", Cwd: probeRootA } } }),
          resolvedHome,
        );
        if (agDestructive.status !== 0 || agDestructive.decision !== "deny") problems.push("Antigravity guard did not deny the destructive run_command probe");
        const agMalformed = probeAntigravityHook(adapter.enginePath, "{not-json", resolvedHome);
        if (agMalformed.status !== 0 || agMalformed.decision !== "deny") problems.push("Antigravity guard did not fail closed on malformed stdin");
        if (current) {
          const agMultiWrite = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, workspacePaths: [probeRootA, probeRootB], toolCall: { id: "p3", name: "write_to_file", args: { TargetFile: resolve(probeRootB, "src/a.test.ts") } } }),
            resolvedHome,
          );
          if (agMultiWrite.status !== 0 || agMultiWrite.decision !== "deny") problems.push("Antigravity guard did not block the multi-root test-file write probe");
          const agCrossShell = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, workspacePaths: [probeRootA, probeRootB], toolCall: { id: "p4", name: "run_command", args: { CommandLine: `echo x > ${resolve(probeRootB, "src/b.test.ts")}`, Cwd: probeRootA } } }),
            resolvedHome,
          );
          if (agCrossShell.status !== 0 || agCrossShell.decision !== "deny") problems.push("Antigravity guard did not block the cross-root shell test-file write probe");
          const agOauthRead = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, workspacePaths: [probeRootA], toolCall: { id: "p5", name: "view_file", args: { AbsolutePath: resolve(resolvedHome, ".t3/userdata/providers/antigravity/deadbeef/antigravity-acp/antigravity-oauth-token") } } }),
            resolvedHome,
          );
          if (agOauthRead.status !== 0 || agOauthRead.decision !== "deny") problems.push("Antigravity guard did not block reading the ACP OAuth token");
          const agOauthSearch = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, workspacePaths: [probeRootA], toolCall: { id: "p6", name: "grep_search", args: { SearchPath: resolve(resolvedHome, ".t3/userdata/providers/antigravity"), Query: "token" } } }),
            resolvedHome,
          );
          if (agOauthSearch.status !== 0 || agOauthSearch.decision !== "deny") problems.push("Antigravity guard did not block searching an ancestor of the ACP OAuth store");
          const agMcpEagerDeny = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, toolCall: { id: "p7", name: "mcp_vercel_buy_domain", args: { name: "guard-probe.invalid" } } }),
            resolvedHome,
          );
          if (agMcpEagerDeny.status !== 0 || agMcpEagerDeny.decision !== "deny") problems.push("Antigravity guard did not stop the eager MCP purchase probe");
          const agMcpLazyDeny = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, toolCall: { id: "p8", name: "call_mcp_tool", args: { ServerName: "vercel", ToolName: "buy_domain", Arguments: { name: "guard-probe.invalid" } } } }),
            resolvedHome,
          );
          if (agMcpLazyDeny.status !== 0 || agMcpLazyDeny.decision !== "deny") problems.push("Antigravity guard did not stop the lazy MCP purchase probe");
          const agMcpRead = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, toolCall: { id: "p9", name: "call_mcp_tool", args: { ServerName: "vercel", ToolName: "list_projects", Arguments: {} } } }),
            resolvedHome,
          );
          if (agMcpRead.status !== 0 || agMcpRead.decision !== "allow") problems.push("Antigravity guard did not allow the lazy MCP read probe");
          const agGithubMerge = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, toolCall: { id: "p10", name: "mcp_github_merge_pull_request", args: { owner: "AO-HyS", repo: "development-system", pullNumber: 1 } } }),
            resolvedHome,
          );
          if (agGithubMerge.status !== 0 || agGithubMerge.decision !== "deny") problems.push("Antigravity guard did not stop github/merge_pull_request");
          const agT3Merge = probeAntigravityHook(
            adapter.enginePath,
            JSON.stringify({ cwd: probeRootA, toolCall: { id: "p11", name: "mcp_t3-code_pull_request_merge", args: { expectedHeadSha: "deadbeef" } } }),
            resolvedHome,
          );
          if (agT3Merge.status !== 0 || agT3Merge.decision !== "deny") problems.push("Antigravity guard did not stop t3-code/pull_request_merge");
        }
        continue;
      }
      const safe = probe(adapter.enginePath, current ? 'grep -n "x" f 2>/dev/null | head' : "git status --short", resolvedHome);
      const blocked = probe(adapter.enginePath, "git reset --hard", resolvedHome);
      if (safe.status !== 0) problems.push(`${adapter.label} guard did not allow the safe probe`);
      if (blocked.status !== 2) problems.push(`${adapter.label} guard did not block the destructive probe`);
      if (current) {
        // --no-grants: an operator's active test-write grant must not make a healthy guard look broken.
        const testWrite = probePayload(adapter.enginePath, { tool_name: "Write", cwd: resolve(resolvedHome, "guard-probe"), tool_input: { file_path: "src/a.test.ts", content: "" } }, resolvedHome, ["--no-grants"]);
        if (testWrite.status !== 2) problems.push(`${adapter.label} guard did not block the test-file write probe`);
        const grantWrite = probePayload(adapter.enginePath, { tool_name: "Write", cwd: resolve(resolvedHome, "guard-probe"), tool_input: { file_path: resolve(resolvedHome, ".development-system/test-grants.json"), content: "" } }, resolvedHome);
        if (grantWrite.status !== 2) problems.push(`${adapter.label} guard did not block the test-grant file write probe`);
        const selfGrant = probe(adapter.enginePath, "pnpm exec development-system allow-tests guard-probe", resolvedHome);
        if (selfGrant.status !== 2) problems.push(`${adapter.label} guard did not block the agent self-grant probe`);
        // Policy 2.5.0+: the MCP spend guard stops a purchase and lets a listed read through.
        const spend = probePayload(adapter.enginePath, { tool_name: "mcp__plugin_vercel_vercel__buy_domain", cwd: resolvedHome, tool_input: { name: "guard-probe.invalid" } }, resolvedHome);
        if (spend.status !== 2) problems.push(`${adapter.label} guard did not stop the MCP purchase probe`);
        const read = probePayload(adapter.enginePath, { tool_name: "mcp__plugin_vercel_vercel__list_projects", cwd: resolvedHome, tool_input: {} }, resolvedHome);
        if (read.status !== 0) problems.push(`${adapter.label} guard did not allow the MCP read probe`);
      }
    }
  }
  const t3Summary = audited.some((adapter) => adapter.key === "antigravity")
    ? "inherits its Codex, Claude Code, or Antigravity provider"
    : audited.length > 1
      ? "inherits its Codex or Claude Code provider"
      : "inherits Codex";
  return {
    ok: problems.length === 0,
    operation: "guardrails-audit",
    status: problems.length === 0 ? "healthy" : "invalid",
    adapters: Object.fromEntries([...audited.map((adapter) => [adapter.key, `PreToolUse ${adapter.matcher}`]), ["t3code", t3Summary]]),
    paths: managed,
    problems,
    externalSideEffects: [],
  };
}

/** @param {{home: string}} options */
export async function enableGlobalGuardrails({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  const managedAdapters = await activeAdapters(managed);
  for (const path of Object.values(managed)) await assertNoSymlinkParents(resolvedHome, path);
  for (const adapter of managedAdapters) await assertEngine(adapter.enginePath);
  const state = await readOptional(managed.state);
  /** @type {Record<string, Buffer | null>} */
  const before = {};
  /** @type {Record<string, Buffer>} */
  const installed = {};
  for (const adapter of managedAdapters) {
    before[adapter.key] = await readOptional(adapter.configPath);
    const config = parseObject(before[adapter.key], `${adapter.label} hooks`);
    const command = managedCommand(adapter.enginePath, adapter.key);
    if (!exactEntry(config, command, adapter.matcher, adapter.key)) {
      installed[adapter.key] = Buffer.from(`${JSON.stringify(withManagedAdapterConfig(config, adapter.key, adapter.matcher, command), null, 2)}\n`);
    }
  }
  if (Object.keys(installed).length === 0) {
    return { ...(await auditGlobalGuardrails({ home: resolvedHome })), operation: "guardrails-enable", changed: false };
  }
  const priorSnapshot = priorRollbackSnapshot(state);
  /** @type {Record<string, {before: string | null, installed: string}>} */
  const files = {};
  for (const adapter of managedAdapters) {
    const current = /** @type {Buffer | null} */ (before[adapter.key]);
    const prior = priorSnapshot && adapter.key in priorSnapshot ? priorSnapshot[adapter.key] : undefined;
    const currentBase64 = current === null ? null : current.toString("base64");
    // Keep the first activation's bytes only while nobody changed the config since; otherwise
    // restore the current config minus the managed entry, so hooks added later survive rollback.
    const priorBefore = prior !== undefined && prior.installed === currentBase64
      ? prior.before
      : prior === undefined || current === null
        ? currentBase64
        : withoutManagedEntry(current, `${adapter.label} hooks`, adapter.key).toString("base64");
    files[adapter.key] = {
      before: priorBefore,
      installed: (installed[adapter.key] ?? current ?? Buffer.alloc(0)).toString("base64"),
    };
  }
  const nextState = { schemaVersion: 3, operation: "global-guardrails-enable", installedAt: new Date().toISOString(), files };
  async function restorePriorBytes() {
    /** @type {{path: string, contents: Buffer | null}[]} */
    const priorFiles = [
      ...managedAdapters.filter((adapter) => adapter.key in installed).map((adapter) => ({ path: adapter.configPath, contents: before[adapter.key] })),
      { path: managed.state, contents: state },
    ];
    for (const { path, contents } of priorFiles) {
      if (contents === null) {
        await unlink(path).catch((error) => { if (!missing(error)) throw error; });
      } else {
        await writeAtomic(path, contents);
      }
    }
  }

  try {
    await writeAtomic(managed.state, Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`));
    for (const adapter of managedAdapters) {
      if (installed[adapter.key]) await writeAtomic(adapter.configPath, installed[adapter.key]);
    }
    const audit = await auditGlobalGuardrails({ home: resolvedHome });
    if (!audit.ok) throw new Error(`Guardrail activation failed verification:\n- ${audit.problems.join("\n- ")}`);
    return { ...audit, operation: "guardrails-enable", changed: true, statePath: managed.state };
  } catch (error) {
    await restorePriorBytes();
    throw error;
  }
}

/** @param {{home: string}} options */
export async function rollbackGlobalGuardrails({ home }) {
  const resolvedHome = resolve(home);
  const managed = paths(resolvedHome);
  for (const path of [managed.codexConfig, managed.claudeConfig, managed.antigravityConfig, managed.state]) {
    await assertNoSymlinkParents(resolvedHome, path);
  }
  const contents = await readOptional(managed.state);
  if (contents === null) throw new Error("No guardrail activation snapshot exists");
  const state = JSON.parse(contents.toString("utf8"));
  if (![2, 3].includes(state?.schemaVersion) || !state.files || !("codex" in state.files)) {
    throw new Error("Guardrail activation snapshot is invalid");
  }
  const entries = [];
  for (const { key, label, configPath: path } of adapterPaths(managed)) {
    if (key !== "codex" && !(key in state.files)) continue;
    const file = state.files[key];
    if (!file || typeof file !== "object" || !("before" in file) || typeof file.installed !== "string") {
      throw new Error(`Guardrail snapshot contains invalid ${key} metadata`);
    }
    const before = file.before === null ? null : typeof file.before === "string" ? Buffer.from(file.before, "base64") : null;
    if (file.before !== null && before === null) throw new Error(`Guardrail snapshot contains invalid ${key} prior bytes`);
    const installed = Buffer.from(file.installed, "base64");
    const current = await readOptional(path);
    if (current !== null && current.equals(installed)) {
      entries.push({ path, before });
    } else if (current === null) {
      // The configuration was removed after activation, so the managed hook is already gone.
    } else {
      // Remove only the managed guard hook so user hooks added later survive rollback.
      entries.push({ path, before: withoutManagedEntry(current, `${label} hooks`, key) });
    }
  }
  for (const { path, before } of entries) {
    if (before === null) await unlink(path).catch((error) => { if (!missing(error)) throw error; });
    else await writeAtomic(path, before);
  }
  await unlink(managed.state);
  return { ok: true, operation: "guardrails-rollback", status: "restored", externalSideEffects: [] };
}
