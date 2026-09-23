import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, rename, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withLock, readRegistry, writeRegistry, writeSnapshot, readSnapshot } from "../runtime/jev-governance/store.mjs";
import { handleHook } from "../runtime/jev-governance/hook.mjs";
import { enableGovernanceHooks } from "../src/governance-installation.mjs";

const source = new URL("../runtime/jev-governance/store.mjs", import.meta.url).href;
const launcher = fileURLToPath(new URL("../runtime/jev-governance/hook-launcher.mjs", import.meta.url));
const worker = `
import { withLock } from ${JSON.stringify(source)};
import { open, readFile, writeFile, unlink } from 'node:fs/promises';
const [path, mode] = process.argv.slice(1);
try {
  await withLock(path, async () => {
    process.send({ held: true, pid: process.pid });
    if (mode === 'exit') process.exit(0);
    if (mode === 'hold') await new Promise(resolve => process.once('message', resolve));
    if (mode === 'counter') {
      const gate = await open(path + '.active', 'wx');
      try {
        let count = 0;
        try { count = Number(await readFile(path + '.counter', 'utf8')); } catch {}
        await new Promise(resolve => setTimeout(resolve, 25));
        await writeFile(path + '.counter', String(count + 1));
      } finally { await gate.close(); await unlink(path + '.active'); }
    }
  }, { waitMs: mode === 'probe' ? 120 : 5000, retryMs: 5 });
  process.disconnect();
} catch (error) {
  process.stderr.write(String(error.code ?? error));
  process.exit(2);
}
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "governance-lock-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, path: join(root, "registry.lock") };
}

function child(t, path, mode = "hold") {
  const processChild = spawn(process.execPath, ["--input-type=module", "-e", worker, path, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  processChild.stderr.on("data", bytes => { stderr += bytes; });
  const done = new Promise((resolve, reject) => {
    processChild.once("error", reject);
    processChild.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
  const ready = new Promise((resolve, reject) => {
    processChild.once("message", resolve);
    processChild.once("error", reject);
    processChild.once("exit", () => reject(new Error(`Worker exited before ownership: ${stderr}`)));
  });
  // Probe contenders deliberately exit without acquiring.
  ready.catch(() => {});
  t.after(async () => {
    if (processChild.exitCode === null && processChild.signalCode === null) processChild.kill("SIGKILL");
    await done;
  });
  return { process: processChild, ready, done };
}

async function deadPid(t, path) {
  const owner = child(t, path, "exit");
  await owner.ready;
  assert.equal((await owner.done).code, 0);
  return owner.process.pid;
}

async function archivedBytes(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await archivedBytes(path));
    else if (entry.isFile() && entry.name === "orphan.lock" && basename(directory).startsWith("recovery-")) {
      const receipt = JSON.parse(await readFile(join(directory, "recovered.json"), "utf8"));
      assert.equal(receipt.state, "recovered");
      found.push(await readFile(path));
    }
  }
  return found;
}

test("SIGKILL of a real owner recovers automatically and preserves its exact lock bytes", { timeout: 12000 }, async t => {
  const { root, path } = await fixture(t);
  const owner = child(t, path);
  await owner.ready;
  const before = await readFile(path);
  owner.process.kill("SIGKILL");
  assert.equal((await owner.done).signal, "SIGKILL");
  assert.equal(await withLock(path, async () => "recovered"), "recovered");
  assert.ok((await archivedBytes(root)).some(bytes => bytes.equals(before)), "Original owner record must be retained byte-for-byte");
});

test("process.exit skipping finally does not permanently block the next action", { timeout: 12000 }, async t => {
  const { path } = await fixture(t);
  await deadPid(t, path);
  assert.equal(await withLock(path, async () => 42), 42);
});

test("normal success and action errors both release ownership", async t => {
  const { path } = await fixture(t);
  await assert.rejects(withLock(path, async () => { throw new Error("action failed"); }), /action failed/);
  assert.equal(await withLock(path, async () => "next"), "next");
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("a living legacy owner is never stolen, regardless of age", async t => {
  const { path } = await fixture(t);
  const bytes = JSON.stringify({ pid: process.pid, acquiredAt: "2000-01-01T00:00:00.000Z" });
  await writeFile(path, bytes);
  let executed = false;
  await assert.rejects(withLock(path, async () => { executed = true; }, { waitMs: 80, retryMs: 5 }));
  assert.equal(executed, false);
  assert.equal(await readFile(path, "utf8"), bytes);
});

test("a dead legacy owner is archived and recovered without requiring a new-format record", { timeout: 12000 }, async t => {
  const { root, path } = await fixture(t);
  const pid = await deadPid(t, join(root, "other.lock"));
  const bytes = Buffer.from(JSON.stringify({ pid, acquiredAt: new Date().toISOString() }) + "\n");
  await writeFile(path, bytes);
  assert.equal(await withLock(path, async () => "legacy recovered"), "legacy recovered");
  assert.ok((await archivedBytes(root)).some(value => value.equals(bytes)));
});

test("malformed and empty legacy locks remain unchanged and never execute work", async t => {
  const { root } = await fixture(t);
  for (const [index, bytes] of ["", "not-json", '{"pid":-1}', '{"pid":0}', '{"pid":"123"}'].entries()) {
    const path = join(root, `unknown-${index}.lock`);
    await writeFile(path, bytes);
    let executed = false;
    await assert.rejects(withLock(path, async () => { executed = true; }, { waitMs: 30, retryMs: 5 }), { code: "lock-unknown" });
    assert.equal(executed, false);
    assert.equal(await readFile(path, "utf8"), bytes);
  }
});

test("a symlink lock cannot read or alter its target", async t => {
  const { root, path } = await fixture(t);
  const target = join(root, "operator-file");
  await writeFile(target, "preserve");
  await symlink(target, path);
  let executed = false;
  await assert.rejects(withLock(path, async () => { executed = true; }, { waitMs: 30 }), { code: "lock-unknown" });
  assert.equal(executed, false);
  assert.equal(await readFile(target, "utf8"), "preserve");
});

test("simultaneous recovery by independent processes preserves exclusion and every update", { timeout: 15000 }, async t => {
  const { path } = await fixture(t);
  await deadPid(t, path);
  const contenders = Array.from({ length: 8 }, () => child(t, path, "counter"));
  const results = await Promise.all(contenders.map(value => value.done));
  assert.deepEqual(results.map(value => value.code), Array(8).fill(0), JSON.stringify(results));
  assert.equal(await readFile(path + ".counter", "utf8"), "8");
});

test("first-ever same-process initialization and losing connection closure retain cross-process exclusion", { timeout: 15000 }, async t => {
  const { path } = await fixture(t);
  let active = 0;
  await Promise.all(Array.from({ length: 6 }, () => withLock(path, async () => {
    assert.equal(++active, 1, "Fresh database initialization must serialize concurrent callers");
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
  })));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const holder = withLock(path, async () => { entered(); await gate; });
  await ready;
  let stolen = false;
  const loser = withLock(path, async () => { stolen = true; }, { waitMs: 100, retryMs: 5 });
  const rejected = assert.rejects(loser, { code: "lock-timeout" });
  try {
    await rejected;
    assert.equal(stolen, false);
    const third = child(t, path, "probe");
    assert.equal((await third.done).code, 2, "Closing a losing SQLite connection must not release the holder's OS lock");
  } finally { release(); await holder; }
  assert.equal(await withLock(path, async () => "released"), "released");
});

test("cleanup preserves a replacement lock instead of deleting another owner", async t => {
  const { root, path } = await fixture(t);
  const replacement = JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() });
  await assert.rejects(withLock(path, async () => {
    await rename(path, join(root, "original-owner"));
    await writeFile(path, replacement);
  }));
  assert.equal(await readFile(path, "utf8"), replacement);
});

test("legacy permission uncertainty cannot be mistaken for process death", async t => {
  const { path } = await fixture(t);
  const bytes = JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() });
  await writeFile(path, bytes);
  t.mock.method(process, "kill", () => { throw Object.assign(new Error("fixture permission denied"), { code: "EPERM" }); });
  let executed = false;
  await assert.rejects(withLock(path, async () => { executed = true; }, { waitMs: 30 }), { code: "lock-unknown" });
  assert.equal(executed, false);
  assert.equal(await readFile(path, "utf8"), bytes);
});

test("matching v2 mutex authority recovers after PID reuse without relying on age", { timeout: 12000 }, async t => {
  const { path } = await fixture(t);
  await deadPid(t, path);
  const record = JSON.parse(await readFile(path, "utf8"));
  record.pid = process.pid;
  await writeFile(path, JSON.stringify(record));
  assert.equal(await withLock(path, async () => "recovered"), "recovered");
});

test("a v2 record bound to a different mutex identity cannot authorize recovery", { timeout: 12000 }, async t => {
  const { path } = await fixture(t);
  await deadPid(t, path);
  const record = JSON.parse(await readFile(path, "utf8"));
  record.mutexIno = String(BigInt(record.mutexIno) + 1n);
  const bytes = JSON.stringify(record);
  await writeFile(path, bytes);
  let executed = false;
  await assert.rejects(withLock(path, async () => { executed = true; }, { waitMs: 30 }), { code: "lock-unknown" });
  assert.equal(executed, false);
  assert.equal(await readFile(path, "utf8"), bytes);
});

test("mutex directory symlinks are rejected without creating a database in the target", async t => {
  const { root, path } = await fixture(t);
  const target = join(root, "unrelated");
  await mkdir(target);
  await symlink(target, path + ".mutex");
  let executed = false;
  await assert.rejects(withLock(path, async () => { executed = true; }), { code: "lock-unknown" });
  assert.equal(executed, false);
  assert.deepEqual(await readdir(target), []);
});

async function injectedExit(path, operation, after, code) {
  const program = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs[${JSON.stringify(operation)}];
    fs[${JSON.stringify(operation)}] = async (...args) => {
      const matches = ${operation === "rename" ? `args[0] === ${JSON.stringify(path)} && String(args[1]).endsWith('/orphan.lock')` : `args[1] === ${JSON.stringify(path)}`};
      if (matches && !${after}) process.exit(${code});
      const result = await original(...args);
      if (matches && ${after}) process.exit(${code});
      return result;
    };
    syncBuiltinESMExports();
    const { withLock } = await import(${JSON.stringify(source)});
    await withLock(${JSON.stringify(path)}, async () => {});
  `;
  const processChild = spawn(process.execPath, ["--input-type=module", "-e", program], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  processChild.stderr.on("data", value => { stderr += value; });
  const exit = await new Promise(resolve => processChild.once("close", resolve));
  assert.equal(exit, code, `The fault must reach the actual filesystem boundary: ${stderr}`);
}

