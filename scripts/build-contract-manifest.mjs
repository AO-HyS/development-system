// @ts-check

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionIndex = process.argv.indexOf("--version");
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : "1.5.18";
if (version !== "1.5.18") {
  throw new Error("Published manifests are immutable; generator supports only unpublished version 1.5.18");
}
const destination = resolve(repositoryRoot, "manifests", `${version}.json`);
const allowUnpublishedRewrite = process.argv.includes("--rewrite-unpublished");
await readFile(destination).then(
  () => { if (!allowUnpublishedRewrite) throw new Error(`Refusing to overwrite immutable manifest ${version}; add a new semantic version`); },
  (error) => { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; },
);

/** @param {string | Buffer} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

const previousVersion = "1.5.17";
const catalogVersion = "0.25.0";
const previous = JSON.parse(await readFile(resolve(repositoryRoot, "manifests", `${previousVersion}.json`), "utf8"));
const contractPath = `artifacts/${version}/contract.md`;
const catalogPath = `catalog/${catalogVersion}.json`;
const contractHash = sha256(await readFile(resolve(repositoryRoot, contractPath)));
const catalogHash = sha256(await readFile(resolve(repositoryRoot, catalogPath)));
const operatorInterfacePath = "artifacts/1.5.0/operator-interface.md";
const operatorInterfaceHash = sha256(await readFile(resolve(repositoryRoot, operatorInterfacePath)));
const harnessAdaptersPath = "config/1.5.0/harness-adapters.json";
const harnessAdaptersHash = sha256(await readFile(resolve(repositoryRoot, harnessAdaptersPath)));
const capabilityRosterPath = "config/1.5.16/capability-roster.json";
const capabilityRosterHash = sha256(await readFile(resolve(repositoryRoot, capabilityRosterPath)));
// Model routing, the fast implementer agent, and the capability roster are
// unchanged in 1.5.18, so the manifest keeps their published 1.5.16 sources.
const modelRoutingPath = "artifacts/1.5.16/model-routing.md";
const modelRoutingHash = sha256(await readFile(resolve(repositoryRoot, modelRoutingPath)));
const qualityPath = "artifacts/1.5.0/quality/stack-quality-profiles.json";
const qualityHash = sha256(await readFile(resolve(repositoryRoot, qualityPath)));
const stewardSchedulePath = "artifacts/1.5.1/steward/schedule.json";
const stewardScheduleHash = sha256(await readFile(resolve(repositoryRoot, stewardSchedulePath)));
const architectureReferencePath = "artifacts/1.5.10/architecture-reference-pack.md";
const architectureReferenceHash = sha256(await readFile(resolve(repositoryRoot, architectureReferencePath)));
const fastImplementerPath = "artifacts/1.5.16/agents/codex/fast-implementer.toml";
const fastImplementerHash = sha256(await readFile(resolve(repositoryRoot, fastImplementerPath)));
const manifest = {
  ...previous,
  contractVersion: version,
  supportedHarnesses: [
    { id: "codex", adapter: "native" },
    { id: "t3code", adapter: "codex" },
  ],
  artifacts: [...previous.artifacts.filter((/** @type {any} */ artifact) => artifact.harness !== "factory" && artifact.logicalName !== "architecture-reference-pack" && artifact.logicalName !== "codex-agent-computer-use-runner").map((/** @type {any} */ artifact) => {
    if (["dual-interface-contract", "development-contract"].includes(artifact.logicalName)) {
      return {
        ...artifact,
        id: "development-contract.codex",
        logicalName: "development-contract",
        sourcePath: contractPath,
        sha256: contractHash,
        expectedMirrorOf: null,
      };
    }
    if (artifact.logicalName === "codex-agent-fast-implementer") {
      return { ...artifact, sourcePath: fastImplementerPath, sha256: fastImplementerHash };
    }
    if (artifact.logicalName === "skill-catalog") {
      return {
        ...artifact,
        sourcePath: catalogPath,
        sha256: catalogHash,
      };
    }
    if (artifact.logicalName === "operator-interface") {
      return { ...artifact, sourcePath: operatorInterfacePath, sha256: operatorInterfaceHash };
    }
    if (artifact.logicalName === "harness-adapters") {
      return { ...artifact, sourcePath: harnessAdaptersPath, sha256: harnessAdaptersHash };
    }
    if (artifact.logicalName === "capability-roster") {
      return { ...artifact, sourcePath: capabilityRosterPath, sha256: capabilityRosterHash };
    }
    if (artifact.logicalName === "stack-quality-profiles") {
      return { ...artifact, sourcePath: qualityPath, sha256: qualityHash };
    }
    if (artifact.logicalName === "development-steward-schedule") {
      return { ...artifact, sourcePath: stewardSchedulePath, sha256: stewardScheduleHash };
    }
    return artifact;
  }), {
    id: "architecture-reference-pack.codex",
    logicalName: "architecture-reference-pack",
    sourcePath: architectureReferencePath,
    destination: ".codex/development-system/architecture-reference-pack.md",
    harness: "codex",
    sha256: architectureReferenceHash,
    expectedMirrorOf: null,
  }],
};
const computerUseRunnerPath = "artifacts/1.5.15/agents/codex/computer-use-runner.toml";
const computerUseRunnerHash = sha256(await readFile(resolve(repositoryRoot, computerUseRunnerPath)));
manifest.artifacts.push({
  id: "codex-agent.computer-use-runner",
  logicalName: "codex-agent-computer-use-runner",
  sourcePath: computerUseRunnerPath,
  destination: ".codex/agents/computer-use-runner.toml",
  harness: "codex",
  sha256: computerUseRunnerHash,
  expectedMirrorOf: null,
});
if (!manifest.artifacts.some((/** @type {any} */ artifact) => artifact.logicalName === "model-routing")) {
  manifest.artifacts.push({
    id: "model-routing.codex",
    logicalName: "model-routing",
    sourcePath: modelRoutingPath,
    destination: ".codex/development-system/model-routing.md",
    harness: "codex",
    sha256: modelRoutingHash,
    expectedMirrorOf: null,
  });
}
await writeFile(
  destination,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Wrote manifests/${version}.json with ${manifest.artifacts.length} artifacts.\n`);
