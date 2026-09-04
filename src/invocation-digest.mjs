// @ts-check

import { createHash } from "node:crypto";

/**
 * Exact schema/algorithm marker persisted with every durable invocation
 * digest. The digest binds the canonical structured executable + argv array +
 * cwd + security-relevant non-secret environment/mode inputs, so argv
 * boundaries cannot collide. Durable evidence carries only this marker and
 * the SHA-256 digest, never the raw argv, prompt, provider output, or secret
 * environment values.
 */
export const invocationDigestSchema = "canonical-executable-argv-cwd-safe-env-v1";

// Explicit security-relevant non-secret environment allowlist. CODEX_HOME is
// bound because it selects the Codex configuration and skill-discovery root
// consumed by the probed process (the canonical home preserved by the
// benchmark runtime); changing it changes the observed invocation. Secret
// values such as API keys stay excluded and are never persisted.
const relevantEnvKeys = Object.freeze(["CODEX_HOME", "HOME", "NODE_ENV", "PATH"]);

/** @param {string} key */
function relevantEnvKey(key) {
  return relevantEnvKeys.includes(key) || key.startsWith("AOHYS_") || key.startsWith("AO_HYS_");
}

/** @param {NodeJS.ProcessEnv | undefined} env */
export function securityEnv(env) {
  if (!env || typeof env !== "object") return {};
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => relevantEnvKey(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)]),
  );
}

/** @param {unknown} value @returns {unknown} */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(/** @type {Record<string, unknown>} */(value)).sort()
      .map((key) => [key, canonicalValue(/** @type {Record<string, unknown>} */(value)[key])]),
  );
}

/** @param {unknown} value */
function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

/**
 * SHA-256 of a canonical structured invocation: exact executable, argv array,
 * cwd, and security-relevant environment. This binds the digest to argv
 * boundaries and environment/mode inputs instead of a join-string collision.
 * The single shared implementation prevents drift between the probe runtime
 * that produces digests and any consumer that reasons about them.
 *
 * @param {{executable: string, argv: string[], cwd: string, env?: NodeJS.ProcessEnv}} input
 */
export function invocationDigest(input) {
  return createHash("sha256")
    .update(canonicalJson({
      executable: input.executable,
      argv: input.argv,
      cwd: input.cwd,
      env: securityEnv(input.env),
    }))
    .digest("hex");
}
