import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findTestDirectives, TEST_CONFIG_PATTERN_SOURCES, TEST_FILE_PATTERN_SOURCES, TEST_FILE_PATTERNS } from "./test-change-policy.mjs";
const RUNNER = /\b(?:vitest|jest|mocha|ava|cypress\s+run|playwright\s+test|node\s+--test|pytest|karma\s+start)\b/;
const CI_TEST = /(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b/;
const TEST_DEPENDENCIES = new Set([
  "vitest", "jest", "mocha", "ava", "cypress", "@playwright/test", "ts-jest", "convex-test", "react-test-renderer",
]);
const TEST_DEPENDENCY_PREFIXES = ["@vitest/", "@testing-library/", "jest-"];
// Native coverage belongs to the CLI/CI checker. Published write-guard patterns
// remain unchanged; this coverage does not prove native hook prevention (ADR0060).
const NATIVE_TEST_FILE = /(?:^|\/)src\/(?:test|androidTest)\/(?:[^/]+\/)*[^/]+\.(?:kt|kts|java)$|(?:^|\/)Tests\/(?:[^/]+\/)*[^/]+\.swift$/;
const NATIVE_CONTENT = /\.(?:gradle|gradle\.kts|sh|rb|xcscheme)$|(?:^|\/)(?:Package\.swift|project\.pbxproj)$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
/** Vendored Python environments are never repository tests. */
const VENDORED_SEGMENT = /(?:^|\/)(?:site-packages|\.venv|venv)(?:\/|$)/;
/** Live instruction documents: README*.md, AGENTS.md, CLAUDE.md, CONTRIBUTING.md at any depth, and docs/**\/*.md. */
const INSTRUCTION_DOCUMENT = /(?:^|\/)(?:README[^/]*|AGENTS|CLAUDE|CONTRIBUTING)\.md$|^docs\/.+\.md$/;
/**
 * Historical or published records that are not live instructions, and installed skill trees
 * (.agents/skills, .claude/skills, ...), whose catalog or upstream content the release gardener governs.
 */
const NON_INSTRUCTION_DOCUMENT = /^(?:docs\/current-work\.md|docs\/adr\/|artifacts\/|manifests\/|catalog\/)|(?:^|\/)node_modules\/|(?:^|\/)CHANGELOG[^/]*$|(?:^|\/)\.[\w-]+\/skills\//;
/** Blockquote lines quote history or other sources rather than instruct. */
const BLOCKQUOTE = /^\s*>/;

/**
 * @typedef {{path: string, kind: "test-file" | "test-config" | "test-script" | "test-dependency" | "ci-test-step" | "doc-directive", detail: string}} NoTestsFinding
 */

/**
 * Reports automated tests, runner configuration, test scripts, test dependencies, CI test steps and live
 * instruction documents that direct an agent to write or run tests.
 * Files come from git (tracked plus untracked, excluding ignored files); allow prefixes and vendored
 * Python environments (site-packages, .venv, venv) are skipped.
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
  const unique = [...new Set(files)].filter((path) => !allowed(path) && !VENDORED_SEGMENT.test(path) && regularFile(repository, path)).sort();

  /** @type {NoTestsFinding[]} */
  const findings = [];
  for (const path of unique) {
    const index = TEST_FILE_PATTERNS.findIndex((pattern) => pattern.test(path));
    if (index !== -1 || NATIVE_TEST_FILE.test(path)) {
      findings.push({
        path,
        kind: index !== -1 && TEST_CONFIG_PATTERN_SOURCES.has(TEST_FILE_PATTERN_SOURCES[index]) ? "test-config" : "test-file",
        detail: `matches ${index === -1 ? NATIVE_TEST_FILE.source : TEST_FILE_PATTERN_SOURCES[index]}`,
      });
    }
    if (path === "package.json" || path.endsWith("/package.json")) findings.push(...packageFindings(repository, path));
    if (WORKFLOW.test(path)) findings.push(...workflowFindings(repository, path));
    if (NATIVE_CONTENT.test(path)) findings.push(...nativeFindings(repository, path));
    if (INSTRUCTION_DOCUMENT.test(path) && !NON_INSTRUCTION_DOCUMENT.test(path)) findings.push(...documentFindings(repository, path));
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
    if (name === "test" || name.startsWith("test:") || (typeof command === "string" && (RUNNER.test(command) || nativeCommand(command)))) {
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
    RUNNER.test(line) || CI_TEST.test(line) || nativeCommand(workflowCommand(line))
      ? [{ path, kind: /** @type {const} */ ("ci-test-step"), detail: `line ${index + 1}: ${line.trim()}` }]
      : []);
}

/** @param {string} repository @param {string} path @returns {NoTestsFinding[]} */
function documentFindings(repository, path) {
  return findTestDirectives(readText(repository, path).replace(/\r/g, ""))
    .filter(({ text }) => !BLOCKQUOTE.test(text))
    .map(({ line, text }) => ({ path, kind: /** @type {const} */ ("doc-directive"), detail: `line ${line}: ${text.trim().slice(0, 120)}` }));
}

/** Do not follow leaf or ancestor symlinks, and ignore tracked deletions.
 * @param {string} repository @param {string} path @returns {boolean}
 */
function regularFile(repository, path) {
  const parts = path.split("/");
  try {
    for (let index = 1; index <= parts.length; index++) {
      const entry = lstatSync(resolve(repository, ...parts.slice(0, index)));
      if (entry.isSymbolicLink()) return false;
      if (index === parts.length) return entry.isFile();
      if (!entry.isDirectory()) return false;
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))) return false;
    throw error;
  }
  return false;
}

/** Recognize bounded, literal native test commands, excluding echoed text and
 * excluded Gradle tasks. Dynamic command construction is outside this detector.
 * @param {string} command @returns {boolean}
 */
