#!/usr/bin/env node
// @ts-check
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, classifyBoundary, prepareAction, advancePhase, closeRun, getRun, resolveRunDirectory, preflightRun, recoverUnstartedRun, recoverHostAttempt, safeAttemptDiagnostic } from "./core.mjs";
import { readSessionObservation } from "./store.mjs";
import { launchGovernedProcess } from "./executor.mjs";
import { GovernanceError, safeGovernanceError } from "./errors.mjs";
import { REFERENCE_COMMANDS, commandReference, formatReference } from "./command-reference.mjs";

export const GOVERNANCE_COMMANDS = Object.freeze(["begin", "preflight", "classify", "prepare", "status", "advance", "close", "recover", "recover-host-attempt", ...REFERENCE_COMMANDS]);
export const EXECUTION_COMMAND = "execute";
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;
export class GovernanceInputError extends GovernanceError {
  /** @param {string} message @param {string} [code] @param {string} [field] */
  constructor(message, code = "invalid_argument", field) { super(message, code, { field }); }
}
/** @param {string} message @param {string} [code] @param {string} [field] @returns {never} */
function invalid(message, code, field) { throw new GovernanceInputError(message, code, field); }

/** Closed grammar, shared with the hook's narrow control-plane exemption.
 * @param {string[]} argv */
export function parseGovernanceArguments(argv) {
  const [first, ...remaining] = argv;
  const command = !first || ["--help", "-h"].includes(first) ? "help" : first;
  const tokens = [...remaining];
  if (![...GOVERNANCE_COMMANDS, EXECUTION_COMMAND].includes(command)) invalid("Unknown governance command.", "invalid_argument", "command");
  const reference = REFERENCE_COMMANDS.includes(command);
  const topic = reference && tokens[0] && !tokens[0].startsWith("--") ? tokens.shift() : undefined;
  if (topic && !commandReference(topic)) invalid("Unknown reference topic.", "invalid_argument", "command");
  /** @type {Record<string,string>} */
  const options = {};
  let json = false;
  const allowed = new Set(["--home", ...(!reference ? ["--run"] : []), ...(command === "status" || reference ? [] : ["--input", "--input-json"]), ...(command === "prepare" ? ["--boundary"] : [])]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { if (json) invalid("Duplicate option."); json = true; continue; }
    if (!allowed.has(token) || Object.hasOwn(options, token)) invalid("Unknown or duplicate governance option.");
    const value = tokens[++index];
    if (!value || value.startsWith("--") || /[\u0000-\u001f\u007f]/u.test(value)) invalid("Invalid governance option value.");
    options[token] = value;
  }
  if (options["--home"] && !isAbsolute(options["--home"])) invalid("--home must be absolute.");
  for (const key of ["--run", "--boundary"]) if (options[key] && !safeId.test(options[key])) invalid("Run and boundary identifiers must be safe names.");
  if (command !== "status" && !reference && Boolean(options["--input"]) === Boolean(options["--input-json"])) invalid("Exactly one of --input or --input-json is required.", "invalid_argument", "input");
  if (options["--input-json"] && Buffer.byteLength(options["--input-json"]) > 1024 * 1024) invalid("Inline input exceeds 1 MiB.");
  if (command === "prepare" && !options["--boundary"]) invalid("--boundary is required.");
  if (["recover", "recover-host-attempt"].includes(command) && !options["--run"]) invalid("Recovery requires an explicit run.", "invalid_argument", "run");
  return { command, options, json, topic };
}

/** @param {string} path @returns {Promise<any>} Dynamic JSON is validated by core schemas. */
async function readInput(path) {
  let file;
  try {
    file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) invalid("Input must be a regular JSON file below 1 MiB.");
    const bytes = await file.readFile();
    if (bytes.length > 1024 * 1024) invalid("Input exceeds 1 MiB.");
    const result = JSON.parse(bytes.toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) invalid("Input must be a JSON object.");
    return result;
  } catch (error) {
    if (error instanceof GovernanceInputError) throw error;
    invalid("Input is unavailable or is not a valid regular JSON file.", "invalid_json", "input");
  } finally { await file?.close(); }
}

