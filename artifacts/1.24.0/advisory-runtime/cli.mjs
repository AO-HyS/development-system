#!/usr/bin/env node
// @ts-check

import { constants } from "node:fs";
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAtomWithJev, orchestrationPolicy, recordRouteDecision } from "./src/orchestration.mjs";

class AdvisoryInputError extends Error {}
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;
const sha = /^[a-f0-9]{40}$/u;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} message */
function invalid(message) { throw new AdvisoryInputError(message); }

/** @param {string[]} argv */
function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (!["status", "classify-atom", "record-route-decision"].includes(command)) {
    invalid("Use status, classify-atom or record-route-decision; automatic execution is disabled.");
  }
  /** @type {Record<string, string>} */
  const options = {};
  let json = false;
  const allowed = new Set(["--home", "--credential-file", ...(command === "status" ? [] : ["--atom", "--run-context", "--receipt"]), ...(command === "classify-atom" ? ["--active-atoms"] : []), ...(command === "record-route-decision" ? ["--route-receipt", "--chosen-route", "--rationale"] : [])]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { json = true; continue; }
    if (!allowed.has(token)) invalid("Unknown advisory option; credentials must never be passed as command arguments.");
    if (Object.hasOwn(options, token)) invalid("Duplicate advisory option.");
    const value = tokens[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) invalid("An advisory option is missing its value.");
    options[token] = value;
  }
  return { command, options, json };
}

/** Read a bounded regular file without following a final symlink.
 * @param {string} path @param {string} label @param {number} maxBytes */
async function readBoundedFile(path, label, maxBytes) {
  let file;
  try {
    file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) invalid(`${label} must be a bounded regular file.`);
    const bytes = await file.readFile();
    if (bytes.length > maxBytes) invalid(`${label} exceeds its size limit.`);
    return bytes.toString("utf8");
  } catch (error) {
    if (error instanceof AdvisoryInputError) throw error;
    invalid(`${label} is unavailable or is not a readable regular file.`);
  } finally { await file?.close(); }
}

/** @param {string | undefined} path @param {string} label */
async function readObject(path, label) {
  if (!path) invalid(`${label} is required.`);
  const text = await readBoundedFile(/** @type {string} */ (path), label, 1024 * 1024);
  let value;
  try { value = JSON.parse(/** @type {string} */ (text)); }
  catch { invalid(`${label} must contain valid JSON.`); }
  if (!isRecord(value)) invalid(`${label} must contain a JSON object.`);
  return value;
}

/** @param {unknown} value */
function stringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

/** @param {string[]} paths @param {string} label */
function validatePaths(paths, label) {
  for (const path of paths) {
    if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) invalid(`${label} must be canonical relative paths within the repository.`);
  }
}

/** Optional current active ownership context; absent means no active atoms.
 * @param {string | undefined} path @returns {Promise<Array<{id: string, writeSet: string[]}>>} */
async function readActiveAtoms(path) {
  if (!path) return [];
  const contents = await readBoundedFile(path, "Active atoms file", 32 * 1024);
  let atoms;
  try { atoms = JSON.parse(/** @type {string} */ (contents)); }
  catch { invalid("Active atoms file must contain valid JSON."); }
  if (!Array.isArray(atoms)) invalid("Active atoms file must contain a JSON array.");
  const ids = new Set();
  for (const atom of atoms) {
    if (!isRecord(atom) || typeof atom.id !== "string" || !safeId.test(atom.id) || !stringList(atom.writeSet)
      || Object.keys(atom).some((key) => !["id", "writeSet"].includes(key))) invalid("Each active atom requires only a safe id and a writeSet array.");
    if (ids.has(atom.id)) invalid("Active atom ids must be unique.");
    ids.add(atom.id);
    validatePaths(atom.writeSet, "Active atom writeSet paths");
  }
  return atoms;
}

/** @param {any} atom @param {any} run */
function validateInputs(atom, run) {
  if (typeof atom.id !== "string" || !safeId.test(atom.id) || typeof atom.objective !== "string" || !atom.objective.trim()
    || !stringList(atom.readSet) || !stringList(atom.writeSet) || !stringList(atom.dependsOn)
    || !stringList(atom.acceptanceIds) || !atom.acceptanceIds.length) invalid("Atom requires a safe id, objective, readSet, writeSet, dependsOn and acceptanceIds.");
  validatePaths([...atom.readSet, ...atom.writeSet], "Atom paths");
  if (!atom.dependsOn.every((/** @type {string} */ id) => safeId.test(id))) invalid("Atom dependencies must use safe identifiers.");
  if (typeof run.runId !== "string" || !run.runId.trim() || typeof run.baseSha !== "string" || !sha.test(run.baseSha)) invalid("Run context requires runId and a 40-character baseSha.");
  if (run.verifiedAtomIds !== undefined && !stringList(run.verifiedAtomIds)) invalid("Run context verifiedAtomIds must be a string array.");
}

/** @param {string} value */
function checkedKey(value) {
  const key = value.trim();
  if (!key || /[\s\u0000-\u001f\u007f]/u.test(key)) invalid("TYPESAFE_API_KEY must be one non-empty token.");
  return key;
}

/** No shell parsing, interpolation, environment mutation, or credential subprocesses.
 * @param {Record<string, string>} options */
