// @ts-check
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "1.11.0";
const catalogVersion = "0.32.0";
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
const catalog = await read("catalog/0.31.0.json");
catalog.catalogVersion = catalogVersion;
const internalNames = ["coding-orchestration", "drive-development-flow", "flow-implement", "pstack-engineering", "create-product-verification", "maintain-product-verification", "design-quality", "evidence-capture"];
const shortcuts = "adapt animate audit bolder clarify colorize critique delight distill layout optimize overdrive polish quieter shape typeset".split(" ");
for (const name of [...internalNames, "impeccable", ...shortcuts]) {
  const kind = name === "impeccable" ? "upstream" : shortcuts.includes(name) ? "shortcuts" : "internal";
  const directory = `artifacts/${version}/skills/${kind}/${name}`;
  let skill = catalog.skills.find((/** @type {{logicalName: string}} */ item) => item.logicalName === name);
  if (!skill) {
    skill = { logicalName: name, physicalHarnesses: ["codex"], variants: [{ id: `${name}.codex`, harness: "codex", sourceDirectory: directory, destination: `.agents/skills/${name}`, expectedMirrorOf: null }] };
    catalog.skills.push(skill);
  }
  const provenance = name === "impeccable" || shortcuts.includes(name)
    ? { repository: "https://github.com/pbakaus/impeccable", commit: "73a6f51a540bc3938a2c40677d074c70b81fa5a0", version: "4.3.0", path: "universal.zip/.agents/skills/impeccable", license: "Apache-2.0" }
    : skill.source?.upstreamReference;
  skill.source = { repository: "https://github.com/AO-HyS/development-system", commit: "$INSTALL_COMMIT", path: directory, ...(provenance ? { upstreamReference: provenance } : {}) };
  if (name === "pstack-engineering") skill.source.inspiration = { repository: "https://github.com/cursor/plugins", commit: "df3fb154fb982fb83f649de8646d4af6a0cb16b3", path: "pstack", version: "0.15.0", license: "MIT" };
  for (const variant of skill.variants) {
    variant.sourceDirectory = directory;
    variant.folderSha256 = await folderHash(directory);
    if (name === "impeccable") variant.executableFiles = ["scripts/impeccable"];
  }
}
await writeFile(resolve(root, `catalog/${catalogVersion}.json`), JSON.stringify(catalog, null, 2) + "\n");
await mkdir(resolve(root, `config/${version}`), { recursive: true });
await writeFile(resolve(root, `config/${version}/agent-roster.json`), await readFile(resolve(root, "config/agent-roster.json")));
await writeFile(resolve(root, `artifacts/${version}/model-routing.md`), await readFile(resolve(root, "docs/model-routing.md")));
const manifest = await read("manifests/1.10.0.json");
manifest.contractVersion = version;
/** @type {Record<string, string>} */
const replacements = { "development-contract": `artifacts/${version}/contract.md`, "model-routing": `artifacts/${version}/model-routing.md`, "agent-roster": `config/${version}/agent-roster.json`, "skill-catalog": `catalog/${catalogVersion}.json`, "codex-agent-visual-reviewer": `artifacts/${version}/agents/codex/visual-reviewer.toml` };
for (const artifact of manifest.artifacts) {
  if (replacements[artifact.logicalName]) artifact.sourcePath = replacements[artifact.logicalName];
  artifact.sha256 = hash(await readFile(resolve(root, artifact.sourcePath)));
}
const agentSource = `artifacts/${version}/agents/codex/evidence-preparer.toml`;
manifest.artifacts.push({ id: "codex-agent-evidence-preparer.codex", logicalName: "codex-agent-evidence-preparer", sourcePath: agentSource, destination: ".codex/agents/evidence-preparer.toml", harness: "codex", sha256: hash(await readFile(resolve(root, agentSource))), expectedMirrorOf: null });
await writeFile(resolve(root, `manifests/${version}.json`), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify({ version, catalogVersion, skills: catalog.skills.length, artifacts: manifest.artifacts.length }) + "\n");
