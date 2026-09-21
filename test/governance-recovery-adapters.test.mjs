import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyToolResult,
  describeToolInvocation,
  getAdapterCatalog,
  patchPaths,
  stableHash as adapterStableHash,
  tokenizeExactCommand,
  validateRequiredCapabilities,
} from "../runtime/jev-governance/adapters.mjs";
import { stableHash } from "../runtime/jev-governance/schemas.mjs";
import { GovernanceError } from "../runtime/jev-governance/errors.mjs";
import { handleHook, isGovernanceControlCommand } from "../runtime/jev-governance/hook.mjs";
import { GOVERNANCE_COMMANDS, parseGovernanceArguments } from "../runtime/jev-governance/cli.mjs";
import { readRegistry, writeRegistry } from "../runtime/jev-governance/store.mjs";

const cli = fileURLToPath(new URL("../runtime/jev-governance/cli.mjs", import.meta.url));

/** @param {() => unknown} fn @param {string} code */
function throwsCode(fn, code) {
  assert.throws(fn, (error) => error instanceof GovernanceError && error.code === code, `expected GovernanceError ${code}`);
}

async function isolatedDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** @param {string} toolName @param {unknown} toolInput */
function descriptorFor(toolName, toolInput) {
  return describeToolInvocation({ toolName, toolInput });
}

