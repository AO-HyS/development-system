// @ts-check
// QuickE2E as the standard web verification (owner decision 2026-11-02): one pinned runtime, one command, one run
// record the evidence gate can check.
//
//   development-system quicke2e install            pinned QuickE2E + a Playwright with the 2026-10-30 sandbox fix
//   development-system quicke2e status             what is installed and whether a Jev key is available
//   development-system quicke2e discover <args> | <check|run> <flows.json> <args> [--repo <checkout>]
//
// `run` always adds --json --headless --trace and writes `run.json` (records, app checkout head, spec hash, exit code
// and a sha256 of the whole record) under ~/.development-system/private/evidence/quicke2e/. `evidence record --tool
// quicke2e --run <run.json>` refuses a record whose hash, head or flows do not hold. Flow files are declarative JSON
// (see quicke2e-flows.mjs: no agent code runs in the process that reports results) and stay in private
// ~/.development-system/private/quicke2e-flows/, never in a repository, and no Playwright spec is emitted (operator decision 2026-10-13).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { packageDigest, prepareFlows, QUICKE2E_PACKAGE_SHA256 } from "./quicke2e-flows.mjs";

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
/** sha256 of that preload in manifests/2.3.0.json; it runs before QuickE2E, so any other content is refused. */
export const TYPESAFE_PRELOAD_SHA256 = "67fadae53a7755f7387382a1580a0548189d4d053042b1af454803469082f254";
/** @param {string} file */
const preloadIntact = (file) => { try { return createHash("sha256").update(readFileSync(file)).digest("hex") === TYPESAFE_PRELOAD_SHA256; } catch { return false; } };

/**
 * How QuickE2E reaches Jev: an OpenRouter key goes direct; otherwise the operator's prepaid TypeSafe key (jevgrep's
 * credentials or TYPESAFE_AI_API_KEY) through the installed preload, which reads the key itself.
 * @param {string} home @returns {{source: string, preload: string, problem?: string}}
 */
function jevRoute(home) {
  if (process.env.OPENROUTER_API_KEY) return { source: "OPENROUTER_API_KEY", preload: "" };
  const preload = typesafePreload(home);
  if (!existsSync(preload)) return { source: "", preload: "" };
  if (!preloadIntact(preload)) return { source: "", preload: "", problem: `the TypeSafe preload ${preload} differs from the 2.3.0 manifest; reinstall Development System` };
  if (process.env.TYPESAFE_AI_API_KEY) return { source: "TYPESAFE_AI_API_KEY via the TypeSafe preload", preload };
  try {
    const credentials = JSON.parse(readFileSync(path.join(home, ".config/jevgrep/credentials.json"), "utf8"));
    if (credentials.provider === "typesafe" && typeof credentials.apiKey === "string") return { source: "jevgrep TypeSafe credentials via the TypeSafe preload", preload };
  } catch { /* no jevgrep credentials */ }
  return { source: "", preload: "" };
}

/** Chromium lives with the pinned runtime, so an isolated HOME and the operator HOME use the browser that runtime installed. @param {string} home */
export const browsersRoot = (home) => path.join(runtimeRoot(home), "browsers");

/** Child environment: the selected HOME (the TypeSafe preload reads credentials from it) and the runtime browsers; NODE_OPTIONS and NODE_PATH would load caller-chosen code into QuickE2E, so they are dropped. @param {string} home */
const childEnv = (home) => {
  const { NODE_OPTIONS: _options, NODE_PATH: _path, ...env } = process.env;
  return { ...env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: browsersRoot(home) };
};

/** @param {string} home */
export function quicke2eStatus(home) {
  const root = runtimeRoot(home);
  const quicke2e = readVersion(path.join(root, "node_modules/quicke2e/package.json"));
  const playwright = readVersion(path.join(root, "node_modules/playwright/package.json"));
  const route = jevRoute(home);
  /** @type {string[]} */
  const problems = [];
  if (quicke2e !== QUICKE2E_VERSION) problems.push(`QuickE2E ${quicke2e ?? "missing"}, expected ${QUICKE2E_VERSION}: run development-system quicke2e install`);
  if (quicke2e === QUICKE2E_VERSION && packageDigest(path.join(root, "node_modules/quicke2e")) !== QUICKE2E_PACKAGE_SHA256) problems.push(`QuickE2E package files differ from the published ${QUICKE2E_VERSION}: run development-system quicke2e install after removing ${path.join(root, "node_modules/quicke2e")}`);
  if (!playwright || !atLeast(playwright, PLAYWRIGHT_MINIMUM)) problems.push(`Playwright ${playwright ?? "missing"} is below ${PLAYWRIGHT_MINIMUM} (Chrome sandbox fix): run development-system quicke2e install`);
  if (!existsSync(browsersRoot(home)) || readdirSync(browsersRoot(home)).length === 0) problems.push(`no Chromium in ${browsersRoot(home)}: run development-system quicke2e install`);
  if (route.problem) problems.push(route.problem);
  else if (!route.source) problems.push(`no Jev access: jevgrep TypeSafe credentials with the installed preload (${typesafePreload(home)}), TYPESAFE_AI_API_KEY, or OPENROUTER_API_KEY (or use --engine local)`);
  return { ok: problems.length === 0, operation: "quicke2e-status", runtime: root, quicke2e, playwright, keySource: route.source || null, problems };
}

