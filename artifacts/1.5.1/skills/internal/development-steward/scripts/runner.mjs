#!/usr/bin/env node
// @ts-check

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** @param {unknown} error */
function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} path */
async function removeIfPresent(path) {
  try { await unlink(path); }
  catch (error) { if (!missing(error)) throw error; }
}

/**
 * @param {{command: string, args: string[], cwd: string, outputPath: string}} invocation
 * @returns {Promise<{status: number, stderr: string}>}
 */
function spawnCodex(invocation) {
  return new Promise((fulfill, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => fulfill({ status: status ?? 1, stderr }));
  });
}

/**
 * Execute Codex without a shell and publish only a complete final report.
 * @param {{nodePath: string, codexPath: string, promptPath: string, reportPath: string, workingDirectory: string, stewardContractPath: string, checkInContractPath: string, runCodex?: typeof spawnCodex}} options
 */
export async function runDevelopmentSteward(options) {
  for (const [name, value] of Object.entries(options)) {
    if (name !== "runCodex" && (typeof value !== "string" || !isAbsolute(value))) {
      throw new Error(`${name} must be an absolute path`);
    }
  }
  const codexPath = resolve(options.codexPath);
  const nodePath = resolve(options.nodePath);
  const promptPath = resolve(options.promptPath);
  const reportPath = resolve(options.reportPath);
  const workingDirectory = resolve(options.workingDirectory);
  const stewardContractPath = resolve(options.stewardContractPath);
  const checkInContractPath = resolve(options.checkInContractPath);
  const prompt = (await readFile(promptPath, "utf8")).trim();
  if (!prompt) throw new Error("Development Steward prompt must not be empty");

  const reportDirectory = dirname(reportPath);
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  await chmod(reportDirectory, 0o700);
  const rawOutput = `${reportPath}.${randomUUID()}.raw.tmp`;
  const temporaryReport = `${reportPath}.${randomUUID()}.tmp`;
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--color", "never",
    "--cd", workingDirectory,
    "--output-last-message", rawOutput,
    prompt,
  ];
  const runCodex = options.runCodex ?? spawnCodex;
  try {
    const result = await runCodex({ command: nodePath, args: [codexPath, ...args], cwd: workingDirectory, outputPath: rawOutput });
    if (result.status !== 0) throw new Error(`codex exec failed with status ${result.status}: ${result.stderr.trim()}`);
    const raw = await readFile(rawOutput, "utf8");
    let collected;
    try { collected = JSON.parse(raw); }
    catch { throw new Error("codex exec did not produce the required raw JSON evidence"); }
    const [{ buildDevelopmentStewardReview }, { buildCheckIn }] = await Promise.all([
      import(pathToFileURL(stewardContractPath).href),
      import(pathToFileURL(checkInContractPath).href),
    ]);
    const steward = buildDevelopmentStewardReview(collected);
    if (!steward.valid) throw new Error(`Development Steward evidence failed validation: ${steward.errors.join("; ")}`);
    const checkIn = buildCheckIn({
      request: "Ya llegué",
      now: steward.observedAt,
      scope: { kind: "global" },
      evidence: steward.checkInEvidence,
      maxActions: 5,
    });
    if (!checkIn.valid) throw new Error(`Check-in evidence failed validation: ${checkIn.errors.join("; ")}`);
    const markdown = [
      "# Development Steward weekly review",
      "",
      steward.report.summary,
      "",
      ...steward.report.items.flatMap((item) => [`- **${item.title}** — ${item.detail}`, ""]),
      `Check-in: ${checkIn.summary}`,
      "",
    ].join("\n");
    const completeReport = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
    contractVersion: "1.5.1",
      operation: "development-steward-weekly-report",
      observedAt: steward.observedAt,
      steward,
      checkIn,
      markdown,
    }, null, 2)}\n`);
    await writeFile(temporaryReport, completeReport, { mode: 0o600 });
    await chmod(temporaryReport, 0o600);
    await rename(temporaryReport, reportPath);
    await chmod(reportPath, 0o600);
    await removeIfPresent(rawOutput);
    return { status: "completed", reportPath, itemCount: steward.report.items.length };
  } catch (error) {
    await removeIfPresent(rawOutput);
    await removeIfPresent(temporaryReport);
    throw error;
  }
}

/** @param {string[]} argv */
function parseArguments(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid runner argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const values = parseArguments(process.argv.slice(2));
  await runDevelopmentSteward({
    codexPath: values.codex,
    nodePath: values.node,
    promptPath: values.prompt,
    reportPath: values.report,
    workingDirectory: values["working-directory"],
    stewardContractPath: values["steward-contract"],
    checkInContractPath: values["check-in-contract"],
  });
}
