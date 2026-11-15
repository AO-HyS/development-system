// @ts-check
// `development-system registro` (3.0.0, propuesta v4 D.14): the minimal record of an independent read of a pull
// request and of the cases it asked for. It is a pull request comment, so it is durable and anyone can rebuild the
// state from GitHub: a Spanish summary followed by `<!-- ds-registro:v1 {json} -->`. Only comments by an account
// that may answer for the repository count (codex-threads.mjs `mayAnswer`: a human owner, member or collaborator),
// and the newest record on a pull request wins.
//
// A record is complete when the verdict is `sin-vivos` (or every live finding has its closing), every needed case
// has a `pass`, no case failed, and every case that could not be reached is covered by the owner's waiver. A waived
// case stays «no alcanzado» everywhere: a waiver is never shown as a pass and is never a production approval.
import { execFileSync } from "node:child_process";
import { mayAnswer } from "./codex-threads.mjs";
import { parsePr } from "./pr-review-status.mjs";

const MARKER = "ds-registro:v1";
const ID = /^([A-Za-z][\w.-]*):\s*(\S[\s\S]*)$/;
const CASE = /^(pass|fail):\s*([A-Za-z][\w.-]*)\s+(\S[\s\S]*?)\s*=>\s*(\S[\s\S]*)$/;

/**
 * @typedef {{id: string, texto: string}} Entrada
 * @typedef {{estado: "pass" | "fail", id: string, texto: string}} Caso
 * @typedef {{v: 1, pr: string, sha: string, entorno: string, lector: string, lectura: string, veredicto: "sin-vivos" | "vivos", vivos: Entrada[], cerrados: Entrada[], cubre: string[], necesarios: Entrada[], casos: Caso[], noAlcanzados: Entrada[], dispensa: string | null, autor: string | null, lote?: string[], en: string}} Registro
 * @typedef {{completo: boolean, faltas: string[], pasados: string[], noAlcanzados: string[], abiertos: string[]}} Evaluacion
 * @typedef {{registro: Registro | null, error?: string, at: string, autor: string, url: string}} RegistroLeido
 */

/** @param {string[]} args */
export function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** @param {string} value @param {string} flag @returns {Entrada} */
function entry(value, flag) {
  const match = ID.exec(value.trim());
  if (!match) throw new Error(`${flag} "${value}": usa "<id>: <texto>", por ejemplo ${flag} "N1: el rol negado no ve la cita"`);
  return { id: match[1], texto: match[2].trim() };
}

/** @param {string} value @returns {Caso} */
function caseOf(value) {
  const match = CASE.exec(value.trim());
  if (!match) throw new Error(`--caso "${value}": usa "pass|fail: <id> <qué se intentó> => <qué se observó>"`);
  return { estado: /** @type {"pass" | "fail"} */ (match[1]), id: match[2], texto: `${match[3].trim()} => ${match[4].trim()}` };
}

/**
 * The refusals that make a record meaningless, as Spanish sentences; empty when the record holds together. The same
 * checks run when a record is read back, so a comment written by hand cannot skip them.
 * @param {Registro} record @returns {string[]}
 */
export function refusals(record) {
  /** @type {string[]} */
  const problems = [];
  for (const key of /** @type {const} */ (["sha", "entorno", "lector", "lectura"])) if (!String(record[key] ?? "").trim()) problems.push(`falta --${key}`);
  if (record.veredicto !== "sin-vivos" && record.veredicto !== "vivos") problems.push("--veredicto debe ser sin-vivos o vivos");
  if (record.autor && record.lector.trim().toLowerCase() === record.autor.trim().toLowerCase()) problems.push(`el lector (${record.lector}) es el mismo modelo que escribió el cambio: la lectura debe ser independiente`);
  if (record.veredicto === "sin-vivos" && record.vivos.length) problems.push("el veredicto es sin-vivos pero hay --vivo");
  if (record.veredicto === "vivos" && record.vivos.length === 0) problems.push("el veredicto es vivos pero no hay ningún --vivo");
  const vivos = new Set(record.vivos.map((item) => item.id));
  for (const closed of record.cerrados) if (!vivos.has(closed.id)) problems.push(`--cerrado ${closed.id} no es un --vivo`);
  const needed = new Set(record.necesarios.map((item) => item.id));
  for (const item of record.casos) if (!needed.has(item.id)) problems.push(`--caso ${item.id} no está en --necesario`);
  for (const item of record.noAlcanzados) {
    if (!needed.has(item.id)) problems.push(`--no-alcanzado ${item.id} no está en --necesario`);
    if (record.casos.some((done) => done.id === item.id && done.estado === "pass")) problems.push(`${item.id} no puede estar a la vez en «pasó» y en «no alcanzado»`);
  }
  for (const id of record.cubre) if (!/^codex:\d+$/.test(id)) problems.push(`--cubre ${id}: usa codex:<id del hilo>`);
  for (const list of [record.vivos, record.necesarios]) {
    const seen = new Set();
    for (const item of list) { if (seen.has(item.id)) problems.push(`el id ${item.id} se repite`); seen.add(item.id); }
  }
  return problems;
}

