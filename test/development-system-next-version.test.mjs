import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("contract 1.5.1 and catalog 0.10.0 patch launchd without rewriting 1.5.0", async () => {
  const root = resolve(import.meta.dirname, "..");
  const [manifest, catalog] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.1.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "catalog/0.10.0.json"), "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(manifest.supportedHarnesses.map((harness) => harness.id), ["codex", "t3code"]);
  assert.deepEqual(catalog.supportedHarnesses.map((harness) => harness.id), ["codex", "t3code"]);
  assert.equal(manifest.artifacts.some((artifact) => artifact.harness === "factory" || artifact.destination.startsWith(".factory/")), false);
  assert.equal(catalog.skills.flatMap((skill) => skill.variants).some((variant) => variant.harness === "factory" || variant.destination.startsWith(".factory/")), false);
  assert.equal(catalog.skills.every((skill) => typeof skill.source?.repository === "string" && typeof skill.source?.commit === "string" && typeof skill.source?.path === "string"), true);
  assert.equal(catalog.skills.flatMap((skill) => skill.variants).every((variant) => /^[a-f0-9]{64}$/u.test(variant.folderSha256)), true);

  for (const name of ["working-backwards", "parallel-work", "release-train", "check-in", "convex-guardian", "posthog-observability", "linear-hygiene", "development-steward"]) {
    assert.ok(catalog.skills.some((skill) => skill.logicalName === name), name);
  }
  assert.ok(manifest.artifacts.some((artifact) => artifact.logicalName === "stack-quality-profiles"));
  assert.ok(manifest.artifacts.some((artifact) => artifact.logicalName === "development-steward-schedule"));
  assert.equal(catalog.skills.find((skill) => skill.logicalName === "development-steward").source.path, "artifacts/1.5.1/skills/internal/development-steward");

  const [operatorInterface, harnessAdaptersSource, capabilityRosterSource] = await Promise.all(
    ["operator-interface", "harness-adapters", "capability-roster"].map(async (logicalName) => {
      const artifact = manifest.artifacts.find((candidate) => candidate.logicalName === logicalName);
      assert.ok(artifact, logicalName);
      return readFile(resolve(root, artifact.sourcePath), "utf8");
    }),
  );
  const harnessAdapters = JSON.parse(harnessAdaptersSource);
  const capabilityRoster = JSON.parse(capabilityRosterSource);
  assert.deepEqual(Object.keys(harnessAdapters.adapters), ["codex", "t3code"]);
  assert.deepEqual(Object.keys(capabilityRoster.executionRoles), ["codex"]);
  assert.doesNotMatch(operatorInterface, /Codex or Factory|work-multiple/iu);
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "operator-interface").sourcePath, "artifacts/1.5.0/operator-interface.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "harness-adapters").sourcePath, "config/1.5.0/harness-adapters.json");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "capability-roster").sourcePath, "config/1.5.0/capability-roster.json");
});
