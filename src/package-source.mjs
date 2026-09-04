// @ts-check

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

/**
 * Synchronous, git-less package provenance for npm-tarball distribution.
 *
 * Package mode is activated ONLY by a `.development-system-package.json` marker
 * at the package root. A present-but-invalid marker always throws: package mode
 * never silently falls back to Git validation. Provenance is bound by npm
 * tarball integrity/lockfiles, not a cryptographic signature.
 *
 * @typedef {Map<string, {sha256: string, executable: boolean}>} PackageFileTable
 * @typedef {{root: string, repository: string, commit: string, packageVersion: string, files: PackageFileTable}} PackageSource
 */

const canonicalRepository = "https://github.com/AO-HyS/development-system";
const canonicalPackageName = "@aohys/development-system";
const markerFilename = ".development-system-package.json";
const commitPattern = /^[a-f0-9]{40}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const semverPattern = /^\d+\.\d+\.\d+$/u;

/** @param {string | Buffer} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Validate a package-relative POSIX path. Rejects absolute paths, backslash
 * separators, traversal, empty, and dot segments, and returns the normalized
 * path used as the provenance key.
 * @param {unknown} candidate
 * @returns {string}
 */
function normalizePackagePath(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`Package source path must be a non-empty string: ${String(candidate)}`);
  }
  if (candidate.includes("\\")) {
    throw new Error(`Package source path must use POSIX separators: ${candidate}`);
  }
  if (candidate.includes("\0")) {
    throw new Error(`Package source path must not contain NUL bytes: ${candidate}`);
  }
  if (isAbsolute(candidate) || candidate.startsWith("/")) {
    throw new Error(`Package source path must be relative: ${candidate}`);
  }
  for (const segment of candidate.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Package source path must not contain empty, dot, or parent segments: ${candidate}`);
    }
  }
  return candidate;
}

/**
 * Resolve a validated package-relative path, refusing any escape from the
 * package root.
 * @param {string} packageRoot @param {string} normalized
 */
function resolvePackageTarget(packageRoot, normalized) {
  const resolvedRoot = resolve(packageRoot);
  const target = resolve(resolvedRoot, ...normalized.split("/"));
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Package source path escapes the package root: ${normalized}`);
  }
  return target;
}

/**
 * Walk every path component of a declared file with lstat, refusing symbolic
 * links and non-directory parents.
 * @param {string} packageRoot @param {string} normalized @param {string} target
 */
function assertNoSymbolicComponent(packageRoot, normalized, target) {
  let current = resolve(packageRoot);
  const rootStatus = lstatSync(current);
  if (rootStatus.isSymbolicLink()) {
    throw new Error(`Package root must not be a symbolic link: ${current}`);
  }
  for (const segment of normalized.split("/")) {
    current = resolve(current, segment);
    const status = lstatSync(current);
    if (status.isSymbolicLink()) {
      throw new Error(`Package source path must not traverse a symbolic link: ${normalized}`);
    }
    if (current !== target && !status.isDirectory()) {
      throw new Error(`Package source path parent is not a directory: ${normalized}`);
    }
  }
}

/**
 * Verify one declared packaged file against its provenance descriptor and
 * return its bytes.
 * @param {string} packageRoot @param {string} normalized @param {{sha256: string, executable: boolean}} descriptor
 * @returns {Buffer}
 */
function verifyDeclaredPackageFile(packageRoot, normalized, descriptor) {
  const target = resolvePackageTarget(packageRoot, normalized);
  assertNoSymbolicComponent(packageRoot, normalized, target);
  const status = lstatSync(target);
  if (!status.isFile()) {
    throw new Error(`Packaged file is not a regular file: ${normalized}`);
  }
  const contents = readFileSync(target);
  const actual = sha256(contents);
  if (actual !== descriptor.sha256) {
    throw new Error(`Packaged file hash mismatch for ${normalized}: expected ${descriptor.sha256}, got ${actual}`);
  }
  if (((status.mode & 0o111) !== 0) !== descriptor.executable) {
    throw new Error(`Packaged file executable bit mismatch for ${normalized}`);
  }
  return contents;
}

/**
 * Load and fully validate package provenance. Returns null only when the
 * marker is absent; any present-but-invalid marker throws, never falls back
 * to Git.
 * @param {string} root
 * @returns {PackageSource | null}
 */
