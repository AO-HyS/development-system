// @ts-check
// Test-file writes the operator allows for one directory and a limited time. The guard's
// test-file-write rule trusts only the root-owned grant file, written through sudo, so a
// grant needs the operator's password: an agent running as the operator cannot forge it.
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export const testGrantsFile = "/Library/Application Support/AO-HyS/development-system/test-grants.json";
const defaultHours = 2, maxHours = 24;

/** @typedef {{root: string, inode: string, createdAt: string, expiresAt: string, reason: string, grantedBy: string}} TestGrant */

/** @param {string} path @returns {TestGrant[]} */
function readGrants(path) {
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  const grants = JSON.parse(text).grants;
  return Array.isArray(grants) ? grants : [];
}

/** @param {TestGrant[]} grants @param {Date} now */
const active = (grants, now) => grants.filter(grant => Date.parse(grant?.expiresAt) > now.getTime());

/**
 * Add, renew or revoke the grant for one directory; expired grants are dropped on every write.
 * The real grant file is root-owned, so this runs under sudo; `file` points elsewhere only for verification.
 * @param {{root: string, hours?: number, reason?: string, revoke?: boolean, file?: string, now?: Date}} options
 */
export function allowTests({ root, hours = defaultHours, reason = "", revoke = false, file = testGrantsFile, now = new Date() }) {
  if (!root) throw new Error("allow-tests requires a directory");
  if (!(hours > 0 && hours <= maxHours)) throw new Error(`--hours must be greater than 0 and at most ${maxHours}`);
  if (file === testGrantsFile && process.getuid?.() !== 0) throw new Error("allow-tests writes the root-owned grant file; run it through sudo");
  const directory = realpathSync(resolve(root));
  const stat = statSync(directory, { bigint: true });
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${directory}`);
  // A grant names a project or lab directory, never /, /Users or a whole home directory.
  if (directory.split(sep).filter(Boolean).length < 3) throw new Error(`A grant must name a project or lab directory, not ${directory}`);
  const grants = active(readGrants(file), now).filter(grant => grant.root !== directory);
  if (!revoke) {
    grants.push({ root: directory, inode: stat.ino.toString(), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(), reason, grantedBy: process.env.SUDO_USER ?? "" });
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o755 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, grants }, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, file);
  return { ok: true, operation: "allow-tests", path: file, root: directory, revoked: revoke, grants };
}

/** @param {{file?: string, now?: Date}} options */
export function listTestGrants({ file = testGrantsFile, now = new Date() }) {
  return { ok: true, operation: "test-grants", path: file, grants: active(readGrants(file), now) };
}

/** @param {{operation: string, revoked?: boolean, root?: string, grants: TestGrant[]}} result */
export function formatTestGrants(result) {
  const lines = result.operation === "allow-tests"
    ? [result.revoked ? `Revoked test writes in ${result.root}.` : `Test writes allowed in ${result.root}.`]
    : [];
  if (result.grants.length === 0) lines.push("No active test-write grants.");
  for (const grant of result.grants) lines.push(`- ${grant.root} until ${grant.expiresAt}${grant.reason ? ` (${grant.reason})` : ""}`);
  return lines.join("\n");
}
