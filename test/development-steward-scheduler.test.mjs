import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  auditDevelopmentStewardScheduler,
  buildDevelopmentStewardLaunchAgent,
  developmentStewardLaunchAgentLabel,
  disableDevelopmentStewardScheduler,
  getDevelopmentStewardSchedulerPaths,
  installDevelopmentStewardScheduler,
} from "../src/development-steward-scheduler.mjs";
import { runDevelopmentSteward } from "../artifacts/1.5.1/skills/internal/development-steward/scripts/runner.mjs";

const stewardContractPath = resolve(import.meta.dirname, "../src/development-steward.mjs");
const checkInContractPath = resolve(import.meta.dirname, "../src/check-in.mjs");

function collectedEvidence() {
  return {
    observedAt: "2026-08-14T15:00:00.000Z",
    repositories: ["aohys", "casa-roca", "the-barber-central", "nutri-plan", "eteria"].map((id) => ({
      id,
      revision: "a".repeat(40),
      evaluations: id === "aohys" ? [{
        id: "release-train",
        area: "release-train",
        state: "action-needed",
        summary: "Deduplicate one proven check.",
        deterministic: true,
        safeUpdate: true,
        focusedChecks: ["pnpm test"],
        device: "computer",
      }] : [],
      upstream: [],
    })),
  };
}