export function loadPackageSource(root) {
  const packageRoot = resolve(root);
  let markerContents;
  try {
    if (lstatSync(resolve(packageRoot, markerFilename)).isSymbolicLink()) throw new Error("Package provenance marker must not be a symbolic link");
    markerContents = readFileSync(resolve(packageRoot, markerFilename), "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  let provenance;
  try {
    provenance = JSON.parse(markerContents);
  } catch (error) {
    throw new Error(`Package provenance ${markerFilename} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw new Error(`Package provenance ${markerFilename} must be a JSON object`);
  }
  const record = /** @type {Record<string, unknown>} */ (provenance);
  const rootKeys = Object.keys(record).sort().join(",");
  if (rootKeys !== "commit,files,packageVersion,repository,schemaVersion") {
    throw new Error(`Package provenance ${markerFilename} must declare exactly schemaVersion, repository, commit, packageVersion, and files`);
  }
  if (record.schemaVersion !== 1) {
    throw new Error("Package provenance schemaVersion must equal 1");
  }
  if (record.repository !== canonicalRepository) {
    throw new Error(`Package provenance repository must be ${canonicalRepository}`);
  }
  if (typeof record.commit !== "string" || !commitPattern.test(record.commit)) {
    throw new Error("Package provenance commit must be an exact lowercase 40-character Git commit");
  }
  if (typeof record.packageVersion !== "string" || !semverPattern.test(record.packageVersion)) {
    throw new Error("Package provenance packageVersion must use semantic versioning");
  }
  const declaredFiles = record.files;
  if (declaredFiles === null || typeof declaredFiles !== "object" || Array.isArray(declaredFiles)) {
    throw new Error("Package provenance files must be an object of relative paths");
  }
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (declaredFiles));
  if (entries.length === 0) {
    throw new Error("Package provenance must declare at least one file");
  }

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  } catch (error) {
    if (isMissing(error)) throw new Error("Package provenance requires a package.json at the package root");
    throw error;
  }
  if (
    /** @type {Record<string, unknown>} */ (packageJson).name !== canonicalPackageName ||
    /** @type {Record<string, unknown>} */ (packageJson).version !== record.packageVersion
  ) {
    throw new Error(`Package provenance packageVersion ${record.packageVersion} must match package.json ${canonicalPackageName} version`);
  }

  /** @type {PackageFileTable} */
  const files = new Map();
  for (const [candidatePath, rawDescriptor] of entries) {
    const normalized = normalizePackagePath(candidatePath);
    if (files.has(normalized)) {
      throw new Error(`Package provenance contains duplicate normalized paths: ${normalized}`);
    }
    if (rawDescriptor === null || typeof rawDescriptor !== "object" || Array.isArray(rawDescriptor)) {
      throw new Error(`Package provenance entry for ${normalized} must be an object`);
    }
    const descriptor = /** @type {Record<string, unknown>} */ (rawDescriptor);
    if (Object.keys(descriptor).sort().join(",") !== "executable,sha256") {
      throw new Error(`Package provenance entry for ${normalized} must declare exactly sha256 and executable`);
    }
    if (typeof descriptor.sha256 !== "string" || !hashPattern.test(descriptor.sha256)) {
      throw new Error(`Package provenance entry for ${normalized} has an invalid sha256`);
    }
    if (typeof descriptor.executable !== "boolean") {
      throw new Error(`Package provenance entry for ${normalized} has an invalid executable flag`);
    }
    files.set(normalized, { sha256: descriptor.sha256, executable: descriptor.executable });
  }

  /** @type {PackageSource} */
  const source = {
    root: packageRoot,
    repository: canonicalRepository,
    commit: record.commit,
    packageVersion: record.packageVersion,
    files,
  };
  // Package managers may install dependencies beside the package source. They
  // are not part of this zero-runtime-dependency package's canonical inventory.
  /** @param {string} directory @param {string} prefix */
  function verifyInventory(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && (entry.name === markerFilename || entry.name === "node_modules")) continue;
      if (entry.isSymbolicLink()) throw new Error(`Package source path must not traverse a symbolic link: ${relativePath}`);
      if (entry.isDirectory()) verifyInventory(resolve(directory, entry.name), relativePath);
      else if (!entry.isFile() || !files.has(relativePath)) throw new Error(`Unlisted file in package: ${relativePath}`);
    }
  }
  verifyInventory(packageRoot, "");
  for (const [normalized, descriptor] of files) {
    verifyDeclaredPackageFile(source.root, normalized, descriptor);
  }
  return source;
}

/**
 * Verify one packaged file against the provenance table and the expected
 * canonical hash, returning its actual hash.
 * @param {PackageSource} source @param {string} relativePath @param {string} expectedSha256
 * @returns {string}
 */
export function verifyPackageFile(source, relativePath, expectedSha256) {
  if (typeof expectedSha256 !== "string" || !hashPattern.test(expectedSha256)) {
    throw new Error(`Expected package file hash is invalid: ${relativePath}`);
  }
  const normalized = normalizePackagePath(relativePath);
  const declared = source.files.get(normalized);
  if (!declared) {
    throw new Error(`Package provenance does not declare the file: ${normalized}`);
  }
  if (declared.sha256 !== expectedSha256) {
    throw new Error(`Package provenance hash for ${normalized} (${declared.sha256}) does not match the expected hash ${expectedSha256}`);
  }
  const contents = verifyDeclaredPackageFile(source.root, normalized, declared);
  return sha256(contents);
}

/**
 * Read the verified bytes of one packaged file.
 * @param {PackageSource} source @param {string} relativePath
 * @returns {Buffer}
 */
export function packageFileBytes(source, relativePath) {
  const normalized = normalizePackagePath(relativePath);
  const declared = source.files.get(normalized);
  if (!declared) {
    throw new Error(`Package provenance does not declare the file: ${normalized}`);
  }
  return verifyDeclaredPackageFile(source.root, normalized, declared);
}

/**
 * Whether a packaged file is declared executable and still verifies.
 * @param {PackageSource} source @param {string} relativePath
 * @returns {boolean}
 */
export function packageFileIsExecutable(source, relativePath) {
  const normalized = normalizePackagePath(relativePath);
  const declared = source.files.get(normalized);
  if (!declared || declared.executable !== true) return false;
  verifyDeclaredPackageFile(source.root, normalized, declared);
  return true;
}

/**
 * Hash a packaged directory from provenance-verified files, using the same
 * algorithm as the canonical Git tree hashing. Rejects symbolic links,
 * unlisted files, and declared-but-missing files.
 * @param {PackageSource} source @param {string} relativeDirectory
 * @returns {string}
 */
export function packageDirectoryHash(source, relativeDirectory) {
  const normalizedDirectory = normalizePackagePath(relativeDirectory);
  const directoryTarget = resolvePackageTarget(source.root, normalizedDirectory);
  const directoryStatus = lstatSync(directoryTarget);
  if (directoryStatus.isSymbolicLink()) {
    throw new Error(`Package source directory must not be a symbolic link: ${normalizedDirectory}`);
  }
  if (!directoryStatus.isDirectory()) {
    throw new Error(`Package source directory is not a directory: ${normalizedDirectory}`);
  }
  const directoryPrefix = `${normalizedDirectory}/`;
  /** @type {Map<string, {sha256: string, executable: boolean}>} */
  const declaredUnderDirectory = new Map();
  for (const [path, descriptor] of source.files) {
    if (path.startsWith(directoryPrefix)) {
      declaredUnderDirectory.set(path.slice(directoryPrefix.length), descriptor);
    }
  }
  if (declaredUnderDirectory.size === 0) {
    throw new Error(`Package provenance declares no files under ${normalizedDirectory}`);
  }
  /** @type {Array<{path: string, contents: Buffer}>} */
  const observed = [];
  /** @param {string} directory */
  function walk(directory) {
    for (const entry of readdirSync(resolve(source.root, ...directory.split("/")), { withFileTypes: true })) {
      const entryPath = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`Package source contains a symbolic link: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported packaged entry type: ${entryPath}`);
      }
      const descriptor = declaredUnderDirectory.get(entryPath.slice(directoryPrefix.length));
      if (!descriptor) {
        throw new Error(`Package source contains an unlisted file: ${entryPath}`);
      }
      const contents = verifyDeclaredPackageFile(source.root, entryPath, descriptor);
      observed.push({ path: entryPath.slice(directoryPrefix.length), contents });
    }
  }
  walk(normalizedDirectory);
  for (const path of declaredUnderDirectory.keys()) {
    if (!observed.some((file) => file.path === path)) {
      throw new Error(`Packaged file declared under ${normalizedDirectory} is missing: ${path}`);
    }
  }
  observed.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of observed) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}
