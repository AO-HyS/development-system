// @ts-check
// `development-system listo` (4.4.0): the one gate an agent runs right before merging. It classifies the pull request
// (niveles.mjs), reads the record of the independent read (registro.mjs) when crítico, checks lint/typecheck once per
// head/base, shows the smoke, records PR-to-merge cycle time locally, and publishes a commit status on the exact head
// (`listo para fusionar`) that the branch rules of develop require. `--produccion` does the same for the range promoted
// to main (`listo para producción`). Codex GitHub was removed in 4.4.0.
//
// Generados (sobre 4.2.0): a base merge whose changes on top of git's automatic merge are only files the base branch declares in
// `generados` stays a clean merge when listo rebuilds those files itself and they match byte for byte (generados.mjs).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { changedFile, parsePrReference } from "./evidence.mjs";
import { classifyFiles, firstMatch, formatMotivos, loadNiveles, namesOf, raise } from "./niveles.mjs";
import { ancestorOrEqual, coverage, parsePr } from "./pr-review-status.mjs";
/** @typedef {import("./generados.mjs").GeneradosContext} GeneradosContext */
import { evaluateRegistro, registrosOf } from "./registro.mjs";
import { SMOKE_CONTEXT } from "./smoke.mjs";

export const LISTO_CONTEXT = "listo para fusionar";
export const PRODUCCION_CONTEXT = "listo para producción";
export const CRITICAL_LABEL = "nivel:critico";
const CHECK_TIMEOUT_MS = 30 * 60_000;

/** @param {string[]} args */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
/** @param {string} api */
const ghJson = (api) => JSON.parse(gh(["api", api]));
/** @param {string} api @returns {any[]} */
const ghList = (api) => JSON.parse(gh(["api", "--paginate", "--slurp", api])).flat();
/** @param {unknown} error */
const errorText = (error) => String(/** @type {{stderr?: string}} */ (error)?.stderr || (error instanceof Error ? error.message : error)).trim().split("\n")[0];
/** @param {string} sha */
const short = (sha) => sha.slice(0, 12);

/**
 * @typedef {{texto: string, comando: string}} Falta
 * @typedef {import("./niveles.mjs").Nivel} Nivel
 * @typedef {import("./niveles.mjs").Niveles} Niveles
 * @typedef {{
 *   schema: 1,
 *   pr: string,
 *   prCreado: string | null,
 *   primerListo: string,
 *   primerListoParaFusionar: string | null,
 *   ultimoListoParaFusionar: string | null,
 *   prAPrimerListoMin: number | null,
 *   primerListoAFusionarMin: number | null,
 *   prAFusionarMin: number | null,
 * }} CicloPr
 */

/** @type {Map<string, boolean>} */
const localCommits = new Map();
/** True when the working directory's git has this commit: its tree is then read locally, which is what makes a range fast. @param {string} sha */
function localCommit(sha) {
  if (!localCommits.has(sha)) {
    try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }); localCommits.set(sha, true); } catch { localCommits.set(sha, false); }
  }
  return localCommits.get(sha) === true;
}

/**
 * File contents at the head or at the merge base, read lazily and cached; null when the file does not exist there.
 * A commit the local checkout has is read with git (same SHA, same tree); any other through the GitHub API.
 * @param {string} owner @param {string} repo @param {string} head @param {() => string} mergeBase
 */
function contentReader(owner, repo, head, mergeBase) {
  /** @type {Map<string, string | null>} */
  const cache = new Map();
  return (/** @type {string} */ name, /** @type {"head" | "base"} */ side) => {
    const ref = side === "head" ? head : mergeBase();
    const key = `${ref}:${name}`;
    if (cache.has(key)) return /** @type {string | null} */ (cache.get(key));
    let text = null;
    if (localCommit(ref)) {
      try { text = execFileSync("git", ["cat-file", "blob", `${ref}:${name}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); } catch { text = null; }
      cache.set(key, text);
      return text;
    }
    try {
      text = gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${owner}/${repo}/contents/${name.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`]);
    } catch (error) {
      if (!/HTTP 404|Not Found/i.test(errorText(error))) throw new Error(`no pude leer ${name} en ${short(ref)}: ${errorText(error)}`);
    }
    cache.set(key, text);
    return text;
  };
}

/** The merge base of `head` with `baseRef`, computed once. @param {string} owner @param {string} repo @param {string} baseRef @param {string} head */
function mergeBaseOf(owner, repo, baseRef, head) {
  let value = "";
  return () => {
    if (!value) value = String(ghJson(`repos/${owner}/${repo}/compare/${encodeURIComponent(baseRef)}...${head}`).merge_base_commit?.sha ?? "");
    if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`GitHub no dio la base común de ${short(head)} con ${baseRef}`);
    return value;
  };
}

/** Every file of a pull request, or a thrown error when GitHub lists fewer than it reports. @param {string} owner @param {string} repo @param {any} pull */
function pullFiles(owner, repo, pull) {
  const files = ghList(`repos/${owner}/${repo}/pulls/${pull.number}/files?per_page=100`).map(changedFile);
  // The pulls listing carries no file count; the PR itself does.
  const expected = Number(pull.changed_files ?? ghJson(`repos/${owner}/${repo}/pulls/${pull.number}`).changed_files);
  if (files.length !== expected) throw new Error(`GitHub listó ${files.length} de ${expected} archivos de #${pull.number}: no decido el nivel con una lista parcial`);
  return files;
}

