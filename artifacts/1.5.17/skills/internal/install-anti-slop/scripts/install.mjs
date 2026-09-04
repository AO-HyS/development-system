#!/usr/bin/env node
// Development System contained installer for the vendored dmmulroy/anti-slop
// plugin (upstream commit e8c4880471b23ab7f216fba7b27d173a6ef07d4c, MIT).
// This adapter stages into a verified parent directory and performs its final
// atomic rename relative to that directory's kernel-bound current directory.
// The pristine upstream installer source is preserved unchanged under
// artifacts/1.5.17/skills/upstream/install-anti-slop for provenance only.
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(skillRoot, "assets", "anti-slop");
const defaultDestination = "tools/oxlint/anti-slop";
const arguments_ = process.argv.slice(2);
const targetArgument = arguments_.find((argument) => !argument.startsWith("--"));
const force = arguments_.includes("--force");
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const expectedInstallTreeSha256 = "c3393200b7030606188a5ceeb04cc1ef0ac35ae5db0735786edc738c59843465";
const expectedLicenseSha256 = "10ed33bf340d6d63dc0633dfc917a346b369b6aa41fe20734aefc6a3fb75ba17";

class UnsafeInstall extends Error {}

/** @param {string} reason */
function refuse(reason) {
  throw new UnsafeInstall(reason);
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/** @param {string} target */
function validateTargetArgument(target) {
  if (target.trim().length === 0) refuse("the destination is empty");
  if (isAbsolute(target)) {
    refuse("absolute destinations are not allowed; pass a repository-relative path");
  }
  if (target.includes("\\")) {
    refuse("backslash destinations are ambiguous; pass a repository-relative path with forward slashes");
  }
  const segments = target.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    refuse(`destinations may not contain empty, dot, or parent segments: ${target}`);
  }
}

/** @param {string} path */
async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** @param {string} directory @param {string} prefix */
async function assertNoSymbolicLinks(directory, prefix = "") {
  async function walk(currentDirectory, currentPrefix) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const entryPath = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;
      const entryPathOnDisk = join(currentDirectory, entry.name);
      const status = await lstat(entryPathOnDisk);
      if (status.isSymbolicLink()) refuse(`existing destination contains a symbolic link: ${entryPath}`);
      if (status.isDirectory()) {
        const child = await open(entryPathOnDisk, directoryFlags);
        try {
          await walk(entryPathOnDisk, entryPath);
        } finally {
          await child.close();
        }
      } else if (!status.isFile()) {
        refuse(`existing destination contains an unsupported entry: ${entryPath}`);
      }
    }
  }
  await walk(directory, prefix);
}

