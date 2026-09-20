// @ts-check

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { AtomScheduler, orchestrationPolicy, stableHash, validateWorkflowPlan } from "./orchestration.mjs";

export const workflowPolicy = orchestrationPolicy;

/** @param {unknown} error @param {string} code */
function hasCode(error, code) { return error instanceof Error && "code" in error && error.code === code; }

/** @param {number} pid */
function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (hasCode(error, "ESRCH")) return false; throw error; }
}

/** @param {string} directory @param {any} [recovery] */
async function acquireController(directory, recovery) {
  const path = join(directory, "controller.lock");
  if (recovery !== undefined) {
    // Serialize recovery itself: two stale readers must never unlink a newly acquired lock.
    const recoveryPath = join(directory, "controller-recovery.lock");
    const recoveryLock = await open(recoveryPath, "wx", 0o600);
    try {
      const prior = JSON.parse(await readFile(path, "utf8"));
      if (recovery.terminationObserved !== true || recovery.controllerId !== prior.controllerId || recovery.pid !== prior.pid
        || prior.hostname !== hostname() || !Number.isSafeInteger(prior.pid) || prior.pid <= 0 || processExists(prior.pid)) {
        throw new Error("controller recovery requires the matching local controller and observed process termination");
      }
      await unlink(path);
    } finally {
      await recoveryLock.close();
      await unlink(recoveryPath);
    }
  }
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (error) {
    if (hasCode(error, "EEXIST")) throw new Error("workflow already has an owning controller; explicit terminated-controller recovery is required");
    throw error;
  }
  const controller = { controllerId: randomUUID(), pid: process.pid, hostname: hostname() };
  try { await handle.writeFile(JSON.stringify(controller) + "\n"); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(path); throw error; }
  await handle.close();
  return controller;
}

/** @param {string} directory @param {any} controller */
async function assertController(directory, controller) {
  const observed = JSON.parse(await readFile(join(directory, "controller.lock"), "utf8"));
  if (observed.controllerId !== controller.controllerId || observed.pid !== process.pid) throw new Error("workflow controller ownership was lost");
}

/** Copy the scheduler state, preserving the same state machine for memory and disk. @param {AtomScheduler} source */
function copyScheduler(source) {
  const target = new AtomScheduler(source.plan, { durable: true });
  target.atoms = new Map([...source.atoms].map(([id, atom]) => [id, structuredClone(atom)]));
  target.leases = new Map(source.leases);
  target.activeAttempts = new Map([...source.activeAttempts].map(([id, attempt]) => [id, structuredClone(attempt)]));
  target.events = structuredClone(source.events);
  return target;
}

