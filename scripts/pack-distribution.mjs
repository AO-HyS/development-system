#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackageSource } from "../src/package-source.mjs";

/**
 * Deterministic npm distribution builder.
 *
 * Stages ONLY committed runtime package files from Git HEAD, writes the
 * `.development-system-package.json` provenance marker validated by
 * src/package-source.mjs, runs `npm pack --ignore-scripts`, validates the
 * tarball inventory and its extraction, and copies the tarball to the output
 * directory. No network, no publish, no signature claims: provenance is bound
 * by npm tarball integrity and lockfiles only.
 */

const canonicalRepository = "https://github.com/AO-HyS/development-system";
const canonicalPackageName = "@aohys/development-system";
const markerFilename = ".development-system-package.json";
const commitPattern = /^[a-f0-9]{40}$/u;
const semverPattern = /^\d+\.\d+\.\d+$/u;
const hashPattern = /^[a-f0-9]{64}$/u;

/** Top-level runtime paths eligible for distribution. */
const runtimeTopLevelPaths = [
  "package.json",
  "README.md",
  "LICENSE",
  "bin",
  "src",
  "config",
  "artifacts",
  "manifests",
  "catalog",
  "scripts",
];
const builderPath = "scripts/pack-distribution.mjs";
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
function isRuntimePath(path) {
  if (path === builderPath) return false;
  if (runtimeTopLevelPaths.includes(path)) return true;
  return runtimeTopLevelPaths.includes(path.split("/")[0]);
}

/** @param {string | Buffer} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** @param {string | Buffer} contents */
function sha512Sri(contents) {
  return `sha512-${createHash("sha512").update(contents).digest("base64")}`;
}

/** @param {string} root @param {...string} args */
function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Reject a source whose tracked runtime paths are dirty or whose untracked
 * files fall inside distributable runtime paths. Untracked unrelated files
 * (private reports, docs, tests) are ignored: they never enter the tarball.
 * The pack builder itself is outside the runtime scope: its bytes are not
 * shipped, so editing it does not invalidate the canonical commit binding.
 * @param {string} root
 */
function assertCleanRuntimeSource(root) {
  const status = git(root, "status", "--porcelain", "-z", "--untracked-files=normal")
    .toString("utf8");
  const entries = status.split("\0").filter(Boolean);
  for (const entry of entries) {
    const flags = entry.slice(0, 2);
    const path = entry.slice(3).split(" -> ").at(-1) ?? "";
    if (!path || !isRuntimePath(path)) continue;
    if (flags.includes("?")) {
      throw new Error(`Packaging requires a clean canonical source: untracked path ${path} is inside the distributable runtime paths`);
    }
    throw new Error(`Packaging requires a clean canonical source: tracked path ${path} has uncommitted changes`);
  }
}

/**
 * Enumerate the committed runtime files at HEAD with modes.
 * @param {string} root @param {string} commit
 * @returns {Array<{path: string, executable: boolean}>}
 */
function enumerateCommittedRuntimeFiles(root, commit) {
  const listing = git(root, "ls-tree", "-r", "-z", commit).toString("utf8");
  /** @type {Array<{path: string, executable: boolean}>} */
  const files = [];
  for (const record of listing.split("\0").filter(Boolean)) {
    const match = record.match(/^(\d{6}) (blob|tree|commit) [a-f0-9]{40,64}\t(.+)$/);
    if (!match) throw new Error(`Unsupported git ls-tree entry: ${record}`);
    const [, mode, type, path] = match;
    if (!isRuntimePath(path)) continue;
    if (type !== "blob") throw new Error(`Runtime path ${path} is not a regular committed file (${type})`);
    if (mode === "120000") throw new Error(`Runtime path ${path} is a symbolic link; distributions stage only regular files`);
    if (mode !== "100644" && mode !== "100755") {
      throw new Error(`Runtime path ${path} has unsupported mode ${mode}`);
    }
    files.push({ path, executable: mode === "100755" });
  }
  if (!files.some((file) => file.path === "package.json")) {
    throw new Error("Canonical source has no committed runtime package.json");
  }
  return files;
}

