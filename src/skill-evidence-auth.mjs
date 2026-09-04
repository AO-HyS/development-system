// @ts-check

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";

export const skillEvidenceKeyRelativePath = ".development-system/private/skill-probe-hmac.key";

/** @param {unknown} value @returns {unknown} */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(/** @type {Record<string, unknown>} */ (value)[key])]),
  );
}

/** @param {unknown} value */
function canonicalEvidence(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(canonicalValue(value));
  }
  const unsigned = { .../** @type {Record<string, unknown>} */ (value) };
  delete unsigned.authentication;
  return JSON.stringify(canonicalValue(unsigned));
}

/** @param {string} home */
export function skillEvidenceKeyPath(home) {
  return resolve(home, skillEvidenceKeyRelativePath);
}

/** @param {import("node:fs/promises").FileHandle} handle @param {string} path */
async function assertDirectoryHandleStillNames(handle, path) {
  const [opened, named] = await Promise.all([handle.stat(), lstat(path)]);
  if (
    !opened.isDirectory() ||
    named.isSymbolicLink() ||
    !named.isDirectory() ||
    opened.dev !== named.dev ||
    opened.ino !== named.ino
  ) {
    throw new Error(`Skill evidence key parent changed or is not a real directory: ${path}`);
  }
}

/** @param {string} path */
async function openDirectoryNoFollow(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await assertDirectoryHandleStillNames(handle, path);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** @param {Array<{handle: import("node:fs/promises").FileHandle, path: string}>} parents */
async function assertParentsStillBound(parents) {
  for (const parent of parents) await assertDirectoryHandleStillNames(parent.handle, parent.path);
}

/**
 * Hold no-follow descriptors for every HOME-owned parent during the complete
 * key operation. Reads never create state; creation adds one component at a
 * time and revalidates all already-open parent identities around each mkdir.
 * @param {string} home
 * @param {boolean} create
 */
async function openPrivateKeyParents(home, create) {
  const resolvedHome = resolve(home);
  const developmentSystem = resolve(resolvedHome, ".development-system");
  const privateDirectory = resolve(developmentSystem, "private");
  /** @type {Array<{handle: import("node:fs/promises").FileHandle, path: string}>} */
  const parents = [];
  try {
    parents.push({ handle: await openDirectoryNoFollow(resolvedHome), path: resolvedHome });
    for (const path of [developmentSystem, privateDirectory]) {
      if (create) {
        await assertParentsStillBound(parents);
        try {
          await mkdir(path, { mode: 0o700 });
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
        await assertParentsStillBound(parents);
      }
      parents.push({ handle: await openDirectoryNoFollow(path), path });
    }
    await assertParentsStillBound(parents);
    return { parents, path: resolve(privateDirectory, "skill-probe-hmac.key") };
  } catch (error) {
    await Promise.allSettled(parents.map((parent) => parent.handle.close()));
    throw error;
  }
}

/** @param {import("node:fs/promises").FileHandle} handle */
async function validateKeyHandle(handle) {
  const status = await handle.stat();
  if (!status.isFile()) throw new Error("Skill evidence key must be a regular file");
  if ((status.mode & 0o777) !== 0o600) throw new Error("Skill evidence key must have mode 0600");
}

/** @param {string} home */
export async function readSkillEvidenceKey(home) {
  const { parents, path } = await openPrivateKeyParents(home, false);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    await assertParentsStillBound(parents);
    await validateKeyHandle(handle);
    const serialized = (await handle.readFile("utf8")).trim();
    if (!/^[a-f0-9]{64}$/u.test(serialized)) throw new Error("Skill evidence key has invalid contents");
    return Buffer.from(serialized, "hex");
  } finally {
    await handle?.close();
    await Promise.allSettled(parents.map((parent) => parent.handle.close()));
  }
}

/**
 * Create the host authentication key exactly once with an exclusive open.
 * Existing keys are never overwritten and are revalidated before use.
 * @param {string} home
 */
export async function ensureSkillEvidenceKey(home) {
  const { parents, path } = await openPrivateKeyParents(home, true);
  let handle;
  let created = false;
  try {
    try {
      handle = await open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    await assertParentsStillBound(parents);
    await validateKeyHandle(handle);
    if (created) {
      const key = randomBytes(32);
      await handle.writeFile(`${key.toString("hex")}\n`, "utf8");
      await handle.sync();
      await assertParentsStillBound(parents);
      return key;
    }
    const serialized = (await handle.readFile("utf8")).trim();
    if (!/^[a-f0-9]{64}$/u.test(serialized)) throw new Error("Skill evidence key has invalid contents");
    return Buffer.from(serialized, "hex");
  } catch (error) {
    throw error;
  } finally {
    await handle?.close();
    await Promise.allSettled(parents.map((parent) => parent.handle.close()));
  }
}

/** @template {Record<string, unknown>} T @param {T} evidence @param {Buffer | Uint8Array} key @returns {T & {authentication: {schemaVersion: number, algorithm: string, keyId: string, payloadSha256: string, signature: string}}} */
export function authenticateSkillProbeEvidence(evidence, key) {
  const payload = canonicalEvidence(evidence);
  const keyBuffer = Buffer.from(key);
  return {
    ...evidence,
    authentication: {
      schemaVersion: 1,
      algorithm: "hmac-sha256",
      keyId: createHash("sha256").update(keyBuffer).digest("hex"),
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
      signature: createHmac("sha256", keyBuffer).update(payload).digest("hex"),
    },
  };
}

/** @param {{home: string, evidence: unknown}} input */
export async function verifySkillProbeEvidenceAuthentication(input) {
  try {
    if (input.evidence === null || typeof input.evidence !== "object" || Array.isArray(input.evidence)) {
      return { valid: false, reason: "operational evidence must be an object" };
    }
    const record = /** @type {Record<string, unknown>} */ (input.evidence);
    const authentication = record.authentication;
    if (authentication === null || typeof authentication !== "object" || Array.isArray(authentication)) {
      return { valid: false, reason: "operational evidence has no host authentication" };
    }
    const auth = /** @type {Record<string, unknown>} */ (authentication);
    const authenticationFields = ["schemaVersion", "algorithm", "keyId", "payloadSha256", "signature"];
    if (
      Object.keys(auth).some((key) => !authenticationFields.includes(key)) ||
      auth.schemaVersion !== 1 ||
      auth.algorithm !== "hmac-sha256" ||
      typeof auth.keyId !== "string" || !/^[a-f0-9]{64}$/u.test(auth.keyId) ||
      typeof auth.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(auth.payloadSha256) ||
      typeof auth.signature !== "string" || !/^[a-f0-9]{64}$/u.test(auth.signature)
    ) {
      return { valid: false, reason: "operational evidence authentication is malformed" };
    }
    const key = await readSkillEvidenceKey(input.home);
    const expectedKeyId = createHash("sha256").update(key).digest("hex");
    const payload = canonicalEvidence(record);
    const expectedPayloadSha256 = createHash("sha256").update(payload).digest("hex");
    const expectedSignature = createHmac("sha256", key).update(payload).digest("hex");
    const keyMatches = timingSafeEqual(Buffer.from(auth.keyId, "hex"), Buffer.from(expectedKeyId, "hex"));
    const payloadMatches = timingSafeEqual(Buffer.from(auth.payloadSha256, "hex"), Buffer.from(expectedPayloadSha256, "hex"));
    const signatureMatches = timingSafeEqual(Buffer.from(auth.signature, "hex"), Buffer.from(expectedSignature, "hex"));
    return keyMatches && payloadMatches && signatureMatches
      ? { valid: true, reason: null }
      : { valid: false, reason: "operational evidence authentication does not match this host or payload" };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