/**
 * Whether a record is complete, and what is missing, in Spanish. A waived case is listed as «no alcanzado».
 * @param {Registro} record @returns {Evaluacion}
 */
export function evaluateRegistro(record) {
  const faltas = refusals(record);
  const closed = new Set(record.cerrados.map((item) => item.id));
  const abiertos = record.vivos.filter((item) => !closed.has(item.id)).map((item) => `${item.id}: ${item.texto}`);
  for (const open of abiertos) faltas.push(`hallazgo vivo abierto ${open}`);
  for (const failed of record.casos.filter((item) => item.estado === "fail")) faltas.push(`caso ${failed.id} falló: ${failed.texto}`);
  const pasados = [];
  const noAlcanzados = [];
  // A read that lists no case proves nothing was walked: the record needs at least one necessary case.
  if (record.necesarios.length === 0) faltas.push("caso necesario: la lectura no listó ninguno (--necesario \"N1: <caso>\")");
  for (const needed of record.necesarios) {
    if (record.casos.some((item) => item.id === needed.id && item.estado === "pass")) { pasados.push(needed.id); continue; }
    if (record.casos.some((item) => item.id === needed.id && item.estado === "fail")) continue;
    const unreached = record.noAlcanzados.find((item) => item.id === needed.id);
    if (unreached) {
      noAlcanzados.push(`${needed.id}: ${unreached.texto}${record.dispensa ? " (dispensa del dueño)" : ""}`);
      if (!record.dispensa) faltas.push(`caso ${needed.id} no alcanzado sin dispensa del dueño: ${unreached.texto}`);
      continue;
    }
    faltas.push(`caso necesario ${needed.id} sin «pass»: ${needed.texto}`);
  }
  return { completo: faltas.length === 0, faltas, pasados, noAlcanzados, abiertos };
}

/** Text that cannot open or close an HTML comment or fake the record marker. @param {string} value */
const plain = (value) => value.replace(/<!--|-->/g, (match) => (match === "<!--" ? "&lt;!--" : "--&gt;"));

/**
 * The comment: a short Spanish summary, then the record as JSON in a hidden marker (`<` and `>` escaped so the JSON
 * can never close the comment).
 * @param {Registro} record @returns {string}
 */
