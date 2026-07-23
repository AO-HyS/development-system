import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

import {
  classifyReadOnlyProbeCommand,
  evaluateT3CodeProbe,
  fetchJsonWithTimeout,
  isReadOnlyProbeCommand,
  requiredT3CodeLifecycleSkills,
  stopDetachedProcess,
} from "../src/t3code-probe.mjs";
import { runBoundedProcess } from "../src/bounded-process.mjs";

function report(skillAuditHealthy = true) {
  const influenceSignatures = {
    wayfinder: "Plan decisions and resolve one ticket.",
    "grill-with-docs": "Run a grilling session with domain-modeling.",
    "to-spec": "Synthesize context without interviewing the user.",
    "to-tickets": "Create tracer-bullet slices with blocking edges.",
    "flow-implement": "Pin the terminal slice and stop boundary.",
    "flow-code-review": "Use separate Standards and Spec lanes.",
  };
  const skillPaths = [
    "drive-development-flow",
    ...requiredT3CodeLifecycleSkills,
  ].map((skill) => `/Users/test/.agents/skills/${skill}/SKILL.md`);
  const command =
    `sed -n '1,200p' ${skillPaths.join(" ")}; ` +
    "./bin/development-system audit-skills --evidence evidence/current.json --json";
  return {
    requestedModel: { model: "gpt-5.6-sol" },
    requestedRuntimeMode: "approval-required",
    approvalEvidence: [],
    observedThreadModel: { model: "gpt-5.6-sol" },
    observed: {
      routerLoaded: true,
      lifecycleSkills: requiredT3CodeLifecycleSkills,
      influenceSignatures,
      skillAuditHealthy,
      model: "gpt-5.6-sol",
    },
    toolEvidence: {
      completedCommands: [{
        command,
        exitCode: 0,
        commandActions: skillPaths.map((path) => ({ type: "read", path })),
        policyActions: classifyReadOnlyProbeCommand(command),
      }],
    },
    stateInvariants: {
      repository: {
        gitHeadUnchanged: true,
        gitStatusUnchanged: true,
        fingerprintUnchanged: true,
      },
      managedHome: { unchanged: true },
    },
  };
}

test("T3Code probe accepts concise and detailed healthy skill audit evidence", () => {
  assert.equal(evaluateT3CodeProbe(report(true)), true);
  assert.equal(evaluateT3CodeProbe(report({ healthy: true, logicalSkills: 20 })), true);
  const nativeShape = report({ status: true, logicalSkills: 20 });
  nativeShape.observed.routerLoaded = ["drive-development-flow", "coding-orchestration"];
  nativeShape.observed.influenceSignatures["flow-code-review"] =
    "Inspect through blind Standards and Spec lanes.";
  nativeShape.observed.influenceSignatures.wayfinder =
    "Plan decision tickets and do not resolve multiple non-research tickets.";
  assert.equal(evaluateT3CodeProbe(nativeShape), true);
});

test("T3Code probe fails closed when a lifecycle skill or repository invariant is missing", () => {
  const missingSkill = report();
  missingSkill.observed.lifecycleSkills = ["flow-code-review"];
  assert.equal(evaluateT3CodeProbe(missingSkill), false);

  const changedRepository = report();
  changedRepository.stateInvariants.repository.gitStatusUnchanged = false;
  assert.equal(evaluateT3CodeProbe(changedRepository), false);

  const hallucinated = report();
  hallucinated.toolEvidence.completedCommands = [];
  assert.equal(evaluateT3CodeProbe(hallucinated), false);

  const weakSignature = report();
  weakSignature.observed.influenceSignatures.wayfinder = "wayfinder rule";
  assert.equal(evaluateT3CodeProbe(weakSignature), false);

  const mutatingCommand = report();
  mutatingCommand.toolEvidence.completedCommands[0].command += "; git push origin main";
  assert.equal(evaluateT3CodeProbe(mutatingCommand), false);

  const absentActions = report();
  delete absentActions.toolEvidence.completedCommands[0].policyActions;
  assert.equal(evaluateT3CodeProbe(absentActions), false);

  const unknownActions = report();
  unknownActions.toolEvidence.completedCommands[0].policyActions = [{ type: "unknown" }];
  assert.equal(evaluateT3CodeProbe(unknownActions), false);
});

test("T3Code approval policy permits inspection and rejects mutation or scripting", () => {
  assert.equal(isReadOnlyProbeCommand("sed -n '1,80p' docs/spec.md"), true);
  assert.equal(
    isReadOnlyProbeCommand("./bin/development-system audit-skills --evidence evidence/current.json --json | jq '.ok'"),
    true,
  );
  assert.equal(isReadOnlyProbeCommand("rg -n \"wayfinder|to-spec\" docs"), true);
  assert.equal(
    isReadOnlyProbeCommand(`/bin/zsh -lc "sed -n '1,4p' docs/spec.md && rg -n \\"wayfinder|to-spec\\" docs"`),
    true,
  );
  assert.equal(isReadOnlyProbeCommand("git status --short; git push origin main"), false);
  assert.equal(isReadOnlyProbeCommand("node -e \"require('fs').writeFileSync('x','y')\""), false);
  assert.equal(isReadOnlyProbeCommand("find . -delete"), false);
  assert.equal(isReadOnlyProbeCommand("sed -i '' 's/a/b/' docs/spec.md"), false);
  assert.equal(isReadOnlyProbeCommand("sed -i.bak 's/a/b/' docs/spec.md"), false);
  assert.equal(isReadOnlyProbeCommand("git diff --output=/tmp/leak.patch"), false);
  assert.equal(isReadOnlyProbeCommand("find . -fprint /tmp/files"), false);
  assert.equal(isReadOnlyProbeCommand("cat docs/spec.md & touch /tmp/side-effect"), false);
  assert.equal(isReadOnlyProbeCommand("rg --pre 'touch /tmp/side-effect' pattern ."), false);
  assert.equal(isReadOnlyProbeCommand("cat docs/spec.md > /tmp/copy"), false);
});

test("bounded JSON requests abort a stalled T3Code endpoint", async () => {
  const server = createServer(() => {});
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise(undefined));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await assert.rejects(
    fetchJsonWithTimeout(`http://127.0.0.1:${address.port}/stalled`, {}, 50),
    /timeout|aborted/i,
  );
  server.closeAllConnections();
  await new Promise((resolvePromise, reject) =>
    server.close((error) => error ? reject(error) : resolvePromise(undefined))
  );
});

test("detached process cleanup waits through forced termination", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],
    { detached: true, stdio: "ignore" },
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  await stopDetachedProcess(child, 50);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("bounded process timeout kills a resistant descendant process group", async () => {
  const result = await runBoundedProcess(
    process.execPath,
    [
      "-e",
      "const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'}); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)",
    ],
    {
      cwd: process.cwd(),
      timeoutMs: 75,
      graceMs: 50,
      maxBuffer: 1024,
    },
  );
  assert.equal(result.timedOut, true);
  assert.match(result.error ?? "", /Timed out/);
});
