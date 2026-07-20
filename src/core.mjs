// @ts-check

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} Harness
 * @property {string} id
 * @property {string} adapter
 */

/**
 * @typedef {object} Artifact
 * @property {string} id
 * @property {string} logicalName
 * @property {string} sourcePath
 * @property {string} destination
 * @property {string} harness
 * @property {string} sha256
 * @property {string | null} expectedMirrorOf
 */

/**
 * @typedef {object} ContractManifest
 * @property {number} schemaVersion
 * @property {string} contractVersion
 * @property {{repository: string, commit: string}} source
 * @property {Harness[]} supportedHarnesses
 * @property {Artifact[]} artifacts
 * @property {string=} installedAt
 */

/**
 * @typedef {object} InstallState
 * @property {number} schemaVersion
 * @property {string} currentVersion
 * @property {string} installedManifestSha256
 * @property {SnapshotReference[]} history
 */

/**
 * @typedef {object} SnapshotReference
 * @property {string} id
 * @property {string} sha256
 */

/**
 * @typedef {object} SnapshotFile
 * @property {string} destination
 * @property {boolean} existed
 * @property {string | null} backupPath
 * @property {string | null} sha256
 */

/**
 * @typedef {object} Snapshot
 * @property {string} id
 * @property {InstallState | null} previousState
 * @property {ContractManifest | null} previousInstalledManifest
 * @property {SnapshotFile[]} files
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = ".development-system";
const manifestFilename = "installed-manifest.json";
const stateFilename = "state.json";
const commitPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const snapshotIdPattern = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @param {string | Buffer} contents */
function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** @param {unknown} error */
function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * @template T
 * @param {string} path
 * @param {T} fallback
 * @returns {Promise<T>}
 */
async function readJsonOr(path, fallback) {
  try {
    return /** @type {T} */ (JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissingFileError(error)) {
      return fallback;
    }
    throw error;
  }
}

/** @param {string} path @param {unknown} value */
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return sha256(`${JSON.stringify(value, null, 2)}\n`);
}

/** @param {string} path @param {string | Buffer} contents */
async function writeFileAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, path);
}

/** @param {string} path */
async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

/** @param {unknown} error */
function isMissingOrNonEmptyDirectoryError(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST")
  );
}

/** @param {string} home @param {string} destination */
function resolveHomePath(home, destination) {
  if (isAbsolute(destination)) {
    throw new Error(`Manifest destination must be relative: ${destination}`);
  }
  const resolvedHome = resolve(home);
  const target = resolve(resolvedHome, destination);
  if (target !== resolvedHome && !target.startsWith(`${resolvedHome}${sep}`)) {
    throw new Error(`Manifest destination escapes HOME: ${destination}`);
  }
  return target;
}

/** @param {string} home @param {string} destination */
async function assertNoSymlinkInManagedPath(home, destination) {
  const resolvedHome = resolve(home);
  const target = resolveHomePath(resolvedHome, destination);
  const components = relative(resolvedHome, target).split(sep).filter(Boolean);
  let current = resolvedHome;

  for (const [index, component] of components.entries()) {
    current = resolve(current, component);
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink()) {
        throw new Error(`Symbolic link escapes the selected HOME boundary: ${current}`);
      }
      if (index < components.length - 1 && !status.isDirectory()) {
        throw new Error(`Managed path parent is not a directory: ${current}`);
      }
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
  }
}

/** @param {string} sourcePath */
function resolveSourcePath(sourcePath) {
  if (isAbsolute(sourcePath)) {
    throw new Error(`Manifest source path must be relative: ${sourcePath}`);
  }
  const target = resolve(repositoryRoot, sourcePath);
  if (target !== repositoryRoot && !target.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`Manifest source path escapes the repository: ${sourcePath}`);
  }
  return target;
}

/**
 * @param {ContractManifest} manifest
 * @returns {Promise<string[]>}
 */
