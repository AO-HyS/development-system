import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

import {
  evaluateT3CodeProbe,
  fetchJsonWithTimeout,
  requiredT3CodeLifecycleSkills,
  stopDetachedProcess,
} from "../src/t3code-probe.mjs";

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
  return {
    requestedModel: { model: "gpt-5.6-sol" },
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
        command:
          `sed -n '1,200p' ${skillPaths.join(" ")}; ` +
          "./bin/development-system audit-skills --evidence evidence/current.json --json",
        exitCode: 0,
        commandActions: skillPaths.map((path) => ({ type: "read", path })),
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
