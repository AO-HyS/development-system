// @ts-check
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "1.16.1";
const catalogVersion = "0.37.1";
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
const catalog = await read("catalog/0.37.0.json");
catalog.catalogVersion = catalogVersion;
for (const name of ["coding-orchestration", "flow-implement", "evidence-capture"]) {
  const skill = catalog.skills.find((/** @type {{logicalName: string}} */ item) => item.logicalName === name);
  const directory = `artifacts/${version}/skills/internal/${name}`;
  skill.source.path = directory;
  for (const variant of skill.variants) {
    variant.sourceDirectory = directory;
    variant.folderSha256 = await folderHash(directory);
  }
}
await writeFile(resolve(root, `catalog/${catalogVersion}.json`), JSON.stringify(catalog, null, 2) + "\n");
const manifest = await read("manifests/1.16.0.json");
manifest.contractVersion = version;
/** @type {string[]} */
const changedAgents = (await readdir(resolve(root, `artifacts/${version}/agents/codex`))).map((name) => name.replace(/\.toml$/, ""));
for (const artifact of manifest.artifacts) {
  if (artifact.logicalName === "development-contract") artifact.sourcePath = `artifacts/${version}/contract.md`;
  if (artifact.logicalName === "agent-roster") artifact.sourcePath = `config/${version}/agent-roster.json`;
  if (artifact.logicalName === "skill-catalog") artifact.sourcePath = `catalog/${catalogVersion}.json`;
  for (const name of changedAgents) {
    if (artifact.logicalName === `codex-agent-${name}`) artifact.sourcePath = `artifacts/${version}/agents/codex/${name}.toml`;
  }
  artifact.sha256 = hash(await readFile(resolve(root, artifact.sourcePath)));
}
await writeFile(resolve(root, `manifests/${version}.json`), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify({ version, catalogVersion }) + "\n");
