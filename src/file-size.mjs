// @ts-check
// Shared file size budget for hand-written source (X bookmark 54, 2026-11-02 review).
//
// Large files are expensive for agents: every read pulls the whole file into
// context and every edit risks unrelated regressions. A changed source file may
// not end past the token budget (bytes / 4). Files already over the budget may
// shrink, and may grow by at most growthBytes per change, so they move toward
// smaller modules instead of absorbing more code. Generated, vendored and build
// files are out of scope.
//
// Modes:
//   default        staged index vs HEAD (pre-commit)
//   --base <ref>   working tree vs merge-base with <ref> (CI)
//
// A repository may add `.file-size-budget.json` at its root:
//   { "budgetTokens": 5000, "growthBytes": 1000, "include": ["apps/**"], "exclude": ["**/legacy/**"] }
// include replaces the default scope (every source extension); exclude adds to the built-in exclusions.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const BYTES_PER_TOKEN = 4;
export const DEFAULT_BUDGET_TOKENS = 5000;
export const DEFAULT_GROWTH_BYTES = 1000;
export const CONFIG_FILE = ".file-size-budget.json";

const SOURCE = /\.(?:[cm]?[jt]sx?|astro|vue|svelte|css|scss|py|swift|kt|kts|go|rs)$/;
const BUILT_IN_EXCLUDES = [
  /(?:^|\/)_generated\//,
  /(?:^|\/)worker-configuration\.d\.ts$/,
  /(?:^|\/)routeTree\.gen\.ts$/,
  /\.gen\.[cm]?[jt]sx?$/,
  /\.min\.(?:js|css)$/,
  /(?:^|\/)(?:node_modules|vendor|dist|build|out|coverage|\.next|\.astro|\.wrangler|\.output|\.expo|Pods)\//,
];

/** @typedef {{path: string, beforeBytes: number|null, afterBytes: number, kind: "over-budget"|"oversized-growth", detail: string}} FileSizeFinding */
/** @typedef {{budgetTokens: number, growthBytes: number, include: string[], exclude: string[]}} FileSizeConfig */

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** @param {string} root @param {string} spec @returns {number|null} */
function blobSize(root, spec) {
  try { return Number(git(root, ["cat-file", "-s", spec]).trim()); } catch { return null; }
}

/** @param {unknown} value @param {string} name @returns {string[]} */
function globList(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item === "")) throw new Error(`${CONFIG_FILE}: ${name} must be a list of glob strings`);
  return value;
}