/**
 * Computes and optionally persists PR-to-merge cycle timestamps for one pull request.
 * When `persist` is false (`--sin-estado`), reads any existing record and computes in memory without writing to disk.
 * @param {{home: string, owner: string, repo: string, number: number, prCreado: string | null, now: number, ready: boolean, persist: boolean}} input
 * @returns {CicloPr}
 */
function recordCiclo({ home, owner, repo, number, prCreado, now, ready, persist }) {
  const directory = path.join(home, ".development-system/private/listo/ciclo", `${owner}-${repo}`.toLowerCase());
  const file = path.join(directory, `${number}.json`);
  const validIso = (/** @type {unknown} */ value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  /** @type {Partial<CicloPr> | null} */
  let existing = null;
  if (existsSync(file)) {
    try { existing = JSON.parse(readFileSync(file, "utf8")); } catch { existing = null; }
  }
  const nowIso = new Date(now).toISOString();
  const created = validIso(prCreado) ?? validIso(existing?.prCreado);
  const primerListo = validIso(existing?.primerListo) ?? nowIso;
  const primerListoParaFusionar = validIso(existing?.primerListoParaFusionar) ?? (ready ? nowIso : null);
  const ultimoListoParaFusionar = ready ? nowIso : validIso(existing?.ultimoListoParaFusionar);
  /** @param {string | null} from @param {string | null} to */
  const diffMin = (from, to) => {
    if (!from || !to) return null;
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(0, Math.round((b - a) / 60_000));
  };
  /** @type {CicloPr} */
  const ciclo = {
    schema: 1,
    pr: `${owner}/${repo}#${number}`,
    prCreado: created,
    primerListo,
    primerListoParaFusionar,
    ultimoListoParaFusionar,
    prAPrimerListoMin: diffMin(created, primerListo),
    primerListoAFusionarMin: diffMin(primerListo, primerListoParaFusionar),
    prAFusionarMin: diffMin(created, primerListoParaFusionar),
  };
  if (persist) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify(ciclo, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return ciclo;
}

/**
 * lint/typecheck once per head: a pass record per head commit, its parents and tree, and the exact base commit whose
 * `config/niveles.json` named the commands; a command runs only when that record has no pass and the local checkout is
 * clean and at the head. Two histories with the same tree, or the same head judged against another base, never share a
 * pass (sobre 4.2.1: the record used to be keyed by tree alone).
 * @param {{config: Niveles | null, owner: string, repo: string, head: string, rulesFrom: string, home: string, checkout: string, prKey: string}} input
 */
export function checksPart({ config, owner, repo, head, rulesFrom, home, checkout, prKey }) {
  const commands = config?.comprobaciones ?? [];
  if (commands.length === 0) return { linea: "las comprobaciones corren en los hooks del repositorio", faltas: /** @type {Falta[]} */ ([]), arbol: "" };
  const commit = ghJson(`repos/${owner}/${repo}/git/commits/${head}`);
  const tree = String(commit.tree?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error(`GitHub no dio el árbol de ${short(head)}`);
  const parents = (Array.isArray(commit.parents) ? commit.parents : []).map((/** @type {{sha?: string}} */ parent) => String(parent.sha ?? ""));
  if (!/^[0-9a-f]{40}$/.test(rulesFrom) && !rulesFrom.startsWith("borrador:")) throw new Error("listo no sabe de qué commit de la base salieron las comprobaciones");
  const identity = { head, parents, tree, base: rulesFrom };
  // Lowercase owner and repo, as the evidence receipts key them, so one repository has one folder.
  const key = parsePrReference(prKey);
  const directory = path.join(home, ".development-system/private/listo/checks", `${key.owner}-${key.repo}`);
  const recordKey = createHash("sha256").update(JSON.stringify({ comprobaciones: 2, ...identity })).digest("hex");
  const file = path.join(directory, `${recordKey}.json`);
  /** @type {{head: string, parents: string[], tree: string, base: string, resultados: Record<string, {ok: boolean, en: string, ms: number, sha: string, salida?: number}>}} */
  let store = { ...identity, resultados: {} };
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, "utf8"));
      if (stored?.head === head && stored.tree === tree && stored.base === rulesFrom && JSON.stringify(stored.parents) === JSON.stringify(parents)) store = { ...identity, resultados: stored.resultados ?? {} };
    } catch { /* recompute */ }
  }
  const pending = commands.filter((command) => store.resultados?.[command]?.ok !== true);
  let blocked = "";
  if (pending.length) {
    let top = "";
    try { top = execFileSync("git", ["-C", checkout, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { top = ""; }
    const localHead = top ? execFileSync("git", ["-C", top, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
    const dirty = top ? execFileSync("git", ["-C", top, "status", "--porcelain"], { encoding: "utf8" }).trim() !== "" : true;
    if (!top) blocked = `${checkout} no es un checkout de git`;
    else if (localHead !== head) blocked = `el checkout ${top} está en ${short(localHead)}, no en la punta ${short(head)}`;
    else if (dirty) blocked = `el checkout ${top} tiene cambios sin commit o archivos sin seguir`;
    else {
      /** @type {typeof store.resultados} */
      const ran = {};
      for (const command of pending) {
        process.stderr.write(`listo: corriendo «${command}» en ${top} (árbol ${short(tree)})\n`);
        const started = Date.now();
        const child = spawnSync(command, { cwd: top, shell: true, stdio: ["ignore", 2, 2], timeout: CHECK_TIMEOUT_MS });
        ran[command] = { ok: child.status === 0, en: new Date().toISOString(), ms: Date.now() - started, sha: head, salida: child.status ?? -1 };
        // A command that moved HEAD or wrote into the checkout makes every later result about other files: keep none.
        const afterHead = execFileSync("git", ["-C", top, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        const afterDirty = execFileSync("git", ["-C", top, "status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
        if (afterHead !== head || afterDirty) { blocked = `«${command}» ${afterHead !== head ? `movió el checkout a ${short(afterHead)}` : "dejó cambios en el checkout"}; ningún resultado de esta corrida cuenta`; break; }
      }
      if (!blocked) {
        store.resultados = { ...store.resultados, ...ran };
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
        chmodSync(file, 0o600);
      }
    }
  }
  /** @type {Falta[]} */
  const faltas = [];
  for (const command of commands) {
    const result = store.resultados?.[command];
    if (result?.ok === true) continue;
    if (result && !blocked) faltas.push({ texto: `«${command}» falló en el árbol ${short(tree)}`, comando: `arregla, haz commit y push, y corre development-system listo ${prKey}` });
    else faltas.push({ texto: `«${command}» sin pase para el árbol ${short(tree)} (${blocked || "sin correr"})`, comando: `desde un checkout limpio en ${short(head)}: development-system listo ${prKey} --repo <checkout>` });
  }
  const passed = commands.filter((command) => store.resultados?.[command]?.ok === true);
  return { linea: `${passed.length} de ${commands.length} pasadas en el árbol ${short(tree)}${faltas.length ? "" : ` (${passed.join(", ")})`}`, faltas, arbol: tree };
}

/**
 * The base branch's `generados` block with the folder where passing rebuilds are cached, or null without one.
 * @param {Niveles | null} config @param {string} home @param {string} owner @param {string} repo @returns {GeneradosContext | null}
 */
function generadosContext(config, home, owner, repo) {
  if (!config?.generados) return null;
  return { config: config.generados, cacheDir: path.join(home, ".development-system/private/listo/generados", `${owner}-${repo}`.toLowerCase()) };
}

/** The `smoke` commit status of a commit: success, failure, pending, error or «sin correr». @param {string} owner @param {string} repo @param {string} sha */
function smokeStatus(owner, repo, sha) {
  const combined = ghJson(`repos/${owner}/${repo}/commits/${sha}/status?per_page=100`);
  const status = (combined.statuses ?? []).find((/** @type {any} */ entry) => entry.context === SMOKE_CONTEXT);
  return status ? String(status.state) : "sin correr";
}

/**
 * The record the gate reads for crítico: the newest record on the PR, for the head (or the merge commit of a merged
 * PR), or for a commit the head covers by the coverage rule.
 * @param {{registros: import("./registro.mjs").RegistroLeido[], head: string, merge: string, cover: (from: string) => ReturnType<typeof coverage>}} input
 * @returns {{linea: string, faltas: string[], registro?: import("./registro.mjs").Registro}}
 */
function recordPart({ registros, head, merge, cover }) {
  const newest = registros[0];
  if (!newest) return { linea: "sin registro de lectura", faltas: ["falta el registro de una lectura independiente con sus casos necesarios recorridos"] };
  if (!newest.registro) return { linea: `el registro más nuevo (${newest.url}) es ilegible`, faltas: [`${newest.error}: registra de nuevo`] };
  const record = newest.registro;
  const sha = record.sha.toLowerCase();
  let where = "";
  if (sha.length >= 7 && (head.startsWith(sha) || (merge && merge.startsWith(sha)))) where = "de la punta";
  else if (/^[0-9a-f]{40}$/.test(sha)) {
    const covered = cover(sha);
    if (!covered.covered) return { linea: `el registro más nuevo es de ${short(sha)} y la punta ${short(head)} no está cubierta (${covered.reason})`, faltas: [`el registro es de ${short(sha)}, no de la punta ${short(head)}: lee lo nuevo y registra para la punta`] };
    where = `de ${short(sha)}, punta cubierta`;
  } else return { linea: `el registro más nuevo nombra ${record.sha}, que no es un SHA completo`, faltas: ["registra de nuevo con --sha de la punta"] };
  const verdict = evaluateRegistro(record);
  const extra = verdict.noAlcanzados.length ? `; no alcanzado: ${verdict.noAlcanzados.join("; ")}` : "";
  return { linea: `${verdict.completo ? "completo" : "incompleto"} ${where} (lector ${record.lector}; pasaron ${verdict.pasados.join(", ") || "ninguno"}${extra})`, faltas: verdict.faltas, registro: record };
}

/** The merge method the repository allows, preferring a merge commit. @param {string} owner @param {string} repo */
function mergeMethod(owner, repo) {
  try {
    const settings = ghJson(`repos/${owner}/${repo}`);
    if (settings.allow_merge_commit !== false) return "--merge";
    if (settings.allow_squash_merge !== false) return "--squash";
    return "--rebase";
  } catch { return "--merge"; }
}

/**
 * Otros PRs abiertos a la misma base que regeneran los mismos registros formales.
 * Solo informa: un choque no cambia los requisitos ni el resultado del PR.
 * @param {string} owner @param {string} repo @param {any} pull @param {ReturnType<typeof pullFiles>} files
 * @returns {{pr: number, archivos: string[]}[]}
 */
function choquesFormales(owner, repo, pull, files) {
  const registros = new Set(files.flatMap(namesOf).filter((name) => /(^|\/)run-record\.json$/.test(name)));
  if (!registros.size) return [];
  const peers = ghList(`repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(pull.base.ref)}&per_page=100`);
  return peers.filter((peer) => peer.number !== pull.number).flatMap((peer) => {
    const archivos = [...new Set(pullFiles(owner, repo, peer).flatMap(namesOf).filter((name) => registros.has(name)))].sort();
    return archivos.length ? [{ pr: Number(peer.number), archivos }] : [];
  }).sort((a, b) => a.pr - b.pr);
}

/**
 * @typedef {{pr?: string, produccion?: string, base?: string, head?: string, subir?: string, sinEstado: boolean, niveles?: string, repo?: string, home?: string, json: boolean}} ListoOptions
 */

/** @param {string[]} argv arguments after `listo` @returns {ListoOptions} */
export function parseListoArgs(argv) {
  /** @type {ListoOptions} */
  const options = { sinEstado: false, json: false };
  const valued = /** @type {const} */ (["--produccion", "--base", "--head", "--subir", "--niveles", "--repo", "--home"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pedir" || arg === "--barrido" || arg === "--dias") {
      throw new Error(`${arg} fue retirado en 4.4.0: listo ya no usa Codex en GitHub.`);
    }
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--sin-estado") { options.sinEstado = true; continue; }
    if (/** @type {readonly string[]} */ (valued).includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} necesita un valor`);
      options[/** @type {"produccion" | "base" | "head" | "subir" | "niveles" | "repo" | "home"} */ (arg.slice(2))] = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`opción desconocida para listo: ${arg}`);
    if (options.pr) throw new Error("listo toma un solo PR");
    options.pr = arg;
  }
  if (options.produccion && options.pr) throw new Error("usa listo <owner/repo#n> o listo --produccion <owner/repo>, no los dos");
  if (!options.produccion && !options.pr) throw new Error("falta el PR: development-system listo <owner/repo#n>");
  if (!options.produccion && (options.base || options.head)) throw new Error("--base y --head van con --produccion");
  if (options.produccion && options.subir) throw new Error("--subir va con un PR, no con --produccion");
  if (options.subir !== undefined && options.subir !== "critico") throw new Error(`--subir ${options.subir}: el único valor es critico`);
  if (options.niveles && !options.sinEstado) throw new Error("--niveles (un borrador) solo va con --sin-estado: el estado publicado se decide con config/niveles.json de la rama base");
  return options;
}

/**
 * Evaluates one pull request and, unless `--sin-estado`, publishes the `listo para fusionar` status on its head.
 * @param {ListoOptions & {pr: string, now?: number}} options
 */
export function listo(options) {
  const now = options.now ?? Date.now();
  const home = path.resolve(options.home ?? homedir());
  const checkout = path.resolve(options.repo ?? process.cwd());
  const draft = options.niveles ? path.resolve(options.niveles) : undefined;
  // The coverage walk rebuilds base merges with git in the working directory: the PR's checkout.
  if (options.repo) process.chdir(checkout);
  const { owner, repo, number } = parsePr(options.pr);
  const prKey = `${owner}/${repo}#${number}`;
  const base = `repos/${owner}/${repo}`;
  const pull = ghJson(`${base}/pulls/${number}`);
  const head = String(pull.head.sha);
  const baseRef = String(pull.base.ref);
  const merged = Boolean(pull.merged_at);
  const state = pull.state === "open" ? "abierto" : merged ? "fusionado" : "cerrado sin fusionar";
  if (pull.state !== "open" && !options.sinEstado) throw new Error(`${prKey} está ${state}: listo publica solo sobre un PR abierto (usa --sin-estado para evaluarlo)`);
  /** @type {{parte: string, linea: string}[]} */
  const parts = [{ parte: "PR", linea: `${prKey} ${state} · base ${baseRef} · punta ${short(head)}` }];
  /** @type {Falta[]} */
  const faltas = [];
  // 2. Level from the base branch tip (or a local draft when only evaluating).
  // One exact base commit for the rules and the checks' pass: the branch can move while listo runs.
  const baseSha = draft ? "" : String(ghJson(`${base}/commits/${encodeURIComponent(baseRef)}`).sha ?? "");
  if (!draft && !/^[0-9a-f]{40}$/.test(baseSha)) throw new Error(`GitHub no dio la punta de ${baseRef}`);
  const loaded = loadNiveles({ gh, owner, repo, ref: draft ? baseRef : baseSha, file: draft, label: `${baseRef}@${short(baseSha)}` });
  const rulesFrom = draft ? `borrador:${createHash("sha256").update(readFileSync(draft)).digest("hex")}` : baseSha;
  // Rules, base-merge membership and checks all judge against that one commit; `pinnedBase` stands for the branch.
  const pinnedBase = baseSha || baseRef;
  const files = pullFiles(owner, repo, pull);
  /** @type {{pr: number, archivos: string[]}[]} */
  let choqueFormal = [];
  let avisoChoqueFormal = "";
  try { choqueFormal = choquesFormales(owner, repo, pull, files); }
  catch (error) { avisoChoqueFormal = `no pude comprobar el choque formal: ${errorText(error)}`; }
  const prChanged = new Set(files.flatMap(namesOf));
  const classified = classifyFiles({ config: loaded.config, files, content: contentReader(owner, repo, head, mergeBaseOf(owner, repo, pinnedBase, head)) });
  let nivel = classified.nivel;
  /** @type {string[]} */
  const raised = [];
  const labels = (pull.labels ?? []).map((/** @type {any} */ label) => String(label.name));
  if (labels.includes(CRITICAL_LABEL)) { nivel = raise(nivel, "crítico"); raised.push(`etiqueta ${CRITICAL_LABEL}`); }
  let labelNote = "";
  if (options.subir === "critico") {
    nivel = raise(nivel, "crítico");
    if (options.sinEstado) { raised.push("--subir critico (sin publicar la etiqueta)"); labelNote = "sin publicar"; }
    else if (!labels.includes(CRITICAL_LABEL)) {
      try { gh(["api", `${base}/labels`, "-f", `name=${CRITICAL_LABEL}`, "-f", "color=b60205", "-f", "description=Pide lectura independiente y casos recorridos antes de fusionar"]); } catch (error) { if (!/already_exists|422/.test(errorText(error))) throw error; }
      gh(["api", `${base}/issues/${number}/labels`, "-f", `labels[]=${CRITICAL_LABEL}`]);
      raised.push(`--subir critico (etiqueta ${CRITICAL_LABEL} añadida)`);
    } else raised.push("--subir critico");
  }
  const generados = generadosContext(loaded.config, home, owner, repo);
  parts.push({ parte: "Nivel", linea: `${nivel}${nivel === classified.nivel ? "" : ` (por rutas ${classified.nivel}; sube por: ${raised.join(", ")})`} — ${formatMotivos(classified)}${nivel === classified.nivel && raised.length ? `; también: ${raised.join(", ")}` : ""} [${loaded.fuente}]` });
  if (loaded.aviso) parts.push({ parte: "Aviso", linea: loaded.aviso });
  // 3. Checks once per head and base.
  const checks = checksPart({ config: loaded.config, owner, repo, head, rulesFrom, home, checkout, prKey });
  parts.push({ parte: "Comprobaciones", linea: checks.linea });
  faltas.push(...checks.faltas);
  // 4. Smoke, informative only.
  const smokeFiles = loaded.config ? files.filter((file) => namesOf(file).some((name) => firstMatch(/** @type {Niveles} */ (loaded.config).smoke.rutas, name))) : [];
  parts.push({ parte: "Smoke", linea: smokeFiles.length ? `${smokeStatus(owner, repo, head)} en ${short(head)} (informativo; no frena develop)` : "no aplica (ningún archivo en smoke.rutas)" });
  // 5. Crítico: a complete record; normal: pending the batch read; mecánico: no read.
  /** @type {ReturnType<typeof recordPart> | null} */
  let record = null;
  const mergeSha = merged ? String(pull.merge_commit_sha ?? "") : "";
  const registroCommand = `development-system registro ${prKey} --sha ${head} --entorno <url|local> --lector <modelo> --lectura <hilo de la lectura> --veredicto sin-vivos|vivos --necesario "N1: <caso>" --caso "pass: N1 <qué se intentó> => <qué se observó>" --autor <modelo que escribió el cambio>`;
  if (nivel === "crítico") {
    const registros = registrosOf(ghList(`${base}/issues/${number}/comments?per_page=100`));
    let checkedCoverage = false;
    record = recordPart({
      registros,
      head,
      merge: mergeSha,
      cover: (from) => {
        checkedCoverage = true;
        return coverage({ base, from, to: head, findings: [], peers: [], records: [], baseRef: pinnedBase, prChanged, generados });
      },
    });
    parts.push({ parte: "Registro", linea: record.linea });
    // The coverage walk proves a clean base merge by rebuilding it with git here; without the PR's objects it cannot.
    if (checkedCoverage && !localCommit(head)) parts.push({ parte: "Aviso", linea: `${process.cwd()} no tiene ${short(head)}: una fusión con ${baseRef} no se puede probar limpia desde aquí; corre listo desde el checkout del repositorio (o --repo) después de git fetch` });
    for (const texto of record.faltas) faltas.push({ texto, comando: registroCommand });
  } else if (nivel === "normal") parts.push({ parte: "Lectura", linea: "queda sin verificar hasta la lectura por lote (antes de pasar a main)" });
  else parts.push({ parte: "Lectura", linea: "mecánico: sin lectura" });
  // A base that moved while listo ran may carry other rules or checks: judge again, never publish the old verdict.
  if (baseSha) {
    const currentBaseSha = String(ghJson(`${base}/commits/${encodeURIComponent(baseRef)}`).sha ?? "");
    if (currentBaseSha !== baseSha) faltas.push({ texto: `${baseRef} avanzó de ${short(baseSha)} a ${currentBaseSha ? short(currentBaseSha) : "?"} mientras listo corría`, comando: `development-system listo ${prKey}` });
  }
  /** @type {"listo" | "falta"} */
  const resultado = faltas.length ? "falta" : "listo";
  const first = faltas[0]?.texto ?? "listo";
  let estadoGithub = "no publicado (--sin-estado)";
  if (!options.sinEstado) {
    const ghState = resultado === "listo" ? "success" : "failure";
    gh(["api", `${base}/statuses/${head}`, "-f", `state=${ghState}`, "-f", `context=${LISTO_CONTEXT}`, "-f", `description=${`${nivel}: ${first}`.slice(0, 140)}`]);
    estadoGithub = `«${LISTO_CONTEXT}» = ${ghState} en ${short(head)}`;
  }
  const ciclo = recordCiclo({
    home,
    owner,
    repo,
    number,
    prCreado: typeof pull.created_at === "string" ? pull.created_at : null,
    now,
    ready: resultado === "listo",
    persist: !options.sinEstado,
  });
  const merge = resultado === "listo" && pull.state === "open" ? `gh pr merge ${number} --repo ${owner}/${repo} ${mergeMethod(owner, repo)} --match-head-commit ${head}` : "";
  const siguiente = resultado === "listo" ? (merge ? `fusiona: ${merge}` : "nada: el PR ya no está abierto") : faltas[0].comando;
  const result = {
    ok: resultado === "listo", operation: "listo", pr: prKey, head, base: baseRef, estadoPr: state, nivel, nivelPorRutas: classified.nivel, motivos: classified.motivos, subePor: raised, aviso: loaded.aviso ?? null, fuente: loaded.fuente,
    choqueFormal, avisoChoqueFormal: avisoChoqueFormal || null, comprobaciones: checks, registro: record, ciclo, resultado, faltas, estadoGithub, ...(labelNote ? { etiqueta: labelNote } : {}), fusion: merge, siguiente,
  };
  const lines = parts.map((part) => `${part.parte}: ${part.linea}`);
  if (avisoChoqueFormal) lines.push(`Aviso: ${avisoChoqueFormal}`);
  for (const choque of choqueFormal) lines.push(`Choque formal: #${choque.pr} también regenera ${choque.archivos.join(", ")}; fusiona en el orden del coordinador`);
  lines.push(`Resultado: ${resultado} (${nivel})`);
  if (resultado === "listo" && ciclo.prAFusionarMin !== null) lines.push(`Ciclo: PR -> listo para fusionar ${ciclo.prAFusionarMin} min`);
  if (faltas.length) { lines.push("Falta:"); for (const falta of faltas) lines.push(`- ${falta.texto}`); }
  lines.push(`Estado en GitHub: ${estadoGithub}`);
  lines.push(`siguiente: ${siguiente}`);
  return { result, output: options.json ? JSON.stringify(result) : lines.join("\n"), json: options.json, code: resultado === "listo" ? 0 : 1 };
}

/** Every commit SHA of `from...to` on GitHub, paged fully. @param {string} owner @param {string} repo @param {string} from @param {string} to */
function rangeCommits(owner, repo, from, to) {
  /** @type {any[]} */
  const commits = [];
  let total = Infinity;
  for (let page = 1; commits.length < total; page += 1) {
    const compare = ghJson(`repos/${owner}/${repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}?per_page=100&page=${page}`);
    total = Number(compare.total_commits ?? 0);
    const batch = Array.isArray(compare.commits) ? compare.commits : [];
    if (batch.length === 0) break;
    commits.push(...batch);
    if (page > 200) throw new Error(`${from}...${to} tiene demasiados commits para leerlos`);
  }
  if (commits.length < total) throw new Error(`GitHub listó ${commits.length} de ${total} commits de ${from}...${to}`);
  return commits;
}

/**
 * `listo --produccion`: every pull request merged into the head branch whose merge commit is in base...head and not
 * older than `desde`, each with a complete record unless mecánico, and a `smoke` success on the head.
 * @param {ListoOptions & {produccion: string, now?: number}} options
 */
export function listoProduccion(options) {
  const match = /^([^/\s]+)\/([^/#\s]+)$/.exec(options.produccion);
  if (!match) throw new Error(`--produccion ${options.produccion}: usa <owner/repo>`);
  const [, owner, repo] = match;
  const baseBranch = options.base ?? "main";
  const headBranch = options.head ?? "develop";
  const api = `repos/${owner}/${repo}`;
  const draft = options.niveles ? path.resolve(options.niveles) : undefined;
  // File contents of commits the checkout has are read with git: run it from the repository's checkout (or --repo).
  if (options.repo) process.chdir(path.resolve(options.repo));
  const headSha = String(ghJson(`${api}/commits/${encodeURIComponent(headBranch)}`).sha);
  const loaded = loadNiveles({ gh, owner, repo, ref: headBranch, file: draft });
  const generados = generadosContext(loaded.config, path.resolve(options.home ?? homedir()), owner, repo);
  const range = rangeCommits(owner, repo, baseBranch, headSha);
  const inRange = new Set(range.map((commit) => String(commit.sha)));
  /** @type {Set<string> | null} */
  let afterDesde = null;
  let desdeText = "sin «desde»: entran todos los PRs del rango";
  if (loaded.config?.desde) {
    const desde = String(ghJson(`${api}/commits/${loaded.config.desde}`).sha);
    if (!ancestorOrEqual(api, desde, headSha)) throw new Error(`«desde» ${loaded.config.desde} no está en ${headBranch}`);
    // `desde` is the last commit already outside the check: the PR it merged is not in the range.
    afterDesde = new Set(rangeCommits(owner, repo, desde, headSha).map((commit) => String(commit.sha)));
    desdeText = `desde ${short(desde)}`;
  }
  // The oldest commit that can be a merge commit in the range bounds how far back the merged PRs are paged.
  const candidates = range.filter((commit) => !afterDesde || afterDesde.has(String(commit.sha)));
  const oldest = Math.min(...candidates.map((commit) => Date.parse(commit.commit?.committer?.date ?? commit.commit?.author?.date ?? "")).filter(Number.isFinite));
  /** @type {any[]} */
  const pulls = [];
  for (let page = 1; candidates.length; page += 1) {
    const batch = ghJson(`${api}/pulls?state=closed&base=${encodeURIComponent(headBranch)}&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const pull of batch) if (pull.merged_at && inRange.has(String(pull.merge_commit_sha)) && (!afterDesde || afterDesde.has(String(pull.merge_commit_sha)))) pulls.push(pull);
    // A PR merged into the range was updated no earlier than its merge commit; a day of slack covers clock skew.
    if (batch.every((pull) => Date.parse(pull.updated_at) < oldest - 86_400_000)) break;
  }
  const hotfix = headBranch !== "develop";
  const abiertos = hotfix ? ghList(`${api}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&head=${encodeURIComponent(`${owner}:${headBranch}`)}&per_page=100`).filter((pull) => pull.head.ref === headBranch && pull.base.ref === baseBranch && pull.head.repo?.full_name?.toLowerCase() === `${owner}/${repo}`.toLowerCase()) : [];
  for (const pull of abiertos) if (!pulls.some((entry) => entry.number === pull.number)) pulls.push(pull);
  const sinPr = hotfix && abiertos.length === 0 ? `sin PR abierto de ${headBranch} a ${baseBranch}` : "";
  // An open PR whose head is not the captured SHA would lend its record to another commit: block on any mismatch.
  const movidos = abiertos.filter((pull) => String(pull.head.sha) !== headSha).map((pull) => Number(pull.number));
  pulls.sort((a, b) => a.number - b.number);
  /** @type {{pr: number, nivel: Nivel, pendiente: string[], motivo: string}[]} */
  const rows = [];
  for (const pull of pulls) {
    const files = pullFiles(owner, repo, pull);
    const head = String(pull.head.sha);
    const classified = classifyFiles({ config: loaded.config, files, content: contentReader(owner, repo, head, mergeBaseOf(owner, repo, String(pull.base.sha), head)) });
    let nivel = classified.nivel;
    if (nivel === "mecánico" && (pull.labels ?? []).some((/** @type {any} */ label) => label.name === CRITICAL_LABEL)) nivel = "crítico";
    /** @type {string[]} */
    const pendiente = [];
    if (nivel !== "mecánico") {
      const newest = readRegistrosFor(owner, repo, pull.number)[0];
      if (!newest) pendiente.push("sin lectura registrada");
      else if (!newest.registro) pendiente.push("registro ilegible");
      else {
        const sha = newest.registro.sha.toLowerCase();
        // A record of an earlier commit still counts when the head covers it (clean merges of the base),
        // the same rule `listo` applied before the merge.
        const atHead = sha.length >= 7 && (head.startsWith(sha) || String(pull.merge_commit_sha ?? "").startsWith(sha));
        const coveredByHead = () => {
          if (!/^[0-9a-f]{40}$/.test(sha)) return false;
          try { return coverage({ base: api, from: sha, to: head, findings: [], peers: [], records: [], baseRef: pull.merged_at ? headBranch : String(pull.base.ref), prChanged: new Set(files.flatMap(namesOf)), generados }).covered === true; } catch { return false; }
        };
        if (!atHead && !coveredByHead()) pendiente.push(`registro de otro commit (${short(sha)})`);
        else {
          const verdict = evaluateRegistro(newest.registro);
          if (verdict.abiertos.length) pendiente.push("hallazgo vivo abierto");
          if (verdict.faltas.some((text) => /^caso/.test(text))) pendiente.push("caso necesario sin pasar ni dispensa");
          if (!verdict.completo && pendiente.length === 0) pendiente.push("registro incompleto");
        }
      }
    }
    rows.push({ pr: pull.number, nivel, pendiente, motivo: formatMotivos(classified) });
  }
  const smokeAplica = loaded.config?.smoke?.aplica !== false;
  const smoke = smokeAplica ? smokeStatus(owner, repo, headSha) : `no aplica (${loaded.config?.smoke?.motivo ?? "sin app web"})`;
  /** @type {Map<string, number[]>} */
  const byReason = new Map();
  for (const row of rows) for (const reason of row.pendiente) byReason.set(reason.replace(/ \([0-9a-f]+\)$/, ""), [...(byReason.get(reason.replace(/ \([0-9a-f]+\)$/, "")) ?? []), row.pr]);
  const smokeMissing = smokeAplica && smoke !== "success";
  if (sinPr) byReason.set(sinPr, []);
  if (movidos.length) byReason.set(`la punta del PR no es ${short(headSha)}`, movidos);
  // The branch can move while the PRs are read: a status is only published on the SHA that is still the head.
  const finalSha = String(ghJson(`${api}/commits/${encodeURIComponent(headBranch)}`).sha);
  if (finalSha !== headSha) byReason.set(`${headBranch} se movió a ${short(finalSha)} durante la comprobación`, []);
  const pending = byReason.size > 0 || smokeMissing;
  let estadoGithub = "no publicado (--sin-estado)";
  const firstReason = [...byReason.entries()][0];
  const description = pending ? (firstReason ? `${firstReason[0]}${firstReason[1].length ? `: ${firstReason[1].map((n) => `#${n}`).join(", ")}` : ""}` : `smoke ${smoke} en la punta`) : `${rows.length} PRs sin pendientes`;
  if (!options.sinEstado) {
    gh(["api", `${api}/statuses/${headSha}`, "-f", `state=${pending ? "failure" : "success"}`, "-f", `context=${PRODUCCION_CONTEXT}`, "-f", `description=${description.slice(0, 140)}`]);
    estadoGithub = `«${PRODUCCION_CONTEXT}» = ${pending ? "failure" : "success"} en ${short(headSha)}`;
  }
  const unread = rows.filter((row) => row.pendiente.length > 0 && row.nivel !== "mecánico").map((row) => row.pr);
  const readStep = unread.length ? `una lectura por lote de lo pendiente, sus casos recorridos y: development-system registro --lote ${owner}/${repo} --prs ${unread.join(",")} --entorno <url|local> --lector <modelo> --lectura <hilo> --veredicto sin-vivos|vivos --necesario "N1: <caso>" --caso "pass: N1 … => …" --autor <modelo>` : "";
  const smokeStep = smokeMissing ? `development-system smoke --repo <checkout limpio en ${short(headSha)}> --base <url>` : "";
  const siguiente = !pending ? `pasa a producción con la aprobación del dueño (${baseBranch} ← ${headBranch} en ${short(headSha)})` : [sinPr ? `abre un PR de ${headBranch} a ${baseBranch}` : "", readStep, smokeStep].filter(Boolean).join("; y ");
  const lines = [`Producción ${owner}/${repo}: ${baseBranch}...${headBranch} (punta ${short(headSha)}), ${desdeText}: ${rows.length} PRs [${loaded.fuente}]`];
  if (loaded.aviso) lines.push(`Aviso: ${loaded.aviso}`);
  const count = (/** @type {Nivel} */ level) => rows.filter((row) => row.nivel === level).length;
  lines.push(`Niveles: ${count("crítico")} crítico, ${count("normal")} normal, ${count("mecánico")} mecánico`);
  for (const row of rows) lines.push(`- #${row.pr} ${row.nivel}: ${row.pendiente.length ? row.pendiente.join("; ") : row.nivel === "mecánico" ? "sin requisitos (mecánico)" : "registro completo"}`);
  lines.push(`Smoke en la punta: ${smoke}`);
  if (pending) {
    lines.push("Pendiente:");
    for (const [reason, prs] of byReason) lines.push(`- ${reason}${prs.length ? ` (${prs.length}): ${prs.map((n) => `#${n}`).join(", ")}` : ""}`);
    if (smokeMissing) lines.push(`- smoke: la punta ${short(headSha)} no tiene smoke success (${smoke})`);
  }
  lines.push(`Resultado: ${pending ? "falta" : "listo"}`);
  lines.push(`Estado en GitHub: ${estadoGithub}`);
  lines.push(`siguiente: ${siguiente}`);
  const result = { ok: !pending, operation: "listo-produccion", repo: `${owner}/${repo}`, base: baseBranch, head: headBranch, headSha, fuente: loaded.fuente, aviso: loaded.aviso ?? null, prs: rows, smoke, pendiente: Object.fromEntries(byReason), resultado: pending ? "falta" : "listo", estadoGithub, siguiente };
  return { result, output: options.json ? JSON.stringify(result) : lines.join("\n"), json: options.json, code: pending ? 1 : 0 };
}

/** @param {string} owner @param {string} repo @param {number} number */
const readRegistrosFor = (owner, repo, number) => registrosOf(ghList(`repos/${owner}/${repo}/issues/${number}/comments?per_page=100`));

/** CLI entry. @param {string[]} argv arguments after `listo` */
export function runListoCommand(argv) {
  const options = parseListoArgs(argv);
  if (options.produccion) return listoProduccion({ ...options, produccion: options.produccion });
  return listo({ ...options, pr: /** @type {string} */ (options.pr) });
}
