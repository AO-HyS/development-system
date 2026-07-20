// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, readlink, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

const contractVersion = "0.5.0";
const ignoredDirectories = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
const instructionNames = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules"]);
const foreignProductMarkers = ["NutriPlan", "The Barber Central", "AOHYS", "Escuela 360", "Impeccable"];
const managedFiles = [
  ".development-system/repository.json",
  ".codex/development-system/repository.md",
  ".factory/development-system/repository.md",
];

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string | Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} root @param {string} current @returns {Promise<string[]>} */
async function listFiles(root, current = root) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = resolve(current, entry.name);
    if (entry.isSymbolicLink()) {
      files.push(relative(root, target));
      continue;
    }
    if (entry.isDirectory()) files.push(...await listFiles(root, target));
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
    if ((await lstat(target)).isSymbolicLink()) return "";
    const contents = await readFile(target);
    if (contents.includes(0)) return "";
    return contents.toString("utf8");
  } catch (error) {
    if (isMissing(error)) return "";
    throw error;
  }
}

/** @param {string} repository */
export async function fingerprintRepository(repository) {
  const root = resolve(repository);
  const hash = createHash("sha256");
  for (const rawPath of await listFiles(root)) {
    const path = normalizedPath(rawPath);
    hash.update(path);
    hash.update("\0");
    const target = resolve(root, rawPath);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) hash.update(`symlink:${await readlink(target)}`);
    else hash.update(await readFile(target));
    hash.update("\0");
  }
  return hash.digest("hex");
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
    states,
    operationalByHarness,
  };
}

/** @param {Record<string, string>} scripts @param {string[]} candidates @param {string} runner */
function selectCommand(scripts, candidates, runner) {
  const script = candidates.find((candidate) => typeof scripts[candidate] === "string");
  return script ? { script, command: `${runner} run ${script}` } : null;
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
  if ("convex" in dependencies || files.some((path) => path.startsWith("convex/"))) stack.push("convex");
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
      validation: selectCommand(scripts, ["validate", "verify", "check", "test"], runner),
      qa: selectCommand(scripts, ["qa", "test:e2e", "e2e", "test"], runner),
      preview: selectCommand(scripts, ["preview", "preview:local", "dev", "start"], runner),
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
  for (const entry of entries) {
    const contents = await readableText(repository, entry.path);
    for (const marker of foreignProductMarkers) {
      if (marker === owned) continue;
      if (contents.toLowerCase().includes(marker.toLowerCase())) residue.push({ path: entry.path, marker });
    }
  }
  return residue;
}

/** @param {any} commands @param {Array<{states:{discovered:boolean}}>} skills @param {Array<unknown>} residue @param {boolean} managed */
function readinessGaps(commands, skills, residue, managed) {
  /** @type {string[]} */
  const gaps = [];
  for (const capability of ["review", "validation", "qa", "preview"]) {
    if (!commands[capability]) gaps.push(`missing-${capability}-command`);
  }
  if (residue.length > 0) gaps.push("foreign-product-residue");
  if (skills.some((skill) => !skill.states.discovered)) gaps.push("inert-skill-installation");
  if (!managed) gaps.push("development-system-adapter-not-installed");
  return gaps;
}

/**
 * Audit one product repository without writing to it.
 * @param {{repository:string, evidence?:any}} options
 */
