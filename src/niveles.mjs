// @ts-check
// The level of a pull request (3.0.0, propuesta «libre por defecto» v4, sección B): crítico, mecánico or normal,
// decided by the paths and contents a change touches, never by the agent that wrote it.
//
// The rules live in each product repository as `config/niveles.json` and are read from the tip of the pull
// request's base branch, never from its own head: a change cannot lower its own level. Without that file every
// change is normal. Pure functions here; the only reader of GitHub is `loadNiveles` and the `content` callback the
// caller passes to `classifyFiles`.
//
//   crítico   a name (new, and the previous one of a rename) matches `critico.rutas`, or matches a `contenido`
//             rule's `rutas` and the file's content matches its `patron` (multiline) at the head, and for a removed
//             or renamed file also at the base
//   mecánico  every name matches `mecanico.rutas`, or the file is listed in `mecanico.soloBaja` and its JSON at the
//             head differs from the base only in numeric leaves that went down
//   normal    everything else, unknown paths included
import { readFileSync } from "node:fs";

/** @typedef {{rutas: string[], patron: string}} ContentRule */
/**
 * @typedef {{version: 1, desde?: string, critico: {rutas: string[], contenido: ContentRule[]}, mecanico: {rutas: string[], soloBaja: string[]}, smoke: {rutas: string[]}, comprobaciones: string[]}} Niveles
 * @typedef {"crítico" | "mecánico" | "normal"} Nivel
 * @typedef {{filename: string, status?: string, previous_filename?: string}} ChangedFile
 * @typedef {{file: string, regla: string}} Motivo
 * @typedef {{nivel: Nivel, motivos: Motivo[], aviso?: string}} Clasificacion
 */

export const CONFIG_PATH = "config/niveles.json";
const ORDER = /** @type {const} */ (["mecánico", "normal", "crítico"]);

/** @param {string} glob */
function globRegex(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") { index += 1; source += "(?:.*/)?"; } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** @type {Map<string, RegExp>} */
const compiled = new Map();
/** True when `name` matches the glob (`**`, `*`, `?`; `**` crosses directories, `*` and `?` do not). @param {string} glob @param {string} name */
export function matchesGlob(glob, name) {
  let regex = compiled.get(glob);
  if (!regex) { regex = globRegex(glob); compiled.set(glob, regex); }
  return regex.test(name);
}

/** The first glob of the list that matches `name`, or "". @param {string[]} globs @param {string} name */
export const firstMatch = (globs, name) => globs.find((glob) => matchesGlob(glob, name)) ?? "";

/** @param {unknown} value @param {string} where */
function strings(value, where) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) throw new Error(`${CONFIG_PATH}: ${where} debe ser una lista de textos`);
  return /** @type {string[]} */ (value);
}

/**
 * Checks and normalizes a parsed `config/niveles.json`; throws with the field that is wrong.
 * @param {any} raw @returns {Niveles}
 */
