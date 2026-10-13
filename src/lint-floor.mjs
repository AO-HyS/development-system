// @ts-check
// Hard rule from the 2026-10-12 mistake log (lint-migration-weakened-gate):
// a lint migration records, file by file, which rules run before the change and
// proves afterwards that no file lost a rule or saw one fall from error to
// warning. Snapshot on the base checkout, migrate, then compare on the
// candidate. Any configuration that cannot be inspected fails the check.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const eslintConfigs = ["eslint.config.mjs", "eslint.config.js", "eslint.config.cjs", "eslint.config.ts"];
const lintable = /\.(?:[cm]?[jt]sx?|astro|vue|svelte)$/;
const scopeAliases = /** @type {Record<string, string>} */ ({
  "@typescript-eslint": "typescript", "typescript-eslint": "typescript", "react-hooks": "react", "react-compiler": "react",
  "react-refresh": "react", "@next/next": "nextjs", next: "nextjs", "jsx-a11y": "jsx_a11y", jsx_a11y: "jsx_a11y", n: "node",
});
const defaultPlugins = ["eslint", "typescript", "unicorn", "oxc"];

/** Normalize a rule id from either tool to "scope/name" with Oxlint scopes. @param {string} id */
export function normalizeRule(id) {
  const index = id.lastIndexOf("/");
  if (index < 0) return `eslint/${id}`;
  const scope = id.slice(0, index), name = id.slice(index + 1);
  return `${scopeAliases[scope] ?? scope}/${name}`;
}

/** Oxlint implements typescript-eslint extension rules under the core name. @param {string} id */
const twin = id => id.startsWith("typescript/") ? `eslint/${id.slice(11)}` : id.startsWith("eslint/") ? `typescript/${id.slice(7)}` : id;

/** @param {unknown} value @returns {"error"|"warn"|"off"} */
function severity(value) {
  const level = Array.isArray(value) ? value[0] : value;
  if (level === 2 || level === "error" || level === "deny") return "error";
  if (level === 1 || level === "warn") return "warn";
  return "off";
}

/** @param {string} cwd @param {string} command @param {string[]} args */
function run(cwd, command, args) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
}

/** @param {string} file @param {unknown} patterns */
const matchesAny = (file, patterns) => Array.isArray(patterns) && patterns.some(pattern => path.matchesGlob(file, String(pattern)) || path.matchesGlob(file, `${String(pattern).replace(/\/$/, "")}/**`));

/** Effective Oxlint rules for each file under one config directory. @param {string} root @param {string} dir @param {string[]} files */
function oxlintRules(root, dir, files) {
  const binary = path.join(root, "node_modules/.bin/oxlint");
  if (!existsSync(binary)) throw new Error(`Oxlint config at ${dir || "."} but node_modules/.bin/oxlint is missing; install dependencies first`);
  const cwd = path.join(root, dir);
  const config = JSON.parse(run(cwd, binary, ["--print-config"]));
  const catalog = /** @type {{scope:string,value:string,category:string,type_aware:boolean}[]} */ (JSON.parse(run(cwd, binary, ["--rules", "--format", "json"])));
  const typed = new Set(catalog.filter(rule => rule.type_aware).map(rule => `${rule.scope}/${rule.value}`));
  const typeAware = Boolean(config.options?.typeAware);
  /** @param {string[]} pluginNames @param {Record<string, unknown>} categories */
  const categoryRules = (pluginNames, categories) => {
    const plugins = new Set([...pluginNames.map(name => name.replace("-", "_")), "eslint"]);
    /** @type {Map<string, "error"|"warn">} */
    const enabled = new Map();
    for (const rule of catalog) {
      const level = severity(categories[rule.category]);
      if (level !== "off" && plugins.has(rule.scope) && !(rule.type_aware && !typeAware)) enabled.set(`${rule.scope}/${rule.value}`, level);
    }
    return enabled;
  };
  /** @param {Map<string, "error"|"warn">} enabled @param {Record<string, unknown>} rules */
  const apply = (enabled, rules) => {
    for (const [id, value] of Object.entries(rules ?? {})) {
      const key = normalizeRule(id), level = severity(value);
      if (level === "off" || (typed.has(key) && !typeAware)) enabled.delete(key);
      else enabled.set(key, level);
    }
  };
  const basePlugins = config.plugins ?? defaultPlugins;
  const baseCategories = config.categories ?? { correctness: "error" };
  /** @type {Record<string, Record<string, "error"|"warn">>} */
  const result = {};
  const prefix = dir ? `${dir}/` : "";
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const local = file.slice(prefix.length);
    if (matchesAny(local, config.ignorePatterns)) continue;
    let plugins = basePlugins, categories = baseCategories;
    const overrides = (config.overrides ?? []).filter((/** @type {{files: unknown}} */ override) => matchesAny(local, override.files));
    for (const override of overrides) {
      if (override.plugins) plugins = [...new Set([...plugins, ...override.plugins])];
      if (override.categories) categories = { ...categories, ...override.categories };
    }
    const enabled = categoryRules(plugins, categories);
    apply(enabled, config.rules);
    for (const override of overrides) apply(enabled, override.rules);
    result[file] = Object.fromEntries(enabled);
  }
  return result;
}

