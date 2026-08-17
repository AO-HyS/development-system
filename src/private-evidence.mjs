// @ts-check

import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** @param {unknown} error */
function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} root @param {string} path */
function assertContained(root, path) {
  const relation = relative(root, path);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Private evidence path escapes HOME: ${path}`);
  }
}

/** @param {string} home @param {string} target */
async function assertSafePath(home, target) {
  const root = resolve(home);
  assertContained(root, target);
  const rootStatus = await lstat(root);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error(`Private evidence HOME is not a safe directory: ${root}`);
  }
  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink()) {
        throw new Error(`Private evidence path contains a symbolic link: ${current}`);
      }
      if (index < parts.length - 1 && !status.isDirectory()) {
        throw new Error(`Private evidence parent is not a directory: ${current}`);
      }
      if (index === parts.length - 1 && !status.isFile()) {
        throw new Error(`Private evidence destination is not a regular file: ${current}`);
      }
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
  }
}

/**
 * Atomically replace one private evidence file below HOME without following
 * existing symbolic links. The replacement inode is always private (0600).
 *
 * @param {{home: string, destination: string, contents: string | Buffer}} input
 */
export async function writePrivateEvidence(input) {
  const home = resolve(input.home);
  const destination = resolve(input.destination);
  await assertSafePath(home, destination);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await assertSafePath(home, destination);

  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, input.contents, { flag: "wx", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } catch (error) {
    try { await unlink(temporary); } catch (cleanupError) { if (!missing(cleanupError)) throw cleanupError; }
    throw error;
  }
}
