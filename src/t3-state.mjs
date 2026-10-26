// @ts-check
// Read-only view of T3 Code's own state database: which runs are active and which native Claude Code or Codex
// session backs a T3 thread. Opened read-only; nothing here writes T3 state.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ACTIVE = new Set(["queued", "preparing", "starting", "running", "waiting"]);
const CLOSED = new Set(["completed", "cancelled", "failed", "interrupted", "rolled_back"]);

/** @param {string} home */
export const t3StatePath = (home) => resolve(home, ".t3/userdata/statev2.sqlite");

/** @param {string} home @returns {DatabaseSync | null} */
function open(home) {
  const file = t3StatePath(home);
  if (!existsSync(file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}

/**
 * The native session behind a T3 thread: `{driver, nativeId}` from its provider thread, or null when T3 has none.
 * @param {string} home @param {string} threadId
 */
export function nativeThread(home, threadId) {
  const db = open(home);
  if (!db) return null;
  try {
    for (const row of db.prepare("select payload_json from orchestration_v2_projection_provider_threads where thread_id = ? order by updated_at desc").all(threadId)) {
      const ref = JSON.parse(String(row.payload_json))?.nativeThreadRef;
      if (ref && typeof ref.nativeId === "string" && ref.nativeId && typeof ref.driver === "string") return { driver: ref.driver, nativeId: ref.nativeId };
    }
    return null;
  } finally { db.close(); }
}

/**
 * Whether any T3 run is active, correlated by thread and run. Precedence: any run in an active status makes the
 * state `active` (a later close of another run or a child does not cancel it); `terminated` only when every thread's
 * latest run has its own observed close; an unreadable database or a latest run in neither state is `unknown`.
 * Age alone never decides. The calling thread itself (its native session in `exclude`) is left out.
 * @param {{home: string, exclude?: string[]}} options
 */
export function activeRuns({ home, exclude = [] }) {
  /** @type {DatabaseSync | null} */
  let db;
  try { db = open(home); } catch (error) { return { state: /** @type {const} */ ("unknown"), reason: `T3 state unreadable: ${error instanceof Error ? error.message : String(error)}`, threads: [] }; }
  if (!db) return { state: /** @type {const} */ ("unknown"), reason: `T3 state not found at ${t3StatePath(home)}`, threads: [] };
  try {
    const own = new Set(exclude.filter(Boolean));
    /** @type {Set<string>} */
    const ownThreads = new Set();
    if (own.size) {
      for (const row of db.prepare("select thread_id, payload_json from orchestration_v2_projection_provider_threads").all()) {
        try { if (own.has(JSON.parse(String(row.payload_json))?.nativeThreadRef?.nativeId)) ownThreads.add(String(row.thread_id)); } catch { /* skip malformed rows */ }
      }
    }
    const statuses = [...ACTIVE].map(() => "?").join(", ");
    const active = db.prepare(`select run_id, thread_id, ordinal, provider, status, requested_at from orchestration_v2_projection_runs where status in (${statuses}) order by requested_at`).all(...ACTIVE)
      .filter((row) => !ownThreads.has(String(row.thread_id)))
      .map((row) => ({ threadId: String(row.thread_id), runId: String(row.run_id), ordinal: Number(row.ordinal), provider: String(row.provider), status: String(row.status), requestedAt: String(row.requested_at) }));
    if (active.length) return { state: /** @type {const} */ ("active"), reason: `${new Set(active.map((run) => run.threadId)).size} thread(s) with active runs`, threads: active };
    const latest = db.prepare("select r.thread_id, r.run_id, r.status, r.completed_at from orchestration_v2_projection_runs r join (select thread_id, max(ordinal) as ordinal from orchestration_v2_projection_runs group by thread_id) m on m.thread_id = r.thread_id and m.ordinal = r.ordinal").all()
      .filter((row) => !ownThreads.has(String(row.thread_id)));
    const open_ = latest.filter((row) => !CLOSED.has(String(row.status)) || !row.completed_at);
    if (open_.length) return { state: /** @type {const} */ ("unknown"), reason: `${open_.length} thread(s) whose latest run has no observed close`, threads: open_.map((row) => ({ threadId: String(row.thread_id), runId: String(row.run_id), status: String(row.status) })) };
    return { state: /** @type {const} */ ("terminated"), reason: "every thread's latest run has an observed close", threads: [] };
  } catch (error) {
    return { state: /** @type {const} */ ("unknown"), reason: `T3 state unreadable: ${error instanceof Error ? error.message : String(error)}`, threads: [] };
  } finally { db.close(); }
}