export function formatRegistroComment(record) {
  const verdict = evaluateRegistro(record);
  const lines = [`**Registro de lectura** (Development System) de \`${record.sha.slice(0, 12)}\``, ""];
  lines.push(`- Lector: ${plain(record.lector)}${record.autor ? ` · autor del cambio: ${plain(record.autor)}` : ""} · lectura: ${plain(record.lectura)}`);
  lines.push(`- Entorno: ${plain(record.entorno)}`);
  lines.push(`- Veredicto: ${record.veredicto === "sin-vivos" ? "sin hallazgos vivos" : "con hallazgos vivos"}`);
  for (const item of record.vivos) {
    const closing = record.cerrados.find((closed) => closed.id === item.id);
    lines.push(`  - ${plain(item.id)}: ${plain(item.texto)}${closing ? ` — cerrado: ${plain(closing.texto)}` : " — **abierto**"}`);
  }
  if (record.cubre.length) lines.push(`- Lee y cierra los rechazos de Codex: ${record.cubre.join(", ")}`);
  lines.push(`- Casos necesarios:${record.necesarios.length ? "" : " ninguno"}`);
  for (const needed of record.necesarios) {
    const done = record.casos.filter((item) => item.id === needed.id);
    const unreached = record.noAlcanzados.find((item) => item.id === needed.id);
    const state = done.some((item) => item.estado === "fail") ? "falló" : done.some((item) => item.estado === "pass") ? "pasó" : unreached ? "no alcanzado" : "sin correr";
    lines.push(`  - ${plain(needed.id)} ${state}: ${plain(needed.texto)}`);
    for (const item of done) lines.push(`    - ${item.estado}: ${plain(item.texto)}`);
    if (unreached) lines.push(`    - no alcanzado: ${plain(unreached.texto)}`);
  }
  if (record.dispensa) lines.push(`- Dispensa del dueño para lo no alcanzado (no es un pase ni una aprobación de producción): «${plain(record.dispensa)}»`);
  if (record.lote?.length) lines.push(`- Lectura por lote: ${record.lote.join(", ")}`);
  lines.push(`- Estado: ${verdict.completo ? "completo" : `incompleto — ${plain(verdict.faltas.join("; "))}`}`);
  const json = JSON.stringify(record).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  lines.push("", `<!-- ${MARKER} ${json} -->`);
  return lines.join("\n");
}

