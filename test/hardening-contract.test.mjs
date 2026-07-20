import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { resolveCapabilityRoster } from "../src/benchmarks.mjs";

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const preflight = resolve(repositoryRoot, "bin", "development-system");
const validator = resolve(repositoryRoot, "scripts", "validate-development-system.py");

test("portable preflight selects an explicit Node runtime and diagnoses a missing runtime before execution", async () => {
  const packageDocument = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageDocument.bin["aohys-development-system"], "./bin/development-system");

  const available = spawnSync(preflight, ["validate-repository", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, AOHYS_NODE: process.execPath, PATH: "" },
  });
  assert.equal(available.status, 0, available.stderr);
  assert.equal(JSON.parse(available.stdout).operation, "validate-repository");

  const missing = spawnSync(preflight, ["validate-repository", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, AOHYS_NODE: "", PATH: "" },
  });
  assert.equal(missing.status, 127);
  assert.match(missing.stderr, /Node\.js 22|AOHYS_NODE/i);
  assert.doesNotMatch(missing.stderr, /not found$/i);
});

test("global validator accepts manifest-declared physical mirrors and rejects divergent bytes", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-validator-mirrors-"));
  const shared = resolve(home, ".agents", "skills", "flow-implement", "SKILL.md");
  const factory = resolve(home, ".factory", "skills", "flow-implement", "SKILL.md");
  await mkdir(dirname(shared), { recursive: true });
  await mkdir(dirname(factory), { recursive: true });
  await writeFile(shared, "physical mirror\n");
  await writeFile(factory, "physical mirror\n");
  const lock = {
    schemaVersion: 1,
    catalogVersion: "0.2.0",
    logicalSkills: [{
      logicalName: "flow-implement",
      variants: [
        { id: "flow-implement.codex", destination: ".agents/skills/flow-implement", expectedMirrorOf: null },
        { id: "flow-implement.factory", destination: ".factory/skills/flow-implement", expectedMirrorOf: "flow-implement.codex" },
      ],
    }],
  };
  const lockPath = resolve(home, ".development-system", "skills-lock.json");
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify(lock)}\n`);

  const valid = spawnSync("python3", [validator, "--home", home, "--mirrors-only"], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /physical mirrors: 1/i);

  await writeFile(factory, "divergent bytes\n");
  const invalid = spawnSync("python3", [validator, "--home", home, "--mirrors-only"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /does not match/i);
});

test("0.6 operational coverage includes every read-only smoke target and the roster exposes honest mapping states", async () => {
  const scenarios = JSON.parse(
    await readFile(resolve(repositoryRoot, "config", "0.6.0", "operational-scenarios.json"), "utf8"),
  );
  assert.deepEqual(
    scenarios.scenarios.map((scenario) => scenario.relativeCwd),
    [".", undefined, "nutri-plan", "the-barber-central", "aohys/apps/dashboard"],
  );
  assert.equal(scenarios.scenarios[1].temporaryFixture, "simple-repository");
  assert.ok(scenarios.scenarios.every((scenario) =>
    ["codex", "factory", "t3code"].every((surface) => scenario.surfaces.includes(surface))
  ));

  const roster = JSON.parse(
    await readFile(resolve(repositoryRoot, "config", "0.6.0", "capability-roster.json"), "utf8"),
  );
  const resolved = resolveCapabilityRoster(roster);
  const mappings = Object.values(resolved.capabilities).flatMap((capability) => [
    capability.codex,
    capability.factory,
  ]);
  assert.ok(mappings.some((mapping) => mapping.mappingStatus === "validated"));
  assert.ok(mappings.some((mapping) => mapping.mappingStatus === "provisional"));
  assert.ok(mappings.some((mapping) => mapping.evidenceStatus === "timeout"));
  assert.ok(mappings.some((mapping) => mapping.evidenceStatus === "permission-blocked"));
});
