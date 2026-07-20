import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repositoryRoot, "bin/development-system.mjs");

function createSourceCommit() {
  const tree = spawnSync("git", ["write-tree"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(tree.status, 0, tree.stderr);
  const commit = spawnSync("git", ["commit-tree", tree.stdout.trim(), "-m", "acceptance source"], {
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

  const output = result.stdout.trim();
  return {
    ...result,
    json: output ? JSON.parse(output) : null,
  };
}

test("a clean HOME supports install, drift detection, reinstall, and version rollback", async () => {
  const sourceCommit = createSourceCommit();
  const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-"));
  const unrelatedPath = resolve(home, "notes", "keep-me.txt");
  await mkdir(dirname(unrelatedPath), { recursive: true });
  await writeFile(unrelatedPath, "user-owned\n", "utf8");

  const bootstrapInstall = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.0.0",
    "--source-commit",
    sourceCommit,
  );
  assert.equal(bootstrapInstall.status, 0, bootstrapInstall.stderr);
  assert.equal(bootstrapInstall.json.operation, "install");
  assert.equal(bootstrapInstall.json.version, "0.0.0");
  const codexBootstrap = resolve(home, ".codex", "development-system", "bootstrap.md");
  const factoryBootstrap = resolve(home, ".factory", "development-system", "bootstrap.md");
  assert.match(await readFile(codexBootstrap, "utf8"), /bootstrap marker/i);

  const currentInstall = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.1.0",
    "--source-commit",
    sourceCommit,
  );
  assert.equal(currentInstall.status, 0, currentInstall.stderr);
  assert.equal(currentInstall.json.previousVersion, "0.0.0");

  const installedManifest = JSON.parse(
    await readFile(resolve(home, ".development-system", "installed-manifest.json"), "utf8"),
  );
  assert.equal(installedManifest.contractVersion, "0.1.0");
  assert.equal(installedManifest.source.repository, "https://github.com/AO-HyS/development-system");
  assert.equal(installedManifest.source.commit, sourceCommit);
  assert.deepEqual(
    installedManifest.artifacts.map((artifact) => artifact.harness).sort(),
    ["codex", "factory"],
  );
  assert.ok(installedManifest.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)));
  assert.equal(installedManifest.artifacts[1].expectedMirrorOf, installedManifest.artifacts[0].id);

  const codexContract = resolve(home, ".codex", "development-system", "contract.md");
  const factoryContract = resolve(home, ".factory", "development-system", "contract.md");
  assert.equal(await readFile(codexContract, "utf8"), await readFile(factoryContract, "utf8"));
  await assert.rejects(readFile(codexBootstrap));
  await assert.rejects(readFile(factoryBootstrap));

  await writeFile(codexContract, "manual edit became drift\n", "utf8");

  const driftAudit = runCli("audit", "--home", home);
  assert.equal(driftAudit.status, 0, driftAudit.stderr);
  assert.equal(driftAudit.json.ok, false);
  assert.equal(driftAudit.json.status, "drifted");
  assert.equal(
    driftAudit.json.artifacts.find((artifact) => artifact.harness === "codex").status,
    "drift",
  );
  assert.equal(driftAudit.json.mirrors[0].status, "mismatch");

  const invalidValidation = runCli("validate", "--home", home);
  assert.notEqual(invalidValidation.status, 0);
  assert.equal(invalidValidation.json.ok, false);

  const reinstall = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.1.0",
    "--source-commit",
    sourceCommit,
  );
  assert.equal(reinstall.status, 0, reinstall.stderr);
  assert.equal(reinstall.json.reinstalled, true);
  assert.equal(reinstall.json.previousVersion, "0.0.0");

  const healthyValidation = runCli("validate", "--home", home);
  assert.equal(healthyValidation.status, 0, healthyValidation.stderr);
  assert.equal(healthyValidation.json.ok, true);

  const tamperedManifest = JSON.parse(
    await readFile(resolve(home, ".development-system", "installed-manifest.json"), "utf8"),
  );
  tamperedManifest.source.repository = "https://example.invalid/not-canonical";
  await writeFile(
    resolve(home, ".development-system", "installed-manifest.json"),
    `${JSON.stringify(tamperedManifest, null, 2)}\n`,
    "utf8",
  );
  const manifestDrift = runCli("audit", "--home", home);
  assert.equal(manifestDrift.status, 0, manifestDrift.stderr);
  assert.equal(manifestDrift.json.ok, false);
  assert.match(manifestDrift.json.problems.join("\n"), /installed manifest.*canonical/i);

  const repairedManifest = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.1.0",
    "--source-commit",
    sourceCommit,
  );
  assert.equal(repairedManifest.status, 0, repairedManifest.stderr);

  const rollback = runCli("rollback", "--home", home);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(rollback.json.fromVersion, "0.1.0");
  assert.equal(rollback.json.toVersion, "0.0.0");

  const rolledBackManifest = JSON.parse(
    await readFile(resolve(home, ".development-system", "installed-manifest.json"), "utf8"),
  );
  assert.equal(rolledBackManifest.contractVersion, "0.0.0");
  assert.equal(await readFile(unrelatedPath, "utf8"), "user-owned\n");
  assert.match(await readFile(codexContract, "utf8"), /bootstrap contract/i);
  assert.equal(await readFile(codexContract, "utf8"), await readFile(factoryContract, "utf8"));
  assert.equal(await readFile(codexBootstrap, "utf8"), await readFile(factoryBootstrap, "utf8"));
});