/** The record a comment body carries (its last marker), or null when it has none; throws when the marker is unreadable. @param {string} body @returns {Registro | null} */
export function parseRegistroComment(body) {
  const matches = [...String(body).matchAll(/<!-- ds-registro:v1 (\{[\s\S]*?\}) -->/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const raw = JSON.parse(last[1]);
  if (raw?.v !== 1) throw new Error("versión de registro desconocida");
  /** @param {unknown} list */
  const entries = (list) => (Array.isArray(list) ? list.map((item) => ({ id: String(item?.id ?? ""), texto: String(item?.texto ?? "") })) : []);
  return {
    v: 1, pr: String(raw.pr ?? ""), sha: String(raw.sha ?? ""), entorno: String(raw.entorno ?? ""), lector: String(raw.lector ?? ""), lectura: String(raw.lectura ?? ""),
    veredicto: raw.veredicto, vivos: entries(raw.vivos), cerrados: entries(raw.cerrados), cubre: Array.isArray(raw.cubre) ? raw.cubre.map(String) : [],
    necesarios: entries(raw.necesarios),
    casos: Array.isArray(raw.casos) ? raw.casos.map((/** @type {any} */ item) => ({ estado: item?.estado === "pass" ? "pass" : "fail", id: String(item?.id ?? ""), texto: String(item?.texto ?? "") })) : [],
    noAlcanzados: entries(raw.noAlcanzados), dispensa: typeof raw.dispensa === "string" && raw.dispensa.trim() ? raw.dispensa : null,
    autor: typeof raw.autor === "string" && raw.autor.trim() ? raw.autor : null, ...(Array.isArray(raw.lote) ? { lote: raw.lote.map(String) } : {}), en: String(raw.en ?? ""),
  };
}

/**
 * Every record on a pull request, newest first, from accounts that may answer for the repository. `comments` are the
 * REST issue comments (the caller may pass the list it already read). An unreadable marker is kept as an error, so
 * the newest record can fail closed instead of being skipped.
 * @param {any[]} comments @returns {RegistroLeido[]}
 */
export function registrosOf(comments) {
  return comments
    .filter((comment) => String(comment.body ?? "").includes(`<!-- ${MARKER} `))
    .filter((comment) => mayAnswer({ author: { __typename: comment.user?.type, login: comment.user?.login }, authorAssociation: comment.author_association }))
    .map((comment) => {
      const base = { at: String(comment.created_at), autor: String(comment.user?.login ?? ""), url: String(comment.html_url ?? "") };
      /** @type {RegistroLeido} */
      let read;
      try { read = { ...base, registro: parseRegistroComment(String(comment.body)) }; } catch (error) { read = { ...base, registro: null, error: `registro ilegible: ${error instanceof Error ? error.message : error}` }; }
      return read;
    })
    .filter((entry) => entry.registro !== null || entry.error)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** @param {string} path @returns {any[]} */
const ghList = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

/** Records of one pull request read from GitHub, newest first. @param {string} owner @param {string} repo @param {number} number */
export const readRegistros = (owner, repo, number) => registrosOf(ghList(`repos/${owner}/${repo}/issues/${number}/comments?per_page=100`));

/**
 * The commit a record may name: the current head of an open pull request, or the last head or merge commit of a
 * merged one. A 7 to 40 hex prefix of that commit is expanded to the full SHA.
 * @param {any} pull @param {string | undefined} given @returns {string}
 */
export function recordSha(pull, given) {
  const head = String(pull.head?.sha ?? "");
  const merge = pull.merged_at ? String(pull.merge_commit_sha ?? "") : "";
  if (pull.state !== "open" && !pull.merged_at) throw new Error(`#${pull.number} está cerrado sin fusionar: no se registra`);
  const allowed = [head, merge].filter(Boolean);
  if (!given) return head;
  if (!/^[0-9a-f]{7,40}$/i.test(given)) throw new Error(`--sha ${given} no es un SHA`);
  const match = allowed.find((sha) => sha.startsWith(given.toLowerCase()));
  if (!match) throw new Error(pull.state === "open"
    ? `--sha ${given} no es la punta actual de #${pull.number} (${head.slice(0, 12)}): lee la punta y registra con --sha ${head}`
    : `--sha ${given} no es la última punta (${head.slice(0, 12)}) ni el commit de fusión (${merge.slice(0, 12)}) de #${pull.number}`);
  return match;
}

/**
 * @typedef {{pr?: string, lote?: string, prs: number[], sha?: string, entorno?: string, lector?: string, lectura?: string, veredicto?: string, vivo: string[], cerrado: string[], cubre: string[], necesario: string[], caso: string[], noAlcanzado: string[], dispensa?: string, autor?: string, sinPublicar: boolean, json: boolean}} RegistroOptions
 */

/** @param {string[]} argv arguments after `registro` @returns {RegistroOptions} */
export function parseRegistroArgs(argv) {
  /** @type {RegistroOptions} */
  const options = { prs: [], vivo: [], cerrado: [], cubre: [], necesario: [], caso: [], noAlcanzado: [], sinPublicar: false, json: false };
  const single = /** @type {const} */ ({ "--lote": "lote", "--sha": "sha", "--entorno": "entorno", "--lector": "lector", "--lectura": "lectura", "--veredicto": "veredicto", "--dispensa": "dispensa", "--autor": "autor" });
  const many = /** @type {const} */ ({ "--vivo": "vivo", "--cerrado": "cerrado", "--cubre": "cubre", "--necesario": "necesario", "--caso": "caso", "--no-alcanzado": "noAlcanzado" });
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--sin-publicar") { options.sinPublicar = true; continue; }
    if (arg in single || arg in many || arg === "--prs") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} necesita un valor`);
      if (arg === "--prs") { options.prs = value.split(",").map((item) => Number(item.trim().replace(/^#/, ""))); if (options.prs.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error(`--prs ${value}: usa números separados por comas`); continue; }
      if (arg in single) {
        const key = single[/** @type {keyof typeof single} */ (arg)];
        if (options[key] !== undefined) throw new Error(`${arg} va una sola vez`);
        options[key] = value;
      } else options[many[/** @type {keyof typeof many} */ (arg)]].push(value);
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`opción desconocida para registro: ${arg}`);
    if (options.pr) throw new Error(`registro toma un solo PR; para varios usa --lote <owner/repo> --prs 12,13`);
    options.pr = arg;
  }
  if (options.lote && options.pr) throw new Error("usa <owner/repo#n> o --lote <owner/repo> --prs …, no los dos");
  if (options.lote && options.prs.length === 0) throw new Error("--lote necesita --prs 12,13,14");
  if (!options.lote && options.prs.length) throw new Error("--prs va con --lote <owner/repo>");
  if (!options.lote && !options.pr) throw new Error("falta el PR: development-system registro <owner/repo#n> …");
  if (options.lote && options.sha) throw new Error("con --lote cada PR se registra en su punta: quita --sha");
  if (!options.lote && !options.sha) throw new Error("falta --sha <punta leída>");
  return options;
}

/**
 * Builds the record of one pull request from the options and the commit it names; throws with every refusal.
 * @param {RegistroOptions} options @param {{pr: string, sha: string, lote?: string[], now?: Date}} target @returns {Registro}
 */
export function buildRegistro(options, { pr, sha, lote, now = new Date() }) {
  const veredicto = /** @type {"sin-vivos" | "vivos"} */ (options.veredicto ?? "");
  /** @type {Registro} */
  const record = {
    v: 1, pr, sha, entorno: options.entorno ?? "", lector: options.lector ?? "", lectura: options.lectura ?? "", veredicto,
    vivos: options.vivo.map((value) => entry(value, "--vivo")), cerrados: options.cerrado.map((value) => entry(value, "--cerrado")), cubre: [...new Set(options.cubre)],
    necesarios: options.necesario.map((value) => entry(value, "--necesario")), casos: options.caso.map(caseOf), noAlcanzados: options.noAlcanzado.map((value) => entry(value, "--no-alcanzado")),
    dispensa: options.dispensa?.trim() ? options.dispensa.trim() : null, autor: options.autor?.trim() ? options.autor.trim() : null, ...(lote ? { lote } : {}), en: now.toISOString(),
  };
  const problems = refusals(record);
  if (problems.length) throw new Error(`registro rechazado: ${problems.join("; ")}`);
  return record;
}

/**
 * CLI: validates against GitHub (read-only), then posts one comment per pull request, or prints it with
 * `--sin-publicar`.
 * @param {string[]} argv arguments after `registro`
 */
export function runRegistroCommand(argv) {
  const options = parseRegistroArgs(argv);
  /** @type {{owner: string, repo: string, number: number}[]} */
  let targets;
  if (options.lote) {
    const match = /^([^/\s]+)\/([^/#\s]+)$/.exec(options.lote);
    if (!match) throw new Error(`--lote ${options.lote}: usa <owner/repo>`);
    targets = options.prs.map((number) => ({ owner: match[1], repo: match[2], number }));
  } else targets = [parsePr(/** @type {string} */ (options.pr))];
  const lote = options.lote ? targets.map((target) => `#${target.number}`) : undefined;
  // Every PR is validated before anything is posted, so a batch is never half written.
  const records = targets.map((target) => {
    const pull = JSON.parse(gh(["api", `repos/${target.owner}/${target.repo}/pulls/${target.number}`]));
    const sha = recordSha(pull, options.sha);
    return { target, record: buildRegistro(options, { pr: `${target.owner}/${target.repo}#${target.number}`, sha, lote }) };
  });
  const posted = records.map(({ target, record }) => {
    const body = formatRegistroComment(record);
    const verdict = evaluateRegistro(record);
    if (options.sinPublicar) return { pr: record.pr, sha: record.sha, completo: verdict.completo, faltas: verdict.faltas, body, url: "" };
    const comment = JSON.parse(gh(["api", `repos/${target.owner}/${target.repo}/issues/${target.number}/comments`, "-f", `body=${body}`]));
    return { pr: record.pr, sha: record.sha, completo: verdict.completo, faltas: verdict.faltas, body, url: String(comment.html_url ?? "") };
  });
  const lines = posted.flatMap((item) => [
    `${item.pr} @ ${item.sha.slice(0, 12)}: registro ${item.completo ? "completo" : `incompleto — ${item.faltas.join("; ")}`}${options.sinPublicar ? " (sin publicar)" : ` publicado: ${item.url}`}`,
    ...(options.sinPublicar ? ["", item.body, ""] : []),
  ]);
  const next = posted.every((item) => item.completo)
    ? `siguiente: development-system listo ${posted[0].pr}${posted.length > 1 ? " (y cada PR del lote)" : ""}`
    : "siguiente: corre o arregla lo que falta y registra de nuevo (el registro más nuevo es el que cuenta)";
  lines.push(next);
  const result = { ok: true, operation: "registro", publicado: !options.sinPublicar, registros: posted.map(({ body, ...rest }) => (options.json ? { ...rest, body } : rest)) };
  return { result, output: options.json ? JSON.stringify(result) : lines.join("\n"), json: options.json };
}
