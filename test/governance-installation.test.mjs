import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { applyAdvisoryHookTransition, auditGovernanceHooks, enableGovernanceHooks, prepareAdvisoryHookTransition, restoreAdvisoryHookTransition, rollbackGovernanceHooks, withGovernanceHookRollback } from "../src/governance-installation.mjs";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "governance-installation-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const engine = join(home, ".codex/development-system/governance-runtime/hook-launcher.mjs");
  await mkdir(dirname(engine), { recursive: true });
  await writeFile(engine, "// Isolated installation fixture; never run.\n");
  return { home, engine, hooks: join(home, ".codex/hooks.json") };
}

test("installation preserves unrelated hook handlers, is idempotent, and rolls back exact prior bytes", async (t) => {
  const { home, hooks } = await fixture(t);
  const previous = JSON.stringify({ description: "operator hooks", hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [
      { type: "command", command: "node existing-guard.mjs" },
      { type: "command", command: "AOHYS_JEV_GOVERNANCE=1 node old-managed.mjs" },
    ] }],
    PostToolUse: [{ matcher: "apply_patch", hooks: [{ type: "command", command: "node impeccable.mjs" }] }],
  } }, null, 4) + "\n";
  await writeFile(hooks, previous);
  const first = await enableGovernanceHooks({ home });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.operationalEnforcement, "not-established-by-installation");
  const installed = JSON.parse(await readFile(hooks, "utf8"));
  assert.equal(installed.description, "operator hooks");
  assert.equal(installed.hooks.PreToolUse[0].hooks[0].command, "node existing-guard.mjs");
  assert.equal(installed.hooks.PreToolUse[0].hooks.length, 1);
  assert.equal(installed.hooks.PostToolUse[0].hooks[0].command, "node impeccable.mjs");
  assert.equal(installed.hooks.Interrupt[0].hooks[0].timeout, 3);
  assert.equal((await enableGovernanceHooks({ home })).changed, false);
  assert.equal((await auditGovernanceHooks({ home })).ok, true);
  await rollbackGovernanceHooks({ home });
  assert.equal(await readFile(hooks, "utf8"), previous);
});

test("missing runtime leaves existing hooks intact", async (t) => {
  const { home, engine, hooks } = await fixture(t);
  const previous = '{"hooks":{}}\n';
  await writeFile(hooks, previous);
  await rm(engine);
  await assert.rejects(enableGovernanceHooks({ home }));
  assert.equal(await readFile(hooks, "utf8"), previous);
});

test("rollback refuses to erase later operator hook changes", async (t) => {
  const { home, hooks } = await fixture(t);
  await enableGovernanceHooks({ home });
  const config = JSON.parse(await readFile(hooks, "utf8"));
  config.description = "later unrelated operator change";
  const changed = JSON.stringify(config);
  await writeFile(hooks, changed);
  await assert.rejects(rollbackGovernanceHooks({ home }), /changed after installation/);
  assert.equal(await readFile(hooks, "utf8"), changed);
});

test("installation refuses a symlink instead of writing outside the isolated home", async (t) => {
  const { home, hooks } = await fixture(t);
  const target = join(home, "operator-owned.json");
  await writeFile(target, '{"operator":"preserve"}');
  await symlink(target, hooks);
  await assert.rejects(enableGovernanceHooks({ home }), /symbolic link/);
  assert.equal(await readFile(target, "utf8"), '{"operator":"preserve"}');
});

test("failed contract rollback restores the installed hooks and recovery snapshot", async (t) => {
  const { home, hooks } = await fixture(t);
  await enableGovernanceHooks({ home });
  const statePath = join(home, ".development-system/governance-hooks.json");
  const before = await readFile(hooks, "utf8");
  const state = await readFile(statePath, "utf8");
  await assert.rejects(withGovernanceHookRollback({ home, rollback: async () => {
    await assert.rejects(readFile(hooks), { code: "ENOENT" });
    throw new Error("Missing contract recovery snapshot");
  } }), /Missing contract recovery snapshot/);
  assert.equal(await readFile(hooks, "utf8"), before);
  assert.equal(await readFile(statePath, "utf8"), state);
  assert.equal((await auditGovernanceHooks({ home })).ok, true);
});

test("advisory transition removes only managed handlers and restores exact prior bytes", async (t) => {
  const { home, hooks } = await fixture(t);
  const before = '{"description":"operator","hooks":{"PreToolUse":[{"matcher":"Bash","custom":true,"hooks":[{"type":"command","command":"node existing.mjs"},{"type":"command","command":"AOHYS_JEV_GOVERNANCE=1 node managed.mjs"}]}],"Stop":[{"hooks":[{"type":"command","command":"AOHYS_JEV_GOVERNANCE=1 node managed.mjs"}]}]}}\n';
  await writeFile(hooks, before);
  const transition = await prepareAdvisoryHookTransition({ home });
  assert.equal(transition.changed, true);
  assert.equal(transition.removed, 2);
  await applyAdvisoryHookTransition({ home, ...transition });
  const after = JSON.parse(await readFile(hooks, "utf8"));
  assert.equal(after.description, "operator");
  assert.equal(after.hooks.PreToolUse[0].custom, true);
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "node existing.mjs");
  assert.deepEqual(after.hooks.Stop, []);
  assert.equal((await prepareAdvisoryHookTransition({ home })).changed, false);
  await restoreAdvisoryHookTransition({ home, expected: transition.after, restore: transition.before });
  assert.equal(await readFile(hooks, "utf8"), before);
});

