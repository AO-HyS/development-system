import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("behavior signatures tolerate command-name and prose hyphenation", () => {
  assert.equal(responsePasses("tracer-bullet with blocking edges", ["tracer bullet", "blocking edges"]), true);
  assert.equal(responsePasses("load flow-code-review", ["flow-code-review"]), true);
});

test("committed live evidence proves every lifecycle command in Codex and Factory", async () => {
  const evidencePath = "evidence/lifecycle-interface-live-2026-07-21.json";
  const evidenceBytes = await readFile(resolve(repositoryRoot, evidencePath));
  const evidence = JSON.parse(evidenceBytes.toString("utf8"));
  const provenance = JSON.parse(await readFile(
    resolve(repositoryRoot, "evidence/lifecycle-interface-live-2026-07-21.provenance.json"),
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
  const evidenceCommit = spawnSync("git", ["cat-file", "-e", `${provenance.evidenceCommit}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(evidenceCommit.status, 0, evidenceCommit.stderr);
  const sourceIsAncestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", evidence.sourceCommit, provenance.evidenceCommit],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(sourceIsAncestor.status, 0, sourceIsAncestor.stderr);
  const evidenceIsAncestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", provenance.evidenceCommit, "HEAD"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(evidenceIsAncestor.status, 0, evidenceIsAncestor.stderr);
  const committedEvidence = spawnSync(
    "git",
    ["show", `${provenance.evidenceCommit}:${evidencePath}`],
    { cwd: repositoryRoot, encoding: null },
  );
  assert.equal(committedEvidence.status, 0, committedEvidence.stderr?.toString());
  assert.deepEqual(committedEvidence.stdout, evidenceBytes);
  assert.equal(
    createHash("sha256").update(evidenceBytes).digest("hex"),
    provenance.sha256,
  );
  for (const [harness, prefix] of [["codex", "$"], ["factory", "/"]]) {
    const results = evidence.harnesses[harness];
    assert.deepEqual(results.map((result) => result.skill), lifecycleProbeDefinitions.map((definition) => definition.skill));
    assert.ok(results.every((result) => result.commandPrefix === prefix && result.exitCode === 0 &&
      !result.timedOut && result.influenceObserved && result.passed));
    if (harness === "factory") assert.ok(results.every((result) => result.activationObserved === true));
  }
});