/** @param {any} data */
function restoreScheduler(data) {
  if (data?.schemaVersion !== 1 || data.policyVersion !== workflowPolicy.version || !Number.isSafeInteger(data.revision) || data.revision < 0
    || !data.plan || data.planHash !== stableHash(data.plan) || !data.scheduler || typeof data.checksum !== "string") throw new Error("invalid workflow snapshot envelope");
  const { checksum, ...payload } = data;
  if (checksum !== stableHash(payload)) throw new Error("workflow snapshot checksum mismatch");
  const scheduler = new AtomScheduler(data.plan, { durable: true });
  const snapshot = data.scheduler;
  if (snapshot.runId !== data.plan.runId || !Array.isArray(snapshot.atoms) || snapshot.atoms.length !== scheduler.atoms.size
    || !Array.isArray(snapshot.events) || !snapshot.activeAttempts || !snapshot.leases) throw new Error("invalid workflow scheduler snapshot");
  const states = new Set(["planned", "ready", "blocked", "running", "awaiting-verification", "reviewing", "cancelling", "recovery-required", "failed", "cancelled", "verified"]);
  const activeStates = new Set(["running", "awaiting-verification", "reviewing", "cancelling", "recovery-required"]);
  const restored = new Map();
  for (const atom of snapshot.atoms) {
    const planned = scheduler.atoms.get(atom.id);
    if (!planned || restored.has(atom.id) || !states.has(atom.state) || !Number.isSafeInteger(atom.attempt) || atom.attempt < 0
      || Object.keys(data.plan.atoms.find((/** @type {any} */ item) => item.id === atom.id)).some((key) => stableHash(atom[key]) !== stableHash(planned[key]))) throw new Error("stored atom does not match the validated plan");
    const active = snapshot.activeAttempts[atom.id];
    if (Boolean(active) !== activeStates.has(atom.state)) throw new Error("stored process ownership does not match atom state");
    if (active && (active.atomId !== atom.id || active.runId !== data.plan.runId || active.baseSha !== data.plan.baseSha
      || active.execution?.model !== atom.execution.model || active.execution?.effort !== atom.execution.effort || active.execution?.adapter !== atom.execution.adapter)) throw new Error("stored attempt identity or model does not match the plan");
    restored.set(atom.id, atom);
  }
  if (Object.keys(snapshot.activeAttempts).some((id) => !restored.has(id))) throw new Error("stored attempt has no atom");
  scheduler.atoms = restored;
  scheduler.activeAttempts = new Map(Object.entries(snapshot.activeAttempts));
  const leases = new Map();
  for (const [id, attempt] of scheduler.activeAttempts) {
    for (const path of scheduler.atoms.get(id).writeSet) leases.set(path, attempt.attemptId);
  }
  if (stableHash(Object.fromEntries(leases)) !== stableHash(snapshot.leases)) throw new Error("stored leases do not match process ownership");
  scheduler.leases = leases;
  scheduler.events = snapshot.events;
  return scheduler;
}

/** Atomic replacement retains the prior committed snapshot if writing fails before rename.
 * @param {string} directory @param {AtomScheduler} scheduler @param {number} revision */
