// @ts-check
import { constants } from "node:fs";
import { lstat, open, realpath, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { authorizeAction, closeRun, getRun, recordHostEvent, registerHostSession, resolveRunDirectory, stableHash } from "./core.mjs";
import { GOVERNANCE_COMMANDS, parseGovernanceArguments } from "./cli.mjs";

export const adapterCapabilities = Object.freeze([
  { surface: "root Bash", status: "host-observed", evidence: "Codex 0.155.1 prior allow/deny probe; this candidate needs its own live probe" },
  { surface: "root apply_patch", status: "implemented-unproved", evidence: "Exact patch paths checked; candidate hook mapping requires live observation" },
  { surface: "opaque code-mode and hosted tools", status: "unsupported", evidence: "No observed inner tool identity or completion attribution" },
  { surface: "native child writable actions", status: "unsupported", evidence: "No proven child session/model/effort binding" },
  { surface: "attached external lifetime and integration", status: "implemented-unproved", evidence: "Consumed dispatch, actual PID/exit, OpenCode export or fresh Codex transcript; parent reviews isolated writer changes; live candidate probe required" },
  { surface: "host-killed or missing hook", status: "host-limit", evidence: "A handler cannot deny when the host never executes it; no OS sandbox claim" },
]);

/** @param {string} reason */
export function denyTool(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}
/** @param {unknown} value @returns {value is Record<string,any>} */
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {string} message @returns {never} */
function invalid(message) { throw new Error(message); }

/** Deliberately smaller than shell syntax. Quoting permits spaces, never expansion.
 * @param {unknown} command @returns {string[] | null} */
export function tokenizeExactCommand(command) {
  if (typeof command !== "string" || !command || command.length > 1024 * 1024 || /[\u0000-\u001f\u007f]/u.test(command)) return null;
  /** @type {string[]} */ const words = [];
  let word = "", quote = "", started = false;
  for (const char of command) {
    if (quote) { if (char === quote) quote = ""; else { if (quote === '"' && /[$`\\]/u.test(char)) return null; word += char; } started = true; }
    else if (char === "'" || char === '"') { quote = char; started = true; }
    else if (char === " ") { if (started) { words.push(word); word = ""; started = false; } }
    else { if (/[;$`|&<>\\(){}*?~#]/u.test(char)) return null; word += char; started = true; }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words.length ? words : null;
}

/** Only this exact runtime CLI, not a prefix or an arbitrary package command.
 * @param {unknown} command @param {{home:string}} options */
export async function isGovernanceControlCommand(command, { home }) {
  const words = tokenizeExactCommand(command);
  if (!words || words.length < 3 || !(words[0] === "node" || words[0] === process.execPath)) return false;
  const cliPath = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  if (!isAbsolute(words[1]) || resolve(words[1]) !== cliPath) return false;
  try {
    if ((await lstat(words[1])).isSymbolicLink()) return false;
    if (await realpath(words[1]) !== await realpath(cliPath)) return false;
    const parsed = parseGovernanceArguments(words.slice(2));
    if (!GOVERNANCE_COMMANDS.includes(parsed.command)) return false;
    if (resolve(parsed.options["--home"] ?? homedir()) !== resolve(home)) return false;
    return true;
  } catch { return false; }
}

/** Read only session/turn metadata; never retain transcript/user messages.
 * @param {Record<string,any>} event */
export async function observeHostIdentity(event) {
  if (typeof event.session_id !== "string" || typeof event.transcript_path !== "string" || !isAbsolute(event.transcript_path)
    || typeof event.cwd !== "string" || !isAbsolute(event.cwd) || typeof event.model !== "string") return null;
  let file;
  try {
    file = await open(event.transcript_path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024) return null;
    const stream = file.createReadStream({ autoClose: false });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let sessionSeen = false, child = false;
    /** @type {Record<string,any>|null} */ let turn = null;
    try {
      for await (const line of lines) {
        if (line.length > 2 * 1024 * 1024) continue;
        if (!/"type"\s*:\s*"(?:session_meta|turn_context)"/u.test(line)) continue;
        let record; try { record = JSON.parse(line); } catch { continue; }
        if (!object(record.payload)) continue;
        const metadata = record.payload;
        if (record.type === "session_meta" && metadata.id === event.session_id) {
          sessionSeen = true;
          child = object(metadata.source) || Boolean(metadata.forked_from_id);
        }
        if (record.type === "turn_context" && metadata.turn_id === event.turn_id && metadata.model === event.model) turn = metadata;
      }
    } finally { lines.close(); stream.destroy(); }
    if (!sessionSeen || child || !turn || await realpath(turn.cwd) !== await realpath(event.cwd)) return null;
    const effort = typeof turn.effort === "string" ? turn.effort : turn.collaboration_mode?.settings?.reasoning_effort;
    return { kind: "session", sessionId: event.session_id, cwd: await realpath(event.cwd), model: event.model,
      transcriptPath: await realpath(event.transcript_path), reasoning: typeof effort === "string" ? effort : null };
  } catch { return null; }
  finally { await file?.close(); }
}

/** Every header is parsed, including both sides of a move.
 * @param {unknown} input @returns {string[]} */
export function patchPaths(input) {
  const patch = typeof input === "string" ? input : object(input) && typeof input.patch === "string" ? input.patch
    : object(input) && typeof input.input === "string" ? input.input : null;
  if (!patch || patch.length > 1024 * 1024 || !patch.startsWith("*** Begin Patch\n") || !patch.trimEnd().endsWith("*** End Patch")) invalid("Unsupported patch envelope.");
  const paths = [];
  let current = "";
  for (const line of patch.split("\n").slice(1, -1)) {
    const match = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/u.exec(line);
    if (match) {
      if (match[1] === "Move to" && current !== "Update File") invalid("Move must follow Update File.");
      if (match[1] !== "Move to") current = match[1];
      paths.push(match[2]);
    } else if (line.startsWith("*** ") && line !== "*** End of File" && line !== "*** End Patch") invalid("Unknown patch operation.");
  }
  if (!paths.length) invalid("Patch has no declared file paths.");
  return [...new Set(paths)];
}

/** @param {string} root @param {string} path @param {string} home */
export async function validateWritablePath(root, path, home) {
  if (!path || path.includes("\\") || /[\u0000-\u001f]/u.test(path)) invalid("Invalid patch path.");
  const canonicalRoot = await realpath(root);
  const absolute = resolve(canonicalRoot, path);
  const rel = relative(canonicalRoot, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) invalid("Patch path escapes the canonical root.");
  const segments = rel.split(sep);
  if (segments.some((part) => [".git", ".development-system", ".codex", ".agents"].includes(part))
    || rel === "runtime/jev-governance" || rel.startsWith("runtime/jev-governance/")) invalid("Managed runtime, policy and receipt paths are protected.");
  const managedRoot = resolve(home, ".development-system");
  if (absolute === managedRoot || absolute.startsWith(`${managedRoot}${sep}`)) invalid("Managed receipts are protected.");
  let ancestor = canonicalRoot;
  for (const segment of segments) {
    ancestor = resolve(ancestor, segment);
    try { if ((await lstat(ancestor)).isSymbolicLink()) invalid("Symlink write paths are unsupported."); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error; }
  }
  return rel.split(sep).join("/");
}

/** Find only issued permits for the actual actor and exact raw tool input.
 * @param {any} run @param {Record<string,any>} event */
function matchingProposal(run, event) {
  // The core repeats hash/ownership checks atomically; this adapter adds tool-specific constraints.
  const permits = Array.isArray(run.permits) ? run.permits : Object.values(run.permits ?? {});
  const permit = permits.find((/** @type {any} */ p) => p.actorId === event.session_id && p.toolName === event.tool_name
    && (!p.status || ["prepared", "issued", "pending"].includes(p.status))
    && stableHash(p.toolInput) === stableHash(event.tool_input));
  if (!permit) return null;
  return (run.boundaries ?? []).find((/** @type {any} */ boundary) => boundary.id === permit.boundaryId) ?? null;
}

/** @param {string} path @param {string[]} set */
function covered(path, set) { return set.some((scope) => path === scope || path.startsWith(`${scope}/`)); }

/** Supported shell commands are exact argv; scripts and executable/config files
 * must appear in the packet's hashed read/source set. This is not OS confinement.
 * @param {Record<string,any>} event @param {any} run @param {any} proposal @param {string} home */
async function validateTool(event, run, proposal, home) {
  const root = run.contract?.root ?? run.root;
  if (typeof root !== "string" || await realpath(event.cwd) !== await realpath(root)) invalid("Tool cwd does not match the run root.");
  if (!proposal) invalid("No exact prepared tool proposal is available.");
  const writeSet = proposal.writeSet;
  if (!Array.isArray(writeSet)) invalid("Prepared write scope is unavailable.");
  if (["apply_patch", "ApplyPatch"].includes(event.tool_name)) {
    for (const path of patchPaths(event.tool_input)) if (!covered(await validateWritablePath(root, path, home), writeSet)) invalid("Patch path is outside the prepared write scope.");
    return;
  }
  if (event.tool_name !== "Bash") invalid("This tool has no proven governance adapter; code-mode, hosted tools and child writes are unsupported.");
  if (!object(event.tool_input) || event.tool_input.tty === true || event.tool_input.run_in_background === true) invalid("Interactive or detached execution is unsupported.");
  const argv = tokenizeExactCommand(event.tool_input.command);
  if (!argv || !argv.length) invalid("Only exact argv commands without shell composition are supported.");
  if (argv[0].includes("=")) invalid("Environment assignment wrappers are unsupported.");
  const cliPath = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  if (["node", process.execPath].includes(argv[0]) && argv[1] === cliPath && argv[2] === "execute") {
    const parsed = parseGovernanceArguments(argv.slice(2));
    if (resolve(parsed.options["--home"] ?? homedir()) !== resolve(home)) invalid("Execution HOME does not match the registered run.");
    if (parsed.options["--input"] && !covered(relative(root, resolve(root, parsed.options["--input"])).split(sep).join("/"), proposal.readSet ?? [])) invalid("Launch descriptor must be a hashed packet input.");
    return; // Ordinary permit consumption still follows; execute is never control-exempt.
  }
  const executable = basename(argv[0]);
  if (["sh", "bash", "zsh", "fish", "env", "sudo", "xargs", "eval", "exec", "opencode", "codex", "claude", "droid", "npx", "pnpx", "bunx"].includes(executable)) invalid("Shell wrappers and raw model/provider launch are unsupported.");
  if (argv.some((arg) => ["-e", "--eval", "-c", "--command", "-p", "--print", "--input-type"].includes(arg))
    && ["node", "python", "python3", "ruby", "perl", "deno", "bun"].includes(executable)) invalid("Inline interpreter code is unsupported.");
  if (["node", "python", "python3", "ruby", "perl", "deno", "bun"].includes(executable)
    && argv.some((arg) => /^--(?:eval|print|input-type|require|import|loader|experimental-loader|inspect)(?:=|$)/u.test(arg))) invalid("Interpreter injection flags are unsupported.");
  const bound = [...(proposal.readSet ?? []), ...(run.sources ?? []).filter((/** @type {any} */ source) => proposal.sourceIds?.includes(source.id)).map((/** @type {any} */ source) => source.path)];
  const pathArgs = argv.filter((arg, index) => index === 0 ? arg.includes("/") : !arg.startsWith("-") && (arg.includes("/") || /\.(?:mjs|cjs|js|ts|py|sh|json|toml|ya?ml)$/u.test(arg)));
  for (const path of pathArgs) {
    const absolute = resolve(root, path), rel = relative(root, absolute).split(sep).join("/");
    if (!rel || rel.startsWith("../") || isAbsolute(rel) || !covered(rel, bound)) invalid("Executable, script or config path is not bound to this packet's sources.");
    if ((await lstat(absolute)).isSymbolicLink()) invalid("Referenced executable/script/config symlinks are unsupported.");
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(executable) && !covered("package.json", bound)) invalid("Package execution requires a bound package.json and script/config read set.");
}

/** Bounded continuation persisted across launcher processes. A blocked run is
 * never accepted, and active leases remain core-owned.
 * @param {string} runDirectory @param {any} run */
async function stopResponse(runDirectory, run) {
  if (run.phase === "closed" || ["accepted", "blocked", "interrupted"].includes(run.outcome?.status)) return {};
  const lockPath = resolve(runDirectory, ".adapter-stop.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
    const path = resolve(runDirectory, ".adapter-stop.json");
    /** @type {any} */ let previous = null;
    try { previous = JSON.parse(await readFile(path, "utf8")); } catch {}
    const semanticState = stableHash({ phase: run.phase, outcome: run.outcome, attempts: run.attempts.map((/** @type {any} */ attempt) => ({ id: attempt.id, status: attempt.status, outputHash: attempt.outputHash, invocationObserved: attempt.invocationObserved })), judgments: [...new Set(run.judgments.map((/** @type {any} */ judgment) => judgment.id))], plans: run.plans.map((/** @type {any} */ plan) => plan.id), reviews: run.reviews.map((/** @type {any} */ review) => review.id), evidence: run.evidence.map((/** @type {any} */ evidence) => evidence.id) });
    const count = previous?.semanticState === semanticState ? previous.count + 1 : 1;
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ semanticState, count })}\n`, { mode: 0o600 });
    await rename(temporary, path);
    if (count > 3) {
      await closeRun({ runDirectory, outcome: { status: "blocked", reason: "Host stopped repeatedly without governance progress; recovery remains required.", boundaryId: "host-stop" } });
      return {};
    }
    return { decision: "block", reason: "The governed run is incomplete. Continue from governance status, resolve the next boundary, or record a blocked/interrupted outcome." };
  } catch { return { decision: "block", reason: "Governance continuation state is unavailable; recovery is required." }; }
  finally { if (lock) { await lock.close(); await unlink(lockPath).catch(() => {}); } }
}

/** Adapter-only actual hook ingress. Caller JSON never goes through the CLI.
 * @param {unknown} input @param {{home?:string}} [options] */
export async function handleHook(input, { home = homedir() } = {}) {
  const event = object(input) ? input : null;
  if (!event || typeof event.hook_event_name !== "string" || typeof event.session_id !== "string") return denyTool("Malformed governance host event.");
  try {
    const runDirectory = await resolveRunDirectory(home, event.session_id);
    if (event.hook_event_name === "Interrupt") {
      if (runDirectory) await recordHostEvent({ home, event: { kind: "interruption", sessionId: event.session_id, reason: "Host observed an explicit interruption." } });
      return {};
    }
    if (["PreToolUse", "SessionStart"].includes(event.hook_event_name)) {
      const observation = await observeHostIdentity(event);
      if (observation) await registerHostSession({ home, event: observation });
      else if (runDirectory && event.hook_event_name === "PreToolUse") return denyTool("The current root model, turn and transcript identity could not be established.");
    }
    if (event.hook_event_name === "PreToolUse" && event.tool_name === "Bash"
      && await isGovernanceControlCommand(event.tool_input?.command, { home })) return {};
    if (!runDirectory) return {};
    const run = await getRun({ runDirectory });
    if (event.hook_event_name === "Stop") return await stopResponse(runDirectory, run);
    if (event.hook_event_name === "PreToolUse") {
      await validateTool(event, run, matchingProposal(run, event), home);
      const authorization = await authorizeAction({ home, preToolEvent: event });
      return authorization.decision === "allow" ? {} : denyTool(authorization.reason);
    }
    if (["PostToolUse", "SubagentStart", "SubagentStop"].includes(event.hook_event_name)) {
      if (event.tool_name === "Bash" && await isGovernanceControlCommand(event.tool_input?.command, { home })) return {};
      const response = event.tool_response;
      await recordHostEvent({ home, event: { kind: "hook", sessionId: event.session_id, hookEventName: event.hook_event_name,
        turnId: event.turn_id, toolUseId: event.tool_use_id, toolName: event.tool_name, toolInput: event.tool_input,
        output: response, cwd: event.cwd, model: event.model,
        ...(Number.isInteger(response?.exit_code) ? { exitCode: response.exit_code } : {}) } });
    }
    return {};
  } catch {
    if (event.hook_event_name === "PreToolUse") return denyTool("Governance validation failed; no tool authorization was granted.");
    if (event.hook_event_name === "Stop") return { decision: "block", reason: "Governance recovery is required before completing this run." };
    return {};
  }
}
