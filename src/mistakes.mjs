// @ts-check

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const repeatedMistakeHint = "Propose a hard rule at the highest level that can hold it: code > lint/CI/guard > rule/skill.";

/**
 * Frictions (paper cuts an agent hit while working) share the log with mistakes, typed by `kind`.
 * Entries recorded before `kind` existed are mistakes. Only mistakes count toward the repeated-incident rule.
 * @typedef {"mistake" | "friction"} EntryKind
 * A topic (browser-preview, whatsapp, release…) groups entries by theme; a cause names one confirmed root cause.
 * Only a shared cause, never a shared topic, makes separate ids count as the same repeated mistake.
 * @typedef {{kind?: EntryKind, id: string, incident: string, evidence: string, summary?: string, fix?: string, control?: string, repository?: string, topic?: string, cause?: string, recordedAt: string}} MistakeEntry
 * @typedef {{kind: EntryKind, id: string, by?: "id" | "cause" | "topic", ids?: string[], incidents: string[], occurrences: number, lastRecordedAt: string, summary: string | null, fix: string | null, control: string | null, repositories: string[], proposedControl?: string | null, hint?: string}} MistakeGroup
 * @typedef {{line: number, sha256: string, topic?: string, cause?: string, recordedAt: string}} MistakeAnnotation
 */

/** @param {string} home */
export function mistakeLogPath(home) {
  return resolve(home, ".development-system/private/mistakes.jsonl");
}

/** @param {string} home */
export function mistakeAnnotationPath(home) {
  return resolve(home, ".development-system/private/mistake-annotations.jsonl");
}

/**
 * The main checkout's directory name for a path inside a repository or one of its worktrees.
 * @param {string} path
 */
