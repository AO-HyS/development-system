// @ts-check
// Test-file writes the operator allows for one directory and a limited time. The guard's
// test-file-write rule reads these grants and blocks agents from running `allow-tests` or
// writing the grant file with ordinary commands. Like the rest of the guard, this stops
// habitual or accidental self-granting, not an agent that deliberately writes through
// interpreter file APIs.
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export const grantsRelative = ".development-system/test-grants.json";
const defaultHours = 2, maxHours = 24;

/** @typedef {{root: string, inode: string, createdAt: string, expiresAt: string, reason: string}} TestGrant */

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
 * @param {{home: string, root: string, hours?: number, reason?: string, revoke?: boolean, now?: Date}} options
 */
export function allowTests({ home, root, hours = defaultHours, reason = "", revoke = false, now = new Date() }) {
  if (!root) throw new Error("allow-tests requires a directory");
  if (!(hours > 0 && hours <= maxHours)) throw new Error(`--hours must be greater than 0 and at most ${maxHours}`);
  const directory = realpathSync(resolve(root));
  const stat = statSync(directory, { bigint: true });
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${directory}`);
  // A grant names a project or lab directory, never /, /Users or a whole home directory.
  const homeDirectory = realpathSync(resolve(home));
  if (directory.split(sep).filter(Boolean).length < 3 || homeDirectory === directory || homeDirectory.startsWith(`${directory}${sep}`)) {
    throw new Error(`A grant must name a project or lab directory, not ${directory}`);
  }
  const path = resolve(home, grantsRelative);
  const grants = active(readGrants(path), now).filter(grant => grant.root !== directory);
  if (!revoke) grants.push({ root: directory, inode: stat.ino.toString(), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(), reason });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, grants }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return { ok: true, operation: "allow-tests", path, root: directory, revoked: revoke, grants };
}

/** @param {{home: string, now?: Date}} options */
export function listTestGrants({ home, now = new Date() }) {
  const path = resolve(home, grantsRelative);
  return { ok: true, operation: "test-grants", path, grants: active(readGrants(path), now) };
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
