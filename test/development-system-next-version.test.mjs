import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validateSkillCatalog } from "../src/skills.mjs";

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

test("contract 1.5.4 serializes Codex live observations after the real concurrent failure", async () => {
  const [manifest, contract, codexProbe, runtime] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.4.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.4/contract.md"), "utf8"),
    readFile(resolve(root, "scripts/probe-harness-skills.mjs"), "utf8"),
    readFile(resolve(root, "src/skill-probe-runtime.mjs"), "utf8"),
  ]);
  assert.equal(manifest.contractVersion, "1.5.4");
  assert.deepEqual(manifest.supportedHarnesses.map((entry) => entry.id), ["codex", "t3code"]);
  assert.match(contract, /sequentially/i);
  assert.match(codexProbe, /runCodexSkillProbeSequence/);
  assert.doesNotMatch(codexProbe, /Promise\.all/);
  assert.match(runtime, /exit-zero.*final agent message/is);
});

test("contract 1.5.5 and catalog 0.12.0 install the offline Reader patch immutably", async () => {
  const [manifest, contract, catalog, reader, workflow, skill, packageJson, readme] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.5.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.5/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.12.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.5/skills/internal/working-backwards/scripts/t3-reader.mjs"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.5/skills/internal/working-backwards/scripts/t3-workflow.mjs"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.5/skills/internal/working-backwards/SKILL.md"), "utf8"),
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "README.md"), "utf8"),
  ]);
  const workingBackwards = catalog.skills.find((entry) => entry.logicalName === "working-backwards");

  assert.equal(manifest.contractVersion, "1.5.5");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.5/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.12.0.json");
  assert.equal(catalog.catalogVersion, "0.12.0");
  assert.equal(workingBackwards.source.path, "artifacts/1.5.5/skills/internal/working-backwards");
  assert.equal(workingBackwards.variants[0].sourceDirectory, "artifacts/1.5.5/skills/internal/working-backwards");
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
  assert.match(contract, /before serializing the Reader and computing its Content Security Policy/i);
  assert.match(contract, /human initiative slug/i);
  assert.match(reader, /reportStatusLabel/);
  assert.doesNotMatch(reader, /workflowInput\.authorityLabel/);
  assert.match(reader, /font-size:1\.1875rem/);
  assert.match(workflow, /readerFileName\(initiativeName, slug\)/);
  assert.match(skill, /<initiative-slug>\.html/);
  assert.match(packageJson.scripts["skills:audit"], /skills-live-latest\.json/);
  assert.match(readme, /skills:probe[\s\S]*audit-skills[^\n]*--evidence[^\n]*skills-live-latest\.json/);
});

test("contract 1.5.6 and catalog 0.13.0 keep wide diagrams and final report details readable", async () => {
  const [manifest, contract, catalog, reader, skill, readme] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.6.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.6/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.13.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.6/skills/internal/working-backwards/scripts/t3-reader.mjs"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.6/skills/internal/working-backwards/SKILL.md"), "utf8"),
    readFile(resolve(root, "README.md"), "utf8"),
  ]);
  const workingBackwards = catalog.skills.find((entry) => entry.logicalName === "working-backwards");

  assert.equal(manifest.contractVersion, "1.5.6");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.6/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.13.0.json");
  assert.equal(catalog.catalogVersion, "0.13.0");
  assert.equal(workingBackwards.source.path, "artifacts/1.5.6/skills/internal/working-backwards");
  assert.equal(workingBackwards.variants[0].sourceDirectory, "artifacts/1.5.6/skills/internal/working-backwards");
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
  assert.match(contract, /wide technical diagram.*readable/is);
  assert.match(contract, /reviewable content, not links alone/i);
  assert.match(contract, /Product and agent architecture.*Convex backend.*Observability.*Release Train/is);
  assert.match(reader, /minimumReadableScale=\.875/);
  assert.match(skill, /Known issues/);
  assert.match(readme, /`1\.5\.6` keeps wide diagrams readable/);
});