/**
 * Stage committed runtime files from HEAD into a clean directory using
 * git archive (byte- and mode-preserving), then verify what landed on disk.
 * @param {string} root @param {string} commit @param {Array<{path: string, executable: boolean}>} files @param {string} stage
 * @returns {Array<{path: string, executable: boolean}>}
 */
function stageCommittedFiles(root, commit, files, stage) {
  const topPaths = [...new Set(files.map((file) => file.path.split("/")[0]))];
  const archive = git(root, "archive", "--format=tar", commit, "--", ...topPaths, `:(exclude)${builderPath}`);
  const archivePath = join(mkdtempSync(join(tmpdir(), "ds-pack-archive-")), "stage.tar");
  writeFileSync(archivePath, archive);
  try {
    const extracted = spawnSync("tar", ["-xf", archivePath, "-C", stage], { encoding: "utf8" });
    if (extracted.status !== 0) {
      throw new Error(`Staging from the canonical commit failed: ${extracted.stderr}`);
    }
  } finally {
    rmSync(archivePath, { force: true });
    rmSync(dirname(archivePath), { recursive: true, force: true });
  }
  const stagedPaths = new Set(files.map((file) => file.path));
  /** @type {string[]} */
  const observedPaths = [];
  /** @param {string} directory */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Staging produced a symbolic link: ${directory}`);
      }
      if (entry.isDirectory()) {
        walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Staging produced an unsupported entry: ${join(directory, entry.name)}`);
      }
      observedPaths.push(relative(stage, join(directory, entry.name)).split(sep).join("/"));
    }
  }
  walk(stage);
  observedPaths.sort();
  const expectedPaths = [...stagedPaths].sort();
  if (JSON.stringify(observedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(`Staged files diverge from the canonical commit inventory: observed ${observedPaths.join(", ")}`);
  }
  return files;
}

/**
 * Confirm staged modes match the canonical commit modes.
 * @param {string} stage @param {Array<{path: string, executable: boolean}>} files
 */
function verifyStagedModes(stage, files) {
  for (const file of files) {
    const status = lstatSync(join(stage, ...file.path.split("/")));
    if (((status.mode & 0o111) !== 0) !== file.executable) {
      throw new Error(`Staged file mode does not match the canonical commit mode: ${file.path}`);
    }
  }
}

function resolveNpmCommand() {
  if (process.env.AOHYS_NPM) return process.env.AOHYS_NPM;
  const candidates = ["npm", join(dirname(process.execPath), "npm")];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("npm CLI was not found; set AOHYS_NPM to an npm executable");
}

/**
 * Build the distribution: stage, marker, pack, validate.
 * @param {{output?: string, root?: string}} options
 */
