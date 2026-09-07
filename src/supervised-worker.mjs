// @ts-check
import { execFileSync, spawn } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stopDetachedProcess } from "./bounded-process.mjs";

/** @param {unknown} value @returns {value is Record<string, any>} */
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

/** Read only the owning turn. Missing/unreadable ownership stops execution.
 * @param {{databasePath:string, threadId:string, turnId:string}} owner
 */
export function owningTurnIsRunning(owner) {
  if (!uuid.test(owner.threadId) || !uuid.test(owner.turnId) || !isAbsolute(owner.databasePath)) {
    throw new Error("owner requires an absolute databasePath and exact thread/turn UUIDs");
  }
  const sql = `SELECT state,completed_at FROM projection_turns WHERE thread_id='${owner.threadId}' AND turn_id='${owner.turnId}'`;
  const rows = JSON.parse(execFileSync("sqlite3", ["-readonly", "-json", owner.databasePath, sql], {
    encoding: "utf8", timeout: 2_000, maxBuffer: 16_384, stdio: ["ignore", "pipe", "pipe"],
  }) || "[]");
  return rows.length === 1 && rows[0].state === "running" && rows[0].completed_at === null;
}

/** Execute an already-authorized worker, tied to one T3 turn, without model polling.
 * The input is an execution request, not an authorization or confinement proof.
 * @param {unknown} input
 */
export async function runSupervisedWorker(input) {
  if (!record(input) || !record(input.owner) || typeof input.command !== "string" || !input.command.trim() ||
      !Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string") ||
      typeof input.cwd !== "string" || !isAbsolute(input.cwd) ||
      typeof input.outputDirectory !== "string" || !isAbsolute(input.outputDirectory)) {
    throw new Error("run-worker requires command, args, absolute cwd/outputDirectory and owner");
  }
  const owner = /** @type {{databasePath:string, threadId:string, turnId:string}} */ (input.owner);
  if (!owningTurnIsRunning(owner)) throw new Error("Owning turn is not running; worker was not started");
  const directory = input.outputDirectory;
  // A directory identifies one attempt. Never truncate a previous attempt's evidence.
  await mkdir(directory, { mode: 0o700 });
  const stdout = await open(join(directory, "stdout.jsonl"), "wx", 0o600);
  let stderr;
  try { stderr = await open(join(directory, "stderr.log"), "wx", 0o600); }
  catch (error) { await stdout.close(); throw error; }
  const startedAt = new Date().toISOString();
  const child = spawn(input.command, input.args, {
    cwd: input.cwd, detached: true, stdio: ["ignore", stdout.fd, stderr.fd],
  });
  /** @type {string | null} */ let stopReason = null;
  /** @type {string | null} */ let processError = null;
  let finished = false;
  const completion = new Promise((resolve) => {
    child.once("error", (error) => { processError = error.message; });
    child.once("close", (status, signal) => { finished = true; resolve({ status, signal }); });
  });
  const interrupt = () => { stopReason = "supervisor-interrupted"; };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    await writeFile(join(directory, "started.json"), JSON.stringify({
      owner, pid: child.pid, command: input.command, cwd: input.cwd, startedAt,
    }, null, 2), { flag: "wx", mode: 0o600 });
    while (!finished && !stopReason) {
      try { if (!owningTurnIsRunning(owner)) stopReason = "owning-turn-ended"; }
      catch { stopReason = "ownership-unavailable"; }
      if (!stopReason) await Promise.race([completion, delay(500)]);
    }
    if (stopReason && !finished) await stopDetachedProcess(child);
    const result = /** @type {{status:number|null, signal:string|null}} */ (await completion);
    await stopDetachedProcess(child);
    const receipt = {
      operation: "run-worker", ok: !stopReason && !processError && result.status === 0, owner, pid: child.pid ?? null, startedAt,
      endedAt: new Date().toISOString(), status: result.status, signal: result.signal,
      stopReason, error: processError, completed: !stopReason && !processError && result.status === 0,
      outputDirectory: directory,
    };
    await writeFile(join(directory, "result.json"), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
    return receipt;
  } finally {
    // Also stop on receipt/write errors; never leave a detached writer behind.
    await stopDetachedProcess(child);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await Promise.all([stdout.close(), stderr.close()]);
  }
}