test("contract 1.5.9 publishes complete Reader history, bounded live review, and complete architecture convergence", async () => {
  const [manifest, contract, catalog, skill, references, ...prompts] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.9.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.9/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.16.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.9/skills/internal/working-backwards/SKILL.md"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.9/architecture-reference-pack.md"), "utf8"),
    ...["aohys", "casa-roca", "the-barber-central", "eteria", "nutriplan"].map((name) =>
      readFile(resolve(root, "docs", "product-convergence", `${name}.md`), "utf8"),
    ),
  ]);
  const workingBackwards = catalog.skills.find((entry) => entry.logicalName === "working-backwards");

  assert.equal(manifest.contractVersion, "1.5.9");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.9/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.16.0.json");
  assert.equal(catalog.catalogVersion, "0.16.0");
  assert.equal(workingBackwards.source.path, "artifacts/1.5.9/skills/internal/working-backwards");
  assert.ok(workingBackwards.variants[0].executableFiles.includes("scripts/reader-live.mjs"));
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
  assert.match(contract, /complete Working Backwards history/i);
  assert.match(contract, /tokenized, expiring Cloudflare quick tunnel/i);
  assert.match(skill, /reader-history/);
  assert.match(skill, /--tunnel/);
  assert.match(skill, /coverage ledger/i);
  assert.match(contract, /repository-wide/i);
  assert.match(skill, /working_backwards_program: architecture-convergence/);
  for (const dimension of [
    "repository-map",
    "module-boundaries",
    "dependency-direction",
    "file-placement",
    "frontend-composition",
    "component-design",
    "backend-contracts",
    "type-contracts",
    "testing-strategy",
    "documentation",
    "performance-security",
    "observability",
    "migration-sequencing",
  ]) {
    assert.equal(references.includes(`| \`${dimension}\` |`), true, dimension);
  }
  assert.match(references, /Agent guardrails, (?:the )?global anti-slop policy, and Release Train design are Development System capabilities/i);
  for (const prompt of prompts) {
    assert.match(prompt, /working_backwards_program: architecture-convergence/);
    assert.match(prompt, /every product-architecture dimension in the reference pack's coverage matrix/i);
  }
});

test("contract 1.5.10 makes the Technical Reader usable from phones through desktop", async () => {
  const [manifest, contract, catalog, reader] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.10.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.10/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.17.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.10/skills/internal/working-backwards/scripts/t3-reader.mjs"), "utf8"),
  ]);
  const workingBackwards = catalog.skills.find((entry) => entry.logicalName === "working-backwards");

  assert.equal(manifest.contractVersion, "1.5.10");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.10/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.17.0.json");
  assert.equal(catalog.catalogVersion, "0.17.0");
  assert.equal(workingBackwards.source.path, "artifacts/1.5.10/skills/internal/working-backwards");
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
  assert.match(contract, /320 px phones through tablets and desktop/i);
  assert.match(contract, /labeled records on narrow phones/i);
  assert.match(reader, /@media\(max-width:82rem\)/);
  assert.match(reader, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(reader, /content:attr\(data-label\)/);
});

test("contract 1.5.7 and catalog 0.14.0 compose one Topic for native questions or an equivalent chat fallback", async () => {
  const [manifest, contract, catalog, skill, composer] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.7.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.7/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.14.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.7/skills/internal/working-backwards/SKILL.md"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.7/skills/internal/working-backwards/scripts/topic-questions.mjs"), "utf8"),
  ]);
  const workingBackwards = catalog.skills.find((entry) => entry.logicalName === "working-backwards");
  const orchestration = catalog.skills.find((entry) => entry.logicalName === "coding-orchestration");
  const pilot = catalog.skills.find((entry) => entry.logicalName === "orchestration-pilot");

  assert.equal(manifest.contractVersion, "1.5.7");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.7/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.14.0.json");
  assert.equal(catalog.catalogVersion, "0.14.0");
  assert.equal(workingBackwards.source.path, "artifacts/1.5.7/skills/internal/working-backwards");
  assert.deepEqual(workingBackwards.variants[0].executableFiles, [
    "scripts/t3-workflow.mjs",
    "scripts/t3-reader.mjs",
    "scripts/topic-questions.mjs",
  ]);
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
  assert.equal(orchestration.source.path, "artifacts/1.5.7/adapters");
  assert.equal(orchestration.variants[0].adapterContract, "bounded-measurable-orchestration-v4");
  assert.equal(pilot.source.path, "artifacts/1.5.7/skills/internal/orchestration-pilot");
  assert.match(contract, /one to three mutually related decisions/i);
  assert.match(contract, /five non-trivial candidate runs or five calendar days/i);
  assert.match(skill, /request_user_input/);
  assert.match(skill, /exact `chat` fallback/i);
  assert.match(composer, /composeTopicQuestions/);
  assert.match(composer, /between one and three related decisions/);
});

