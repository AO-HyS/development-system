// @ts-check

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedVersionIndex = process.argv.indexOf("--version");
const version = requestedVersionIndex >= 0 ? process.argv[requestedVersionIndex + 1] : "0.16.0";
if (version !== "0.16.0") {
  throw new Error("Published catalogs are immutable; generator supports only unpublished version 0.16.0");
}
const destination = resolve(repositoryRoot, "catalog", `${version}.json`);
await readFile(destination).then(
  () => { throw new Error(`Refusing to overwrite immutable catalog ${version}; add a new semantic version`); },
  (error) => { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; },
);
const declaresPhysicalHarnesses = true;
const supportsFactory = false;
const baseSkillVersion = "0.2.0";
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

/** @param {string} logicalName @param {string} sourceDirectory @param {Record<string, unknown>} source @param {string[]} [executableFiles] */
async function sharedSkill(logicalName, sourceDirectory, source, executableFiles = []) {
  const hash = await folderHash(resolve(repositoryRoot, sourceDirectory));
  return {
    logicalName,
    ...(declaresPhysicalHarnesses ? { physicalHarnesses: supportsFactory ? ["codex", "factory"] : ["codex"] } : {}),
    source,
    variants: [
      {
        id: `${logicalName}.codex`,
        harness: "codex",
        sourceDirectory,
        destination: `.agents/skills/${logicalName}`,
        folderSha256: hash,
        ...(executableFiles.length ? { executableFiles } : {}),
        expectedMirrorOf: null,
      },
      ...(supportsFactory ? [{
        id: `${logicalName}.factory`,
        harness: "factory",
        sourceDirectory,
        destination: `.factory/skills/${logicalName}`,
        folderSha256: hash,
        ...(executableFiles.length ? { executableFiles } : {}),
        expectedMirrorOf: `${logicalName}.codex`,
      }] : []),
    ],
  };
}

const upstreamSkills = await Promise.all(
  Object.entries(upstreamPaths).map(([logicalName, upstreamPath]) =>
    sharedSkill(logicalName, `artifacts/${baseSkillVersion}/skills/upstream/${logicalName}`, {
      repository: "https://github.com/mattpocock/skills",
      commit: upstreamCommit,
      path: upstreamPath,
    }),
  ),
);
const internalNames = ["flow-code-review", "flow-implement", "flow-qa", "flow-research"];
const internalSkills = await Promise.all(
  internalNames.map((logicalName) =>
    sharedSkill(logicalName, `artifacts/${logicalName === "flow-implement" ? "1.1.0" : baseSkillVersion}/skills/internal/${logicalName}`, {
      repository: "https://github.com/AO-HyS/development-system",
      commit: "$INSTALL_COMMIT",
      path: `artifacts/${logicalName === "flow-implement" ? "1.1.0" : baseSkillVersion}/skills/internal/${logicalName}`,
    }),
  ),
);

const driveSource = "artifacts/1.5.0/skills/internal/drive-development-flow";
const driveHash = await folderHash(resolve(repositoryRoot, driveSource));
const drive = {
  logicalName: "drive-development-flow",
  ...(declaresPhysicalHarnesses ? { physicalHarnesses: ["codex"] } : {}),
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
  ],
};

const orchestrationVersion = "1.5.7";
const adapterContract = "bounded-measurable-orchestration-v4";
const codexAdapterSource = `artifacts/${orchestrationVersion}/adapters/codex/coding-orchestration`;
const orchestration = {
  logicalName: "coding-orchestration",
  ...(declaresPhysicalHarnesses ? { physicalHarnesses: ["codex"] } : {}),
  source: {
    repository: "https://github.com/AO-HyS/development-system",
    commit: "$INSTALL_COMMIT",
    path: `artifacts/${orchestrationVersion}/adapters`,
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
  ],
};

const measurementSource = "artifacts/1.0.0/skills/internal/measure-development-run";
const measurement = {
  logicalName: "measure-development-run",
  physicalHarnesses: ["codex"],
  availabilityReason: "Codex session JSONL and CODEX_THREAD_ID are required; Factory is intentionally out of scope.",
  source: {
    repository: "https://github.com/AO-HyS/development-system",
    commit: "$INSTALL_COMMIT",
    path: measurementSource,
  },
  variants: [
    {
      id: "measure-development-run.codex",
      harness: "codex",
      sourceDirectory: measurementSource,
      destination: ".codex/skills/measure-development-run",
      folderSha256: await folderHash(resolve(repositoryRoot, measurementSource)),
      expectedMirrorOf: null,
    },
  ],
};

