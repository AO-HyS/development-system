// @ts-check
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "1.8.3";
const catalogVersion = "0.29.3";
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
const catalog = await read("catalog/0.29.2.json");
catalog.catalogVersion = catalogVersion;
for (const name of ["working-backwards"]) {
  const skill = catalog.skills.find((/** @type {{logicalName: string}} */ item) => item.logicalName === name);
  if (!skill) throw new Error(`Missing skill ${name}`);
  const directory = `artifacts/${version}/skills/internal/${name}`;
  const upstreamReference = skill.source.upstreamReference ?? (skill.source.repository !== "https://github.com/AO-HyS/development-system" ? skill.source : null);
  skill.source = { repository: "https://github.com/AO-HyS/development-system", commit: "$INSTALL_COMMIT", path: directory, ...(upstreamReference ? { upstreamReference } : {}) };
  for (const variant of skill.variants) {
    variant.sourceDirectory = directory;
    variant.folderSha256 = await folderHash(directory);
    if (name === "working-backwards") variant.executableFiles = [...new Set([...variant.executableFiles, "scripts/t3-report.mjs"])];
  }
}
await writeFile(resolve(root, `catalog/${catalogVersion}.json`), JSON.stringify(catalog, null, 2) + "\n");
await mkdir(resolve(root, `config/${version}`), { recursive: true });
await writeFile(resolve(root, `config/${version}/agent-roster.json`), await readFile(resolve(root, "config/agent-roster.json")));
await writeFile(resolve(root, `artifacts/${version}/model-routing.md`), await readFile(resolve(root, "docs/model-routing.md")));
const manifest = await read("manifests/1.8.2.json");
manifest.contractVersion = version;
/** @type {Record<string, string>} */
const replacements = { "development-contract": `artifacts/${version}/contract.md`, "model-routing": `artifacts/${version}/model-routing.md`, "agent-roster": `config/${version}/agent-roster.json`, "skill-catalog": `catalog/${catalogVersion}.json` };
for (const artifact of manifest.artifacts) {
  if (replacements[artifact.logicalName]) artifact.sourcePath = replacements[artifact.logicalName];
  artifact.sha256 = hash(await readFile(resolve(root, artifact.sourcePath)));
}
await writeFile(resolve(root, `manifests/${version}.json`), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify({ version, catalogVersion, skills: catalog.skills.length, artifacts: manifest.artifacts.length }) + "\n");
