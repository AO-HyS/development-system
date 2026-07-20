import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repositoryRoot, "bin/development-system.mjs");

function createSourceCommit() {
  const tree = spawnSync("git", ["write-tree"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(tree.status, 0, tree.stderr);
  const commit = spawnSync("git", ["commit-tree", tree.stdout.trim(), "-m", "contract source"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Development System tests",
      GIT_AUTHOR_EMAIL: "tests@aohys.com",
      GIT_COMMITTER_NAME: "Development System tests",
      GIT_COMMITTER_EMAIL: "tests@aohys.com",
    },
  });
  assert.equal(commit.status, 0, commit.stderr);
  return commit.stdout.trim();
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return {
    ...result,
    json: result.stdout.trim() ? JSON.parse(result.stdout) : null,
  };
}

test("the repository validator proves manifests, canonical hashes, harnesses, and mirrors", () => {
  const validation = runCli("validate-repository");
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(validation.json.ok, true);
  assert.deepEqual(validation.json.versions, ["0.0.0", "0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0"]);
  assert.deepEqual(validation.json.errors, []);
});

test("the first rollback restores pre-install bytes and removes only generated files", async () => {
  const sourceCommit = createSourceCommit();
  const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-preinstall-"));
  const codexContract = resolve(home, ".codex", "development-system", "contract.md");
  const factoryContract = resolve(home, ".factory", "development-system", "contract.md");
  await mkdir(dirname(codexContract), { recursive: true });
  await writeFile(codexContract, "pre-existing user bytes\n", "utf8");

  const install = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.1.0",
    "--source-commit",
    sourceCommit,
  );
  assert.equal(install.status, 0, install.stderr);

  const rollback = runCli("rollback", "--home", home);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(rollback.json.toVersion, null);
  assert.equal(await readFile(codexContract, "utf8"), "pre-existing user bytes\n");
  await assert.rejects(access(factoryContract));
  await assert.rejects(access(resolve(home, ".development-system")));

  const audit = runCli("audit", "--home", home);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(audit.json.status, "not-installed");
});

test("installation rejects an unpinned source commit", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-commit-"));
  const result = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.1.0",
    "--source-commit",
    "2222222222222222222222222222222222222222",
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.json.ok, false);
  assert.match(result.json.error, /source commit.*does not exist/i);
});

test("installation refuses a harness directory symlink that escapes HOME", async () => {
  const sourceCommit = createSourceCommit();
  const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-symlink-home-"));
  const outside = await mkdtemp(resolve(tmpdir(), "aohys-development-system-outside-"));
  await symlink(outside, resolve(home, ".codex"), "dir");

  const result = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.1.0",
    "--source-commit",
    sourceCommit,
  );
  assert.notEqual(result.status, 0);
  assert.match(result.json.error, /symbolic link.*HOME/i);
  await assert.rejects(access(resolve(outside, "development-system", "contract.md")));
  await assert.rejects(access(resolve(home, ".factory", "development-system", "contract.md")));
});

test("audit detects changes to installed metadata outside canonical contract fields", async () => {
  const sourceCommit = createSourceCommit();
  const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-metadata-"));
  const install = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.1.0",
    "--source-commit",
    sourceCommit,
  );
  assert.equal(install.status, 0, install.stderr);

  const manifestPath = resolve(home, ".development-system", "installed-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.installedAt = "2000-01-01T00:00:00.000Z";
  manifest.unexpected = "manual metadata";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const audit = runCli("audit", "--home", home);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(audit.json.ok, false);
  assert.match(audit.json.problems.join("\n"), /manifest.*(integrity|schema)/i);
});

test("rollback refuses tampered snapshot metadata before touching unrelated files", async () => {
  const sourceCommit = createSourceCommit();
  const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-snapshot-"));
  const unrelated = resolve(home, "notes", "keep-me.txt");
  await mkdir(dirname(unrelated), { recursive: true });
  await writeFile(unrelated, "preserve me\n", "utf8");

  assert.equal(
    runCli(
      "install",
      "--home",
      home,
      "--version",
      "0.0.0",
      "--source-commit",
      sourceCommit,
    ).status,
    0,
  );
  assert.equal(
    runCli(
      "install",
      "--home",
      home,
      "--version",
      "0.1.0",
      "--source-commit",
      sourceCommit,
    ).status,
    0,
  );

  const state = JSON.parse(
    await readFile(resolve(home, ".development-system", "state.json"), "utf8"),
  );
  const historyEntry = state.history.at(-1);
  const snapshotId = typeof historyEntry === "string" ? historyEntry : historyEntry.id;
  const snapshotPath = resolve(
    home,
    ".development-system",
    "snapshots",
    snapshotId,
    "snapshot.json",
  );
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  snapshot.files.push({ destination: "notes/keep-me.txt", existed: false, backupPath: null });
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const rollback = runCli("rollback", "--home", home);
  assert.notEqual(rollback.status, 0);
  assert.match(rollback.json.error, /snapshot.*(integrity|managed destinations)/i);
  assert.equal(await readFile(unrelated, "utf8"), "preserve me\n");
});