const additions = await Promise.all([
      sharedSkill(
        "exa-search",
        "artifacts/1.1.1/skills/internal/exa-search",
        {
          repository: "https://github.com/AO-HyS/development-system",
          commit: "$INSTALL_COMMIT",
          path: "artifacts/1.1.1/skills/internal/exa-search",
        },
        ["scripts/exa-search.mjs"],
      ),
      sharedSkill(
        "global-agent-guardrails",
        "artifacts/1.5.2/skills/internal/global-agent-guardrails",
        {
          repository: "https://github.com/AO-HyS/development-system",
          commit: "$INSTALL_COMMIT",
          path: "artifacts/1.5.2/skills/internal/global-agent-guardrails",
        },
        ["scripts/command-guard.mjs"],
      ),
      sharedSkill("decisions", "artifacts/1.1.0/skills/internal/decisions", {
        repository: "https://github.com/AO-HyS/development-system",
        commit: "$INSTALL_COMMIT",
        path: "artifacts/1.1.0/skills/internal/decisions",
      }),
      sharedSkill("setup-help", "artifacts/1.1.0/skills/internal/setup-help", {
        repository: "https://github.com/AO-HyS/development-system",
        commit: "$INSTALL_COMMIT",
        path: "artifacts/1.1.0/skills/internal/setup-help",
      }),
    ]);

const workingBackwards = await sharedSkill(
  "working-backwards",
  "artifacts/1.5.9/skills/internal/working-backwards",
  {
    repository: "https://github.com/AO-HyS/development-system",
    commit: "$INSTALL_COMMIT",
    path: "artifacts/1.5.9/skills/internal/working-backwards",
  },
  ["scripts/t3-workflow.mjs", "scripts/t3-reader.mjs", "scripts/topic-questions.mjs", "scripts/reader-live.mjs"],
);

const orchestrationPilot = await sharedSkill(
  "orchestration-pilot",
  "artifacts/1.5.7/skills/internal/orchestration-pilot",
  {
    repository: "https://github.com/AO-HyS/development-system",
    commit: "$INSTALL_COMMIT",
    path: "artifacts/1.5.7/skills/internal/orchestration-pilot",
  },
);

const nextInternalNames = [
  "parallel-work",
  "release-train",
  "check-in",
  "linear-hygiene",
  "development-steward",
  "convex-guardian",
  "posthog-observability",
];
const nextInternalSkills = await Promise.all(nextInternalNames.map((logicalName) =>
  sharedSkill(logicalName, `artifacts/${logicalName === "development-steward" ? "1.5.1" : "1.5.0"}/skills/internal/${logicalName}`, {
        repository: "https://github.com/AO-HyS/development-system",
        commit: "$INSTALL_COMMIT",
        path: `artifacts/${logicalName === "development-steward" ? "1.5.1" : "1.5.0"}/skills/internal/${logicalName}`,
  }),
));

const previousCatalog = /** @type {{skills: Array<{variants: Array<{harness: string, destination: string}>}>}} */ (
  JSON.parse(await readFile(resolve(repositoryRoot, "catalog", "0.8.0.json"), "utf8"))
);
const retiredFactoryDestinations = previousCatalog.skills
  .flatMap((skill) => skill.variants)
  .filter((variant) => variant.harness === "factory")
  .map((variant) => variant.destination);

const catalog = {
  schemaVersion: 1,
  catalogVersion: version,
  supportedHarnesses: [
    { id: "codex", adapter: "native" },
    { id: "t3code", adapter: "codex" },
  ],
  supportedRoots: [".agents/skills", ".codex/skills", ".factory/skills"],
  maxCatalogEntries: 512,
  operationalEvidenceSkills: ["research"],
  operationalEvidenceContracts: {
    research: { behaviorSignature: ["background agent", "primary sources", "markdown file"] },
  },
  cleanup: [
    ...retiredFactoryDestinations,
    ".agents/skills/grill-me-workspace",
    ".agents/skills/email-best-practices-repo",
    ".codex/skills/agent-browser",
    ".codex/skills/convex",
    ".codex/skills/find-skills",
    ".codex/skills/vercel-react-best-practices",
    ".codex/skills/work-multiple",
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
  skills: [
    ...upstreamSkills,
    ...internalSkills,
    drive,
    orchestration,
    measurement,
    orchestrationPilot,
    workingBackwards,
    ...nextInternalSkills,
    ...additions,
  ],
};

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${relative(repositoryRoot, destination)} with ${catalog.skills.length} logical skills.\n`);
