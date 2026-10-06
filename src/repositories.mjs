// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, readlink, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { hasBehaviorSignature, isIdenticalCatalogMirror } from "./skills.mjs";
import {
  antiSlopDiagnosticOnlyMetrics,
  antiSlopExcludedMetrics,
  antiSlopFactoryCoverage,
  antiSlopPhases,
} from "./anti-slop.mjs";

const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const contractVersion = packageMetadata.contractVersion ?? packageMetadata.version;
const currentManifest = JSON.parse(await readFile(new URL(`../manifests/${contractVersion}.json`, import.meta.url), "utf8"));
const catalogArtifact = currentManifest.artifacts.find((/** @type {{logicalName:string, sourcePath:string}} */ artifact) => artifact.logicalName === "skill-catalog");
if (!catalogArtifact) throw new Error(`Contract ${contractVersion} has no skill catalog`);
const currentCatalog = JSON.parse(await readFile(new URL(`../${catalogArtifact.sourcePath}`, import.meta.url), "utf8"));
const skillCatalogVersion = currentCatalog.catalogVersion;
/** Catalog skill destinations mapped to the recorded folder hash of their catalog original. @type {Map<string, string>} */
const catalogSkillFolders = new Map(currentCatalog.skills.flatMap((/** @type {{variants: Array<{destination: string, folderSha256?: string}>}} */ skill) =>
  skill.variants.flatMap((variant) => (variant.folderSha256 ? [[variant.destination, variant.folderSha256]] : []))));
const antiSlopUpstream = Object.freeze({
  catalogSkill: "install-anti-slop",
  repository: "https://github.com/dmmulroy/anti-slop",
  commit: "e8c4880471b23ab7f216fba7b27d173a6ef07d4c",
  treeSha256: "c309c21257eea4c681cb2388e1939c6f03d98af17885ff14e3b38efaf01f6a55",
  license: "MIT",
});
const ignoredDirectories = new Map([
  [".git", "source-control-metadata"],
  ["node_modules", "dependency-cache"],
  [".next", "generated-output"],
  [".nuxt", "generated-output"],
  [".output", "generated-output"],
  ["dist", "generated-output"],
  ["build", "generated-output"],
  ["out", "generated-output"],
  ["coverage", "generated-output"],
  [".turbo", "build-cache"],
  [".cache", "build-cache"],
  [".parcel-cache", "build-cache"],
  [".vite", "build-cache"],
  [".nx", "build-cache"],
  [".gradle", "build-cache"],
  ["DerivedData", "build-cache"],
  ["tmp", "temporary-output"],
  ["temp", "temporary-output"],
]);
const maximumFingerprintFileBytes = 1024 * 1024;
const fingerprintSampleBytes = 64 * 1024;
const fingerprintSampleCount = maximumFingerprintFileBytes / fingerprintSampleBytes;
const maximumGovernedTextBytes = 1024 * 1024;
const instructionNames = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules"]);
const foreignProductMarkers = ["NutriPlan", "The Barber Central", "Casa Roca", "ETERIA", "AOHYS", "Escuela 360", "Impeccable"];
const managedFiles = [
  ".development-system/repository.json",
  ".codex/development-system/repository.md",
];
const retiredManagedFiles = [".factory/development-system/repository.md"];
const productArchitectureDimensions = Object.freeze([
  "repository-map",
  "module-boundaries",
  "dependency-direction",
  "file-placement",
  "frontend-composition",
  "component-design",
  "backend-contracts",
  "type-contracts",
  "testing-strategy",
  "documentation",
  "performance-security",
  "observability",
  "migration-sequencing",
]);
const developmentSystemManagedCapabilities = Object.freeze([
  "agent-guardrails",
  "anti-slop-policy",
  "release-train",
]);
/** @type {Array<"review" | "changedValidation" | "certification" | "qa" | "preview">} */
const structuralCapabilities = ["review", "changedValidation", "certification", "qa", "preview"];
const providerReadinessSurfaces = ["auth", "data", "migration", "seeds", "roles", "provider-config", "environment"];

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string | Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * @param {string} root
 * @param {string} current
 * @param {Array<{path:string,reason:string}>} excluded
 * @returns {Promise<string[]>}
 */
