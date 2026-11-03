// @ts-check
// QuickE2E as the standard web verification (owner decision 2026-11-02): one pinned runtime, one command, one run
// record the evidence gate can check.
//
//   development-system quicke2e install            pinned QuickE2E + a Playwright with the 2026-10-30 sandbox fix
//   development-system quicke2e status             what is installed and whether a Jev key is available
//   development-system quicke2e <discover|check|run> <args> [--repo <checkout>]
//
// `run` always adds --json --headless --trace and writes `run.json` (records, app checkout head, spec hash, exit code
// and a sha256 of the whole record) under ~/.development-system/private/evidence/quicke2e/. `evidence record --tool
// quicke2e --run <run.json>` refuses a record whose hash, head or flows do not hold. Flow files stay in private
// ~/.development-system/private/quicke2e-flows/, never in a repository, and no Playwright spec is emitted (operator decision 2026-10-13).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const QUICKE2E_VERSION = "0.5.0";
// Playwright 1.64.1 bundles Chromium 156, which fixes the 2026-10-30 Chrome sandbox escape.
export const PLAYWRIGHT_MINIMUM = "1.64.1";
const REQUIRED_HEADLESS = ["--json", "--headless"];

/** @param {string} home */
export const runtimeRoot = (home) => path.join(home, ".development-system/tools/quicke2e-runtime");
/** Run records live under the evidence root, which agents cannot write by hand; only this command writes them. @param {string} home */
export const runRoot = (home) => path.join(home, ".development-system/private/evidence/quicke2e");
/** Flow files agents write. @param {string} home */
export const flowRoot = (home) => path.join(home, ".development-system/private/quicke2e-flows");

/** @param {string} a @param {string} b */
const atLeast = (a, b) => {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
  return true;
};

/** @param {string} file */
const readVersion = (file) => { try { return String(JSON.parse(readFileSync(file, "utf8")).version); } catch { return null; } };

/** The installed 2.3.0 preload that sends QuickE2E's Jev request to TypeSafe. @param {string} home */
export const typesafePreload = (home) => path.join(home, ".codex/development-system/runtime/quicke2e/typesafe-jev.mjs");

/**
 * How QuickE2E reaches Jev: an OpenRouter key goes direct; otherwise the operator's prepaid TypeSafe key (jevgrep's
 * credentials or TYPESAFE_AI_API_KEY) through the installed preload, which reads the key itself.
 * @param {string} home @returns {{source: string, preload: string}}
 */
function jevRoute(home) {
  if (process.env.OPENROUTER_API_KEY) return { source: "OPENROUTER_API_KEY", preload: "" };
  const preload = typesafePreload(home);
  if (!existsSync(preload)) return { source: "", preload: "" };
  if (process.env.TYPESAFE_AI_API_KEY) return { source: "TYPESAFE_AI_API_KEY via the TypeSafe preload", preload };
  try {
    const credentials = JSON.parse(readFileSync(path.join(home, ".config/jevgrep/credentials.json"), "utf8"));
    if (credentials.provider === "typesafe" && typeof credentials.apiKey === "string") return { source: "jevgrep TypeSafe credentials via the TypeSafe preload", preload };
  } catch { /* no jevgrep credentials */ }
  return { source: "", preload: "" };
}

/** @param {string} home */
export function quicke2eStatus(home) {
  const root = runtimeRoot(home);
  const quicke2e = readVersion(path.join(root, "node_modules/quicke2e/package.json"));
  const playwright = readVersion(path.join(root, "node_modules/playwright/package.json"));
  const route = jevRoute(home);
  /** @type {string[]} */
  const problems = [];
  if (quicke2e !== QUICKE2E_VERSION) problems.push(`QuickE2E ${quicke2e ?? "missing"}, expected ${QUICKE2E_VERSION}: run development-system quicke2e install`);
  if (!playwright || !atLeast(playwright, PLAYWRIGHT_MINIMUM)) problems.push(`Playwright ${playwright ?? "missing"} is below ${PLAYWRIGHT_MINIMUM} (Chrome sandbox fix): run development-system quicke2e install`);
  if (!route.source) problems.push(`no Jev access: jevgrep TypeSafe credentials with the installed preload (${typesafePreload(home)}), TYPESAFE_AI_API_KEY, or OPENROUTER_API_KEY (or use --engine local)`);
  return { ok: problems.length === 0, operation: "quicke2e-status", runtime: root, quicke2e, playwright, keySource: route.source || null, problems };
}

