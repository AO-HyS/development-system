import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEST_FILE_PATTERN_SOURCES, TEST_FILE_PATTERNS } from "./test-change-policy.mjs";

/** Indexes in TEST_FILE_PATTERN_SOURCES that describe runner configuration rather than test files. */
const CONFIG_PATTERN_INDEXES = new Set([4, 5, 6, 7, 8]);
const RUNNER = /\b(?:vitest|jest|mocha|ava|cypress\s+run|playwright\s+test|node\s+--test|pytest|karma\s+start)\b/;
const CI_TEST = /(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b/;
const TEST_DEPENDENCIES = new Set([
  "vitest", "jest", "mocha", "ava", "cypress", "@playwright/test", "ts-jest", "convex-test", "react-test-renderer",
]);
const TEST_DEPENDENCY_PREFIXES = ["@vitest/", "@testing-library/", "jest-"];
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/**
 * @typedef {{path: string, kind: "test-file" | "test-config" | "test-script" | "test-dependency" | "ci-test-step", detail: string}} NoTestsFinding
 */

/**
 * Reports automated tests, runner configuration, test scripts, test dependencies and CI test steps.
 * Files come from git (tracked plus untracked, excluding ignored files).
 * @param {{root?: string, allow?: string[]}} [options]
 * @returns {{ok: boolean, operation: "check-no-tests", root: string, findings: NoTestsFinding[]}}
 */
export function findAutomatedTests({ root = process.cwd(), allow = [] } = {}) {
  const repository = resolve(root);
  const prefixes = [...allow, ...readAllowConfig(repository)].filter((prefix) => typeof prefix === "string" && prefix);
  const allowed = (/** @type {string} */ path) => prefixes.some((prefix) => path.startsWith(prefix));
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  }).split("\0").filter(Boolean);
  const unique = [...new Set(files)].filter((path) => !allowed(path)).sort();

  /** @type {NoTestsFinding[]} */
  const findings = [];
  for (const path of unique) {
    const index = TEST_FILE_PATTERNS.findIndex((pattern) => pattern.test(path));
    if (index !== -1) {
      findings.push({
        path,
        kind: CONFIG_PATTERN_INDEXES.has(index) ? "test-config" : "test-file",
        detail: `matches ${TEST_FILE_PATTERN_SOURCES[index]}`,
      });
    }
    if (path === "package.json" || path.endsWith("/package.json")) findings.push(...packageFindings(repository, path));
    if (WORKFLOW.test(path)) findings.push(...workflowFindings(repository, path));
  }
  return { ok: findings.length === 0, operation: "check-no-tests", root: repository, findings };
}

/** @param {string} repository @returns {string[]} */
function readAllowConfig(repository) {
  const file = resolve(repository, "config/no-tests-allow.json");
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || !Array.isArray(parsed.allow)) throw new Error("config/no-tests-allow.json must be {\"allow\": [\"prefix/\"]}.");
  return parsed.allow;
}

/** @param {string} repository @param {string} path @returns {string} */
function readText(repository, path) {
  const file = resolve(repository, path);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** @param {string} repository @param {string} path @returns {NoTestsFinding[]} */
function packageFindings(repository, path) {
  /** @type {NoTestsFinding[]} */
  const findings = [];
  let manifest;
  try {
    manifest = JSON.parse(readText(repository, path) || "{}");
  } catch {
    return findings;
  }
  const scripts = manifest && typeof manifest.scripts === "object" && manifest.scripts ? manifest.scripts : {};
  for (const [name, command] of Object.entries(scripts)) {
    if (name === "test" || name.startsWith("test:") || (typeof command === "string" && RUNNER.test(command))) {
      findings.push({ path, kind: "test-script", detail: `${name}: ${command}` });
    }
  }
  for (const field of ["dependencies", "devDependencies"]) {
    const dependencies = manifest && typeof manifest[field] === "object" && manifest[field] ? manifest[field] : {};
    for (const name of Object.keys(dependencies)) {
      if (TEST_DEPENDENCIES.has(name) || TEST_DEPENDENCY_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        findings.push({ path, kind: "test-dependency", detail: `${field}.${name}` });
      }
    }
  }
  return findings;
}

/** @param {string} repository @param {string} path @returns {NoTestsFinding[]} */
function workflowFindings(repository, path) {
  return readText(repository, path).split(/\r?\n/).flatMap((line, index) =>
    RUNNER.test(line) || CI_TEST.test(line)
      ? [{ path, kind: /** @type {const} */ ("ci-test-step"), detail: `line ${index + 1}: ${line.trim()}` }]
      : []);
}