export function buildDistribution(options = {}) {
  const root = resolve(options.root ?? defaultRoot);
  const outputDirectory = resolve(options.output ?? join(root, "private", "tmp"));
  const npmCommand = resolveNpmCommand();
  const stage = mkdtempSync(join(tmpdir(), "ds-pack-stage-"));
  const packDestination = mkdtempSync(join(tmpdir(), "ds-pack-out-"));
  const extractDirectory = mkdtempSync(join(tmpdir(), "ds-pack-extract-"));
  try {
    const commit = git(root, "rev-parse", "HEAD").toString("utf8").trim();
    if (!commitPattern.test(commit)) {
      throw new Error(`Canonical source HEAD is not an exact Git commit: ${commit}`);
    }
    assertCleanRuntimeSource(root);
    const files = enumerateCommittedRuntimeFiles(root, commit);
    const staged = stageCommittedFiles(root, commit, files, stage);
    verifyStagedModes(stage, staged);

    const packageJson = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
    if (packageJson.name !== canonicalPackageName) {
      throw new Error(`Runtime package.json name must be ${canonicalPackageName}`);
    }
    if (typeof packageJson.version !== "string" || !semverPattern.test(packageJson.version)) {
      throw new Error("Runtime package.json version must use semantic versioning");
    }
    const packageVersion = packageJson.version;

    /** @type {Record<string, {sha256: string, executable: boolean}>} */
    const provenanceFiles = {};
    for (const file of staged) {
      const bytes = readFileSync(join(stage, ...file.path.split("/")));
      const hash = sha256(bytes);
      if (!hashPattern.test(hash)) throw new Error(`Staged file hash is invalid: ${file.path}`);
      provenanceFiles[file.path] = { sha256: hash, executable: file.executable };
    }
    const marker = {
      schemaVersion: 1,
      repository: canonicalRepository,
      commit,
      packageVersion,
      files: provenanceFiles,
    };
    writeFileSync(
      join(stage, markerFilename),
      `${JSON.stringify(marker, null, 2)}\n`,
    );

    const packResult = spawnSync(
      npmCommand,
      ["pack", "--ignore-scripts", "--json", "--pack-destination", packDestination],
      { cwd: stage, encoding: "utf8" },
    );
    if (packResult.status !== 0 || !packResult.stdout.trim()) {
      throw new Error(`npm pack failed: ${packResult.stderr}`);
    }
    /** @type {Array<{filename?: string, name?: string, version?: string}>} */
    const packed = JSON.parse(packResult.stdout);
    const tarballName = packed[0]?.filename;
    if (typeof tarballName !== "string" || !tarballName) {
      throw new Error("npm pack did not report a tarball filename");
    }
    if (packed[0]?.name !== canonicalPackageName || packed[0]?.version !== packageVersion) {
      throw new Error("npm pack reported a different package identity than the canonical package.json");
    }
    const tarballPath = join(packDestination, tarballName);

    const inventory = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
    if (inventory.status !== 0) {
      throw new Error(`Tarball inventory failed: ${inventory.stderr}`);
    }
    const tarballPaths = new Set(
      inventory.stdout.split("\n")
        .map((line) => line.trim())
        .filter((line) => line && line !== "package" && line !== "package/" && !line.endsWith("/"))
        .map((line) => line.startsWith("package/") ? line.slice("package/".length) : line),
    );
    const expectedPaths = new Set([...Object.keys(provenanceFiles), markerFilename]);
    for (const path of tarballPaths) {
      if (!expectedPaths.has(path)) {
        throw new Error(`Tarball contains an unexpected path: ${path}`);
      }
    }
    for (const path of expectedPaths) {
      if (!tarballPaths.has(path)) {
        throw new Error(`Tarball is missing the packaged path: ${path}`);
      }
    }

    const extraction = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDirectory], { encoding: "utf8" });
    if (extraction.status !== 0) {
      throw new Error(`Tarball extraction failed: ${extraction.stderr}`);
    }
    const extractedRoot = join(extractDirectory, "package");
    const extractedSource = loadPackageSource(extractedRoot);
    if (!extractedSource) {
      throw new Error(`Extracted tarball has no ${markerFilename}`);
    }
    if (extractedSource.commit !== commit || extractedSource.packageVersion !== packageVersion) {
      throw new Error("Extracted tarball provenance does not bind the canonical commit and version");
    }

    mkdirSync(outputDirectory, { recursive: true });
    const tarballBytes = readFileSync(tarballPath);
    const destinationPath = join(outputDirectory, tarballName);
    copyFileSync(tarballPath, destinationPath);

    return {
      ok: true,
      operation: "pack-distribution",
      filename: tarballName,
      path: destinationPath,
      commit,
      version: packageVersion,
      stagedFileCount: staged.length,
      sha256: sha256(tarballBytes),
      sha512: sha512Sri(tarballBytes),
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
    rmSync(packDestination, { recursive: true, force: true });
    rmSync(extractDirectory, { recursive: true, force: true });
  }
}

/** @param {string[]} argv */
export function parsePackArguments(argv) {
  let output;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--output") {
      output = argv[index + 1];
      if (!output) throw new Error("--output requires an absolute directory");
      index += 2;
      continue;
    }
    throw new Error(`Unknown pack option: ${token}`);
  }
  return { output };
}

async function main() {
  try {
    const { output } = parsePackArguments(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(buildDistribution({ output }), null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Development System pack error: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
