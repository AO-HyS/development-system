// @ts-check
import { constants } from "node:fs";
import { lstat, open, realpath, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { authorizeAction, closeRun, getRun, recordHostEvent, registerHostSession, recordPassiveToolObservation, resolveRunDirectory, stableHash } from "./core.mjs";
import { GOVERNANCE_COMMANDS, parseGovernanceArguments } from "./cli.mjs";
import { GovernanceError, safeGovernanceError } from "./errors.mjs";
import { classifyToolResult, describeToolInvocation, getAdapterCatalog, patchPaths, tokenizeExactCommand } from "./adapters.mjs";
import { assertRunRoots, hostRootFor, withLock } from "./store.mjs";

export { patchPaths, tokenizeExactCommand };

export const adapterCapabilities = Object.freeze([
  ...getAdapterCatalog().map((adapter) => Object.freeze({ surface: adapter.capability, status: "requires-current-host-observation", evidence: adapter.summary })),
  Object.freeze({ surface: "native child writable actions", status: "unsupported", evidence: "No proven child session/model/effort binding" }),
  Object.freeze({ surface: "host-killed or missing hook", status: "host-limit", evidence: "A handler cannot deny when the host never executes it; no OS sandbox claim" }),
]);

/** @param {string} reason */
export function denyTool(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}
/** @param {unknown} value @returns {value is Record<string,any>} */
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {string} message @param {string} [code] @returns {never} */
function invalid(message, code = "invalid_tool_input") { throw new GovernanceError(message, code); }

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

/** @param {string} root @param {string} path @param {string} home */
export async function validateWritablePath(root, path, home) {
  if (!path || path.includes("\\") || /[\u0000-\u001f]/u.test(path)) invalid("Invalid patch path.", "tool");
  if (isAbsolute(path) ? resolve(path) !== path : path.split("/").some((part) => !part || part === "." || part === "..")) invalid("Patch paths must be canonical before resolution.", "scope");
  const canonicalRoot = await realpath(root);
  const absolute = resolve(canonicalRoot, path);
  const rel = relative(canonicalRoot, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) invalid("Patch path escapes the canonical root.", "scope");
  const segments = rel.split(sep);
  if (segments.some((part) => [".git", ".development-system", ".codex", ".agents"].includes(part))
    || rel === "runtime/jev-governance" || rel.startsWith("runtime/jev-governance/")) invalid("Managed runtime, policy and receipt paths are protected.", "scope");
  const managedRoot = resolve(home, ".development-system");
  if (absolute === managedRoot || absolute.startsWith(`${managedRoot}${sep}`)) invalid("Managed receipts are protected.", "scope");
  let ancestor = canonicalRoot;
  for (const segment of segments) {
    ancestor = resolve(ancestor, segment);
    try { if ((await lstat(ancestor)).isSymbolicLink()) invalid("Symlink write paths are unsupported.", "scope"); }
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
 * Known adapter capabilities may consume an exact prepared permit; anything else
 * stays unsupported. Native children remain denied by core attribution.
 * @param {Record<string,any>} event @param {any} run @param {any} proposal @param {string} home
 * @param {any} descriptor */
async function validateTool(event, run, proposal, home, descriptor) {
  const root = run.root, hostRoot = hostRootFor(run);
  await assertRunRoots(run);
  if (typeof root !== "string" || await realpath(event.cwd) !== hostRoot) invalid("Tool cwd does not match the observed host root.", "binding");
  if (!proposal) invalid("No exact prepared tool proposal is available.", "tool");
  const writeSet = proposal.writeSet;
  if (!Array.isArray(writeSet)) invalid("Prepared write scope is unavailable.", "scope");
  if (!descriptor || descriptor.observationLevel !== "host-invocation") invalid("This tool has no proven governance adapter; code-mode, hosted tools and child writes are unsupported.", "unsupported_tool");
  if (descriptor.capability === "patch") {
    const patch = descriptor.semanticInput?.patch;
    for (const path of patchPaths(patch)) {
      if (hostRoot !== root && !isAbsolute(path)) invalid("Split-root patches require absolute integration paths.", "scope");
      if (!covered(await validateWritablePath(root, path, home), writeSet)) invalid("Patch path is outside the prepared write scope.", "scope");
    }
    return;
  }
  if (["linear-read", "linear-write", "computer-use"].includes(descriptor.capability)) {
    if (writeSet.length) invalid("Read and opaque capabilities cannot carry a writable scope.", "scope");
    return;
  }
  if (descriptor.capability !== "shell") invalid("This tool has no proven governance adapter; code-mode, hosted tools and child writes are unsupported.", "unsupported_tool");
  const command = descriptor.semanticInput?.command ?? descriptor.semanticInput?.cmd;
  const effectiveRoot = descriptor.semanticInput?.cwd ?? descriptor.semanticInput?.workdir ?? hostRoot;
  if (effectiveRoot !== (proposal.action === "inspect" ? root : hostRoot)) invalid("Shell workdir differs from its declared host or integration role.", "binding");
  const argv = tokenizeExactCommand(command);
  if (!argv || !argv.length) invalid("Only exact argv commands without shell composition are supported.", "tool");
  if (argv[0].includes("=")) invalid("Environment assignment wrappers are unsupported.", "tool");
  const cliPath = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  if (["node", process.execPath].includes(argv[0]) && argv[1] === cliPath && argv[2] === "execute") {
    const parsed = parseGovernanceArguments(argv.slice(2));
    if (resolve(parsed.options["--home"] ?? homedir()) !== resolve(home)) invalid("Execution HOME does not match the registered run.", "binding");
    if (parsed.options["--input"] && !covered(relative(root, resolve(root, parsed.options["--input"])).split(sep).join("/"), proposal.readSet ?? [])) invalid("Launch descriptor must be a hashed packet input.", "scope");
    return; // Ordinary permit consumption still follows; execute is never control-exempt.
  }
  const executable = basename(argv[0]);
  if (["sh", "bash", "zsh", "fish", "env", "sudo", "xargs", "eval", "exec", "opencode", "codex", "claude", "droid", "npx", "pnpx", "bunx"].includes(executable)) invalid("Shell wrappers and raw model/provider launch are unsupported.", "tool");
  if (argv.some((arg) => ["-e", "--eval", "-c", "--command", "-p", "--print", "--input-type"].includes(arg))
    && ["node", "python", "python3", "ruby", "perl", "deno", "bun"].includes(executable)) invalid("Inline interpreter code is unsupported.", "tool");
  if (["node", "python", "python3", "ruby", "perl", "deno", "bun"].includes(executable)
    && argv.some((arg) => /^--(?:eval|print|input-type|require|import|loader|experimental-loader|inspect)(?:=|$)/u.test(arg))) invalid("Interpreter injection flags are unsupported.", "tool");
  const bound = [...(proposal.readSet ?? []), ...(run.sources ?? []).filter((/** @type {any} */ source) => proposal.sourceIds?.includes(source.id)).map((/** @type {any} */ source) => source.path)];
  const pathArgs = argv.filter((arg, index) => index === 0 ? arg.includes("/") : !arg.startsWith("-") && (arg.includes("/") || /\.(?:mjs|cjs|js|ts|py|sh|json|toml|ya?ml)$/u.test(arg)));
  for (const path of pathArgs) {
    const absolute = resolve(root, path), rel = relative(root, absolute).split(sep).join("/");
    if (!rel || rel.startsWith("../") || isAbsolute(rel) || !covered(rel, bound)) invalid("Executable, script or config path is not bound to this packet's sources.", "scope");
    if ((await lstat(absolute)).isSymbolicLink()) invalid("Referenced executable/script/config symlinks are unsupported.", "scope");
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(executable) && !covered("package.json", bound)) invalid("Package execution requires a bound package.json and script/config read set.", "scope");
}

/** Record an unbound Pre/Post pair as passive availability evidence. Unknown
 * operations are never recorded as available.
 * @param {string} home @param {Record<string,any>} event @param {Record<string,any>} observation */
async function recordPassiveObservation(home, event, observation) {
  let descriptor;
  try { descriptor = describeToolInvocation({ toolName: event.tool_name, toolInput: event.tool_input }); }
  catch { return; }
  let classification = null;
  if (event.hook_event_name === "PostToolUse") {
    try { classification = classifyToolResult(descriptor, event.tool_response); }
    catch { classification = { status: "unknown", code: "unclassified" }; }
  }
  await recordPassiveToolObservation({ home, event: {
    kind: "hook", sessionId: event.session_id, hookEventName: event.hook_event_name,
    turnId: event.turn_id ?? null, toolUseId: event.tool_use_id ?? null,
    toolName: event.tool_name, toolInput: event.tool_input, output: event.tool_response ?? null,
    cwd: observation.cwd, model: observation.model, reasoning: observation.reasoning,
    adapterId: descriptor.adapterId, capability: descriptor.capability, effect: descriptor.effect,
    rawToolName: descriptor.rawToolName, toolInputHash: descriptor.toolInputHash, classification,
  } });
}

/** Bounded continuation persisted across launcher processes. A blocked run is
 * never accepted, and active leases remain core-owned.
 * @param {string} runDirectory @param {any} run */
async function stopResponse(runDirectory, run) {
  if (run.phase === "closed" || ["accepted", "blocked", "interrupted"].includes(run.outcome?.status)) return {};
  const lockPath = resolve(runDirectory, ".adapter-stop.lock");
  return withLock(lockPath, async () => {
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
  });
}

/** Adapter-only actual hook ingress. Caller JSON never goes through the CLI.
 * @param {unknown} input @param {{home?:string}} [options] */
export async function handleHook(input, { home = homedir() } = {}) {
  const event = object(input) ? input : null;
  if (!event || typeof event.hook_event_name !== "string" || typeof event.session_id !== "string") return denyTool("Malformed governance host event.");
  try {
    // Exact controls remain reachable even when partial ownership storage must
    // deny ordinary tools. Each mutating CLI operation still enforces its gates.
    if ((event.hook_event_name === "PreToolUse" || event.hook_event_name === "PostToolUse")
      && event.tool_name === "Bash" && await isGovernanceControlCommand(event.tool_input?.command, { home })) return {};
    const runDirectory = await resolveRunDirectory(home, event.session_id, { includeFinished: false });
    if (event.hook_event_name === "Interrupt") {
      if (runDirectory) await recordHostEvent({ home, event: { kind: "interruption", sessionId: event.session_id, reason: "Host observed an explicit interruption." } });
      return {};
    }
    const needsIdentity = ["PreToolUse", "SessionStart", "PostToolUse"].includes(event.hook_event_name);
    /** @type {Record<string,any>|null} */ let observation = null;
    if (needsIdentity) {
      observation = await observeHostIdentity(event);
      if (observation && ["PreToolUse", "SessionStart"].includes(event.hook_event_name)) await registerHostSession({ home, event: observation });
      else if (runDirectory && event.hook_event_name === "PreToolUse") return denyTool("The current root model, turn and transcript identity could not be established.");
    }

    if (!runDirectory) {
      if (observation && ["PreToolUse", "PostToolUse"].includes(event.hook_event_name)) await recordPassiveObservation(home, event, observation);
      return {};
    }
    const run = await getRun({ runDirectory });
    if (event.hook_event_name === "Stop") return await stopResponse(runDirectory, run);
    if (event.hook_event_name === "PreToolUse") {
      // The real host payload omits reasoning and may carry a non-canonical cwd.
      // Attach the observed root identity before the core authorizes the permit.
      const authorizedEvent = observation ? { ...event, cwd: observation.cwd, model: observation.model, reasoning: observation.reasoning } : event;
      const descriptor = describeToolInvocation({ toolName: authorizedEvent.tool_name, toolInput: authorizedEvent.tool_input });
      await validateTool(authorizedEvent, run, matchingProposal(run, authorizedEvent), home, descriptor);
      const authorization = await authorizeAction({ home, preToolEvent: authorizedEvent });
      return authorization.decision === "allow" ? {} : denyTool(authorization.reason);
    }
    if (["PostToolUse", "SubagentStart", "SubagentStop"].includes(event.hook_event_name)) {
      const response = event.tool_response;
      await recordHostEvent({ home, event: { kind: "hook", sessionId: event.session_id, hookEventName: event.hook_event_name,
        turnId: event.turn_id, toolUseId: event.tool_use_id, toolName: event.tool_name, toolInput: event.tool_input,
        output: response, cwd: observation?.cwd ?? event.cwd, model: observation?.model ?? event.model, reasoning: observation?.reasoning ?? null,
        ...(Number.isInteger(response?.exit_code) ? { exitCode: response.exit_code } : {}) } });
    }
    return {};
  } catch (error) {
    // Only the shared fixed registry may reach the host; never echo the exception.
    const safe = safeGovernanceError(error, { operation: "hook" });
    const reason = `${safe.error.message} ${safe.error.nextAction}`;
    if (event.hook_event_name === "PreToolUse") return denyTool(reason);
    if (event.hook_event_name === "Stop") return { decision: "block", reason };
    return {};
  }
}