async function listFiles(root, current = root, excluded = []) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = resolve(current, entry.name);
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      excluded.push({
        path: normalizedPath(relative(root, target)),
        reason: /** @type {string} */ (ignoredDirectories.get(entry.name)),
      });
      continue;
    }
    if (entry.isSymbolicLink()) {
      files.push(relative(root, target));
      continue;
    }
    if (entry.isDirectory()) files.push(...await listFiles(root, target, excluded));
    else if (entry.isFile()) files.push(relative(root, target));
  }
  return files.sort();
}

/** @param {string} path */
function normalizedPath(path) {
  return path.split(sep).join("/");
}

/** @param {string} root @param {string} path */
async function readableText(root, path) {
  try {
    const target = resolve(root, path);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || metadata.size > maximumGovernedTextBytes) return "";
    const contents = await readFile(target);
    if (contents.includes(0)) return "";
    return contents.toString("utf8");
  } catch (error) {
    if (isMissing(error)) return "";
    throw error;
  }
}

/**
 * @param {import("node:crypto").Hash} hash
 * @param {string} target
 * @param {number} size
 * @returns {Promise<number>}
 */
async function updateFingerprintWithFile(hash, target, size) {
  if (size <= maximumFingerprintFileBytes) {
    hash.update(await readFile(target));
    return size;
  }
  const handle = await open(target, "r");
  try {
    const sampleLength = Math.min(fingerprintSampleBytes, size);
    const maximumOffset = Math.max(0, size - sampleLength);
    const positions = [...new Set(Array.from({ length: fingerprintSampleCount }, (_, index) =>
      Math.floor((maximumOffset * index) / (fingerprintSampleCount - 1))
    ))];
    hash.update(`distributed-bounded:${size}:${positions.length}:`);
    let bytesRead = 0;
    for (const position of positions) {
      const sample = Buffer.alloc(sampleLength);
      const result = await handle.read(sample, 0, sampleLength, position);
      hash.update(`sample:${position}:${result.bytesRead}:`);
      hash.update(sample.subarray(0, result.bytesRead));
      hash.update("\0");
      bytesRead += result.bytesRead;
    }
    return bytesRead;
  } finally {
    await handle.close();
  }
}

/** @param {string} repository */
async function inspectRepositoryFingerprint(repository) {
  const root = resolve(repository);
  /** @type {Array<{path:string,reason:string}>} */
  const excluded = [];
  const files = (await listFiles(root, root, excluded)).map(normalizedPath);
  const hash = createHash("sha256");
  /** @type {Array<{path:string,size:number,bytesRead:number}>} */
  const boundedFiles = [];
  let maximumFileBytesRead = 0;
  for (const path of files) {
    hash.update(path);
    hash.update("\0");
    const target = resolve(root, path);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      hash.update(`symlink:${await readlink(target)}`);
    } else {
      const bytesRead = await updateFingerprintWithFile(hash, target, metadata.size);
      maximumFileBytesRead = Math.max(maximumFileBytesRead, bytesRead);
      if (metadata.size > maximumFingerprintFileBytes) {
        boundedFiles.push({ path, size: metadata.size, bytesRead });
      }
    }
    hash.update("\0");
  }
  return {
    value: hash.digest("hex"),
    files,
    evidence: {
      policy: "source-v2-distributed-bounded",
      excluded: excluded.sort((left, right) => left.path.localeCompare(right.path)),
      boundedFiles,
      maximumFileBytesRead,
      perFileLimitBytes: maximumFingerprintFileBytes,
      sampleBytes: fingerprintSampleBytes,
      sampleCount: fingerprintSampleCount,
    },
  };
}

/** @param {string} repository */
export async function fingerprintRepository(repository) {
  return (await inspectRepositoryFingerprint(repository)).value;
}

/** @param {string} path */
function instructionPath(path) {
  return instructionNames.has(basename(path)) ||
    factoryCommandPath(path) ||
    path === ".codex/development-system/repository.md" ||
    path === ".factory/development-system/repository.md";
}

/** @param {string} path */
function factoryCommandPath(path) {
  return /(^|\/)\.factory\/commands\/[^/]+\.md$/i.test(path);
}

