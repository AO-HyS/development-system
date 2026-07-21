// @ts-check

import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codexPath = process.env.AOHYS_CODEX_PATH ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const factoryPath = process.env.AOHYS_FACTORY_PATH ?? "/Applications/Factory.app/Contents/Resources/bin/droid";

export const lifecycleProbeDefinitions = [
  { skill: "drive-development-flow", token: "drive-development-flow|router-only", fact: "it routes or recommends a lifecycle stage without crossing a manual human gate" },
  { skill: "wayfinder", token: "wayfinder|explicit-only", fact: "it runs only when explicitly invoked outside the normal lifecycle" },
  { skill: "grill-with-docs", token: "grill-with-docs|human-gate", fact: "requirements stop for a human gate" },
  { skill: "to-spec", token: "to-spec|human-gate", fact: "the spec and Local Visual Plan stop for a human gate" },
  { skill: "to-tickets", token: "to-tickets|human-gate", fact: "ticket creation stops for a human gate" },
  { skill: "flow-implement", token: "flow-implement|bounded-authority", fact: "the implementation-review-correction loop stays inside request and repository-policy authority" },
  { skill: "flow-code-review", token: "flow-code-review|review-only", fact: "review does not edit product code unless the user asks to address findings" },
];

/** @param {string} response @param {string} token */
export function responsePasses(response, token) {
  return response.trim() === token;
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

/** @param {"codex" | "factory"} harness @param {(typeof lifecycleProbeDefinitions)[number]} definition @param {number} timeoutMs */
async function probe(harness, definition, timeoutMs) {
  const prefix = harness === "codex" ? "$" : "/";
  const prompt = `${prefix}${definition.skill} Read the complete skill instructions but do not execute the workflow, write files, persist state, or contact external services. If and only if the skill itself confirms that ${definition.fact}, reply exactly ${definition.token}. Otherwise reply exactly FAIL.`;
  const args = harness === "codex"
    ? ["-a", "never", "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-C", repositoryRoot, prompt]
    : ["exec", "--cwd", repositoryRoot, "--output-format", "json", prompt];
  const executable = harness === "codex" ? codexPath : factoryPath;
  const result = /** @type {any} */ (await run(executable, args, timeoutMs));
  const events = jsonLines(`${result.stdout}\n${result.stderr}`);
  const response = harness === "codex"
    ? events.filter((event) => event?.type === "item.completed" && event.item?.type === "agent_message").map((event) => event.item.text).at(-1) ?? ""
    : events.filter((event) => event?.type === "result" && typeof event.result === "string").map((event) => event.result).at(-1) ?? "";
  return {
    skill: definition.skill,
    token: definition.token,
    commandPrefix: prefix,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    response,
    passed: result.exitCode === 0 && !result.timedOut && responsePasses(response, definition.token),
    stderr: result.stderr.trim(),
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
  const timeoutMs = Number(process.env.AOHYS_LIFECYCLE_PROBE_TIMEOUT_MS ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("AOHYS_LIFECYCLE_PROBE_TIMEOUT_MS must be positive");
  const [codex, factory] = await Promise.all([
    Promise.all(lifecycleProbeDefinitions.map((definition) => probe("codex", definition, timeoutMs))),
    Promise.all(lifecycleProbeDefinitions.map((definition) => probe("factory", definition, timeoutMs))),
  ]);
  const evidence = {
    schemaVersion: 1,
    contractVersion: "0.8.0",
    catalogVersion: "0.2.0",
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    readOnly: true,
    externalSideEffects: [],
    harnesses: { codex, factory },
    passed: [...codex, ...factory].every((result) => result.passed),
  };
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.passed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