async function persist(directory, scheduler, revision) {
  const payload = { schemaVersion: 1, policyVersion: workflowPolicy.version, planHash: stableHash(scheduler.plan), plan: scheduler.plan, revision, scheduler: scheduler.snapshot() };
  const path = join(directory, "workflow.json");
  const temporary = join(directory, `.workflow-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify({ ...payload, checksum: stableHash(payload) }, null, 2) + "\n"); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(temporary); throw error; }
  await handle.close();
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary); throw error; }
  const directoryHandle = await open(directory, "r");
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
}

/** Single owning controller. Mutations serialize, persist, then emit `change`.
 * Process adapters call complete/verify from completion events; the store does not poll or spawn.
 * Receipt termination and observed provider identity are facts supplied by the trusted controller.
 */
export class WorkflowStore extends EventEmitter {
  /** @type {AtomScheduler} */ #scheduler;
  /** @type {Promise<unknown>} */ #queue = Promise.resolve();
  #closed = false;
  #faulted = false;
  #revision;
  #directory;
  #controller;

  /** @param {string} directory @param {AtomScheduler} scheduler @param {number} revision @param {any} controller */
  constructor(directory, scheduler, revision, controller) {
    super();
    this.#directory = directory;
    this.#scheduler = scheduler;
    this.#revision = revision;
    this.#controller = controller;
  }

  /** @param {{directory: string, plan: any}} input */
  static async create({ directory, plan }) {
    const errors = validateWorkflowPlan(plan);
    if (errors.length) throw new Error(`Invalid workflow plan:\n${errors.join("\n")}`);
    await mkdir(directory, { recursive: true });
    directory = await realpath(directory);
    const controller = await acquireController(directory);
    try {
      try { await readFile(join(directory, "workflow.json")); throw new Error("workflow already exists; open the existing run"); }
      catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
      const scheduler = new AtomScheduler(plan, { durable: true });
      await persist(directory, scheduler, 0);
      return new WorkflowStore(directory, scheduler, 0, controller);
    } catch (error) { await unlink(join(directory, "controller.lock")); throw error; }
  }

  /** Open does not resume an interrupted process or infer its termination.
   * @param {{directory: string, plan?: any, recoverController?: {controllerId: string, pid: number, terminationObserved: boolean}}} input */
  static async open({ directory, plan, recoverController }) {
    directory = await realpath(directory);
    const controller = await acquireController(directory, recoverController);
    try {
      const data = JSON.parse(await readFile(join(directory, "workflow.json"), "utf8"));
      const scheduler = restoreScheduler(data);
      if (plan !== undefined && stableHash(plan) !== data.planHash) throw new Error("resume plan or model pins do not match the persisted run");
      let revision = data.revision;
      if (scheduler.requireRecovery()) await persist(directory, scheduler, ++revision);
      return new WorkflowStore(directory, scheduler, revision, controller);
    } catch (error) { await unlink(join(directory, "controller.lock")); throw error; }
  }

  snapshot() {
    return { ...this.#scheduler.snapshot(), revision: this.#revision, policyVersion: workflowPolicy.version,
      plan: structuredClone(this.#scheduler.plan), controller: structuredClone(this.#controller) };
  }

  ready() { return this.#scheduler.ready(); }
  awaitingVerification() { return this.#scheduler.awaitingVerification(); }

  /** @param {(scheduler: AtomScheduler) => any} action */
  #mutate(action) {
    const mutation = this.#queue.then(async () => {
      if (this.#closed) throw new Error("workflow controller is closed");
      if (this.#faulted) throw new Error("workflow persistence failed; reopen the controller before further mutations");
      await assertController(this.#directory, this.#controller);
      const candidate = copyScheduler(this.#scheduler);
      const event = action(candidate);
      try { await persist(this.#directory, candidate, this.#revision + 1); }
      catch (error) { this.#faulted = true; throw error; }
      this.#scheduler = candidate;
      this.#revision += 1;
      // A listener exception cannot turn a committed transition into an apparent failure.
      for (const listener of this.rawListeners("change")) {
        try { listener.call(this, structuredClone(event), this.snapshot()); }
        catch (error) { this.emit("listener-error", error); }
      }
      return event;
    });
    this.#queue = mutation.catch(() => {});
    return mutation;
  }

  /** @param {string} atomId @param {any} [execution] */
  start(atomId, execution) { return this.#mutate((scheduler) => scheduler.claim(atomId, execution)); }
  /** @param {string} atomId @param {any} receipt */
  complete(atomId, receipt) { return this.#mutate((scheduler) => scheduler.complete(atomId, receipt)); }
  /** @param {string} atomId @param {any} [execution] */
  startReview(atomId, execution) { return this.#mutate((scheduler) => scheduler.startReview(atomId, execution)); }
  /** @param {string} atomId @param {any} receipt */
  verify(atomId, receipt) { return this.#mutate((scheduler) => scheduler.verify(atomId, receipt)); }
  /** Validate a callback before an integration side effect; acceptance is persisted separately after integration succeeds.
   * @param {string} atomId @param {any} receipt */
  validateVerification(atomId, receipt) {
    if (this.#closed || this.#faulted) throw new Error("workflow controller is unavailable");
    return copyScheduler(this.#scheduler).verify(atomId, receipt);
  }
  /** @param {string} atomId @param {string} reason */
  cancel(atomId, reason) { return this.#mutate((scheduler) => scheduler.cancel(atomId, reason)); }
  /** @param {string} atomId @param {any} receipt */
  stopped(atomId, receipt) { return this.#mutate((scheduler) => scheduler.stopped(atomId, receipt)); }
  /** @param {string} atomId @param {string} [correction] */
  retry(atomId, correction) { return this.#mutate((scheduler) => scheduler.retry(atomId, correction)); }

  async close() {
    await this.#queue;
    if (this.#closed) return;
    this.#closed = true;
    await assertController(this.#directory, this.#controller);
    await unlink(join(this.#directory, "controller.lock"));
  }
}
