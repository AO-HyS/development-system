import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexSkillProbeEvidence,
  buildCodexSkillProbeInvocations,
  runCodexSkillProbeSequence,
  runSkillProbeProcess,
} from "../src/skill-probe-runtime.mjs";

function message(text) {
  return `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } })}\n`;
}

test("Codex skill probe invocations are ephemeral, read-only, bounded surfaces without Factory", () => {
  const invocations = buildCodexSkillProbeInvocations({ codexPath: "/opt/codex", repositoryRoot: "/repo" });
  assert.deepEqual(Object.keys(invocations), ["version", "catalog", "skill"]);
  for (const invocation of [invocations.catalog, invocations.skill]) {
    assert.equal(invocation.executable, "/opt/codex");
    assert.ok(invocation.args.includes("--ephemeral"));
    assert.deepEqual(invocation.args.slice(invocation.args.indexOf("--sandbox"), invocation.args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
    assert.ok(invocation.args.includes("never"));
    assert.ok(invocation.args.includes("/repo"));
    assert.doesNotMatch(invocation.args.join(" "), /factory|droid/iu);
  }
});

test("Codex skill probe observations run sequentially to avoid exit-zero empty turns", async () => {
  const invocations = buildCodexSkillProbeInvocations({ codexPath: "/opt/codex", repositoryRoot: "/repo" });
  const calls = [];
  let active = false;
  const result = await runCodexSkillProbeSequence({
    invocations,
    execute: async (invocation) => {
      assert.equal(active, false, "probe invocations overlapped");
      active = true;
      calls.push(invocation);
      await Promise.resolve();
      active = false;
      const stdout = invocation === invocations.catalog
        ? message("research")
        : invocation === invocations.skill
          ? message("A background agent uses primary sources and creates one markdown file somewhere sensible and will say where.")
          : "codex 1";
      return { executable: invocation.executable, marker: calls.length, exitCode: 0, stdout };
    },
  });
  assert.deepEqual(calls, [invocations.version, invocations.catalog, invocations.skill]);
  assert.equal(result.codexVersion.marker, 1);
  assert.equal(result.codexCatalog.marker, 2);
  assert.equal(result.codex.marker, 3);
  assert.deepEqual(result.observationAttempts, {
    version: 1,
    catalog: 1,
    skill: 1,
    retriedFailedAssertions: 0,
  });
});

test("Codex skill probe retries only an exit-zero observation missing its required assertion", async () => {
  const invocations = buildCodexSkillProbeInvocations({ codexPath: "/opt/codex", repositoryRoot: "/repo" });
  const attempts = new Map();
  const result = await runCodexSkillProbeSequence({
    invocations,
    execute: async (invocation) => {
      const key = invocation === invocations.version ? "version" : invocation === invocations.catalog ? "catalog" : "skill";
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      if (key === "catalog" && count === 1) return { exitCode: 0, stdout: "", stderr: "" };
      if (key === "skill" && count === 1) return { exitCode: 0, stdout: message("I read a skill."), stderr: "" };
      return { exitCode: 0, stdout: key === "version" ? "codex 1" : message(key), stderr: "" };
    },
  });
  assert.deepEqual(Object.fromEntries(attempts), { version: 1, catalog: 2, skill: 2 });
  assert.deepEqual(result.observationAttempts, {
    version: 1,
    catalog: 2,
    skill: 2,
    retriedFailedAssertions: 2,
  });
});

test("the process runner kills a stalled probe within its explicit timeout", async () => {
  const startedAt = Date.now();
  const result = await runSkillProbeProcess({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10_000)"],
    cwd: process.cwd(),
    timeoutMs: 40,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(Date.now() - startedAt < 2_000, true);
});

test("fixture evidence proves exact shape, influence, failure handling, and sanitized persistence", () => {
  const common = {
    catalogVersion: "0.11.0",
    sourceCommit: "a".repeat(40),
    home: "/isolated-home",
    structuralCatalogLogicalSkills: 33,
    installedHash: "b".repeat(64),
    generatedAt: "2026-08-14T00:00:00.000Z",
    codexVersion: { exitCode: 0, stdout: "codex-cli 1.2.3\n", errorCode: null, timedOut: false, overflow: false },
  };
  const healthy = buildCodexSkillProbeEvidence({
    ...common,
    catalogResult: { exitCode: 0, stdout: message("research"), stderr: "", command: "codex catalog", errorCode: null },
    skillResult: {
      exitCode: 0,
      stdout: message("A background agent uses primary sources and writes one markdown file somewhere sensible and will say where."),
      stderr: "",
      command: "codex research",
      errorCode: null,
    },
  });
  assert.equal(healthy.probeSucceeded, true);
  assert.deepEqual(Object.keys(healthy.installedHashes), ["research.codex"]);
  assert.equal(healthy.codex.research.catalogued, true);
  assert.equal(healthy.codex.research.loaded, true);
  assert.equal(healthy.codex.research.influenced, true);
  assert.deepEqual(healthy.codex.research.versionObservation, {
    exitCode: 0,
    timedOut: false,
    overflow: false,
    failure: null,
  });
  assert.deepEqual(healthy.codex.research.observationAttempts, {
    version: 1,
    catalog: 1,
    skill: 1,
    retriedFailedAssertions: 0,
  });
  assert.equal("factory" in healthy, false);

  const failed = buildCodexSkillProbeEvidence({
    ...common,
    catalogResult: { exitCode: null, stdout: "", stderr: "token=secret-value https://private.example/path?q=1", command: "codex catalog", errorCode: "TIMEOUT", timedOut: true },
    skillResult: { exitCode: null, stdout: "", stderr: "", command: "codex research", errorCode: "TIMEOUT", timedOut: true },
  });
  assert.equal(failed.probeSucceeded, false);
  assert.equal(failed.codex.research.influenced, false);
  assert.ok(failed.codex.research.failures.length > 0);
  assert.doesNotMatch(JSON.stringify(failed), /secret-value|private\.example/iu);

  for (const codexVersion of [
    { exitCode: null, stdout: "", errorCode: null, timedOut: true, overflow: false },
    { exitCode: 2, stdout: "version failed", errorCode: null, timedOut: false, overflow: false },
  ]) {
    const versionFailed = buildCodexSkillProbeEvidence({
      ...common,
      codexVersion,
      catalogResult: { exitCode: 0, stdout: message("research"), stderr: "", command: "codex catalog", errorCode: null },
      skillResult: {
        exitCode: 0,
        stdout: message("A background agent uses primary sources and writes one markdown file somewhere sensible and will say where."),
        stderr: "",
        command: "codex research",
        errorCode: null,
      },
    });
    assert.equal(versionFailed.probeSucceeded, false);
    assert.ok(versionFailed.codex.research.versionObservation.failure);
    assert.equal(versionFailed.codex.research.response, "");
  }

  for (const [surface, override] of [
    ["catalogResult", { timedOut: true }],
    ["catalogResult", { overflow: true }],
    ["skillResult", { timedOut: true }],
    ["skillResult", { overflow: true }],
  ]) {
    const catalogResult = { exitCode: 0, stdout: message("research"), stderr: "", command: "codex catalog", errorCode: null };
    const skillResult = {
      exitCode: 0,
      stdout: message("A background agent uses primary sources and writes one markdown file somewhere sensible and will say where."),
      stderr: "",
      command: "codex research",
      errorCode: null,
    };
    const failedProcess = buildCodexSkillProbeEvidence({
      ...common,
      catalogResult: surface === "catalogResult" ? { ...catalogResult, ...override } : catalogResult,
      skillResult: surface === "skillResult" ? { ...skillResult, ...override } : skillResult,
    });
    assert.equal(failedProcess.probeSucceeded, false);
    assert.ok(failedProcess.codex.research.failure);
    assert.equal(failedProcess.codex.research.response, "");
  }
});
