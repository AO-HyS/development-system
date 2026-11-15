// @ts-check
// `development-system smoke` (3.0.0, owner addition of 2026-11-15): a QuickE2E smoke that always runs and never
// blocks a merge into develop. It runs the existing `quicke2e run` (same module the CLI uses) with the repository's
// private flow `~/.development-system/private/quicke2e-flows/<repo-name>/smoke.json` (or `--flujo`), prints the run
// record and publishes a `smoke` commit status on the checkout's HEAD when that commit is on GitHub and the checkout
// is clean (a dirty tree is not the commit the status would name). `listo` only shows that status for develop;
// `listo --produccion` requires it on the promoted head.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { flowRoot, runQuicke2e } from "./quicke2e.mjs";

export const SMOKE_CONTEXT = "smoke";

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** @param {string[]} args */
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** owner/repo of the checkout's `origin` on GitHub, or null. @param {string} top */
export function githubRepoOf(top) {
  try {
    const url = git(top, ["remote", "get-url", "origin"]);
    const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch { return null; }
}

/** @param {string[]} argv arguments after `smoke` */
export function parseSmokeArgs(argv) {
  /** @type {{repo?: string, base?: string, flujo?: string, home?: string, sinEstado: boolean, json: boolean}} */
  const options = { sinEstado: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--sin-estado") { options.sinEstado = true; continue; }
    if (["--repo", "--base", "--flujo", "--home"].includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} necesita un valor`);
      options[/** @type {"repo" | "base" | "flujo" | "home"} */ (arg.slice(2))] = value;
      continue;
    }
    throw new Error(`opción desconocida para smoke: ${arg}`);
  }
  if (!options.base) throw new Error("falta --base <url de la app>: development-system smoke --base http://localhost:3000");
  return options;
}

/** @param {string[]} argv arguments after `smoke` */
export function runSmokeCommand(argv) {
  const options = parseSmokeArgs(argv);
  const home = path.resolve(options.home ?? homedir());
  const checkout = path.resolve(options.repo ?? process.cwd());
  let top = "";
  try { top = git(checkout, ["rev-parse", "--show-toplevel"]); } catch { throw new Error(`${checkout} no es un checkout de git: pasa --repo <checkout>`); }
  const name = path.basename(top);
  const flow = options.flujo ? path.resolve(options.flujo) : path.join(flowRoot(home), name, "smoke.json");
  if (!existsSync(flow)) {
    const result = { ok: false, operation: "smoke", estado: "sin-flujo", flujo: flow };
    return { result, output: options.json ? JSON.stringify(result) : `Smoke: no hay flujo para ${name}.\nsiguiente: crea ${flow} (flujo declarativo de QuickE2E, fuera del repositorio) y corre de nuevo development-system smoke --repo ${top} --base ${options.base}`, json: options.json, code: 2 };
  }
  const head = git(top, ["rev-parse", "HEAD"]);
  const clean = git(top, ["status", "--porcelain"]) === "";
  const started = Date.now();
  const run = runQuicke2e({ home, args: ["run", flow, "--base", String(options.base), "--repo", top] });
  const seconds = Math.round((Date.now() - started) / 1000);
  const ran = /** @type {{ok: boolean, run?: string, passed?: number, total?: number}} */ (run.result);
  const ok = ran.ok === true;
  const description = `QuickE2E ${ran.passed ?? 0}/${ran.total ?? 0} en ${seconds} s${ok ? "" : " (falló)"}`;
  let status = "";
  if (options.sinEstado) status = "no publicado (--sin-estado)";
  else if (!clean) status = "no publicado: el checkout tiene cambios sin commit, así que la corrida no es la de HEAD";
  else {
    const remote = githubRepoOf(top);
    let onRemote = false;
    if (remote) { try { gh(["api", `repos/${remote.owner}/${remote.repo}/commits/${head}`, "--jq", ".sha"]); onRemote = true; } catch { onRemote = false; } }
    if (!remote) status = "no publicado: origin no es un repositorio de GitHub";
    else if (!onRemote) status = `no publicado: ${head.slice(0, 12)} no está en GitHub (haz push y corre de nuevo)`;
    else {
      gh(["api", `repos/${remote.owner}/${remote.repo}/statuses/${head}`, "-f", `state=${ok ? "success" : "failure"}`, "-f", `context=${SMOKE_CONTEXT}`, "-f", `description=${description}`]);
      status = `publicado en ${remote.owner}/${remote.repo}@${head.slice(0, 12)} (${ok ? "success" : "failure"})`;
    }
  }
  const result = { ok, operation: "smoke", estado: ok ? "pasó" : "falló", head, flujo: flow, corrida: ran.run ?? "", segundos: seconds, estadoGithub: status };
  const lines = [run.output, `Smoke ${ok ? "pasó" : "falló"}: ${description}. Corrida: ${ran.run ?? "sin registro"}. Estado smoke: ${status}.`,
    ok ? "siguiente: nada que hacer por el smoke; no bloquea fusionar a develop" : "siguiente: abre la corrida, arregla lo que se rompió y corre el smoke de nuevo (no bloquea develop, sí producción)"];
  return { result, output: options.json ? JSON.stringify(result) : lines.join("\n"), json: options.json, code: ok ? 0 : 1 };
}