export async function auditRepository(options) {
  const repository = resolve(options.repository);
  const metadata = await stat(repository);
  if (!metadata.isDirectory()) throw new Error(`Repository is not a directory: ${repository}`);
  const files = (await listFiles(repository)).map(normalizedPath);
  const repositoryFingerprint = await fingerprintRepository(repository);
  /** @type {string[]} */
  const warnings = [];
  let evidence = options.evidence;
  if (!evidence) {
    warnings.push("No operational evidence was supplied; loaded and influenced remain false.");
  } else if (evidence.schemaVersion !== 1 || !Array.isArray(evidence.observations)) {
    warnings.push("Operational evidence has an unsupported schema and was ignored.");
    evidence = undefined;
  } else if (evidence.repositoryFingerprint !== repositoryFingerprint) {
    warnings.push("Operational evidence does not match the current repository fingerprint and was ignored.");
    evidence = undefined;
  } else {
    /** @type {any[]} */
    const validObservations = [];
    for (const observation of /** @type {any[]} */ (evidence.observations)) {
      const states = ["discovered", "catalogued", "loadable", "loaded", "influenced"]
        .map((state) => observation?.[state] === true);
      const monotonic = states.every((state, index) => !state || states.slice(0, index).every(Boolean));
      if (!observation || !["codex", "t3code", "factory"].includes(observation.harness) ||
        typeof observation.path !== "string" || !monotonic) {
        warnings.push(`Invalid operational observation was ignored: ${String(observation?.path ?? "unknown")}`);
        continue;
      }
      validObservations.push(observation);
    }
    evidence = { ...evidence, observations: validObservations };
  }
  const identity = await repositoryIdentity(repository, files);
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
  const residue = await detectResidue(repository, governedEntries, identity.name);
  const managed = managedFiles.every((path) => files.includes(path));
  const baseGaps = readinessGaps(identity.commands, inventory.skills, residue, managed);
  const codexGaps = [...baseGaps];
  const factoryGaps = [...baseGaps];
  if (!files.includes(".codex/development-system/repository.md")) codexGaps.push("missing-codex-equivalent");
  if (!files.includes(".factory/development-system/repository.md")) factoryGaps.push("missing-factory-equivalent");
  const readiness = {
    codex: { status: codexGaps.length === 0 ? "prepared" : "needs-preparation", gaps: [...new Set(codexGaps)] },
    t3code: { status: codexGaps.length === 0 ? "prepared" : "needs-preparation", adapter: "codex", gaps: [...new Set(codexGaps)] },
    factory: { status: factoryGaps.length === 0 ? "prepared" : "needs-preparation", gaps: [...new Set(factoryGaps)] },
  };
  return {
    ok: Object.values(readiness).every((entry) => entry.status === "prepared"),
    operation: "audit-repository",
    status: Object.values(readiness).every((entry) => entry.status === "prepared") ? "prepared" : "needs-preparation",
    repositoryRoot: repository,
    repositoryFingerprint,
    product: { name: identity.name, packageManager: identity.packageManager },
    stack: identity.stack,
    commands: identity.commands,
    preserved: {
      releasePolicyFiles: identity.releasePolicyFiles,
      designFiles: identity.designFiles,
    },
    inventory,
    precedence: inventory.instructions.map((entry) => ({ path: entry.path, scope: entry.scope, precedence: entry.precedence })),
    residue,
    readiness,
    evidence: { accepted: Boolean(evidence), warnings },
    architectureDiagnostic: {
      id: "improve-codebase-architecture",
      mode: "manual",
      effect: "proposal-only",
      sequence: ["inspect", "propose-deepening", "request-refactor-authorization"],
    },
    externalSideEffects: [],
  };
}

/** @param {any} command */
function commandLine(command) {
  return command ? `- ${command.command}` : "- Not configured; repository owner action required.";
}

/** @param {any} audit @param {"codex" | "factory"} harness */
function adapterContents(audit, harness) {
  const rules = [];
  if (audit.stack.includes("react")) {
    rules.push("- React: preserve component locality, accessibility, and existing visual design; use the configured validation and QA commands. React Doctor is advisory unless this repository explicitly configures it as a gate.");
  }
  if (audit.stack.includes("convex")) {
    rules.push("- Convex: require argument and return validators, explicit authorization boundaries, indexed bounded reads, and the repository's configured validation command.");
  }
  if (rules.length === 0) rules.push("- Apply only the detected repository stack and its own validated commands.");
  const equivalence = harness === "factory"
    ? "Factory uses this documented equivalent when a native Codex-only capability is unavailable."
    : "Codex uses the native repository adapter; T3Code shares this Codex contract and state namespace.";
  return `# Development System repository adapter\n\nContract version: \`${contractVersion}\`\nProduct: \`${audit.product.name}\`\nHarness: \`${harness}\`\n\n${equivalence}\n\nPreserve this product's domain language, stack, commands, release policy, and visual design. Do not import another product's vocabulary or activate paid services.\n\n## Stack rules\n\n${rules.join("\n")}\n\n## Commands\n\nReview\n${commandLine(audit.commands.review)}\n\nValidation\n${commandLine(audit.commands.validation)}\n\nQA\n${commandLine(audit.commands.qa)}\n\nPreview\n${commandLine(audit.commands.preview)}\n\n## Architecture diagnostic\n\n\`improve-codebase-architecture\` is manual and proposal-only. It must propose deepening before any separately authorized refactor.\n`;
}