export function parseNiveles(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${CONFIG_PATH}: no es un objeto JSON`);
  if (raw.version !== 1) throw new Error(`${CONFIG_PATH}: version debe ser 1`);
  if (raw.desde !== undefined && (typeof raw.desde !== "string" || !/^[0-9a-f]{7,40}$/.test(raw.desde))) throw new Error(`${CONFIG_PATH}: desde debe ser un SHA de develop`);
  const contenido = raw.critico?.contenido ?? [];
  if (!Array.isArray(contenido)) throw new Error(`${CONFIG_PATH}: critico.contenido debe ser una lista`);
  const rules = contenido.map((/** @type {any} */ rule, /** @type {number} */ index) => {
    const rutas = strings(rule?.rutas, `critico.contenido[${index}].rutas`);
    if (typeof rule?.patron !== "string" || !rule.patron) throw new Error(`${CONFIG_PATH}: critico.contenido[${index}].patron falta`);
    try { new RegExp(rule.patron, "m"); } catch (error) { throw new Error(`${CONFIG_PATH}: critico.contenido[${index}].patron no es una expresión válida (${error instanceof Error ? error.message : error})`); }
    return { rutas, patron: String(rule.patron) };
  });
  return {
    version: 1,
    ...(raw.desde ? { desde: String(raw.desde) } : {}),
    critico: { rutas: strings(raw.critico?.rutas, "critico.rutas"), contenido: rules },
    mecanico: { rutas: strings(raw.mecanico?.rutas, "mecanico.rutas"), soloBaja: strings(raw.mecanico?.soloBaja, "mecanico.soloBaja") },
    smoke: { rutas: strings(raw.smoke?.rutas, "smoke.rutas") },
    comprobaciones: strings(raw.comprobaciones, "comprobaciones"),
  };
}

/**
 * The rules for one repository: a local draft (`file`, only for evaluating) or `config/niveles.json` at `ref` on
 * GitHub. A missing file at the ref gives null and a warning; any other read error throws, so a level is never
 * decided from a file nobody could read.
 * @param {{gh: (args: string[]) => string, owner: string, repo: string, ref: string, file?: string}} input
 * @returns {{config: Niveles | null, fuente: string, aviso?: string}}
 */
export function loadNiveles({ gh, owner, repo, ref, file }) {
  if (file) return { config: parseNiveles(JSON.parse(readFileSync(file, "utf8"))), fuente: `${file} (borrador local)` };
  let text;
  try {
    text = gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${owner}/${repo}/contents/${CONFIG_PATH}?ref=${encodeURIComponent(ref)}`]);
  } catch (error) {
    const message = String(/** @type {{stderr?: string}} */ (error)?.stderr ?? (error instanceof Error ? error.message : error));
    if (/HTTP 404|Not Found/i.test(message)) return { config: null, fuente: `${owner}/${repo}@${ref}`, aviso: `sin ${CONFIG_PATH} en ${ref}: todo cambio es normal hasta que el repositorio lo tenga` };
    throw new Error(`no pude leer ${CONFIG_PATH} en ${owner}/${repo}@${ref}: ${message.trim().split("\n")[0]}`);
  }
  return { config: parseNiveles(JSON.parse(text)), fuente: `${CONFIG_PATH} en ${ref}` };
}

/** Every name a changed file goes by: the new one and, for a rename, the previous one. @param {ChangedFile} file */
export const namesOf = (file) => [file.filename, ...(file.previous_filename && file.previous_filename !== file.filename ? [file.previous_filename] : [])];

/**
 * True when `head` differs from `base` only in numeric leaves that went down (or stayed): no key added or removed,
 * no array that changed length, no non-numeric leaf that changed.
 * @param {unknown} base @param {unknown} head @returns {boolean}
 */
export function onlyLowered(base, head) {
  if (typeof base === "number" && typeof head === "number") return head <= base;
  if (Array.isArray(base) || Array.isArray(head)) {
    if (!Array.isArray(base) || !Array.isArray(head) || base.length !== head.length) return false;
    return base.every((entry, index) => onlyLowered(entry, head[index]));
  }
  if (base && head && typeof base === "object" && typeof head === "object") {
    const before = Object.keys(base), after = Object.keys(head);
    if (before.length !== after.length || before.some((key) => !Object.hasOwn(head, key))) return false;
    return before.every((key) => onlyLowered(/** @type {any} */ (base)[key], /** @type {any} */ (head)[key]));
  }
  return base === head;
}

/** @param {string | null} text */
function parseJson(text) {
  if (text === null) return { ok: false, value: undefined };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, value: undefined }; }
}

/**
 * The level the paths and contents give, with the first three files and the rule that decided. `content(name, side)`
 * returns the file's text at the head or at the base (the merge base), or null when it does not exist there; it is
 * called only for files a `contenido` or `soloBaja` rule names.
 * @param {{config: Niveles | null, files: ChangedFile[], content: (name: string, side: "head" | "base") => string | null}} input
 * @returns {Clasificacion}
 */
