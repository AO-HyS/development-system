// @ts-check

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.2.0";
const upstreamCommit = "9603c1cc8118d08bc1b3bf34cf714f62178dea3b";
const upstreamPaths = {
  wayfinder: "skills/engineering/wayfinder",
  "grill-with-docs": "skills/engineering/grill-with-docs",
  grilling: "skills/productivity/grilling",
  "domain-modeling": "skills/engineering/domain-modeling",
  "to-spec": "skills/engineering/to-spec",
  "to-tickets": "skills/engineering/to-tickets",
  implement: "skills/engineering/implement",
  "code-review": "skills/engineering/code-review",
  "diagnosing-bugs": "skills/engineering/diagnosing-bugs",
  prototype: "skills/engineering/prototype",
  handoff: "skills/productivity/handoff",
  qa: "skills/deprecated/qa",
  research: "skills/engineering/research",
  "setup-matt-pocock-skills": "skills/engineering/setup-matt-pocock-skills",
};

/** @param {string} directory */
async function folderHash(directory) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} current */
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(directory);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(directory, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** @param {string} logicalName @param {string} sourceDirectory @param {Record<string, unknown>} source */
async function sharedSkill(logicalName, sourceDirectory, source) {
  const hash = await folderHash(resolve(repositoryRoot, sourceDirectory));
  return {
    logicalName,
    source,
    variants: [
      {
        id: `${logicalName}.codex`,
        harness: "codex",
        sourceDirectory,
        destination: `.agents/skills/${logicalName}`,
        folderSha256: hash,
        expectedMirrorOf: null,
      },
      {
        id: `${logicalName}.factory`,
        harness: "factory",
        sourceDirectory,
        destination: `.factory/skills/${logicalName}`,
        folderSha256: hash,
        expectedMirrorOf: `${logicalName}.codex`,
      },
    ],
  };
}

const upstreamSkills = await Promise.all(
  Object.entries(upstreamPaths).map(([logicalName, upstreamPath]) =>
    sharedSkill(logicalName, `artifacts/${version}/skills/upstream/${logicalName}`, {
      repository: "https://github.com/mattpocock/skills",
      commit: upstreamCommit,
      path: upstreamPath,
    }),
  ),
);
const internalNames = ["flow-code-review", "flow-implement", "flow-qa", "flow-research"];
const internalSkills = await Promise.all(
  internalNames.map((logicalName) =>
    sharedSkill(logicalName, `artifacts/${version}/skills/internal/${logicalName}`, {
      repository: "https://github.com/AO-HyS/development-system",
      commit: "$INSTALL_COMMIT",
      path: `artifacts/${version}/skills/internal/${logicalName}`,
    }),
  ),
);

const driveSource = `artifacts/${version}/skills/internal/drive-development-flow`;
const driveHash = await folderHash(resolve(repositoryRoot, driveSource));
const drive = {
  logicalName: "drive-development-flow",
  source: {
    repository: "https://github.com/AO-HyS/development-system",
    commit: "$INSTALL_COMMIT",
    path: driveSource,
  },
  variants: [
    {
      id: "drive-development-flow.codex",
      harness: "codex",
      sourceDirectory: driveSource,
      destination: ".codex/skills/drive-development-flow",
      folderSha256: driveHash,
      expectedMirrorOf: null,
    },
    {
      id: "drive-development-flow.factory",
      harness: "factory",
      sourceDirectory: driveSource,
      destination: ".factory/skills/drive-development-flow",
      folderSha256: driveHash,
      expectedMirrorOf: "drive-development-flow.codex",
    },
  ],
};

const adapterContract = "bounded-orchestration-parent-integrates-v1";
const codexAdapterSource = `artifacts/${version}/adapters/codex/coding-orchestration`;
const factoryAdapterSource = `artifacts/${version}/adapters/factory/coding-orchestration`;
const orchestration = {
  logicalName: "coding-orchestration",
  source: {
    repository: "https://github.com/AO-HyS/development-system",
    commit: "$INSTALL_COMMIT",
    path: `artifacts/${version}/adapters`,
  },
  variants: [
    {
      id: "coding-orchestration.codex-adapter",
      harness: "codex",
      sourceDirectory: codexAdapterSource,
      destination: ".codex/skills/coding-orchestration",
      folderSha256: await folderHash(resolve(repositoryRoot, codexAdapterSource)),
      expectedMirrorOf: null,
      adapterContract,
    },
    {
      id: "coding-orchestration.factory-adapter",
      harness: "factory",
      sourceDirectory: factoryAdapterSource,
      destination: ".factory/skills/coding-orchestration",
      folderSha256: await folderHash(resolve(repositoryRoot, factoryAdapterSource)),
      expectedMirrorOf: null,
      adapterContract,
    },
  ],
};

const catalog = {
  schemaVersion: 1,
  catalogVersion: version,
  supportedHarnesses: [
    { id: "codex", adapter: "native" },
    { id: "t3code", adapter: "codex" },
    { id: "factory", adapter: "native" },
  ],
  supportedRoots: [".agents/skills", ".codex/skills", ".factory/skills"],
  maxCatalogEntries: 512,
  operationalEvidenceSkills: ["research"],
  operationalEvidenceContracts: {
    research: { behaviorSignature: ["background agent", "primary sources", "markdown file"] },
  },
  cleanup: [
    ".agents/skills/grill-me-workspace",
    ".agents/skills/email-best-practices-repo",
    ".codex/skills/agent-browser",
    ".codex/skills/convex",
    ".codex/skills/find-skills",
    ".codex/skills/vercel-react-best-practices",
    ".factory/skills/extract",
    ".factory/skills/email-best-practices-repo",
    ".factory/skills/frontend-design",
    ".factory/skills/firecrawl-cli",
    ".factory/skills/harden",
    ".factory/skills/normalize",
    ".factory/skills/onboard",
    ".factory/skills/teach-impeccable",
    ".factory/skills/vercel-deploy-claimable",
  ],
  skills: [...upstreamSkills, ...internalSkills, drive, orchestration],
};

const destination = resolve(repositoryRoot, "catalog", `${version}.json`);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${relative(repositoryRoot, destination)} with ${catalog.skills.length} logical skills.\n`);
