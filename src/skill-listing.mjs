// @ts-check
// What the last sessions of each host really announced and loaded. A copied skill folder proves nothing: the host
// decides what the model sees. Claude Code writes its listing as a `skill_listing` attachment in the session log and
// drops descriptions when the listing overflows its budget; Codex writes one line per skill in its first developer
// message and shortens each description to fit; Antigravity does not log the `<skills>` block in its transcripts so we
// report only observed SKILL.md reads without fabricating announced counts. This module only reads those logs.
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** @typedef {{ session: string, at: string, announced: number | null, withDescription: number | null, withoutDescription: string[], listingChars: number, loaded: { bySkillCall: string[], byReadingItsFile: string[] } }} SessionListing */

const MAX_ANTIGRAVITY_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

/** @param {string} directory @param {(name: string) => boolean} keep @param {number} depth */
async function newestFiles(directory, keep, depth) {
  /** @type {{ path: string, mtimeMs: number, size: number }[]} */
  const found = [];
  /** @param {string} current @param {number} left */
  async function walk(current, left) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) { if (left > 0) await walk(path, left - 1); }
      else if (entry.isFile() && keep(entry.name)) {
        try {
          const info = await stat(path);
          found.push({ path, mtimeMs: info.mtimeMs, size: info.size });
        } catch { /* removed meanwhile */ }
      }
    }
  }
  await walk(directory, depth);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** @param {string} path */
async function jsonLines(path) {
  /** @type {any[]} */
  const rows = [];
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a line still being written */ }
  }
  return rows;
}

/** The skill a `…/<name>/SKILL.md` path belongs to. @param {unknown} path */
const skillOfPath = (path) => (typeof path === "string" && /(^|\/)SKILL\.md$/.test(path) ? basename(dirname(path)) : null);

/**
 * One Claude Code session. `bySkillCall` covers the Skill tool and `/name`; `byReadingItsFile` covers a Read of its
 * SKILL.md. A skill a `paths:` rule activates leaves no separate record this reader can tell apart.
 * @param {string} path @param {number} mtimeMs @returns {Promise<SessionListing | null>}
 */
async function claudeSession(path, mtimeMs) {
  /** @type {any} */
  let listing = null;
  const calls = new Set(), reads = new Set();
  for (const row of await jsonLines(path)) {
    if (row?.attachment?.type === "skill_listing" && row.attachment.isInitial && !listing) listing = row.attachment;
    for (const name of row?.attachment?.type === "invoked_skills" && Array.isArray(row.attachment.skills) ? row.attachment.skills : []) {
      if (typeof name?.name === "string") calls.add(name.name);
    }
    for (const part of Array.isArray(row?.message?.content) ? row.message.content : []) {
      if (part?.type !== "tool_use") continue;
      if (part.name === "Skill" && typeof part.input?.skill === "string") calls.add(part.input.skill);
      const read = part.name === "Read" ? skillOfPath(part.input?.file_path) : null;
      if (read) reads.add(read);
    }
  }
  if (!listing || typeof listing.content !== "string") return null;
  // A plugin skill is named `plugin:skill`, so the name ends at the first colon followed by a space.
  const rows = listing.content.split("\n").filter((/** @type {string} */ row) => row.startsWith("- "));
  const bare = rows.filter((/** @type {string} */ row) => !/^- \S+?: \S/.test(row)).map((/** @type {string} */ row) => row.slice(2).trim());
  return {
    session: basename(path, ".jsonl"), at: new Date(mtimeMs).toISOString(), announced: rows.length,
    withDescription: rows.length - bare.length, withoutDescription: bare, listingChars: listing.content.length,
    loaded: { bySkillCall: [...calls].sort(), byReadingItsFile: [...reads].sort() },
  };
}

/**
 * One Codex session. Codex never drops a description; it cuts each one, so `withoutDescription` lists the entries
 * whose description is empty and `shortestDescriptions` shows how much text the model had to choose with.
 * @param {string} path @param {number} mtimeMs
 */
async function codexSession(path, mtimeMs) {
  /** @type {string[] | null} */
  let rows = null;
  const reads = new Set();
  for (const row of await jsonLines(path)) {
    const payload = row?.payload;
    if (!rows && row?.type === "response_item" && payload?.role === "developer") {
      for (const part of Array.isArray(payload.content) ? payload.content : []) {
        const text = typeof part?.text === "string" ? part.text : "";
        const entries = text.split("\n").filter((/** @type {string} */ line) => /^- [^:]+:.*\(file: .*SKILL\.md\)\s*$/.test(line));
        if (entries.length > 0) { rows = entries; break; }
      }
    }
    // A shell or read call whose arguments name a SKILL.md is the model opening that skill.
    const args = payload?.type === "function_call" || payload?.type === "local_shell_call" || payload?.type === "custom_tool_call"
      ? JSON.stringify(payload.arguments ?? payload.action ?? payload.input ?? "") : "";
    for (const match of args.matchAll(/([\w.-]+)\/SKILL\.md/g)) reads.add(match[1]);
  }
  if (!rows) return null;
  const parsed = rows.map((row) => /^- ([^:]+):(.*)\(file: .*\)\s*$/.exec(row)).filter((match) => match !== null)
    .map((match) => ({ name: match[1].trim(), description: match[2].trim() }));
  const lengths = parsed.map((entry) => entry.description.length).sort((a, b) => a - b);
  return {
    session: basename(path, ".jsonl"), at: new Date(mtimeMs).toISOString(), announced: parsed.length,
    withDescription: parsed.filter((entry) => entry.description.length > 0).length,
    withoutDescription: parsed.filter((entry) => entry.description.length === 0).map((entry) => entry.name),
    listingChars: rows.join("\n").length, medianDescriptionChars: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0,
    loaded: { bySkillCall: [], byReadingItsFile: [...reads].sort() },
  };
}