export function classifyFiles({ config, files, content }) {
  if (!config) return { nivel: "normal", motivos: [{ file: "", regla: `sin ${CONFIG_PATH} en la rama base` }] };
  if (files.length === 0) return { nivel: "normal", motivos: [{ file: "", regla: "el PR no cambia archivos" }] };
  /** @type {Motivo[]} */
  const critical = [];
  // Paths first: they cost nothing to read.
  for (const file of files) {
    for (const name of namesOf(file)) {
      const glob = firstMatch(config.critico.rutas, name);
      if (glob) { critical.push({ file: name, regla: `critico.rutas ${glob}` }); break; }
    }
  }
  if (critical.length < 3) {
    for (const file of files) {
      if (critical.length >= 3) break;
      if (critical.some((entry) => namesOf(file).includes(entry.file))) continue;
      const hit = contentHit(config.critico.contenido, file, content);
      if (hit) critical.push(hit);
    }
  }
  if (critical.length) return { nivel: "crítico", motivos: critical.slice(0, 3) };
  /** @type {Motivo[]} */
  const mechanical = [];
  /** @type {Motivo[]} */
  const other = [];
  for (const file of files) {
    const globs = namesOf(file).map((name) => firstMatch(config.mecanico.rutas, name));
    if (globs.every(Boolean)) { mechanical.push({ file: file.filename, regla: `mecanico.rutas ${globs[0]}` }); continue; }
    if (config.mecanico.soloBaja.includes(file.filename)) {
      const lowered = file.status === "modified" ? loweredOnly(file.filename, content) : `el archivo está ${file.status}`;
      if (lowered === "") { mechanical.push({ file: file.filename, regla: "mecanico.soloBaja (solo bajan números)" }); continue; }
      other.push({ file: file.filename, regla: `mecanico.soloBaja no aplica: ${lowered}` });
      continue;
    }
    other.push({ file: file.filename, regla: "ninguna regla: normal" });
  }
  if (other.length === 0) return { nivel: "mecánico", motivos: mechanical.slice(0, 3) };
  // The files that kept it from mecánico first, then those that would have been mecánico on their own.
  return { nivel: "normal", motivos: [...other, ...mechanical].slice(0, 3) };
}

/** "" when the JSON only lowers numbers between base and head, else why not. @param {string} name @param {(name: string, side: "head" | "base") => string | null} content */
function loweredOnly(name, content) {
  const base = parseJson(content(name, "base"));
  const head = parseJson(content(name, "head"));
  if (!base.ok || !head.ok) return "no es JSON legible en la base y en la punta";
  return onlyLowered(base.value, head.value) ? "" : "cambia algo más que bajar números";
}

/**
 * The first `contenido` rule a file triggers: one of its names is in the rule's `rutas` and the content matches the
 * pattern at the head (new name), or at the base (previous name of a rename, or the name of a removed file).
 * @param {ContentRule[]} rules @param {ChangedFile} file @param {(name: string, side: "head" | "base") => string | null} content
 * @returns {Motivo | null}
 */
function contentHit(rules, file, content) {
  /** @type {[string, "head" | "base"][]} */
  const reads = [];
  if (file.status !== "removed") reads.push([file.filename, "head"]);
  if (file.status === "removed") reads.push([file.filename, "base"]);
  if (file.previous_filename && file.previous_filename !== file.filename) reads.push([file.previous_filename, "base"]);
  for (const rule of rules) {
    const pattern = new RegExp(rule.patron, "m");
    for (const [name, side] of reads) {
      if (!firstMatch(rule.rutas, name)) continue;
      const text = content(name, side);
      const found = text === null ? null : pattern.exec(text);
      if (found) return { file: name, regla: `critico.contenido: «${found[0].trim().slice(0, 60)}»${side === "base" ? " en la base" : ""}` };
    }
  }
  return null;
}

/** The higher of two levels: a raise never lowers. @param {Nivel} current @param {Nivel} raised @returns {Nivel} */
export const raise = (current, raised) => (ORDER.indexOf(raised) > ORDER.indexOf(current) ? raised : current);

/** @param {Clasificacion} result */
export const formatMotivos = (result) => result.motivos.map((entry) => (entry.file ? `${entry.file} (${entry.regla})` : entry.regla)).join("; ");