/** Environment selects an observed host record; it never supplies identity proof.
 * @param {string[]} argv */
export async function runGovernance(argv) {
  let operation = "error";
  let jsonOutput = argv.includes("--json");
  try {
    const { command, options, json, topic } = parseGovernanceArguments(argv);
    operation = command;
    jsonOutput = json;
    if (REFERENCE_COMMANDS.includes(command)) {
      const reference = commandReference(topic);
      const result = { ok: true, operation: command, ...reference };
      return { code: 0, result, json, output: json ? JSON.stringify(result) : formatReference(reference) };
    }
    const home = resolve(options["--home"] ?? homedir());
    const sessionId = process.env.CODEX_THREAD_ID;
    /** @type {any} */ let result;
    if (command === "status") {
      const runDirectory = options["--run"] ? resolve(home, ".development-system/governance/runs", options["--run"])
        : sessionId && safeId.test(sessionId) ? await resolveRunDirectory(home, sessionId) : null;
      result = runDirectory ? await getRun({ runDirectory }) : { active: false, mode: "host-bound-governance" };
    } else {
      if (!sessionId || !safeId.test(sessionId)) invalid("An observed Codex session is required.", "session_missing", "sessionId");
      const observation = await readSessionObservation(home, sessionId);
      if (!observation) invalid("No trusted host observation exists for this session.", "session_missing", "sessionId");
      const activation = { sessionId: observation.sessionId, model: observation.model, reasoning: observation.reasoning, transcriptPath: observation.transcriptPath };
      let input;
      try { input = options["--input"] ? await readInput(options["--input"]) : JSON.parse(options["--input-json"]); }
      catch (error) { if (error instanceof GovernanceInputError) throw error; invalid("Invalid JSON input.", "invalid_json", "input"); }
      if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Input must be a JSON object.", "invalid_json", "input");
      if (command === "recover") {
        if (Object.keys(input).some((key) => key !== "reason") || typeof input.reason !== "string" || !input.reason.trim()) invalid("Recovery requires only a reason.", "invalid", "recovery.reason");
        result = await recoverUnstartedRun({ home, runId: options["--run"], sessionId, reason: input.reason });
      } else if (command === "recover-host-attempt") {
        if (Object.keys(input).some((key) => !["attemptId", "reason"].includes(key))) invalid("Host recovery accepts only attemptId and reason.", "invalid", "input");
        if (typeof input.attemptId !== "string" || !safeId.test(input.attemptId)) invalid("Host recovery requires a safe attempt identifier.", "invalid", "recovery.attemptId");
        if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2048) invalid("Host recovery requires a bounded reason.", "invalid", "recovery.reason");
        result = await recoverHostAttempt({ home, runId: options["--run"], sessionId, attemptId: input.attemptId, reason: input.reason });
      } else if (command === "begin" || command === "preflight") {
        if (options["--run"] && options["--run"] !== input.id) invalid("--run must match the contract id.");
        result = command === "begin" ? await createRun({ home, contract: input, activation }) : await preflightRun({ home, contract: input, activation });
      } else {
        const runDirectory = await resolveRunDirectory(home, sessionId);
        if (!runDirectory) invalid("The observed session has no registered run.", "run_missing", "run");
        if (options["--run"] && resolve(runDirectory) !== resolve(home, ".development-system/governance/runs", options["--run"])) invalid("The run is not bound to this session.", "binding", "run");
        if (command === "classify") result = await classifyBoundary({ runDirectory, proposal: input });
        else if (command === "prepare") result = await prepareAction({ runDirectory, boundaryId: options["--boundary"], action: input });
        else if (command === "advance") result = await advancePhase({ runDirectory, transition: input });
        else if (command === "close") result = await closeRun({ runDirectory, outcome: input });
        else result = await launchGovernedProcess({ home, runDirectory, sessionId, launch: input, inputPath: options["--input"] });
      }
    }
    if (["begin", "advance", "close", "status", "recover", "recover-host-attempt"].includes(command) && result?.runId) {
      result = { runId: result.runId, root: result.root, hostRoot: result.hostRoot ?? result.root, rootSessionId: result.rootSessionId, coordinator: result.coordinator,
        endpoint: result.endpoint, phase: result.phase, outcome: result.outcome, revision: result.revision, capacity: result.capacity,
        criteria: result.criteria, tickets: result.tickets, leases: result.leases,
        attempts: result.attempts.slice(-20).map((/** @type {any} */ attempt) => ({ id: attempt.id, role: attempt.role, actorId: attempt.actorId, status: attempt.status, acceptanceId: attempt.acceptanceId ?? null, ...(attempt.recoveryReceiptId ? { recoveryReceiptId: attempt.recoveryReceiptId } : {}), failure: safeAttemptDiagnostic(attempt)?.message ?? null, failureDiagnostic: safeAttemptDiagnostic(attempt),
          ...(attempt.process ? { process: { sessionId: attempt.sessionId ?? null, provider: attempt.observed?.provider ?? "unknown", model: attempt.observed?.model ?? "unknown", reasoning: attempt.observed?.reasoning ?? null, exitCode: attempt.process.exitCode, exitSignal: attempt.process.exitSignal ?? null, reconciliationFailed: attempt.process.reconciliationFailed === true, terminated: attempt.process.terminated } } : {}) })),
        boundaries: result.boundaries.filter((/** @type {any} */ boundary) => boundary.phase === result.phase).slice(-20).map((/** @type {any} */ boundary) => ({ id: boundary.id, action: boundary.action, verdict: boundary.verdict, judgmentId: boundary.judgmentId })),
        plans: result.plans.map((/** @type {any} */ plan) => ({ id: plan.id, actorId: plan.actorId, summary: plan.summary, criterionIds: plan.criterionIds, invalidated: plan.invalidated === true })),
        reviews: result.reviews.map((/** @type {any} */ review) => ({ id: review.id, kind: review.kind, verdict: review.verdict, invalidated: review.invalidated === true })),
        evidence: result.evidence.map((/** @type {any} */ evidence) => ({ id: evidence.id, criterionId: evidence.criterionId, outcome: evidence.outcome, invalidated: evidence.invalidated === true })),
        observations: (result.observations ?? []).map((/** @type {any} */ observation) => ({ id: observation.id, criterionIds: observation.criterionIds, candidateHash: observation.candidateHash, manifestHash: observation.manifestHash, result: observation.result, source: observation.source,
          artifacts: (observation.artifacts ?? []).map((/** @type {any} */ artifact) => ({ type: artifact.type, mimeType: artifact.mimeType, ...(artifact.declaredMimeType ? { declaredMimeType: artifact.declaredMimeType } : {}), sha256: artifact.sha256, size: artifact.size })) })),
        recoveryReceipts: (result.recoveryReceipts ?? []).map((/** @type {any} */ receipt) => ({ id: receipt.id, originalSessionId: receipt.originalSessionId, operatorSessionId: receipt.operatorSessionId, ...(receipt.attemptId ? { attemptId: receipt.attemptId, boundaryId: receipt.boundaryId, permitId: receipt.permitId, previousStatus: receipt.previousStatus, status: receipt.status } : {}), at: receipt.at })),
        unresolvedFindings: result.findings.filter((/** @type {any} */ finding) => !finding.resolved) };
    }
    const receipt = { ok: true, operation: command, ...result };
    const code = command === "execute" && receipt.ok !== true || command === "preflight" && result.ready !== true ? 1 : 0;
    return { code, result: receipt, json, output: json ? JSON.stringify(receipt) : `Governance ${command} ${code ? "requires recovery" : "completed"}.` };
  } catch (error) {
    const result = safeGovernanceError(error, { operation });
    return { code: 1, result, json: jsonOutput, output: jsonOutput ? JSON.stringify(result)
      : `${result.error.code}${result.error.field ? ` (${result.error.field})` : ""}: ${result.error.message}\n${result.error.nextAction}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const receipt = await runGovernance(process.argv.slice(2)); process.stdout.write(`${receipt.output}\n`); process.exitCode = receipt.code; }
  catch (error) {
    const message = error instanceof GovernanceInputError ? error.message : "Governance operation failed.";
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ ok: false, operation: "error", error: message })}\n`);
    else process.stderr.write(`Development System governance error: ${message}\n`);
    process.exitCode = 1;
  }
}