test("advisory transition preserves hook bytes when no managed handler exists", async (t) => {
  const { home, hooks } = await fixture(t);
  const before = '{ "hooks": { "Stop": [{"hooks":[{"type":"command","command":"node own.mjs"}]}] } }\n';
  await writeFile(hooks, before);
  const transition = await prepareAdvisoryHookTransition({ home });
  assert.equal(transition.changed, false);
  await applyAdvisoryHookTransition({ home, ...transition });
  assert.equal(await readFile(hooks, "utf8"), before);
});

test("advisory transition preflights malformed and symlinked hooks", async (t) => {
  const { home, hooks } = await fixture(t);
  await writeFile(hooks, '{"hooks":{"Stop":{}}}');
  await assert.rejects(prepareAdvisoryHookTransition({ home }), /Malformed hook list/);
  await rm(hooks);
  const target = join(home, "outside.json");
  await writeFile(target, '{"hooks":{}}');
  await symlink(target, hooks);
  await assert.rejects(prepareAdvisoryHookTransition({ home }), /symbolic link/);
  assert.equal(await readFile(target, "utf8"), '{"hooks":{}}');
});

test("advisory rollback refuses drift without replacing operator hooks", async (t) => {
  const { home, hooks } = await fixture(t);
  await writeFile(hooks, '{"hooks":{"Stop":[{"hooks":[{"command":"AOHYS_JEV_GOVERNANCE=1 node managed.mjs"}]}]}}');
  const transition = await prepareAdvisoryHookTransition({ home });
  await applyAdvisoryHookTransition({ home, ...transition });
  await writeFile(hooks, '{"operator":"new"}');
  await assert.rejects(restoreAdvisoryHookTransition({ home, expected: transition.after, restore: transition.before }), /changed after installation/);
  assert.equal(await readFile(hooks, "utf8"), '{"operator":"new"}');
});

test("advisory hook audit reports disabled and explicit hook enable is rejected", async (t) => {
  const { home, hooks } = await fixture(t);
  const manifestPath = join(home, ".development-system/installed-manifest.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ contractVersion: "1.29.0", executionMode: "advisory-parent-execution" }));
  await writeFile(hooks, '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node own.mjs"}]}]}}');
  const audit = await auditGovernanceHooks({ home });
  assert.equal(audit.ok, true);
  assert.equal(audit.status, "disabled");
  await assert.rejects(enableGovernanceHooks({ home }), /Advisory mode/);
  assert.equal(await readFile(hooks, "utf8"), '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node own.mjs"}]}]}}');
});

test("advisory transition includes the governed recovery state in its rollback receipt", async (t) => {
  const { home, hooks } = await fixture(t);
  await enableGovernanceHooks({ home });
  const statePath = join(home, ".development-system/governance-hooks.json");
  const previousHooks = await readFile(hooks, "utf8");
  const previousState = await readFile(statePath, "utf8");
  const transition = await prepareAdvisoryHookTransition({ home });
  assert.equal(transition.before.state, previousState);
  assert.equal(transition.after.state, previousState);
  await applyAdvisoryHookTransition({ home, ...transition });
  assert.equal(await readFile(statePath, "utf8"), previousState);
  await restoreAdvisoryHookTransition({ home, expected: transition.after, restore: transition.before });
  assert.equal(await readFile(hooks, "utf8"), previousHooks);
  assert.equal(await readFile(statePath, "utf8"), previousState);
});

test("advisory transition removes marker handlers despite malformed stale state and preserves empty unrelated groups", async (t) => {
  const { home, hooks } = await fixture(t);
  const recovery = join(home, ".development-system/governance-hooks.json");
  await mkdir(dirname(recovery), { recursive: true });
  const stateBytes = '{stale malformed recovery bytes}\n';
  await writeFile(recovery, stateBytes);
  const prior = JSON.stringify({ description: "operator", hooks: {
    Stop: [
      { matcher: "operator-empty", note: "keep", hooks: [] },
      { matcher: "managed-only", hooks: [{ command: "AOHYS_JEV_GOVERNANCE=1 node old.mjs" }] },
      { matcher: "operator", hooks: [{ command: "node own.mjs" }] },
    ],
    Interrupt: [],
  } }, null, 4) + "\n";
  await writeFile(hooks, prior);
  const transition = await prepareAdvisoryHookTransition({ home });
  assert.equal(transition.removed, 1);
  assert.equal(transition.before.state, stateBytes);
  assert.equal(transition.after.state, stateBytes);
  await applyAdvisoryHookTransition({ home, ...transition });
  const after = JSON.parse(await readFile(hooks, "utf8"));
  assert.equal(after.description, "operator");
  assert.deepEqual(after.hooks.Stop.map((group) => group.matcher), ["operator-empty", "operator"]);
  assert.deepEqual(after.hooks.Stop[0].hooks, []);
  assert.deepEqual(after.hooks.Interrupt, []);
  assert.equal(await readFile(recovery, "utf8"), stateBytes);
  await restoreAdvisoryHookTransition({ home, expected: transition.after, restore: transition.before });
  assert.equal(await readFile(hooks, "utf8"), prior);
  assert.equal(await readFile(recovery, "utf8"), stateBytes);
});
