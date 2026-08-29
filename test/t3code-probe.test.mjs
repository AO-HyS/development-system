import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyReadOnlyProbeCommand,
  evaluateT3CodeProbe,
  fetchJsonWithTimeout,
  isReadOnlyProbeCommand,
  pollT3CodeThread,
  resolveAllowedProbeFileRead,
  resolveT3CodeProbeMetadata,
  resolveT3CodeServerRuntime,
  requiredT3CodeLifecycleSkills,
  stopDetachedProcess,
} from "../src/t3code-probe.mjs";
import { runBoundedProcess } from "../src/bounded-process.mjs";

test("T3Code live metadata follows the exact installed contract and Codex catalog", () => {
  const sourceCommit = "a".repeat(40);
  assert.deepEqual(resolveT3CodeProbeMetadata({
    installedManifest: {
      contractVersion: "1.5.3",
      source: { commit: sourceCommit },
      artifacts: [{ logicalName: "skill-catalog", sourcePath: "catalog/0.11.0.json" }],
    },
    installedLock: { catalogVersion: "0.11.0", sourceCommit },
    installedCatalog: { catalogVersion: "0.11.0" },
  }), {
    contractVersion: "1.5.3",
    catalogVersion: "0.11.0",
    sourceCommit,
  });
  assert.throws(() => resolveT3CodeProbeMetadata({
    installedManifest: {
      contractVersion: "1.5.3",
      source: { commit: "b".repeat(40) },
      artifacts: [{ logicalName: "skill-catalog", sourcePath: "catalog/0.11.0.json" }],
    },
    installedLock: { catalogVersion: "0.11.0", sourceCommit },
    installedCatalog: { catalogVersion: "0.11.0" },
  }), /source commits do not match/i);
  assert.throws(() => resolveT3CodeProbeMetadata({
    installedManifest: {
      contractVersion: "1.5.3",
      source: { commit: sourceCommit },
      artifacts: [{ logicalName: "skill-catalog", sourcePath: "catalog/0.10.0.json" }],
    },
    installedLock: { catalogVersion: "0.11.0", sourceCommit },
    installedCatalog: { catalogVersion: "0.11.0" },
  }), /manifest and skill catalog versions do not match/i);
});

