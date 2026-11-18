// @ts-check
// The card of one ask: its «Terminado» lines, the result and receipt of each, and the few numbers that tell whether the
// way of working helped. One JSON file per ask under ~/.development-system/private/tarjetas/, written from the first
// reply on, so an ask that stays open or fails has a card too. The card records; it is not a gate and orders no read.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TARJETA_USAGE = [
  "abrir --id <slug> --repo <owner/repo> --pedido \"<palabras del dueño>\" [--tipo producto|ds|otro] [--ticket <KEY-1>] [--renglon \"R1 pantalla|servidor|regla: acción -> lo que se ve\"]... [--checkout <dir>]",
  "terminado --id <slug> (--renglon \"R4 servidor: …\" | --quitar R3)... [--checkout <dir>] (agrega, cambia o quita renglones; después del «sí» cada cambio se cuenta)",
  "si --id <slug> (--palabras \"<lo que dijo el dueño>\" | --sin-espera \"<por qué no se esperó>\")",
  "renglon --id <slug> --n R1 --veredicto pasa|no-pasa|no-alcanzado --recibo <archivo|url> [--nota <texto>]",
  "cerrar --id <slug> [--pr <owner/repo#n>]... [--empujones N] [--correcciones N] [--lecturas N] [--hallazgos-de-regla N] [--objetivo-faltante \"<texto>\"]... [--fallido \"<motivo>\"]",
  "ver [--id <slug>]",
].map((line) => `tarjeta ${line} [--home <dir>] [--json]`).join("\n  ");

const LINE = /^([RN]\d+)\s+(pantalla|servidor|regla)\s*:\s*(.+->.+)$/s;
const VERDICTS = /** @type {const} */ ({ "pasa": "PASA", "no-pasa": "NO PASA", "no-alcanzado": "NO ALCANZADO" });

/**
 * @typedef {{ n: string, donde: "pantalla"|"servidor"|"regla", texto: string, desde: string }} Renglon
 * @typedef {{ en: string, veredicto: "PASA"|"NO PASA"|"NO ALCANZADO", recibo: string, nota: string | null }} Resultado
 * @typedef {{ schema: 1, id: string, repo: string, tipo: string, pedido: string, ticket: string | null, dsVersion: string,
 *   abierta: string, cerrada: string | null, estado: "abierta"|"cerrada"|"cerrada-con-pendientes"|"fallida",
 *   terminado: { renglones: Renglon[], primerRenglon: string | null, antesDelPrimerCambio: boolean | null, si: { en: string, palabras: string } | null, sinEspera: string | null, cambiosTrasElSi: number },
 *   resultados: Record<string, Resultado[]>,
 *   cierre: { prs: string[], empujones: number | null, correcciones: number | null, lecturas: number | null, hallazgosDeRegla: number | null, objetivosFaltantes: string[], relojMinutos: number | null, minutosDeAgente: number | null, motivoFallido: string | null } }} Tarjeta
 */

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, string[]>} */
  const values = {};
  let json = false;
  const [command, ...rest] = argv;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--json") { json = true; continue; }
    if (!arg.startsWith("--")) throw new Error(`argumento inesperado para tarjeta: ${arg}`);
    const value = rest[++index];
    if (value === undefined) throw new Error(`${arg} necesita un valor`);
    (values[arg.slice(2)] ??= []).push(value);
  }
  return { command, values, json };
}

/** @param {Record<string, string[]>} values @param {string} key @param {boolean} [required] */
function one(values, key, required = false) {
  const list = values[key] ?? [];
  if (list.length > 1) throw new Error(`--${key} va una sola vez`);
  if (required && !list[0]?.trim()) throw new Error(`falta --${key}`);
  return list[0]?.trim();
}

/** @param {Record<string, string[]>} values @param {string} key */
function count(values, key) {
  const value = one(values, key);
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) throw new Error(`--${key} ${value}: usa un número entero`);
  return Number(value);
}

/** @param {string} home @param {string} id */
function cardPath(home, id) {
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) throw new Error(`--id ${id}: usa minúsculas, números y guiones`);
  return resolve(home, ".development-system/private/tarjetas", `${id}.json`);
}

