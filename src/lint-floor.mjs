// @ts-check
// Hard rule from the 2026-10-12 mistake log (lint-migration-weakened-gate):
// a lint migration records the enabled rules before the change and proves
// afterwards that none was dropped or downgraded from error to warning.
// Snapshot on the base checkout, migrate, then compare on the candidate.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const eslintConfigs = ["eslint.config.mjs", "eslint.config.js", "eslint.config.cjs", "eslint.config.ts"];
const scopeAliases = /** @type {Record<string, string>} */ ({
  "@typescript-eslint": "typescript", "typescript-eslint": "typescript", "react-hooks": "react", "react-compiler": "react", "react-refresh": "react",
  "@next/next": "nextjs", next: "nextjs", "jsx-a11y": "jsx_a11y", "jsx_a11y": "jsx_a11y", n: "node",
});
const defaultPlugins = ["eslint", "typescript", "unicorn", "oxc"];

/** Normalize a rule id from either tool to "scope/name" with Oxlint scopes. @param {string} id */
export function normalizeRule(id) {
  const index = id.lastIndexOf("/");
  if (index < 0) return `eslint/${id}`;
  const scope = id.slice(0, index), name = id.slice(index + 1);
  return `${scopeAliases[scope] ?? scope}/${name}`;
}

/** @param {unknown} value @returns {"error"|"warn"|"off"} */
function severity(value) {
  const level = Array.isArray(value) ? value[0] : value;
  if (level === 2 || level === "error" || level === "deny") return "error";
  if (level === 1 || level === "warn") return "warn";
  return "off";
}

