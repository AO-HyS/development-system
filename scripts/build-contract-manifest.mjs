// @ts-check

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionIndex = process.argv.indexOf("--version");
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : "1.5.7";
if (version !== "1.5.7") {
  throw new Error("Published manifests are immutable; generator supports only unpublished version 1.5.7");
}
const destination = resolve(repositoryRoot, "manifests", `${version}.json`);
await readFile(destination).then(
  () => { throw new Error(`Refusing to overwrite immutable manifest ${version}; add a new semantic version`); },
  (error) => { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; },
);

/** @param {string | Buffer} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

const previousVersion = "1.5.6";
const catalogVersion = "0.14.0";
const previous = JSON.parse(await readFile(resolve(repositoryRoot, "manifests", `${previousVersion}.json`), "utf8"));
const contractPath = `artifacts/${version}/contract.md`;
const catalogPath = `catalog/${catalogVersion}.json`;
const contractHash = sha256(await readFile(resolve(repositoryRoot, contractPath)));
const catalogHash = sha256(await readFile(resolve(repositoryRoot, catalogPath)));
const operatorInterfacePath = "artifacts/1.5.0/operator-interface.md";
const operatorInterfaceHash = sha256(await readFile(resolve(repositoryRoot, operatorInterfacePath)));
const harnessAdaptersPath = "config/1.5.0/harness-adapters.json";
const harnessAdaptersHash = sha256(await readFile(resolve(repositoryRoot, harnessAdaptersPath)));
const capabilityRosterPath = "config/1.5.0/capability-roster.json";
const capabilityRosterHash = sha256(await readFile(resolve(repositoryRoot, capabilityRosterPath)));
const qualityPath = "artifacts/1.5.0/quality/stack-quality-profiles.json";
const qualityHash = sha256(await readFile(resolve(repositoryRoot, qualityPath)));
const stewardSchedulePath = "artifacts/1.5.1/steward/schedule.json";
const stewardScheduleHash = sha256(await readFile(resolve(repositoryRoot, stewardSchedulePath)));
const manifest = {
  ...previous,
  contractVersion: version,
  supportedHarnesses: [
    { id: "codex", adapter: "native" },
    { id: "t3code", adapter: "codex" },
  ],
  artifacts: previous.artifacts.filter((/** @type {any} */ artifact) => artifact.harness !== "factory").map((/** @type {any} */ artifact) => {
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
  }),
};
await writeFile(
  destination,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Wrote manifests/${version}.json with ${manifest.artifacts.length} artifacts.\n`);
