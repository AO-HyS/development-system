// @ts-check
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writePrivateEvidence } from "./private-evidence.mjs";
import { modelRouteUnavailableReasons } from "./model-routing.mjs";

/** @typedef {{candidateId: string, reason: string, observedAt: string, expiresAt: string, evidenceRef: string}} ProviderFailure */
const reasons = new Set(modelRouteUnavailableReasons);
/** @param {string} home */
const statePath = (home) => resolve(home, ".development-system/private/runtime/provider-availability.json");
/** @param {unknown} input @param {number} now @returns {ProviderFailure} */
function validateFailure(input, now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provider failure must be an object");
  const value = /** @type {Record<string, unknown>} */ (input);
  if (Object.keys(value).sort().join(",") !== "candidateId,evidenceRef,expiresAt,observedAt,reason") throw new Error("Provider failure requires exactly candidateId, reason, observedAt, expiresAt and evidenceRef");
  for (const key of ["candidateId", "reason", "observedAt", "expiresAt", "evidenceRef"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) throw new Error("Provider failure has invalid " + key);
  }
  const failure = /** @type {ProviderFailure} */ (value);
  if (!/^[a-zA-Z0-9._:-]+$/.test(failure.candidateId)) throw new Error("Invalid candidateId");
  if (!reasons.has(failure.reason)) throw new Error("Unsupported provider failure reason");
  const observed = Date.parse(failure.observedAt), expires = Date.parse(failure.expiresAt);
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > now || expires <= observed || expires - observed > 7 * 86400000) throw new Error("Provider failure needs a past observation and bounded expiry (maximum seven days)");
  return failure;
}
/** Read active negative observations only. Cached successes never prove a new runtime.
 * @param {string} home @param {number} [now] @returns {Promise<ProviderFailure[]>}
 */
export async function readProviderFailures(home, now = Date.now()) {
  let state;
  try { state = JSON.parse(await readFile(statePath(home), "utf8")); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.failures)) throw new Error("Invalid provider availability state");
  /** @type {ProviderFailure[]} */
  const failures = state.failures.map((/** @type {unknown} */ entry) => validateFailure(entry, now));
  if (new Set(failures.map((failure) => failure.candidateId)).size !== failures.length) throw new Error("Duplicate provider failure");
  return failures.filter((failure) => Date.parse(failure.expiresAt) > now);
}
/** Record one host-observed failure; caller owns sequencing of observations.
 * @param {{home: string, observation: unknown, now?: number}} input
 */
export async function recordProviderFailure({ home, observation, now = Date.now() }) {
  const failure = validateFailure(observation, now);
  const previous = await readProviderFailures(home, now);
  const prior = previous.find((entry) => entry.candidateId === failure.candidateId);
  if (prior && Date.parse(prior.observedAt) > Date.parse(failure.observedAt)) throw new Error("Refusing an older provider observation");
  const failures = [...previous.filter((entry) => entry.candidateId !== failure.candidateId), failure].filter((entry) => Date.parse(entry.expiresAt) > now);
  await writePrivateEvidence({ home, destination: statePath(home), contents: JSON.stringify({ schemaVersion: 1, failures }, null, 2) + "\n" });
  return { operation: "record-provider-failure", ok: true, candidateId: failure.candidateId, expiresAt: failure.expiresAt, activeFailures: failures.length };
}