async function validateManifest(manifest) {
  /** @type {string[]} */
  const errors = [];

  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.contractVersion)) {
    errors.push("contractVersion must use semantic versioning");
  }
  if (manifest.source?.repository !== "https://github.com/AO-HyS/development-system") {
    errors.push("source.repository must point to the canonical repository");
  }
  if (manifest.source?.commit !== "$INSTALL_COMMIT") {
    errors.push("source.commit must be resolved from $INSTALL_COMMIT during installation");
  }

  const harnesses = new Set((manifest.supportedHarnesses ?? []).map((harness) => harness.id));
  for (const requiredHarness of ["codex", "t3code", "factory"]) {
    if (!harnesses.has(requiredHarness)) errors.push(`missing supported harness: ${requiredHarness}`);
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length === 0) errors.push("manifest must declare at least one artifact");
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const ids = new Set();
  const destinations = new Set();

  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) errors.push(`duplicate artifact id: ${artifact.id}`);
    ids.add(artifact.id);
    if (destinations.has(artifact.destination)) {
      errors.push(`duplicate artifact destination: ${artifact.destination}`);
    }
    destinations.add(artifact.destination);
    if (!hashPattern.test(artifact.sha256)) errors.push(`invalid sha256 for ${artifact.id}`);
    if (!harnesses.has(artifact.harness)) {
      errors.push(`artifact ${artifact.id} uses unsupported harness ${artifact.harness}`);
    }

    try {
      const sourceContents = await readFile(resolveSourcePath(artifact.sourcePath));
      const actualHash = sha256(sourceContents);
      if (actualHash !== artifact.sha256) {
        errors.push(`canonical hash mismatch for ${artifact.id}: expected ${artifact.sha256}, got ${actualHash}`);
      }
    } catch (error) {
      errors.push(`cannot read canonical artifact ${artifact.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      resolveHomePath("/tmp/development-system-home", artifact.destination);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const artifact of artifacts) {
    if (!artifact.expectedMirrorOf) continue;
    const original = artifactById.get(artifact.expectedMirrorOf);
    if (!original) {
      errors.push(`artifact ${artifact.id} mirrors missing artifact ${artifact.expectedMirrorOf}`);
      continue;
    }
    if (original.logicalName !== artifact.logicalName || original.sha256 !== artifact.sha256) {
      errors.push(`artifact ${artifact.id} does not match expected mirror ${original.id}`);
    }
  }

  return errors;
}

/** @param {string} version */
async function loadVersionManifest(version) {
  const path = resolve(repositoryRoot, "manifests", `${version}.json`);
  const manifest = await readJsonOr(/** @type {string} */ (path), /** @type {ContractManifest | null} */ (null));
  if (!manifest) throw new Error(`Unknown contract version: ${version}`);
  if (manifest.contractVersion !== version) {
    throw new Error(`Manifest ${version}.json declares version ${manifest.contractVersion}`);
  }
  const errors = await validateManifest(manifest);
  if (errors.length > 0) throw new Error(`Invalid manifest ${version}:\n- ${errors.join("\n- ")}`);
  return manifest;
}

/** @param {string | undefined} requestedCommit */
function resolveSourceCommit(requestedCommit) {
  if (requestedCommit) {
    if (!commitPattern.test(requestedCommit)) {
      throw new Error("--source-commit must be an exact lowercase 40-character Git commit");
    }
    return requestedCommit;
  }
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!commitPattern.test(commit)) throw new Error("Git returned a non-canonical commit");
    return commit;
  } catch {
    throw new Error("Cannot resolve the source commit; use a Git checkout or pass --source-commit");
  }
}

/** @param {string} commit @param {string} path */
function readFileAtCommit(commit, path) {
  try {
    return execFileSync("git", ["show", `${commit}:${path}`], {
      cwd: repositoryRoot,
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`Source commit ${commit} does not contain ${path}`);
  }
}

/** @param {ContractManifest} manifest @param {string} commit */
function verifySourceCommit(manifest, commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`Source commit ${commit} does not exist in the canonical repository checkout`);
  }

  const manifestPath = `manifests/${manifest.contractVersion}.json`;
  let committedManifest;
  try {
    committedManifest = JSON.parse(readFileAtCommit(commit, manifestPath).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Source commit ${commit} contains an invalid ${manifestPath}`);
    }
    throw error;
  }
  if (JSON.stringify(committedManifest) !== JSON.stringify(manifest)) {
    throw new Error(`Source commit ${commit} does not contain the selected canonical manifest bytes`);
  }

  for (const artifact of manifest.artifacts) {
    const committedContents = readFileAtCommit(commit, artifact.sourcePath);
    if (sha256(committedContents) !== artifact.sha256) {
      throw new Error(`Source commit ${commit} does not match ${artifact.id} hash ${artifact.sha256}`);
    }
  }
}

/** @param {string} home */
function statePaths(home) {
  const root = resolveHomePath(home, stateDirectory);
  return {
    root,
    installedManifest: resolve(root, manifestFilename),
    state: resolve(root, stateFilename),
    snapshots: resolve(root, "snapshots"),
  };
}