async function fixture() {
  const home = await mkdtemp(resolve(tmpdir(), "development-steward-home-"));
  const projectsRoot = await mkdtemp(resolve(tmpdir(), "development-steward-projects-"));
  const bin = resolve(home, "fixture-bin");
  await mkdir(bin, { mode: 0o700 });
  const codexPath = resolve(bin, "codex");
  const nodePath = resolve(bin, "node");
  await Promise.all([writeFile(codexPath, "fixture"), writeFile(nodePath, "fixture")]);
  await Promise.all([chmod(codexPath, 0o700), chmod(nodePath, 0o700)]);
  /** @type {string[][]} */
  const calls = [];
  const launchctl = async (args) => {
    calls.push(args);
    if (args[0] === "print") return { status: 0, stdout: "loaded", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { home, projectsRoot, codexPath, nodePath, calls, launchctl };
}

test("LaunchAgent uses an explicit weekly argv contract without a shell", () => {
  const plist = buildDevelopmentStewardLaunchAgent({
    nodePath: "/usr/local/bin/node",
    codexPath: "/usr/local/bin/codex",
    runnerPath: "/Users/test/.development-system/steward/runner.mjs",
    promptPath: "/Users/test/.development-system/steward/prompt.md",
    stewardContractPath: "/Users/test/.development-system/steward/development-steward.mjs",
    checkInContractPath: "/Users/test/.development-system/steward/check-in.mjs",
    reportPath: "/Users/test/.development-system/steward/reports/latest.json",
    workingDirectory: "/Users/test/Documents/AO",
    stdoutPath: "/Users/test/.development-system/steward/runner.stdout.log",
    stderrPath: "/Users/test/.development-system/steward/runner.stderr.log",
  });
  assert.match(plist, new RegExp(`<string>${developmentStewardLaunchAgentLabel}</string>`));
  assert.match(plist, /<key>Weekday<\/key><integer>2<\/integer>/);
  assert.match(plist, /<key>Hour<\/key><integer>9<\/integer>/);
  assert.match(plist, /<key>ProgramArguments<\/key>/);
  assert.doesNotMatch(plist, /\/bin\/(?:ba|z|c)?sh|command string/i);
});

test("install writes private atomic artifacts and bootstraps only the explicit plist", async () => {
  const setup = await fixture();
  const installed = await installDevelopmentStewardScheduler({ ...setup, uid: 501 });
  assert.equal(installed.status, "installed");
  assert.deepEqual(setup.calls, [["bootstrap", "gui/501", installed.paths.launchAgent]]);
  for (const path of [installed.paths.runner, installed.paths.prompt, installed.paths.stewardContract, installed.paths.checkInContract, installed.paths.state, installed.paths.launchAgent]) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  assert.equal((await stat(installed.paths.privateDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(installed.paths.reports)).mode & 0o777, 0o700);
  const [plist, state, prompt] = await Promise.all([
    readFile(installed.paths.launchAgent, "utf8"),
    readFile(installed.paths.state, "utf8").then(JSON.parse),
    readFile(installed.paths.prompt, "utf8"),
  ]);
  assert.match(plist, new RegExp(`<string>${state.configuration.nodePath}</string>`));
  assert.match(plist, new RegExp(`<string>${state.configuration.codexPath}</string>`));
  assert.equal((await stat(installed.paths.stdout)).mode & 0o777, 0o600);
  assert.equal((await stat(installed.paths.stderr)).mode & 0o777, 0o600);
  assert.equal(state.authorization.merge, false);
  assert.equal(state.authorization.release, false);
  assert.equal(state.authorization.production, false);
  assert.match(prompt, /do not.*merge.*release.*deploy/is);
});

test("audit reports runtime health and detects byte drift", async () => {
  const setup = await fixture();
  const installed = await installDevelopmentStewardScheduler({ ...setup, uid: 502 });
  setup.calls.length = 0;
  const healthy = await auditDevelopmentStewardScheduler({ home: setup.home, uid: 502, launchctl: setup.launchctl });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.loaded, true);
  assert.deepEqual(setup.calls, [["print", `gui/502/${developmentStewardLaunchAgentLabel}`]]);

  await writeFile(installed.paths.prompt, "drifted prompt", { mode: 0o600 });
  const drifted = await auditDevelopmentStewardScheduler({ home: setup.home, uid: 502, launchctl: setup.launchctl });
  assert.equal(drifted.status, "drifted");
  assert.ok(drifted.problems.includes("prompt bytes drifted"));
});

test("a failed launchctl bootstrap rolls back every managed scheduler file", async () => {
  const setup = await fixture();
  const paths = getDevelopmentStewardSchedulerPaths({ home: setup.home });
  await assert.rejects(installDevelopmentStewardScheduler({
    ...setup,
    uid: 504,
    launchctl: async (args) => {
      setup.calls.push(args);
      return { status: 5, stdout: "", stderr: "fixture bootstrap failure" };
    },
  }), /bootstrap failure/);
  for (const path of [paths.runner, paths.prompt, paths.stewardContract, paths.checkInContract, paths.state, paths.launchAgent, paths.stdout, paths.stderr]) {
    await assert.rejects(readFile(path), /ENOENT/);
  }
});

test("audit fails closed when managed-looking files exist without state", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "development-steward-orphan-"));
  const paths = getDevelopmentStewardSchedulerPaths({ home });
  await mkdir(resolve(home, "Library/LaunchAgents"), { recursive: true });
  await writeFile(paths.launchAgent, "unmanaged");
  const audit = await auditDevelopmentStewardScheduler({ home });
  assert.equal(audit.status, "drifted");
  assert.match(audit.problems.join("\n"), /state is missing.*launchAgent/i);
});

test("disable unloads managed launchd state, preserves reports, and is idempotent", async () => {
  const setup = await fixture();
  const installed = await installDevelopmentStewardScheduler({ ...setup, uid: 503 });
  await writeFile(installed.paths.report, "private report", { mode: 0o600 });
  setup.calls.length = 0;
  const disabled = await disableDevelopmentStewardScheduler({ home: setup.home, uid: 503, launchctl: setup.launchctl });
  assert.equal(disabled.status, "disabled");
  assert.equal(await readFile(installed.paths.report, "utf8"), "private report");
  assert.deepEqual(setup.calls, [
    ["print", `gui/503/${developmentStewardLaunchAgentLabel}`],
    ["bootout", `gui/503/${developmentStewardLaunchAgentLabel}`],
  ]);
  const second = await disableDevelopmentStewardScheduler({ home: setup.home, uid: 503, launchctl: setup.launchctl });
  assert.equal(second.alreadyDisabled, true);
});

