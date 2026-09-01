import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repositoryRoot, "bin/development-system.mjs");

test("published manifest and catalog generators refuse to overwrite existing versions", async () => {
  for (const [script, path] of [
    ["scripts/build-contract-manifest.mjs", "manifests/1.5.11.json"],
    ["scripts/build-skill-catalog.mjs", "catalog/0.18.0.json"],
  ]) {
    const absolutePath = resolve(repositoryRoot, path);
    const before = await readFile(absolutePath);
    const result = spawnSync(process.execPath, [resolve(repositoryRoot, script)], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to overwrite immutable/);
    assert.deepEqual(await readFile(absolutePath), before);
  }
});

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

async function createCleanSourceCheckout(commit) {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "aohys-development-system-source-"));
  for (const [command, args] of [
    ["git", ["init", "--quiet"]],
    ["git", ["fetch", "--quiet", repositoryRoot, commit]],
    ["git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"]],
  ]) {
    const result = spawnSync(command, args, { cwd: sourceRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  return sourceRoot;
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
  assert.deepEqual(validation.json.versions, ["0.0.0", "0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.9.1", "1.0.0", "1.1.0", "1.1.1", "1.1.2", "1.2.0", "1.3.0", "1.4.0", "1.4.1", "1.5.0", "1.5.1", "1.5.10", "1.5.11", "1.5.12", "1.5.13", "1.5.2", "1.5.3", "1.5.4", "1.5.5", "1.5.6", "1.5.7", "1.5.8", "1.5.9"]);
  assert.deepEqual(validation.json.errors, []);
});

test("the 0.9.1 contract publishes Luna routing and fail-closed worktree ownership", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "manifests/0.9.1.json"), "utf8"),
  );
  const catalog = JSON.parse(
    await readFile(resolve(repositoryRoot, "catalog/0.3.1.json"), "utf8"),
  );
  const orchestration = catalog.skills.find(
    (skill) => skill.logicalName === "coding-orchestration",
  );
  const multiple = catalog.skills.find(
    (skill) => skill.logicalName === "work-multiple",
  );
  const developmentFlow = catalog.skills.find(
    (skill) => skill.logicalName === "drive-development-flow",
  );
  assert.ok(orchestration);
  assert.ok(multiple);
  assert.ok(developmentFlow);
  assert.equal(catalog.skills.length, 21);
  assert.equal(catalog.skills.flatMap((skill) => skill.variants).length, 42);
  assert.ok(orchestration.variants.every(
    (variant) => variant.adapterContract === "fast-explicit-multiple-routing-v3",
  ));
  assert.ok(multiple.variants.every(
    (variant) => variant.sourceDirectory ===
      "artifacts/0.9.1/skills/internal/work-multiple",
  ));
  assert.ok(developmentFlow.variants.every(
    (variant) => variant.sourceDirectory ===
      "artifacts/0.9.1/skills/internal/drive-development-flow",
  ));
  assert.equal(
    manifest.artifacts.filter((artifact) => artifact.id.startsWith("factory-droid.")).length,
    16,
  );
  assert.equal(
    manifest.artifacts.filter((artifact) => artifact.id.startsWith("codex-agent.")).length,
    16,
  );
  for (const artifact of manifest.artifacts.filter(
    (item) => item.id.startsWith("factory-droid."),
  )) {
    const contents = await readFile(resolve(repositoryRoot, artifact.sourcePath), "utf8");
    assert.doesNotMatch(contents, /^model:\s*inherit$/m);
  }
  for (const artifact of manifest.artifacts.filter(
    (item) => item.id.startsWith("codex-agent."),
  )) {
    const contents = await readFile(resolve(repositoryRoot, artifact.sourcePath), "utf8");
    assert.match(contents, /^model\s*=\s*"[^"]+"$/m);
  }
  const contract = await readFile(
    resolve(repositoryRoot, "artifacts/0.9.1/contract.md"),
    "utf8",
  );
  assert.match(contract, /within five minutes/i);
  assert.match(contract, /full repository suite is\s+forbidden by default/i);
  assert.match(contract, /one\s+pull request/i);
  assert.match(contract, /label, copy, icon/i);
  assert.match(contract, /met`, `missed`, or `unproven`/i);
  assert.match(contract, /bounded implementation and focused tests to Luna/i);
  assert.match(contract, /reject patch targets outside/i);
});

test("0.9.1 installs into an isolated HOME with Luna fast implementation", async () => {
  const sourceCommit = createSourceCommit();
  const home = await mkdtemp(resolve(tmpdir(), "aohys-development-system-0.9-"));
  const install = runCli(
    "install",
    "--home",
    home,
    "--version",
    "0.9.1",
    "--source-commit",
    sourceCommit,
  );
  assert.equal(install.status, 0, install.stderr);
  assert.equal(install.json.version, "0.9.1");
  const sourceRoot = await createCleanSourceCheckout(sourceCommit);
  const sync = runCli(
    "sync-skills",
    "--home",
    home,
    "--version",
    "0.3.1",
    "--source-root",
    sourceRoot,
    "--source-commit",
    sourceCommit,
  );
  assert.equal(sync.status, 0, sync.stderr);
  const fastImplementer = await readFile(
    resolve(home, ".factory", "droids", "fast-implementer.md"),
    "utf8",
  );
  assert.match(fastImplementer, /^model:\s*gpt-5\.3-codex-fast$/m);
  assert.doesNotMatch(fastImplementer, /^model:\s*inherit$/m);
  const codexFastImplementer = await readFile(
    resolve(home, ".codex", "agents", "fast-implementer.toml"),
    "utf8",
  );
  assert.match(codexFastImplementer, /^model\s*=\s*"gpt-5\.6-luna"$/m);
  assert.match(codexFastImplementer, /^model_reasoning_effort\s*=\s*"high"$/m);
  assert.match(codexFastImplementer, /expected absolute worktree path and branch/i);
  const factoryMultiple = await readFile(
    resolve(home, ".factory", "skills", "work-multiple", "SKILL.md"),
    "utf8",
  );
  assert.match(factoryMultiple, /active harness roster's explicit `fast_implementer` route/i);
  assert.match(factoryMultiple, /Factory uses\s+its separately versioned explicit droid mapping/i);
  assert.doesNotMatch(factoryMultiple, /Use `fast_implementer` on Luna/i);
  const codexRoster = spawnSync(
    "python3",
    [
      resolve(
        repositoryRoot,
        "artifacts/0.9.1/adapters/codex/coding-orchestration/scripts/validate_agents.py",
      ),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, CODEX_HOME: resolve(home, ".codex") },
    },
  );
  assert.equal(codexRoster.status, 0, codexRoster.stderr);
  const factoryRoster = spawnSync(
    "python3",
    [
      resolve(
        repositoryRoot,
        "artifacts/0.9.1/adapters/factory/coding-orchestration/scripts/validate_agents.py",
      ),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    },
  );
  assert.equal(factoryRoster.status, 0, factoryRoster.stderr);
  const audit = runCli("audit", "--home", home);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(audit.json.status, "healthy");
});

test("the 0.8 operator interface is backed by the pinned skill catalog and bounded flow implementation", async () => {
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, "catalog/0.2.0.json"), "utf8"));
  const required = [
    "drive-development-flow",
    "wayfinder",
    "grill-with-docs",
    "to-spec",
    "to-tickets",
    "flow-implement",
    "flow-code-review",
  ];
  const skills = new Map(catalog.skills.map((skill) => [skill.logicalName, skill]));
  for (const logicalName of required) {
    const skill = skills.get(logicalName);
    assert.ok(skill, `${logicalName} is absent from catalog 0.2.0`);
    assert.deepEqual(new Set(skill.variants.map((variant) => variant.harness)), new Set(["codex", "factory"]));
  }
  const flowImplement = await readFile(
    resolve(repositoryRoot, skills.get("flow-implement").variants[0].sourceDirectory, "SKILL.md"),
    "utf8",
  );
  assert.match(flowImplement, /load `flow-code-review`/);
  assert.match(flowImplement, /Commit, push, open or merge a pull request, deploy, or promote only when the user's request and repository policy authorize/i);
});

test("the 1.0 contract adds private measurement without rewriting published 0.9 versions", async () => {
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, "catalog/0.4.0.json"), "utf8"));
  const measurement = catalog.skills.find((skill) => skill.logicalName === "measure-development-run");
  assert.ok(measurement);
  assert.deepEqual(measurement.physicalHarnesses, ["codex"]);
  assert.equal(
    measurement.variants[0].sourceDirectory,
    "artifacts/1.0.0/skills/internal/measure-development-run",
  );
  assert.ok(catalog.skills.some((skill) => skill.logicalName === "work-multiple"));
  assert.equal(catalog.skills.length, 22);

  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "manifests/1.0.0.json"), "utf8"));
  assert.equal(manifest.contractVersion, "1.0.0");
  assert.equal(manifest.artifacts.length, 45);
  assert.ok(manifest.artifacts.some((artifact) => artifact.sourcePath === "catalog/0.4.0.json"));
  assert.equal(
    manifest.artifacts.find((artifact) => artifact.id === "development-contract.codex")?.sourcePath,
    "artifacts/1.0.0/contract.md",
  );
  const contract = await readFile(resolve(repositoryRoot, "artifacts/1.0.0/contract.md"), "utf8");
  assert.match(contract, /primary duration is measured work plus attributable external wait/i);
  assert.match(contract, /thread span.*never presented as delivery time/i);
  assert.match(contract, /gaps between completed turns.*excluded from operational time/i);
});

test("the 1.1.1 contract patches Exa and guardrails while retaining the 1.1 capabilities", async () => {
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, "catalog/0.5.1.json"), "utf8"));
  const skills = new Map(catalog.skills.map((skill) => [skill.logicalName, skill]));
  for (const name of ["exa-search", "global-agent-guardrails", "decisions", "setup-help"]) {
    assert.ok(skills.has(name), `${name} is absent from catalog 0.5.1`);
    assert.deepEqual(skills.get(name).physicalHarnesses, ["codex", "factory"]);
  }
  assert.equal(skills.get("work-multiple")?.variants[0].destination, ".codex/skills/work-multiple");
  assert.match(skills.get("coding-orchestration").variants[0].sourceDirectory, /artifacts\/0\.9\.1/);
  assert.deepEqual(skills.get("exa-search").variants[0].executableFiles, ["scripts/exa-search.mjs"]);
  assert.deepEqual(skills.get("global-agent-guardrails").variants[0].executableFiles, ["scripts/command-guard.mjs"]);
  assert.match(skills.get("drive-development-flow").variants[0].sourceDirectory, /artifacts\/1\.1\.0/);
  assert.match(skills.get("flow-implement").variants[0].sourceDirectory, /artifacts\/1\.1\.0/);
  const drive = await readFile(
    resolve(repositoryRoot, skills.get("drive-development-flow").variants[0].sourceDirectory, "SKILL.md"),
    "utf8",
  );
  assert.match(drive, /Never infer Wayfinder, grilling, specification, ticket creation, prototypes, `work-multiple`/);
  assert.match(drive, /Create or manage one only when the user explicitly asks for the native goal capability/);

  assert.match(skills.get("exa-search").variants[0].sourceDirectory, /artifacts\/1\.1\.1/);
  assert.match(skills.get("global-agent-guardrails").variants[0].sourceDirectory, /artifacts\/1\.1\.1/);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "manifests/1.1.1.json"), "utf8"));
  assert.equal(manifest.contractVersion, "1.1.1");
  assert.equal(manifest.artifacts.length, 45);
  assert.ok(manifest.artifacts.some((artifact) => artifact.id === "codex-agent.reviewer"));
  assert.ok(manifest.artifacts.some((artifact) => artifact.id === "factory-droid.security-reviewer"));
  assert.ok(manifest.artifacts.some((artifact) => artifact.sourcePath === "catalog/0.5.1.json"));
  const contract = await readFile(resolve(repositoryRoot, "artifacts/1.1.1/contract.md"), "utf8");
  assert.match(contract, /retains every 1\.1\.0/i);
  assert.match(contract, /PreToolUse/);
  assert.match(contract, /never records query text/i);
  assert.match(contract, /consequential choices.*genuinely uncertain/i);
});

test("the 1.1.2 contract clarifies paid tooling and conditional provider readiness", async () => {
  const previousManifest = await readFile(resolve(repositoryRoot, "manifests/1.1.1.json"));
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "manifests/1.1.2.json"), "utf8"));
  const contract = await readFile(resolve(repositoryRoot, "artifacts/1.1.2/contract.md"), "utf8");
  const catalog = await readFile(resolve(repositoryRoot, "catalog/0.5.1.json"));

  assert.equal(manifest.contractVersion, "1.1.2");
  assert.equal(manifest.artifacts.length, 45);
  assert.ok(manifest.artifacts.some((artifact) => artifact.sourcePath === "catalog/0.5.1.json"));
  assert.match(contract, /adapter generation and normalization never call, enable, subscribe to, or spend/i);
  assert.match(contract, /provider readiness is a conditional delivery gate/i);
  assert.match(contract, /must never invent an alias or green state/i);
  assert.match(contract, /nonzero probe can never claim that a skill was loaded or influenced behavior/i);
  assert.equal((await readFile(resolve(repositoryRoot, "manifests/1.1.1.json"))).equals(previousManifest), true);
  assert.equal((await readFile(resolve(repositoryRoot, "catalog/0.5.1.json"))).equals(catalog), true);
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