/**
 * @param {string} home
 * @param {InstallState | null} previousState
 * @param {ContractManifest | null} previousInstalledManifest
 * @param {string[]} destinations
 */
async function createSnapshot(home, previousState, previousInstalledManifest, destinations) {
  const paths = statePaths(home);
  const id = `${Date.now()}-${randomUUID()}`;
  const snapshotRoot = resolve(paths.snapshots, id);
  /** @type {SnapshotFile[]} */
  const files = [];

  for (const [index, destination] of [...new Set(destinations)].entries()) {
    await assertNoSymlinkInManagedPath(home, destination);
    const source = resolveHomePath(home, destination);
    const backupPath = resolve(snapshotRoot, "files", `${index}.bin`);
    await assertNoSymlinkInManagedPath(home, relative(resolve(home), backupPath));
    try {
      const contents = await readFile(source);
      await writeFileAtomic(backupPath, contents);
      files.push({
        destination,
        existed: true,
        backupPath: relative(snapshotRoot, backupPath),
        sha256: sha256(contents),
      });
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      files.push({ destination, existed: false, backupPath: null, sha256: null });
    }
  }

  /** @type {Snapshot} */
  const snapshot = { id, previousState, previousInstalledManifest, files };
  const snapshotSha256 = await writeJsonAtomic(resolve(snapshotRoot, "snapshot.json"), snapshot);
  return { id, sha256: snapshotSha256 };
}

/** @param {string} home @param {SnapshotReference} reference */
async function readSnapshot(home, reference) {
  if (
    !reference ||
    !snapshotIdPattern.test(reference.id) ||
    !hashPattern.test(reference.sha256) ||
    Object.keys(reference).sort().join(",") !== "id,sha256"
  ) {
    throw new Error("Rollback snapshot reference is invalid");
  }
  const snapshotPath = resolve(statePaths(home).snapshots, reference.id, "snapshot.json");
  await assertNoSymlinkInManagedPath(home, relative(resolve(home), snapshotPath));
  let contents;
  try {
    contents = await readFile(snapshotPath);
  } catch (error) {
    if (isMissingFileError(error)) throw new Error(`Rollback snapshot is missing: ${reference.id}`);
    throw error;
  }
  if (sha256(contents) !== reference.sha256) {
    throw new Error(`Rollback snapshot integrity mismatch: ${reference.id}`);
  }
  const snapshot = /** @type {Snapshot} */ (JSON.parse(contents.toString("utf8")));
  if (snapshot.id !== reference.id) {
    throw new Error(`Rollback snapshot identity mismatch: ${reference.id}`);
  }
  return snapshot;
}

/** @param {Snapshot} snapshot @param {string} currentVersion */
async function validateSnapshotForRollback(snapshot, currentVersion) {
  const currentManifest = await loadVersionManifest(currentVersion);
  const previousManifest = snapshot.previousState
    ? await loadVersionManifest(snapshot.previousState.currentVersion)
    : null;
  const allowedDestinations = new Set([
    ...currentManifest.artifacts.map((artifact) => artifact.destination),
    ...(previousManifest?.artifacts.map((artifact) => artifact.destination) ?? []),
  ]);
  const observedDestinations = new Set();
  const backupPaths = new Set();

  for (const file of snapshot.files) {
    if (Object.keys(file).sort().join(",") !== "backupPath,destination,existed,sha256") {
      throw new Error("Rollback snapshot contains an invalid file entry schema");
    }
    if (!allowedDestinations.has(file.destination) || observedDestinations.has(file.destination)) {
      throw new Error("Rollback snapshot contains unexpected managed destinations");
    }
    observedDestinations.add(file.destination);
    if (typeof file.existed !== "boolean") {
      throw new Error("Rollback snapshot contains an invalid existence marker");
    }
    if (file.existed) {
      if (
        typeof file.backupPath !== "string" ||
        !hashPattern.test(file.sha256 ?? "") ||
        backupPaths.has(file.backupPath)
      ) {
        throw new Error("Rollback snapshot contains invalid backup metadata");
      }
      backupPaths.add(file.backupPath);
    } else if (file.backupPath !== null || file.sha256 !== null) {
      throw new Error("Rollback snapshot contains backup data for a missing prior file");
    }
  }

  if (observedDestinations.size !== allowedDestinations.size) {
    throw new Error("Rollback snapshot does not cover all managed destinations");
  }
}

