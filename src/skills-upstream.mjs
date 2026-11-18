// @ts-check
// 3.2.0: `development-system skills-upstream` tells which catalogued skills of another author fell behind their source.
//
// For every skill of the current catalog whose bytes come from another repository (a `source.upstreamReference`, or a
// `source` that points straight at that repository) it compares the pinned commit with the last commit that touched the
// skill's path upstream; it does the same for the skills the `skills` CLI lock records from other repositories.
// Read-only: one blobless clone per repository in a temporary folder removed at the end, public
// HTTPS without credentials or the operator's Git configuration, and nothing about the operator is sent anywhere.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const OWN_REPOSITORY = "https://github.com/AO-HyS/development-system";
const FULL_COMMIT = /^[a-f0-9]{40}$/u;
// One Git call may not outlive this; a stalled connection is cut by Git itself after 30 s under 1 kB/s.
const GIT_CALL_TIMEOUT_MS = 120_000;
// After this the remaining skills are reported as unread instead of holding the caller (the weekly Steward report).
const DEFAULT_DEADLINE_MS = 600_000;

/**
 * The environment of every Git call: nothing inherited but PATH. No credential helper, prompt, personal or injected
 * configuration (`GIT_CONFIG_COUNT`, `GIT_CONFIG_PARAMETERS`, url rewrites, extra headers, tokens), proxy or `~/.netrc`
 * reaches these clones: HOME is the temporary folder itself.
 * @param {string} root
 */
const gitEnvironment = (root) => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: root,
  XDG_CONFIG_HOME: root,
  TMPDIR: root,
  LC_ALL: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
});
const GIT_OPTIONS = ["-c", "credential.helper=", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=30"];

/**
 * Temporary blobless clones of public repositories, one per URL, removed by `close()`.
 * @param {{callTimeoutMs?: number}} [options]
 * @returns {Promise<{clone: (repository: string) => Promise<string>, git: (directory: string, ...args: string[]) => Promise<Buffer>, close: () => Promise<void>}>}
 */
export async function openUpstreamClones({ callTimeoutMs = GIT_CALL_TIMEOUT_MS } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ds-skills-upstream-"));
  /** @type {Map<string, Promise<string>>} */
  const clones = new Map();
  /** @param {string} directory @param {string[]} args */
  const git = async (directory, ...args) => (await run("git", [...GIT_OPTIONS, ...args], { cwd: directory, env: gitEnvironment(root), encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: callTimeoutMs, killSignal: "SIGKILL" })).stdout;
  /** @param {string} repository */
  const clone = (repository) => {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u.test(repository)) return Promise.reject(new Error(`not a public GitHub repository: ${repository}`));
    let pending = clones.get(repository);
    if (!pending) {
      const directory = join(root, String(clones.size));
      pending = git(root, "clone", "--quiet", "--filter=blob:none", "--no-checkout", `${repository}.git`, directory).then(() => directory);
      clones.set(repository, pending);
    }
    return pending;
  };
  return { clone, git, close: () => rm(root, { recursive: true, force: true }) };
}

/**
 * Skills of the catalog whose source is another author's repository, with the pinned commit and path.
 * @param {{skills: Array<{logicalName: string, source?: Record<string, any>}>}} catalog
 */
export function upstreamSkills(catalog) {
  return catalog.skills.flatMap((skill) => {
    const source = skill.source ?? {};
    const pin = source.upstreamReference ?? (source.repository && source.repository !== OWN_REPOSITORY ? source : null);
    if (!pin || typeof pin.repository !== "string" || typeof pin.path !== "string") return [];
    return [{ name: skill.logicalName, repository: pin.repository.replace(/\.git$/u, ""), path: pin.path, commit: String(pin.commit ?? "") }];
  });
}

