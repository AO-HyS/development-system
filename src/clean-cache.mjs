// @ts-check
// Sanctioned cleanup of regenerable tool caches (friction hooks-block-authorized-cache-cleanup, 2026-11-02).
//
// The guard blocks `rm -rf` and large moves, so an owner-approved cleanup had no agent path. This command moves
// one entry of an allowlisted cache directory to the user's Trash (recoverable) and appends a record. Anything
// outside the allowlist, the cache root itself, links and paths that resolve elsewhere are refused.
import { appendFileSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Cache roots whose direct entries are regenerable downloads or build output. */
export const CACHE_ROOTS = [
  "Library/Caches/ms-playwright",
  "Library/Caches/ms-playwright-go",
  "Library/Caches/Cypress",
  "Library/Developer/Xcode/DerivedData",
  ".cache/ms-playwright",
  ".cache/puppeteer",
];

/**
 * @param {{target?: string, home?: string, dryRun?: boolean, now?: Date}} options
 * @returns {{ok: true, operation: "clean-cache", target: string, root: string, trashPath: string, dryRun: boolean, recordPath: string}}
 */
export function cleanCache({ target, home = homedir(), dryRun = false, now = new Date() }) {
  if (!target) throw new Error("clean-cache needs <path>: one entry inside an allowlisted cache directory");
  const absolute = path.resolve(target.replace(/^~(?=\/|$)/u, home));
  let stat;
  try { stat = lstatSync(absolute); } catch { throw new Error(`${absolute} does not exist`); }
  if (stat.isSymbolicLink()) throw new Error(`${absolute} is a symbolic link; clean-cache removes real cache entries only`);
  const real = realpathSync(absolute);
  const roots = CACHE_ROOTS.map((relative) => path.join(home, relative)).filter((root) => existsSync(root)).map((root) => realpathSync(root));
  const root = roots.find((candidate) => path.dirname(real) === candidate);
  if (!root) {
    throw new Error(`${absolute} is not a direct entry of an allowlisted cache directory (${CACHE_ROOTS.map((relative) => `~/${relative}/<entry>`).join(", ")}); anything else stays with the owner`);
  }
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const trash = path.join(home, ".Trash");
  const trashPath = path.join(trash, `${path.basename(real)}-${stamp}`);
  const recordPath = path.join(home, ".development-system/private/cache-cleanup.jsonl");
  if (!dryRun) {
    mkdirSync(trash, { recursive: true });
    renameSync(real, trashPath);
    mkdirSync(path.dirname(recordPath), { recursive: true });
    appendFileSync(recordPath, `${JSON.stringify({ at: now.toISOString(), target: real, root, trashPath })}\n`);
  }
  return { ok: true, operation: "clean-cache", target: real, root, trashPath, dryRun, recordPath };
}

/** CLI entry: <path> [--dry-run] [--home <dir>] [--json]. @param {string[]} args */
export function runCleanCacheCommand(args) {
  const json = args.includes("--json"), dryRun = args.includes("--dry-run");
  /** @type {string[]} */
  const targets = [];
  let home;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json" || arg === "--dry-run") continue;
    if (arg === "--home") { home = args[++index]; if (!home) throw new Error("--home needs a value"); continue; }
    if (arg.startsWith("--")) throw new Error(`Unknown option for clean-cache: ${arg}`);
    targets.push(arg);
  }
  if (targets.length !== 1) throw new Error("clean-cache takes exactly one <path>");
  const result = cleanCache({ target: targets[0], home: home ? path.resolve(home) : undefined, dryRun });
  const output = `${dryRun ? "Would move" : "Moved"} ${result.target} to ${result.trashPath}${dryRun ? "" : ` (record: ${result.recordPath})`}.`;
  return { result, output: json ? JSON.stringify(result) : output, json };
}