/** @param {string} path */
function instructionScope(path) {
  if (!factoryCommandPath(path)) return dirname(path) === "." ? "." : dirname(path);
  const marker = path.indexOf(".factory/commands/");
  const scope = path.slice(0, marker).replace(/\/$/, "");
  return scope || ".";
}

/** @param {string} path */
function skillPath(path) {
  return basename(path) === "SKILL.md" && path.split("/").includes("skills");
}

/** @param {string} path */
function agentPath(path) {
  return path.startsWith(".codex/agents/") || path.startsWith(".agents/agents/");
}

/** @param {string} path */
function droidPath(path) {
  return path.startsWith(".factory/droids/");
}

/** @param {string} path */
function hookPath(path) {
  return path.startsWith(".husky/") || path.startsWith(".githooks/") ||
    path.startsWith(".codex/hooks/") || path.startsWith(".factory/hooks/");
}

/** @param {string} path */
function structurallyDiscovered(path) {
  if (skillPath(path)) {
    return path.startsWith(".agents/skills/") || path.startsWith(".codex/skills/") ||
      path.startsWith(".factory/skills/");
  }
  if (instructionPath(path)) return instructionNames.has(basename(path)) || factoryCommandPath(path);
  return agentPath(path) || droidPath(path) || hookPath(path);
}

/** @param {string} path @param {"codex" | "t3code" | "factory"} harness */
function discoveredForHarness(path, harness) {
  if (skillPath(path)) {
    if (harness === "factory") return path.startsWith(".factory/skills/");
    return path.startsWith(".agents/skills/") || path.startsWith(".codex/skills/");
  }
  if (agentPath(path)) return harness !== "factory";
  if (droidPath(path)) return harness === "factory";
  if (factoryCommandPath(path)) return harness === "factory";
  if (path.startsWith(".factory/hooks/")) return harness === "factory";
  if (path.startsWith(".codex/hooks/")) return harness !== "factory";
  return structurallyDiscovered(path);
}

/** @param {string} path @param {string} contents */
function structurallyLoadable(path, contents) {
  if (!structurallyDiscovered(path)) return false;
  if (!skillPath(path)) return true;
  return /^---\s*[\s\S]*?\bname\s*:\s*[^\n]+[\s\S]*?---/m.test(contents);
}

/** @param {string} path @param {string} contents @param {any} evidence */
function inventoryEntry(path, contents, evidence) {
  /** @type {Record<string, any>} */
  const operationalByHarness = {};
  for (const harness of /** @type {const} */ (["codex", "t3code", "factory"])) {
    const observation = Array.isArray(evidence?.observations)
      ? /** @type {any[]} */ (evidence.observations).find((entry) => entry && entry.path === path && entry.harness === harness)
      : undefined;
    const discovered = observation?.discovered === true || discoveredForHarness(path, harness);
    operationalByHarness[harness] = {
      exists: true,
      discovered,
      catalogued: observation?.catalogued === true,
      loadable: observation?.loadable === true || (discovered && structurallyLoadable(path, contents)),
      loaded: observation?.loaded === true,
      influenced: observation?.influenced === true,
    };
  }
  const states = Object.fromEntries(
    ["exists", "discovered", "catalogued", "loadable", "loaded", "influenced"].map((state) => [
      state,
      Object.values(operationalByHarness).some((entry) => entry[state] === true),
    ]),
  );
  return {
    path,
    ...(skillPath(path) ? { logicalName: skillLogicalName(path, contents) } : {}),
    states,
    operationalByHarness,
  };
}

