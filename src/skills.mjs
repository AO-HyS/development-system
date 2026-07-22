// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} home @param {string} candidate */
function resolveInsideHome(home, candidate) {
  if (isAbsolute(candidate)) throw new Error(`Skill path must be relative to HOME: ${candidate}`);
  const resolvedHome = resolve(home);
  const target = resolve(resolvedHome, candidate);
  if (target !== resolvedHome && !target.startsWith(`${resolvedHome}${sep}`)) {
    throw new Error(`Skill path escapes HOME: ${candidate}`);
  }
  return target;
}

/** @param {string} root @param {string} candidate */
function isDirectChildPath(root, candidate) {
  if (isAbsolute(candidate)) return false;
  const rootParts = root.split("/").filter(Boolean);
  const candidateParts = candidate.split("/").filter(Boolean);
  return candidateParts.length === rootParts.length + 1 &&
    rootParts.every((part, index) => candidateParts[index] === part) &&
    candidateParts.every((part) => part !== "." && part !== "..");
}

/**
 * Match each required phrase by ordered words while allowing short descriptive
 * insertions such as "Markdown findings file" for the contract term
 * "markdown file".
 *
 * @param {string} text
 * @param {string[]} signature
 */
export function hasBehaviorSignature(text, signature) {
  const observed = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return signature.every((term) => {
    const required = term.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (required.length === 0) return false;
    for (let start = 0; start < observed.length; start += 1) {
      if (observed[start] !== required[0]) continue;
      let cursor = start;
      let matched = true;
      for (const word of required.slice(1)) {
        const next = observed.slice(cursor + 1, cursor + 6).indexOf(word);
        if (next < 0) {
          matched = false;
          break;
        }
        cursor += next + 1;
      }
      if (matched) return true;
    }
    return false;
  });
}

