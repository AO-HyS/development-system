// @ts-check
// Codex weekly quota per account, read from the rate limits Codex records in its own session rollouts. Each observation
// belongs to the account named in that session's metadata; the credential homes (~/.codex, ~/.codex_extra, …) only locate
// session files and are deduplicated by real path and session id. Descriptive only: it reads, never changes, Codex state.
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

const WEEK_MINUTES = 10080;
const STALE_MS = 24 * 3_600_000;
// Rollouts older than the weekly window cannot hold a current observation.
const SCAN_MS = 8 * 24 * 3_600_000;
const WARN_PERCENT = 80;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 512 * 1024;

/** @param {string} file @param {number} start @param {number} length */
function readSlice(file, start, length) {
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(file, "r");
  try { return buffer.subarray(0, readSync(descriptor, buffer, 0, length, start)).toString("utf8"); }
  finally { closeSync(descriptor); }
}

/** Rollout files under one sessions directory modified since `since`. @param {string} root @param {number} since */
function rollouts(root, since) {
  /** @type {string[]} */
  const found = [];
  const pending = [root];
  while (pending.length) {
    const directory = /** @type {string} */ (pending.pop());
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        try { if (statSync(path).mtimeMs >= since) found.push(path); } catch { /* removed meanwhile */ }
      }
    }
  }
  return found;
}

/** @param {any} limits @returns {any | null} the window lasting a week, whichever slot holds it */
function weeklyWindow(limits) {
  for (const slot of [limits?.primary, limits?.secondary]) if (Number(slot?.window_minutes) === WEEK_MINUTES) return slot;
  return null;
}

/**
 * @param {{home: string, now?: number}} options
 */
export function codexQuota({ home, now = Date.now() }) {
  const homes = existsSync(home) ? readdirSync(home).filter((name) => /^\.codex(?:[_-][A-Za-z0-9_-]+)?$/u.test(name)) : [];
  /** @type {Map<string, string>} */
  const sources = new Map();
  for (const name of homes) {
    const sessions = join(home, name, "sessions");
    try { const real = realpathSync(sessions); if (!sources.has(real)) sources.set(real, name); } catch { /* no sessions here */ }
  }
  /** @type {Set<string>} */
  const seenSessions = new Set();
  /** @type {Map<string, {account: string, plan: string | null, usedPercent: number, resetsAt: string | null, observedAt: string, source: string, session: string}>} */
  const latest = new Map();
  for (const [root, source] of sources) {
    for (const file of rollouts(root, now - SCAN_MS)) {
      let meta;
      try { meta = JSON.parse(readSlice(file, 0, HEAD_BYTES).split("\n")[0]); } catch { continue; }
      if (meta?.type !== "session_meta") continue;
      const session = String(meta.payload?.id ?? meta.payload?.session_id ?? file);
      if (seenSessions.has(session)) continue;
      seenSessions.add(session);
      const account = typeof meta.payload?.creator_account_id === "string" && meta.payload.creator_account_id ? meta.payload.creator_account_id : "desconocida";
      const size = statSync(file).size;
      const lines = readSlice(file, Math.max(0, size - TAIL_BYTES), Math.min(size, TAIL_BYTES)).split("\n").reverse();
      for (const line of lines) {
        if (!line.includes("rate_limits")) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const window = weeklyWindow(entry?.payload?.rate_limits);
        if (!window || typeof entry.timestamp !== "string") continue;
        const observation = {
          account, plan: typeof entry.payload.rate_limits.plan_type === "string" ? entry.payload.rate_limits.plan_type : null,
          usedPercent: Number(window.used_percent), resetsAt: Number(window.resets_at) > 0 ? new Date(Number(window.resets_at) * 1000).toISOString() : null,
          observedAt: entry.timestamp, source, session,
        };
        const current = latest.get(account);
        // The most recent observation wins, so a reset window replaces the older, higher reading.
        if (!current || Date.parse(observation.observedAt) > Date.parse(current.observedAt)) latest.set(account, observation);
        break;
      }
    }
  }
  const accounts = [...latest.values()].map((item) => {
    const age = now - Date.parse(item.observedAt);
    const freshness = age > STALE_MS ? "obsoleto" : "vigente";
    return { ...item, account: item.account === "desconocida" ? item.account : `${item.account.slice(0, 8)}…`, freshness, warn: freshness === "vigente" && item.usedPercent >= WARN_PERCENT };
  }).sort((a, b) => b.usedPercent - a.usedPercent);
  return {
    state: accounts.length ? "observed" : "desconocido",
    sources: [...sources.values()],
    accounts,
    warnings: accounts.filter((item) => item.warn).map((item) => `Codex account ${item.account} at ${item.usedPercent}% of its weekly limit (observed ${item.observedAt}${item.resetsAt ? `, resets ${item.resetsAt}` : ""})`),
  };
}