/** @param {string} path @returns {Tarjeta} */
function read(path) {
  if (!existsSync(path)) throw new Error(`no existe la tarjeta ${path}: ábrela con «tarjeta abrir»`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {string} path @param {Tarjeta} card */
function write(path, card) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(card, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * One writer per card: two commands that read the same card and each write it back would drop one of the two receipts,
 * and two `abrir` would overwrite an ask. The lock is a folder next to the card; one left by a dead process is taken
 * over after thirty seconds.
 * @template T @param {string} path @param {() => T} action @returns {T}
 */
function locked(path, action) {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt += 1) {
    try { mkdirSync(lock); break; } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; }
      if (age > 30_000) { try { rmdirSync(lock); } catch { /* another process took it over */ } continue; }
      if (attempt >= 200) throw new Error(`la tarjeta ${path} está ocupada por otro comando: vuelve a intentarlo`);
      Atomics.wait(pause, 0, 0, 50);
    }
  }
  try { return action(); } finally { try { rmdirSync(lock); } catch { /* already gone */ } }
}

/** @param {string} value @param {string} now @returns {Renglon} */
function lineOf(value, now) {
  const match = LINE.exec(value.trim());
  if (!match) throw new Error(`--renglon "${value}": usa "R1 pantalla|servidor|regla: acción -> lo que se ve"`);
  return { n: match[1], donde: /** @type {Renglon["donde"]} */ (match[2]), texto: match[3].trim(), desde: now };
}

/**
 * Whether the checkout still had no code change of this ask when its first line was written: no tracked file modified
 * and no commit ahead of `origin/develop`. Null outside a Git checkout or without that remote branch.
 * @param {string} checkout
 */
function beforeFirstChange(checkout) {
  /** @param {string[]} args */
  const git = (args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (git(["status", "--porcelain", "--untracked-files=no"]) !== "") return false;
    return git(["rev-list", "--count", "origin/develop..HEAD"]) === "0";
  } catch { return null; }
}

const dsVersion = () => {
  try { return String(JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version); } catch { return "desconocida"; }
};

/** @param {Tarjeta} card @param {string[]} lines @param {string} now @param {string} checkout */
function setLines(card, lines, now, checkout) {
  for (const value of lines) {
    const line = lineOf(value, now);
    const index = card.terminado.renglones.findIndex((item) => item.n === line.n);
    if (index >= 0) card.terminado.renglones[index] = line;
    else card.terminado.renglones.push(line);
    if (card.terminado.si) card.terminado.cambiosTrasElSi += 1;
  }
  if (lines.length && card.terminado.primerRenglon === null) {
    card.terminado.primerRenglon = now;
    card.terminado.antesDelPrimerCambio = beforeFirstChange(checkout);
  }
}

/**
 * The last result of each line as it reads now. A result recorded before the line was written, changed or added again
 * proved another text: it stays in the history and does not count.
 * @param {Tarjeta} card
 */
function marks(card) {
  return card.terminado.renglones.map((line) => ({ line, last: (card.resultados[line.n] ?? []).filter((item) => item.en > line.desde).at(-1) ?? null }));
}