test("contract 1.5.8 scopes architecture inference to convergence prompts and publishes the agreed reference pack", async () => {
  const [manifest, contract, catalog, skill, references, aohysPrompt] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.8.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.8/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.15.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.8/skills/internal/working-backwards/SKILL.md"), "utf8"),
    readFile(resolve(root, "docs/architecture-reference-pack.md"), "utf8"),
    readFile(resolve(root, "docs/product-convergence/aohys.md"), "utf8"),
  ]);
  const workingBackwards = catalog.skills.find((entry) => entry.logicalName === "working-backwards");

  assert.equal(manifest.contractVersion, "1.5.8");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.8/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.15.0.json");
  assert.equal(catalog.catalogVersion, "0.15.0");
  assert.equal(workingBackwards.source.path, "artifacts/1.5.8/skills/internal/working-backwards");
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
  for (const expected of [
    "t3-oss/create-t3-turbo",
    "Formbricks",
    "TanStack Query",
    "TanStack Router",
    "A Philosophy of Software Design",
    "Domain Modeling Made Functional",
    "Building Evolutionary Architectures",
  ]) {
    assert.match(references, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), expected);
  }
  assert.match(aohysPrompt, /For this convergence initiative only/i);
  assert.match(aohysPrompt, /current state.*reference evidence.*fit.*inferred decision/is);
  assert.match(aohysPrompt, /present inferred architecture decisions for correction or approval/i);
  assert.match(aohysPrompt, /continue to ask.*complex product.*trade-offs/i);
  assert.match(skill, /ordinary natural-language approval/i);
  assert.match(contract, /does not make inference the global default/i);
});

test("contract 1.5.11 pins Matt Pocock v1.2.3 and restores whole-frontier grilling", async () => {
  const [manifest, contract, catalog, grilling, stewardSkill, stewardPrompt] = await Promise.all([
    readFile(resolve(root, "manifests/1.5.11.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.11/contract.md"), "utf8"),
    readFile(resolve(root, "catalog/0.18.0.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "artifacts/1.5.11/skills/upstream/grilling/SKILL.md"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.11/skills/internal/development-steward/SKILL.md"), "utf8"),
    readFile(resolve(root, "artifacts/1.5.11/skills/internal/development-steward/references/prompt.md"), "utf8"),
  ]);
  const mattSkills = catalog.skills.filter((skill) => skill.source.repository === "https://github.com/mattpocock/skills");
  const steward = catalog.skills.find((skill) => skill.logicalName === "development-steward");

  assert.equal(manifest.contractVersion, "1.5.11");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "development-contract").sourcePath, "artifacts/1.5.11/contract.md");
  assert.equal(manifest.artifacts.find((artifact) => artifact.logicalName === "skill-catalog").sourcePath, "catalog/0.18.0.json");
  assert.equal(catalog.catalogVersion, "0.18.0");
  assert.equal(mattSkills.length, 35);
  assert.equal(mattSkills.every((skill) => skill.source.commit === "6acc160e4e0cd062dbbbd7a1b26ae92855edf07e"), true);
  assert.match(grilling, /Ask the whole frontier in one round/i);
  assert.match(grilling, /recommended answer/i);
  assert.doesNotMatch(grilling, /Ask the questions one at a time/i);
  for (const retired of ["batch-grill-me", "design-an-interface", "edit-article", "obsidian-vault", "qa", "request-refactor-plan", "ubiquitous-language", "writing-great-skills"]) {
    assert.ok(catalog.cleanup.includes(`.agents/skills/${retired}`), retired);
  }
  assert.equal(steward.source.path, "artifacts/1.5.11/skills/internal/development-steward");
  assert.match(stewardSkill, /four explicit upstream checks/i);
  assert.match(stewardPrompt, /react-doctor[\s\S]*impeccable-cli[\s\S]*impeccable-skill[\s\S]*matt-pocock-skills/i);
  assert.match(contract, /stable release `v1\.2\.3`/i);
  assert.deepEqual(await validateSkillCatalog(catalog, root), []);
});