/** The catalog shipped with this CLI (its contract version's manifest). */
export async function currentCatalog() {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL(`../manifests/${pkg.contractVersion ?? pkg.version}.json`, import.meta.url), "utf8"));
  const artifact = manifest.artifacts.find((/** @type {{logicalName: string}} */ entry) => entry.logicalName === "skill-catalog");
  if (!artifact) throw new Error("The installed contract has no skill catalog");
  return JSON.parse(await readFile(new URL(`../${artifact.sourcePath}`, import.meta.url), "utf8"));
}

/**
 * Skills recorded in the `skills` CLI lock (`~/.agents/.skill-lock.json`) whose source is another repository and that
 * the catalog does not already cover, plus the installed skill folders whose provenance nobody records.
 * A missing lock is an empty group, never an error.
 * @param {{home: string, lockPath?: string, catalog: {skills: Array<{logicalName: string, variants?: Array<{destination: string}>}>}}} options
 */
export async function installedUpstreamSkills({ home, lockPath, catalog }) {
  const path = lockPath ?? join(home, ".agents", ".skill-lock.json");
  /** @type {Record<string, any>} */
  let locked = {};
  let lockFound = true;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    locked = parsed && typeof parsed.skills === "object" && parsed.skills !== null ? parsed.skills : {};
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    lockFound = false;
  }
  const catalogued = new Set(catalog.skills.map((skill) => skill.logicalName));
  const entries = [];
  let alsoInCatalog = 0;
  for (const [name, record] of Object.entries(locked)) {
    const repository = String(record?.sourceUrl ?? "").replace(/\.git$/u, "");
    if (repository === OWN_REPOSITORY || typeof record?.skillPath !== "string") continue;
    if (catalogued.has(name)) { alsoInCatalog += 1; continue; }
    const folder = dirname(record.skillPath);
    entries.push({ name, repository, path: folder === "." ? "" : folder, commit: typeof record.sourceCommit === "string" ? record.sourceCommit : "", folderHash: typeof record.skillFolderHash === "string" ? record.skillFolderHash : "", updatedAt: typeof record.updatedAt === "string" ? record.updatedAt.slice(0, 10) : null });
  }
  // Installed folders with no record anywhere: not a catalog destination and not in the lock.
  const destinations = new Set(catalog.skills.flatMap((skill) => (skill.variants ?? []).map((variant) => variant.destination.split("/").pop())));
  /** @type {Set<string>} */
  const unknown = new Set();
  for (const root of [join(home, ".agents", "skills"), join(home, ".claude", "skills")]) {
    let names = [];
    try { names = await readdir(root); } catch { continue; }
    for (const entry of names) if (!entry.startsWith(".") && !destinations.has(entry) && !(entry in locked)) unknown.add(entry);
  }
  return { lockPath: path, lockFound, entries, alsoInCatalog, unknownProvenance: [...unknown].sort() };
}

/**
 * Compare each skill of another author with its source's default branch.
 * `al-dia`: nothing touched the path after the pinned commit, or the recorded folder hash is the current one.
 * `atrasada`: a later commit changed the path (pinned → latest, date). `ya-no-existe`: the path is gone upstream.
 * `desconocido`: the repository, the pinned commit or the record could not be read.
 * Group `catalogo`: the catalog shipped with this CLI. Group `instaladas`: the `skills` lock of `home`.
 * Past `deadlineMs` the skills not yet compared are `desconocido` ("time limit reached"): the caller always gets a report.
 * @param {{catalog?: any, home?: string, lockPath?: string, concurrency?: number, deadlineMs?: number, callTimeoutMs?: number}} [options]
 */
