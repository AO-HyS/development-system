// @ts-check
// Build only this unpublished release. Published versions are never rewritten.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "1.6.0";
const catalogVersion = "0.27.0";
/** @param {string | Buffer} bytes */
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {string} path */
const read = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"], { cwd: root, stdio: "pipe" });
const destinationPaths = ["catalog/" + catalogVersion + ".json", "manifests/" + version + ".json", "config/" + version + "/agent-roster.json"];
for (const path of destinationPaths) {
  try {
    execFileSync("git", ["cat-file", "-e", "origin/main:" + path], { cwd: root, stdio: "pipe" });
  } catch { continue; }
  throw new Error("Refusing to rewrite published release path: " + path);
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
      else throw new Error("Unsupported skill source: " + path);
    }
  }
  const absolute = resolve(root, directory);
  await walk(absolute);
  const digest = createHash("sha256");
  for (const path of files.sort()) digest.update(relative(absolute, path)).update("\0").update(await readFile(path)).update("\0");
  return digest.digest("hex");
}
const catalog = await read("catalog/0.26.0.json");
catalog.catalogVersion = catalogVersion;
const internal = ["drive-development-flow", "coding-orchestration", "flow-implement", "flow-code-review", "parallel-work", "measure-development-run", "create-product-verification", "maintain-product-verification"];
for (const name of internal) {
  const skill = catalog.skills.find((/** @type {{logicalName: string}} */ skill) => skill.logicalName === name);
  if (!skill) throw new Error("Missing base skill: " + name);
  const directory = "artifacts/" + version + "/skills/internal/" + name;
  skill.source = { repository: "https://github.com/AO-HyS/development-system", commit: "$INSTALL_COMMIT", path: directory };
  for (const variant of skill.variants) {
    variant.sourceDirectory = directory;
    variant.folderSha256 = await folderHash(directory);
  }
}
const groups = [
  { repository: "jakubkrehel/skills", commit: "267330e1adfc66a718fb65fa6918c1f06d0a689e", license: "jakubkrehel-skills", names: ["better-accessibility", "better-colors", "better-interface", "better-layout", "better-typography", "better-ui", "better-writing", "break", "explain-interface", "interface-review", "variant"] },
  { repository: "jakubkrehel/make-interfaces-feel-better", commit: "35545ea1512ad59fa463e6b1f95ca9c052981fe6", license: "make-interfaces-feel-better", names: ["make-interfaces-feel-better"] },
  { repository: "humanlayer/skills", commit: "3c2629142c5d437428269b1b722b08c0b87f574d", license: "show-me", names: ["show-me"] },
  { repository: "coldteadotai/pr-lens", commit: "d3a72e50895c58e62b2a7a5ef7cc588f7700657c", license: "pr-lens", names: ["pr-lens"] },
];
const adapted = new Set(["better-interface", "make-interfaces-feel-better", "pr-lens"]);
for (const group of groups) {
  for (const name of group.names) {
    const upstreamDirectory = "artifacts/" + version + "/skills/upstream/" + name;
    const directory = adapted.has(name) ? "artifacts/" + version + "/skills/internal/" + name : upstreamDirectory;
    const upstream = {
      repository: "https://github.com/" + group.repository, commit: group.commit,
      path: name === "show-me" ? "plugins/show-me/skills/show-me" : "skills/" + name,
      license: "MIT",
      licenseSha256: hash(await readFile(resolve(root, "artifacts/" + version + "/licenses/" + group.license + ".txt"))),
      treeSha256: await folderHash(upstreamDirectory),
    };
    catalog.skills.push({
      logicalName: name, physicalHarnesses: ["codex"],
      source: adapted.has(name) ? { repository: "https://github.com/AO-HyS/development-system", commit: "$INSTALL_COMMIT", path: directory, upstreamReference: upstream } : upstream,
      variants: [{ id: name + ".codex", harness: "codex", sourceDirectory: directory, destination: ".agents/skills/" + name, folderSha256: await folderHash(directory), expectedMirrorOf: null }],
    });
  }
}
await writeFile(resolve(root, "catalog/" + catalogVersion + ".json"), JSON.stringify(catalog, null, 2) + "\n");
await mkdir(resolve(root, "config/" + version), { recursive: true });
await writeFile(resolve(root, "config/" + version + "/agent-roster.json"), await readFile(resolve(root, "config/agent-roster.json")));
const manifest = await read("manifests/1.5.19.json");
manifest.contractVersion = version;
/** @type {Record<string, string>} */
const replacements = {
  "development-contract": "artifacts/" + version + "/contract.md",
  "model-routing": "artifacts/" + version + "/model-routing.md",
  "agent-roster": "config/" + version + "/agent-roster.json",
  "skill-catalog": "catalog/" + catalogVersion + ".json",
};
for (const artifact of manifest.artifacts) {
  if (artifact.id.startsWith("codex-agent.")) artifact.sourcePath = "artifacts/" + version + "/agents/codex/" + artifact.id.split(".")[1] + ".toml";
  else if (replacements[artifact.logicalName]) artifact.sourcePath = replacements[artifact.logicalName];
  artifact.sha256 = hash(await readFile(resolve(root, artifact.sourcePath)));
}
await writeFile(resolve(root, "manifests/" + version + ".json"), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify({ version, catalogVersion, skills: catalog.skills.length, artifacts: manifest.artifacts.length }) + "\n");