/** @param {string} home @param {string} snapshotId */
async function removeConsumedSnapshot(home, snapshotId) {
  if (!snapshotIdPattern.test(snapshotId)) {
    throw new Error(`Rollback snapshot id is invalid: ${snapshotId}`);
  }
  const paths = statePaths(home);
  await assertNoSymlinkInManagedPath(
    home,
    relative(resolve(home), resolve(paths.snapshots, snapshotId)),
  );
  await rm(resolve(paths.snapshots, snapshotId), { recursive: true, force: true });
  for (const directory of [paths.snapshots, paths.root]) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!isMissingOrNonEmptyDirectoryError(error)) throw error;
    }
  }
}

/** @param {string} home @param {Snapshot} snapshot */
async function restoreSnapshot(home, snapshot) {
  const paths = statePaths(home);
  const snapshotRoot = resolve(paths.snapshots, snapshot.id);
  for (const file of snapshot.files) {
    await assertNoSymlinkInManagedPath(home, file.destination);
    const destination = resolveHomePath(home, file.destination);
    if (file.existed && file.backupPath) {
      if (isAbsolute(file.backupPath)) {
        throw new Error(`Rollback backup path must be relative: ${file.backupPath}`);
      }
      const backup = resolve(snapshotRoot, file.backupPath);
      if (backup !== snapshotRoot && !backup.startsWith(`${snapshotRoot}${sep}`)) {
        throw new Error(`Rollback backup path escapes its snapshot: ${file.backupPath}`);
      }
      await assertNoSymlinkInManagedPath(home, relative(resolve(home), backup));
      const contents = await readFile(backup);
      if (sha256(contents) !== file.sha256) {
        throw new Error(`Rollback backup integrity mismatch: ${file.destination}`);
      }
      await writeFileAtomic(destination, contents);
    } else {
      await unlinkIfPresent(destination);
    }
  }

  if (snapshot.previousInstalledManifest) {
    await writeJsonAtomic(paths.installedManifest, snapshot.previousInstalledManifest);
  } else {
    await unlinkIfPresent(paths.installedManifest);
  }
  if (snapshot.previousState) {
    await writeJsonAtomic(paths.state, snapshot.previousState);
  } else {
    await unlinkIfPresent(paths.state);
  }
}

/** @param {string} home @param {InstallState | null} state */
async function rollbackTarget(home, state) {
  if (!state || state.history.length === 0) return null;
  const snapshot = await readSnapshot(
    home,
    /** @type {SnapshotReference} */ (state.history.at(-1)),
  );
  await validateSnapshotForRollback(snapshot, state.currentVersion);
  return snapshot.previousState?.currentVersion ?? null;
}

/**
 * @param {{home: string, version: string, sourceCommit?: string}} options
 */
export async function installVersion(options) {
  const home = resolve(options.home);
  await mkdir(home, { recursive: true });
  const manifest = await loadVersionManifest(options.version);
  const commit = resolveSourceCommit(options.sourceCommit);
  verifySourceCommit(manifest, commit);
  const paths = statePaths(home);
  await assertNoSymlinkInManagedPath(home, `${stateDirectory}/${manifestFilename}`);
  await assertNoSymlinkInManagedPath(home, `${stateDirectory}/${stateFilename}`);
  const currentState = await readJsonOr(paths.state, /** @type {InstallState | null} */ (null));
  const currentManifest = await readJsonOr(
    paths.installedManifest,
    /** @type {ContractManifest | null} */ (null),
  );
  const reinstalled = currentState?.currentVersion === options.version;
  const previousVersion = reinstalled
    ? await rollbackTarget(home, currentState)
    : currentState?.currentVersion ?? null;
  const canonicalCurrentManifest = currentState
    ? await loadVersionManifest(currentState.currentVersion)
    : null;
  const destinations = [
    ...(canonicalCurrentManifest?.artifacts.map((artifact) => artifact.destination) ?? []),
    ...manifest.artifacts.map((artifact) => artifact.destination),
  ];
  for (const destination of destinations) {
    await assertNoSymlinkInManagedPath(home, destination);
  }
  const snapshotReference = await createSnapshot(home, currentState, currentManifest, destinations);

  try {
    const nextDestinations = new Set(manifest.artifacts.map((artifact) => artifact.destination));
    for (const artifact of canonicalCurrentManifest?.artifacts ?? []) {
      if (!nextDestinations.has(artifact.destination)) {
        await unlinkIfPresent(resolveHomePath(home, artifact.destination));
      }
    }
    for (const artifact of manifest.artifacts) {
      const contents = await readFile(resolveSourcePath(artifact.sourcePath));
      if (sha256(contents) !== artifact.sha256) {
        throw new Error(`Canonical artifact changed after manifest validation: ${artifact.id}`);
      }
      await writeFileAtomic(resolveHomePath(home, artifact.destination), contents);
    }

    /** @type {ContractManifest} */
    const installedManifest = {
      ...manifest,
      source: { ...manifest.source, commit },
      installedAt: new Date().toISOString(),
    };
    /** @type {InstallState} */
    const nextState = {
      schemaVersion: 1,
      currentVersion: options.version,
      installedManifestSha256: "",
      history: reinstalled
        ? currentState?.history ?? []
        : [...(currentState?.history ?? []), snapshotReference],
    };
    nextState.installedManifestSha256 = await writeJsonAtomic(paths.installedManifest, installedManifest);
    await writeJsonAtomic(paths.state, nextState);
    if (reinstalled) await removeConsumedSnapshot(home, snapshotReference.id);
  } catch (error) {
    const snapshot = await readSnapshot(home, snapshotReference);
    await validateSnapshotForRollback(snapshot, options.version);
    await restoreSnapshot(home, snapshot);
    await removeConsumedSnapshot(home, snapshotReference.id);
    throw error;
  }

  return {
    ok: true,
    operation: "install",
    version: options.version,
    sourceCommit: commit,
    previousVersion,
    reinstalled,
    artifacts: manifest.artifacts.map(({ id, harness, destination, sha256: hash }) => ({
      id,
      harness,
      destination,
      sha256: hash,
    })),
  };
}

