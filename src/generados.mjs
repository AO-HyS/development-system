// @ts-check
// Generados (sobre 4.2.0): generated files in a base merge. In a product with shrink-only ledgers and generated code, every merge of the
// base into a branch rewrites those files (a ledger's revision and totals, Convex `_generated`), so the merge differs
// from git's automatic merge and used to cost a new review. A merge stays clean when what was changed on top of the
// automatic merge is only files the base branch's `config/niveles.json` declares in `generados.rutas` and `listo`
// rebuilds those same bytes itself, here, from the merge's own inputs. Nothing the commit says is trusted.
//
// The proof, for one merge commit M with parents P1 (the PR) and P2 (the base):
//   1. a detached worktree at P1 (HEAD = P1, as during `git merge` before the commit) in a temporary folder;
//   2. its files and index set to git's automatic merge of P1 and P2 (`git merge-tree --write-tree`); a declared
//      generated file git could not merge (conflict markers) starts as the base's version (P2), or absent there;
//   3. `generados.comandos` of the base branch run in order there, with the caller's environment minus GIT_* overrides;
//      any non-zero exit, timeout or missing file fails the proof;
//   4. every declared output and every file changed by hand must then match M exactly: present or absent alike,
//      the same mode (100644 or 100755; a link or a submodule fails) and the same bytes.
// `rutas` is a closed list of exact paths on the base branch (niveles.mjs refuses globs); the commit's own copy of a
// generated file never enters the temporary checkout, so nothing of the candidate proves itself.
// Every other file of M equals the automatic merge by construction (the caller checks it first), so the generators
// run on reviewed inputs: the PR's commits, which the coverage walk judges on their own, and the base branch.
// Residual trust: the generators are the repository's code; a generator that reads M's objects from the repository
// could copy them. That is code a reviewer reads in the PR or the base, never bytes only the merge carries.
// It runs only after every other commit of the interval is covered (pr-review-status.mjs coverage), so the generators
// are reviewed code or cited fixes, the same code `listo` already runs as `comprobaciones` on the head. It is not a
// sandbox: they run as the operator, like those checks.
// A passing proof is cached per merge commit, commands and globs under the caller's cache folder; a failure is not.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** @typedef {import("./niveles.mjs").Generados} Generados */
/** @typedef {{config: Generados, cacheDir: string}} GeneradosContext */

const TIMEOUT_MS = 20 * 60_000;

/** True when the base branch declares `name` generated. @param {GeneradosContext | null | undefined} context @param {string} name */
export function isGenerated(context, name) {
  return Boolean(context) && /** @type {GeneradosContext} */ (context).config.rutas.includes(name);
}

/** @type {Map<string, {ok: boolean, reason: string}>} */
const memo = new Map();

/**
 * Environment for git and the generators: no GIT_* variable at all, so none can point them at another repository,
 * index or work tree or inject configuration (GIT_CONFIG_COUNT/KEY/VALUE, GIT_CONFIG_PARAMETERS).
 */
export function gitEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) env[key] = value;
  return env;
}

/**
 * Rebuild the declared generated files of one base merge and compare them with the commit, byte for byte.
 * Runs git in the current working directory (the PR's checkout).
 * @param {{context: GeneradosContext, sha: string, first: string, second: string, written: string, tree: string, files: {filename: string, status: string}[], conflicted: string[]}} input
 *   `written` is git's automatic merge tree, `tree` the commit's, `files` what differs between them, `conflicted` the
 *   paths git could not merge
 * @returns {{ok: boolean, reason: string}}
 */