test("adapters stay pure: no hook, core, store or schemas import that would close a cycle", async () => {
  const source = await readFile(new URL("../runtime/jev-governance/adapters.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+"\.\/(?:hook|core|store|schemas)\.mjs"/u);
  assert.match(source, /from\s+"\.\/errors\.mjs"/u);
});

test("the catalog exposes only the supported operation classes and is read-only", () => {
  const catalog = getAdapterCatalog();
  assert.deepEqual(catalog.map((adapter) => adapter.capability), ["shell", "patch", "linear-read", "linear-write", "computer-use"]);
  assert.ok(Object.isFrozen(catalog));
  for (const adapter of catalog) {
    assert.ok(Object.isFrozen(adapter), adapter.capability);
    assert.ok(Object.isFrozen(adapter.toolNames), adapter.capability);
    assert.equal(adapter.observationLevel, "host-invocation");
  }
  assert.deepEqual(catalog.find((adapter) => adapter.capability === "linear-read").toolNames, ["mcp__linear__get_issue", "mcp__linear__get_document"]);
  assert.deepEqual(catalog.find((adapter) => adapter.capability === "computer-use").toolNames, ["mcp__cua_repl__js"]);
});

test("linked documents remain reads and existing-issue updates require explicit bounded targets", () => {
  assert.equal(descriptorFor("mcp__linear__get_document", { id: "approved-spec" }).effect, "read");
  const update = descriptorFor("mcp__linear__save_issue", { id: "NUTRI-346", state: "In Progress" });
  assert.equal(update.capability, "linear-write");
  assert.equal(update.effect, "external-write");
  assert.deepEqual(update.rawToolInput, { id: "NUTRI-346", state: "In Progress" });
  throwsCode(() => descriptorFor("mcp__linear__save_issue", { title: "New issue" }), "invalid_tool_input");
  throwsCode(() => descriptorFor("mcp__linear__save_issue", { id: "NUTRI-346", team: "other" }), "invalid_tool_input");
  throwsCode(() => descriptorFor("mcp__linear__save_issue", { id: "NUTRI-346", priority: 99 }), "invalid_tool_input");
});

test("native Bash pwd keeps its exact raw identity and a local-classifier hash", () => {
  const descriptor = descriptorFor("Bash", { command: "pwd" });
  assert.equal(descriptor.adapterId, "shell");
  assert.equal(descriptor.capability, "shell");
  assert.equal(descriptor.effect, "external-write");
  assert.equal(descriptor.observationLevel, "host-invocation");
  assert.equal(descriptor.rawToolName, "Bash");
  assert.deepEqual(descriptor.rawToolInput, { command: "pwd" });
  assert.deepEqual(descriptor.semanticInput, { command: "pwd" });
  assert.match(descriptor.toolInputHash, /^[a-f0-9]{64}$/u);
  assert.equal(descriptor.toolInputHash, stableHash({ name: "Bash", input: { command: "pwd" } }));
  assert.equal(adapterStableHash({ b: 1, a: [2, 1] }), stableHash({ b: 1, a: [2, 1] }));
});

test("raw input changes are denied and the retained raw input cannot be mutated", () => {
  const input = { command: "pwd" };
  const first = describeToolInvocation({ toolName: "Bash", toolInput: input });
  input.command = "rm -rf /";
  assert.deepEqual(first.rawToolInput, { command: "pwd" });
  assert.equal(first.toolInputHash, stableHash({ name: "Bash", input: { command: "pwd" } }));
  const changed = descriptorFor("Bash", { command: "pwd " });
  assert.notEqual(changed.toolInputHash, first.toolInputHash);
  assert.deepEqual(changed.rawToolInput, { command: "pwd " });
  assert.deepEqual(changed.semanticInput, { command: "pwd " });
});

test("exec_command retains only cmd/workdir and rejects interactive or detached overrides", () => {
  const descriptor = descriptorFor("exec_command", { cmd: "pwd", workdir: "/repo" });
  assert.equal(descriptor.adapterId, "shell");
  assert.deepEqual(descriptor.semanticInput, { cmd: "pwd", workdir: "/repo" });
  for (const key of ["tty", "background", "detached", "run_in_background", "permissions", "shell", "login", "env", "command", "sandbox"]) {
    throwsCode(() => describeToolInvocation({ toolName: "exec_command", toolInput: { cmd: "pwd", [key]: "override" } }), "invalid_tool_input");
  }
  throwsCode(() => describeToolInvocation({ toolName: "exec_command", toolInput: {} }), "invalid_tool_input");
});

test("Bash cwd and workdir must be consistent and benign fields are preserved", () => {
  throwsCode(() => describeToolInvocation({ toolName: "Bash", toolInput: { command: "pwd", cwd: "/a", workdir: "/b" } }), "invalid_tool_input");
  const descriptor = describeToolInvocation({ toolName: "Bash", toolInput: { command: "pwd", workdir: "/repo", description: "show cwd", timeout_ms: 1000 } });
  assert.deepEqual(descriptor.semanticInput, { command: "pwd", workdir: "/repo", description: "show cwd", timeout_ms: 1000 });
  throwsCode(() => describeToolInvocation({ toolName: "Bash", toolInput: { command: "pwd", tty: true } }), "invalid_tool_input");
});

test("unknown or wildcard tool names stay unsupported, never coerced", () => {
  for (const toolName of ["functions.exec", "mcp__linear__create_issue", "mcp__arbitrary__tool", "BashTool", "Shell"]) {
    throwsCode(() => describeToolInvocation({ toolName, toolInput: {} }), "unsupported_tool");
  }
  throwsCode(() => describeToolInvocation({ toolName: "", toolInput: {} }), "invalid_tool_input");
  throwsCode(() => describeToolInvocation({ toolInput: {} }), "invalid_tool_input");
});

test("exact Linear get_issue is a read adapter; arbitrary MCP input is rejected", () => {
  const descriptor = descriptorFor("mcp__linear__get_issue", { id: "NUTRI-346", includeRelations: true });
  assert.equal(descriptor.adapterId, "linear-read");
  assert.equal(descriptor.capability, "linear-read");
  assert.equal(descriptor.effect, "read");
  assert.deepEqual(descriptor.semanticInput, { id: "NUTRI-346", includeRelations: true });
  throwsCode(() => describeToolInvocation({ toolName: "mcp__linear__get_issue", toolInput: { id: "NUTRI-346", query: "all" } }), "invalid_tool_input");
  throwsCode(() => describeToolInvocation({ toolName: "mcp__linear__get_issue", toolInput: {} }), "invalid_tool_input");
  throwsCode(() => describeToolInvocation({ toolName: "mcp__linear__get_issue", toolInput: { id: "NUTRI-346", includeRelations: "yes" } }), "invalid_tool_input");
});

test("Computer Use is an opaque outer call and never a certified read", () => {
  const descriptor = descriptorFor("mcp__cua_repl__js", { code: "return getState()", title: "inventory", timeout_ms: 5000 });
  assert.equal(descriptor.adapterId, "computer-use");
  assert.equal(descriptor.capability, "computer-use");
  assert.equal(descriptor.effect, "opaque");
  assert.notEqual(descriptor.effect, "read");
  assert.deepEqual(descriptor.semanticInput, { code: "return getState()", title: "inventory", timeout_ms: 5000 });
  throwsCode(() => describeToolInvocation({ toolName: "mcp__cua_repl__js", toolInput: {} }), "invalid_tool_input");
  throwsCode(() => describeToolInvocation({ toolName: "mcp__cua_repl__js", toolInput: { code: "x", timeout_ms: 0 } }), "invalid_tool_input");
  throwsCode(() => describeToolInvocation({ toolName: "mcp__cua_repl__js", toolInput: { code: "x", navigate: "https://example.invalid" } }), "invalid_tool_input");
});

test("patch adapter accepts the observed string envelope and every object carrier", () => {
  const envelope = "*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n@@\n-old\n+new\n*** Add File: c.txt\n+ok\n*** Delete File: d.txt\n*** End Patch";
  for (const input of [envelope, { patch: envelope }, { input: envelope }, { command: envelope }]) {
    const descriptor = describeToolInvocation({ toolName: "apply_patch", toolInput: input });
    assert.equal(descriptor.capability, "patch");
    assert.equal(descriptor.effect, "external-write");
    assert.equal(descriptor.semanticInput.patch, envelope);
  }
  assert.equal(describeToolInvocation({ toolName: "ApplyPatch", toolInput: { patch: envelope } }).capability, "patch");
  assert.deepEqual(patchPaths(envelope), ["a.txt", "b.txt", "c.txt", "d.txt"]);
  throwsCode(() => describeToolInvocation({ toolName: "apply_patch", toolInput: "*** Begin Patch\n*** End Patch" }), "invalid_tool_input");
  throwsCode(() => describeToolInvocation({ toolName: "apply_patch", toolInput: { note: "no envelope" } }), "invalid_tool_input");
  throwsCode(() => describeToolInvocation({ toolName: "apply_patch", toolInput: { patch: envelope, input: "*** Begin Patch\n*** End Patch" } }), "invalid_tool_input");
});

test("required capabilities are validated against the closed catalog", () => {
  assert.deepEqual(validateRequiredCapabilities(undefined), []);
  assert.deepEqual(validateRequiredCapabilities([]), []);
  assert.deepEqual(validateRequiredCapabilities(["shell", "linear-read", "shell"]), ["shell", "linear-read"]);
  throwsCode(() => validateRequiredCapabilities(["shell", "telepathy"]), "capability_missing");
  throwsCode(() => validateRequiredCapabilities("shell"), "invalid_tool_input");
  throwsCode(() => validateRequiredCapabilities([42]), "invalid_tool_input");
});

test("native string results classify completion by envelope, never by exit-less text", () => {
  const shell = descriptorFor("Bash", { command: "printf GOV_OK" });
  assert.deepEqual(classifyToolResult(shell, "GOV_OK"), { status: "unknown", code: "stdout-without-exit" });
  assert.deepEqual(classifyToolResult(shell, "pwd\n/tmp\n"), { status: "unknown", code: "stdout-without-exit" });
  assert.deepEqual(classifyToolResult(shell, "Error: boom"), { status: "failed", code: "error-envelope" });
  assert.deepEqual(classifyToolResult(shell, "command not found: nope"), { status: "failed", code: "error-envelope" });
  assert.deepEqual(classifyToolResult(shell, ""), { status: "unknown", code: "empty-output" });
  assert.deepEqual(classifyToolResult(shell, null), { status: "unknown", code: "no-output" });
  assert.deepEqual(classifyToolResult(shell, JSON.stringify({ exit_code: 0, output: "ok" })), { status: "unknown", code: "stdout-without-exit" });
  assert.deepEqual(classifyToolResult(shell, JSON.stringify({ exit_code: 2 })), { status: "unknown", code: "stdout-without-exit" });
  assert.deepEqual(classifyToolResult(shell, { exitCode: 0 }), { status: "success", code: "exit-code-zero" });
  assert.deepEqual(classifyToolResult(shell, { exitCode: 1 }), { status: "failed", code: "exit-code-nonzero" });
  assert.deepEqual(classifyToolResult(shell, { errors: false }), { status: "unknown", code: "unclassified" });
  const patch = descriptorFor("apply_patch", { command: "*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch" });
  assert.deepEqual(classifyToolResult(patch, "Success. Updated the following files:\nA a.txt"), { status: "success", code: "patch-completed" });
  assert.deepEqual(classifyToolResult(patch, "Error: nothing to apply"), { status: "failed", code: "error-envelope" });
});

test("MCP and Computer Use envelopes classify transport completion only", () => {
  const linear = descriptorFor("mcp__linear__get_issue", { id: "NUTRI-346" });
  assert.deepEqual(classifyToolResult(linear, { content: [{ type: "text", text: "NUTRI-346 title" }] }), { status: "success", code: "content-observed" });
  assert.deepEqual(classifyToolResult(linear, { content: [{ type: "text", text: "boom" }], isError: true }), { status: "failed", code: "content-error" });
  assert.deepEqual(classifyToolResult(linear, { content: [{ type: "text", text: "Error: request rejected" }] }), { status: "failed", code: "content-error-envelope" });
  assert.deepEqual(classifyToolResult(linear, { content: [] }), { status: "unknown", code: "empty-content" });
  assert.deepEqual(classifyToolResult(linear, {}), { status: "unknown", code: "unclassified" });
  assert.deepEqual(classifyToolResult(linear, { isError: false }), { status: "unknown", code: "unclassified" });
  const computerUse = descriptorFor("mcp__cua_repl__js", { code: "return getState()" });
  assert.deepEqual(classifyToolResult(computerUse, { content: [{ type: "text", text: "surface inventory" }] }), { status: "success", code: "content-observed" });
  assert.equal(computerUse.effect, "opaque");
});

test("exact command tokenization retains its composition protections", () => {
  assert.deepEqual(tokenizeExactCommand("node 'cli.mjs' status"), ["node", "cli.mjs", "status"]);
  for (const composed of ["node x; rm -rf /", "node x && true", "node $(touch /tmp/no)", "node `x`", "node \"$HOME\""]) {
    assert.equal(tokenizeExactCommand(composed), null, composed);
  }
});

test("an unbound root observation is inert, never denied, and hands off to core passively", async (t) => {
  const home = await isolatedDirectory(t, "governance-adapters-home-");
  const root = await isolatedDirectory(t, "governance-adapters-root-");
  const transcript = join(home, "transcript.jsonl");
  await writeFile(transcript, [
    JSON.stringify({ type: "session_meta", payload: { id: "root-session" } }),
    JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1", model: "gpt-5.6-sol", cwd: root, effort: "high" } }),
  ].join("\n") + "\n");
  const event = {
    hook_event_name: "PreToolUse", session_id: "root-session", turn_id: "turn-1", tool_use_id: "use-1",
    model: "gpt-5.6-sol", cwd: root, transcript_path: transcript, tool_name: "Bash", tool_input: { command: "pwd" },
  };
  assert.deepEqual(await handleHook(event, { home }), {});
  const pending = Object.values((await readRegistry(home)).passiveTools ?? {}).filter((entry) => entry.capability === "shell");
  assert.equal(pending.length, 1, "PreToolUse records an unbound shell pair");
  assert.equal(pending[0].status, "pending");
  assert.equal(pending[0].effect, "external-write");

  assert.deepEqual(await handleHook({ ...event, hook_event_name: "PostToolUse", tool_response: pending[0].cwd + "\n" }, { home }), {});
  const completed = Object.values((await readRegistry(home)).passiveTools ?? {}).filter((entry) => entry.capability === "shell");
  assert.equal(completed.length, 1, "PostToolUse matches the exact PreToolUse pair");
  assert.equal(completed[0].status, "success");
  assert.equal(completed[0].observationLevel, "host-invocation");
});

test("an unbound unknown tool is inert and never recorded as available", async (t) => {
  const home = await isolatedDirectory(t, "governance-adapters-unknown-home-");
  const root = await isolatedDirectory(t, "governance-adapters-unknown-root-");
  const transcript = join(home, "transcript.jsonl");
  await writeFile(transcript, [
    JSON.stringify({ type: "session_meta", payload: { id: "root-session" } }),
    JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1", model: "gpt-5.6-sol", cwd: root, effort: "high" } }),
  ].join("\n") + "\n");
  const event = {
    hook_event_name: "PreToolUse", session_id: "root-session", turn_id: "turn-1", tool_use_id: "use-1",
    model: "gpt-5.6-sol", cwd: root, transcript_path: transcript, tool_name: "mcp__arbitrary__tool", tool_input: { anything: true },
  };
  assert.deepEqual(await handleHook(event, { home }), {});
  assert.deepEqual(Object.keys((await readRegistry(home)).passiveTools ?? {}), []);
});

/** Build the minimal valid control argv for a command in the shared grammar; a
 * command whose grammar needs more options is skipped rather than guessed.
 * @param {string} command @param {string} home @returns {string | null} */
function buildControlLine(command, home) {
  const quote = (value) => `'${value}'`;
  const candidates = [["--home", home], ["--home", home, "--input-json", "{}"], ["--home", home, "--input-json", "{}", "--boundary", "boundary-1"]];
  for (const options of candidates) {
    try { parseGovernanceArguments([command, ...options]); return [process.execPath, cli, command, ...options].map(quote).join(" "); }
    catch { continue; }
  }
  return null;
}

test("read-only control grammar is exempt while execute and foreign CLI paths never are", async (t) => {
  const home = await isolatedDirectory(t, "governance-adapters-control-");
  const other = await isolatedDirectory(t, "governance-adapters-other-");

  const readOnly = ["status", "help", "schema", "examples", "preflight"].filter((command) => GOVERNANCE_COMMANDS.includes(command));
  assert.ok(readOnly.includes("status"));
  for (const command of readOnly) {
    const line = buildControlLine(command, home);
    if (!line) continue;
    assert.equal(await isGovernanceControlCommand(line, { home }), true, command);
    assert.deepEqual(await handleHook({ hook_event_name: "PreToolUse", session_id: "unbound", cwd: home, tool_name: "Bash", tool_input: { command: line } }, { home }), {}, command);
    assert.equal(await isGovernanceControlCommand(line, { home: other }), false, `${command} foreign home`);
  }

  const execute = [process.execPath, cli, "execute", "--home", home, "--input-json", "{}"].map((value) => `'${value}'`).join(" ");
  assert.equal(await isGovernanceControlCommand(execute, { home }), false, "execute is never control-exempt");

  const foreign = [process.execPath, join(home, "fake-cli.mjs"), "status", "--home", home].map((value) => `'${value}'`).join(" ");
  assert.equal(await isGovernanceControlCommand(foreign, { home }), false, "foreign CLI path");

  const status = buildControlLine("status", home);
  assert.equal(await isGovernanceControlCommand(`${status}; touch /tmp/not-authorized`, { home }), false, "composition is never exempt");
});

test("governance diagnostics stay available while this session owns an active run", async (t) => {
  const home = await isolatedDirectory(t, "governance-adapters-active-");
  const root = await isolatedDirectory(t, "governance-adapters-active-root-");
  const registry = await readRegistry(home);
  registry.runs["active-run"] = { runId: "active-run", runDirectory: join(home, ".development-system/governance/runs/active-run"), rootSessionId: "active-session", root, finished: false };
  await writeRegistry(home, registry);
  for (const command of ["status", "help", "schema", "examples", "preflight"].filter((name) => GOVERNANCE_COMMANDS.includes(name))) {
    const line = buildControlLine(command, home);
    if (!line) continue;
    assert.deepEqual(await handleHook({ hook_event_name: "PreToolUse", session_id: "active-session", cwd: root, tool_name: "Bash", tool_input: { command: line } }, { home }), {}, command);
  }
});
