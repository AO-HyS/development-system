// @ts-check

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProcessHarnessRuntime,
  mergeOperationalReports,
  validateOperationalScenarios,
} from "../src/harnesses.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} name @param {string | undefined} fallback */
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const projectsRootArgument = argument("--projects-root", resolve(repositoryRoot, ".."));
if (!projectsRootArgument) throw new Error("--projects-root requires a value");
const projectsRoot = resolve(projectsRootArgument);
const output = argument("--output", undefined);
const resumePath = argument("--resume", undefined);
const selectedScenario = argument("--scenario", undefined);
const timeoutMs = Number(argument("--timeout-ms", "60000"));
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be positive");
const registry = JSON.parse(await readFile(resolve(repositoryRoot, "config/0.6.0/harness-adapters.json"), "utf8"));
const scenarioDocument = JSON.parse(
  await readFile(resolve(repositoryRoot, "config/0.6.0/operational-scenarios.json"), "utf8"),
);
/** @type {string[]} */
const temporaryDirectories = [];
/** @param {string} fixture */
async function createTemporaryFixture(fixture) {
  if (fixture !== "simple-repository") throw new Error(`Unsupported temporary fixture: ${fixture}`);
  const directory = await mkdtemp(resolve(tmpdir(), "aohys-simple-repository-"));
  temporaryDirectories.push(directory);
  await writeFile(resolve(directory, "AGENTS.md"), [
    "# Simple repository fixture",
    "",
    "Use the global development lifecycle. This fixture is read-only during operational classification.",
    "Do not write files, persist lifecycle state, or contact external systems.",
    "",
  ].join("\n"), "utf8");
  await writeFile(resolve(directory, "package.json"), `${JSON.stringify({ name: "simple-operational-fixture", private: true }, null, 2)}\n`, "utf8");
  return directory;
}
let resumeReport = null;
if (resumePath) resumeReport = JSON.parse(await readFile(resolve(resumePath), "utf8"));
const failedKeys = new Set((resumeReport?.failures ?? []).map(
  (/** @type {any} */ failure) => `${failure.scenario}:${failure.surface ?? "*"}`,
));
const selectedDocuments = selectedScenario
  ? scenarioDocument.scenarios.filter((/** @type {any} */ scenario) => scenario.id === selectedScenario)
  : scenarioDocument.scenarios;
if (selectedScenario && selectedDocuments.length === 0) throw new Error(`Unknown --scenario: ${selectedScenario}`);
const scenarios = (await Promise.all(selectedDocuments.map(async (/** @type {any} */ scenario) => {
  const cwd = scenario.temporaryFixture
    ? await createTemporaryFixture(scenario.temporaryFixture)
    : resolve(projectsRoot, scenario.relativeCwd);
  /** @type {string[]} */
  const policyErrors = [];
  try {
    await access(cwd);
  } catch {
    policyErrors.push(`Scenario CWD does not exist: ${cwd}`);
  }
  const surfaces = selectedScenario
    ? scenario.surfaces
    : resumeReport
    ? scenario.surfaces.filter((/** @type {string} */ surface) =>
        failedKeys.has(`${scenario.id}:${surface}`) || failedKeys.has(`${scenario.id}:*`)
      )
    : scenario.surfaces;
  return { ...scenario, cwd, policyErrors, surfaces, rerunAll: failedKeys.has(`${scenario.id}:*`) };
}))).filter((scenario) => scenario.surfaces.length > 0 || scenario.policyErrors.length > 0);
const runtime = createProcessHarnessRuntime({
  codexPath: process.env.AOHYS_CODEX_PATH,
  factoryPath: process.env.AOHYS_FACTORY_PATH,
  timeoutMs,
});
const scenarioReports = await Promise.all(
  scenarios.map((scenario) => validateOperationalScenarios({ registry, scenarios: [scenario], runtime })),
);
const report = mergeOperationalReports({
  contractVersion: registry.contractVersion,
  resumeReport,
  scenarios,
  scenarioReports,
});
if (output) {
  const outputPath = resolve(output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
if (!report.ok) process.exitCode = 1;
