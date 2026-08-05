#!/usr/bin/env node
// @ts-check

import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const endpoint = "https://api.exa.ai/search";
const searchTypes = new Set(["auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"]);
const deepTypes = new Set(["deep-lite", "deep", "deep-reasoning"]);
const categories = new Set(["company", "people", "publication", "news", "personal site", "financial report"]);
const allowedTopLevel = new Set([
  "query", "type", "numResults", "category", "userLocation", "includeDomains", "excludeDomains",
  "startPublishedDate", "endPublishedDate", "moderation", "additionalQueries", "systemPrompt",
  "outputSchema", "compliance", "contents",
]);
const forbiddenKeys = new Set([
  "useAutoprompt", "includeUrls", "excludeUrls", "numSentences", "highlightsPerUrl", "tokensNum", "livecrawl",
]);

function fail(message) {
  throw new Error(message);
}

function parseInteger(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const command = argv[0] ?? "search";
  if (!new Set(["search", "request"]).has(command)) fail("Usage: exa-search.mjs <search|request> [options]");
  const options = { command, includeDomains: [], excludeDomains: [], dryRun: false };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") { options.dryRun = true; continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${token}`);
    if (token === "--query") options.query = value;
    else if (token === "--type") options.type = value;
    else if (token === "--num-results") options.numResults = value;
    else if (token === "--category") options.category = value;
    else if (token === "--include-domain") options.includeDomains.push(value);
    else if (token === "--exclude-domain") options.excludeDomains.push(value);
    else if (token === "--max-age-hours") options.maxAgeHours = value;
    else if (token === "--text-max-characters") options.textMaxCharacters = value;
    else if (token === "--input") options.input = value;
    else if (token === "--home") options.home = value;
    else fail(`Unknown option: ${token}`);
    index += 1;
  }
  return options;
}

function walkForbidden(value, path = "$", seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) fail(`Circular JSON value at ${path}`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) fail(`Deprecated or invalid parameter ${path}.${key}`);
    walkForbidden(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function countSchema(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) fail("outputSchema must be a JSON object");
  if (depth > 2) fail("outputSchema exceeds the maximum nesting depth of 2");
  const allowed = new Set(["type", "description", "required", "properties", "items"]);
  for (const key of Object.keys(schema)) if (!allowed.has(key)) fail(`Unsupported outputSchema control: ${key}`);
  let count = 0;
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) fail("outputSchema.properties must be an object");
    for (const [key, child] of Object.entries(schema.properties)) {
      if (/citation|confidence/i.test(key)) fail("Do not add citation or confidence fields to outputSchema");
      count += 1 + countSchema(child, depth + 1);
    }
  }
  if (schema.items && typeof schema.items === "object") count += countSchema(schema.items, depth + 1);
  return count;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("Request payload must be a JSON object");
  walkForbidden(payload);
  for (const key of Object.keys(payload)) if (!allowedTopLevel.has(key)) fail(`Unsupported top-level parameter: ${key}`);
  if (typeof payload.query !== "string" || payload.query.trim().length === 0) fail("query is required");
  if (payload.query.length > 10_000) fail("query exceeds 10,000 characters");
  payload.type ??= "auto";
  payload.numResults ??= 5;
  payload.contents ??= { highlights: true };
  if (!searchTypes.has(payload.type)) fail(`Unsupported search type: ${payload.type}`);
  payload.numResults = parseInteger(payload.numResults, "numResults", 1, 100);
  if (payload.category !== undefined && !categories.has(payload.category)) fail(`Unsupported category: ${payload.category}`);
  if (payload.additionalQueries !== undefined && !deepTypes.has(payload.type)) fail("additionalQueries requires a deep search type");
  if (payload.category === "company" || payload.category === "people") {
    if (payload.excludeDomains || payload.startPublishedDate || payload.endPublishedDate) {
      fail(`${payload.category} does not support excludeDomains or publication-date filters`);
    }
  }
  if (!payload.contents || typeof payload.contents !== "object" || Array.isArray(payload.contents)) fail("contents must be an object");
  for (const key of Object.keys(payload.contents)) {
    if (!new Set(["text", "highlights", "summary", "livecrawlTimeout", "maxAgeHours", "subpages", "subpageTarget", "extras"]).has(key)) {
      fail(`Unsupported contents parameter: ${key}`);
    }
  }
  if (payload.contents.text === true) fail("Uncapped text is disabled; use contents.text.maxCharacters");
  if (payload.contents.text && typeof payload.contents.text === "object") {
    for (const key of Object.keys(payload.contents.text)) {
      if (!new Set(["maxCharacters", "includeHtmlTags", "verbosity", "includeSections", "excludeSections"]).has(key)) {
        fail(`Unsupported contents.text parameter: ${key}`);
      }
    }
    parseInteger(payload.contents.text.maxCharacters, "contents.text.maxCharacters", 1, 200_000);
    if (payload.contents.text.verbosity !== undefined && !new Set(["compact", "standard", "full"]).has(payload.contents.text.verbosity)) {
      fail("contents.text.verbosity must be compact, standard, or full");
    }
  }
  if (payload.contents.highlights && typeof payload.contents.highlights === "object") {
    for (const key of Object.keys(payload.contents.highlights)) {
      if (!new Set(["query", "maxCharacters"]).has(key)) fail(`Unsupported contents.highlights parameter: ${key}`);
    }
  }
  if (payload.contents.summary && typeof payload.contents.summary === "object") {
    for (const key of Object.keys(payload.contents.summary)) {
      if (!new Set(["query", "schema"]).has(key)) fail(`Unsupported contents.summary parameter: ${key}`);
    }
  }
  if (payload.contents.extras && typeof payload.contents.extras === "object") {
    for (const key of Object.keys(payload.contents.extras)) {
      if (!new Set(["links", "imageLinks"]).has(key)) fail(`Unsupported contents.extras parameter: ${key}`);
    }
  }
  if (payload.contents.maxAgeHours !== undefined) parseInteger(payload.contents.maxAgeHours, "contents.maxAgeHours", -1, 876_000);
  if (payload.compliance !== undefined) {
    if (payload.compliance !== "hipaa") fail("compliance must be hipaa when provided");
    if (!new Set(["fast", "instant"]).has(payload.type)) fail("HIPAA compliance requires type fast or instant");
    if (payload.contents.summary !== undefined) fail("HIPAA compliance does not support contents.summary");
    if (payload.contents.maxAgeHours !== -1) fail("HIPAA compliance requires cache-only retrieval with contents.maxAgeHours set to -1");
  }
  if (payload.outputSchema !== undefined && countSchema(payload.outputSchema) > 10) fail("outputSchema exceeds 10 total properties");
  return payload;
}

