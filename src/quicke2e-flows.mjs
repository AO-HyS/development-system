// @ts-check
// What QuickE2E executes for a recorded run (review DS185-01, 2026-11-03).
//
// A `.mjs` spec is code QuickE2E imports into the same process that prints the results, so an agent-written spec
// could print passing records without opening a browser. Flow files are therefore declarative JSON: this module
// validates the data and writes the `.mjs` QuickE2E loads into the run directory, so no agent code runs there.
// The QuickE2E package itself is checked against the digest of the published 0.5.0 tarball before each use.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** sha256 over every file of the published quicke2e@0.5.0 package (relative path and file hash, sorted). */
export const QUICKE2E_PACKAGE_SHA256 = "53d13bc42e773a4003468a91f5c9debbac54b9888d4418a49ff29abe552d3f03";

/** @param {string | Buffer} data */
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** @param {string} directory @param {string} [relative] @returns {string[]} */
const files = (directory, relative = "") => readdirSync(directory).sort().flatMap((name) => statSync(path.join(directory, name)).isDirectory()
  ? files(path.join(directory, name), `${relative}${name}/`)
  : [`${relative}${name}`]);

/** @param {string} packageDirectory node_modules/quicke2e */
export function packageDigest(packageDirectory) {
  if (!existsSync(packageDirectory)) return "";
  return sha256(files(packageDirectory).map((file) => `${file}\0${sha256(readFileSync(path.join(packageDirectory, file)))}\n`).join(""));
}

/**
 * Reads a JSON flow file, checks it is plain data and writes the module QuickE2E loads.
 * A relative `storageState` is resolved next to the JSON file, as QuickE2E would resolve it next to a spec.
 * @param {string} spec physical path of the .json flow file @param {string} directory where the generated module goes
 * @returns {{module: string, specSha256: string, flows: number}}
 */
export function prepareFlows(spec, directory) {
  if (!spec.endsWith(".json")) throw new Error(`flow file ${spec} must be declarative JSON (flows.json: an array of flows); a .mjs spec runs code inside the process that reports the results (review DS185-01)`);
  const source = readFileSync(spec);
  /** @type {unknown} */
  let flows;
  try { flows = JSON.parse(source.toString("utf8")); } catch (error) { throw new Error(`flow file ${spec} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(flows) || flows.length === 0 || flows.some((flow) => !flow || typeof flow !== "object" || Array.isArray(flow))) {
    throw new Error(`flow file ${spec} must be a non-empty JSON array of flow objects`);
  }
  for (const flow of /** @type {Record<string, unknown>[]} */ (flows)) {
    if (typeof flow.storageState === "string" && !path.isAbsolute(flow.storageState)) flow.storageState = path.resolve(path.dirname(spec), flow.storageState);
  }
  const module = path.join(directory, "flows.generated.mjs");
  writeFileSync(module, `export default ${JSON.stringify(flows, null, 2)};\n`, { mode: 0o600 });
  return { module, specSha256: sha256(source), flows: flows.length };
}