test("process exit immediately after orphan archival resumes recovery automatically", { timeout: 12000 }, async t => {
  const { root, path } = await fixture(t);
  await deadPid(t, path);
  const original = await readFile(path);
  await injectedExit(path, "rename", true, 65);
  assert.equal(await withLock(path, async () => "resumed"), "resumed");
  assert.ok((await archivedBytes(root)).some(bytes => bytes.equals(original)));
});

test("process exit immediately before owner publication leaves no blocking partial record", { timeout: 12000 }, async t => {
  const { path } = await fixture(t);
  await injectedExit(path, "link", false, 66);
  assert.equal(await withLock(path, async () => "next"), "next");
});

test("Stop continuation recovers its orphan lock while retaining the incomplete run", { timeout: 12000 }, async t => {
  const { root } = await fixture(t);
  const home = join(root, "home");
  const runDirectory = join(home, ".development-system", "governance", "runs", "pending");
  await mkdir(runDirectory, { recursive: true });
  const run = { schemaVersion: 1, runId: "pending", root, rootSessionId: "pending-session", phase: "research", outcome: null, attempts: [], leases: {}, judgments: [], plans: [], reviews: [], evidence: [] };
  await writeSnapshot(join(runDirectory, "run.json"), { schemaVersion: 1, run });
  await writeRegistry(home, { revision: 0, sessions: {}, runs: { pending: { runId: "pending", root, rootSessionId: "pending-session", runDirectory, finished: false } } });
  await deadPid(t, join(runDirectory, ".adapter-stop.lock"));
  const result = await handleHook({ hook_event_name: "Stop", session_id: "pending-session" }, { home });
  assert.equal(result.decision, "block");
  assert.match(result.reason, /governed run is incomplete/);
  assert.equal(JSON.parse(await readFile(join(runDirectory, ".adapter-stop.json"), "utf8")).count, 1);
  assert.deepEqual((await readSnapshot(join(runDirectory, "run.json"), "retained run")).run, run);
});

