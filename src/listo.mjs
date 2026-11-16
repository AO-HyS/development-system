// @ts-check
// `development-system listo` (3.0.0, propuesta «libre por defecto» v4, secciones B, C y D): the one gate an agent runs
// right before merging. It classifies the pull request (niveles.mjs), applies the Codex rule, reads the record of
// the independent read (registro.mjs), checks lint/typecheck once per tree, shows the smoke, and publishes a commit
// status on the exact head (`listo para fusionar`) that the branch rules of develop require. `--produccion` does the
// same for the range promoted to main (`listo para producción`). No hooks, no ledger, no GitHub Actions: GitHub
// holds every fact, so any thread can rebuild the state.
//
// Codex (section C): it passes when Codex finished a review on a commit of the PR, the interval from that commit to
// the head is covered (pr-review-status.mjs `coverage`: clean base merges and commits cited as fixes), and every
// Codex thread is answered (codex-threads.mjs `threadStates`: fixed or rejected; never `isResolved`, never the
// summary's boolean). One clock per PR, never restarted: 15 minutes from the first `@codex review` request, or from
// the PR's creation without one. Inside the clock the result is `espera`; after it, or when Codex says it cannot
// review, the Codex condition is dropped and the PR becomes crítico (a read before merging). An unanswered thread
// always blocks. A rejected P0/P1, unprioritized or critical-domain thread raises the PR to crítico and is closed
// only by a record posted after the rejection that names it (`--cubre codex:<id>`).
//
// 3.1.0: Codex also reads the merged head and often answers minutes after the merge, when nobody looks. `--barrido`
// lists the unanswered threads of recently merged PRs and `--produccion` holds while one exists (pendingCodexThreads).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { codexThreads, threadStates } from "./codex-threads.mjs";
import { changedFile, parsePrReference } from "./evidence.mjs";
import { classifyFiles, firstMatch, formatMotivos, loadNiveles, namesOf, raise } from "./niveles.mjs";
import { ancestorOrEqual, coverage, parsePr, summaryStates } from "./pr-review-status.mjs";
import { evaluateRegistro, registrosOf } from "./registro.mjs";
import { SMOKE_CONTEXT } from "./smoke.mjs";