function checkoutName(path) {
  try {
    const common = execFileSync("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (common) return basename(dirname(common));
  } catch { /* not a checkout any more: fall back to the path itself */ }
  const t3 = /\/\.t3\/worktrees\/([^/]+)/.exec(path);
  return t3 ? t3[1] : basename(path);
}

/**
 * One canonical repository name (the main checkout's directory, lower case) for a path, a worktree path,
 * a GitHub URL, `owner/repo` or a bare name.
 * @param {string} value
 */
export function canonicalRepository(value) {
  let name = value.trim().replace(/\/+$/, "");
  if (name.startsWith("~/")) name = resolve(process.env.HOME ?? "", name.slice(2));
  if (isAbsolute(name)) name = checkoutName(name);
  name = name.replace(/^(?:https?:\/\/|git@)github\.com[/:]/i, "").replace(/\.git$/i, "");
  name = name.split("/").filter(Boolean).at(-1) ?? name;
  return name.toLowerCase();
}

/** @param {string} id */
const idTokens = (id) => new Set(id.split("-").map((token) => token.replace(/[0-9]+$/, "")).filter((token) => token.length > 2));

/**
 * Existing ids whose tokens overlap enough with a new id to probably name the same cause.
 * @param {string} id @param {string[]} existing
 */
export function similarMistakeIds(id, existing) {
  const tokens = idTokens(id);
  if (tokens.size === 0) return [];
  return [...new Set(existing)].filter((other) => other !== id).map((other) => {
    const otherTokens = idTokens(other);
    const shared = [...tokens].filter((token) => otherTokens.has(token)).length;
    return { other, shared, score: shared / Math.min(tokens.size, otherTokens.size || 1) };
  }).filter(({ shared, score }) => shared >= 2 && score >= 0.66).sort((a, b) => b.score - a.score).map(({ other }) => other);
}

/** @param {unknown} value @returns {string | undefined} */
function optional(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** @param {string} name @param {unknown} value */
function required(name, value) {
  const trimmed = optional(value);
  if (!trimmed) throw new Error(`mistake ${name} must be a non-empty string`);
  if (/[\r\n]/.test(trimmed)) throw new Error(`mistake ${name} must not contain a newline`);
  return trimmed;
}

/** @param {MistakeEntry} entry @returns {EntryKind} */
const kindOf = (entry) => entry.kind === "friction" ? "friction" : "mistake";

/** @param {string} text */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** @param {string} home @returns {{line: number, raw: string, entry: MistakeEntry}[]} */
function readLines(home) {
  const file = mistakeLogPath(home);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map((raw, index) => ({ raw, line: index + 1 })).filter(({ raw }) => raw.trim()).map(({ raw, line }) => {
    try { return { line, raw, entry: /** @type {MistakeEntry} */ (JSON.parse(raw)) }; }
    catch { throw new Error(`${file}:${line} is not valid JSON`); }
  });
}

/** @param {string} home @returns {MistakeEntry[]} */
function readEntries(home) {
  return readLines(home).map(({ entry }) => entry);
}

/**
 * Applies the annotation file to the log without rewriting it. An annotation binds to one line by number and the
 * hash of that exact line; one whose hash no longer matches its line is rejected, never moved to another entry.
 * @param {string} home
 */
function annotatedEntries(home) {
  const lines = readLines(home);
  const file = mistakeAnnotationPath(home);
  /** @type {Map<number, MistakeAnnotation>} */
  const byLine = new Map();
  /** @type {{line: number, reason: string}[]} */
  const rejected = [];
  if (existsSync(file)) {
    const known = new Map(lines.map(({ line, raw }) => [line, sha256(raw)]));
    for (const raw of readFileSync(file, "utf8").split("\n").filter((item) => item.trim())) {
      /** @type {MistakeAnnotation} */
      let annotation;
      try { annotation = JSON.parse(raw); } catch { rejected.push({ line: 0, reason: "invalid JSON" }); continue; }
      if (known.get(annotation.line) !== annotation.sha256) { rejected.push({ line: annotation.line, reason: "line hash does not match the log" }); continue; }
      const current = byLine.get(annotation.line);
      byLine.set(annotation.line, { ...current, ...annotation });
    }
  }
  const entries = lines.map(({ line, entry }) => {
    const annotation = byLine.get(line);
    return annotation ? { ...entry, ...(annotation.topic ? { topic: annotation.topic } : {}), ...(annotation.cause ? { cause: annotation.cause } : {}) } : entry;
  });
  return { entries, rejected, annotations: byLine.size };
}

/**
 * Records a topic or confirmed cause for one existing log line, in a separate reversible file.
 * @param {{home: string, line?: number, topic?: string, cause?: string}} options
 */
export function annotateMistake({ home, line, topic, cause }) {
  const target = readLines(home).find((item) => item.line === line);
  if (!target) throw new Error(`mistake annotate: no log entry on line ${line}`);
  const trimmedTopic = optional(topic);
  const trimmedCause = optional(cause);
  if (!trimmedTopic && !trimmedCause) throw new Error("mistake annotate needs --topic or --cause");
  for (const [name, value] of Object.entries({ topic: trimmedTopic, cause: trimmedCause })) {
    if (value && !ID.test(value)) throw new Error(`mistake ${name} must match ^[a-z0-9][a-z0-9-]{2,63}$`);
  }
  /** @type {MistakeAnnotation} */
  const annotation = { line: target.line, sha256: sha256(target.raw), ...(trimmedTopic ? { topic: trimmedTopic } : {}), ...(trimmedCause ? { cause: trimmedCause } : {}), recordedAt: new Date().toISOString() };
  const file = mistakeAnnotationPath(home);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(annotation)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
  return { ok: true, operation: "mistake-annotate", path: file, annotation };
}

/**
 * Appends one mistake occurrence to the private, append-only mistake log.
 * An occurrence with the same (id, incident) is not appended again.
 * Every new entry names its repository; a new id that resembles an existing one is refused until the caller either
 * reuses the suggestion or confirms it with `newId`. Nothing is written when the entry is refused.
 * @param {{home: string, kind?: EntryKind, id?: string, incident?: string, evidence?: string, summary?: string, fix?: string, control?: string, repository?: string, topic?: string, cause?: string, newId?: boolean}} options
 */
export function addMistake({ home, kind = "mistake", id, incident, evidence, summary, fix, control, repository, topic, cause, newId = false }) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error(`${kind} id must match ^[a-z0-9][a-z0-9-]{2,63}$`);
  const repo = optional(repository);
  if (!repo) throw new Error(`${kind} add needs --repository <repo> (path, GitHub URL or name)`);
  const entry = /** @type {MistakeEntry} */ ({ kind, id, incident: required("incident", incident), evidence: required("evidence", evidence), repository: canonicalRepository(repo) });
  for (const [key, value] of Object.entries({ topic, cause })) {
    const trimmed = optional(value);
    if (trimmed && !ID.test(trimmed)) throw new Error(`${kind} ${key} must match ^[a-z0-9][a-z0-9-]{2,63}$`);
  }
  for (const [key, value] of Object.entries({ summary, fix, control, topic, cause })) {
    const trimmed = optional(value);
    if (trimmed) /** @type {Record<string, string>} */ (entry)[key] = trimmed;
  }
  const entries = readEntries(home);
  const file = mistakeLogPath(home);
  const operation = `${kind}-add`;
  const sameKind = entries.filter((item) => kindOf(item) === kind);
  const incidents = new Set(sameKind.filter((item) => item.id === id).map((item) => item.incident));
  if (incidents.has(entry.incident)) {
    return { ok: true, operation, status: "duplicate", id, incident: entry.incident, incidents: incidents.size, path: file };
  }
  if (incidents.size === 0 && !newId) {
    const similar = similarMistakeIds(id, sameKind.map((item) => item.id)).slice(0, 5);
    if (similar.length) throw new Error(`${kind} id ${id} is new but resembles ${similar.join(", ")}; reuse one of them or pass --new-id`);
  }
  entry.recordedAt = new Date().toISOString();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
  return { ok: true, operation, status: "recorded", id, incident: entry.incident, incidents: incidents.size + 1, path: file, entry };
}

/**
 * Groups one kind of the private log by id, or by confirmed cause or topic (entries without one keep their id).
 * With `repeated` (mistakes only), keeps groups seen in two or more distinct incidents.
 * @param {{home: string, kind?: EntryKind, repeated?: boolean, by?: "id" | "cause" | "topic"}} options
 */
export function listMistakes({ home, kind = "mistake", repeated = false, by = "id" }) {
  if (repeated && kind !== "mistake") throw new Error("--repeated applies to mistakes only; frictions never become hard rules by count");
  if (repeated && by === "topic") throw new Error("--repeated counts causes, not topics; use --by cause");
  const { entries, rejected, annotations } = annotatedEntries(home);
  // A cause or topic recorded on any entry of an id applies to every entry of that id; the latest one wins.
  /** @type {Map<string, string>} */
  const labelById = new Map();
  if (by !== "id") for (const entry of entries) if (kindOf(entry) === kind && entry[by]) labelById.set(entry.id, /** @type {string} */ (entry[by]));
  /** @type {Map<string, MistakeGroup>} */
  const groups = new Map();
  for (const entry of entries) {
    if (kindOf(entry) !== kind) continue;
    const key = by === "id" ? entry.id : labelById.get(entry.id) ?? entry.id;
    const group = groups.get(key) ?? { kind, id: key, ...(by === "id" ? {} : { by, ids: [] }), incidents: [], occurrences: 0, lastRecordedAt: entry.recordedAt, summary: null, fix: null, control: null, repositories: [] };
    if (group.ids && !group.ids.includes(entry.id)) group.ids.push(entry.id);
    const repository = entry.repository ? canonicalRepository(entry.repository) : "unknown";
    if (!group.repositories.includes(repository)) group.repositories.push(repository);
    if (!group.incidents.includes(entry.incident)) group.incidents.push(entry.incident);
    group.occurrences += 1;
    if (entry.recordedAt >= group.lastRecordedAt) group.lastRecordedAt = entry.recordedAt;
    if (optional(entry.summary)) group.summary = /** @type {string} */ (entry.summary);
    if (optional(entry.fix)) group.fix = /** @type {string} */ (entry.fix);
    if (optional(entry.control)) group.control = /** @type {string} */ (entry.control);
    groups.set(key, group);
  }
  const mistakes = [...groups.values()]
    .filter((group) => !repeated || group.incidents.length >= 2)
    .map((group) => repeated ? { ...group, proposedControl: group.control ?? null, hint: repeatedMistakeHint } : group);
  return { ok: true, operation: `${kind}-list`, kind, repeated, by, path: mistakeLogPath(home), annotations, rejectedAnnotations: rejected, mistakes };
}