test("real hook launcher recovers a legacy orphan and preserves unrelated runs and active leases", { timeout: 15000 }, async t => {
  const { root } = await fixture(t);
  const home = join(root, "home");
  const governance = join(home, ".development-system", "governance");
  const runDirectory = join(governance, "runs", "retained");
  await mkdir(runDirectory, { recursive: true });
  const retained = { schemaVersion: 1, run: { schemaVersion: 1, runId: "retained", root, rootSessionId: "other-session", phase: "implementation", attempts: [{ id: "prior", status: "running" }], leases: { "product.txt": "prior" }, events: [{ type: "retain-history" }] } };
  await writeSnapshot(join(runDirectory, "run.json"), retained);
  await writeRegistry(home, { revision: 0, sessions: {}, runs: { retained: { runId: "retained", root, rootSessionId: "other-session", runDirectory, finished: false } } });
  const priorRun = await readFile(join(runDirectory, "run.json"));
  const pid = await deadPid(t, join(root, "terminated.lock"));
  await writeFile(join(governance, "registry.lock"), JSON.stringify({ pid, acquiredAt: new Date().toISOString() }));
  const transcript = join(root, "synthetic-metadata.jsonl");
  await writeFile(transcript, [
    { type: "session_meta", payload: { id: "recovery-fixture" } },
    { type: "turn_context", payload: { turn_id: "fixture-turn", model: "fixture-model", cwd: root, effort: "high" } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
  const event = { hook_event_name: "SessionStart", session_id: "recovery-fixture", turn_id: "fixture-turn", model: "fixture-model", cwd: root, transcript_path: transcript };
  const result = spawn(process.execPath, [launcher, "--home", home], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  result.stdout.on("data", value => { stdout += value; });
  result.stderr.on("data", value => { stderr += value; });
  const exit = new Promise(resolve => result.once("close", resolve));
  result.stdin.end(JSON.stringify(event));
  assert.equal(await exit, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {});
  const registry = await readRegistry(home);
  assert.ok(registry.sessions["recovery-fixture"], "Session registration must actually progress after recovery");
  assert.deepEqual(registry.runs.retained, { runId: "retained", root, rootSessionId: "other-session", runDirectory, finished: false });
  assert.deepEqual(await readFile(join(runDirectory, "run.json")), priorRun);
  assert.deepEqual(await readSnapshot(join(runDirectory, "run.json"), "retained"), retained);
  t.diagnostic("Synthetic host metadata in an isolated HOME; real launcher and filesystem behavior, not production identity certification.");
});

test("installed hooks execute the validated Node even when PATH resolves an incompatible node", { timeout: 12000, skip: process.platform === "win32" }, async t => {
  const { root } = await fixture(t);
  const home = join(root, "home");
  const engine = join(home, ".codex", "development-system", "governance-runtime", "hook-launcher.mjs");
  await mkdir(join(engine, ".."), { recursive: true });
  await writeFile(engine, "process.stdout.write(JSON.stringify({runtime:process.execPath}));\n");
  await enableGovernanceHooks({ home });
  const config = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
  const command = config.hooks.PreToolUse.at(-1).hooks[0].command;
  const fakeBin = join(root, "bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "node"), "#!/bin/sh\nexit 91\n");
  await chmod(join(fakeBin, "node"), 0o700);
  const processChild = spawn("/bin/sh", ["-c", command], { env: { ...process.env, PATH: fakeBin }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  processChild.stdout.on("data", value => { stdout += value; });
  processChild.stderr.on("data", value => { stderr += value; });
  const code = await new Promise(resolve => processChild.once("close", resolve));
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).runtime, process.execPath);
});
