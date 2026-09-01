import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { routeDefinition } from "../src/definition-router.mjs";

const root = resolve(import.meta.dirname, "..");

test("1.5.13 routes ordinary work directly and keeps Working Backwards opt-in", async () => {
  const [manifest, catalog, contract, packageJson] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.13.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "catalog/0.20.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.13/contract.md"), "utf8"),
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(manifest.contractVersion, "1.5.13");
  assert.equal(catalog.catalogVersion, "0.20.0");
  assert.equal(packageJson.version, "1.5.13");
  const drive = catalog.skills.find((skill) => skill.logicalName === "drive-development-flow");
  const orchestration = catalog.skills.find((skill) => skill.logicalName === "coding-orchestration");
  assert.equal(drive.source.path, "artifacts/1.5.13/skills/internal/drive-development-flow");
  assert.equal(orchestration.variants[0].sourceDirectory, "artifacts/1.5.13/skills/internal/coding-orchestration");
  assert.equal(orchestration.source.path, orchestration.variants[0].sourceDirectory);
  assert.equal(orchestration.variants[0].adapterContract, "deterministic-hybrid-orchestration-v1");
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
    readFile(resolve(root, "artifacts/1.5.13/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.20.0.json"), "utf8"),
  ]);
  assert.match(oldContract, /Development System Contract 1\.5\.11/);
  assert.equal(JSON.parse(oldCatalog).catalogVersion, "0.18.0");
  assert.notEqual(nextContract, oldContract);
  assert.notEqual(nextCatalog, oldCatalog);
});