/** @param {unknown} value @param {string} name @param {number} fallback */
function positive(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${CONFIG_FILE}: ${name} must be a non-negative integer`);
  return value;
}

/** Read the optional repository config; malformed config fails instead of silently using defaults. @param {string} root @returns {FileSizeConfig} */
export function readFileSizeConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) return { budgetTokens: DEFAULT_BUDGET_TOKENS, growthBytes: DEFAULT_GROWTH_BYTES, include: [], exclude: [] };
  /** @type {Record<string, unknown>} */
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new Error(`${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} must be a JSON object`);
  const unknown = Object.keys(raw).filter(key => !["budgetTokens", "growthBytes", "include", "exclude"].includes(key));
  if (unknown.length) throw new Error(`${CONFIG_FILE}: unknown keys ${unknown.join(", ")}`);
  return {
    budgetTokens: positive(raw.budgetTokens, "budgetTokens", DEFAULT_BUDGET_TOKENS),
    growthBytes: positive(raw.growthBytes, "growthBytes", DEFAULT_GROWTH_BYTES),
    include: globList(raw.include, "include"),
    exclude: globList(raw.exclude, "exclude"),
  };
}

/** @param {string} file @param {FileSizeConfig} config */
export function isBudgetedSource(file, config) {
  if (!SOURCE.test(file) || BUILT_IN_EXCLUDES.some(pattern => pattern.test(file))) return false;
  if (config.exclude.some(glob => path.matchesGlob(file, glob))) return false;
  return config.include.length === 0 || config.include.some(glob => path.matchesGlob(file, glob));
}

/** @param {string} root @param {string|undefined} base */
function candidates(root, base) {
  if (!base) {
    return git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0").filter(Boolean)
      .map(file => ({ file, before: blobSize(root, `HEAD:${file}`), after: blobSize(root, `:${file}`) }));
  }
  const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
  // Untracked files count too, so a local --base run sees new modules before they are committed.
  const changed = new Set([
    ...git(root, ["diff", "--name-only", "--diff-filter=ACMR", "-z", mergeBase]).split("\0"),
    ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
  ].filter(Boolean));
  return [...changed]
    .map(file => {
      const absolute = path.join(root, file);
      return { file, before: blobSize(root, `${mergeBase}:${file}`), after: existsSync(absolute) ? statSync(absolute).size : null };
    });
}

/**
 * Checks changed source files against the token budget.
 * @param {{root?: string, base?: string}} [options]
 * @returns {{ok: boolean, operation: "check-file-size", root: string, mode: "staged"|"base", base?: string, budgetTokens: number, growthBytes: number, checked: number, findings: FileSizeFinding[]}}
 */
export function checkFileSize({ root = process.cwd(), base } = {}) {
  const top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const config = readFileSizeConfig(top);
  const budgetBytes = config.budgetTokens * BYTES_PER_TOKEN;
  const tokens = (/** @type {number} */ bytes) => Math.round(bytes / BYTES_PER_TOKEN);
  /** @type {FileSizeFinding[]} */
  const findings = [];
  let checked = 0;
  for (const { file, before, after } of candidates(top, base)) {
    if (after === null || !isBudgetedSource(file, config)) continue;
    checked += 1;
    if (after <= budgetBytes) continue;
    const wasOversized = before !== null && before > budgetBytes;
    if (wasOversized && after - before <= config.growthBytes) continue;
    findings.push(wasOversized
      ? { path: file, beforeBytes: before, afterBytes: after, kind: "oversized-growth",
        detail: `already over the ${config.budgetTokens}-token budget (~${tokens(before)} -> ~${tokens(after)} tokens). Grow it by at most ${config.growthBytes} bytes per change: move the new code into a focused module next to it and import it.` }
      : { path: file, beforeBytes: before, afterBytes: after, kind: "over-budget",
        detail: `~${tokens(after)} tokens, over the ${config.budgetTokens}-token budget. Split it by responsibility into focused modules before committing.` });
  }
  return { ok: findings.length === 0, operation: "check-file-size", root: top, mode: base ? "base" : "staged", ...(base ? { base } : {}),
    budgetTokens: config.budgetTokens, growthBytes: config.growthBytes, checked, findings };
}

/** @param {ReturnType<typeof checkFileSize>} result */
export function formatFileSize(result) {
  const scope = result.mode === "base" ? `changes since ${result.base}` : "staged changes";
  if (result.findings.length === 0) return `File size budget OK: ${result.checked} source files in ${scope} (budget ${result.budgetTokens} tokens).`;
  return [`File size budget: ${result.findings.length} files over budget in ${scope}:`, ...result.findings.map(finding => `- ${finding.path} [${finding.kind}] ${finding.detail}`)].join("\n");
}

/** CLI entry: [--root <dir>] [--base <ref>] [--json]. @param {string[]} args */
export function runFileSizeCommand(args) {
  const json = args.includes("--json");
  /** @type {Record<string, string>} */
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") continue;
    if (arg !== "--root" && arg !== "--base") throw new Error(`Unknown option for check-file-size: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    values[arg.slice(2)] = value;
  }
  const result = checkFileSize({ root: path.resolve(values.root ?? process.cwd()), base: values.base });
  return { result, output: json ? JSON.stringify(result) : formatFileSize(result), json };
}
