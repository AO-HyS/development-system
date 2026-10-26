// @ts-check
// Edits to AGENTS.md, CLAUDE.md and lint configuration the operator allows for one repository,
// one task and a limited time. The guard's docs-config-write rule reads these grants and blocks
// agents from running `allow-docs` or writing the grant file with ordinary commands. Like the
// rest of the guard, this stops habitual or accidental self-granting, not an agent that
// deliberately writes through interpreter file APIs.
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export const docsGrantsRelative = ".development-system/docs-grants.json";
const defaultHours = 2, maxHours = 24;
const taskPattern = /^[a-z0-9-]+$/u;

/** @typedef {{root: string, inode: string, task: string, createdAt: string, expiresAt: string, reason: string}} DocsGrant */

/** @param {string} path @returns {DocsGrant[]} */
function readGrants(path) {
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  const grants = JSON.parse(text).grants;
  return Array.isArray(grants) ? grants : [];
}

/** @param {DocsGrant[]} grants @param {Date} now */
const active = (grants, now) => grants.filter(grant => Date.parse(grant?.expiresAt) > now.getTime());

/**
 * Add, renew or revoke the grant for one repository; expired grants are dropped on every write.
 * `confirm` runs after validation and before the write (the CLI's interactive operator confirmation).
 * @param {{home: string, root: string, task?: string, hours?: number, reason?: string, revoke?: boolean, now?: Date, confirm?: (directory: string) => Promise<void>}} options
 */
export async function allowDocs({ home, root, task = "", hours = defaultHours, reason = "", revoke = false, now = new Date(), confirm }) {
  if (!root) throw new Error("allow-docs requires a repository directory");
  if (!revoke && !taskPattern.test(task)) throw new Error("allow-docs requires --task <slug> (lowercase letters, digits and hyphens)");
  if (!(hours > 0 && hours <= maxHours)) throw new Error(`--hours must be greater than 0 and at most ${maxHours}`);
  const directory = realpathSync(resolve(root));
  const stat = statSync(directory, { bigint: true });
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${directory}`);
  // A grant names a project directory, never /, /Users or a whole home directory.
  const homeDirectory = realpathSync(resolve(home));
  if (directory.split(sep).filter(Boolean).length < 3 || homeDirectory === directory || homeDirectory.startsWith(`${directory}${sep}`)) {
    throw new Error(`A grant must name a project directory, not ${directory}`);
  }
  if (!revoke && confirm) await confirm(directory);
  const path = resolve(home, docsGrantsRelative);
  const grants = active(readGrants(path), now).filter(grant => grant.root !== directory);
  if (!revoke) grants.push({ root: directory, inode: stat.ino.toString(), task, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(), reason });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, grants }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return { ok: true, operation: "allow-docs", path, root: directory, task: revoke ? null : task, revoked: revoke, grants };
}

/** Environment markers agent shells set (Claude Code, Codex, T3 and generic agent runners). */
const agentMarkers = ["CLAUDECODE", "AI_AGENT", "CODEX_THREAD_ID", "CODEX_SANDBOX"];

/**
 * The operator confirms each grant at an interactive terminal by typing the repository's name, so an
 * agent shell (no terminal, agent markers) cannot grant itself however the command is spelled.
 * @param {string} directory
 */
export async function confirmOperatorDocsGrant(directory) {
  const marker = agentMarkers.find(name => process.env[name]);
  if (marker) throw new Error(`allow-docs refuses to run inside an agent shell (${marker} is set); the operator runs it in their own terminal`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("allow-docs needs an interactive terminal; the operator runs it in their own terminal");
  const name = directory.split(sep).pop();
  const { createInterface } = await import("node:readline/promises");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Allow agent edits to AGENTS.md, CLAUDE.md and lint configuration in ${directory}? Type "${name}" to confirm: `);
    if (answer.trim() !== name) throw new Error("Not confirmed; no grant was written");
  } finally { prompt.close(); }
}

/** @param {{home: string, now?: Date}} options */
export function listDocsGrants({ home, now = new Date() }) {
  const path = resolve(home, docsGrantsRelative);
  return { ok: true, operation: "docs-grants", path, grants: active(readGrants(path), now) };
}

/** @param {{operation: string, revoked?: boolean, root?: string, task?: string | null, grants: DocsGrant[]}} result */
export function formatDocsGrants(result) {
  const lines = result.operation === "allow-docs"
    ? [result.revoked ? `Revoked docs edits in ${result.root}.` : `Docs edits allowed in ${result.root} for task ${result.task}.`]
    : [];
  if (result.grants.length === 0) lines.push("No active docs grants.");
  for (const grant of result.grants) lines.push(`- ${grant.root} (${grant.task}) until ${grant.expiresAt}${grant.reason ? ` (${grant.reason})` : ""}`);
  return lines.join("\n");
}