test("T3Code server selection supports packed Electron builds and fails fast when absent", () => {
  const packed = "/Applications/T3 Code.app/Contents/Resources/app.asar/apps/server/dist/bin.mjs";
  const executable = "/Applications/T3 Code.app/Contents/MacOS/T3 Code";
  assert.deepEqual(resolveT3CodeServerRuntime({
    nodeExecutable: "/usr/bin/node",
    candidates: [{ entrypoint: packed, availabilityPath: "/Applications/T3 Code.app/Contents/Resources/app.asar", executable, electronRunAsNode: true }],
    exists: (path) => ["/Applications/T3 Code.app/Contents/Resources/app.asar", executable].includes(path),
  }), {
    executable,
    argsPrefix: [packed],
    environment: { ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.throws(() => resolveT3CodeServerRuntime({
    nodeExecutable: "/usr/bin/node",
    candidates: [{ entrypoint: "/missing" }],
    exists: () => false,
  }), /not installed/i);
});

function report(skillAuditHealthy = true) {
  const sourceCommit = "a".repeat(40);
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
    "coding-orchestration",
    ...requiredT3CodeLifecycleSkills,
  ].map((skill) => `/Users/test/.agents/skills/${skill}/SKILL.md`);
  const command =
    `sed -n '1,200p' ${skillPaths.join(" ")}; ` +
    "cat /tmp/skill-audit.json";
  const auditResult = { ok: true };
  const auditOutput = `${JSON.stringify(auditResult)}\n`;
  const evidencePath = "/tmp/evidence.json";
  const evidenceSha256 = "a".repeat(64);
  return {
    contractVersion: "1.5.3",
    catalogVersion: "0.11.0",
    sourceCommit,
    failure: null,
    requestedModel: { model: "gpt-5.6-sol" },
    requestedRuntimeMode: "approval-required",
    approvalEvidence: [{
      requestKind: "command",
      detail: "cat /Users/test/.agents/skills/wayfinder/SKILL.md",
      decision: "accept",
    }],
    allowedFileReads: [{ path: evidencePath, sha256: evidenceSha256 }],
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
    hostEvidence: {
      skillAudit: {
        command: ["./bin/development-system", "audit-skills", "--evidence", evidencePath, "--json"],
        exitCode: 0,
        outputPath: "/tmp/skill-audit.json",
        outputSha256: createHash("sha256").update(auditOutput).digest("hex"),
        evidencePath,
        evidenceSha256,
        healthy: true,
        result: auditResult,
      },
    },
    stateInvariants: {
      repository: {
        gitHeadUnchanged: true,
        gitStatusUnchanged: true,
        fingerprintUnchanged: true,
      },
      managedHome: {
        before: {
          installation: {
            ok: true,
            status: "healthy",
            contractVersion: "1.5.3",
            source: { commit: sourceCommit },
          },
          skills: {
            ok: true,
            status: "healthy",
            catalogVersion: "0.11.0",
            sourceCommit,
          },
        },
        after: {
          installation: {
            ok: true,
            status: "healthy",
            contractVersion: "1.5.3",
            source: { commit: sourceCommit },
          },
          skills: {
            ok: true,
            status: "healthy",
            catalogVersion: "0.11.0",
            sourceCommit,
          },
        },
        unchanged: true,
      },
    },
  };
}

test("T3Code probe accepts concise and detailed healthy skill audit evidence", () => {
  assert.equal(evaluateT3CodeProbe(report(true)), true);
  const noApprovalRequired = report(true);
  noApprovalRequired.approvalEvidence = [];
  assert.equal(evaluateT3CodeProbe(noApprovalRequired), true);
  assert.equal(evaluateT3CodeProbe(report({ healthy: true, logicalSkills: 20 })), true);
  const nativeShape = report({ status: true, logicalSkills: 20 });
  nativeShape.observed.routerLoaded = ["drive-development-flow", "coding-orchestration"];
  nativeShape.observed.influenceSignatures["flow-code-review"] =
    "Inspect through blind Standards and Spec lanes.";
  nativeShape.observed.influenceSignatures.wayfinder =
    "Plan decision tickets and do not resolve multiple non-research tickets.";
  nativeShape.observed.influenceSignatures["to-tickets"] =
    "Draft vertical slices with explicit blockers.";
  nativeShape.observed.influenceSignatures["flow-implement"] =
    "Pin one binary done condition and preserve stop boundaries.";
  assert.equal(evaluateT3CodeProbe(nativeShape), true);

  const noActivityPublishing = report(true);
  noActivityPublishing.application = { environmentCapabilities: { agentActivityPublishing: false } };
  noActivityPublishing.observed.routerLoaded = "drive-development-flow";
  const approvedSkillPaths = [
    "/Users/test/.agents/skills/drive-development-flow/SKILL.md",
    "/Users/test/.agents/skills/coding-orchestration/SKILL.md",
    ...requiredT3CodeLifecycleSkills.map((skill) => `/Users/test/.agents/skills/${skill}/SKILL.md`),
  ];
  noActivityPublishing.allowedFileReads.push(
    ...approvedSkillPaths.map((path) => ({ path, sha256: "b".repeat(64) })),
    { path: "/tmp/skill-audit.json", sha256: "c".repeat(64) },
  );
  noActivityPublishing.approvalEvidence = [
    ...approvedSkillPaths.map((path) => ({ requestKind: "command", detail: `cat ${path}`, decision: "accept" })),
    { requestKind: "command", detail: "cat /tmp/skill-audit.json", decision: "accept" },
    { requestKind: "command", detail: "cat docs/spec.md", decision: "accept" },
  ];
  noActivityPublishing.toolEvidence.completedCommands = [];
  assert.equal(evaluateT3CodeProbe(noActivityPublishing), true);

  const falselyMissingActivity = structuredClone(noActivityPublishing);
  falselyMissingActivity.application.environmentCapabilities.agentActivityPublishing = true;
  assert.equal(evaluateT3CodeProbe(falselyMissingActivity), false);

  const unsafeApproval = structuredClone(noActivityPublishing);
  unsafeApproval.approvalEvidence[0].detail += "; git push origin main";
  assert.equal(evaluateT3CodeProbe(unsafeApproval), false);

  const pathsWithoutReads = structuredClone(noActivityPublishing);
  pathsWithoutReads.approvalEvidence = [{
    requestKind: "command",
    detail: `test ${approvedSkillPaths.join(" ")} /tmp/skill-audit.json`,
    decision: "accept",
  }];
  assert.equal(evaluateT3CodeProbe(pathsWithoutReads), false);

  const unboundEvidence = structuredClone(noActivityPublishing);
  unboundEvidence.hostEvidence.skillAudit.evidencePath = "/tmp/other-evidence.json";
  assert.equal(evaluateT3CodeProbe(unboundEvidence), false);

  const unexpectedAbsoluteRead = structuredClone(noActivityPublishing);
  unexpectedAbsoluteRead.approvalEvidence.push({
    requestKind: "command",
    detail: "cat /etc/passwd",
    decision: "accept",
  });
  assert.equal(evaluateT3CodeProbe(unexpectedAbsoluteRead), false);
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
  unknownActions.toolEvidence.completedCommands[0].commandActions = [{ type: "unknown" }];
  assert.equal(evaluateT3CodeProbe(unknownActions), false);

  const unhealthyBaseline = report();
  unhealthyBaseline.stateInvariants.managedHome.before.installation.status = "drifted";
  assert.equal(evaluateT3CodeProbe(unhealthyBaseline), false);

  const staleCatalog = report();
  staleCatalog.stateInvariants.managedHome.before.skills.catalogVersion = "0.10.0";
  assert.equal(evaluateT3CodeProbe(staleCatalog), false);
});

test("T3Code approval policy permits inspection and rejects mutation or scripting", () => {
  assert.equal(isReadOnlyProbeCommand("sed -n '1,80p' docs/spec.md"), true);
  assert.equal(
    isReadOnlyProbeCommand("./bin/development-system audit-skills --evidence evidence/current.json --json | jq '.ok'"),
    false,
  );
  assert.equal(isReadOnlyProbeCommand("rg -n \"wayfinder|to-spec\" docs"), true);
  assert.equal(isReadOnlyProbeCommand("/bin/zsh -lc pwd"), true);
  assert.equal(
    isReadOnlyProbeCommand(`/bin/zsh -lc "sed -n '1,4p' docs/spec.md && rg -n \\"wayfinder|to-spec\\" docs"`),
    true,
  );
  assert.equal(isReadOnlyProbeCommand("git status --short; git push origin main"), false);
  assert.equal(isReadOnlyProbeCommand("node -e \"require('fs').writeFileSync('x','y')\""), false);
  assert.equal(isReadOnlyProbeCommand("find . -delete"), false);
  assert.equal(isReadOnlyProbeCommand("sed -i '' 's/a/b/' docs/spec.md"), false);
  assert.equal(isReadOnlyProbeCommand("sed -i.bak 's/a/b/' docs/spec.md"), false);
  assert.equal(isReadOnlyProbeCommand("sed -n -e 'w /tmp/aoh215-proof' docs/spec.md"), false);
  assert.equal(isReadOnlyProbeCommand("sed -n 's/a/b/w /tmp/aoh215-proof' docs/spec.md"), false);
  assert.equal(isReadOnlyProbeCommand("git diff --output=/tmp/leak.patch"), false);
  assert.equal(isReadOnlyProbeCommand("git diff --ext-diff"), false);
  assert.equal(isReadOnlyProbeCommand("git diff --textconv"), false);
  assert.equal(isReadOnlyProbeCommand("find . -fprint /tmp/files"), false);
  assert.equal(isReadOnlyProbeCommand("cat docs/spec.md & touch /tmp/side-effect"), false);
  assert.equal(isReadOnlyProbeCommand("rg --pre 'touch /tmp/side-effect' pattern ."), false);
  assert.equal(isReadOnlyProbeCommand("cat docs/spec.md > /tmp/copy"), false);
});

test("T3Code file reads require an exact canonical allowlisted file", () => {
  const directory = mkdtempSync(join(tmpdir(), "t3code-file-read-"));
  const allowed = join(directory, "allowed.md");
  const secret = join(directory, "secret.txt");
  const escape = join(directory, "escape");
  writeFileSync(allowed, "allowed");
  writeFileSync(secret, "secret");
  symlinkSync(secret, escape);
  assert.equal(resolveAllowedProbeFileRead(allowed, [allowed]), realpathSync(allowed));
  assert.equal(resolveAllowedProbeFileRead(JSON.stringify({ path: allowed }), [allowed]), realpathSync(allowed));
  assert.equal(resolveAllowedProbeFileRead(`${allowed}.suffix`, [allowed]), null);
  assert.equal(resolveAllowedProbeFileRead(secret, [allowed]), null);
  assert.equal(resolveAllowedProbeFileRead(escape, [allowed]), null);
  rmSync(directory, { recursive: true, force: true });
});

test("T3Code probe accepts policy-declined unsafe requests only when they never execute", () => {
  const declined = report();
  declined.approvalEvidence.push({
    requestKind: "command",
    detail: "touch /tmp/side-effect",
    decision: "decline",
  });
  declined.toolEvidence.blockedCommands = [{
    command: "touch /tmp/side-effect",
    exitCode: null,
    policyActions: [],
  }];
  assert.equal(evaluateT3CodeProbe(declined), true);

  declined.approvalEvidence[1].decision = "accept";
  assert.equal(evaluateT3CodeProbe(declined), false);
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

test("T3Code thread polling returns bounded evidence for HTTP timeout and invalid JSON", async () => {
  let clock = 0;
  let attempt = 0;
  const result = await pollT3CodeThread({
    timeoutMs: 30,
    intervalMs: 10,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    fetchSnapshot: async () => {
      attempt += 1;
      if (attempt === 1) {
        const error = new Error("request aborted");
        error.name = "AbortError";
        throw error;
      }
      throw new SyntaxError("invalid JSON response");
    },
    inspectSnapshot: () => false,
  });
  assert.equal(result.snapshot, null);
  assert.equal(result.completed, false);
  assert.deepEqual(result.pollingFailures, {
    count: 3,
    recentKinds: ["http-timeout", "invalid-json", "invalid-json"],
  });
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