/** @param {string} home */
export function installQuicke2e(home) {
  const root = runtimeRoot(home);
  mkdirSync(root, { recursive: true });
  if (!existsSync(path.join(root, "package.json"))) writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "ds-quicke2e-runtime", private: true }, null, 2)}\n`);
  execFileSync("npm", ["install", "--prefix", root, "--no-audit", "--no-fund", "--save-exact", `quicke2e@${QUICKE2E_VERSION}`, `playwright@^${PLAYWRIGHT_MINIMUM}`], { stdio: "inherit" });
  execFileSync(process.execPath, [path.join(root, "node_modules/playwright/cli.js"), "install", "chromium"], { stdio: "inherit" });
  return { ...quicke2eStatus(home), operation: "quicke2e-install" };
}

/** @param {unknown} body */
export const runDigest = (body) => createHash("sha256").update(JSON.stringify(body)).digest("hex");

/** @param {string} dir @returns {string} */
function gitTop(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

/**
 * Runs QuickE2E from the pinned runtime. `run` writes a hashed run record.
 * @param {{home?: string, args: string[], now?: Date}} options
 */
export function runQuicke2e({ home = homedir(), args, now = new Date() }) {
  const [command, ...rest] = args;
  if (!["discover", "check", "run"].includes(command)) throw new Error("quicke2e takes install, status, or discover|check|run <args> [--repo <checkout>]");
  const status = quicke2eStatus(home);
  if (status.quicke2e !== QUICKE2E_VERSION || status.problems.some((problem) => problem.startsWith("Playwright"))) throw new Error(status.problems.join("; "));
  const repoIndex = rest.indexOf("--repo");
  const repo = path.resolve(repoIndex >= 0 ? rest[repoIndex + 1] ?? "" : process.cwd());
  const passthrough = repoIndex >= 0 ? [...rest.slice(0, repoIndex), ...rest.slice(repoIndex + 2)] : rest;
  if (passthrough.some((arg) => arg === "--emit" || arg.startsWith("--emit="))) throw new Error("--emit writes a Playwright spec; no emitted spec is kept (operator decision 2026-10-13)");
  const spec = command === "discover" ? "" : path.resolve(passthrough.find((arg) => !arg.startsWith("-")) ?? "");
  if (spec) {
    if (!existsSync(spec)) throw new Error(`flow file not found: ${spec}`);
    // ~/.development-system is itself a checkout; any other repository (a product repo) is refused.
    const specTop = gitTop(path.dirname(spec));
    if (specTop && specTop !== gitTop(path.join(home, ".development-system"))) throw new Error(`flow file ${spec} is inside a git repository; keep it under ${flowRoot(home)}/<repo>/ (operator decision 2026-10-13)`);
  }
  const top = gitTop(repo);
  const head = top ? execFileSync("git", ["-C", top, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const directory = path.join(runRoot(home), path.basename(top || repo), stamp);
  const extra = command === "run" ? [...REQUIRED_HEADLESS.filter((flag) => !passthrough.includes(flag)), "--trace", path.join(directory, "trace")] : [];
  if (command === "run") mkdirSync(directory, { recursive: true, mode: 0o700 });
  const route = jevRoute(home);
  const bin = path.join(runtimeRoot(home), "node_modules/quicke2e/bin/quicke2e.mjs");
  const started = Date.now();
  const child = spawnSync(process.execPath, [...(route.preload ? ["--import", route.preload] : []), bin, command, ...passthrough, ...extra], {
    cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
    // QuickE2E refuses to start without OPENROUTER_API_KEY; the preload replaces it with the TypeSafe key.
    env: { ...process.env, ...(route.preload ? { OPENROUTER_API_KEY: "via-typesafe" } : {}) },
  });
  const stdout = String(child.stdout ?? "");
  const exitCode = child.status ?? 1;
  if (command !== "run") return { result: { ok: exitCode === 0, operation: `quicke2e-${command}`, exitCode }, output: stdout.trimEnd() };
  /** @type {any[]} */
  let records = [];
  try { records = JSON.parse(stdout.trimEnd().split("\n").at(-1) ?? "[]"); } catch { records = []; }
  const body = {
    quicke2e: QUICKE2E_VERSION, playwright: status.playwright, repo: top || repo, head, spec, specSha256: createHash("sha256").update(readFileSync(spec)).digest("hex"),
    command: [command, ...passthrough, ...extra], exitCode, startedAt: now.toISOString(), wallMs: Date.now() - started,
    records: Array.isArray(records) ? records : [],
  };
  const run = { ...body, runSha256: runDigest(body) };
  const file = path.join(directory, "run.json");
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(path.join(directory, "stdout.txt"), stdout, { mode: 0o600 });
  const passed = run.records.filter((record) => record.passed === true).length;
  return {
    result: { ok: exitCode === 0 && passed > 0 && passed === run.records.length, operation: "quicke2e-run", run: file, head, exitCode, passed, total: run.records.length },
    output: `${stdout.trimEnd().split("\n").slice(0, -1).join("\n")}\nQuickE2E run record: ${file} (${passed}/${run.records.length} passed, exit ${exitCode}${head ? `, checkout ${head.slice(0, 12)}` : ""}). Record it with: development-system evidence record --tool quicke2e --run ${file} ...`,
  };
}

/**
 * Checks a QuickE2E run record for an evidence receipt. Problems ending in "missing" make the receipt incomplete;
 * any other problem makes it failed.
 * @param {string | undefined} file @param {string} verifiedSha
 */
export function verifyRunRecord(file, verifiedSha) {
  if (!file) return { problems: ["QuickE2E run record missing"], summary: null };
  /** @type {any} */
  let run;
  try { run = JSON.parse(readFileSync(path.resolve(file), "utf8")); } catch { return { problems: [`QuickE2E run record ${file} unreadable`], summary: null }; }
  const { runSha256, ...body } = run;
  /** @type {string[]} */
  const problems = [];
  if (runSha256 !== runDigest(body)) problems.push("QuickE2E run record was edited after the run (hash mismatch)");
  if (!Array.isArray(body.records) || body.records.length === 0) problems.push("QuickE2E run record has no flows");
  if (body.head !== verifiedSha) problems.push(`QuickE2E ran against checkout ${String(body.head || "unknown").slice(0, 12)}, not the verified head ${verifiedSha.slice(0, 12)}`);
  const records = Array.isArray(body.records) ? body.records : [];
  for (const record of records) if (record.passed !== true) problems.push(`QuickE2E flow ${record.flow} ${record.outcome ?? "failed"}`);
  return { problems, summary: { run: path.resolve(file), runSha256, flows: records.map((/** @type {any} */ record) => `${record.flow}:${record.passed === true ? "pass" : record.outcome ?? "fail"}`) } };
}

/** CLI entry. @param {string[]} args @param {string} [home] */
export function runQuicke2eCommand(args, home = homedir()) {
  if (args[0] === "install") { const result = installQuicke2e(home); return { result, output: `QuickE2E ${result.quicke2e}, Playwright ${result.playwright} in ${result.runtime}${result.problems.length ? `\n${result.problems.join("\n")}` : ""}` }; }
  if (args[0] === "status") { const result = quicke2eStatus(home); return { result, output: `QuickE2E ${result.quicke2e ?? "missing"}, Playwright ${result.playwright ?? "missing"}, Jev key ${result.keySource ?? "missing"}${result.problems.length ? `\n${result.problems.join("\n")}` : ""}` }; }
  return runQuicke2e({ home, args });
}