/**
 * One Antigravity session (standalone CLI/App or T3 Code ACP). Bounded and fail-safe on corrupt/binary
 * files; never prints transcript contents and never fabricates announced counts when the host omits `<skills>`.
 * @param {string} path @param {number} mtimeMs @param {number} size
 */
async function antigravitySession(path, mtimeMs, size) {
  if (size > MAX_ANTIGRAVITY_TRANSCRIPT_BYTES) return null;
  const rows = await jsonLines(path);
  if (rows.length === 0) return null;
  const reads = new Set();
  let validRows = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    validRows += 1;
    const toolCalls = Array.isArray(row.tool_calls) ? row.tool_calls : [];
    for (const call of toolCalls) {
      const name = String(call?.name ?? call?.function?.name ?? "");
      if (!["read_file", "view_file"].includes(name)) continue;
      let args = call?.arguments ?? call?.args ?? call?.function?.arguments ?? null;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = null; }
      }
      const candidate = args?.Path ?? args?.AbsolutePath ?? args?.path ?? null;
      const skill = skillOfPath(candidate);
      if (skill) reads.add(skill);
    }
  }
  if (validRows === 0) return null;
  // Directory layout: .../brain/<conversationId>/.system_generated/logs/transcript.jsonl
  const logsDir = dirname(path);
  const generatedDir = dirname(logsDir);
  const sessionId = basename(dirname(generatedDir)) || basename(path, ".jsonl");
  return {
    session: sessionId,
    at: new Date(mtimeMs).toISOString(),
    announced: null,
    withDescription: null,
    withoutDescription: [],
    listingChars: 0,
    listingLogged: false,
    loaded: { bySkillCall: [], byReadingItsFile: [...reads].sort() },
  };
}

/**
 * The newest session of each host that carries a skill listing (or observed reads for Antigravity).
 * Descriptive only: it never changes `ok`.
 * @param {{ home: string, scan?: number }} options `scan` bounds how many recent logs are opened per host
 */
export async function skillListingReport({ home, scan = 12 }) {
  /** @param {{ path: string, mtimeMs: number, size: number }[]} logs @param {(path: string, mtimeMs: number, size: number) => Promise<any>} reader */
  const first = async (logs, reader) => {
    for (const log of logs.slice(0, scan)) {
      const session = await reader(log.path, log.mtimeMs, log.size).catch(() => null);
      if (session) return session;
    }
    return null;
  };
  const claude = await first(await newestFiles(join(home, ".claude", "projects"), (name) => name.endsWith(".jsonl"), 1), claudeSession);
  const codex = await first(await newestFiles(join(home, ".codex", "sessions"), (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"), 3), codexSession);
  const agLogs = [
    ...(await newestFiles(join(home, ".gemini", "antigravity", "brain"), (name) => name === "transcript.jsonl", 4)),
    ...(await newestFiles(join(home, ".gemini", "antigravity-cli", "brain"), (name) => name === "transcript.jsonl", 4)),
    ...(await newestFiles(join(home, ".t3", "userdata", "providers", "antigravity"), (name) => name === "transcript.jsonl", 6)),
  ].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const antigravity = await first(agLogs, antigravitySession);
  return { claude, codex, antigravity };
}

/** @param {Awaited<ReturnType<typeof skillListingReport>>} report */
export function formatSkillListing(report) {
  /** @param {string} host @param {any} session */
  const line = (host, session) => {
    if (!session) return `skills ${host}: no session log with a skill listing`;
    const loaded = [...new Set([...session.loaded.bySkillCall, ...session.loaded.byReadingItsFile])];
    if (session.announced === null) {
      return `skills ${host}: listing not logged by host; loaded in latest session: ${loaded.length}${loaded.length ? ` (${loaded.join(", ")})` : ""}`;
    }
    const median = "medianDescriptionChars" in session ? `, median description ${session.medianDescriptionChars} characters` : "";
    return `skills ${host}: ${session.announced} announced, ${session.withDescription} with description, ${session.withoutDescription.length} without${median}; loaded in that session: ${loaded.length}${loaded.length ? ` (${loaded.join(", ")})` : ""}`;
  };
  return [line("claude", report.claude), line("codex", report.codex), line("antigravity", report.antigravity)];
}