export async function checkSkillsUpstream({ catalog, home = homedir(), lockPath, concurrency = 4, deadlineMs = DEFAULT_DEADLINE_MS, callTimeoutMs } = {}) {
  const resolved = catalog ?? await currentCatalog();
  const installed = await installedUpstreamSkills({ home, lockPath, catalog: resolved });
  /** @type {Array<{group: "catalogo"|"instaladas", name: string, repository: string, path: string, commit: string, folderHash?: string, updatedAt?: string|null}>} */
  const entries = [
    ...upstreamSkills(resolved).map((entry) => ({ group: /** @type {const} */ ("catalogo"), ...entry })),
    ...installed.entries.map((entry) => ({ group: /** @type {const} */ ("instaladas"), ...entry })),
  ];
  const clones = await openUpstreamClones({ callTimeoutMs });
  const deadline = Date.now() + deadlineMs;
  try {
    /** @typedef {{group: "catalogo"|"instaladas", name: string, repository: string, path: string, pinned: string|null, state: "al-dia"|"atrasada"|"ya-no-existe"|"desconocido", latest: string|null, latestDate: string|null, pinnedDate: string|null, error: string|null}} UpstreamRow */
    /** @type {UpstreamRow[]} */
    const skills = [];
    const queue = [...entries];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        /** @type {UpstreamRow} */
        const row = { group: entry.group, name: entry.name, repository: entry.repository, path: entry.path, pinned: entry.commit || null, state: "desconocido", latest: null, latestDate: null, pinnedDate: null, error: null };
        try {
          if (Date.now() > deadline) throw new Error("time limit reached before this skill was compared");
          // A pinned commit reaches Git as an argument: only a full hash, never something Git could read as an option.
          if (entry.commit && !FULL_COMMIT.test(entry.commit)) throw new Error("the pinned commit is not a full 40-character hash");
          const directory = await clones.clone(entry.repository);
          const text = async (/** @type {string[]} */ ...args) => (await clones.git(directory, ...args)).toString().trim();
          const pathspec = entry.path ? ["--", entry.path] : [];
          const treeAt = (/** @type {string} */ commit) => text("rev-parse", "--verify", "--quiet", "--end-of-options", entry.path ? `${commit}:${entry.path}` : `${commit}^{tree}`).catch(() => null);
          if (entry.path && !(await text("ls-tree", "--name-only", "HEAD", "--", entry.path))) {
            row.state = "ya-no-existe";
          } else {
            const [latest, date] = (await text("log", "-1", "--format=%H %cs", "HEAD", ...pathspec)).split(" ");
            row.latest = latest;
            row.latestDate = date;
            if (entry.commit) {
              row.pinnedDate = await text("log", "-1", "--format=%cs", "--end-of-options", `${entry.commit}^{commit}`).catch(() => null);
              if (row.pinnedDate === null) throw new Error(`pinned commit ${entry.commit.slice(0, 12)} is not in ${entry.repository}`);
              const behind = latest !== entry.commit && await clones.git(directory, "merge-base", "--is-ancestor", latest, entry.commit).then(() => false, () => true);
              row.state = behind ? "atrasada" : "al-dia";
            } else if (FULL_COMMIT.test(entry.folderHash ?? "")) {
              // The `skills` CLI records the Git tree of the folder: find the commit that installed it.
              if ((await treeAt("HEAD")) === entry.folderHash) row.state = "al-dia";
              else {
                row.state = "atrasada";
                for (const commit of (await text("log", "--format=%H", "-n", "300", "HEAD", ...pathspec)).split("\n").filter(Boolean)) {
                  if ((await treeAt(commit)) === entry.folderHash) { row.pinned = commit; row.pinnedDate = await text("log", "-1", "--format=%cs", commit); break; }
                }
                row.pinnedDate ??= entry.updatedAt ?? null;
              }
            } else if (/^[a-f0-9]{64}$/u.test(entry.folderHash ?? "")) {
              // The Development System records its folder hash: recompute it on the current upstream folder.
              const files = (await text("ls-tree", "-r", "--name-only", "HEAD", ...pathspec)).split("\n").filter(Boolean).sort();
              const digest = createHash("sha256");
              for (const file of files) digest.update(entry.path ? file.slice(entry.path.length + 1) : file).update("\0").update(await clones.git(directory, "show", `HEAD:${file}`)).update("\0");
              row.state = digest.digest("hex") === entry.folderHash ? "al-dia" : "atrasada";
              if (row.state === "atrasada") row.pinnedDate = entry.updatedAt ?? null;
            } else {
              throw new Error("the lock records neither a commit nor a folder hash");
            }
          }
        } catch (error) {
          row.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
        }
        skills.push(row);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    skills.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    /** @param {"catalogo"|"instaladas"} group */
    const summary = (group) => {
      const rows = skills.filter((row) => row.group === group);
      /** @param {string} state */
      const named = (state) => rows.filter((row) => row.state === state).map((row) => row.name);
      return { checked: rows.length, alDia: named("al-dia").length, atrasadas: named("atrasada"), yaNoExiste: named("ya-no-existe"), desconocido: named("desconocido") };
    };
    const groups = { catalogo: summary("catalogo"), instaladas: summary("instaladas") };
    return {
      ok: groups.catalogo.desconocido.length + groups.instaladas.desconocido.length === 0,
      operation: "skills-upstream",
      catalogVersion: resolved.catalogVersion ?? null,
      lock: { path: installed.lockPath, found: installed.lockFound, alsoInCatalog: installed.alsoInCatalog },
      checked: skills.length,
      groups,
      unknownProvenance: installed.unknownProvenance,
      skills,
      externalSideEffects: [],
    };
  } finally {
    await clones.close();
  }
}