export function proveRegenerated({ context, sha, first, second, written, tree, files, conflicted }) {
  const key = createHash("sha256").update(JSON.stringify({ prueba: 4, sha, tree, rutas: context.config.rutas, comandos: context.config.comandos })).digest("hex").slice(0, 40);
  const cached = memo.get(key);
  if (cached) return cached;
  const cacheFile = path.join(context.cacheDir, `${key}.json`);
  if (existsSync(cacheFile)) {
    try {
      const stored = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (stored?.ok === true && stored.sha === sha && stored.tree === tree) { const result = { ok: true, reason: String(stored.reason ?? "regenerados") }; memo.set(key, result); return result; }
    } catch { /* recompute */ }
  }
  const result = rebuild({ context, first, second, written, tree, files, conflicted });
  memo.set(key, result);
  if (result.ok) {
    mkdirSync(context.cacheDir, { recursive: true, mode: 0o700 });
    writeFileSync(cacheFile, `${JSON.stringify({ ok: true, sha, tree, reason: result.reason, rutas: context.config.rutas, comandos: context.config.comandos, en: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(cacheFile, 0o600);
  }
  return result;
}

/** @param {{context: GeneradosContext, first: string, second: string, written: string, tree: string, files: {filename: string, status: string}[], conflicted: string[]}} input @returns {{ok: boolean, reason: string}} */
function rebuild({ context, first, second, written, tree, files, conflicted }) {
  const env = gitEnv();
  /** @param {string[]} args @param {string} [cwd] */
  const git = (args, cwd) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  /** @param {string} object @param {string} [cwd] */
  const blob = (object, cwd) => execFileSync("git", ["cat-file", "blob", object], { cwd, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  /** Mode and object of a path in a tree, or null when absent. @param {string} treeish @param {string} name */
  const entry = (treeish, name) => {
    const line = git(["ls-tree", "-z", treeish, "--", name]).split("\0").find((row) => row.endsWith(`\t${name}`));
    if (!line) return null;
    const [mode, type, object] = line.slice(0, line.indexOf("\t")).split(" ");
    return { mode, type, object };
  };
  const dir = mkdtempSync(path.join(tmpdir(), "ds-generados-"));
  let added = false;
  try {
    // A run killed mid-proof leaves a registration whose folder is gone; drop such leftovers first.
    try { git(["worktree", "prune"]); } catch { /* best effort */ }
    // No hook runs for the temporary checkout, and its work tree is the temporary folder whatever the config says.
    git(["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", "--no-checkout", dir, first]);
    added = true;
    if (git(["rev-parse", "--show-toplevel"], dir).trim() !== realpathSync(dir)) return { ok: false, reason: "la copia temporal no es su propio árbol de trabajo" };
    git(["-c", "core.hooksPath=/dev/null", "read-tree", "--reset", "-u", written], dir);
    for (const name of conflicted.filter((file) => isGenerated(context, file))) {
      const target = path.join(dir, name);
      const base = entry(second, name);
      rmSync(target, { force: true });
      if (base && base.type === "blob") writeFileSync(target, blob(base.object));
    }
    const started = Date.now();
    for (const command of context.config.comandos) {
      const left = TIMEOUT_MS - (Date.now() - started);
      if (left <= 0) return { ok: false, reason: `los comandos de generados pasaron de ${TIMEOUT_MS / 60_000} min` };
      process.stderr.write(`listo: regenerando con «${command}» sobre la fusión automática de ${first.slice(0, 12)} y ${second.slice(0, 12)}\n`);
      const child = spawnSync(command, { cwd: dir, env, shell: true, stdio: ["ignore", 2, 2], timeout: left });
      if (child.status !== 0) return { ok: false, reason: `«${command}» salió con ${child.status ?? child.signal ?? "error"}` };
    }
    /** @type {string[]} */
    const differ = [];
    // Every declared output, not only the ones the commit changed: presence, mode and bytes must all match, so an
    // output the generator adds or drops that the commit does not (or the reverse) also fails.
    for (const name of [...new Set([...context.config.rutas, ...files.map((file) => file.filename)])]) {
      const expected = entry(tree, name);
      const target = path.join(dir, name);
      let stat = null;
      try { stat = lstatSync(target); } catch { stat = null; }
      if (!expected) { if (stat) differ.push(`${name} (el commit no lo tiene; la regeneración sí)`); continue; }
      if (expected.type !== "blob" || (expected.mode !== "100644" && expected.mode !== "100755")) { differ.push(`${name} (modo ${expected.mode} en el commit)`); continue; }
      if (!stat?.isFile()) { differ.push(`${name} (la regeneración no lo produce)`); continue; }
      if ((expected.mode === "100755") !== ((stat.mode & 0o100) !== 0)) { differ.push(`${name} (modo distinto)`); continue; }
      if (!readFileSync(target).equals(blob(expected.object))) differ.push(name);
    }
    if (differ.length) return { ok: false, reason: `no coinciden con lo regenerado: ${differ.slice(0, 5).join(", ")}` };
    return { ok: true, reason: `regenerados byte a byte: ${files.map((file) => file.filename).slice(0, 5).join(", ")}${files.length > 5 ? ` y ${files.length - 5} más` : ""}` };
  } catch (error) {
    const text = String(/** @type {{stderr?: string}} */ (error)?.stderr || (error instanceof Error ? error.message : error)).trim().split("\n")[0];
    return { ok: false, reason: `no pude regenerar en una copia temporal: ${text}` };
  } finally {
    try { if (added) git(["worktree", "remove", "--force", dir]); } catch { /* fall through to the folder */ }
    rmSync(dir, { recursive: true, force: true });
  }
}