/** @param {{dev: number | bigint, ino: number | bigint}} left @param {{dev: number | bigint, ino: number | bigint}} right */
function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/** @param {string} path @param {string} label */
async function openBoundDirectory(path, label) {
  let handle;
  try {
    handle = await open(path, directoryFlags);
  } catch (error) {
    if (hasCode(error, "ELOOP")) refuse(`symbolic link ancestor: ${label}`);
    throw error;
  }
  try {
    const [opened, named] = await Promise.all([handle.stat(), lstat(path)]);
    if (named.isSymbolicLink() || !named.isDirectory() || !opened.isDirectory() || !sameFileIdentity(opened, named)) {
      refuse(`ancestor changed while it was being bound: ${label}`);
    }
    return { path, label, handle, identity: { dev: opened.dev, ino: opened.ino } };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** @param {Array<Awaited<ReturnType<typeof openBoundDirectory>>>} ancestors @param {string} workingReal */
async function assertAncestorChain(ancestors, workingReal) {
  for (const ancestor of ancestors) {
    const [opened, named] = await Promise.all([ancestor.handle.stat(), lstat(ancestor.path)]);
    if (
      named.isSymbolicLink() ||
      !named.isDirectory() ||
      !opened.isDirectory() ||
      !sameFileIdentity(opened, ancestor.identity) ||
      !sameFileIdentity(named, ancestor.identity)
    ) {
      refuse(`destination ancestor identity changed: ${ancestor.label}`);
    }
  }
  const parentReal = await realpath(".");
  if (parentReal !== workingReal && !parentReal.startsWith(`${workingReal}${sep}`)) {
    refuse("the destination parent escapes the real working directory");
  }
  return parentReal;
}

/** @param {string} name @param {import("node:fs/promises").FileHandle} handle @param {{dev: number | bigint, ino: number | bigint}} expected */
async function assertStageIdentity(name, handle, expected) {
  const pathStatus = await lstatIfPresent(name);
  if (!pathStatus || pathStatus.isSymbolicLink() || !pathStatus.isDirectory()) {
    refuse("the private staging directory was replaced before placement");
  }
  const handleStatus = await handle.stat();
  if (!sameFileIdentity(pathStatus, expected) || !sameFileIdentity(handleStatus, expected)) {
    refuse("the private staging directory identity changed before placement");
  }
  await assertNoSymbolicLinks(name);
}

/** @param {string} sourcePath @param {string} destinationPath @param {number} mode */
async function copyTrustedFile(sourcePath, destinationPath, mode) {
  const sourceHandle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let destinationFile;
  try {
    const sourceStatus = await sourceHandle.stat();
    if (!sourceStatus.isFile()) refuse(`source contains an unsupported entry: ${sourcePath}`);
    const sourceBytes = await sourceHandle.readFile();
    destinationFile = await open(destinationPath, fileFlags, mode);
    await destinationFile.writeFile(sourceBytes);
    await destinationFile.chmod(mode);
  } finally {
    await sourceHandle.close();
    if (destinationFile) await destinationFile.close();
  }
}

/** @param {string} sourceDirectory @param {string} destinationDirectory */
async function copySourceTree(sourceDirectory, destinationDirectory) {
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);
    if (entry.isSymbolicLink()) refuse(`source contains a symbolic link: ${entry.name}`);
    const status = await lstat(sourcePath);
    if (status.isDirectory()) {
      await mkdir(destinationPath, { mode: status.mode & 0o777 });
      const child = await open(destinationPath, directoryFlags);
      try {
        await copySourceTree(sourcePath, destinationPath);
      } finally {
        await child.close();
      }
      continue;
    }
    if (!status.isFile()) refuse(`source contains an unsupported entry: ${entry.name}`);
    await copyTrustedFile(sourcePath, destinationPath, status.mode & 0o777);
  }
}

/** @param {string} directory */
async function canonicalTreeSha256(directory) {
  /** @type {string[]} */
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const status = await lstat(path);
      if (status.isSymbolicLink()) refuse(`installed tree contains a symbolic link: ${relative(directory, path)}`);
      if (status.isDirectory()) await walk(path);
      else if (status.isFile()) files.push(path);
      else refuse(`installed tree contains an unsupported entry: ${relative(directory, path)}`);
    }
  }
  await walk(directory);
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const [opened, named] = await Promise.all([handle.stat(), lstat(path)]);
      if (!opened.isFile() || named.isSymbolicLink() || !named.isFile() || !sameFileIdentity(opened, named)) {
        refuse(`installed tree file changed while hashing: ${relative(directory, path)}`);
      }
      hash.update(relative(directory, path));
      hash.update("\0");
      hash.update(await handle.readFile());
      hash.update("\0");
    } finally {
      await handle.close();
    }
  }
  return hash.digest("hex");
}

