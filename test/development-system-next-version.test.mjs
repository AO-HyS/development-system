import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("contract 1.5.1 and catalog 0.10.0 patch launchd without rewriting 1.5.0", async () => {
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

test("contract 1.5.2 and catalog 0.11.0 remove Factory from current live evidence and guardrails", async () => {
  const [manifest, catalog, contract, probe, metadataSource, guardrailsSource] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.2.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "catalog/0.11.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.2/contract.md"), "utf8"),
    readFile(resolve(root, "scripts/probe-harness-skills.mjs"), "utf8"),
    readFile(resolve(root, "src/skill-probe-metadata.mjs"), "utf8"),
    readFile(resolve(root, "src/guardrails.mjs"), "utf8"),
  ]);

  assert.equal(manifest.contractVersion, "1.5.2");
  assert.deepEqual(manifest.supportedHarnesses.map((entry) => entry.id), ["codex", "t3code"]);
  assert.equal(manifest.artifacts.some((artifact) => artifact.harness === "factory"), false);
  assert.deepEqual(catalog.supportedHarnesses.map((entry) => entry.id), ["codex", "t3code"]);
  assert.equal(catalog.skills.flatMap((skill) => skill.variants).some((variant) => variant.harness === "factory"), false);
  assert.equal(catalog.skills.find((skill) => skill.logicalName === "global-agent-guardrails").source.path, "artifacts/1.5.2/skills/internal/global-agent-guardrails");
  assert.match(contract, /does not own a second catalog mirror/);
  assert.doesNotMatch(probe, /AOHYS_FACTORY_PATH|\.factory|factoryPath|factoryCatalog/);
  assert.doesNotMatch(metadataSource, /factoryCatalog/);
  assert.doesNotMatch(guardrailsSource, /factoryConfig|factoryEngine|Factory settings/);
});

test("contract 1.5.3 binds T3 Code recertification to the installed contract", async () => {
  const [manifest, contract, t3Probe, codexProbe] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.3.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.3/contract.md"), "utf8"),
    readFile(resolve(root, "scripts/probe-t3code.mjs"), "utf8"),
    readFile(resolve(root, "scripts/probe-harness-skills.mjs"), "utf8"),
  ]);
  assert.equal(manifest.contractVersion, "1.5.3");
  assert.deepEqual(manifest.supportedHarnesses.map((entry) => entry.id), ["codex", "t3code"]);
  assert.match(contract, /exact installed contract/i);
  assert.doesNotMatch(t3Probe, /"0\.2\.0"|skills-live-2026-07-23-recertification/);
  assert.match(t3Probe, /skills-live-latest\.json/);
  assert.match(t3Probe, /app\.asar\/apps\/server\/dist\/bin\.mjs/);
  assert.match(t3Probe, /electronRunAsNode/);
  assert.match(t3Probe, /turn-timeout/);
  assert.match(t3Probe, /T3CODE_TURN_TIMEOUT_MS/);
  assert.match(codexProbe, /skills-live-latest\.json/);
});
