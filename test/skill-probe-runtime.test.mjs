import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexSkillProbeEvidence,
  buildCodexSkillProbeInvocations,
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
    codexVersion: { stdout: "codex-cli 1.2.3\n" },
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
});