async function buildPayload(options) {
  if (options.command === "request") {
    if (!options.input) fail("request requires --input <absolute-or-relative-json-path>");
    return validatePayload(JSON.parse(await readFile(resolve(options.input), "utf8")));
  }
  if (!options.query) fail("search requires --query <public-web-query>");
  const contents = options.textMaxCharacters
    ? { text: { maxCharacters: parseInteger(options.textMaxCharacters, "--text-max-characters", 1, 200_000) } }
    : { highlights: true };
  if (options.maxAgeHours !== undefined) contents.maxAgeHours = parseInteger(options.maxAgeHours, "--max-age-hours", -1, 876_000);
  return validatePayload({
    query: options.query,
    type: options.type ?? "auto",
    numResults: options.numResults ? parseInteger(options.numResults, "--num-results", 1, 100) : 5,
    ...(options.category ? { category: options.category } : {}),
    ...(options.includeDomains.length ? { includeDomains: options.includeDomains } : {}),
    ...(options.excludeDomains.length ? { excludeDomains: options.excludeDomains } : {}),
    contents,
  });
}

async function apiKey(home) {
  if (process.env.EXA_API_KEY?.trim()) return process.env.EXA_API_KEY.trim();
  try {
    const value = (await readFile(resolve(home, ".config", "exa", "key"), "utf8")).trim();
    if (value) return value;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  fail(`EXA_API_KEY is not set and ${resolve(home, ".config", "exa", "key")} does not exist`);
}

async function appendTelemetry(home, event) {
  const path = resolve(home, ".development-system", "usage", "exa.jsonl");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const home = resolve(options.home ?? homedir());
  const payload = await buildPayload(options);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, endpoint, payload }, null, 2)}\n`);
    return;
  }
  const started = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await apiKey(home)}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    await appendTelemetry(home, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      ok: false,
      status: null,
      durationMs: Date.now() - started,
      requestedType: payload.type,
      requestedResults: payload.numResults,
      searchType: null,
      returnedResults: null,
      requestId: null,
      costDollars: null,
      failure: error instanceof Error ? error.name : "NetworkError",
    });
    throw error;
  }
  const bodyText = await response.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = { error: "Exa returned a non-JSON response" }; }
  await appendTelemetry(home, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ok: response.ok,
    status: response.status,
    durationMs: Date.now() - started,
    requestedType: payload.type,
    searchType: body?.searchType ?? null,
    requestedResults: payload.numResults,
    returnedResults: Array.isArray(body?.results) ? body.results.length : null,
    requestId: body?.requestId ?? null,
    costDollars: Number.isFinite(body?.costDollars?.total) ? body.costDollars.total : null,
  });
  if (!response.ok) fail(`Exa request failed with HTTP ${response.status}: ${body?.error ?? "unknown error"}`);
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
}

await main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