test("runner injects codex without a shell, enforces read-only, and atomically replaces the report", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "development-steward-runner-"));
  const promptPath = resolve(home, "prompt.md");
  const reportPath = resolve(home, "reports/latest.json");
  await writeFile(promptPath, "Review only. Do not mutate anything.");
  await mkdir(resolve(home, "reports"));
  await writeFile(reportPath, "previous report", { mode: 0o600 });
  let invocation;
  const result = await runDevelopmentSteward({
    codexPath: "/fixture/codex",
    nodePath: "/fixture/node",
    promptPath,
    reportPath,
    workingDirectory: home,
    stewardContractPath,
    checkInContractPath,
    runCodex: async (received) => {
      invocation = received;
      await writeFile(received.outputPath, JSON.stringify(collectedEvidence()));
      return { status: 0, stderr: "" };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(invocation.command, "/fixture/node");
  assert.equal(invocation.args[0], "/fixture/codex");
  assert.deepEqual(invocation.args.slice(1, 9), ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", "--cd"]);
  assert.equal(invocation.args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.operation, "development-steward-weekly-report");
  assert.equal(report.steward.valid, true);
  assert.equal(report.checkIn.valid, true);
  assert.equal(report.checkIn.actions.length, 1);
  assert.match(report.markdown, /Deduplicate one proven check/);
  assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
  assert.equal((await stat(resolve(home, "reports"))).mode & 0o777, 0o700);
});

test("failed runner preserves the last complete report", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "development-steward-runner-failure-"));
  const promptPath = resolve(home, "prompt.md");
  const reportPath = resolve(home, "reports/latest.json");
  await writeFile(promptPath, "Review only.");
  await mkdir(resolve(home, "reports"));
  await writeFile(reportPath, "last good report", { mode: 0o600 });
  await assert.rejects(runDevelopmentSteward({
    codexPath: "/fixture/codex",
    nodePath: "/fixture/node",
    promptPath,
    reportPath,
    workingDirectory: home,
    stewardContractPath,
    checkInContractPath,
    runCodex: async () => ({ status: 7, stderr: "fixture failure" }),
  }), /status 7/);
  assert.equal(await readFile(reportPath, "utf8"), "last good report");
});

test("runner rejects unvalidated prose and preserves the last complete structured report", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "development-steward-runner-invalid-"));
  const promptPath = resolve(home, "prompt.md");
  const reportPath = resolve(home, "reports/latest.json");
  await writeFile(promptPath, "Review only.");
  await mkdir(resolve(home, "reports"));
  await writeFile(reportPath, "last validated report", { mode: 0o600 });
  await assert.rejects(runDevelopmentSteward({
    codexPath: "/fixture/codex",
    nodePath: "/fixture/node",
    promptPath,
    reportPath,
    workingDirectory: home,
    stewardContractPath,
    checkInContractPath,
    runCodex: async (received) => {
      await writeFile(received.outputPath, "arbitrary Markdown");
      return { status: 0, stderr: "" };
    },
  }), /required raw JSON evidence/);
  assert.equal(await readFile(reportPath, "utf8"), "last validated report");
});

test("all managed paths resolve inside the supplied HOME", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "development-steward-paths-"));
  const paths = getDevelopmentStewardSchedulerPaths({ home });
  for (const [key, path] of Object.entries(paths)) {
    if (key !== "home") assert.ok(path.startsWith(`${home}/`));
  }
});

test("the CLI exposes scheduler audit without mutating a disabled HOME", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "development-steward-cli-"));
  const cli = spawnSync(process.execPath, [
    resolve(import.meta.dirname, "../bin/development-system.mjs"),
    "development-steward-schedule-audit",
    "--home",
    home,
    "--json",
  ], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.operation, "development-steward-scheduler");
  assert.equal(result.status, "disabled");
  assert.equal(result.valid, true);
});