function nativeCommand(command) {
  return commandSegments(command).some((segment) => {
    const text = segment.trim().replace(/^if\s+/, "").replace(/^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/, "");
    if (/^#|^(?:echo|printf)\b/.test(text)) return false;
    if (/^(?:k6\s+run|swift\s+test)\b/.test(text)) return true;
    if (/^(?:bash\s+|sh\s+)?["']?[^\s;|&]*\/tests?\.sh["']?(?:\s|$)/.test(text)) return true;
    const tokens = (text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((token) => token.replace(/^["']|["']$/g, ""));
    if (!/^(?:.*\/)?gradlew?$/.test(tokens.shift() ?? "")) return false;
    const excluded = new Set();
    const requested = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.startsWith("#")) break;
      if (token === "-x" || token === "--exclude-task") { excluded.add(tokens[++index]); continue; }
      if (token.startsWith("--exclude-task=")) { excluded.add(token.slice("--exclude-task=".length)); continue; }
      if (token.startsWith("-x") && token.length > 2) { excluded.add(token.slice(2)); continue; }
      requested.push(token);
    }
    return requested.some((task) =>
      /(?:^|:)(?:test|test[A-Z]\w*UnitTest|connected\w*AndroidTest|connectedCheck|device\w*AndroidTest)$/.test(task)
      && !excluded.has(task) && !excluded.has(task.split(":").at(-1))
    );
  });
}

/** Remove comments while preserving quoted strings and newlines.
 * @param {string} text @param {string} path @returns {string}
 */
function withoutComments(text, path) {
  if (/\.(?:xcscheme|pbxproj)$/.test(path) && path.endsWith("xcscheme")) return text.replace(/<!--[^]*?-->/g, (match) => match.replace(/[^\n]/g, " "));
  const hash = /\.(?:sh|rb)$/.test(path);
  let output = "", quote = "", block = false, line = false, escape = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index], next = text[index + 1];
    if (line) { if (char === "\n") line = false; output += char === "\n" ? char : " "; continue; }
    if (block) { if (char === "*" && next === "/") { output += "  "; index++; block = false; } else output += char === "\n" ? char : " "; continue; }
    if (quote) { output += char; if (escape) escape = false; else if (char === "\\") escape = true; else if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; output += char; continue; }
    if ((hash && char === "#") || (!hash && char === "/" && next === "/")) { line = true; output += " "; continue; }
    if (!hash && char === "/" && next === "*") { block = true; output += "  "; index++; continue; }
    output += char;
  }
  return output;
}

/** @param {string} repository @param {string} path @returns {NoTestsFinding[]} */
function nativeFindings(repository, path) {
  const lines = withoutComments(readText(repository, path), path).split(/\r?\n/);
  /** @type {NoTestsFinding[]} */
  const findings = [];
  let continued = "", start = 0;
  for (const [index, line] of lines.entries()) {
    let kind = /** @type {NoTestsFinding["kind"] | null} */ (null);
    if (/\.gradle(?:\.kts)?$/.test(path)) {
      if (/\b(?:test|androidTest)(?:Implementation|RuntimeOnly|CompileOnly|Api)\b|androidx\.compose\.ui\.test\.manifest/.test(line)) kind = "test-dependency";
      else if (/\btestInstrumentationRunner\s*(?:=|["'])/.test(line)) kind = "test-config";
    } else if (path.endsWith("Package.swift") && /\.testTarget\s*\(/.test(line)) kind = "test-config";
    else if (path.endsWith(".rb") && /new_target\s*\(\s*:(?:ui_test_bundle|unit_test_bundle)|add_test_target\s*\(/.test(line)) kind = "test-config";
    else if (path.endsWith("project.pbxproj") && /productType\s*=\s*"com\.apple\.product-type\.bundle\.(?:unit-test|ui-testing)"/.test(line)) kind = "test-config";
    else if (path.endsWith(".xcscheme") && /<TestableReference\b|\.xctest\b/.test(line)) kind = "test-config";
    if (kind) findings.push({ path, kind, detail: `line ${index + 1}: ${line.trim().slice(0, 120)}` });
    if (path.endsWith(".sh")) {
      if (!continued) start = index;
      continued += line.replace(/\\\s*$/, " ");
      if (/\\\s*$/.test(line)) continue;
      if (nativeCommand(continued)) findings.push({ path, kind: "test-script", detail: `line ${start + 1}: ${continued.trim().slice(0, 120)}` });
      continued = "";
    }
  }
  return findings;
}

/** Split shell separators only outside quotes, so echoed recipes stay inert.
 * @param {string} command @returns {string[]}
 */
function commandSegments(command) {
  const segments = [];
  let segment = "", quote = "", escape = false;
  for (const char of command) {
    if (escape) { segment += char; escape = false; continue; }
    if (char === "\\" && quote !== "'") { segment += char; escape = true; continue; }
    if (quote) { segment += char; if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { segment += char; quote = char; continue; }
    if (char === ";" || char === "&" || char === "|") { segments.push(segment); segment = ""; continue; }
    segment += char;
  }
  segments.push(segment);
  return segments;
}

/** Decode YAML scalar quoting only for explicit workflow run values.
 * @param {string} line @returns {string}
 */
function workflowCommand(line) {
  const match = /^\s*-?\s*run:\s*(.*?)\s*$/.exec(line);
  if (!match) return line;
  const command = match[1];
  // Recognize the scalar boundary separately from its optional YAML comment.
  const single = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(command);
  if (single) return single[1].replace(/''/g, "'");
  const double = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(command);
  if (double) {
    try { return JSON.parse(double[1]); } catch { return double[1]; }
  }
  return command;
}
