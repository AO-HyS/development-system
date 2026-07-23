// @ts-check

import { spawn } from "node:child_process";

/** @param {import("node:child_process").ChildProcess} child @param {number} [graceMs] */
export async function stopDetachedProcess(child, graceMs = 3_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  /** @param {NodeJS.Signals} signal */
  const signalGroup = (signal) => {
    try {
      if (!child.pid) throw new Error("Child process has no process id");
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  /** @param {number} timeoutMs */
  const waitForExit = (timeoutMs) =>
    Promise.race([
      new Promise((resolvePromise) => child.once("exit", () => resolvePromise(true))),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
    ]);

  signalGroup("SIGTERM");
  if (await waitForExit(graceMs)) return;
  signalGroup("SIGKILL");
  if (!await waitForExit(graceMs)) {
    throw new Error("Detached process group did not exit after SIGKILL");
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, maxBuffer?: number, graceMs?: number}} options
 */
export async function runBoundedProcess(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let overflow = false;
  const maxBuffer = options.maxBuffer ?? 20 * 1024 * 1024;
  /** @param {string} current @param {Buffer | string} chunk */
  const append = (current, chunk) => {
    const next = current + chunk.toString();
    if (Buffer.byteLength(next) > maxBuffer) overflow = true;
    return next.slice(0, maxBuffer);
  };
  child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
  child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
  let finished = false;
  const completion = new Promise((resolvePromise) => {
    child.once("error", (error) => {
      finished = true;
      resolvePromise({ error });
    });
    child.once("exit", (status, signal) => {
      finished = true;
      resolvePromise({ status, signal });
    });
  });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; }, options.timeoutMs ?? 10 * 60 * 1000);
  while (!finished && !timedOut && !overflow) {
    await Promise.race([
      completion,
      new Promise((resolvePromise) => setTimeout(resolvePromise, 25)),
    ]);
  }
  if ((timedOut || overflow) && child.exitCode === null && child.signalCode === null) {
    await stopDetachedProcess(child, options.graceMs);
  }
  const result = /** @type {any} */ (await completion);
  clearTimeout(timeout);
  return {
    command: [command, ...args].join(" "),
    status: timedOut || overflow ? null : (result.status ?? child.exitCode),
    signal: result.signal ?? child.signalCode,
    stdout,
    stderr,
    error: result.error?.message ??
      (timedOut ? `Timed out after ${options.timeoutMs ?? 10 * 60 * 1000}ms` : null) ??
      (overflow ? `Output exceeded ${maxBuffer} bytes` : null),
    timedOut,
    overflow,
  };
}