/** @param {{home: string}} options */
export async function auditInstallation(options) {
  const home = resolve(options.home);
  const paths = statePaths(home);
  try {
    await assertNoSymlinkInManagedPath(home, `${stateDirectory}/${manifestFilename}`);
    await assertNoSymlinkInManagedPath(home, `${stateDirectory}/${stateFilename}`);
  } catch (error) {
    return {
      ok: false,
      operation: "audit",
      status: "unsafe",
      contractVersion: null,
      artifacts: [],
      mirrors: [],
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }
  const installedManifest = await readJsonOr(
    paths.installedManifest,
    /** @type {ContractManifest | null} */ (null),
  );
  const state = await readJsonOr(paths.state, /** @type {InstallState | null} */ (null));
  if (!installedManifest) {
    return {
      ok: false,
      operation: "audit",
      status: "not-installed",
      contractVersion: null,
      artifacts: [],
      mirrors: [],
      problems: ["installed manifest is missing"],
    };
  }

  /** @type {ContractManifest | null} */
  let canonicalManifest = null;
  /** @type {string[]} */
  const problems = [];
  try {
    canonicalManifest = await loadVersionManifest(installedManifest.contractVersion);
  } catch (error) {
    problems.push(`installed manifest has no canonical version: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (canonicalManifest) {
    const expectedRootKeys = [...Object.keys(canonicalManifest), "installedAt"].sort().join(",");
    if (
      Object.keys(installedManifest).sort().join(",") !== expectedRootKeys ||
      Object.keys(installedManifest.source ?? {}).sort().join(",") !== "commit,repository" ||
      typeof installedManifest.installedAt !== "string" ||
      Number.isNaN(Date.parse(installedManifest.installedAt))
    ) {
      problems.push("installed manifest schema differs from the canonical installed schema");
    }
    const installedCanonicalShape = {
      schemaVersion: installedManifest.schemaVersion,
      contractVersion: installedManifest.contractVersion,
      source: {
        repository: installedManifest.source?.repository,
        commit: "$INSTALL_COMMIT",
      },
      supportedHarnesses: installedManifest.supportedHarnesses,
      artifacts: installedManifest.artifacts,
    };
    const expectedCanonicalShape = {
      schemaVersion: canonicalManifest.schemaVersion,
      contractVersion: canonicalManifest.contractVersion,
      source: canonicalManifest.source,
      supportedHarnesses: canonicalManifest.supportedHarnesses,
      artifacts: canonicalManifest.artifacts,
    };
    if (JSON.stringify(installedCanonicalShape) !== JSON.stringify(expectedCanonicalShape)) {
      problems.push("installed manifest diverges from the canonical version manifest");
    }
    try {
      verifySourceCommit(canonicalManifest, installedManifest.source?.commit);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  /** @type {Map<string, {contents: Buffer | null, status: string}>} */
  const observed = new Map();
  const artifacts = await Promise.all(
    (canonicalManifest?.artifacts ?? []).map(async (artifact) => {
      const destination = resolveHomePath(home, artifact.destination);
      try {
        await assertNoSymlinkInManagedPath(home, artifact.destination);
        const contents = await readFile(destination);
        const actualSha256 = sha256(contents);
        const status = actualSha256 === artifact.sha256 ? "ok" : "drift";
        observed.set(artifact.id, { contents, status });
        return { ...artifact, actualSha256, status };
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        observed.set(artifact.id, { contents: null, status: "missing" });
        return { ...artifact, actualSha256: null, status: "missing" };
      }
    }),
  );

  const mirrors = (canonicalManifest?.artifacts ?? [])
    .filter((artifact) => artifact.expectedMirrorOf)
    .map((artifact) => {
      const original = observed.get(/** @type {string} */ (artifact.expectedMirrorOf));
      const mirror = observed.get(artifact.id);
      let status = "ok";
      if (!original?.contents || !mirror?.contents) status = "missing";
      else if (!original.contents.equals(mirror.contents)) status = "mismatch";
      return {
        artifact: artifact.id,
        expectedMirrorOf: artifact.expectedMirrorOf,
        status,
      };
    });

  for (const artifact of artifacts) {
    if (artifact.status !== "ok") problems.push(`${artifact.id}: ${artifact.status}`);
  }
  for (const mirror of mirrors) {
    if (mirror.status !== "ok") {
      problems.push(`${mirror.artifact} mirror: ${mirror.status}`);
    }
  }
  if (!state || state.currentVersion !== installedManifest.contractVersion) {
    problems.push("installation state does not match the installed manifest");
  }
  try {
    const installedManifestContents = await readFile(paths.installedManifest);
    if (!state || state.installedManifestSha256 !== sha256(installedManifestContents)) {
      problems.push("installed manifest integrity does not match installation state");
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (!commitPattern.test(installedManifest.source?.commit ?? "")) {
    problems.push("installed source commit is not an exact Git commit");
  }

  return {
    ok: problems.length === 0,
    operation: "audit",
    status: problems.length === 0 ? "healthy" : "drifted",
    contractVersion: installedManifest.contractVersion,
    source: installedManifest.source,
    artifacts,
    mirrors,
    problems,
  };
}

/** @param {{home: string}} options */
export async function validateInstallation(options) {
  const audit = await auditInstallation(options);
  return { ...audit, operation: "validate" };
}

/** @param {{home: string}} options */
export async function rollbackInstallation(options) {
  const home = resolve(options.home);
  const paths = statePaths(home);
  await assertNoSymlinkInManagedPath(home, `${stateDirectory}/${stateFilename}`);
  await assertNoSymlinkInManagedPath(home, `${stateDirectory}/${manifestFilename}`);
  const state = await readJsonOr(paths.state, /** @type {InstallState | null} */ (null));
  if (!state) throw new Error("Cannot rollback: no installation state exists");
  const snapshotReference = state.history.at(-1);
  if (!snapshotReference) throw new Error("Cannot rollback: no previous installation snapshot exists");
  const snapshot = await readSnapshot(home, snapshotReference);
  await validateSnapshotForRollback(snapshot, state.currentVersion);
  const fromVersion = state.currentVersion;
  const toVersion = snapshot.previousState?.currentVersion ?? null;
  await restoreSnapshot(home, snapshot);
  await removeConsumedSnapshot(home, snapshotReference.id);
  return { ok: true, operation: "rollback", fromVersion, toVersion, snapshotId: snapshotReference.id };
}

export async function validateRepository() {
  const manifestDirectory = resolve(repositoryRoot, "manifests");
  const manifestFiles = (await readdir(manifestDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const versions = [];

  for (const filename of manifestFiles) {
    const version = filename.slice(0, -".json".length);
    const manifest = await readJsonOr(
      resolve(manifestDirectory, filename),
      /** @type {ContractManifest | null} */ (null),
    );
    if (!manifest) {
      errors.push(`${filename}: cannot read manifest`);
      continue;
    }
    versions.push(manifest.contractVersion);
    if (manifest.contractVersion !== version) {
      errors.push(`${filename}: filename does not match contractVersion ${manifest.contractVersion}`);
    }
    for (const error of await validateManifest(manifest)) {
      errors.push(`${filename}: ${error}`);
    }
  }

  if (manifestFiles.length === 0) errors.push("no version manifests found");
  return {
    ok: errors.length === 0,
    operation: "validate-repository",
    status: errors.length === 0 ? "healthy" : "invalid",
    repositoryRoot,
    versions,
    errors,
  };
}
