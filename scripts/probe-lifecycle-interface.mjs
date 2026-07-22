// @ts-check

import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hasBehaviorSignature } from "../src/skills.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codexPath = process.env.AOHYS_CODEX_PATH ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const factoryPath = process.env.AOHYS_FACTORY_PATH ?? "/Applications/Factory.app/Contents/Resources/bin/droid";

export const lifecycleProbeDefinitions = [
  { skill: "drive-development-flow", question: "What exact selection principle chooses a stage, and how far may that stage move?", behaviorSignature: ["smallest fitting route", "only as far"] },
  { skill: "wayfinder", question: "What exact name is given to still-unclear future decisions, and what kind of tickets resolve the known decisions?", behaviorSignature: ["fog of war", "decision tickets"] },
  { skill: "grill-with-docs", question: "Which two named skills must this skill run together?", behaviorSignature: ["grilling", "domain-modeling"] },
  { skill: "to-spec", question: "What must be checked with the user before the document is written, and which triage label is applied when it is published?", behaviorSignature: ["seams", "ready-for-agent"] },
  { skill: "to-tickets", question: "Which two exact terms describe the slice style and the dependency relationships each ticket declares?", behaviorSignature: ["tracer bullet", "blocking edges"] },
  { skill: "flow-implement", question: "What exact unit of work must be pinned before editing, and which skill is loaded when that unit is complete?", behaviorSignature: ["one binary done condition", "flow-code-review"] },
  { skill: "flow-code-review", question: "What are the exact names of the two blind review axes?", behaviorSignature: ["Standards", "Spec"] },
];

/** @param {string} response @param {string[]} behaviorSignature */
export function responsePasses(response, behaviorSignature) {
  return hasBehaviorSignature(response, behaviorSignature);
}

/** @param {string} executable @param {string[]} args @param {number} timeoutMs */
function run(executable, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(executable, args, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

/** @param {string} text */
function jsonLines(text) {
  return text.split("\n").flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** @param {string} stderr */
function stderrSummary(stderr) {
  return stderr.split("\n")
    .filter((line) => /Skill .* activated|\b(?:ERROR|failed|invalid_client)\b/i.test(line))
    .slice(-10);
}

/** @param {"codex" | "factory"} harness @param {(typeof lifecycleProbeDefinitions)[number]} definition @param {number} timeoutMs */
async function probe(harness, definition, timeoutMs) {
  const prefix = harness === "codex" ? "$" : "/";
  const prompt = `${prefix}${definition.skill} Read the complete skill instructions but do not execute the workflow, write files, persist state, or contact external services. Answer this question with the two relevant exact short phrases from the skill and no extra explanation: ${definition.question}`;
  const args = harness === "codex"
    ? ["-a", "never", "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-C", repositoryRoot, prompt]
    : ["exec", "--cwd", repositoryRoot, "--output-format", "json", prompt];
  const executable = harness === "codex" ? codexPath : factoryPath;
  const result = /** @type {any} */ (await run(executable, args, timeoutMs));
  const events = jsonLines(`${result.stdout}\n${result.stderr}`);
  const response = harness === "codex"
    ? events.filter((event) => event?.type === "item.completed" && event.item?.type === "agent_message").map((event) => event.item.text).at(-1) ?? ""
    : events.filter((event) => event?.type === "result" && typeof event.result === "string").map((event) => event.result).at(-1) ?? "";
  const activationObserved = harness === "factory"
    ? new RegExp(`Skill ["']${definition.skill}["'] activated`, "i").test(result.stderr)
    : null;
  const influenceObserved = responsePasses(response, definition.behaviorSignature);
  return {
    skill: definition.skill,
    behaviorSignature: definition.behaviorSignature,
    commandPrefix: prefix,
    sandbox: harness === "codex" ? "codex-read-only" : "factory-default-read-only",
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    response,
    activationObserved,
    influenceObserved,
    passed: result.exitCode === 0 && !result.timedOut && influenceObserved &&
      (harness !== "factory" || activationObserved),
    stderrSummary: stderrSummary(result.stderr),
  };
}

/** @param {"codex" | "factory"} harness @param {number} timeoutMs */
async function probeHarness(harness, timeoutMs) {
  const results = [];
  for (const definition of lifecycleProbeDefinitions) results.push(await probe(harness, definition, timeoutMs));
  return results;
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
  const timeoutMs = Number(process.env.AOHYS_LIFECYCLE_PROBE_TIMEOUT_MS ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("AOHYS_LIFECYCLE_PROBE_TIMEOUT_MS must be positive");
  const repositoryStateBefore = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd: repositoryRoot, encoding: "utf8" });
  const [codex, factory] = await Promise.all([
    probeHarness("codex", timeoutMs),
    probeHarness("factory", timeoutMs),
  ]);
  const repositoryStateAfter = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd: repositoryRoot, encoding: "utf8" });
  const repositoryMutations = repositoryStateAfter === repositoryStateBefore ? [] : ["git-status-changed-during-probe"];
  const evidence = {
    schemaVersion: 1,
    contractVersion: "0.8.0",
    catalogVersion: "0.2.0",
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    repositoryMutations,
    harnesses: { codex, factory },
    passed: repositoryMutations.length === 0 && [...codex, ...factory].every((result) => result.passed),
  };
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.passed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
