// @ts-check
// Preload for QuickE2E's `jev` engine (`node --import <this> quicke2e.mjs run ... --engine jev`).
// QuickE2E calls Jev through OpenRouter; the operator's Jev access is a prepaid TypeSafe key (the
// one jevgrep stores). Only that one request is redirected to TypeSafe's equivalent endpoint with
// the same model; every other request and QuickE2E itself are unchanged.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const OPENROUTER_DECISIONS = "https://openrouter.ai/api/alpha/decisions";
const TYPESAFE_DECISIONS = "https://api.typesafe.ai/v1/systemone";
const TYPESAFE_MODEL = "jev-1.13.0";

/** @returns {string} */
function typeSafeKey() {
  if (process.env.TYPESAFE_AI_API_KEY) return process.env.TYPESAFE_AI_API_KEY;
  const credentials = JSON.parse(readFileSync(`${homedir()}/.config/jevgrep/credentials.json`, "utf8"));
  if (credentials.provider !== "typesafe" || typeof credentials.apiKey !== "string") throw new Error("jevgrep credentials are not a TypeSafe key");
  return credentials.apiKey;
}

const realFetch = globalThis.fetch;
/** @type {typeof fetch} */
globalThis.fetch = async (input, init = {}) => {
  if (String(input instanceof Request ? input.url : input) !== OPENROUTER_DECISIONS) return realFetch(input, init);
  const body = JSON.parse(String(init.body));
  body.model = TYPESAFE_MODEL;
  return realFetch(TYPESAFE_DECISIONS, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${typeSafeKey()}` },
    body: JSON.stringify(body),
  });
};
