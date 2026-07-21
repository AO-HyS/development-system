import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { lifecycleProbeDefinitions, responsePasses } from "../scripts/probe-lifecycle-interface.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("lifecycle live-probe definitions cover the automatic router and every explicit phase", () => {
  assert.deepEqual(lifecycleProbeDefinitions.map((definition) => definition.skill), [
    "drive-development-flow",
    "wayfinder",
    "grill-with-docs",
    "to-spec",
    "to-tickets",
    "flow-implement",
    "flow-code-review",
  ]);
  for (const definition of lifecycleProbeDefinitions) {
    assert.equal(definition.behaviorSignature.length, 2);
    assert.equal(responsePasses(definition.behaviorSignature.join(" "), definition.behaviorSignature), true);
    assert.equal(responsePasses("generic prompt echo", definition.behaviorSignature), false);
    for (const phrase of definition.behaviorSignature) assert.equal(definition.question.includes(phrase), false);
  }
});

test("committed live evidence proves every lifecycle command in Codex and Factory", async () => {
  const evidence = JSON.parse(await readFile(
    resolve(repositoryRoot, "evidence/lifecycle-interface-live-2026-07-21.json"),
    "utf8",
  ));
  assert.equal(evidence.contractVersion, "0.8.0");
  assert.equal(evidence.catalogVersion, "0.2.0");
  assert.deepEqual(evidence.repositoryMutations, []);
  assert.equal(evidence.passed, true);
  const sourceCommit = spawnSync("git", ["cat-file", "-e", `${evidence.sourceCommit}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(sourceCommit.status, 0, sourceCommit.stderr);
  for (const [harness, prefix] of [["codex", "$"], ["factory", "/"]]) {
    const results = evidence.harnesses[harness];
    assert.deepEqual(results.map((result) => result.skill), lifecycleProbeDefinitions.map((definition) => definition.skill));
    assert.ok(results.every((result) => result.commandPrefix === prefix && result.exitCode === 0 &&
      !result.timedOut && result.influenceObserved && result.passed));
    if (harness === "factory") assert.ok(results.every((result) => result.activationObserved === true));
  }
});