/** @param {string} directory */
async function assertCanonicalInstallTree(directory) {
  if (await canonicalTreeSha256(directory) !== expectedInstallTreeSha256) {
    refuse("the complete staged install tree does not match the pinned canonical bytes");
  }
  const licenseHandle = await open(join(directory, "LICENSE"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = await licenseHandle.stat();
    if (!status.isFile()) refuse("the staged MIT LICENSE is not a regular file");
    const hash = createHash("sha256").update(await licenseHandle.readFile()).digest("hex");
    if (hash !== expectedLicenseSha256) refuse("the staged MIT LICENSE does not match the pinned upstream notice");
  } finally {
    await licenseHandle.close();
  }
}

/** @param {string} barrier */
async function waitForInjectedRace(barrier) {
  await writeFile(`${barrier}.ready`, "ready\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(`${barrier}.go`);
      return;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      await delay(10);
    }
  }
  refuse("the deterministic safety barrier timed out");
}

async function main() {
  if (targetArgument !== undefined) validateTargetArgument(targetArgument);
  if (constants.O_DIRECTORY === undefined || constants.O_NOFOLLOW === undefined) {
    refuse("safe contained installation is unavailable on this platform");
  }

  const originalWorkingDirectory = process.cwd();
  const workingReal = await realpath(originalWorkingDirectory);
  if (workingReal !== originalWorkingDirectory) {
    refuse("the working directory is reached through a symbolic link");
  }
  const destinationArgument = targetArgument ?? defaultDestination;
  const segments = destinationArgument.split("/");
  const targetName = segments.at(-1);
  if (!targetName) refuse("the destination is empty");
  const parentSegments = segments.slice(0, -1);
  const parentPath = resolve(originalWorkingDirectory, ...parentSegments);
  const target = resolve(parentPath, targetName);
  if (!target.startsWith(`${workingReal}${sep}`)) {
    refuse("the destination resolves outside the real working directory");
  }
  const sourceStatus = await lstat(source);
  if (!sourceStatus.isDirectory() || sourceStatus.isSymbolicLink()) {
    refuse("the contained source is not a trusted directory");
  }

  const previousWorkingDirectory = process.cwd();
  /** @type {Array<Awaited<ReturnType<typeof openBoundDirectory>>>} */
  const ancestorHandles = [];
  ancestorHandles.push(await openBoundDirectory(originalWorkingDirectory, "."));
  let current = originalWorkingDirectory;
  for (const segment of parentSegments) {
    await assertAncestorChain(ancestorHandles, workingReal);
    let status = await lstatIfPresent(segment);
    if (!status) {
      try {
        await mkdir(segment, { mode: 0o755 });
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      status = await lstatIfPresent(segment);
    }
    if (!status) refuse(`ancestor disappeared while opening: ${segment}`);
    if (status.isSymbolicLink()) refuse(`symbolic link ancestor: ${segment}`);
    if (!status.isDirectory()) refuse(`ancestor is not a directory: ${segment}`);
    current = resolve(current, segment);
    const bound = await openBoundDirectory(segment, relative(originalWorkingDirectory, current));
    ancestorHandles.push({ ...bound, path: current });
    process.chdir(segment);
    await assertAncestorChain(ancestorHandles, workingReal);
  }
  const parentReal = await assertAncestorChain(ancestorHandles, workingReal);
  let stageName = null;
  let backupName = null;
  /** @type {import("node:fs/promises").FileHandle | null} */
  let stageHandle = null;
  /** @type {{dev: number | bigint, ino: number | bigint} | null} */
  let stageIdentity = null;
  try {
    const targetStatus = await lstatIfPresent(targetName);
    if (targetStatus?.isSymbolicLink()) {
      refuse("the destination is an existing symbolic link; --force never authorizes writing through a link");
    }
    if (targetStatus && !targetStatus.isDirectory()) {
      refuse(`the destination is not a directory: ${relative(previousWorkingDirectory, target)}`);
    }
    if (targetStatus?.isDirectory()) await assertNoSymbolicLinks(targetName);
    if (targetStatus && !force) {
      console.error(`Refusing to overwrite ${target}. Re-run with --force only after reviewing the existing files.`);
      process.exitCode = 1;
      return;
    }

    stageName = `.${targetName}.aohys-stage-${process.pid}-${randomUUID()}`;
    await mkdir(stageName, { mode: 0o700 });
    stageHandle = await open(stageName, directoryFlags);
    const openedStageStatus = await stageHandle.stat();
    stageIdentity = { dev: openedStageStatus.dev, ino: openedStageStatus.ino };
    await copySourceTree(source, stageName);
    await copyTrustedFile(resolve(skillRoot, "LICENSE"), resolve(stageName, "LICENSE"), 0o644);
    await assertStageIdentity(stageName, stageHandle, stageIdentity);
    await assertCanonicalInstallTree(stageName);

    const barrier = process.env.AOHYS_ANTI_SLOP_TEST_BARRIER;
    if (barrier) await waitForInjectedRace(resolve(barrier));

    // A hostile same-user process can discover and replace the private stage
    // name while the deterministic barrier is held. Bind placement to the
    // directory handle and original device/inode, not merely to that name.
    await assertAncestorChain(ancestorHandles, workingReal);
    await assertStageIdentity(stageName, stageHandle, stageIdentity);
    await assertCanonicalInstallTree(stageName);

    // This is the last lexical-boundary check before atomic placement. The
    // rename itself is relative to the kernel-bound parent CWD and never
    // follows a substituted symlink ancestor or target.
    await assertAncestorChain(ancestorHandles, workingReal);
    const finalTargetStatus = await lstatIfPresent(targetName);
    if (finalTargetStatus?.isSymbolicLink()) {
      refuse("the destination is an existing symbolic link; --force never authorizes writing through a link");
    }
    if (finalTargetStatus && !force) {
      console.error(`Refusing to overwrite ${target}. Re-run with --force only after reviewing the existing files.`);
      process.exitCode = 1;
      return;
    }
    if (finalTargetStatus && !finalTargetStatus.isDirectory()) {
      refuse(`the destination is not a directory: ${relative(previousWorkingDirectory, target)}`);
    }

    if (force && finalTargetStatus) {
      backupName = `.${targetName}.aohys-backup-${process.pid}-${randomUUID()}`;
      await rename(targetName, backupName);
      // Re-check after moving the old tree and immediately before the final
      // atomic stage placement. A new symlink or target is never overwritten.
      await assertAncestorChain(ancestorHandles, workingReal);
      const replacedTargetStatus = await lstatIfPresent(targetName);
      if (replacedTargetStatus) {
        if (replacedTargetStatus.isSymbolicLink()) {
          refuse("the destination is an existing symbolic link; --force never authorizes writing through a link");
        }
        refuse("the destination appeared during atomic placement");
      }
    }
    await assertStageIdentity(stageName, stageHandle, stageIdentity);
    await assertCanonicalInstallTree(stageName);
    await rename(stageName, targetName);
    const placedStatus = await lstat(targetName);
    const heldStatus = await stageHandle.stat();
    if (!placedStatus.isDirectory() || !sameFileIdentity(placedStatus, stageIdentity) || !sameFileIdentity(heldStatus, stageIdentity)) {
      refuse("the installed target does not match the held staging directory identity");
    }
    await assertCanonicalInstallTree(targetName);
    stageName = null;
    if (backupName) {
      console.log(`Retained the previous destination for recovery at ${resolve(parentReal, backupName)}`);
      backupName = null;
    }
    console.log(`Copied the anti-slop plugin to ${target}`);
    console.log(`Configure Oxlint with: ${target}/index.ts`);
  } finally {
    // Never recursively delete or auto-restore a path whose name may have
    // been substituted. Retain uncertain stage/backup entries for explicit
    // recovery instead of turning cleanup into a second race primitive.
    if (stageName) console.error(`Retained unplaced staging entry for review at ${resolve(parentReal, stageName)}`);
    if (backupName) console.error(`Retained previous destination for recovery at ${resolve(parentReal, backupName)}`);
    await stageHandle?.close();
    await Promise.allSettled(ancestorHandles.map((ancestor) => ancestor.handle.close()));
  }
}

try {
  await main();
} catch (error) {
  console.error(`Refusing unsafe install target: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
