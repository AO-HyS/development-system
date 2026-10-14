// @ts-check

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const repeatedMistakeHint = "Propose a hard rule at the highest level that can hold it: code > lint/CI/guard > rule/skill.";

/**
 * Frictions (paper cuts an agent hit while working) share the log with mistakes, typed by `kind`.
 * Entries recorded before `kind` existed are mistakes. Only mistakes count toward the repeated-incident rule.
 * @typedef {"mistake" | "friction"} EntryKind
 * @typedef {{kind?: EntryKind, id: string, incident: string, evidence: string, summary?: string, fix?: string, control?: string, repository?: string, recordedAt: string}} MistakeEntry
 * @typedef {{kind: EntryKind, id: string, incidents: string[], occurrences: number, lastRecordedAt: string, summary: string | null, fix: string | null, control: string | null, repositories: string[], proposedControl?: string | null, hint?: string}} MistakeGroup
 */

/** @param {string} home */
export function mistakeLogPath(home) {
  return resolve(home, ".development-system/private/mistakes.jsonl");
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

/** @param {string} home @returns {MistakeEntry[]} */
function readEntries(home) {
  const file = mistakeLogPath(home);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    try { return /** @type {MistakeEntry} */ (JSON.parse(line)); }
    catch { throw new Error(`${file}:${index + 1} is not valid JSON`); }
  });
}

/**
 * Appends one mistake occurrence to the private, append-only mistake log.
 * An occurrence with the same (id, incident) is not appended again.
 * @param {{home: string, kind?: EntryKind, id?: string, incident?: string, evidence?: string, summary?: string, fix?: string, control?: string, repository?: string}} options
 */
export function addMistake({ home, kind = "mistake", id, incident, evidence, summary, fix, control, repository }) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error(`${kind} id must match ^[a-z0-9][a-z0-9-]{2,63}$`);
  const entry = /** @type {MistakeEntry} */ ({ kind, id, incident: required("incident", incident), evidence: required("evidence", evidence) });
  for (const [key, value] of Object.entries({ summary, fix, control, repository })) {
    const trimmed = optional(value);
    if (trimmed) /** @type {Record<string, string>} */ (entry)[key] = trimmed;
  }
  const entries = readEntries(home);
  const file = mistakeLogPath(home);
  const operation = `${kind}-add`;
  const incidents = new Set(entries.filter((item) => item.id === id && kindOf(item) === kind).map((item) => item.incident));
  if (incidents.has(entry.incident)) {
    return { ok: true, operation, status: "duplicate", id, incident: entry.incident, incidents: incidents.size, path: file };
  }
  entry.recordedAt = new Date().toISOString();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
  return { ok: true, operation, status: "recorded", id, incident: entry.incident, incidents: incidents.size + 1, path: file, entry };
}

/**
 * Groups one kind of the private log by id. With `repeated` (mistakes only), keeps ids seen in two or more distinct incidents.
 * @param {{home: string, kind?: EntryKind, repeated?: boolean}} options
 */
export function listMistakes({ home, kind = "mistake", repeated = false }) {
  if (repeated && kind !== "mistake") throw new Error("--repeated applies to mistakes only; frictions never become hard rules by count");
  /** @type {Map<string, MistakeGroup>} */
  const groups = new Map();
  for (const entry of readEntries(home)) {
    if (kindOf(entry) !== kind) continue;
    const group = groups.get(entry.id) ?? { kind, id: entry.id, incidents: [], occurrences: 0, lastRecordedAt: entry.recordedAt, summary: null, fix: null, control: null, repositories: [] };
    if (entry.repository && !group.repositories.includes(entry.repository)) group.repositories.push(entry.repository);
    if (!group.incidents.includes(entry.incident)) group.incidents.push(entry.incident);
    group.occurrences += 1;
    if (entry.recordedAt >= group.lastRecordedAt) group.lastRecordedAt = entry.recordedAt;
    if (optional(entry.summary)) group.summary = /** @type {string} */ (entry.summary);
    if (optional(entry.fix)) group.fix = /** @type {string} */ (entry.fix);
    if (optional(entry.control)) group.control = /** @type {string} */ (entry.control);
    groups.set(entry.id, group);
  }
  const mistakes = [...groups.values()]
    .filter((group) => !repeated || group.incidents.length >= 2)
    .map((group) => repeated ? { ...group, proposedControl: group.control ?? null, hint: repeatedMistakeHint } : group);
  return { ok: true, operation: `${kind}-list`, kind, repeated, path: mistakeLogPath(home), mistakes };
}