/** @param {Tarjeta} card */
export function formatTarjeta(card) {
  const rows = marks(card).map(({ line, last }) => `  ${line.n} [${line.donde}] ${last ? last.veredicto : "SIN RECIBO"} · ${line.texto}${last ? ` · ${last.recibo}` : ""}`);
  const yes = card.terminado.si ? `sí del dueño: «${card.terminado.si.palabras}»` : card.terminado.sinEspera ? `sin espera: ${card.terminado.sinEspera}` : "sin respuesta del dueño todavía";
  const close = card.cerrada
    ? `cierre: ${card.cierre.relojMinutos} min de reloj, empujones ${card.cierre.empujones ?? "?"}, correcciones ${card.cierre.correcciones ?? "?"}, lecturas ${card.cierre.lecturas ?? "?"}, hallazgos que una regla atraparía ${card.cierre.hallazgosDeRegla ?? "?"}, objetivos del dueño fuera del terminado ${card.cierre.objetivosFaltantes.length}${card.cierre.prs.length ? `, ${card.cierre.prs.join(" ")}` : ""}`
    : "sin cerrar";
  return [
    `Tarjeta ${card.id} · ${card.repo} · ${card.tipo} · DS ${card.dsVersion} · ${card.estado}`,
    `pedido: ${card.pedido}${card.ticket ? ` (${card.ticket})` : ""}`,
    `terminado: ${card.terminado.renglones.length} renglones, ${card.terminado.antesDelPrimerCambio === null ? "no se sabe si" : card.terminado.antesDelPrimerCambio ? "escrito antes" : "escrito después"} del primer cambio de código, ${card.terminado.cambiosTrasElSi} cambios después del sí; ${yes}`,
    ...rows, close,
  ].join("\n");
}

