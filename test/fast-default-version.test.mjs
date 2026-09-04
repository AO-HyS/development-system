import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { routeDefinition } from "../src/definition-router.mjs";

const root = resolve(import.meta.dirname, "..");

test("1.5.16 routes ordinary mechanical work through the declared fast chain", async () => {
  const [manifest, catalog, nextCatalog, contract, packageJson, runnerAgent, fastImplementerAgent] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.16.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "catalog/0.22.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "catalog/0.23.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.16/contract.md"), "utf8"),
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.15/agents/codex/computer-use-runner.toml"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.16/agents/codex/fast-implementer.toml"), "utf8"),
  ]);
  assert.equal(manifest.contractVersion, "1.5.16");
  assert.equal(catalog.catalogVersion, "0.22.0");
  assert.equal(nextCatalog.catalogVersion, "0.23.0");
  assert.equal(packageJson.version, "1.5.18");
  const nextOrchestration = nextCatalog.skills.find((skill) => skill.logicalName === "coding-orchestration");
  assert.equal(nextOrchestration.variants[0].sourceDirectory, "artifacts/1.5.16/skills/internal/coding-orchestration");
  assert.equal(nextOrchestration.source.path, nextOrchestration.variants[0].sourceDirectory);
  const unchangedNext = nextCatalog.skills.filter((skill) => skill.logicalName !== "coding-orchestration");
  const previousByName = new Map(catalog.skills.map((skill) => [skill.logicalName, skill]));
  for (const skill of unchangedNext) {
    const before = previousByName.get(skill.logicalName);
    assert.ok(before, `${skill.logicalName} exists in 0.22.0`);
    assert.deepEqual(
      { ...skill, variants: skill.variants.map(({ folderSha256, ...variant }) => variant) },
      { ...before, variants: before.variants.map(({ folderSha256, ...variant }) => variant) },
      `${skill.logicalName} is unchanged between 0.22.0 and 0.23.0`,
    );
  }
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.23.0.json");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "codex-agent-fast-implementer").sourcePath, "artifacts/1.5.16/agents/codex/fast-implementer.toml");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "model-routing").sourcePath, "artifacts/1.5.16/model-routing.md");
  const drive = catalog.skills.find((skill) => skill.logicalName === "drive-development-flow");
  const orchestration = catalog.skills.find((skill) => skill.logicalName === "coding-orchestration");
  const createVerification = catalog.skills.find((skill) => skill.logicalName === "create-product-verification");
  const maintainVerification = catalog.skills.find((skill) => skill.logicalName === "maintain-product-verification");
  assert.equal(drive.source.path, "artifacts/1.5.15/skills/internal/drive-development-flow");
  assert.equal(orchestration.variants[0].sourceDirectory, "artifacts/1.5.15/skills/internal/coding-orchestration");
  assert.equal(orchestration.source.path, orchestration.variants[0].sourceDirectory);
  assert.equal(orchestration.variants[0].adapterContract, "authorized-initiative-orchestration-v2");
  assert.equal(createVerification.source.path, "artifacts/1.5.15/skills/internal/create-product-verification");
  assert.equal(maintainVerification.source.path, "artifacts/1.5.15/skills/internal/maintain-product-verification");
  assert.equal(catalog.skills.find((skill) => skill.logicalName === "pstack-engineering").source.inspiration.commit, "82f1d4f49ba8f21e3315a89c97e82f7c02a48fba");
  assert.equal(catalog.skills.find((skill) => skill.logicalName === "implement-spec").source.path, "artifacts/1.5.15/skills/internal/implement-spec");
  assert.equal(catalog.skills.find((skill) => skill.logicalName === "implement-spec").source.upstreamReference.commit, "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76");
  assert.equal(catalog.skills.find((skill) => skill.logicalName === "grill-with-docs").source.upstreamReference.commit, "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76");
  assert.equal((await readdir(resolve(root, "artifacts/1.5.15/skills/upstream"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length, 37);
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "capability-roster").sourcePath, "config/1.5.16/capability-roster.json");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "codex-agent-computer-use-runner").destination, ".codex/agents/computer-use-runner.toml");
  assert.match(runnerAgent, /model = "gpt-5\.6-luna"/);
  assert.match(runnerAgent, /model_reasoning_effort = "max"/);
  assert.match(runnerAgent, /executionStatus as only complete or incomplete/);
  assert.match(runnerAgent, /Never emit PASS, FAIL, BLOCKED, or INCONCLUSIVE/);
  assert.match(contract, /Everyday implementation is never direct on\s+Codex Luna High/);
  assert.match(contract, /fast-model-first/i);
  assert.match(fastImplementerAgent, /model = "gpt-5\.6-luna"/);
  assert.match(fastImplementerAgent, /model_reasoning_effort = "max"/);
  assert.match(fastImplementerAgent, /ordered runtime attempt chain/);
  assert.match(fastImplementerAgent, /priority\/fast service path/);
  assert.match(contract, /shared ordered runtime attempt\s+chain/);
  assert.match(contract, /reasoning `max` on\s+the priority\/fast service path/);
  assert.match(contract, /0\.23\.0 skill catalog ships a new immutable 1\.5\.16/);
  assert.doesNotMatch(contract, /Ordinary implementation remains direct on Codex/);
  assert.deepEqual(routeDefinition({ request: "Quiero agregar una búsqueda" }).requiredArtifacts, []);
  assert.equal(routeDefinition({ request: "Quiero usar Working Backwards" }).currentStage, "product-grill");
  assert.equal(routeDefinition({ request: "Quiero usar grill-with-docs" }).currentStage, "implementation");
});

test("published 1.5.11 contract and catalog remain distinct immutable sources", async () => {
  const [oldContract, oldCatalog, nextContract, nextCatalog] = await Promise.all([
    readFile(resolve(root, "artifacts/1.5.11/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.18.0.json"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.14/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.21.0.json"), "utf8"),
  ]);
  assert.match(oldContract, /Development System Contract 1\.5\.11/);
  assert.equal(JSON.parse(oldCatalog).catalogVersion, "0.18.0");
  assert.notEqual(nextContract, oldContract);
  assert.notEqual(nextCatalog, oldCatalog);
});