export const LISTO_CONTEXT = "listo para fusionar";
export const PRODUCCION_CONTEXT = "listo para producción";
export const CRITICAL_LABEL = "nivel:critico";
export const CODEX_CLOCK_MINUTES = 15;
// Same app, marker and request shape pr-review-status.mjs reads (constants there are module-private).
const APP_LOGIN = "chatgpt-codex-connector";
const REQUEST_MARKER = "ds-codex-review-request";
const REQUEST = /^\s*@codex\s+review\b/i;
// The causes pr-review-status.mjs treats as terminal: Codex will not answer this request.
const TERMINAL = /usage limit|quota|not enabled|no access|couldn['’]?t review|could not review|unable to review/i;
const CHECK_TIMEOUT_MS = 30 * 60_000;

/** @param {string[]} args */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
/** @param {string} api */
const ghJson = (api) => JSON.parse(gh(["api", api]));
/** @param {string} api @returns {any[]} */
const ghList = (api) => JSON.parse(gh(["api", "--paginate", "--slurp", api])).flat();
/** @param {any} user REST user */
const isCodexApp = (user) => user?.type === "Bot" && user?.login === `${APP_LOGIN}[bot]`;
/** @param {unknown} error */
const errorText = (error) => String(/** @type {{stderr?: string}} */ (error)?.stderr || (error instanceof Error ? error.message : error)).trim().split("\n")[0];
/** @param {number} ms */
const clock = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
/** @param {string} sha */
const short = (sha) => sha.slice(0, 12);

/**
 * @typedef {{texto: string, comando: string}} Falta
 * @typedef {import("./niveles.mjs").Nivel} Nivel
 * @typedef {import("./niveles.mjs").Niveles} Niveles
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
 * The Codex rule for one pull request.
 * @param {{owner: string, repo: string, pull: any, head: string, baseRef: string, prCommits: string[], comments: any[], threads: any[], registros: import("./registro.mjs").RegistroLeido[], prChanged: Set<string>, now: number}} input
 */
function codexRule({ owner, repo, pull, head, baseRef, prCommits, comments, threads, registros, prChanged, now }) {
  const base = `repos/${owner}/${repo}`;
  const reviews = ghList(`${base}/pulls/${pull.number}/reviews?per_page=100`).filter((review) => isCodexApp(review.user) && /Codex Review|Reviewed commit/.test(String(review.body)));
  const appComments = comments.filter((comment) => isCodexApp(comment.user)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  /** @param {string} cited */
  const prCommit = (cited) => (cited.length >= 7 ? prCommits.find((sha) => sha.startsWith(cited)) ?? "" : "");
  const reviewed = new Set([
    ...reviews.map((review) => prCommit(String(review.commit_id))),
    ...appComments.filter((comment) => String(comment.body).includes("codex-review-receipt:v1")).map((comment) => prCommit(/Reviewed commit:?\**:?\s*`([0-9a-f]{7,40})`/.exec(String(comment.body))?.[1] ?? "")),
    ...summaryStates(appComments).filter((summary) => /completed/i.test(summary.status)).map((summary) => prCommit(summary.sha)),
  ].filter(Boolean));
  const latest = [...prCommits].reverse().find((sha) => reviewed.has(sha)) ?? "";
  const findings = threads.map((thread) => ({ id: `codex:${thread.comments.nodes[0].databaseId}`, paths: [String(thread.path)], origin: String(thread.origin) }));
  /** @type {ReturnType<typeof coverage> | null} */
  let cover = null;
  if (latest && latest !== head) {
    cover = coverage({ base, from: latest, to: head, findings: findings.filter((finding) => finding.origin === latest), peers: findings.filter((finding) => finding.origin && finding.origin !== latest), records: [], baseRef, prChanged });
  }
  const covered = latest !== "" && (latest === head || cover?.covered === true);
  const requests = comments.filter((comment) => comment.user?.type === "User" && REQUEST.test(String(comment.body))).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const startedAt = requests.length ? Date.parse(requests[0].created_at) : Date.parse(pull.created_at);
  const deadline = startedAt + CODEX_CLOCK_MINUTES * 60_000;
  const terminal = appComments.find((comment) => Date.parse(comment.created_at) >= startedAt && !/codex-pull-request-review-summary|codex-review-receipt:v1/.test(String(comment.body)) && TERMINAL.test(String(comment.body)));
  // Answered, not resolved: a thread cites a later fix commit of the PR touching its file, or rejects it.
  const commitInfo = (/** @type {string} */ cited) => {
    const sha = prCommit(cited);
    if (!sha) return null;
    const files = ghJson(`${base}/commits/${sha}`).files ?? [];
    return { sha, files: files.flatMap((/** @type {any} */ file) => [String(file.filename), ...(file.previous_filename ? [String(file.previous_filename)] : [])]), after: (/** @type {string} */ origin) => origin !== sha && ancestorOrEqual(base, origin, sha) };
  };
  const states = threadStates({ threads, commitInfo, solRoundsAt: [] });
  // A critical rejection is read by a record posted after it that names the thread: threadStates compares the
  // rejection's time with those records' times exactly as it did with the reserved review rounds.
  const critical = states.filter((state) => state.state === "rejected-needs-sol").map((state) => {
    const thread = threads.find((candidate) => `codex:${candidate.comments.nodes[0].databaseId}` === state.id);
    const naming = registros.filter((entry) => entry.registro?.cubre.includes(state.id)).map((entry) => Date.parse(entry.at));
    const closed = naming.length > 0 && threadStates({ threads: [thread], commitInfo, solRoundsAt: naming })[0].state === "rejected";
    return { ...state, cerrado: closed };
  });
  const open = states.filter((state) => state.state === "open" || state.state === "unverified");
  /** @type {"cumple" | "espera" | "vencido" | "falló"} */
  const estado = covered ? "cumple" : terminal ? "falló" : now < deadline ? "espera" : "vencido";
  const firstProblem = cover?.commits.find((commit) => commit.problem);
  const why = !latest ? "sin una revisión terminada sobre un commit del PR" : `revisó ${short(latest)} pero ${cover?.reason ?? "la punta no está cubierta"}${firstProblem ? ` (${short(firstProblem.sha)}: ${firstProblem.problem})` : ""}`;
  const from = requests.length ? "la primera petición" : "la creación del PR";
  const answered = states.filter((state) => state.state === "fixed" || state.state === "rejected" || state.state === "rejected-needs-sol");
  const threadsText = threads.length ? `; hilos: ${answered.length} de ${threads.length} contestados` : "; sin hilos";
  let linea;
  if (estado === "cumple") linea = `revisó ${short(latest)}${latest === head ? " (la punta)" : ` y la punta está cubierta (${cover?.reason})`}${threadsText}`;
  else if (estado === "espera") linea = `en espera hasta las ${clock(deadline)} (faltan ${Math.max(1, Math.ceil((deadline - now) / 60_000))} min, reloj desde ${from}); ${why}${threadsText}`;
  else if (estado === "falló") linea = `Codex no puede revisar («${String(terminal?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}»): se deja Codex y el PR pasa a crítico${threadsText}`;
  else linea = `el reloj venció a las ${clock(deadline)} (desde ${from}), ${why}: se deja Codex y el PR pasa a crítico${threadsText}`;
  return { estado, linea, revisado: latest, cobertura: cover, inicio: new Date(startedAt).toISOString(), vence: new Date(deadline).toISOString(), pedidos: requests.length, hilos: states, abiertos: open, criticos: critical };
}

/**
 * lint/typecheck once per tree: a pass record per tree hash; a command runs only when that tree has no pass and the
 * local checkout is clean and at the head.
 * @param {{config: Niveles | null, owner: string, repo: string, head: string, home: string, checkout: string, prKey: string}} input
 */
function checksPart({ config, owner, repo, head, home, checkout, prKey }) {
  const commands = config?.comprobaciones ?? [];
  if (commands.length === 0) return { linea: "las comprobaciones corren en los hooks del repositorio", faltas: /** @type {Falta[]} */ ([]), arbol: "" };
  const tree = String(ghJson(`repos/${owner}/${repo}/git/commits/${head}`).tree?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error(`GitHub no dio el árbol de ${short(head)}`);
  // Lowercase owner and repo, as the evidence receipts key them, so one repository has one folder.
  const key = parsePrReference(prKey);
  const directory = path.join(home, ".development-system/private/listo/checks", `${key.owner}-${key.repo}`);
  const file = path.join(directory, `${tree}.json`);
  /** @type {{tree: string, resultados: Record<string, {ok: boolean, en: string, ms: number, sha: string, salida?: number}>}} */
  let store = { tree, resultados: {} };
  if (existsSync(file)) { try { store = JSON.parse(readFileSync(file, "utf8")); } catch { store = { tree, resultados: {} }; } }
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
      for (const command of pending) {
        process.stderr.write(`listo: corriendo «${command}» en ${top} (árbol ${short(tree)})\n`);
        const started = Date.now();
        const child = spawnSync(command, { cwd: top, shell: true, stdio: ["ignore", 2, 2], timeout: CHECK_TIMEOUT_MS });
        store.resultados = { ...store.resultados, [command]: { ok: child.status === 0, en: new Date().toISOString(), ms: Date.now() - started, sha: head, salida: child.status ?? -1 } };
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
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

/** The `smoke` commit status of a commit: success, failure, pending, error or «sin correr». @param {string} owner @param {string} repo @param {string} sha */
function smokeStatus(owner, repo, sha) {
  const combined = ghJson(`repos/${owner}/${repo}/commits/${sha}/status?per_page=100`);
  const status = (combined.statuses ?? []).find((/** @type {any} */ entry) => entry.context === SMOKE_CONTEXT);
  return status ? String(status.state) : "sin correr";
}

/**
 * The record the gate reads for crítico: the newest record on the PR, for the head (or the merge commit of a merged
 * PR), or for a commit the head covers by the Codex coverage rule.
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
 * @typedef {{pr?: string, produccion?: string, barrido?: string, dias?: string, base?: string, head?: string, subir?: string, pedir: boolean, sinEstado: boolean, niveles?: string, repo?: string, home?: string, json: boolean}} ListoOptions
 */

/** @param {string[]} argv arguments after `listo` @returns {ListoOptions} */
export function parseListoArgs(argv) {
  /** @type {ListoOptions} */
  const options = { pedir: false, sinEstado: false, json: false };
  const valued = /** @type {const} */ (["--produccion", "--barrido", "--dias", "--base", "--head", "--subir", "--niveles", "--repo", "--home"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--pedir") { options.pedir = true; continue; }
    if (arg === "--sin-estado") { options.sinEstado = true; continue; }
    if (/** @type {readonly string[]} */ (valued).includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} necesita un valor`);
      options[/** @type {"produccion" | "barrido" | "dias" | "base" | "head" | "subir" | "niveles" | "repo" | "home"} */ (arg.slice(2))] = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`opción desconocida para listo: ${arg}`);
    if (options.pr) throw new Error("listo toma un solo PR");
    options.pr = arg;
  }
  if (options.barrido) {
    // 3.1.0: the sweep reads merged PRs of a repository; it neither takes a PR nor publishes anything.
    if (options.pr || options.produccion) throw new Error("usa listo --barrido <owner/repo> solo: sin PR y sin --produccion");
    if (options.pedir || options.subir || options.niveles || options.base) throw new Error("--barrido no toma --pedir, --subir, --niveles ni --base: solo lee los hilos de Codex de los PRs fusionados en --head");
    if (options.dias !== undefined && !/^[1-9]\d*$/.test(options.dias)) throw new Error(`--dias ${options.dias}: usa un entero positivo`);
    return options;
  }
  if (options.dias !== undefined) throw new Error("--dias va con --barrido");
  if (options.produccion && options.pr) throw new Error("usa listo <owner/repo#n> o listo --produccion <owner/repo>, no los dos");
  if (!options.produccion && !options.pr) throw new Error("falta el PR: development-system listo <owner/repo#n>");
  if (!options.produccion && (options.base || options.head)) throw new Error("--base y --head van con --produccion o --barrido");
  if (options.produccion && (options.pedir || options.subir)) throw new Error("--pedir y --subir van con un PR, no con --produccion");
  if (options.subir !== undefined && options.subir !== "critico") throw new Error(`--subir ${options.subir}: el único valor es critico`);
  if (options.niveles && !options.sinEstado) throw new Error("--niveles (un borrador) solo va con --sin-estado: el estado publicado se decide con config/niveles.json de la rama base");
  if (options.pedir && options.sinEstado) throw new Error("--pedir publica una petición a Codex; --sin-estado no publica nada: usa uno de los dos");
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
  const loaded = loadNiveles({ gh, owner, repo, ref: baseRef, file: draft });
  const files = pullFiles(owner, repo, pull);
  const prChanged = new Set(files.flatMap(namesOf));
  const classified = classifyFiles({ config: loaded.config, files, content: contentReader(owner, repo, head, mergeBaseOf(owner, repo, baseRef, head)) });
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
  // 3. Codex.
  let comments = ghList(`${base}/issues/${number}/comments?per_page=100`);
  if (options.pedir) {
    if (comments.some((comment) => comment.user?.type === "User" && REQUEST.test(String(comment.body)))) parts.push({ parte: "Pedir", linea: "ya hay una petición a Codex; el reloj no se reinicia" });
    else {
      const posted = JSON.parse(gh(["api", `${base}/issues/${number}/comments`, "-f", `body=@codex review\n\n<!-- ${REQUEST_MARKER} sha=${head} -->`]));
      comments = [...comments, posted];
      parts.push({ parte: "Pedir", linea: `petición a Codex publicada para ${short(head)}` });
    }
  }
  const registros = registrosOf(comments);
  const prCommits = ghList(`${base}/pulls/${number}/commits?per_page=100`).map((commit) => String(commit.sha));
  const threads = codexThreads(gh, owner, repo, number);
  const codex = codexRule({ owner, repo, pull, head, baseRef, prCommits, comments, threads, registros, prChanged, now });
  if (codex.criticos.length) { nivel = raise(nivel, "crítico"); raised.push(`rechazo crítico de Codex ${codex.criticos.map((thread) => thread.id).join(", ")}`); }
  if (codex.estado === "vencido" || codex.estado === "falló") { nivel = raise(nivel, "crítico"); raised.push(codex.estado === "vencido" ? "reloj de Codex vencido" : "Codex no puede revisar"); }
  parts.push({ parte: "Nivel", linea: `${nivel}${nivel === classified.nivel ? "" : ` (por rutas ${classified.nivel}; sube por: ${raised.join(", ")})`} — ${formatMotivos(classified)}${nivel === classified.nivel && raised.length ? `; también: ${raised.join(", ")}` : ""} [${loaded.fuente}]` });
  if (loaded.aviso) parts.push({ parte: "Aviso", linea: loaded.aviso });
  parts.push({ parte: "Codex", linea: codex.linea });
  // The coverage walk proves a clean base merge by rebuilding it with git here; without the PR's objects it cannot.
  if (codex.cobertura && !localCommit(head)) parts.push({ parte: "Aviso", linea: `${process.cwd()} no tiene ${short(head)}: una fusión con ${baseRef} no se puede probar limpia desde aquí; corre listo desde el checkout del repositorio (o --repo) después de git fetch` });
  for (const thread of codex.abiertos) {
    faltas.push({ texto: `hilo de Codex ${thread.id} sin contestar${thread.priority === null ? "" : ` (P${thread.priority})`} en ${thread.path}: ${thread.finding} (${thread.detail})`, comando: `contesta en ese hilo con el commit del arreglo (posterior a lo revisado y que toque ${thread.path}) o «Rechazado: <motivo>»; después development-system listo ${prKey}` });
  }
  // 4. Checks once per tree.
  const checks = checksPart({ config: loaded.config, owner, repo, head, home, checkout, prKey });
  parts.push({ parte: "Comprobaciones", linea: checks.linea });
  faltas.push(...checks.faltas);
  // 5. Smoke, informative only.
  const smokeFiles = loaded.config ? files.filter((file) => namesOf(file).some((name) => firstMatch(/** @type {Niveles} */ (loaded.config).smoke.rutas, name))) : [];
  parts.push({ parte: "Smoke", linea: smokeFiles.length ? `${smokeStatus(owner, repo, head)} en ${short(head)} (informativo; no frena develop)` : "no aplica (ningún archivo en smoke.rutas)" });
  // 6. Crítico: a complete record; 7. normal: pending the batch read.
  /** @type {ReturnType<typeof recordPart> | null} */
  let record = null;
  const mergeSha = merged ? String(pull.merge_commit_sha ?? "") : "";
  const allFindings = threads.map((thread) => ({ id: `codex:${thread.comments.nodes[0].databaseId}`, paths: [String(thread.path)] }));
  const registroCommand = (/** @type {string[]} */ cubre) => `development-system registro ${prKey} --sha ${head} --entorno <url|local> --lector <modelo> --lectura <hilo de la lectura> --veredicto sin-vivos|vivos --necesario "N1: <caso>" --caso "pass: N1 <qué se intentó> => <qué se observó>" --autor <modelo que escribió el cambio>${cubre.map((id) => ` --cubre ${id}`).join("")}`;
  const unclosed = codex.criticos.filter((thread) => !thread.cerrado);
  if (nivel === "crítico") {
    record = recordPart({ registros, head, merge: mergeSha, cover: (from) => coverage({ base, from, to: head, findings: allFindings, peers: [], records: [], baseRef, prChanged }) });
    parts.push({ parte: "Registro", linea: record.linea });
    for (const texto of record.faltas) faltas.push({ texto, comando: registroCommand(unclosed.map((thread) => thread.id)) });
    for (const thread of unclosed) faltas.push({ texto: `el rechazo de ${thread.id}${thread.priority === null ? "" : ` (P${thread.priority})`} en ${thread.path} necesita una lectura posterior que lo nombre`, comando: registroCommand(unclosed.map((entry) => entry.id)) });
  } else if (nivel === "normal") parts.push({ parte: "Lectura", linea: "queda sin verificar hasta la lectura por lote (antes de pasar a main)" });
  else parts.push({ parte: "Lectura", linea: "mecánico: sin lectura" });
  /** @type {"listo" | "espera" | "falta"} */
  const resultado = faltas.length ? "falta" : codex.estado === "espera" ? "espera" : "listo";
  const first = faltas[0]?.texto ?? (resultado === "espera" ? `Codex en espera hasta las ${clock(Date.parse(codex.vence))}` : "listo");
  let estadoGithub = "no publicado (--sin-estado)";
  if (!options.sinEstado) {
    const ghState = resultado === "listo" ? "success" : resultado === "espera" ? "pending" : "failure";
    gh(["api", `${base}/statuses/${head}`, "-f", `state=${ghState}`, "-f", `context=${LISTO_CONTEXT}`, "-f", `description=${`${nivel}: ${first}`.slice(0, 140)}`]);
    estadoGithub = `«${LISTO_CONTEXT}» = ${ghState} en ${short(head)}`;
  }
  const merge = resultado === "listo" && pull.state === "open" ? `gh pr merge ${number} --repo ${owner}/${repo} ${mergeMethod(owner, repo)} --match-head-commit ${head}` : "";
  const siguiente = resultado === "listo" ? (merge ? `fusiona: ${merge}` : "nada: el PR ya no está abierto") : resultado === "espera" ? `espera a Codex y corre de nuevo development-system listo ${prKey} a las ${clock(Date.parse(codex.vence))}` : faltas[0].comando;
  const result = {
    ok: resultado === "listo", operation: "listo", pr: prKey, head, base: baseRef, estadoPr: state, nivel, nivelPorRutas: classified.nivel, motivos: classified.motivos, subePor: raised, aviso: loaded.aviso ?? null, fuente: loaded.fuente,
    codex: { estado: codex.estado, revisado: codex.revisado, inicio: codex.inicio, vence: codex.vence, pedidos: codex.pedidos, hilos: codex.hilos, criticos: codex.criticos, cobertura: codex.cobertura },
    comprobaciones: checks, registro: record, resultado, faltas, estadoGithub, ...(labelNote ? { etiqueta: labelNote } : {}), fusion: merge, siguiente,
  };
  const lines = parts.map((part) => `${part.parte}: ${part.linea}`);
  lines.push(`Resultado: ${resultado} (${nivel})${resultado === "espera" ? ` — ${first}` : ""}`);
  if (faltas.length) { lines.push("Falta:"); for (const falta of faltas) lines.push(`- ${falta.texto}`); }
  lines.push(`Estado en GitHub: ${estadoGithub}`);
  lines.push(`siguiente: ${siguiente}`);
  return { result, output: options.json ? JSON.stringify(result) : lines.join("\n"), json: options.json, code: resultado === "listo" ? 0 : resultado === "espera" ? 2 : 1 };
}

/**
 * @typedef {{pr: number, id: string, priority: number | null, tardio: boolean, path: string, finding: string, url: string, estado: "open" | "unverified" | "rejected-needs-sol", detalle: string, escrito: string}} HiloPendiente
 */

/**
 * 3.1.0: the Codex threads of a MERGED pull request that still wait for an answer, read the same way by
 * `listo --barrido` and `listo --produccion`: state open or unverified, and a critical rejection (P0, P1, no readable
 * priority or a critical domain) that no record posted after it names (`registro … --cubre codex:<id>`), exactly as
 * `listo <pr>` holds it before the merge. For a merged PR the fix usually lives in a later PR, so a cited SHA is the
 * fix when the commit exists in the repository, reached the head branch (contained in `headSha`, or a commit of this
 * PR, which a squash merge leaves out of the branch), comes after what Codex reviewed (it descends from the reviewed
 * commit, or from this PR's merge commit, which is how a squash merge carries the reviewed code into the branch; a
 * commit of a line that diverged before the merge is not later, and the merge commit itself is never the fix) and
 * touches the thread's file. A thread is `tardío`
 * when Codex wrote it after the PR was merged.
 * @param {{owner: string, repo: string, pull: any, headBranch: string, headSha: string, threads?: any[], cache?: Map<string, any>}} input
 * @returns {HiloPendiente[]}
 */
export function pendingCodexThreads(input) {
  return mergedCodexThreads(input).filter((thread) => thread.estado === "open" || thread.estado === "unverified" || thread.estado === "rejected-needs-sol").map((thread) => /** @type {HiloPendiente} */ (thread));
}

/**
 * Every Codex thread of a merged pull request with its state by the rule of `pendingCodexThreads`.
 * @param {{owner: string, repo: string, pull: any, headBranch: string, headSha: string, threads?: any[], cache?: Map<string, any>}} input
 * @returns {(Omit<HiloPendiente, "estado"> & {estado: import("./codex-threads.mjs").ThreadState["state"]})[]}
 */
export function mergedCodexThreads({ owner, repo, pull, headBranch, headSha, threads, cache = new Map() }) {
  const api = `repos/${owner}/${repo}`;
  const read = threads ?? codexThreads(gh, owner, repo, pull.number);
  if (read.length === 0) return [];
  const mergedAt = Date.parse(String(pull.merged_at ?? ""));
  /** @type {string[] | null} */
  let prCommits = null;
  /** @param {string} key @param {() => any} compute */
  const memo = (key, compute) => { if (!cache.has(key)) cache.set(key, compute()); return cache.get(key); };
  const commitInfo = (/** @type {string} */ cited) => {
    const wanted = cited.toLowerCase();
    /** @type {any} */
    const commit = memo(`commit:${wanted}`, () => {
      try { return ghJson(`${api}/commits/${wanted}`); } catch (error) {
        if (/HTTP 404|HTTP 422|Not Found|No commit found/i.test(errorText(error))) return null;
        throw error;
      }
    });
    const sha = String(commit?.sha ?? "");
    if (!/^[0-9a-f]{40}$/.test(sha) || !sha.startsWith(wanted)) return null;
    prCommits ??= ghList(`${api}/pulls/${pull.number}/commits?per_page=100`).map((entry) => String(entry.sha));
    const reached = prCommits.includes(sha) || memo(`in:${sha}:${headSha}`, () => ancestorOrEqual(api, sha, headSha));
    if (!reached) return null;
    const files = (commit.files ?? []).flatMap((/** @type {any} */ file) => [String(file.filename), ...(file.previous_filename ? [String(file.previous_filename)] : [])]);
    const mergeSha = String(pull.merge_commit_sha ?? "");
    const descends = (/** @type {string} */ from) => /^[0-9a-f]{40}$/.test(from) && from !== sha && memo(`in:${from}:${sha}`, () => ancestorOrEqual(api, from, sha));
    // The PR's own merge commit touches every file of the PR and descends from what Codex reviewed: it is never a fix.
    return { sha, files, after: (/** @type {string} */ origin) => origin !== sha && sha !== mergeSha && (descends(origin) || descends(mergeSha)) };
  };
  /** @type {import("./registro.mjs").RegistroLeido[] | null} */
  let registros = null;
  const states = threadStates({ threads: read, commitInfo, solRoundsAt: [], where: headBranch }).map((state) => {
    if (state.state !== "rejected-needs-sol") return state;
    // The same closing `listo <pr>` gives a critical rejection: a record posted after it that names the thread.
    registros ??= readRegistrosFor(owner, repo, Number(pull.number));
    const naming = registros.filter((entry) => entry.registro?.cubre.includes(state.id)).map((entry) => Date.parse(entry.at));
    const thread = read.find((candidate) => `codex:${candidate.comments.nodes[0].databaseId}` === state.id);
    return naming.length ? threadStates({ threads: [thread], commitInfo, solRoundsAt: naming, where: headBranch })[0] : state;
  });
  return states.map((state) => {
    const thread = read.find((candidate) => `codex:${candidate.comments.nodes[0].databaseId}` === state.id);
    const first = thread.comments.nodes[0];
    const written = String(first.createdAt ?? "");
    return {
      pr: Number(pull.number), id: state.id, priority: state.priority, tardio: Number.isFinite(mergedAt) && Date.parse(written) > mergedAt,
      path: state.path, finding: state.finding, url: `https://github.com/${owner}/${repo}/pull/${pull.number}#discussion_r${first.databaseId}`,
      estado: state.state, detalle: state.detail, escrito: written,
    };
  });
}

/**
 * Every pull request merged into `headBranch` since `since` (ms), newest updates first, paged until a whole page was
 * last updated before `since` (a PR merged after it was updated no earlier than its merge).
 * @param {string} owner @param {string} repo @param {string} headBranch @param {number} since
 */
function mergedPullsSince(owner, repo, headBranch, since) {
  /** @type {any[]} */
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const batch = ghJson(`repos/${owner}/${repo}/pulls?state=closed&base=${encodeURIComponent(headBranch)}&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const pull of batch) if (pull.merged_at && Date.parse(pull.merged_at) >= since) pulls.push(pull);
    if (batch.every((pull) => Date.parse(pull.updated_at) < since)) break;
  }
  return pulls.sort((a, b) => a.number - b.number);
}

/** One pending thread as one line of output. @param {HiloPendiente} thread */
const pendingLine = (thread) => `- #${thread.pr} ${thread.id}${thread.priority === null ? "" : ` P${thread.priority}`}${thread.tardio ? " tardío" : ""}${thread.estado === "rejected-needs-sol" ? " rechazo crítico sin lectura" : ""} ${thread.path}: ${thread.finding} — ${thread.url}`;

export const BARRIDO_DIAS = 14;
export const CODEX_PENDIENTE = "hilo de Codex sin contestar";
const RECENT_MINUTES = 10;

/**
 * `listo --barrido <owner/repo>` (3.1.0): the Codex threads still unanswered on the pull requests merged into the head
 * branch in the last `--dias` days, the ones Codex wrote after the merge marked `tardío`. Read-only: it publishes no
 * status and writes nothing; it needs no `config/niveles.json`.
 * @param {ListoOptions & {barrido: string, now?: number}} options
 */
export function listoBarrido(options) {
  const match = /^([^/\s]+)\/([^/#\s]+)$/.exec(options.barrido);
  if (!match) throw new Error(`--barrido ${options.barrido}: usa <owner/repo>`);
  const [, owner, repo] = match;
  const now = options.now ?? Date.now();
  const headBranch = options.head ?? "develop";
  const dias = options.dias === undefined ? BARRIDO_DIAS : Number(options.dias);
  const since = now - dias * 86_400_000;
  const desde = new Date(since).toISOString().slice(0, 10);
  const headSha = String(ghJson(`repos/${owner}/${repo}/commits/${encodeURIComponent(headBranch)}`).sha);
  const pulls = mergedPullsSince(owner, repo, headBranch, since);
  /** @type {HiloPendiente[]} */
  const pendientes = [];
  /** @type {{pr: number, error: string}[]} */
  const errores = [];
  const cache = new Map();
  for (const pull of pulls) {
    try { pendientes.push(...pendingCodexThreads({ owner, repo, pull, headBranch, headSha, cache })); }
    catch (error) { errores.push({ pr: Number(pull.number), error: errorText(error) }); }
  }
  const recientes = pulls.filter((pull) => now - Date.parse(pull.merged_at) < RECENT_MINUTES * 60_000).map((pull) => Number(pull.number));
  const tardios = pendientes.filter((thread) => thread.tardio).length;
  const falta = pendientes.length > 0 || errores.length > 0;
  const command = `development-system listo --barrido ${owner}/${repo}${headBranch === "develop" ? "" : ` --head ${headBranch}`}${options.dias === undefined ? "" : ` --dias ${dias}`}`;
  const siguiente = pendientes.length
    ? `contesta en cada hilo con el commit del arreglo (cuando ya esté en ${headBranch} y toque el archivo del hilo) o «Rechazado: <motivo>»${pendientes.some((thread) => thread.estado === "rejected-needs-sol") ? "; un rechazo crítico se cierra con una lectura independiente registrada después: development-system registro <owner/repo#n> … --cubre codex:<id>" : ""}; después ${command}`
    : errores.length ? `revisa el error y corre de nuevo ${command}` : recientes.length ? `nada por ahora; corre de nuevo ${command} en ${RECENT_MINUTES} minutos` : "nada: ningún hilo de Codex pendiente";
  const lines = [`Barrido ${owner}/${repo}: ${pulls.length} PRs fusionados en ${headBranch} desde ${desde} (${dias} días, punta ${short(headSha)}); ${pendientes.length} hilos de Codex sin contestar, ${tardios} llegaron después de la fusión`];
  for (const thread of pendientes) lines.push(pendingLine(thread));
  for (const entry of errores) lines.push(`- #${entry.pr}: no pude leer sus hilos de Codex (${entry.error})`);
  if (recientes.length) lines.push(`Nota: ${recientes.map((n) => `#${n}`).join(", ")} ${recientes.length === 1 ? "se fusionó" : "se fusionaron"} hace menos de ${RECENT_MINUTES} minutos; Codex puede no haber terminado.`);
  lines.push(`Resultado: ${falta ? "falta" : "listo"}`);
  lines.push(`siguiente: ${siguiente}`);
  const result = { ok: !falta, operation: "listo-barrido", repo: `${owner}/${repo}`, head: headBranch, headSha, dias, desde, prs: pulls.map((pull) => Number(pull.number)), pendientes, tardios, errores, recientes, resultado: falta ? "falta" : "listo", siguiente };
  return { result, output: options.json ? JSON.stringify(result) : lines.join("\n"), json: options.json, code: falta ? 1 : 0 };
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
  pulls.sort((a, b) => a.number - b.number);
  /** @type {{pr: number, nivel: Nivel, pendiente: string[], motivo: string}[]} */
  const rows = [];
  /** @type {HiloPendiente[]} */
  const hilos = [];
  const cache = new Map();
  for (const pull of pulls) {
    const files = pullFiles(owner, repo, pull);
    const head = String(pull.head.sha);
    const classified = classifyFiles({ config: loaded.config, files, content: contentReader(owner, repo, head, mergeBaseOf(owner, repo, String(pull.base.sha), head)) });
    let nivel = classified.nivel;
    const threads = codexThreads(gh, owner, repo, pull.number);
    if (nivel === "mecánico") {
      if ((pull.labels ?? []).some((/** @type {any} */ label) => label.name === CRITICAL_LABEL)) nivel = "crítico";
      else {
        const states = threadStates({ threads, commitInfo: () => null, solRoundsAt: [] });
        if (states.some((thread) => thread.state === "rejected-needs-sol")) nivel = "crítico";
      }
    }
    /** @type {string[]} */
    const pendiente = [];
    if (nivel !== "mecánico") {
      const newest = readRegistrosFor(owner, repo, pull.number)[0];
      if (!newest) pendiente.push("sin lectura registrada");
      else if (!newest.registro) pendiente.push("registro ilegible");
      else {
        const sha = newest.registro.sha.toLowerCase();
        // A record of an earlier commit still counts when the head covers it (clean merges of the base, cited fixes),
        // the same rule `listo` applied before the merge.
        const atHead = sha.length >= 7 && (head.startsWith(sha) || String(pull.merge_commit_sha ?? "").startsWith(sha));
        const coveredByHead = () => {
          if (!/^[0-9a-f]{40}$/.test(sha)) return false;
          const findings = threads.map((thread) => ({ id: `codex:${thread.comments.nodes[0].databaseId}`, paths: [String(thread.path)] }));
          try { return coverage({ base: api, from: sha, to: head, findings, peers: [], records: [], baseRef: headBranch, prChanged: new Set(files.flatMap(namesOf)) }).covered === true; } catch { return false; }
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
    // 3.1.0: whatever the level, a Codex thread nobody answered (often written minutes after the merge) holds production.
    const pendingThreads = pendingCodexThreads({ owner, repo, pull, headBranch, headSha, threads, cache });
    if (pendingThreads.length) { pendiente.push(CODEX_PENDIENTE); hilos.push(...pendingThreads); }
    rows.push({ pr: pull.number, nivel, pendiente, motivo: formatMotivos(classified) });
  }
  const smoke = smokeStatus(owner, repo, headSha);
  /** @type {Map<string, number[]>} */
  const byReason = new Map();
  for (const row of rows) for (const reason of row.pendiente) byReason.set(reason.replace(/ \([0-9a-f]+\)$/, ""), [...(byReason.get(reason.replace(/ \([0-9a-f]+\)$/, "")) ?? []), row.pr]);
  const smokeMissing = smoke !== "success";
  const pending = byReason.size > 0 || smokeMissing;
  let estadoGithub = "no publicado (--sin-estado)";
  const firstReason = [...byReason.entries()][0];
  const description = pending ? (firstReason ? `${firstReason[0]}: ${firstReason[1].map((n) => `#${n}`).join(", ")}` : `smoke ${smoke} en la punta`) : `${rows.length} PRs sin pendientes`;
  if (!options.sinEstado) {
    gh(["api", `${api}/statuses/${headSha}`, "-f", `state=${pending ? "failure" : "success"}`, "-f", `context=${PRODUCCION_CONTEXT}`, "-f", `description=${description.slice(0, 140)}`]);
    estadoGithub = `«${PRODUCCION_CONTEXT}» = ${pending ? "failure" : "success"} en ${short(headSha)}`;
  }
  const unread = rows.filter((row) => row.pendiente.some((reason) => reason !== CODEX_PENDIENTE) && row.nivel !== "mecánico").map((row) => row.pr);
  // The sweep reads the same threads; its window reaches the oldest merge that still has one.
  const oldestThread = Math.min(...pulls.filter((pull) => hilos.some((thread) => thread.pr === pull.number)).map((pull) => Date.parse(pull.merged_at)));
  const sweepDays = Math.max(BARRIDO_DIAS, Math.ceil(((options.now ?? Date.now()) - oldestThread) / 86_400_000) + 1);
  const codexStep = hilos.length ? `contesta cada hilo de Codex que lista development-system listo --barrido ${owner}/${repo}${headBranch === "develop" ? "" : ` --head ${headBranch}`}${sweepDays === BARRIDO_DIAS ? "" : ` --dias ${sweepDays}`}` : "";
  const readStep = unread.length ? `una lectura por lote de lo pendiente, sus casos recorridos y: development-system registro --lote ${owner}/${repo} --prs ${unread.join(",")} --entorno <url|local> --lector <modelo> --lectura <hilo> --veredicto sin-vivos|vivos --necesario "N1: <caso>" --caso "pass: N1 … => …" --autor <modelo>` : "";
  const smokeStep = smokeMissing ? `development-system smoke --repo <checkout limpio en ${short(headSha)}> --base <url>` : "";
  const siguiente = !pending ? `pasa a producción con la aprobación del dueño (${baseBranch} ← ${headBranch} en ${short(headSha)})` : [codexStep, readStep, smokeStep].filter(Boolean).join("; y ");
  const lines = [`Producción ${owner}/${repo}: ${baseBranch}...${headBranch} (punta ${short(headSha)}), ${desdeText}: ${rows.length} PRs [${loaded.fuente}]`];
  if (loaded.aviso) lines.push(`Aviso: ${loaded.aviso}`);
  const count = (/** @type {Nivel} */ level) => rows.filter((row) => row.nivel === level).length;
  lines.push(`Niveles: ${count("crítico")} crítico, ${count("normal")} normal, ${count("mecánico")} mecánico`);
  for (const row of rows) lines.push(`- #${row.pr} ${row.nivel}: ${row.pendiente.length ? row.pendiente.join("; ") : row.nivel === "mecánico" ? "sin requisitos (mecánico)" : "registro completo"}`);
  lines.push(`Smoke en la punta: ${smoke}`);
  if (pending) {
    lines.push("Pendiente:");
    for (const [reason, prs] of byReason) lines.push(`- ${reason} (${prs.length}): ${prs.map((n) => `#${n}`).join(", ")}`);
    if (smokeMissing) lines.push(`- smoke: la punta ${short(headSha)} no tiene smoke success (${smoke})`);
  }
  if (hilos.length) { lines.push("Hilos de Codex sin contestar:"); for (const thread of hilos) lines.push(pendingLine(thread)); }
  lines.push(`Resultado: ${pending ? "falta" : "listo"}`);
  lines.push(`Estado en GitHub: ${estadoGithub}`);
  lines.push(`siguiente: ${siguiente}`);
  const result = { ok: !pending, operation: "listo-produccion", repo: `${owner}/${repo}`, base: baseBranch, head: headBranch, headSha, fuente: loaded.fuente, aviso: loaded.aviso ?? null, prs: rows, smoke, pendiente: Object.fromEntries(byReason), hilosCodex: hilos, resultado: pending ? "falta" : "listo", estadoGithub, siguiente };
  return { result, output: options.json ? JSON.stringify(result) : lines.join("\n"), json: options.json, code: pending ? 1 : 0 };
}

/** @param {string} owner @param {string} repo @param {number} number */
const readRegistrosFor = (owner, repo, number) => registrosOf(ghList(`repos/${owner}/${repo}/issues/${number}/comments?per_page=100`));

/** CLI entry. @param {string[]} argv arguments after `listo` */
export function runListoCommand(argv) {
  const options = parseListoArgs(argv);
  if (options.barrido) return listoBarrido({ ...options, barrido: options.barrido });
  if (options.produccion) return listoProduccion({ ...options, produccion: options.produccion });
  return listo({ ...options, pr: /** @type {string} */ (options.pr) });
}
