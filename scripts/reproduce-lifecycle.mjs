// @ts-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repositoryRoot, "bin", "development-system.mjs");
const home = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-scenario-"));
const workflow = "SCENARIO-1";

/** @param {string[]} args @param {number} expectedStatus */
function step(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, "--home", home, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const statePath = resolve(home, ".development-system", "lifecycles", `${workflow}.json`);
assert.equal(
  step([
    "lifecycle-request",
    "--workflow",
    workflow,
    "--mode",
    "recommend",
    "--request",
    "Esta iniciativa es enorme y no tiene ruta clara",
  ]).selectedStage,
  "wayfinder",
);
await assert.rejects(access(statePath));

for (const request of [
  "Inicia grill-with-docs",
  "Apruebo los requisitos",
  "Genera el spec y Local Visual Plan con to-spec",
  "Apruebo el spec y plan",
  "Genera tickets con to-tickets",
  "Apruebo los tickets",
]) {
  assert.equal(
    step([
      "lifecycle-request",
      "--workflow",
      workflow,
      "--mode",
      "transition",
      "--request",
      request,
    ]).ok,
    true,
  );
}

assert.equal(
  step([
    "lifecycle-request",
    "--workflow",
    workflow,
    "--mode",
    "transition",
    "--request",
    "Implementa y entrega el preview",
    "--terminal-slice",
    "Lifecycle scenario",
  ]).state.stage,
  "delivery_authorized",
);
assert.equal(
  step(["lifecycle-execute", "--workflow", workflow, "--operation", "merge"], 1).execution.status,
  "denied",
);
assert.equal(
  step(["lifecycle-execute", "--workflow", workflow, "--operation", "generate_recap"]).state.stage,
  "pre_release_ready",
);
step([
  "lifecycle-request",
  "--workflow",
  workflow,
  "--mode",
  "transition",
  "--request",
  "Autorizo únicamente el merge",
]);
assert.equal(
  step(["lifecycle-execute", "--workflow", workflow, "--operation", "merge"]).execution.status,
  "authorized",
);
assert.equal(
  step(["lifecycle-execute", "--workflow", workflow, "--operation", "merge"], 1).execution.status,
  "denied",
);

process.stdout.write(`Lifecycle scenario complete. Isolated HOME: ${home}\n`);
