// @ts-check

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const behaviorSignature = ["background agent", "primary sources", "markdown file"];
const codexPath = process.env.AOHYS_CODEX_PATH ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const factoryPath = process.env.AOHYS_FACTORY_PATH ?? "/Applications/Factory.app/Contents/Resources/bin/droid";
const factoryLog = resolve(process.env.HOME ?? "", ".factory", "logs", "droid-log-single.log");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
const probeHome = resolve(process.env.HOME ?? "");

/** @param {string} directory */
async function directoryHash(directory) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} current */
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Installed skill contains symbolic link: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(directory);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file.slice(directory.length + 1));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** @param {string} text */
function factoryScannerErrors(text) {
  return [...new Set(
    text
      .split("\n")
      .filter((line) => line.includes("Failed to load skills directory"))
      .map((line) => {
        const message = line.match(/\\?"message\\?":\\?"([^"\\]*(?:\\.[^"\\]*)*)/)?.[1];
        return message ? `Failed to load skills directory: ${message.replaceAll("\\'", "'")}` : "Failed to load skills directory";
      }),
  )];
}

/** @param {string} executable @param {string[]} args */
function run(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    command: [executable, ...args].join(" "),
  };
}

/** @param {string} text */
function jsonLines(text) {
  return text.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

async function logSize() {
  try {
    return (await stat(factoryLog)).size;
  } catch {
    return 0;
  }
}

const codexVersion = run(codexPath, ["--version"]);
const catalogPrompt = "Without opening or activating a skill, name the exact available skill whose catalog description covers investigating questions against high-trust primary sources. Reply with only its skill name.";
const codexCatalog = run(codexPath, [
  "-a", "never", "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-C", repositoryRoot, catalogPrompt,
]);
const codex = run(codexPath, [
  "-a",
  "never",
  "exec",
  "--ephemeral",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--json",
  "-C",
  repositoryRoot,
  "$research Read the full skill instructions. Then, according only to them: what kind of worker should do the job, what source class is mandatory, and what single artifact must it create? Reply in one short sentence; do not perform the research.",
]);
const beforeFactoryLog = await logSize();
const factoryVersion = run(factoryPath, ["--version"]);
const factoryCatalog = run(factoryPath, ["exec", "--cwd", repositoryRoot, "--output-format", "json", catalogPrompt]);
const factory = run(factoryPath, [
  "exec",
  "--cwd",
  repositoryRoot,
  "--output-format",
  "json",
  "/research Read the full skill instructions. Then, according only to them: what kind of worker should do the job, what source class is mandatory, and what single artifact must it create? Reply in one short sentence; do not perform the research.",
]);
let factoryLogDelta = "";
try {
  const contents = await readFile(factoryLog);
  factoryLogDelta = contents.subarray(beforeFactoryLog).toString("utf8");
} catch {
  factoryLogDelta = "";
}

const codexCombined = `${codex.stdout}\n${codex.stderr}`;
const factoryCombined = `${factory.stdout}\n${factory.stderr}`;
/** @param {string} text */
const hasBehaviorSignature = (text) => behaviorSignature.every((term) => text.toLowerCase().includes(term));
const codexMessages = jsonLines(codex.stdout)
  .filter((event) => event?.type === "item.completed" && event.item?.type === "agent_message")
  .map((event) => event.item.text);
const factoryMessages = jsonLines(factoryCombined)
  .filter((event) => event?.type === "result" && typeof event.result === "string")
  .map((event) => event.result);
const codexFinal = codexMessages.at(-1) ?? "";
const factoryFinal = factoryMessages.at(-1) ?? "";
const codexCatalogFinal = jsonLines(codexCatalog.stdout)
  .filter((event) => event?.type === "item.completed" && event.item?.type === "agent_message")
  .map((event) => event.item.text).at(-1) ?? "";
const factoryCatalogFinal = jsonLines(`${factoryCatalog.stdout}\n${factoryCatalog.stderr}`)
  .filter((event) => event?.type === "result" && typeof event.result === "string")
  .map((event) => event.result).at(-1) ?? "";
const codexLoaded = codexCombined.includes(".agents/skills/research/SKILL.md");
const factoryLoaded = /Skill ["']research["'] activated/i.test(factoryCombined);
const codexCatalogued = codexCatalog.exitCode === 0 && /^research\s*$/i.test(codexCatalogFinal);
const factoryCatalogued = factoryCatalog.exitCode === 0 && /^research\s*$/i.test(factoryCatalogFinal);
const probeSucceeded = Boolean(
  codexCatalogued && codexLoaded && hasBehaviorSignature(codexFinal) &&
  factoryCatalogued && factoryLoaded && hasBehaviorSignature(factoryFinal) &&
  codex.exitCode === 0 && factory.exitCode === 0
);
const evidence = {
  schemaVersion: 1,
  catalogVersion: "0.2.0",
  generatedAt: new Date().toISOString(),
  home: probeHome,
  skill: "research",
  behaviorSignature,
  probeSucceeded,
  installedHashes: {
    "research.codex": await directoryHash(resolve(probeHome, ".agents", "skills", "research")),
    "research.factory": await directoryHash(resolve(probeHome, ".factory", "skills", "research")),
  },
  codex: {
    research: {
      catalogued: codexCatalogued,
      loaded: codexLoaded,
      influenced: codexLoaded && hasBehaviorSignature(codexFinal),
      command: codex.command,
      version: codexVersion.stdout.trim(),
      exitCode: codex.exitCode,
      response: codexFinal,
      catalogCommand: codexCatalog.command,
      catalogResponse: codexCatalogFinal,
      catalogWarning: /skill descriptions were shortened/i.test(codexCombined),
      catalogOverflow: /skills? (?:were )?omitted|omitted_skills=[1-9]/i.test(codexCombined),
      scannerErrors: [...codexCombined.matchAll(/[^\n]*(?:skill scanner|failed to load skill)[^\n]*/gi)].map((match) => match[0]),
    },
  },
  factory: {
    research: {
      catalogued: factoryCatalogued,
      loaded: factoryLoaded,
      influenced: factoryLoaded && hasBehaviorSignature(factoryFinal),
      command: factory.command,
      version: factoryVersion.stdout.trim(),
      exitCode: factory.exitCode,
      response: factoryFinal,
      catalogCommand: factoryCatalog.command,
      catalogResponse: factoryCatalogFinal,
      catalogOverflow: /skills? (?:were )?omitted|omitted_skills=[1-9]|skill catalog[^\n]*(?:limit|overflow)/i.test(`${factoryCombined}\n${factoryLogDelta}`),
      scannerErrors: factoryScannerErrors(factoryLogDelta),
    },
  },
};

if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (
  !evidence.probeSucceeded
) {
  process.exitCode = 1;
}