/** @param {string} path @param {string} contents */
function skillLogicalName(path, contents) {
  const frontmatter = contents.match(/^---\s*([\s\S]*?)---/m)?.[1] ?? "";
  const declared = frontmatter.match(/^name\s*:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  return declared || basename(dirname(path));
}

/** @param {Record<string, string>} scripts @param {string[]} candidates @param {string} runner @param {(command:string) => boolean} [accept] */
function selectCommand(scripts, candidates, runner, accept = () => true) {
  const script = candidates.find((candidate) =>
    typeof scripts[candidate] === "string" && !isTestScript(candidate, scripts) && accept(scripts[candidate])
  );
  return script ? { script, command: `${runner} run ${script}` } : null;
}

// Mirrors the test-script finding of src/no-tests.mjs: repository guidance never
// names a script that runs automated tests.
const testRunnerCommand = /\b(?:vitest|jest|mocha|ava|cypress\s+run|playwright\s+test|node\s+--test|pytest|karma\s+start)\b/;

/**
 * True when the script is a test script or reaches one through the scripts it runs.
 * @param {string} name @param {Record<string, string>} scripts @param {Set<string>} [seen]
 * @returns {boolean}
 */
function isTestScript(name, scripts, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);
  const command = typeof scripts[name] === "string" ? scripts[name] : "";
  if (name === "test" || name.startsWith("test:") || testRunnerCommand.test(command)) return true;
  if (referencedScripts(command).some((script) =>
    script === "test" || script.startsWith("test:") || (script in scripts && isTestScript(script, scripts, seen))
  )) return true;
  // npm-style runners execute pre<name> and post<name> implicitly.
  return [`pre${name}`, `post${name}`].some((lifecycle) =>
    typeof scripts[lifecycle] === "string" && isTestScript(lifecycle, scripts, seen)
  );
}

// Package-manager options that consume the following token as their value.
const valueOptions = new Set(["--filter", "-F", "--dir", "-C", "--prefix", "--cwd", "--workspace", "--reporter", "--loglevel"]);

/**
 * Script names a command runs through a package manager or turbo, after skipping
 * their options, `run`/`run-script` and yarn `workspace <name>`.
 * @param {string} command @returns {string[]}
 */
