// @ts-check

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCodexSkillProbeEvidence,
  buildCodexSkillProbeInvocations,
  runCodexSkillProbeSequence,
  runSkillProbeProcess,
  skillProbeContracts,
} from "../src/skill-probe-runtime.mjs";
import { resolveSkillProbeMetadata } from "../src/skill-probe-metadata.mjs";
import { writePrivateEvidence } from "../src/private-evidence.mjs";
import { ensureSkillEvidenceKey } from "../src/skill-evidence-auth.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codexPath = process.env.AOHYS_CODEX_PATH ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const timeoutMs = Number(process.env.AOHYS_SKILL_PROBE_TIMEOUT_MS ?? "60000");
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("AOHYS_SKILL_PROBE_TIMEOUT_MS must be positive");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
const probeHome = resolve(process.env.HOME ?? "");
const latestOutputPath = resolve(
  probeHome,
  ".development-system",
  "private",
  "reports",
  "skills-live-latest.json",
);
const installedLock = JSON.parse(await readFile(resolve(probeHome, ".development-system", "skills-lock.json"), "utf8"));
const installedCatalog = JSON.parse(await readFile(resolve(probeHome, ".codex", "development-system", "skills.json"), "utf8"));
const authenticationKey = await ensureSkillEvidenceKey(probeHome);
const { sourceCommit, catalogVersion } = resolveSkillProbeMetadata({
  installedLock,
  codexCatalog: installedCatalog,
});

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

const invocations = buildCodexSkillProbeInvocations({ codexPath, repositoryRoot, home: probeHome });
/** @param {{executable: string, args: string[]}} invocation */
const execute = (invocation) => runSkillProbeProcess({
  ...invocation,
  cwd: repositoryRoot,
  timeoutMs,
  env: { ...process.env, HOME: probeHome },
});
const { codexVersion, observations } = await runCodexSkillProbeSequence({
  invocations,
  home: probeHome,
  execute,
});
/** @type {Record<string, string>} */
const installedHashes = {};
for (const contract of skillProbeContracts) {
  installedHashes[`${contract.logicalName}.codex`] = await directoryHash(
    resolve(probeHome, ".agents", "skills", contract.logicalName),
  );
}
const evidence = buildCodexSkillProbeEvidence({
  catalogVersion,
  sourceCommit,
  home: probeHome,
  structuralCatalogLogicalSkills: installedCatalog.skills.length,
  installedHashes,
  generatedAt: new Date().toISOString(),
  codexVersion,
  observations,
  authenticationKey,
});

const serializedEvidence = `${JSON.stringify(evidence, null, 2)}\n`;
await writePrivateEvidence({ home: probeHome, destination: latestOutputPath, contents: serializedEvidence });
if (outputPath && outputPath !== latestOutputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializedEvidence, { encoding: "utf8", mode: 0o600 });
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (
  !evidence.probeSucceeded
) {
  process.exitCode = 1;
}
