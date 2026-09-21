// @ts-check
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FLASH_PROFILE = Object.freeze({ provider: "opencode-go", model: "opencode-go/deepseek-v4.1-flash", reasoning: "high" });

/** Never delegate classifier credentials or shell/interpreter injection options.
 * @param {NodeJS.ProcessEnv} [environment] */
export function workerEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(?:TYPESAFE|JEV|AOHYS_JEV)/iu.test(key)
    && !["NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "CODEX_THREAD_ID", "OPENCODE_CONFIG_CONTENT", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"].includes(key)));
}

/** @param {string|null} packetPath @param {string} candidateRoot @param {string} prompt */
export function flashArguments(packetPath, candidateRoot, prompt) {
  return ["run", prompt,
    "--pure", "--format", "json", "--model", FLASH_PROFILE.model, "--variant", FLASH_PROFILE.reasoning,
    "--dir", candidateRoot, ...(packetPath ? ["--file", packetPath] : [])];
}

/** Session comes only from actual process stdout JSON events, never input JSON.
 * @param {string} stdout */
export function observedOpenCodeSession(stdout) {
  const sessions = new Set();
  for (const line of stdout.split("\n")) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    const id = event.sessionID ?? event.part?.sessionID;
    if (typeof id === "string" && /^ses_[A-Za-z0-9]+$/u.test(id)) sessions.add(id);
  }
  if (sessions.size !== 1) throw new Error("OpenCode did not emit one attributable session.");
  return /** @type {string} */ ([...sessions][0]);
}

/** Export uses the same executable, cwd and environment as the attached child.
 * Requested command flags are never accepted as observed identity.
 * @param {{executable:string,sessionId:string,candidateRoot:string,env:NodeJS.ProcessEnv}} options */
export async function collectOpenCodeObservation({ executable, sessionId, candidateRoot, env }) {
  const directory = await mkdtemp(join(tmpdir(), "governance-export-"));
  const path = join(directory, "export.json");
  const file = await open(path, "wx", 0o600);
  let stdout;
  try {
    await new Promise((done, reject) => {
      const child = spawn(executable, ["export", sessionId, "--pure"], { cwd: candidateRoot, env, shell: false, stdio: ["ignore", file.fd, "ignore"] });
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 10000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); if (code === 0) done(undefined); else reject(new Error("OpenCode export failed")); });
    });
    if ((await file.stat()).size > 16 * 1024 * 1024) throw new Error("OpenCode export exceeded its private spool cap");
    stdout = await readFile(path, "utf8");
  } finally { await file.close(); await rm(directory, { recursive: true, force: true }); }
  /** @type {any} */ const exported = JSON.parse(stdout);
  if (exported.info?.id !== sessionId || !Array.isArray(exported.messages)) throw new Error("OpenCode export session provenance is unavailable.");
  const assistants = exported.messages.filter((/** @type {any} */ message) => message.info?.role === "assistant");
  if (!assistants.length) throw new Error("OpenCode export has no observed assistant identity.");
  for (const message of assistants) {
    const info = message.info;
    if (info.sessionID !== sessionId || info.providerID !== FLASH_PROFILE.provider || info.modelID !== "deepseek-v4.1-flash" || info.variant !== FLASH_PROFILE.reasoning)
      throw new Error("OpenCode served identity does not match the permitted profile.");
  }
  const output = assistants.flatMap((/** @type {any} */ message) => (message.parts ?? []).filter((/** @type {any} */ part) => part.type === "text")
    .map((/** @type {any} */ part) => typeof part.text === "string" ? part.text : "")).join("\n");
  return { ...FLASH_PROFILE, sessionId, output };
}