/** @param {string} home */
export function installQuicke2e(home) {
  const root = runtimeRoot(home);
  mkdirSync(root, { recursive: true });
  if (!existsSync(path.join(root, "package.json"))) writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "ds-quicke2e-runtime", private: true }, null, 2)}\n`);
  execFileSync("npm", ["install", "--prefix", root, "--no-audit", "--no-fund", "--save-exact", `quicke2e@${QUICKE2E_VERSION}`, `playwright@^${PLAYWRIGHT_MINIMUM}`], { stdio: "inherit", env: childEnv(home) });
  execFileSync(process.execPath, [path.join(root, "node_modules/playwright/cli.js"), "install", "chromium"], { stdio: "inherit", env: childEnv(home) });
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
  if (status.quicke2e !== QUICKE2E_VERSION || status.problems.some((problem) => problem.startsWith("Playwright") || problem.startsWith("no Chromium") || problem.startsWith("QuickE2E package") || problem.startsWith("the TypeSafe preload"))) throw new Error(status.problems.join("; "));
  const repoIndex = rest.indexOf("--repo");
  const repo = path.resolve(repoIndex >= 0 ? rest[repoIndex + 1] ?? "" : process.cwd());
  const passthrough = repoIndex >= 0 ? [...rest.slice(0, repoIndex), ...rest.slice(repoIndex + 2)] : rest;
  if (passthrough.some((arg) => arg === "--emit" || arg.startsWith("--emit="))) throw new Error("--emit writes a Playwright spec; no emitted spec is kept (operator decision 2026-10-13)");
  // The flow file is the first argument after the command. It is resolved to its physical path once, checked there,
  // and that exact absolute path is what QuickE2E receives, so the checked, hashed and executed file are the same.
  let spec = "";
  if (command !== "discover") {
    const given = passthrough[0];
    if (!given || given.startsWith("-")) throw new Error(`quicke2e ${command} takes <flows.json> as its first argument`);
    if (!existsSync(given)) throw new Error(`flow file not found: ${path.resolve(given)}`);
    spec = realpathSync(given);
    // ~/.development-system is itself a checkout; any other repository (a product repo) is refused.
    const specTop = gitTop(path.dirname(spec));
    if (specTop && specTop !== gitTop(path.join(home, ".development-system"))) throw new Error(`flow file ${spec} is inside a git repository; keep it under ${flowRoot(home)}/<repo>/ (operator decision 2026-10-13)`);
  }
  const top = gitTop(repo);
  const head = top ? execFileSync("git", ["-C", top, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const directory = path.join(runRoot(home), path.basename(top || repo), stamp);
  const extra = command === "run" ? [...REQUIRED_HEADLESS.filter((flag) => !passthrough.includes(flag)), "--trace", path.join(directory, "trace")] : [];
  let specSha256 = "";
  if (spec) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const prepared = prepareFlows(spec, directory);
    passthrough[0] = prepared.module;
    specSha256 = prepared.specSha256;
  }
  const route = jevRoute(home);
  const bin = path.join(runtimeRoot(home), "node_modules/quicke2e/bin/quicke2e.mjs");
  const started = Date.now();
  const child = spawnSync(process.execPath, [...(route.preload ? ["--import", route.preload] : []), bin, command, ...passthrough, ...extra], {
    cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
    // QuickE2E refuses to start without OPENROUTER_API_KEY; the preload replaces it with the TypeSafe key.
    env: { ...childEnv(home), ...(route.preload ? { OPENROUTER_API_KEY: "via-typesafe" } : {}) },
  });
  const stdout = String(child.stdout ?? "");
  const exitCode = child.status ?? 1;
  if (command !== "run") return { result: { ok: exitCode === 0, operation: `quicke2e-${command}`, exitCode }, output: stdout.trimEnd() };
  /** @type {any[]} */
  let records = [];
  try { records = JSON.parse(stdout.trimEnd().split("\n").at(-1) ?? "[]"); } catch { records = []; }
  const body = {
    quicke2e: QUICKE2E_VERSION, playwright: status.playwright, repo: top || repo, head, spec, specSha256, packageSha256: QUICKE2E_PACKAGE_SHA256, preloadSha256: route.preload ? TYPESAFE_PRELOAD_SHA256 : null,
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

/** @param {string} url */
const originOf = (url) => { try { return new URL(url).origin; } catch { return ""; } };

/**
 * Checks a QuickE2E run record for an evidence receipt. Problems ending in "missing" make the receipt incomplete;
 * any other problem makes it failed.
 *
 * The record must be a regular file this command wrote under the run root, which the guard keeps agents from
 * writing by hand; a record anywhere else, or reached through a link, is refused. The hash catches a record edited
 * after the run; it does not authenticate one written in place, which is what the location rule is for.
 * @param {string | undefined} file @param {{home: string, verifiedSha: string, environment: string}} expected
 */
export function verifyRunRecord(file, { home, verifiedSha, environment }) {
  if (!file) return { problems: ["QuickE2E run record missing"], summary: null };
  const absolute = path.resolve(file);
  let real;
  try {
    if (!lstatSync(absolute).isFile()) return { problems: [`QuickE2E run record ${file} is not a regular file`], summary: null };
    real = realpathSync(absolute);
  } catch { return { problems: [`QuickE2E run record ${file} unreadable`], summary: null }; }
  const root = existsSync(runRoot(home)) ? realpathSync(runRoot(home)) : runRoot(home);
  if (!real.startsWith(`${root}${path.sep}`) || path.basename(real) !== "run.json") {
    return { problems: [`QuickE2E run record ${file} is not a run.json written by quicke2e run under ${runRoot(home)}`], summary: null };
  }
  /** @type {any} */
  let run;
  try { run = JSON.parse(readFileSync(real, "utf8")); } catch { return { problems: [`QuickE2E run record ${file} unreadable`], summary: null }; }
  const { runSha256, ...body } = run;
  /** @type {string[]} */
  const problems = [];
  if (runSha256 !== runDigest(body)) problems.push("QuickE2E run record was edited after the run (hash mismatch)");
  if (body.quicke2e !== QUICKE2E_VERSION || body.packageSha256 !== QUICKE2E_PACKAGE_SHA256 || !Array.isArray(body.command) || body.command[0] !== "run" || !String(body.command[1] ?? "").endsWith("flows.generated.mjs")) problems.push("QuickE2E run record was not produced by quicke2e run from declarative flows");
  if (!("preloadSha256" in body) || (body.preloadSha256 !== null && body.preloadSha256 !== TYPESAFE_PRELOAD_SHA256)) problems.push("QuickE2E run record does not show the pinned TypeSafe preload");
  if (body.exitCode !== 0) problems.push(`QuickE2E exited with ${String(body.exitCode)}`);
  if (!Array.isArray(body.records) || body.records.length === 0) problems.push("QuickE2E run record has no flows");
  if (body.head !== verifiedSha) problems.push(`QuickE2E ran against checkout ${String(body.head || "unknown").slice(0, 12)}, not the verified head ${verifiedSha.slice(0, 12)}`);
  const records = Array.isArray(body.records) ? body.records : [];
  const wanted = originOf(environment);
  for (const record of records) {
    if (record.passed !== true) problems.push(`QuickE2E flow ${record.flow} ${record.outcome ?? "failed"}`);
    if (!wanted || originOf(String(record.base ?? "")) !== wanted) problems.push(`QuickE2E flow ${record.flow} ran against ${String(record.base ?? "unknown")}, not the receipt environment ${environment}`);
  }
  return { problems, summary: { run: real, runSha256, flows: records.map((/** @type {any} */ record) => `${record.flow}:${record.passed === true ? "pass" : record.outcome ?? "fail"}`) } };
}

/** CLI entry; `--home <dir>` (before the QuickE2E arguments) selects another HOME. @param {string[]} rawArgs */
export function runQuicke2eCommand(rawArgs) {
  const homeAt = rawArgs.indexOf("--home");
  if (homeAt >= 0 && !rawArgs[homeAt + 1]) throw new Error("--home needs a value");
  const home = homeAt >= 0 ? path.resolve(rawArgs[homeAt + 1]) : homedir();
  const args = homeAt >= 0 ? [...rawArgs.slice(0, homeAt), ...rawArgs.slice(homeAt + 2)] : rawArgs;
  if (args[0] === "install") { const result = installQuicke2e(home); return { result, output: `QuickE2E ${result.quicke2e}, Playwright ${result.playwright} in ${result.runtime}${result.problems.length ? `\n${result.problems.join("\n")}` : ""}` }; }
  if (args[0] === "status") { const result = quicke2eStatus(home); return { result, output: `QuickE2E ${result.quicke2e ?? "missing"}, Playwright ${result.playwright ?? "missing"}, Jev key ${result.keySource ?? "missing"}${result.problems.length ? `\n${result.problems.join("\n")}` : ""}` }; }
  return runQuicke2e({ home, args });
}
