import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleHook, isGovernanceControlCommand, patchPaths, tokenizeExactCommand } from "../runtime/jev-governance/hook.mjs";
import { parseGovernanceArguments } from "../runtime/jev-governance/cli.mjs";
import { workerEnvironment } from "../runtime/jev-governance/opencode.mjs";
import { codexResultText, executeGuardedArgv } from "../runtime/jev-governance/executor.mjs";

const cli = fileURLToPath(new URL("../runtime/jev-governance/cli.mjs", import.meta.url));
const launcher = fileURLToPath(new URL("../runtime/jev-governance/hook-launcher.mjs", import.meta.url));

test("Codex role output keeps final multiline JSON distinct from progress and tool messages", () => {
  const plan = { kind: "plan", summary: "Inspect then edit the value", criterionIds: ["C1"], packets: [] };
  const events = [
    { type: "item.completed", item: { type: "agent_message", text: "I will inspect the inputs." } },
    { type: "item.completed", item: { type: "command_execution", aggregated_output: "not a role result" } },
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(plan, null, 2) } },
    { type: "turn.completed", usage: {} },
  ];
  assert.deepEqual(JSON.parse(codexResultText(events)), plan);
  assert.equal(codexResultText([]), "");
});

async function isolatedHome(t) {
  const home = await mkdtemp(join(tmpdir(), "governance-adapter-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

test("only exact installed governance control commands bypass ordinary permits", async (t) => {
  const home = await isolatedHome(t);
  const command = `node '${cli}' status --home '${home}' --json`;
  assert.equal(await isGovernanceControlCommand(command, { home }), true);
  for (const composed of [
    `${command}; touch /tmp/not-authorized`, `${command} && true`,
    `sh -c '${command}'`, `X=1 ${command}`, `${command} > /tmp/no`,
    `${command}\ntrue`, `node '${cli}' status --home '${home}' --endpoint fake`,
    `node '${cli}' execute --home '${home}' --input-json '{"attemptId":"a1"}'`,
  ]) {
    assert.equal(await isGovernanceControlCommand(composed, { home }), false, composed);
  }
});

test("literal inline JSON is usable without permitting shell evaluation", async (t) => {
  const home = await isolatedHome(t);
  const payload = '{"status":"blocked","reason":"literal ; $data is not executed","boundaryId":"stop"}';
  const command = `node '${cli}' close --home '${home}' --input-json '${payload}'`;
  assert.equal(await isGovernanceControlCommand(command, { home }), true);
  assert.equal(tokenizeExactCommand(command).at(-1), payload);
  for (const value of ['node "$(touch /tmp/no)"', 'node `touch /tmp/no`', 'node "$HOME"']) {
    assert.equal(tokenizeExactCommand(value), null, value);
  }
});

test("CLI rejects ambiguous input sources and traversal run IDs", () => {
  assert.throws(() => parseGovernanceArguments(["classify", "--input", "a.json", "--input-json", "{}"]));
  assert.throws(() => parseGovernanceArguments(["status", "--run", "../../escape"]));
});

test("patch scope includes both move endpoints and every add, update, delete", () => {
  assert.deepEqual(patchPaths("*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n@@\n-old\n+new\n*** Add File: c.txt\n+ok\n*** Delete File: d.txt\n*** End Patch"), ["a.txt", "b.txt", "c.txt", "d.txt"]);
});

test("an unrelated session is inert in an isolated home", async (t) => {
  const home = await isolatedHome(t);
  assert.deepEqual(await handleHook({ hook_event_name: "PreToolUse", session_id: "unrelated", tool_name: "Bash", tool_input: { command: "echo inert" } }, { home }), {});
});

test("the real launcher emits a host-readable denial for malformed input", async (t) => {
  const home = await isolatedHome(t);
  const malformed = spawnSync(process.execPath, [launcher, "--home", home], { input: "not JSON", encoding: "utf8", timeout: 9000 });
  assert.equal(malformed.error, undefined);
  assert.equal(malformed.status, 0);
  assert.equal(JSON.parse(malformed.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("workers retain normal environment but lose credentials, parent identity and injection options", () => {
  const env = workerEnvironment({ PATH: "/usr/bin", TYPESAFE_API_KEY: "fixture-only", TYPESAFE_ENV_FILE: "/private/file", JEV_SECRET: "fixture", CODEX_THREAD_ID: "parent", NODE_OPTIONS: "--eval" });
  assert.deepEqual(env, { PATH: "/usr/bin" });
});

test("an exited CLI's persistent child group is reaped without replacing the observed CLI exit status", { timeout: 12000, skip: process.platform === "win32" }, async (t) => {
  const home = await isolatedHome(t);
  const persistentChild = join(home, "persistent-child.mjs");
  const parent = join(home, "fixture-parent.mjs");
  await writeFile(persistentChild, `
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
process.send({ ready: true });
`);
  await writeFile(parent, `
import { spawn } from "node:child_process";
const child = spawn(process.execPath, [process.argv[2]], { detached: false, stdio: ["ignore", "ignore", "ignore", "ipc"] });
child.once("message", () => {
  process.stdout.write(JSON.stringify({ parentPid: process.pid, childPid: child.pid }));
  child.disconnect();
  child.unref();
  process.exitCode = 7;
});
`);
  let groupPid;
  t.after(() => {
    if (groupPid) {
      try { process.kill(-groupPid, "SIGKILL"); } catch {}
    }
  });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 9000);
  let result;
  try {
    result = await executeGuardedArgv({ executable: process.execPath, argv: [parent, persistentChild], cwd: home, env: {}, signal: controller.signal, onStart: async pid => { groupPid = pid; } });
  } finally {
    clearTimeout(deadline);
  }
  const observed = JSON.parse(result.stdout);
  assert.equal(result.pid, groupPid);
  assert.equal(observed.parentPid, groupPid);
  assert.ok(Number.isSafeInteger(observed.childPid) && observed.childPid > 0);
  assert.notEqual(observed.childPid, groupPid);
  assert.equal(result.exitCode, 7, "descendant cleanup must retain the CLI's nonzero exit");
  assert.equal(result.exitSignal, null);
  assert.equal(result.terminated, false, "normal post-exit cleanup is not caller cancellation");
  assert.equal(result.processGroupAlive, false);
  assert.throws(() => process.kill(-groupPid, 0), { code: "ESRCH" });
  assert.throws(() => process.kill(observed.childPid, 0), { code: "ESRCH" });
  groupPid = undefined;
  t.diagnostic("Native OS process simulation only; no provider invocation or metadata claim.");
});
