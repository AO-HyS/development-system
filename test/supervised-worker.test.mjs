import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runSupervisedWorker } from "../src/supervised-worker.mjs";
import { stopDetachedProcess } from "../src/bounded-process.mjs";

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "ds-worker-"));
  const databasePath = join(cwd, "state.sqlite");
  const threadId = "11111111-1111-4111-8111-111111111111";
  const turnId = "22222222-2222-4222-8222-222222222222";
  const sql = (statement) => execFileSync("sqlite3", [databasePath, statement]);
  sql(`CREATE TABLE projection_turns(thread_id TEXT,turn_id TEXT,state TEXT,completed_at TEXT); INSERT INTO projection_turns VALUES('${threadId}','${turnId}','running',NULL);`);
  return { sql, input: { cwd, owner: { databasePath, threadId, turnId }, command: process.execPath, args: [], outputDirectory: join(cwd, "attempt") } };
}

test("worker retains a failing process exit and writes a terminal receipt", async () => {
  const { input } = await fixture();
  input.args = ["-e", "console.error('check failed'); process.exit(7)"];
  const result = await runSupervisedWorker(input);
  assert.equal(result.status, 7);
  assert.equal(result.completed, false);
  assert.equal(result.ok, false);
  assert.match(await readFile(join(input.outputDirectory, "stderr.log"), "utf8"), /check failed/u);
  assert.equal(JSON.parse(await readFile(join(input.outputDirectory, "result.json"), "utf8")).status, 7);
});

test("CLI propagates a failed child instead of returning success", async () => {
  const { input } = await fixture();
  input.args = ["-e", "process.exit(7)"];
  const packet = join(input.cwd, "packet.json");
  await writeFile(packet, JSON.stringify(input));
  assert.throws(() => execFileSync(process.execPath, ["bin/development-system.mjs", "run-worker", "--input", packet, "--json"], { stdio: "pipe" }), { status: 1 });
});

test("group cancellation also kills a grandchild that ignores TERM", async () => {
  const { input } = await fixture();
  const pidFile = join(input.cwd, "grandchild.pid");
  const grandchild = "require('node:fs').writeFileSync(process.argv[1],String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)";
  const child = spawn(process.execPath, ["-e", `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)},${JSON.stringify(pidFile)}],{stdio:'ignore'}); setInterval(()=>{},1000)`], { detached: true, stdio: "ignore" });
  let pid;
  try {
    for (let i = 0; i < 100; i++) {
      try { pid = Number(await readFile(pidFile, "utf8")); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.ok(pid);
    await stopDetachedProcess(child, 200);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already stopped. */ }
  }
});

test("interrupting its T3 turn terminates the worker instead of orphaning it", async () => {
  const { input, sql } = await fixture();
  input.args = ["-e", "setInterval(()=>{},1000)"];
  const timer = setTimeout(() => sql("UPDATE projection_turns SET state='interrupted', completed_at='2026-09-07T00:00:00Z'"), 150);
  try {
    const result = await runSupervisedWorker(input);
    assert.equal(result.stopReason, "owning-turn-ended");
    assert.equal(result.completed, false);
    assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
  } finally { clearTimeout(timer); }
});

test("a stopped or unavailable owner cannot start a new worker", async () => {
  const { input, sql } = await fixture();
  sql("UPDATE projection_turns SET state='interrupted'");
  await assert.rejects(runSupervisedWorker(input), /not running/u);
  input.owner.threadId = "invalid'";
  await assert.rejects(runSupervisedWorker(input), /UUID/u);
});