/** Effective ESLint rules, sampled once per directory and extension. @param {string} root @param {string} dir @param {string[]} files */
function eslintRules(root, dir, files) {
  const local = path.join(root, dir, "node_modules/.bin/eslint");
  const command = existsSync(local) ? local : path.join(root, "node_modules/.bin/eslint");
  if (!existsSync(command)) throw new Error(`ESLint config at ${dir || "."} but no eslint binary is installed`);
  const prefix = dir ? `${dir}/` : "";
  const cwd = path.join(root, dir);
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const key = `${path.posix.dirname(file)}|${path.posix.extname(file)}`;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  /** @type {Record<string, Record<string, "error"|"warn">>} */
  const result = {};
  for (const members of groups.values()) {
    const sample = members[0];
    let output;
    try { output = run(cwd, command, ["--print-config", sample.slice(prefix.length)]).trim(); }
    catch (error) { throw new Error(`eslint --print-config failed for ${sample}: ${error instanceof Error ? error.message.split("\n")[0] : error}`); }
    // ESLint prints "undefined" for a file its config ignores.
    if (output === "" || output === "undefined") continue;
    const config = JSON.parse(output);
    /** @type {Record<string, "error"|"warn">} */
    const enabled = {};
    for (const [id, value] of Object.entries(config.rules ?? {})) {
      const level = severity(value);
      if (level !== "off") enabled[normalizeRule(id)] = level;
    }
    for (const file of members) result[file] = enabled;
  }
  return result;
}

/** @param {{ root: string }} options */
export function lintRuleSnapshot({ root }) {
  const tracked = run(root, "git", ["ls-files"]).split("\n").filter(Boolean);
  const files = tracked.filter(file => lintable.test(file) && !file.includes("node_modules/") && !file.includes("/_generated/"));
  /** @type {Record<string, Record<string, "error"|"warn">>} */
  const perFile = {};
  const sources = [];
  const merge = (/** @type {Record<string, Record<string, "error"|"warn">>} */ part) => {
    for (const [file, rules] of Object.entries(part)) {
      const target = perFile[file] ??= {};
      for (const [id, level] of Object.entries(rules)) if (target[id] !== "error") target[id] = level;
    }
  };
  for (const config of tracked) {
    const name = path.posix.basename(config), dir = path.posix.dirname(config) === "." ? "" : path.posix.dirname(config);
    if (config.includes("node_modules/")) continue;
    if (name === ".oxlintrc.json") { merge(oxlintRules(root, dir, files)); sources.push(config); }
    if (eslintConfigs.includes(name)) { merge(eslintRules(root, dir, files)); sources.push(config); }
  }
  const ruleIds = new Set(Object.values(perFile).flatMap(rules => Object.keys(rules)));
  return { schemaVersion: 2, revision: run(root, "git", ["rev-parse", "HEAD"]).trim(), sources, ruleCount: ruleIds.size, files: perFile };
}

/** @param {{ root: string, snapshot?: string, write?: string, allow?: string[] }} options */
export function checkLintFloor({ root, snapshot, write, allow = [] }) {
  const current = lintRuleSnapshot({ root });
  if (write) {
    writeFileSync(write, `${JSON.stringify(current)}\n`);
    return { operation: "check-lint-floor", mode: "snapshot", valid: true, path: write, ruleCount: current.ruleCount, sources: current.sources };
  }
  if (!snapshot) throw new Error("check-lint-floor requires --write <file> on the base checkout or --snapshot <file> on the candidate");
  const base = JSON.parse(readFileSync(snapshot, "utf8"));
  if (base.schemaVersion !== 2) throw new Error(`Snapshot ${snapshot} uses schema ${base.schemaVersion}; take it again with this version`);
  const allowed = new Set(allow.map(normalizeRule));
  /** @type {Map<string, {files: number, example: string}>} */
  const dropped = new Map(), downgraded = new Map();
  const note = (/** @type {Map<string, {files: number, example: string}>} */ map, /** @type {string} */ id, /** @type {string} */ file) => {
    const entry = map.get(id) ?? { files: 0, example: file };
    entry.files += 1;
    map.set(id, entry);
  };
  let compared = 0;
  for (const [file, rules] of Object.entries(/** @type {Record<string, Record<string, string>>} */ (base.files))) {
    const now = current.files[file];
    if (!now) continue; // the file was deleted or is no longer lintable
    compared += 1;
    for (const [recorded, level] of Object.entries(rules)) {
      const id = normalizeRule(recorded);
      if (allowed.has(id)) continue;
      const after = now[id] ?? now[twin(id)];
      if (!after) note(dropped, id, file);
      else if (level === "error" && after === "warn") note(downgraded, id, file);
    }
  }
  const list = (/** @type {Map<string, {files: number, example: string}>} */ map) => [...map].sort().map(([id, entry]) => ({ id, ...entry }));
  return {
    operation: "check-lint-floor", mode: "compare", valid: dropped.size === 0 && downgraded.size === 0,
    baseRevision: base.revision, baseRuleCount: base.ruleCount, ruleCount: current.ruleCount, comparedFiles: compared,
    dropped: list(dropped), downgraded: list(downgraded),
  };
}

/** @param {ReturnType<typeof checkLintFloor>} result */
export function formatLintFloor(result) {
  if (result.mode === "snapshot") return `Lint rule snapshot: ${result.ruleCount} enabled rules from ${result.sources?.length ?? 0} configs -> ${result.path}`;
  const lines = [`Lint rules: ${result.baseRuleCount} at ${String(result.baseRevision).slice(0, 7)}, ${result.ruleCount} now, across ${result.comparedFiles} files.`];
  for (const entry of result.dropped ?? []) lines.push(`  dropped: ${entry.id} (${entry.files} files, e.g. ${entry.example})`);
  for (const entry of result.downgraded ?? []) lines.push(`  error -> warn: ${entry.id} (${entry.files} files, e.g. ${entry.example})`);
  lines.push(result.valid ? "Lint floor OK." : "Re-enable each rule for those files, keep it in the residual ESLint config, or pass --allow <scope/rule> for a decided removal.");
  return lines.join("\n");
}