function referencedScripts(command) {
  /** @type {string[]} */
  const names = [];
  for (const segment of command.split(/&&|\|\||[;|&]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let index = tokens.findIndex((token) => /^(?:pnpm|npm|yarn|bun|turbo|npx|pnpx|bunx)$/.test(token));
    if (index < 0) continue;
    let manager = "";
    const skipOptions = () => {
      while (index < tokens.length && tokens[index].startsWith("-")) {
        const option = tokens[index].split("=")[0];
        const takesValue = !tokens[index].includes("=") &&
          (valueOptions.has(option) || (manager === "npm" && option === "-w"));
        index += takesValue ? 2 : 1;
      }
    };
    // Executors (npx, pnpx, bunx, `<manager> exec|dlx|x`) run the inner command.
    const skipExecutor = () => { index += 1; skipOptions(); if (tokens[index] === "--") index += 1; };
    while (index < tokens.length) {
      const token = tokens[index];
      if (/^(?:npx|pnpx|bunx)$/.test(token)) { manager = token; skipExecutor(); continue; }
      if (!/^(?:pnpm|npm|yarn|bun|turbo)$/.test(token)) { manager = ""; break; }
      manager = token;
      index += 1;
      skipOptions();
      if (manager !== "turbo" && /^(?:exec|dlx|x)$/.test(tokens[index] ?? "")) { skipExecutor(); continue; }
      break;
    }
    if (!manager || /^(?:npx|pnpx|bunx)$/.test(manager)) continue;
    if (manager === "yarn" && tokens[index] === "workspace") { index += 2; skipOptions(); }
    if (tokens[index] === "run" || tokens[index] === "run-script") { index += 1; skipOptions(); }
    if (manager === "turbo") {
      // turbo runs every task named on the command line.
      while (index < tokens.length && tokens[index] !== "--") {
        const token = tokens[index];
        if (token.startsWith("-")) {
          const takesValue = !token.includes("=") && valueOptions.has(token.split("=")[0]);
          index += takesValue ? 2 : 1;
          continue;
        }
        // `<package>#<task>` and `//#<task>` name the task after the last `#`.
        const task = token.includes("#") ? token.slice(token.lastIndexOf("#") + 1) : token;
        if (/^[\w:.-]+$/.test(task)) names.push(task);
        index += 1;
      }
      continue;
    }
    const script = tokens[index];
    if (script && /^[\w:.-]+$/.test(script)) names.push(script);
  }
  return names;
}

/** @param {string} command */
function readOnlyPreviewCommand(command) {
  const withoutSafeReleaseContexts = command
    .replace(/\b(?:build|compile|bundle)(?::|-)?release\b/gi, "")
    .replace(
      /\bwrangler\s+pages\s+dev\s+(?:\.\/)?dist\/release(?=\s|$)/gi,
      (value) => value.replace(/release/i, ""),
    );
  return !/\b(?:deploy|publish|release|production|promote)\b/i.test(
    withoutSafeReleaseContexts,
  );
}

/** @param {any} packageJson @param {string[]} files */
function packageRunner(packageJson, files) {
  const declared = typeof packageJson?.packageManager === "string"
    ? packageJson.packageManager.split("@")[0]
    : "";
  if (["pnpm", "npm", "yarn", "bun"].includes(declared)) return declared;
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun";
  return "npm";
}

/** @param {any} packageJson @param {string[]} files */
function detectStack(packageJson, files) {
  const dependencies = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  /** @type {string[]} */
  const stack = [];
  if ("react" in dependencies || files.some((path) => /(?:^|\/)vite\.config\.|(?:^|\/)next\.config\./.test(path))) {
    stack.push("react");
  }
  if ("convex" in dependencies || files.some((path) => /(?:^|\/)convex\//.test(path))) stack.push("convex");
  return stack;
}

/** @param {string} path */
function releasePolicyPath(path) {
  return /(^|\/)(RELEASE(?:\.md)?|CHANGELOG\.md)$/i.test(path) ||
    /^\.github\/workflows\/[^/]*release[^/]*\.ya?ml$/i.test(path);
}

/** @param {string} path */
function designPath(path) {
  return /(^|\/)(?:[^/]*(?:theme|tokens|tailwind|design-system|styles?)[^/]*)\.(?:css|scss|sass|less|js|mjs|cjs|ts|tsx|json)$/i.test(path);
}

/** @param {string} repository @param {string[]} files */
async function repositoryIdentity(repository, files) {
  let packageJson = /** @type {any} */ ({});
  if (files.includes("package.json")) {
    try {
      packageJson = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8"));
    } catch {
      packageJson = {};
    }
  }
  const scripts = packageJson.scripts && typeof packageJson.scripts === "object"
    ? /** @type {Record<string, string>} */ (packageJson.scripts)
    : {};
  const runner = packageRunner(packageJson, files);
  return {
    name: typeof packageJson.name === "string" && packageJson.name ? packageJson.name : basename(repository),
    packageJson,
    packageManager: runner,
    stack: detectStack(packageJson, files),
    commands: {
      review: selectCommand(scripts, ["review", "review:ci", "lint", "check"], runner),
      changedValidation: selectCommand(
        scripts,
        ["quality:changed", "verify:changed", "validate"],
        runner,
      ),
      certification: selectCommand(
        scripts,
        ["quality:certify", "verify:ci", "verify", "validate"],
        runner,
      ),
      providerReadiness: selectCommand(
        scripts,
        ["quality:provider-readiness", "release:env:preview"],
        runner,
      ),
      validation: selectCommand(scripts, ["validate", "verify:changed", "verify:ci", "verify", "check"], runner),
      qa: selectCommand(scripts, ["qa", "e2e"], runner),
      preview: selectCommand(
        scripts,
        ["preview", "preview:local", "cloudflare:local", "dev", "start"],
        runner,
        readOnlyPreviewCommand,
      ),
    },
    releasePolicyFiles: files.filter(releasePolicyPath),
    designFiles: files.filter(designPath),
  };
}

/** @param {string} identityName */
function ownMarker(identityName) {
  const normalized = identityName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.length < 4) return undefined;
  return foreignProductMarkers.find((marker) => {
    const candidate = marker.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized.includes(candidate) || candidate.includes(normalized);
  });
}

/** @param {string} repository @param {Array<{path:string}>} entries @param {string} identityName */
async function detectResidue(repository, entries, identityName) {
  const owned = ownMarker(identityName);
  /** @type {Array<{path:string, marker:string}>} */
  const residue = [];
  /** @type {Array<{path:string, marker:string, reason:string}>} */
  const allowedReferences = [];
  /** @type {Map<string, boolean>} */
  const identicalMirrors = new Map();
  for (const entry of entries) {
    // A declared catalog skill copied byte-identically carries the catalog's own product examples;
    // it is not repository residue. A copy that drifted from the catalog is still scanned.
    const mirror = [...catalogSkillFolders].find(([destination]) => entry.path.startsWith(`${destination}/`));
    if (mirror) {
      const [destination, folderSha256] = mirror;
      if (!identicalMirrors.has(destination)) {
        identicalMirrors.set(destination, await isIdenticalCatalogMirror(resolve(repository, destination), folderSha256));
      }
      if (identicalMirrors.get(destination)) continue;
    }
    const contents = await readableText(repository, entry.path);
    for (const marker of foreignProductMarkers) {
      if (marker === owned) continue;
      const matchingLines = contents.split("\n").filter((line) =>
        line.toLowerCase().includes(marker.toLowerCase())
      );
      if (matchingLines.length === 0) continue;
      const reasons = matchingLines.map((line) => allowedReferenceReason(line, marker));
      if (reasons.every(Boolean)) {
        allowedReferences.push({
          path: entry.path,
          marker,
          reason: /** @type {string} */ (reasons.find((reason) => reason !== "explicit-preservation-rule") ?? reasons[0]),
        });
      } else {
        residue.push({ path: entry.path, marker });
      }
    }
  }
  return { residue, allowedReferences };
}

/** @param {string} line @param {string} marker */
function allowedReferenceReason(line, marker) {
  const explicitExclusion = /\b(?:(?:do not|does not|don't|must not|never) (?:use|inherit|copy|adopt|apply|import)|without (?:using|inheriting|copying|adopting|applying|importing)|no (?:usar|usa|heredar|hereda|copiar|copia|adoptar|adopta|aplicar|aplica)|no deben? quedar (?:referencias )?(?:operativas )?heredad\w*|sin (?:usar|heredar|copiar|adoptar|aplicar)|prohibid[oa]s?|fuera de alcance)\b/i;
  if (explicitExclusion.test(line)) return "explicit-exclusion-rule";

  const externalCoordination = /\b(?:linear|issue tracker|tracker|workspace)\b|\b(?:track|link|coordinate|reference|report|manage|plan|assign|record|gestionar|coordinar|registrar|asignar)\w*\b.*\b(?:team|equipo|project|proyecto|organization|organizaci[oó]n)\b/i;
  if (externalCoordination.test(line)) return "external-coordination-reference";

  if (marker !== "Impeccable") return undefined;

  const globalTemplate = /\b(?:global template|plantilla global|all (?:products|repositories|repos)|every (?:product|repository|repo)|todos? los (?:productos|repositorios|repos)|copy (?:its|the) rules|copiar (?:sus|las) reglas)\b/i;
  if (globalTemplate.test(line)) return undefined;

  const preservation = /\b(?:preserve(?:d|s|ing)?|keep|retain(?:ed|s|ing)?|left intact|leave intact|do not (?:change|replace|modify)|must not (?:change|replace|modify)|separate visual|existing (?:visual|mobile|configuration))\b/i;
  if (preservation.test(line)) return "explicit-preservation-rule";
  return "product-scoped-impeccable-integration";
}

/** @param {any} commands @param {Array<{logicalName:string,states:{discovered:boolean}}>} skills @param {Array<unknown>} residue */
function readinessGaps(commands, skills, residue) {
  /** @type {string[]} */
  const gaps = [];
  for (const capability of structuralCapabilities) {
    if (!commands[capability]) gaps.push(`missing-${capability}-command`);
  }
  if (residue.length > 0) gaps.push("foreign-product-residue");
  const discoveredSkillNames = new Set(
    skills.filter((skill) => skill.states.discovered).map((skill) => skill.logicalName),
  );
  if (skills.some((skill) => !skill.states.discovered && !discoveredSkillNames.has(skill.logicalName))) {
    gaps.push("inert-skill-installation");
  }
  return gaps;
}

/**
 * Audit one product repository without writing to it.
 * @param {{repository:string, evidence?:any, verifyObservation?:(context:{repository:string, observation:any})=>Promise<any>}} options
 */
export async function auditRepository(options) {
  const repository = resolve(options.repository);
  const metadata = await stat(repository);
  if (!metadata.isDirectory()) throw new Error(`Repository is not a directory: ${repository}`);
  const fingerprint = await inspectRepositoryFingerprint(repository);
  const files = fingerprint.files;
  const repositoryFingerprint = fingerprint.value;
  /** @type {string[]} */
  const warnings = [];
  let evidence = options.evidence;
  if (!evidence) {
    warnings.push("No operational evidence was supplied; loaded and influenced remain false.");
  } else if (evidence.schemaVersion !== 2 || !Array.isArray(evidence.observations)) {
    warnings.push("Operational evidence has an unsupported schema and was ignored.");
    evidence = undefined;
  } else if (resolve(evidence.repositoryRoot ?? "") !== repository) {
    warnings.push("Operational evidence targets a different repository and was ignored.");
    evidence = undefined;
  } else if (evidence.repositoryFingerprint !== repositoryFingerprint) {
    warnings.push("Operational evidence does not match the current repository fingerprint and was ignored.");
    evidence = undefined;
  } else if (!Number.isFinite(Date.parse(evidence.generatedAt ?? "")) ||
    Math.abs(Date.now() - Date.parse(evidence.generatedAt)) > 24 * 60 * 60 * 1000) {
    warnings.push("Operational evidence is stale or has an invalid timestamp and was ignored.");
    evidence = undefined;
  } else if (typeof options.verifyObservation !== "function") {
    warnings.push("External operational evidence is unattested; a live observation verifier is required before loaded or influenced can become true.");
    evidence = undefined;
  } else {
    /** @type {any[]} */
    const validObservations = [];
    for (const observation of /** @type {any[]} */ (evidence.observations)) {
      const states = ["discovered", "catalogued", "loadable", "loaded", "influenced"]
        .map((state) => observation?.[state] === true);
      const monotonic = states.every((state, index) => !state || states.slice(0, index).every(Boolean));
      const target = typeof observation?.path === "string" ? resolve(repository, observation.path) : repository;
      const relativeTarget = relative(repository, target);
      let pathHashMatches = false;
      try {
        const targetMetadata = await lstat(target);
        pathHashMatches = relativeTarget.length > 0 && relativeTarget !== ".." &&
          !relativeTarget.startsWith(`..${sep}`) && !targetMetadata.isSymbolicLink() &&
          targetMetadata.isFile() && targetMetadata.size <= maximumGovernedTextBytes &&
          observation.pathSha256 === sha256(await readFile(target));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      let verified = null;
      try {
        verified = await options.verifyObservation({
          repository,
          observation: {
            harness: observation?.harness,
            path: observation?.path,
            pathSha256: observation?.pathSha256,
          },
        });
      } catch (error) {
        warnings.push(`Live operational verification failed for ${String(observation?.path ?? "unknown")}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const verifiedStates = ["discovered", "catalogued", "loadable", "loaded", "influenced"]
        .map((state) => verified?.[state] === true);
      const verifiedMonotonic = verifiedStates.every((state, index) =>
        !state || verifiedStates.slice(0, index).every(Boolean)
      );
      const liveBound = verified?.harness === observation?.harness && verified?.path === observation?.path &&
        verified?.pathSha256 === observation?.pathSha256 && verified?.readOnly === true &&
        Array.isArray(verified?.command) && verified.command.length > 1 &&
        typeof verified.command[0] === "string" && verified.command.every((/** @type {unknown} */ part) => typeof part === "string") &&
        typeof verified?.executable === "string" && verified.executable === verified.command[0] &&
        typeof verified?.version === "string" && verified.version.length > 0 && verified?.exitCode === 0 &&
        Array.isArray(verified?.externalSideEffects) && verified.externalSideEffects.length === 0 &&
        typeof verified?.response === "string" && Array.isArray(verified?.behaviorSignature) &&
        verified.behaviorSignature.length > 0 && hasBehaviorSignature(verified.response, verified.behaviorSignature) &&
        verifiedMonotonic;
      if (!observation || !["codex", "t3code", "factory"].includes(observation.harness) ||
        typeof observation.path !== "string" || !monotonic || !liveBound || !pathHashMatches) {
        warnings.push(`Invalid operational observation was ignored: ${String(observation?.path ?? "unknown")}`);
        continue;
      }
      validObservations.push({
        harness: verified.harness,
        path: verified.path,
        pathSha256: verified.pathSha256,
        discovered: verified.discovered === true,
        catalogued: verified.catalogued === true,
        loadable: verified.loadable === true,
        loaded: verified.loaded === true,
        influenced: verified.influenced === true,
        readOnly: true,
        executable: verified.executable,
        command: [...verified.command],
        version: verified.version,
        exitCode: verified.exitCode,
        externalSideEffects: [],
        response: verified.response,
        behaviorSignature: [...verified.behaviorSignature],
      });
    }
    const postVerificationFingerprint = await inspectRepositoryFingerprint(repository);
    if (postVerificationFingerprint.value !== repositoryFingerprint) {
      warnings.push("Live operational verification changed the repository; all operational observations were ignored.");
      evidence = undefined;
    } else {
      evidence = { ...evidence, observations: validObservations };
    }
  }
  const identity = await repositoryIdentity(repository, files);
  const productName = identity.name;
  /** @type {Record<string, Array<any>>} */
  const inventory = { instructions: [], skills: [], agents: [], droids: [], hooks: [] };
  for (const path of files) {
    const contents = await readableText(repository, path);
    const entry = inventoryEntry(path, contents, evidence);
    if (instructionPath(path)) {
      const scope = instructionScope(path);
      inventory.instructions.push({
        ...entry,
        scope,
        precedence: scope === "." ? 0 : scope.split("/").length,
      });
    }
    if (skillPath(path)) inventory.skills.push(entry);
    if (agentPath(path)) inventory.agents.push(entry);
    if (droidPath(path)) inventory.droids.push(entry);
    if (hookPath(path)) inventory.hooks.push(entry);
  }
  inventory.instructions.sort((left, right) => left.precedence - right.precedence || left.path.localeCompare(right.path));
  const governedEntries = [
    ...inventory.instructions,
    ...inventory.skills,
    ...inventory.agents,
    ...inventory.droids,
    ...inventory.hooks,
  ];
  const residueResult = await detectResidue(repository, governedEntries, identity.name);
  const residue = residueResult.residue;
  const codexGaps = readinessGaps(identity.commands, inventory.skills, residue);
  const readiness = {
    codex: { status: codexGaps.length === 0 ? "prepared" : "needs-preparation", gaps: [...new Set(codexGaps)] },
    t3code: { status: codexGaps.length === 0 ? "prepared" : "needs-preparation", adapter: "codex", gaps: [...new Set(codexGaps)] },
  };
  return {
    ok: Object.values(readiness).every((entry) => entry.status === "prepared"),
    operation: "audit-repository",
    status: Object.values(readiness).every((entry) => entry.status === "prepared") ? "prepared" : "needs-preparation",
    repositoryRoot: repository,
    repositoryFingerprint,
    fingerprint: fingerprint.evidence,
    product: {
      name: productName,
      packageName: identity.name,
      packageManager: identity.packageManager,
    },
    stack: identity.stack,
    commands: identity.commands,
    preserved: {
      releasePolicyFiles: identity.releasePolicyFiles,
      designFiles: identity.designFiles,
    },
    inventory,
    precedence: inventory.instructions.map((entry) => ({ path: entry.path, scope: entry.scope, precedence: entry.precedence })),
    residue,
    allowedReferences: residueResult.allowedReferences,
    readiness,
    evidence: { accepted: Boolean(evidence), warnings, observations: evidence?.observations ?? [] },
    architectureDiagnostic: {
      id: "improve-codebase-architecture",
      mode: "manual",
      effect: "proposal-only",
      sequence: ["inspect", "propose-deepening", "request-refactor-authorization"],
    },
    externalSideEffects: [],
  };
}

/** Adapter generation is retired; repository context lives in task-relevant docs.
 * @param {{repository:string, confirm?:string}} _options
 */
export async function initializeRepository(_options) {
  throw new Error("initialize-repository is retired in Development System 2.0. Read the repository AGENTS.md, README and task-relevant docs; use the shared installation. No repository files were written.");
}

/** @param {{repository:string, confirm?:string}} _options */
export async function normalizeRepository(_options) {
  throw new Error("normalize-repository is retired in Development System 2.0. Remove legacy adapters only in a reviewed migration preserving product-specific documentation. No repository files were written.");
}

export const repositoryContractVersion = contractVersion;
// Compatibility inventory for bounded retirement, never an installation requirement.
export const repositoryManagedFiles = [...managedFiles];