async function loadApiKey(options) {
  if (process.env.TYPESAFE_API_KEY?.trim()) return checkedKey(process.env.TYPESAFE_API_KEY);
  const explicit = options["--credential-file"] ?? process.env.TYPESAFE_ENV_FILE;
  const path = explicit ?? resolve(options["--home"] ?? homedir(), ".development-system/private/secrets/typesafe.env");
  if (!explicit) {
    try { await lstat(path); }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
      invalid("Private credential file is unavailable.");
    }
  }
  const contents = await readBoundedFile(path, "Private credential file", 64 * 1024);
  const assignments = [...(/** @type {string} */ (contents)).matchAll(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*([^\r\n]*)$/gmu)];
  if (assignments.length !== 1) invalid("Private credential file requires exactly one TYPESAFE_API_KEY assignment.");
  let value = assignments[0][1].trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    if (value.length < 2 || value.at(-1) !== value[0]) invalid("Private credential assignment has unmatched quotes.");
    value = value.slice(1, -1);
  }
  return checkedKey(value);
}

/** @param {string | undefined} path */
async function checkReceiptDestination(path) {
  if (!path) return;
  try { await lstat(resolve(path)); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return;
    invalid("Receipt destination is unavailable.");
  }
  invalid("Receipt destination already exists; choose a fresh path.");
}

/** @param {string | undefined} path @param {unknown} receipt */
async function writeReceipt(path, receipt) {
  if (!path) return;
  try {
    const absolute = resolve(path);
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  } catch { invalid("Receipt could not be created exclusively; existing files are never overwritten."); }
}

/** @param {unknown} error */
function classificationError(error) {
  const message = error instanceof Error ? error.message : "";
  if (/^Jev request (exceeds byte cap|timed out|failed with HTTP [1-5][0-9]{2})$/u.test(message)
    || /^Jev returned (an invalid (route|has_open_decision|context_sufficient|needs_browser|semantic_overlap) answer|invalid route probabilities|an unpinned model|invalid usage facts)$/u.test(message)) return new AdvisoryInputError(message);
  return new AdvisoryInputError("Jev classification failed; no retry was attempted.");
}

/** @param {string[]} argv */
export async function runAdvisory(argv) {
  try {
    const { command, options, json } = parseArguments(argv);
    /** @type {Record<string, any>} */
    let result;
    if (command === "status") {
      const key = await loadApiKey(options);
      result = {
        ok: true, operation: "advisory-status", version: "1.24.0", mode: "advisory-parent-execution",
        policyVersion: orchestrationPolicy.version,
        modelProfile: {
          newSessionDefault: { model: "gpt-5.6-sol", effort: "high" },
          existingParent: "preserve-session-selected-orchestrator",
          boundedWriter: orchestrationPolicy.routes.deepseek_exact,
          nativeDelegates: { model: "gpt-6-astra", effort: "xhigh" },
          excludedModels: ["Luna"],
          classifier: { provider: orchestrationPolicy.classifier.provider, model: orchestrationPolicy.model },
          identityEvidence: "requested-profiles-not-observed-runtime-identity",
        },
        keyPresent: Boolean(key), networkAccessed: false, automaticExecution: false,
      };
    } else {
      const atom = await readObject(options["--atom"], "Atom file");
      const run = await readObject(options["--run-context"], "Run context file");
      validateInputs(atom, run);
      await checkReceiptDestination(options["--receipt"]);
      if (command === "classify-atom") {
        const activeAtoms = await readActiveAtoms(options["--active-atoms"]);
        const key = await loadApiKey(options);
        if (!key) invalid("TYPESAFE_API_KEY is required for Jev classification; configure the environment or private credential file.");
        let receipt;
        try { receipt = await classifyAtomWithJev({ atom, run, activeAtoms, apiKey: /** @type {string} */ (key) }); }
        catch (error) { throw classificationError(error); }
        if (JSON.stringify(receipt).includes(JSON.stringify(key).slice(1, -1))) invalid("Jev response contained protected credential data and was discarded.");
        await writeReceipt(options["--receipt"], receipt);
        result = { ok: true, operation: "classify-atom", ...receipt };
      } else {
        const classificationReceipt = await readObject(options["--route-receipt"], "Classification receipt file");
        let decision;
        try { decision = recordRouteDecision({ atom, run, classificationReceipt, chosenRoute: options["--chosen-route"], rationale: options["--rationale"] }); }
        catch { invalid("Parent decision requires a current advisory receipt bound to the same atom and run, a known chosen route, and a non-empty rationale."); }
        await writeReceipt(options["--receipt"], decision);
        result = { ok: true, operation: "record-route-decision", ...decision };
      }
    }
    const output = json ? JSON.stringify(result) : command === "status"
      ? `Development System 1.24.0: advisory-parent-execution; credential ${result.keyPresent ? "available" : "missing"}; automatic execution disabled.`
      : `${command} recorded; parent owns execution and authorization.`;
    return { result, output, json };
  } catch (error) {
    if (error instanceof AdvisoryInputError) throw error;
    throw new AdvisoryInputError("Advisory operation failed; no automatic retry or execution was attempted.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { output } = await runAdvisory(process.argv.slice(2));
    process.stdout.write(`${output}\n`);
  } catch (error) {
    const message = error instanceof AdvisoryInputError ? error.message : "Advisory operation failed.";
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ ok: false, operation: "error", error: message })}\n`);
    else process.stderr.write(`Development System advisory error: ${message}\n`);
    process.exitCode = 1;
  }
}
