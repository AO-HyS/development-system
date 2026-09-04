import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const installer = resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/scripts/install.mjs");
const adapterScripts = resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/scripts");
const upstreamSource = resolve(root, "artifacts/1.5.17/skills/upstream/install-anti-slop");

/** @param {string} cwd @param {string[]} args @returns {{status: number, stdout: string, stderr: string}} */
function runInstaller(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [installer, ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  }
}

/** @param {string} cwd @param {string[]} args */
function runUpstream(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [resolve(upstreamSource, "scripts/install.mjs"), ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  }
}

async function tempRepository() {
  return mkdtemp(resolve(tmpdir(), "aohys-anti-slop-install-"));
}

test("the internal adapter keeps pristine upstream assets and one contained executable entrypoint", async () => {
  // Every upstream asset file stays byte-identical; only SKILL.md is adapted.
  const upstreamFiles = await readdir(upstreamSource, { recursive: true, withFileTypes: true });
  for (const entry of upstreamFiles) {
    if (!entry.isFile()) continue;
    const relativePath = resolve(entry.parentPath, entry.name).slice(upstreamSource.length + 1);
    if (relativePath === "SKILL.md" || relativePath === "scripts/install.mjs") continue;
    const pristine = await readFile(resolve(upstreamSource, relativePath));
    const adapted = await readFile(resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop", relativePath));
    assert.equal(adapted.equals(pristine), true, `${relativePath} must stay byte-identical to upstream`);
  }
  const adaptedSkill = await readFile(resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/SKILL.md"), "utf8");
  assert.match(adaptedSkill, /^name: install-anti-slop$/m);
  assert.match(adaptedSkill, /scripts\/install\.mjs/);
  assert.match(adaptedSkill, /absolute destinations/);
  assert.match(adaptedSkill, /parent \(`\.\.`\) path segments|parent traversal/i);
  assert.match(adaptedSkill, /symbolic link/);
  assert.match(adaptedSkill, /even with `--force`/);
  assert.match(adaptedSkill, /never authorizes writing through a symlink/i);
  // The conventional entrypoint is the contained implementation: it is not a
  // byte-identical copy of the unsafe upstream installer, and the adapter
  // contains no other executable that could bypass containment.
  const upstreamInstaller = await readFile(resolve(upstreamSource, "scripts/install.mjs"), "utf8");
  const containedInstaller = await readFile(installer, "utf8");
  assert.notEqual(containedInstaller, upstreamInstaller);
  assert.match(containedInstaller, /symbolic link ancestor/);
  assert.match(containedInstaller, /existing symbolic link; --force never authorizes writing through a link/);
  assert.doesNotMatch(containedInstaller, /removeTree/);
  const license = await readFile(resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/LICENSE"), "utf8");
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Dillon Mulroy\n/);
  assert.equal(createHash("sha256").update(license).digest("hex"), "10ed33bf340d6d63dc0633dfc917a346b369b6aa41fe20734aefc6a3fb75ba17");
  const scriptEntries = await readdir(adapterScripts, { withFileTypes: true });
  assert.deepEqual(scriptEntries.map((entry) => entry.name).sort(), ["install.mjs"]);
  const installerStatus = await (await import("node:fs/promises")).lstat(installer);
  assert.equal((installerStatus.mode & 0o111) !== 0, true, "the contained installer stays executable");
});

test("the contained installer performs a default install and refuses an existing destination without --force", async () => {
  const repository = await tempRepository();
  const first = runInstaller(repository, []);
  assert.equal(first.status, 0, `${first.stderr}\n${first.stdout}`);
  const copied = await readFile(resolve(repository, "tools/oxlint/anti-slop/index.ts"), "utf8");
  assert.match(copied, /anti-slop/);
  assert.equal(
    await readFile(resolve(repository, "tools/oxlint/anti-slop/LICENSE"), "utf8"),
    await readFile(resolve(root, "artifacts/1.5.17/skills/internal/install-anti-slop/LICENSE"), "utf8"),
  );
  const second = runInstaller(repository, []);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /Refusing to overwrite/);
  await writeFile(resolve(repository, "tools/oxlint/anti-slop/local-before-force.txt"), "recover me\n");
  const forced = runInstaller(repository, ["--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /Retained the previous destination for recovery at/);
  assert.equal((await readFile(resolve(repository, "tools/oxlint/anti-slop/index.ts"), "utf8")), copied);
  const backup = (await readdir(resolve(repository, "tools/oxlint"))).find((entry) => entry.startsWith(".anti-slop.aohys-backup-"));
  assert.ok(backup, "forced replacement retains one recoverable backup");
  assert.equal(await readFile(resolve(repository, "tools/oxlint", backup, "local-before-force.txt"), "utf8"), "recover me\n");
  await rm(repository, { recursive: true, force: true });
});

test("a substituted private stage is rejected by held device/inode identity and never cleaned by path", async () => {
  const repository = await tempRepository();
  const barrier = resolve(repository, "installer-race");
  const child = spawn(process.execPath, [installer, "race-target"], {
    cwd: repository,
    env: { ...process.env, AOHYS_ANTI_SLOP_TEST_BARRIER: barrier },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      await readFile(`${barrier}.ready`);
      break;
    } catch {
      await delay(10);
    }
  }
  assert.equal(Date.now() < deadline, true, "installer reached deterministic race barrier");
  const stageName = (await readdir(repository)).find((entry) => entry.startsWith(".race-target.aohys-stage-"));
  assert.ok(stageName, "private stage name is visible only to inject the deterministic race");
  const heldOriginal = resolve(repository, ".held-original-stage");
  await rename(resolve(repository, stageName), heldOriginal);
  await mkdir(resolve(repository, stageName));
  await writeFile(resolve(repository, stageName, "attacker-marker.txt"), "must survive\n");
  await writeFile(`${barrier}.go`, "go\n", { mode: 0o600 });
  const status = await new Promise((resolveStatus) => child.on("close", (code) => resolveStatus(code)));
  assert.notEqual(status, 0, `${stdout}\n${stderr}`);
  assert.match(stderr, /private staging directory identity changed before placement/);
  await assert.rejects(readFile(resolve(repository, "race-target/index.ts")));
  assert.equal(await readFile(resolve(repository, stageName, "attacker-marker.txt"), "utf8"), "must survive\n");
  assert.match(await readFile(resolve(heldOriginal, "index.ts"), "utf8"), /anti-slop/);
  await rm(repository, { recursive: true, force: true });
});

test("a newly created destination ancestor cannot be substituted outside the repository", async () => {
  const repository = await tempRepository();
  const barrier = resolve(repository, "ancestor-race");
  const external = await tempRepository();
  const child = spawn(process.execPath, [installer, "new-parent/anti-slop"], {
    cwd: repository,
    env: { ...process.env, AOHYS_ANTI_SLOP_TEST_BARRIER: barrier },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      await readFile(`${barrier}.ready`);
      break;
    } catch {
      await delay(10);
    }
  }
  assert.equal(Date.now() < deadline, true, "installer reached deterministic ancestor race barrier");
  await rename(resolve(repository, "new-parent"), resolve(repository, ".held-original-parent"));
  await symlink(external, resolve(repository, "new-parent"));
  await writeFile(`${barrier}.go`, "go\n", { mode: 0o600 });
  const status = await new Promise((resolveStatus) => child.on("close", (code) => resolveStatus(code)));
  assert.notEqual(status, 0, stderr);
  assert.match(stderr, /destination ancestor identity changed/);
  await assert.rejects(readFile(resolve(external, "anti-slop/index.ts")));
  const retained = (await readdir(resolve(repository, ".held-original-parent")))
    .find((entry) => entry.startsWith(".anti-slop.aohys-stage-"));
  assert.ok(retained, "the original staged tree stays inside the renamed repository ancestor");
  await rm(repository, { recursive: true, force: true });
  await rm(external, { recursive: true, force: true });
});

test("removing the pinned LICENSE during the race barrier blocks placement", async () => {
  const repository = await tempRepository();
  const barrier = resolve(repository, "license-race");
  const child = spawn(process.execPath, [installer, "license-target"], {
    cwd: repository,
    env: { ...process.env, AOHYS_ANTI_SLOP_TEST_BARRIER: barrier },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      await readFile(`${barrier}.ready`);
      break;
    } catch {
      await delay(10);
    }
  }
  assert.equal(Date.now() < deadline, true, "installer reached deterministic LICENSE race barrier");
  const stageName = (await readdir(repository)).find((entry) => entry.startsWith(".license-target.aohys-stage-"));
  assert.ok(stageName);
  await rm(resolve(repository, stageName, "LICENSE"));
  await writeFile(`${barrier}.go`, "go\n", { mode: 0o600 });
  const status = await new Promise((resolveStatus) => child.on("close", (code) => resolveStatus(code)));
  assert.notEqual(status, 0, stderr);
  assert.match(stderr, /complete staged install tree does not match/);
  await assert.rejects(readFile(resolve(repository, "license-target/index.ts")));
  await rm(repository, { recursive: true, force: true });
});

test("the contained installer refuses absolute, parent-traversal, nested-traversal, and backslash destinations", async () => {
  const repository = await tempRepository();
  for (const [args, expected] of [
    [["/tmp/aohys-absolute-escape"], /absolute destinations are not allowed/],
    [["../outside"], /empty, dot, or parent segments/],
    [["tools/../../outside"], /empty, dot, or parent segments/],
    [["deep/../../../outside"], /empty, dot, or parent segments/],
    [["./hidden"], /empty, dot, or parent segments/],
    [["tools//gap"], /empty, dot, or parent segments/],
    [["tools\\win"], /backslash destinations are ambiguous/],
    [[" "], /the destination is empty/],
  ]) {
    const result = runInstaller(repository, args);
    assert.equal(result.status, 1, `${JSON.stringify(args)} must be refused`);
    assert.match(result.stderr, expected, JSON.stringify(args));
  }
  assert.equal(await readdir(repository).then((entries) => entries.length), 0, "no destination may be created");
  await rm(repository, { recursive: true, force: true });
});

test("the contained installer refuses symlink ancestors and symlink targets even with --force", async () => {
  const repository = await tempRepository();
  await mkdir(resolve(repository, "real"), { recursive: true });
  await symlink("/tmp", resolve(repository, "linked"));
  const ancestor = runInstaller(repository, ["linked/sub"]);
  assert.equal(ancestor.status, 1);
  assert.match(ancestor.stderr, /symbolic link ancestor: linked/);

  const outside = resolve(repository, "escape-target");
  await symlink(outside, resolve(repository, "slink"));
  const target = runInstaller(repository, ["slink", "--force"]);
  assert.equal(target.status, 1);
  assert.match(target.stderr, /existing symbolic link; --force never authorizes writing through a link/);
  let escaped = false;
  try {
    await readFile(outside);
    escaped = true;
  } catch {
    escaped = false;
  }
  assert.equal(escaped, false, "no bytes may be written through the symlink");
  await rm(repository, { recursive: true, force: true });
});

test("the contained installer refuses a nested destination symlink even with --force", async () => {
  const repository = await tempRepository();
  const outside = resolve(repository, "nested-escape");
  await mkdir(resolve(repository, "tools/lint"), { recursive: true });
  await symlink("/tmp", resolve(repository, "tools/lint/escape"));
  const forced = runInstaller(repository, ["tools/lint", "--force"]);
  assert.equal(forced.status, 1);
  assert.match(forced.stderr, /existing destination contains a symbolic link/);
  let escaped = false;
  try {
    await readFile(outside);
    escaped = true;
  } catch {
    escaped = false;
  }
  assert.equal(escaped, false, "no bytes may be written through the nested symlink");
  // The nested symlink itself must survive untouched.
  assert.equal((await (await import("node:fs/promises")).lstat(resolve(repository, "tools/lint/escape"))).isSymbolicLink(), true);
  await rm(repository, { recursive: true, force: true });
});

test("the contained installer preserves the upstream installer contract for safe relative destinations", async () => {
  const repository = await tempRepository();
  const viaInstaller = runInstaller(repository, ["vendor/lint"]);
  assert.equal(viaInstaller.status, 0, viaInstaller.stderr);
  assert.match(viaInstaller.stdout, /Copied the anti-slop plugin to/);
  assert.match(viaInstaller.stdout, /Configure Oxlint with: .*vendor\/lint\/index\.ts/);

  const upstreamRepository = await tempRepository();
  const viaUpstream = runUpstream(upstreamRepository, ["vendor/lint"]);
  assert.equal(viaUpstream.status, 0, viaUpstream.stderr);
  assert.equal(
    await readFile(resolve(upstreamRepository, "vendor/lint/index.ts"), "utf8"),
    await readFile(resolve(repository, "vendor/lint/index.ts"), "utf8"),
    "the contained installer must copy the same bytes as the pristine upstream installer",
  );
  await rm(repository, { recursive: true, force: true });
  await rm(upstreamRepository, { recursive: true, force: true });
});