/** @param {string} home @param {string} candidate */
async function assertSafeManagedParent(home, candidate) {
  const resolvedHome = resolve(home);
  const target = resolveInsideHome(home, candidate);
  const parts = relative(resolvedHome, target).split(sep).filter(Boolean).slice(0, -1);
  let current = resolvedHome;
  if ((await lstat(resolvedHome)).isSymbolicLink()) {
    throw new Error(`Selected HOME cannot be a symbolic link: ${resolvedHome}`);
  }
  for (const part of parts) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Managed path parent cannot be a symbolic link: ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

/** @param {string} text */
function skillName(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const match = text.slice(4, end).match(/^name:\s*["']?([^\n"']+)/m);
  return match?.[1]?.trim() ?? null;
}

/** @param {string} directory */
async function directoryHash(directory) {
  /** @type {string[]} */
  const files = [];

  /** @param {string} current */
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill directory contains symbolic link: ${relative(directory, path)}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }

  await walk(directory);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(directory, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Hash an arbitrary managed entry without following symbolic links. @param {string} root */
async function entryIntegrityHash(root) {
  const hash = createHash("sha256");
  /** @param {string} path @param {string} name */
  async function walk(path, name) {
    const status = await lstat(path);
    const mode = String(status.mode & 0o777);
    if (status.isSymbolicLink()) {
      hash.update(`link\0${name}\0${mode}\0${await readlink(path)}\0`);
      return;
    }
    if (status.isDirectory()) {
      hash.update(`directory\0${name}\0${mode}\0`);
      for (const entry of (await readdir(path)).sort()) await walk(resolve(path, entry), `${name}/${entry}`);
      return;
    }
    if (status.isFile()) {
      hash.update(`file\0${name}\0${mode}\0`);
      hash.update(await readFile(path));
      hash.update("\0");
      return;
    }
    throw new Error(`Unsupported managed entry type: ${path}`);
  }
  await walk(root, ".");
  return hash.digest("hex");
}

/**
 * @typedef {{id: string, harness: string, destination: string, sourceDirectory?: string, folderSha256?: string, expectedMirrorOf: string | null, adapterContract?: string}} SkillVariant
 * @typedef {{logicalName: string, source?: {repository?: string, commit?: string, path?: string}, variants: SkillVariant[]}} LogicalSkill
 * @typedef {{catalogVersion?: string, maxCatalogEntries: number, supportedRoots: string[], skills: LogicalSkill[], cleanup?: string[], operationalEvidenceSkills?: string[], operationalEvidenceContracts?: Record<string, {behaviorSignature: string[]}>}} SkillCatalog
 * @typedef {{catalogued?: boolean, loaded?: boolean, influenced?: boolean, catalogWarning?: boolean, catalogOverflow?: boolean, scannerErrors?: string[], command?: string, version?: string}} HarnessEvidence
 */

/**
 * Audit skill installation without mutating it. File presence and valid frontmatter
 * establish loadability only; runtime evidence is required for catalog/load/influence.
 *
 * @param {{home: string, catalog: SkillCatalog, evidence?: Record<string, any>}} options
 */
export async function auditSkillCatalog(options) {
  const home = resolve(options.home);
  const catalog = options.catalog;
  const evidence = options.evidence ?? {};
  /** @type {string[]} */
  const brokenSymlinks = [];
  /** @type {string[]} */
  const scannerErrors = [];
  /** @type {string[]} */
  const orphanedEntries = [];
  /** @type {string[]} */
  const divergentDuplicates = [];
  let catalogEntries = 0;
  const declaredDestinations = new Set(catalog.skills.flatMap((skill) => skill.variants.map((variant) => variant.destination)));
  const logicalNames = new Set(catalog.skills.map((skill) => skill.logicalName));

  for (const root of catalog.supportedRoots) {
    const rootPath = resolveInsideHome(home, root);
    let entries;
    try {
      entries = await readdir(rootPath);
    } catch (error) {
      if (isMissing(error)) continue;
      scannerErrors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    catalogEntries += entries.length;
    for (const entry of entries) {
      const path = resolve(rootPath, entry);
      const relativePath = relative(home, path);
      try {
        if ((await lstat(path)).isSymbolicLink()) await realpath(path);
        if ((catalog.cleanup ?? []).includes(relativePath)) orphanedEntries.push(relativePath);
        if (!declaredDestinations.has(relativePath) && !(catalog.cleanup ?? []).includes(relativePath)) {
          try {
            const name = skillName(await readFile(resolve(await realpath(path), "SKILL.md"), "utf8"));
            if (name && logicalNames.has(name)) {
              divergentDuplicates.push(relativePath);
            }
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
      } catch (error) {
        if (isMissing(error)) brokenSymlinks.push(relative(home, path));
        else scannerErrors.push(`${relative(home, path)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const harnessEvidence of Object.values(evidence)) {
    if (Array.isArray(harnessEvidence.scannerErrors)) {
      scannerErrors.push(...harnessEvidence.scannerErrors);
    }
    for (const item of Object.values(harnessEvidence)) {
      if (item && typeof item === "object" && !Array.isArray(item) && Array.isArray(item.scannerErrors)) {
        scannerErrors.push(...item.scannerErrors);
      }
    }
  }

  const runtimeOverflow = Object.values(evidence).some((harnessEvidence) =>
    Object.values(harnessEvidence).some(
      (item) => item && typeof item === "object" && !Array.isArray(item) && item.catalogOverflow === true,
    ),
  );
  const overflow = catalogEntries > catalog.maxCatalogEntries || runtimeOverflow;
  /** @type {Array<Record<string, unknown> & {states: Record<string, boolean>, directoryHash: string | null}>} */
  const skills = [];
  const byId = new Map();
  /** @type {string[]} */
  const problems = [];
  const evidenceRequired = (catalog.operationalEvidenceSkills ?? []).length > 0;
  if (evidenceRequired) {
    const generatedAt = Date.parse(evidence.generatedAt ?? "");
    const age = Date.now() - generatedAt;
    if (
      evidence.schemaVersion !== 1 ||
      evidence.catalogVersion !== catalog.catalogVersion ||
      resolve(evidence.home ?? "") !== home ||
      evidence.probeSucceeded !== true ||
      !Number.isFinite(generatedAt) ||
      age < -5 * 60 * 1000 ||
      age > 24 * 60 * 60 * 1000 ||
      !evidence.installedHashes ||
      typeof evidence.installedHashes !== "object"
    ) {
      problems.push("Operational evidence is missing, stale, unsuccessful, or not bound to this catalog and HOME");
    }
  }

  for (const logicalSkill of catalog.skills) {
    for (const variant of logicalSkill.variants) {
      const destination = resolveInsideHome(home, variant.destination);
      let exists = false;
      let discovered = false;
      let loadable = false;
      let hash = null;
      try {
        await lstat(destination);
        exists = true;
        const contents = await readFile(resolve(destination, "SKILL.md"), "utf8");
        discovered = catalog.supportedRoots.some((root) => {
          const supportedRoot = resolveInsideHome(home, root);
          return destination.startsWith(`${supportedRoot}${sep}`);
        });
        hash = await directoryHash(await realpath(destination));
        loadable =
          discovered &&
          skillName(contents) === logicalSkill.logicalName &&
          (!variant.folderSha256 || variant.folderSha256 === hash);
      } catch (error) {
        if (!isMissing(error)) {
          problems.push(`${variant.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const observed = evidence[variant.harness]?.[logicalSkill.logicalName] ?? {};
      const states = {
        exists,
        discovered,
        catalogued: observed.catalogued === true,
        loadable,
        loaded: observed.loaded === true,
        influenced: observed.influenced === true,
      };
      if (!loadable) problems.push(`${variant.id} is not loadable from its declared root`);
      if ((catalog.operationalEvidenceSkills ?? []).includes(logicalSkill.logicalName)) {
        const contract = catalog.operationalEvidenceContracts?.[logicalSkill.logicalName];
        const signature = contract?.behaviorSignature ?? [];
        if (evidence.installedHashes?.[variant.id] !== hash) {
          problems.push(`${variant.id} operational evidence does not match the installed folder hash`);
        }
        if (
          observed.exitCode !== 0 ||
          typeof observed.command !== "string" || observed.command.length === 0 ||
          typeof observed.catalogCommand !== "string" || observed.catalogCommand.length === 0 ||
          typeof observed.version !== "string" || observed.version.length === 0 ||
          typeof observed.response !== "string" ||
          observed.catalogResponse?.trim() !== logicalSkill.logicalName ||
          signature.length === 0 ||
          !hasBehaviorSignature(observed.response, signature)
        ) {
          problems.push(`${variant.id} operational evidence lacks executable, version, exit, or response detail`);
        }
        for (const state of /** @type {const} */ (["catalogued", "loaded", "influenced"])) {
          if (!states[state]) problems.push(`${variant.id} lacks required operational evidence for ${state}`);
        }
      }
      const result = {
        id: variant.id,
        logicalName: logicalSkill.logicalName,
        harness: variant.harness,
        destination: variant.destination,
        expectedMirrorOf: variant.expectedMirrorOf,
        adapterContract: variant.adapterContract ?? null,
        states,
        directoryHash: hash,
        evidence: observed,
      };
      skills.push(result);
      byId.set(variant.id, result);
    }
  }

  const mirrors = skills
    .filter((skill) => skill.expectedMirrorOf)
    .map((skill) => {
      const original = byId.get(skill.expectedMirrorOf);
      const status =
        original?.directoryHash && skill.directoryHash === original.directoryHash
          ? "identical"
          : "mismatch";
      if (status !== "identical") problems.push(`${skill.id} mirror does not match ${skill.expectedMirrorOf}`);
      return { artifact: skill.id, expectedMirrorOf: skill.expectedMirrorOf, status };
    });

  if (brokenSymlinks.length > 0) {
    problems.push(`Broken symbolic links: ${brokenSymlinks.sort().join(", ")}`);
  }
  if (overflow) {
    problems.push(`Catalog overflow: ${catalogEntries} entries exceed limit ${catalog.maxCatalogEntries}`);
  }
  if (scannerErrors.length > 0) problems.push(`Scanner errors: ${scannerErrors.join("; ")}`);
  if (orphanedEntries.length > 0) problems.push(`Orphaned entries: ${orphanedEntries.sort().join(", ")}`);
  if (divergentDuplicates.length > 0) {
    problems.push(`Unmanifested duplicate skill entries: ${divergentDuplicates.sort().join(", ")}`);
  }

  return {
    ok: problems.length === 0,
    operation: "audit-skills",
    status: problems.length === 0 ? "healthy" : "invalid",
    logicalSkillCount: catalog.skills.length,
    physicalVariantCount: skills.length,
    evidenceCoverage: {
      structuralLogicalSkills: catalog.skills.length,
      liveRequiredSkills: [...(catalog.operationalEvidenceSkills ?? [])],
      exhaustiveLiveInfluence: (catalog.operationalEvidenceSkills ?? []).length === catalog.skills.length,
    },
    catalogHealth: {
      entries: catalogEntries,
      limit: catalog.maxCatalogEntries,
      overflow,
      brokenSymlinks: brokenSymlinks.sort(),
      scannerErrors,
      orphanedEntries: orphanedEntries.sort(),
      unmanifestedDuplicates: divergentDuplicates.sort(),
    },
    skills,
    mirrors,
    problems,
  };
}

/**
 * Validate canonical catalog provenance, hashes, mirrors, and explicit adapters.
 * @param {SkillCatalog & {schemaVersion?: number, catalogVersion?: string, supportedHarnesses?: Array<{id: string}>, cleanup?: string[]}} catalog
 * @param {string} sourceRoot
 */
export async function validateSkillCatalog(catalog, sourceRoot) {
  /** @type {string[]} */
  const errors = [];
  if (catalog.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!/^\d+\.\d+\.\d+$/.test(catalog.catalogVersion ?? "")) {
    errors.push("catalogVersion must use semantic versioning");
  }
  const harnesses = new Set((catalog.supportedHarnesses ?? []).map((harness) => harness.id));
  for (const required of ["codex", "t3code", "factory"]) {
    if (!harnesses.has(required)) errors.push(`missing supported harness: ${required}`);
  }
  const logicalNames = new Set();
  const ids = new Set();
  const destinations = new Set();
  const variantsById = new Map();
  const evidenceSkills = new Set(catalog.operationalEvidenceSkills ?? []);

  for (const skill of catalog.skills ?? []) {
    if (logicalNames.has(skill.logicalName)) errors.push(`duplicate logical skill: ${skill.logicalName}`);
    logicalNames.add(skill.logicalName);
    evidenceSkills.delete(skill.logicalName);
    const source = /** @type {{repository?: string, commit?: string, path?: string}} */ (skill.source ?? {});
    if (!source.repository || !source.path) errors.push(`${skill.logicalName} has incomplete provenance`);
    if (source.commit !== "$INSTALL_COMMIT" && !/^[a-f0-9]{40}$/.test(source.commit ?? "")) {
      errors.push(`${skill.logicalName} source commit is not exact`);
    }
    const distinctHashes = new Set(skill.variants.map((variant) => variant.folderSha256));
    const adapterContracts = new Set(
      skill.variants.map((variant) => variant.adapterContract).filter(Boolean),
    );
    if (distinctHashes.size > 1 && (adapterContracts.size !== 1 || skill.variants.some((variant) => !variant.adapterContract))) {
      errors.push(`${skill.logicalName} has divergent variants without one explicit adapter contract`);
    }

    for (const variant of skill.variants) {
      if (ids.has(variant.id)) errors.push(`duplicate variant id: ${variant.id}`);
      ids.add(variant.id);
      if (destinations.has(variant.destination)) errors.push(`duplicate variant destination: ${variant.destination}`);
      destinations.add(variant.destination);
      if (!harnesses.has(variant.harness) || variant.harness === "t3code") {
        errors.push(`${variant.id} uses unsupported physical harness ${variant.harness}`);
      }
      if (!catalog.supportedRoots.some((root) => isDirectChildPath(root, variant.destination))) {
        errors.push(`${variant.id} is outside supported skill roots`);
      }
      if (!/^[a-f0-9]{64}$/.test(variant.folderSha256 ?? "")) {
        errors.push(`${variant.id} has invalid folderSha256`);
      }
      try {
        const actual = await directoryHash(resolveInsideRoot(variant.sourceDirectory ?? "", sourceRoot));
        if (actual !== variant.folderSha256) errors.push(`${variant.id} canonical folder hash mismatch`);
      } catch (error) {
        errors.push(`${variant.id} canonical source cannot be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      variantsById.set(variant.id, { ...variant, logicalName: skill.logicalName });
    }
  }
  for (const missing of evidenceSkills) errors.push(`operational evidence skill is not declared: ${missing}`);

  for (const variant of variantsById.values()) {
    if (!variant.expectedMirrorOf) continue;
    const original = variantsById.get(variant.expectedMirrorOf);
    if (!original) errors.push(`${variant.id} mirrors missing variant ${variant.expectedMirrorOf}`);
    else if (original.logicalName !== variant.logicalName || original.folderSha256 !== variant.folderSha256) {
      errors.push(`${variant.id} is not an identical declared mirror of ${variant.expectedMirrorOf}`);
    }
  }
  for (const cleanup of catalog.cleanup ?? []) {
    if (!catalog.supportedRoots.some((root) => isDirectChildPath(root, cleanup))) {
      errors.push(`cleanup path is outside supported roots: ${cleanup}`);
    }
    if (destinations.has(cleanup)) errors.push(`cleanup path is also a managed destination: ${cleanup}`);
  }
  return errors;
}

/** @param {string} path @param {unknown} value */
async function atomicWriteJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

/** @param {SkillCatalog} catalog */
function catalogManagedPaths(catalog) {
  return [
    ...catalog.skills.flatMap((skill) => skill.variants.map((variant) => variant.destination)),
    ...(catalog.cleanup ?? []),
    ".development-system/skills-lock.json",
    ".agents/.skill-lock.json",
  ];
}

/** @param {string} candidate @param {string} root */
function resolveInsideRoot(candidate, root) {
  if (isAbsolute(candidate)) throw new Error(`Skill source must be relative: ${candidate}`);
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, candidate);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Skill source escapes source root: ${candidate}`);
  }
  return target;
}

/**
 * Hash a source directory from Git's committed tree, never from working-tree bytes.
 * @param {string} sourceRoot @param {string} sourceDirectory @param {string} commit
 */
function gitDirectoryHash(sourceRoot, sourceDirectory, commit) {
  const listing = execFileSync("git", ["ls-tree", "-r", "-z", commit, "--", sourceDirectory], {
    cwd: sourceRoot,
  }).toString("utf8");
  const records = listing.split("\0").filter(Boolean).map((record) => {
    const match = record.match(/^(\d+) blob ([a-f0-9]{40,64})\t(.+)$/);
    if (!match) throw new Error(`Unsupported Git tree entry for ${sourceDirectory}: ${record}`);
    const [, mode, objectId, path] = match;
    if (mode === "120000") throw new Error(`Canonical Git source contains symbolic link: ${path}`);
    const prefix = `${sourceDirectory.replace(/\/$/, "")}/`;
    if (!path.startsWith(prefix)) throw new Error(`Git source path escapes directory: ${path}`);
    return { objectId, path: path.slice(prefix.length) };
  });
  if (records.length === 0) throw new Error(`Canonical skill source is absent from Git ${commit}: ${sourceDirectory}`);
  records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const hash = createHash("sha256");
  for (const record of records) {
    hash.update(record.path);
    hash.update("\0");
    hash.update(execFileSync("git", ["cat-file", "blob", record.objectId], { cwd: sourceRoot }));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** @param {string} path */
async function entryMetadata(path) {
  try {
    const status = await lstat(path);
    return {
      exists: true,
      kind: status.isSymbolicLink() ? "symlink" : status.isDirectory() ? "directory" : "file",
      linkTarget: status.isSymbolicLink() ? await readlink(path) : null,
    };
  } catch (error) {
    if (isMissing(error)) return { exists: false, kind: "missing", linkTarget: null };
    throw error;
  }
}

/**
 * Reconcile only catalog-owned destinations and explicit cleanup paths. Every
 * replaced entry is moved to a local snapshot first, including broken links.
 *
 * @param {{home: string, sourceRoot: string, sourceCommit?: string, catalog: SkillCatalog & {catalogVersion?: string, cleanup?: string[]}}} options
 */
export async function synchronizeSkillCatalog(options) {
  const home = resolve(options.home);
  const sourceRoot = resolve(options.sourceRoot);
  await mkdir(home, { recursive: true });
  const catalogErrors = await validateSkillCatalog(options.catalog, sourceRoot);
  if (catalogErrors.length > 0) throw new Error(`Cannot synchronize invalid skill catalog:\n${catalogErrors.join("\n")}`);

  let repositoryCommit = null;
  let repositoryDirty = null;
  try {
    repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    repositoryDirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd: sourceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("Canonical skill source must be a Git checkout with a resolvable HEAD");
  }
  if (repositoryDirty) throw new Error("Canonical skill source checkout must be clean before synchronization");
  const installCommit = options.sourceCommit ?? repositoryCommit;
  if (!installCommit || !/^[a-f0-9]{40}$/.test(installCommit)) {
    throw new Error("Skill source commit must be an exact lowercase 40-character Git commit");
  }
  if (repositoryCommit && installCommit !== repositoryCommit) {
    throw new Error(`Skill source commit ${installCommit} does not match checkout HEAD ${repositoryCommit}`);
  }
  const committedHashes = new Map();
  for (const skill of options.catalog.skills) {
    for (const variant of skill.variants) {
      if (!variant.sourceDirectory) throw new Error(`${variant.id} is missing sourceDirectory`);
      let committedHash = committedHashes.get(variant.sourceDirectory);
      if (!committedHash) {
        committedHash = gitDirectoryHash(sourceRoot, variant.sourceDirectory, installCommit);
        committedHashes.set(variant.sourceDirectory, committedHash);
      }
      if (committedHash !== variant.folderSha256) {
        throw new Error(`${variant.id} canonical folder hash does not match Git ${installCommit}`);
      }
    }
  }

  const existingStatePath = resolveInsideHome(home, ".development-system/skill-sync-state.json");
  if ((await entryMetadata(existingStatePath)).exists) await rollbackSkillSync({ home, catalog: options.catalog });

  const snapshotId = `${Date.now()}-${randomUUID()}`;
  const snapshotRoot = resolveInsideHome(home, `.development-system/skill-snapshots/${snapshotId}`);
  const statePath = resolveInsideHome(home, ".development-system/skill-sync-state.json");
  const lockPath = resolveInsideHome(home, ".development-system/skills-lock.json");
  const agentLockPath = resolveInsideHome(home, ".agents/.skill-lock.json");
  /** @type {{version?: number, skills: Record<string, Record<string, unknown>>, [key: string]: unknown}} */
  let agentLock = { version: 3, skills: {} };
  try {
    agentLock = JSON.parse(await readFile(agentLockPath, "utf8"));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const variants = options.catalog.skills.flatMap((skill) =>
    skill.variants.map((variant) => ({ ...variant, logicalName: skill.logicalName })),
  );
  const managedPaths = catalogManagedPaths(options.catalog);
  if (new Set(managedPaths).size !== managedPaths.length) {
    throw new Error("Skill catalog contains duplicate managed destinations");
  }
  /** @type {Array<{path: string, existed: boolean, kind: string, backup: string | null, linkTarget: string | null, integritySha256: string | null}>} */
  const entries = [];

  for (const [index, managedPath] of managedPaths.entries()) {
    await assertSafeManagedParent(home, managedPath);
    const destination = resolveInsideHome(home, managedPath);
    const metadata = await entryMetadata(destination);
    entries.push({
      path: managedPath,
      existed: metadata.exists,
      kind: metadata.kind,
      backup: metadata.exists ? `entries/${index}` : null,
      linkTarget: metadata.linkTarget,
      integritySha256: metadata.exists ? await entryIntegrityHash(destination) : null,
    });
  }
  await mkdir(resolve(snapshotRoot, "entries"), { recursive: true });
  const state = {
    schemaVersion: 1,
    catalogVersion: options.catalog.catalogVersion ?? null,
    snapshotId,
    sourceRoot,
    entries,
  };
  await atomicWriteJson(statePath, state);

  try {
    for (const entry of entries) {
      await assertSafeManagedParent(home, entry.path);
      if (entry.existed && entry.backup) {
        const destination = resolveInsideHome(home, entry.path);
        const backup = resolve(snapshotRoot, entry.backup);
        await rename(destination, backup);
      }
    }

    for (const variant of variants) {
      if (!variant.sourceDirectory) throw new Error(`${variant.id} is missing sourceDirectory`);
      const source = resolveInsideRoot(variant.sourceDirectory, sourceRoot);
      if ((await lstat(source)).isSymbolicLink()) {
        throw new Error(`Canonical skill source cannot be a symbolic link: ${variant.sourceDirectory}`);
      }
      const destination = resolveInsideHome(home, variant.destination);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    }

    const lock = {
      schemaVersion: 1,
      catalogVersion: options.catalog.catalogVersion ?? null,
      sourceCommit: installCommit,
      installedAt: new Date().toISOString(),
      logicalSkills: options.catalog.skills.map((skill) => ({
        logicalName: skill.logicalName,
        source: skill.source
          ? {
              ...skill.source,
              commit: skill.source.commit === "$INSTALL_COMMIT" ? installCommit : skill.source.commit,
            }
          : null,
        variants: skill.variants.map((variant) => ({
          id: variant.id,
          harness: variant.harness,
          sourceDirectory: variant.sourceDirectory,
          destination: variant.destination,
          folderSha256: variant.folderSha256,
          expectedMirrorOf: variant.expectedMirrorOf,
          adapterContract: variant.adapterContract ?? null,
        })),
      })),
      cleanup: options.catalog.cleanup ?? [],
    };
    await atomicWriteJson(lockPath, lock);

    const nextAgentLock = {
      ...agentLock,
      version: agentLock.version ?? 3,
      skills: { ...(agentLock.skills ?? {}) },
    };
    for (const cleanup of options.catalog.cleanup ?? []) {
      const prefix = ".agents/skills/";
      if (cleanup.startsWith(prefix)) delete nextAgentLock.skills[cleanup.slice(prefix.length)];
    }
    for (const skill of options.catalog.skills) {
      const shared = skill.variants.find((variant) => variant.destination === `.agents/skills/${skill.logicalName}`);
      if (!shared || !skill.source) continue;
      if (!skill.source.repository || !skill.source.path) throw new Error(`${skill.logicalName} has incomplete provenance`);
      const sourceCommit = skill.source.commit === "$INSTALL_COMMIT" ? installCommit : skill.source.commit;
      if (!sourceCommit) throw new Error(`${skill.logicalName} cannot resolve its canonical source commit`);
      nextAgentLock.skills[skill.logicalName] = {
        source: skill.source.repository.replace(/^https:\/\/github\.com\//, ""),
        sourceType: "github",
        sourceUrl: `${skill.source.repository}.git`,
        sourceCommit,
        skillPath: `${skill.source.path}/SKILL.md`,
        skillFolderHash: shared.folderSha256,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    await atomicWriteJson(agentLockPath, nextAgentLock);
  } catch (error) {
    await restoreSkillSnapshot({ home, snapshotRoot, entries });
    await rm(statePath, { force: true });
    await rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    ok: true,
    operation: "sync-skills",
    snapshotId,
    logicalSkillCount: options.catalog.skills.length,
    physicalVariantCount: variants.length,
    cleaned: options.catalog.cleanup ?? [],
  };
}

/** @param {{home: string, snapshotRoot: string, entries: Array<{path: string, existed: boolean, backup: string | null, integritySha256?: string | null}>}} options */
async function restoreSkillSnapshot(options) {
  for (const entry of options.entries) {
    if (!entry.existed || !entry.backup) continue;
    const backup = resolve(options.snapshotRoot, entry.backup);
    if ((await entryMetadata(backup)).exists) {
      const actual = await entryIntegrityHash(backup);
      if (!entry.integritySha256 || actual !== entry.integritySha256) {
        throw new Error(`Cannot rollback skills: snapshot integrity mismatch for ${entry.path}`);
      }
    } else {
      const destination = resolveInsideHome(options.home, entry.path);
      if (!(await entryMetadata(destination)).exists || await entryIntegrityHash(destination) !== entry.integritySha256) {
        throw new Error(`Cannot rollback skills: expected snapshot backup is missing for ${entry.path}`);
      }
    }
  }
  for (const entry of [...options.entries].reverse()) {
    const destination = resolveInsideHome(options.home, entry.path);
    if (entry.existed && entry.backup) {
      const backup = resolve(options.snapshotRoot, entry.backup);
      if (!backup.startsWith(`${options.snapshotRoot}${sep}`)) {
        throw new Error(`Skill snapshot backup escapes snapshot: ${entry.backup}`);
      }
      if ((await entryMetadata(backup)).exists) {
        await rm(destination, { recursive: true, force: true });
        await mkdir(dirname(destination), { recursive: true });
        await rename(backup, destination);
      }
    } else if (!entry.existed) {
      await rm(destination, { recursive: true, force: true });
    }
  }
}

/** @param {{home: string, catalog: SkillCatalog}} options */
export async function rollbackSkillSync(options) {
  const home = resolve(options.home);
  const statePath = resolveInsideHome(home, ".development-system/skill-sync-state.json");
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (isMissing(error)) throw new Error("Cannot rollback skills: no synchronization state exists");
    throw error;
  }
  if (
    state.schemaVersion !== 1 ||
    typeof state.snapshotId !== "string" ||
    !/^\d{10,16}-[0-9a-f-]{36}$/.test(state.snapshotId) ||
    !Array.isArray(state.entries)
  ) {
    throw new Error("Cannot rollback skills: synchronization state is invalid");
  }
  const allowedPaths = new Set(catalogManagedPaths(options.catalog));
  const seenPaths = new Set();
  for (const [index, entry] of state.entries.entries()) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      !allowedPaths.has(entry.path) ||
      seenPaths.has(entry.path) ||
      typeof entry.existed !== "boolean" ||
      (entry.existed && !/^[a-f0-9]{64}$/.test(entry.integritySha256 ?? "")) ||
      (!entry.existed && entry.integritySha256 !== null) ||
      (entry.backup !== null && entry.backup !== `entries/${index}`)
    ) {
      throw new Error("Cannot rollback skills: synchronization state contains an unauthorized entry");
    }
    seenPaths.add(entry.path);
    await assertSafeManagedParent(home, entry.path);
  }
  const snapshotRoot = resolveInsideHome(home, `.development-system/skill-snapshots/${state.snapshotId}`);
  await assertSafeManagedParent(home, `.development-system/skill-snapshots/${state.snapshotId}/entry`);
  await restoreSkillSnapshot({ home, snapshotRoot, entries: state.entries });
  await rm(statePath, { force: true });
  await rm(snapshotRoot, { recursive: true, force: true });
  return { ok: true, operation: "rollback-skills", snapshotId: state.snapshotId };
}
