#!/usr/bin/env node
// @ts-check
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, classifyBoundary, prepareAction, advancePhase, closeRun, getRun, resolveRunDirectory } from "./core.mjs";
import { readSessionObservation } from "./store.mjs";
import { launchGovernedProcess } from "./executor.mjs";

export const GOVERNANCE_COMMANDS = Object.freeze(["begin", "classify", "prepare", "status", "advance", "close"]);
export const EXECUTION_COMMAND = "execute";
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;
export class GovernanceInputError extends Error {}
/** @param {string} message @returns {never} */
function invalid(message) { throw new GovernanceInputError(message); }

/** Closed grammar, shared with the hook's narrow control-plane exemption.
 * @param {string[]} argv */
export function parseGovernanceArguments(argv) {
  const [command, ...tokens] = argv;
  if (![...GOVERNANCE_COMMANDS, EXECUTION_COMMAND].includes(command)) invalid("Expected begin, classify, prepare, status, advance, close or execute.");
  /** @type {Record<string,string>} */
  const options = {};
  let json = false;
  const allowed = new Set(["--home", "--run", ...(command === "status" ? [] : ["--input", "--input-json"]), ...(command === "prepare" ? ["--boundary"] : [])]);
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
  if (command !== "status" && Boolean(options["--input"]) === Boolean(options["--input-json"])) invalid("Exactly one of --input or --input-json is required.");
  if (options["--input-json"] && Buffer.byteLength(options["--input-json"]) > 1024 * 1024) invalid("Inline input exceeds 1 MiB.");
  if (command === "prepare" && !options["--boundary"]) invalid("--boundary is required.");
  return { command, options, json };
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
    invalid("Input is unavailable or is not a valid regular JSON file.");
  } finally { await file?.close(); }
}

/** Environment selects an observed host record; it never supplies identity proof.
 * @param {string[]} argv */
export async function runGovernance(argv) {
  try {
    const { command, options, json } = parseGovernanceArguments(argv);
    const home = resolve(options["--home"] ?? homedir());
    const sessionId = process.env.CODEX_THREAD_ID;
    /** @type {any} */ let result;
    if (command === "status") {
      const runDirectory = options["--run"] ? resolve(home, ".development-system/governance/runs", options["--run"])
        : sessionId && safeId.test(sessionId) ? await resolveRunDirectory(home, sessionId) : null;
      result = runDirectory ? await getRun({ runDirectory }) : { active: false, mode: "host-bound-governance" };
    } else {
      if (!sessionId || !safeId.test(sessionId)) invalid("An observed Codex session is required.");
      const observation = await readSessionObservation(home, sessionId);
      if (!observation) invalid("No trusted host observation exists for this session.");
      const activation = { sessionId: observation.sessionId, model: observation.model, reasoning: observation.reasoning, transcriptPath: observation.transcriptPath };
      const input = options["--input"] ? await readInput(options["--input"]) : JSON.parse(options["--input-json"]);
      if (command === "begin") {
        if (options["--run"] && options["--run"] !== input.id) invalid("--run must match the contract id.");
        result = await createRun({ home, contract: input, activation });
      } else {
        const runDirectory = await resolveRunDirectory(home, sessionId);
        if (!runDirectory) invalid("The observed session has no registered run.");
        if (options["--run"] && resolve(runDirectory) !== resolve(home, ".development-system/governance/runs", options["--run"])) invalid("The run is not bound to this session.");
        if (command === "classify") result = await classifyBoundary({ runDirectory, proposal: input });
        else if (command === "prepare") result = await prepareAction({ runDirectory, boundaryId: options["--boundary"], action: input });
        else if (command === "advance") result = await advancePhase({ runDirectory, transition: input });
        else if (command === "close") result = await closeRun({ runDirectory, outcome: input });
        else result = await launchGovernedProcess({ home, runDirectory, sessionId, launch: input, inputPath: options["--input"] });
      }
    }
    if (["begin", "advance", "close", "status"].includes(command) && result?.runId) {
      result = { runId: result.runId, root: result.root, rootSessionId: result.rootSessionId, coordinator: result.coordinator,
        endpoint: result.endpoint, phase: result.phase, outcome: result.outcome, revision: result.revision, capacity: result.capacity,
        criteria: result.criteria, tickets: result.tickets, leases: result.leases,
        attempts: result.attempts.slice(-20).map((/** @type {any} */ attempt) => ({ id: attempt.id, role: attempt.role, actorId: attempt.actorId, status: attempt.status, acceptanceId: attempt.acceptanceId ?? null, failure: attempt.failure ?? null })),
        boundaries: result.boundaries.filter((/** @type {any} */ boundary) => boundary.phase === result.phase).slice(-20).map((/** @type {any} */ boundary) => ({ id: boundary.id, action: boundary.action, verdict: boundary.verdict, judgmentId: boundary.judgmentId })),
        plans: result.plans.map((/** @type {any} */ plan) => ({ id: plan.id, actorId: plan.actorId, summary: plan.summary, criterionIds: plan.criterionIds, invalidated: plan.invalidated === true })),
        reviews: result.reviews.map((/** @type {any} */ review) => ({ id: review.id, kind: review.kind, verdict: review.verdict, invalidated: review.invalidated === true })),
        evidence: result.evidence.map((/** @type {any} */ evidence) => ({ id: evidence.id, criterionId: evidence.criterionId, outcome: evidence.outcome, invalidated: evidence.invalidated === true })),
        unresolvedFindings: result.findings.filter((/** @type {any} */ finding) => !finding.resolved) };
    }
    const receipt = { ok: true, operation: command, ...result };
    const code = command === "execute" && receipt.ok !== true ? 1 : 0;
    return { code, result: receipt, json, output: json ? JSON.stringify(receipt) : `Governance ${command} ${code ? "requires recovery" : "completed"}.` };
  } catch (error) {
    if (error instanceof GovernanceInputError) throw error;
    // Provider exceptions and arbitrary input may contain credentials: never echo them.
    throw new GovernanceInputError("Governance operation rejected; inspect the local run status for unresolved requirements.");
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