/** @param {string} root @param {string} command @param {string[]} args */
function run(root, command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/** @param {string} root */
function trackedFiles(root) {
  return run(root, "git", ["ls-files"]).split("\n").filter(Boolean);
}

/** @param {string} root @param {string} dir */
function oxlintRules(root, dir) {
  const binary = path.join(root, "node_modules/.bin/oxlint");
  if (!existsSync(binary)) throw new Error(`Oxlint config at ${dir || "."} but node_modules/.bin/oxlint is missing; install dependencies first`);
  const cwd = path.join(root, dir);
  const config = JSON.parse(run(cwd, binary, ["--print-config"]));
  const catalog = /** @type {{scope:string,value:string,category:string,type_aware:boolean}[]} */ (JSON.parse(run(cwd, binary, ["--rules", "--format", "json"])));
  const plugins = new Set((config.plugins ?? defaultPlugins).map((/** @type {string} */ name) => name.replace("-", "_")));
  plugins.add("eslint");
  const categories = config.categories ?? { correctness: "error" };
  const typeAware = Boolean(config.options?.typeAware);
  /** @type {Map<string, "error"|"warn">} */
  const enabled = new Map();
  for (const rule of catalog) {
    const level = severity(categories[rule.category]);
    if (level === "off" || !plugins.has(rule.scope) || (rule.type_aware && !typeAware)) continue;
    enabled.set(`${rule.scope}/${rule.value}`, level);
  }
  const typed = new Set(catalog.filter(rule => rule.type_aware).map(rule => `${rule.scope}/${rule.value}`));
  for (const [id, value] of Object.entries(config.rules ?? {})) {
    const key = normalizeRule(id), level = severity(value);
    if (level === "off" || (typed.has(key) && !typeAware)) enabled.delete(key);
    else enabled.set(key, level);
  }
  // A rule an override enables still runs for those files, so it counts.
  for (const override of config.overrides ?? []) {
    for (const [id, value] of Object.entries(override.rules ?? {})) {
      const key = normalizeRule(id), level = severity(value);
      if (level === "off" || (typed.has(key) && !typeAware)) continue;
      if (enabled.get(key) !== "error") enabled.set(key, level);
    }
  }
  return enabled;
}

/** @param {string} root @param {string} dir @param {string[]} files */
function eslintRules(root, dir, files) {
  const binary = path.join(root, "node_modules/.bin/eslint");
  const local = path.join(root, dir, "node_modules/.bin/eslint");
  const command = existsSync(local) ? local : binary;
  if (!existsSync(command)) throw new Error(`ESLint config at ${dir || "."} but no eslint binary is installed`);
  /** @type {Map<string, "error"|"warn">} */
  const enabled = new Map();
  const prefix = dir ? `${dir}/` : "";
  const samples = [/\.tsx$/, /\.ts$/, /\.m?jsx?$/].map(pattern => files.find(file => file.startsWith(prefix) && pattern.test(file) && !file.includes("/_generated/"))).filter(Boolean);
  for (const sample of samples) {
    let config;
    try { config = JSON.parse(run(path.join(root, dir), command, ["--print-config", path.relative(dir, /** @type {string} */ (sample))])); } catch { continue; }
    for (const [id, value] of Object.entries(config.rules ?? {})) {
      const level = severity(value);
      if (level !== "off") enabled.set(normalizeRule(id), level === "error" || enabled.get(normalizeRule(id)) === "error" ? "error" : "warn");
    }
  }
  return enabled;
}

/** @param {{ root: string }} options */
export function lintRuleSnapshot({ root }) {
  const files = trackedFiles(root);
  /** @type {Record<string, "error"|"warn">} */
  const rules = {};
  const sources = [];
  const merge = (/** @type {Map<string, "error"|"warn">} */ map) => { for (const [id, level] of map) if (rules[id] !== "error") rules[id] = level; };
  for (const file of files) {
    const name = path.basename(file), dir = path.dirname(file) === "." ? "" : path.dirname(file);
    if (file.includes("node_modules/")) continue;
    if (name === ".oxlintrc.json") { merge(oxlintRules(root, dir)); sources.push(file); }
    if (eslintConfigs.includes(name)) { merge(eslintRules(root, dir, files)); sources.push(file); }
  }
  const head = run(root, "git", ["rev-parse", "HEAD"]).trim();
  return { schemaVersion: 1, revision: head, sources, ruleCount: Object.keys(rules).length, rules: Object.fromEntries(Object.entries(rules).sort()) };
}

/** @param {{ root: string, snapshot?: string, write?: string, allow?: string[] }} options */
export function checkLintFloor({ root, snapshot, write, allow = [] }) {
  const current = lintRuleSnapshot({ root });
  if (write) {
    writeFileSync(write, `${JSON.stringify(current, null, 2)}\n`);
    return { operation: "check-lint-floor", mode: "snapshot", valid: true, path: write, ruleCount: current.ruleCount, sources: current.sources };
  }
  if (!snapshot) throw new Error("check-lint-floor requires --write <file> on the base checkout or --snapshot <file> on the candidate");
  const base = JSON.parse(readFileSync(snapshot, "utf8"));
  const dropped = [], downgraded = [];
  for (const [recorded, level] of Object.entries(/** @type {Record<string, string>} */ (base.rules))) {
    const id = normalizeRule(recorded);
    if (allow.includes(id) || allow.includes(recorded)) continue;
    // Oxlint implements typescript-eslint extension rules under the core name.
    const twin = id.startsWith("typescript/") ? `eslint/${id.slice(11)}` : id.startsWith("eslint/") ? `typescript/${id.slice(7)}` : id;
    const now = current.rules[id] ?? current.rules[twin];
    if (!now) dropped.push(id);
    else if (level === "error" && now === "warn") downgraded.push(id);
  }
  return {
    operation: "check-lint-floor", mode: "compare", valid: dropped.length === 0 && downgraded.length === 0,
    baseRevision: base.revision, baseRuleCount: base.ruleCount, ruleCount: current.ruleCount, dropped, downgraded,
  };
}

/** @param {ReturnType<typeof checkLintFloor>} result */
export function formatLintFloor(result) {
  if (result.mode === "snapshot") return `Lint rule snapshot: ${result.ruleCount} enabled rules from ${result.sources?.length ?? 0} configs -> ${result.path}`;
  const lines = [`Lint rules: ${result.baseRuleCount} at ${String(result.baseRevision).slice(0, 7)}, ${result.ruleCount} now.`];
  for (const id of result.dropped ?? []) lines.push(`  dropped: ${id}`);
  for (const id of result.downgraded ?? []) lines.push(`  error -> warn: ${id}`);
  lines.push(result.valid ? "Lint floor OK." : "Re-enable each rule, keep it in the residual ESLint config, or pass --allow <scope/rule> for a decided removal.");
  return lines.join("\n");
}
