#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillCatalog } from "../src/skills.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "1.23.2";
const artifactRoot = `artifacts/${version}`;
const args = process.argv.slice(2);
if (args.some((arg) => !["--write", "--check", "--snapshot-runtime"].includes(arg))
  || (args.includes("--check") && args.includes("--write"))
  || (args.includes("--snapshot-runtime") && !args.includes("--write"))) {
  throw new Error("Usage: build-orchestration-release.mjs <--check|--write [--snapshot-runtime]>");
}
const write = args.includes("--write");
if (write) {
  let recorded = false;
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:manifests/${version}.json`], { cwd: repositoryRoot, stdio: "ignore" });
    recorded = true;
  } catch { /* Only the not-yet-committed 1.23.2 candidate may be regenerated. */ }
  if (recorded) throw new Error("Refusing to rewrite the recorded 1.23.2 manifest; prepare a new semantic version");
}
const runtimePaths = [
  "config/1.23.0/orchestration-policy.json",
  "config/1.23.0/api-prices.json",
  "src/orchestration.mjs",
  "src/orchestration-store.mjs",
  "src/model-execution.mjs",
  "scripts/run-jev-workflow.mjs",
  "scripts/measure-jev-workflow.mjs",
  "scripts/orchestration-hook.mjs",
];

/** @param {string | Buffer} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** @param {string} sourcePath */
async function digest(sourcePath) {
  return sha256(await readFile(resolve(repositoryRoot, sourcePath)));
}

if (args.includes("--snapshot-runtime")) {
  // Read the complete set before writing any candidate snapshot.
  const inputs = await Promise.all(runtimePaths.map(async (sourcePath) => ({
    sourcePath,
    artifactPath: `${artifactRoot}/runtime/${sourcePath}`,
    bytes: await readFile(resolve(repositoryRoot, sourcePath)),
  })));
  for (const input of inputs) {
    await mkdir(dirname(resolve(repositoryRoot, input.artifactPath)), { recursive: true });
    await writeFile(resolve(repositoryRoot, input.artifactPath), input.bytes);
  }
  const provenance = {
    schemaVersion: 1,
    contractVersion: version,
    status: "unpublished candidate",
    sources: inputs.map(({ sourcePath, artifactPath, bytes }) => ({ sourcePath, artifactPath, sha256: sha256(bytes) })),
  };
  await writeFile(resolve(repositoryRoot, artifactRoot, "runtime-source-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
}

const previous = JSON.parse(await readFile(resolve(repositoryRoot, "manifests/1.23.1.json"), "utf8"));
const catalogPath = "catalog/0.43.1.json";
const catalog = JSON.parse(await readFile(resolve(repositoryRoot, catalogPath), "utf8"));
if (catalog.catalogVersion !== "0.43.1") throw new Error("Candidate must retain the published 0.43.1 catalog");
const catalogErrors = await validateSkillCatalog(catalog, repositoryRoot);
if (catalogErrors.length) throw new Error(`Candidate catalog is invalid:\n- ${catalogErrors.join("\n- ")}`);

/** @type {any[]} */
const artifacts = [];
for (const artifact of previous.artifacts) {
  const sourcePath = artifact.sourcePath.startsWith("artifacts/1.23.1/")
    ? `${artifactRoot}/${artifact.sourcePath.slice("artifacts/1.23.1/".length)}`
    : artifact.sourcePath;
  const actual = await digest(sourcePath);
  if (sourcePath === artifact.sourcePath && actual !== artifact.sha256) {
    throw new Error(`Cannot carry forward drifted published artifact ${artifact.id}`);
  }
  artifacts.push({ ...artifact, sourcePath, sha256: actual });
}

const runtimeProvenance = JSON.parse(await readFile(resolve(repositoryRoot, artifactRoot, "runtime-source-provenance.json"), "utf8"));
if (runtimeProvenance.contractVersion !== version || runtimeProvenance.sources.length !== runtimePaths.length) {
  throw new Error("Candidate runtime provenance does not declare the complete runtime source set");
}
for (const sourcePath of runtimePaths) {
  const artifactPath = `${artifactRoot}/runtime/${sourcePath}`;
  const pin = runtimeProvenance.sources.find((/** @type {any} */ item) => item.sourcePath === sourcePath && item.artifactPath === artifactPath);
  if (!pin || pin.sha256 !== await digest(artifactPath)) throw new Error(`Runtime snapshot differs from its source provenance: ${sourcePath}`);
  if (pin.sha256 !== await digest(sourcePath)) throw new Error(`Runtime source changed after snapshot: ${sourcePath}`);
  const installed = artifacts.find((artifact) => artifact.sourcePath === artifactPath);
  if (!installed || installed.sha256 !== pin.sha256 || installed.destination !== `.codex/development-system/runtime/${sourcePath}`) {
    throw new Error(`Runtime source is missing its explicit manifest binding: ${sourcePath}`);
  }
}

const priorDestinations = new Set(previous.artifacts.map((/** @type {any} */ artifact) => artifact.destination));
for (const destination of priorDestinations) {
  if (!artifacts.some((artifact) => artifact.destination === destination)) throw new Error(`Candidate dropped a managed destination: ${destination}`);
}
if (new Set(artifacts.map((artifact) => artifact.destination)).size !== artifacts.length) throw new Error("Candidate has duplicate destinations");
const manifest = { ...previous, contractVersion: version, artifacts };
const manifestPath = resolve(repositoryRoot, "manifests", `${version}.json`);
const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
if (write) await writeFile(manifestPath, bytes);
else if (await readFile(manifestPath, "utf8") !== bytes) throw new Error("Candidate manifest differs from reviewed source snapshots; rebuild the unpublished 1.23.2 candidate explicitly");
process.stdout.write(`${write ? "Wrote" : "Verified"} manifests/${version}.json: ${artifacts.length} artifacts, all ${previous.artifacts.length} prior destinations retained.\n`);