/** @param {string[]} argv arguments after `tarjeta` */
export function runTarjetaCommand(argv) {
  const { command, values, json } = parse(argv);
  const home = resolve(one(values, "home") ?? homedir());
  const now = new Date().toISOString();
  /** @param {Tarjeta} card @param {string[]} [extra] */
  const done = (card, extra = []) => ({ result: { ok: true, operation: `tarjeta-${command}`, tarjeta: card, avisos: extra }, output: json ? JSON.stringify({ ok: true, operation: `tarjeta-${command}`, tarjeta: card, avisos: extra }) : [formatTarjeta(card), ...extra].join("\n"), json });

  if (command === "ver" && !values.id) {
    const directory = resolve(home, ".development-system/private/tarjetas");
    const cards = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => read(resolve(directory, name))) : [];
    cards.sort((a, b) => (a.abierta < b.abierta ? 1 : -1));
    const lines = cards.map((card) => `${card.abierta.slice(0, 10)} ${card.id} · ${card.repo} · ${card.estado} · ${marks(card).filter((item) => item.last?.veredicto === "PASA").length}/${card.terminado.renglones.length} PASA`);
    const result = { ok: true, operation: "tarjeta-ver", tarjetas: cards };
    return { result, output: json ? JSON.stringify(result) : lines.length ? lines.join("\n") : "no hay tarjetas", json };
  }

  const id = one(values, "id", true) ?? "";
  const path = cardPath(home, id);
  const checkout = resolve(one(values, "checkout") ?? process.cwd());
  if (command === "ver") return done(read(path));
  return locked(path, () => change());

  function change() {
  if (command === "abrir") {
    if (existsSync(path)) throw new Error(`la tarjeta ${id} ya existe: usa «tarjeta terminado» para cambiar sus renglones`);
    const repo = one(values, "repo", true) ?? "";
    if (!/^[^/\s]+\/[^/\s#]+$/.test(repo)) throw new Error(`--repo ${repo}: usa <owner/repo>`);
    /** @type {Tarjeta} */
    const card = {
      schema: 1, id, repo, tipo: one(values, "tipo") ?? "producto", pedido: one(values, "pedido", true) ?? "", ticket: one(values, "ticket") ?? null, dsVersion: dsVersion(),
      abierta: now, cerrada: null, estado: "abierta",
      terminado: { renglones: [], primerRenglon: null, antesDelPrimerCambio: null, si: null, sinEspera: null, cambiosTrasElSi: 0 },
      resultados: {},
      cierre: { prs: [], empujones: null, correcciones: null, lecturas: null, hallazgosDeRegla: null, objetivosFaltantes: [], relojMinutos: null, minutosDeAgente: null, motivoFallido: null },
    };
    setLines(card, values.renglon ?? [], now, checkout);
    write(path, card);
    return done(card);
  }

  const card = read(path);
  if (card.cerrada && command !== "cerrar") throw new Error(`la tarjeta ${id} ya está cerrada (${card.estado})`);

  if (command === "terminado") {
    const removed = values.quitar ?? [];
    if (!(values.renglon ?? []).length && !removed.length) throw new Error("terminado necesita --renglon o --quitar");
    setLines(card, values.renglon ?? [], now, checkout);
    for (const n of removed) {
      const index = card.terminado.renglones.findIndex((item) => item.n === n);
      if (index < 0) throw new Error(`--quitar ${n}: ese renglón no existe`);
      card.terminado.renglones.splice(index, 1);
      if (card.terminado.si) card.terminado.cambiosTrasElSi += 1;
    }
    write(path, card);
    return done(card);
  }

  if (command === "si") {
    const words = one(values, "palabras"), noWait = one(values, "sin-espera");
    if (Boolean(words) === Boolean(noWait)) throw new Error("si necesita --palabras \"<lo que dijo el dueño>\" o --sin-espera \"<por qué>\", uno de los dos");
    if (card.terminado.renglones.length === 0) throw new Error("no hay renglones: el «sí» responde a un «Terminado» escrito");
    if (words) card.terminado.si = { en: now, palabras: words };
    else card.terminado.sinEspera = noWait ?? null;
    write(path, card);
    return done(card);
  }

  if (command === "renglon") {
    const n = one(values, "n", true) ?? "";
    if (!card.terminado.renglones.some((line) => line.n === n)) throw new Error(`--n ${n}: ese renglón no está en el terminado`);
    const key = /** @type {keyof typeof VERDICTS} */ (one(values, "veredicto", true));
    if (!(key in VERDICTS)) throw new Error("--veredicto debe ser pasa, no-pasa o no-alcanzado");
    let receipt = one(values, "recibo", true) ?? "";
    // A receipt is something another person can open: a file that exists or a link.
    if (!/^https?:\/\//.test(receipt)) {
      receipt = isAbsolute(receipt) ? receipt : resolve(process.cwd(), receipt);
      if (!existsSync(receipt)) throw new Error(`--recibo ${receipt}: el archivo no existe`);
    }
    (card.resultados[n] ??= []).push({ en: now, veredicto: VERDICTS[key], recibo: receipt, nota: one(values, "nota") ?? null });
    write(path, card);
    const failed = card.resultados[n].filter((item) => item.veredicto === "NO PASA").length;
    return done(card, VERDICTS[key] === "NO PASA" && failed >= 3 ? [`${n} lleva ${failed} NO PASA: deja de parchar, diagnostica la causa, déjalo NO PASA, avísale al dueño en el cierre y sigue con lo demás.`] : []);
  }

  if (command === "cerrar") {
    const failed = one(values, "fallido");
    const missing = marks(card).filter((item) => item.last === null).map((item) => item.line.n);
    if (!failed && card.terminado.renglones.length === 0) throw new Error("no se cierra: la tarjeta no tiene renglones de «Terminado» (o ciérrala con --fallido \"<motivo>\")");
    if (!failed && missing.length) throw new Error(`no se cierra: sin recibo ${missing.join(", ")} (cada renglón necesita PASA, NO PASA o NO ALCANZADO con su recibo; o ciérrala con --fallido "<motivo>")`);
    const pending = marks(card).filter((item) => item.last?.veredicto !== "PASA").map((item) => item.line.n);
    card.cerrada = now;
    card.estado = failed ? "fallida" : pending.length ? "cerrada-con-pendientes" : "cerrada";
    card.cierre = {
      prs: values.pr ?? card.cierre.prs, empujones: count(values, "empujones"), correcciones: count(values, "correcciones"), lecturas: count(values, "lecturas"),
      hallazgosDeRegla: count(values, "hallazgos-de-regla"), objetivosFaltantes: values["objetivo-faltante"] ?? [],
      relojMinutos: Math.round((Date.parse(now) - Date.parse(card.abierta)) / 60000), minutosDeAgente: null, motivoFallido: failed ?? null,
    };
    write(path, card);
    return done(card, pending.length && !failed ? [`quedan sin PASA: ${pending.join(", ")}. Dilo en el cierre; no cuentan como pase.`] : []);
  }

  throw new Error(`Usage: development-system ${TARJETA_USAGE}`);
  }
}
