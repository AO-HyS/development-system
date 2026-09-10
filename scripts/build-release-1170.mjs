// @ts-check
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "1.17.0";
const catalogVersion = "0.38.0";
/** @param {string | Buffer} bytes */
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {string} path */
const read = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"], { cwd: root, stdio: "pipe" });
for (const path of [`catalog/${catalogVersion}.json`, `manifests/${version}.json`, `config/${version}/agent-roster.json`, `artifacts/${version}`]) {
  try { execFileSync("git", ["cat-file", "-e", `origin/main:${path}`], { cwd: root, stdio: "pipe" }); }
  catch { continue; }
  throw new Error(`Refusing to rewrite published release path: ${path}`);
}
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
      else throw new Error(`Unsupported source: ${path}`);
    }
  }
  const absolute = resolve(root, directory);
  await walk(absolute);
  const digest = createHash("sha256");
  for (const path of files.sort()) digest.update(relative(absolute, path)).update("\0").update(await readFile(path)).update("\0");
  return digest.digest("hex");
}
const catalog = await read("catalog/0.37.1.json");
catalog.catalogVersion = catalogVersion;
// Snapshot mutable operator inputs and release-facing guidance into the new
// immutable version before calculating any hashes. The published-path guard
// above keeps this safe to rerun while the source inputs remain editable.
await writeFile(
  resolve(root, `config/${version}/agent-roster.json`),
  await readFile(resolve(root, "config/agent-roster.json")),
);
await writeFile(
  resolve(root, `artifacts/${version}/model-routing.md`),
  await readFile(resolve(root, "docs/model-routing.md")),
);
const changedSkills = [
  "drive-development-flow",
  "coding-orchestration",
  "flow-implement",
  "design-quality",
  "design-direction",
  "evidence-capture",
  "implement-spec",
  "parallel-work",
];
for (const name of changedSkills) {
  const skill = catalog.skills.find((/** @type {{logicalName: string}} */ item) => item.logicalName === name);
  const directory = `artifacts/${version}/skills/internal/${name}`;
  skill.source.path = directory;
  for (const variant of skill.variants) {
    variant.sourceDirectory = directory;
    variant.folderSha256 = await folderHash(directory);
  }
  if (name === "drive-development-flow" || name === "coding-orchestration") {
    const original = skill.variants[0];
    const mirrorId = `${name}.agents`;
    if (!skill.variants.some((/** @type {{id: string}} */ variant) => variant.id === mirrorId)) {
      skill.variants.push({
        id: mirrorId,
        harness: original.harness,
        sourceDirectory: directory,
        destination: `.agents/skills/${name}`,
        folderSha256: original.folderSha256,
        expectedMirrorOf: original.id,
        ...(original.adapterContract ? { adapterContract: original.adapterContract } : {}),
      });
    }
  }
}
await writeFile(resolve(root, `catalog/${catalogVersion}.json`), JSON.stringify(catalog, null, 2) + "\n");
const manifest = await read("manifests/1.16.1.json");
manifest.contractVersion = version;
for (const artifact of manifest.artifacts) {
  if (artifact.logicalName === "development-contract") artifact.sourcePath = `artifacts/${version}/contract.md`;
  if (artifact.logicalName === "agent-roster") artifact.sourcePath = `config/${version}/agent-roster.json`;
  if (artifact.logicalName === "skill-catalog") artifact.sourcePath = `catalog/${catalogVersion}.json`;
  if (artifact.logicalName === "personal-codex-instructions") artifact.sourcePath = `artifacts/${version}/global-codex-instructions.md`;
  if (artifact.logicalName === "model-routing") artifact.sourcePath = `artifacts/${version}/model-routing.md`;
  if (artifact.logicalName === "codex-agent-fast-implementer") artifact.sourcePath = `artifacts/${version}/agents/codex/fast-implementer.toml`;
  if (artifact.logicalName === "codex-agent-evidence-preparer") artifact.sourcePath = `artifacts/${version}/agents/codex/evidence-preparer.toml`;
  artifact.sha256 = hash(await readFile(resolve(root, artifact.sourcePath)));
}
await writeFile(resolve(root, `manifests/${version}.json`), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify({ version, catalogVersion }) + "\n");
