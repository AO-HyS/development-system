// @ts-check
// A repository's primitives map (docs/architecture/primitives.json): the smallest units of meaning
// its system exposes, so agents compose them instead of re-implementing them (Kent C. Dodds,
// "Your Coding Agent Needs Better Primitives"). `check-primitives` keeps the map honest: every
// active or deprecated primitive points at files that exist, symbols that appear in them, and
// guarantees that name how they are verified. Goals are what a primitive should hold but does not yet.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, posix, relative, resolve } from "node:path";

export const primitivesPath = "docs/architecture/primitives.json";
const categories = ["ui", "api", "data", "infra", "agent-tools", "workflow", "auth"];
const statuses = ["active", "proposed", "deprecated"];
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * @typedef {{statement: string, verifiedBy: string}} Guarantee
 * @typedef {{id: string, category: string, status: string, summary: string, paths?: string[], symbols?: string[], guarantees?: Guarantee[], goals?: string[], replaces?: string[], docs?: string[]}} Primitive
 */

/**
 * @param {{root: string, ref?: string, file?: string}} options
 */
export function checkPrimitives({ root, ref, file = primitivesPath }) {
  const realRoot = realpathSync(resolve(root));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  /** Symlinks in the selected tree: path -> target. @type {Map<string, string>} */
  const treeLinks = new Map();
  if (ref) {
    for (const line of git("ls-tree", "-r", "-z", ref).split("\0").filter(Boolean)) {
      const [meta, path] = line.split("\t");
      if (meta.startsWith("120000 ")) treeLinks.set(path, git("show", `${ref}:${path}`));
    }
  }
  /**
   * A map may only name repository-relative paths that stay inside the repository. Every
   * symlink on the way (in the worktree, or in the tree at --ref) is followed and must stay
   * inside too, including the existing parents of a path that does not exist yet.
   * @param {string} path
   */
  const inside = (path) => {
    if (typeof path !== "string" || !path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) return false;
    if (ref) {
      let current = "";
      for (const part of path.split("/").filter(Boolean)) {
        current = current ? `${current}/${part}` : part;
        const target = treeLinks.get(current);
        if (target === undefined) continue;
        if (posix.isAbsolute(target)) return false;
        const resolved = posix.normalize(posix.join(posix.dirname(current), target));
        if (resolved === ".." || resolved.startsWith("../")) return false;
      }
      return true;
    }
    // Resolve the deepest existing ancestor, then append the parts that do not exist yet.
    let existing = resolve(realRoot, path);
    const rest = [];
    for (;;) {
      try { existing = realpathSync(existing); break; }
      catch { rest.unshift(basename(existing)); const parent = dirname(existing); if (parent === existing) return false; existing = parent; }
    }
    const rel = relative(realRoot, resolve(existing, ...rest));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  const read = (/** @type {string} */ path) => ref ? git("show", `${ref}:${path}`) : readFileSync(resolve(root, path), "utf8");
  const tracked = ref ? new Set(git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean)) : null;
  const exists = (/** @type {string} */ path) => tracked ? tracked.has(path) || [...tracked].some((entry) => entry.startsWith(`${path.replace(/\/$/, "")}/`)) : existsSync(resolve(root, path));
  /** @type {string[]} */
  const problems = [];
  let map;
  if (!inside(file)) return { ok: false, operation: "check-primitives", root, ref: ref ?? "worktree", file, valid: false, problems: [`--file must be a repository-relative path inside the repository: ${file}`], counts: {} };
  try { map = JSON.parse(read(file)); }
  catch (error) { return { ok: false, operation: "check-primitives", root, ref: ref ?? "worktree", file, valid: false, problems: [`Cannot read ${file}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`], counts: {} }; }
  if (map?.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  const items = /** @type {Primitive[]} */ (Array.isArray(map?.primitives) ? map.primitives : []);
  if (items.length === 0) problems.push("primitives must be a non-empty array");
  const ids = new Set();
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [index, item] of items.entries()) {
    const label = `primitives[${index}]${item?.id ? ` (${item.id})` : ""}`;
    if (!item || typeof item !== "object") { problems.push(`${label} is not an object`); continue; }
    if (typeof item.id !== "string" || !ID.test(item.id)) problems.push(`${label}: id must be kebab-case`);
    else if (ids.has(item.id)) problems.push(`${label}: duplicate id`);
    else ids.add(item.id);
    if (!categories.includes(item.category)) problems.push(`${label}: category must be one of ${categories.join(", ")}`);
    if (!statuses.includes(item.status)) problems.push(`${label}: status must be one of ${statuses.join(", ")}`);
    if (typeof item.summary !== "string" || !item.summary.trim()) problems.push(`${label}: summary is required`);
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    /** Optional array fields must be arrays of the right element type when present. */
    const arrayOf = (/** @type {string} */ field, /** @type {(value: any) => boolean} */ valid, /** @type {string} */ shape) => {
      const value = /** @type {Record<string, unknown>} */ (item)[field];
      if (value === undefined) return [];
      if (!Array.isArray(value) || !value.every(valid)) { problems.push(`${label}: ${field} must be an array of ${shape}`); return []; }
      return value;
    };
    const nonEmpty = (/** @type {any} */ value) => typeof value === "string" && value.trim().length > 0;
    const repoPath = (/** @type {any} */ value) => nonEmpty(value) && inside(value);
    arrayOf("goals", nonEmpty, "non-empty strings");
    arrayOf("replaces", nonEmpty, "primitive ids");
    const guarantees = arrayOf("guarantees", (value) => value && typeof value === "object" && nonEmpty(value.statement) && nonEmpty(value.verifiedBy), "{statement, verifiedBy} with non-empty text (unverified intent belongs in goals)");
    const paths = arrayOf("paths", repoPath, "repository-relative paths inside the repository");
    if (item.status !== "proposed" && paths.length === 0) problems.push(`${label}: an ${item.status} primitive needs at least one path`);
    for (const path of paths) {
      if (item.status !== "proposed" && !exists(path)) problems.push(`${label}: path does not exist: ${path}`);
    }
    for (const symbol of arrayOf("symbols", (value) => nonEmpty(value) && inside(String(value).split("#")[0]), '"path#Name" strings with a repository-relative path')) {
      const [path, name] = String(symbol).split("#");
      if (!path || !name) { problems.push(`${label}: symbol must be "path#Name": ${symbol}`); continue; }
      if (item.status === "proposed") continue;
      if (!exists(path)) { problems.push(`${label}: symbol file does not exist: ${path}`); continue; }
      let text = "";
      try { text = read(path); } catch { problems.push(`${label}: cannot read symbol file: ${path}`); continue; }
      if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) problems.push(`${label}: symbol ${name} not found in ${path}`);
    }
    void guarantees;
    for (const doc of arrayOf("docs", repoPath, "repository-relative paths inside the repository")) {
      if (!exists(doc)) problems.push(`${label}: doc does not exist: ${doc}`);
    }
  }
  for (const item of items) {
    for (const replaced of Array.isArray(item?.replaces) ? item.replaces.filter((/** @type {unknown} */ value) => typeof value === "string") : []) {
      if (!ids.has(replaced)) problems.push(`${item.id}: replaces unknown primitive ${replaced}`);
    }
  }
  return { ok: problems.length === 0, operation: "check-primitives", root, ref: ref ?? "worktree", file, valid: problems.length === 0, problems, counts };
}

/** @param {ReturnType<typeof checkPrimitives>} result */
export function formatPrimitives(result) {
  if (result.valid) return `Primitives map OK (${Object.entries(result.counts).map(([status, count]) => `${count} ${status}`).join(", ")}).`;
  return [`Primitives map invalid (${result.file} at ${result.ref}):`, ...result.problems.map((problem) => `- ${problem}`)].join("\n");
}