/** @param {Awaited<ReturnType<typeof checkSkillsUpstream>>} result */
export function formatSkillsUpstream(result) {
  const short = (/** @type {string|null} */ sha) => (sha ? sha.slice(0, 8) : "?");
  const where = (/** @type {{repository: string, path: string}} */ row) => `${row.repository.replace("https://github.com/", "")}${row.path ? `/${row.path}` : ""}`;
  /** @param {"catalogo"|"instaladas"} group @param {string} title */
  const section = (group, title) => {
    const counts = result.groups[group];
    const lines = [`${title}: ${counts.checked} de otro autor · ${counts.alDia} al día · ${counts.atrasadas.length} atrasadas · ${counts.yaNoExiste.length} ya no existen arriba${counts.desconocido.length ? ` · ${counts.desconocido.length} sin leer` : ""}`];
    for (const row of result.skills.filter((candidate) => candidate.group === group)) {
      if (row.state === "atrasada") lines.push(`  atrasada      ${row.name}: ${short(row.pinned)} (${row.pinnedDate ?? "?"}) → ${short(row.latest)} (${row.latestDate}) ${where(row)}`);
      else if (row.state === "ya-no-existe") lines.push(`  ya no existe  ${row.name}: ${where(row)} (fijada ${short(row.pinned)})`);
      else if (row.state === "desconocido") lines.push(`  sin leer      ${row.name}: ${row.error}`);
    }
    const current = result.skills.filter((row) => row.group === group && row.state === "al-dia").map((row) => row.name);
    if (current.length) lines.push(`  al día: ${current.join(", ")}`);
    return lines;
  };
  const lockNote = result.lock.found ? `${result.lock.path}${result.lock.alsoInCatalog ? `; ${result.lock.alsoInCatalog} ya contadas en el catálogo` : ""}` : `${result.lock.path} no existe`;
  return [
    ...section("catalogo", `Catálogo ${result.catalogVersion}`),
    ...section("instaladas", `Instaladas fuera del catálogo (${lockNote})`),
    `Sin procedencia conocida: ${result.unknownProvenance.length} skills instaladas${result.unknownProvenance.length ? ` (${result.unknownProvenance.join(", ")})` : ""}`,
  ].join("\n");
}

/** @param {string[]} args */
export async function runSkillsUpstreamCommand(args) {
  const json = args.includes("--json");
  /** @type {{home?: string, lockPath?: string}} */
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") continue;
    if (arg === "--home" || arg === "--lock") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--home") options.home = resolve(value);
      else options.lockPath = resolve(value);
      continue;
    }
    throw new Error(`Unknown option for skills-upstream: ${arg}`);
  }
  const result = await checkSkillsUpstream(options);
  return { result, output: json ? JSON.stringify(result) : formatSkillsUpstream(result), json };
}
