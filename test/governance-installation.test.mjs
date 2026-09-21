import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { auditGovernanceHooks, enableGovernanceHooks, rollbackGovernanceHooks, withGovernanceHookRollback } from "../src/governance-installation.mjs";

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