/** @param {string} repository @param {string} managedPath */
async function assertManagedPathSafe(repository, managedPath) {
  let current = repository;
  for (const segment of managedPath.split("/")) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Managed repository path cannot traverse a symbolic link: ${managedPath}`);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      return;
    }
  }
}

/** @param {string} target @param {string} contents */
async function writeIfChanged(target, contents) {
  let existing = null;
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (existing === contents) return false;
  await mkdir(dirname(target), { recursive: true, mode: 0o755 });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, contents, { mode: 0o644, flag: "wx" });
  await rename(temporary, target);
  return true;
}

/** @param {any} audit @param {"initialize" | "normalize"} mode */
function repositoryContract(audit, mode) {
  return {
    schemaVersion: 1,
    contractVersion,
    preparation: { mode, mutationScope: managedFiles },
    product: { name: audit.product.name, packageManager: audit.product.packageManager, stack: audit.stack },
    preserved: audit.preserved,
    commands: audit.commands,
    harnesses: {
      codex: { adapter: "native", contract: ".codex/development-system/repository.md" },
      t3code: { adapter: "codex", contract: ".codex/development-system/repository.md" },
      factory: { adapter: "documented-equivalent", contract: ".factory/development-system/repository.md" },
    },
    rules: {
      react: audit.stack.includes("react"),
      convex: audit.stack.includes("convex"),
      preserveProductIdentity: true,
    },
    architectureDiagnostic: audit.architectureDiagnostic,
    services: { paidActivation: false },
  };
}

/** @param {{repository:string, confirm?:string}} options @param {"initialize" | "normalize"} mode */
async function prepareRepository(options, mode) {
  if (options.confirm !== mode) throw new Error(`${mode}-repository requires --confirm ${mode}`);
  const repository = resolve(options.repository);
  for (const path of managedFiles) await assertManagedPathSafe(repository, path);
  if (mode === "initialize") {
    try {
      const existing = JSON.parse(await readFile(resolve(repository, managedFiles[0]), "utf8"));
      if (existing.contractVersion !== contractVersion || existing.preparation?.mode !== "initialize") {
        throw new Error("Repository already has a different managed contract; use normalize-repository");
      }
    } catch (error) {
      if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
      if (error instanceof SyntaxError) {
        throw new Error("Repository has an invalid managed contract; use normalize-repository");
      }
    }
  }
  const audit = await auditRepository({ repository });
  const outputs = {
    [managedFiles[0]]: `${JSON.stringify(repositoryContract(audit, mode), null, 2)}\n`,
    [managedFiles[1]]: adapterContents(audit, "codex"),
    [managedFiles[2]]: adapterContents(audit, "factory"),
  };
  /** @type {string[]} */
  const changedFiles = [];
  for (const [path, contents] of Object.entries(outputs)) {
    if (await writeIfChanged(resolve(repository, path), contents)) changedFiles.push(path);
  }
  const postAudit = await auditRepository({ repository });
  const missingCapabilities = Object.entries(postAudit.commands)
    .filter(([, command]) => !command)
    .map(([capability]) => capability);
  const readiness = Object.fromEntries(
    Object.entries(postAudit.readiness).map(([harness, result]) => [harness, result.status]),
  );
  const prepared = Object.values(readiness).every((status) => status === "prepared");
  return {
    ok: prepared,
    operation: `${mode}-repository`,
    status: changedFiles.length === 0 ? "unchanged" : "updated",
    repositoryRoot: repository,
    changedFiles,
    preservedFiles: [...audit.preserved.releasePolicyFiles, ...audit.preserved.designFiles, "package.json"].filter((path, index, values) => values.indexOf(path) === index),
    missingCapabilities,
    readiness,
    remainingGaps: Object.fromEntries(
      Object.entries(postAudit.readiness).map(([harness, result]) => [harness, result.gaps]),
    ),
    paidServicesActivated: false,
    externalSideEffects: changedFiles.map((path) => ({ type: "managed-write", path })),
  };
}

/** @param {{repository:string, confirm?:string}} options */
export async function initializeRepository(options) {
  return prepareRepository(options, "initialize");
}

/** @param {{repository:string, confirm?:string}} options */
export async function normalizeRepository(options) {
  return prepareRepository(options, "normalize");
}

export const repositoryContractVersion = contractVersion;
export const repositoryManagedFiles = [...managedFiles];
