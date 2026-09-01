import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { routeDefinition } from "../src/definition-router.mjs";

const root = resolve(import.meta.dirname, "..");

test("1.5.14 routes ordinary work directly and keeps product verification opt-in", async () => {
  const [manifest, catalog, contract, packageJson, runnerAgent] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.14.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "catalog/0.21.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.14/contract.md"), "utf8"),
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.14/agents/codex/computer-use-runner.toml"), "utf8"),
  ]);
  assert.equal(manifest.contractVersion, "1.5.14");
  assert.equal(catalog.catalogVersion, "0.21.0");
  assert.equal(packageJson.version, "1.5.14");
  const drive = catalog.skills.find((skill) => skill.logicalName === "drive-development-flow");
  const orchestration = catalog.skills.find((skill) => skill.logicalName === "coding-orchestration");
  const createVerification = catalog.skills.find((skill) => skill.logicalName === "create-product-verification");
  const maintainVerification = catalog.skills.find((skill) => skill.logicalName === "maintain-product-verification");
  assert.equal(drive.source.path, "artifacts/1.5.14/skills/internal/drive-development-flow");
  assert.equal(orchestration.variants[0].sourceDirectory, "artifacts/1.5.14/skills/internal/coding-orchestration");
  assert.equal(orchestration.source.path, orchestration.variants[0].sourceDirectory);
  assert.equal(orchestration.variants[0].adapterContract, "deterministic-hybrid-orchestration-v1");
  assert.equal(createVerification.source.path, "artifacts/1.5.14/skills/internal/create-product-verification");
  assert.equal(maintainVerification.source.path, "artifacts/1.5.14/skills/internal/maintain-product-verification");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "capability-roster").sourcePath, "config/1.5.14/capability-roster.json");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "codex-agent-computer-use-runner").destination, ".codex/agents/computer-use-runner.toml");
  assert.match(runnerAgent, /model = "gpt-5\.6-luna"/);
  assert.match(runnerAgent, /model_reasoning_effort = "max"/);
  assert.match(runnerAgent, /executionStatus as only complete or incomplete/);
  assert.match(runnerAgent, /Never emit PASS, FAIL, BLOCKED, or INCONCLUSIVE/);
  assert.match(contract, /ordinary.*direct/i);
  assert.match(contract, /fast-model-first/i);
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
