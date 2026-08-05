// @ts-check

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionIndex = process.argv.indexOf("--version");
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : "1.1.1";
if (version !== "1.1.1") {
  throw new Error("Published manifests are immutable; generator supports only unpublished version 1.1.1");
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

const previousVersion = "1.1.0";
const catalogVersion = "0.5.1";
const previous = JSON.parse(await readFile(resolve(repositoryRoot, "manifests", `${previousVersion}.json`), "utf8"));
const contractPath = `artifacts/${version}/contract.md`;
const catalogPath = `catalog/${catalogVersion}.json`;
const contractHash = sha256(await readFile(resolve(repositoryRoot, contractPath)));
const catalogHash = sha256(await readFile(resolve(repositoryRoot, catalogPath)));
const manifest = {
  ...previous,
  contractVersion: version,
  artifacts: previous.artifacts.map((/** @type {any} */ artifact) => {
    if (["dual-interface-contract", "development-contract"].includes(artifact.logicalName)) {
      return {
        ...artifact,
        id: artifact.harness === "codex" ? "development-contract.codex" : "development-contract.factory",
        logicalName: "development-contract",
        sourcePath: contractPath,
        sha256: contractHash,
        expectedMirrorOf: artifact.harness === "codex" ? null : "development-contract.codex",
      };
    }
    if (artifact.logicalName === "skill-catalog") {
      return {
        ...artifact,
        sourcePath: catalogPath,
        sha256: catalogHash,
      };
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
