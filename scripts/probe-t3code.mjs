// @ts-check

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditRepository } from "../src/repositories.mjs";
import {
  evaluateT3CodeProbe,
  fetchJsonWithTimeout,
  classifyReadOnlyProbeCommand,
  isReadOnlyProbeCommand,
  pollT3CodeThread,
  resolveT3CodeProbeMetadata,
  resolveT3CodeServerRuntime,
  resolveAllowedProbeFileRead,
  stopDetachedProcess,
} from "../src/t3code-probe.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
const repositoryIndex = process.argv.indexOf("--repository");
const probeRepository = resolve(
  repositoryIndex >= 0 ? process.argv[repositoryIndex + 1] : repositoryRoot,
);
const probeHome = homedir();
const probeMetadata = resolveT3CodeProbeMetadata({
  installedManifest: JSON.parse(readFileSync(resolve(probeHome, ".development-system/installed-manifest.json"), "utf8")),
  installedLock: JSON.parse(readFileSync(resolve(probeHome, ".development-system/skills-lock.json"), "utf8")),
  installedCatalog: JSON.parse(readFileSync(resolve(probeHome, ".codex/development-system/skills.json"), "utf8")),
});
const evidenceIndex = process.argv.indexOf("--skill-evidence");
const skillEvidence = resolve(
  evidenceIndex >= 0
    ? process.argv[evidenceIndex + 1]
    : resolve(probeHome, ".development-system/private/reports/skills-live-latest.json"),
);
const t3ApplicationCandidates = [
  { app: "/Applications/T3 Code (Nightly).app", executable: "T3 Code (Nightly)" },
  { app: "/Applications/T3 Code.app", executable: "T3 Code" },
];
const serverRuntime = resolveT3CodeServerRuntime({
  explicitCli: process.env.T3CODE_SERVER_CLI,
  explicitExecutable: process.env.T3CODE_SERVER_EXECUTABLE,
  nodeExecutable: process.execPath,
  candidates: t3ApplicationCandidates.flatMap(({ app, executable }) => [
    {
      entrypoint: resolve(app, "Contents/Resources/app.asar.unpacked/apps/server/dist/bin.mjs"),
    },
    {
      entrypoint: resolve(app, "Contents/Resources/app.asar/apps/server/dist/bin.mjs"),
      availabilityPath: resolve(app, "Contents/Resources/app.asar"),
      executable: resolve(app, "Contents/MacOS", executable),
      electronRunAsNode: true,
    },
  ]),
  exists: existsSync,
});
const serverCli = serverRuntime.argsPrefix[0];
const serverEnvironment = { ...process.env, ...serverRuntime.environment };

/** @param {string} command @param {string[]} args @param {string} [cwd] */
function run(command, args, cwd = probeRepository, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result.stdout.trim();
}

/** @param {string[]} args @param {string} [cwd] */
function runServer(args, cwd = probeRepository) {
  return run(serverRuntime.executable, [...serverRuntime.argsPrefix, ...args], cwd, serverEnvironment);
}

function gitState() {
  return {
    head: run("git", ["rev-parse", "HEAD"]),
    status: run("git", ["status", "--short", "--untracked-files=all"]),
  };
}

function managedHomeState() {
  const installation = JSON.parse(
    run("./bin/development-system", ["audit", "--home", probeHome, "--json"], repositoryRoot),
  );
  const skills = JSON.parse(
    run(
      "./bin/development-system",
      [
        "audit-skills",
        "--home",
        probeHome,
        "--version",
        probeMetadata.catalogVersion,
        "--evidence",
        skillEvidence,
        "--json",
      ],
      repositoryRoot,
    ),
  );
  return {
    installation: {
      ok: installation.ok,
      status: installation.status,
      contractVersion: installation.contractVersion,
      source: installation.source,
      artifacts: installation.artifacts.map((/** @type {any} */ artifact) => ({
        id: artifact.id,
        actualSha256: artifact.actualSha256,
        status: artifact.status,
      })),
      mirrors: installation.mirrors,
      problems: installation.problems,
    },
    skills: {
      ok: skills.ok,
      status: skills.status,
      catalogVersion: probeMetadata.catalogVersion,
      sourceCommit: probeMetadata.sourceCommit,
      logicalSkillCount: skills.logicalSkillCount,
      physicalVariantCount: skills.physicalVariantCount,
      evidenceCoverage: skills.evidenceCoverage,
      variants: skills.skills.map((/** @type {any} */ skill) => ({
        id: skill.id,
        directoryHash: skill.directoryHash,
        states: skill.states,
      })),
      problems: skills.problems,
    },
  };
}

/** @param {any[]} activities */
function observedToolEvidence(activities) {
  const commands = activities
    .filter((activity) => activity.kind === "tool.completed")
    .map((activity) => activity.payload?.data?.item)
    .filter((item) => item?.type === "commandExecution")
    .map((item) => ({
      command: item.command,
      cwd: item.cwd,
      durationMs: item.durationMs,
      exitCode: item.exitCode,
      rawCommandActions: item.commandActions ?? [],
      commandActions: (item.commandActions ?? []).map((/** @type {any} */ action) => ({
        type: action.type === "listFiles" ? "list" : action.type,
        path: action.path ?? null,
        query: action.query ?? null,
      })),
      policyActions: classifyReadOnlyProbeCommand(item.command) ?? [],
    }));
  return {
    completedCommands: commands.filter((entry) => Number.isInteger(entry.exitCode)),
    blockedCommands: commands.filter((entry) => !Number.isInteger(entry.exitCode)),
  };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolvePromise(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve T3Code port");
  await new Promise((resolvePromise, reject) =>
    server.close((error) => error ? reject(error) : resolvePromise(undefined))
  );
  return address.port;
}

/** @param {string} origin @param {number} [timeoutMs] */
async function waitForDescriptor(origin, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { response, body } = await fetchJsonWithTimeout(
        `${origin}/.well-known/t3/environment`,
        {},
        1_000,
      );
      if (response.ok) return body;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("T3Code server did not become ready");
}

/** @param {any[]} messages */
function parseFinalJson(messages) {
  const candidate = [...messages].reverse().find(
    (message) => message.role === "assistant" && message.text?.includes('"routerLoaded"'),
  );
  if (!candidate) throw new Error("T3Code turn ended without the expected JSON response");
  const text = candidate.text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

const before = gitState();
const repositoryBefore = await auditRepository({ repository: probeRepository });
const homeBefore = managedHomeState();
const startedAt = new Date();
const baseDir = await mkdtemp(join(tmpdir(), "aohys-t3code-probe-"));
const hostAuditPath = resolve(baseDir, "skill-audit.json");
const hostAuditCommand = [
  "./bin/development-system",
  "audit-skills",
  "--version",
  probeMetadata.catalogVersion,
  "--evidence",
  skillEvidence,
  "--json",
];
const hostAudit = JSON.parse(run(hostAuditCommand[0], hostAuditCommand.slice(1), repositoryRoot));
const hostAuditOutput = `${JSON.stringify(hostAudit)}\n`;
await writeFile(hostAuditPath, hostAuditOutput, { encoding: "utf8", mode: 0o600 });
const hostSkillAuditEvidence = {
  command: hostAuditCommand,
  exitCode: 0,
  outputPath: hostAuditPath,
  outputSha256: createHash("sha256").update(hostAuditOutput).digest("hex"),
  evidencePath: skillEvidence,
  evidenceSha256: createHash("sha256").update(readFileSync(skillEvidence)).digest("hex"),
  healthy: hostAudit.ok === true,
  result: hostAudit,
};
const allowedFileReadPaths = [
  resolve(probeRepository, "AGENTS.md"),
  resolve(probeRepository, "README.md"),
  resolve(probeRepository, "docs/spec.md"),
  resolve(probeRepository, "docs/recertification-2026-07-23.md"),
  ...[
    "0003-operational-skill-evidence.md",
    "0004-lifecycle-gates-are-persisted-and-operation-specific.md",
    "0005-parity-is-observable-across-native-harness-adapters.md",
    "0006-models-are-mapped-by-capability-and-benchmark-evidence.md",
    "0008-repository-audit-and-preparation-are-separate-transitions.md",
  ].map((name) => resolve(probeRepository, "docs/adr", name)),
  resolve(homedir(), ".codex/skills/drive-development-flow/SKILL.md"),
  resolve(homedir(), ".codex/skills/coding-orchestration/SKILL.md"),
  ...[
    "wayfinder",
    "grill-with-docs",
    "to-spec",
    "to-tickets",
    "flow-implement",
    "flow-code-review",
  ].map((skill) => resolve(homedir(), `.agents/skills/${skill}/SKILL.md`)),
  skillEvidence,
  hostAuditPath,
];
const allowedFileReads = allowedFileReadPaths.map((path) => {
  const resolvedPath = resolveAllowedProbeFileRead(path, [path]);
  if (!resolvedPath) throw new Error(`Unable to bind allowed file read: ${path}`);
  return {
    path: resolvedPath,
    sha256: createHash("sha256").update(readFileSync(resolvedPath)).digest("hex"),
  };
});
const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
let server;
let report;

try {
  const logPath = resolve(baseDir, "server.log");
  const logDescriptor = openSync(logPath, "a", 0o600);
  server = spawn(
    serverRuntime.executable,
    [
      ...serverRuntime.argsPrefix,
      "serve",
      "--mode",
      "desktop",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--base-dir",
      baseDir,
      "--no-browser",
      probeRepository,
    ],
    {
      cwd: probeRepository,
      env: serverEnvironment,
      detached: true,
      stdio: ["ignore", logDescriptor, logDescriptor],
    },
  );
  closeSync(logDescriptor);
  const readServerLog = () => {
    try {
      return readFileSync(logPath, "utf8").slice(-20_000);
    } catch {
      return "";
    }
  };

  let descriptor;
  try {
    descriptor = await waitForDescriptor(origin);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${readServerLog()}`);
  }
  runServer(["project", "add", "--base-dir", baseDir, probeRepository]);
  const pairing = JSON.parse(
    runServer([
      "auth",
      "pairing",
      "create",
      "--base-dir",
      baseDir,
      "--ttl",
      "10m",
      "--json",
    ]),
  );
  const tokenForm = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: pairing.credential,
    subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope: pairing.scopes.join(" "),
  });
  const { response: tokenResponse, body: tokenPayload } = await fetchJsonWithTimeout(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenForm,
  }, 5_000);
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(`T3Code token exchange failed: ${JSON.stringify(tokenPayload)}`);
  }
  const headers = {
    authorization: `Bearer ${tokenPayload.access_token}`,
    "content-type": "application/json",
  };
  const { body: shell } = await fetchJsonWithTimeout(
    `${origin}/api/orchestration/shell`,
    { headers },
    5_000,
  );
  const project = shell.projects.find((/** @type {any} */ entry) => entry.workspaceRoot === probeRepository);
  if (!project) throw new Error("T3Code probe project was not registered");

  const threadId = `thread-${randomUUID()}`;
  const modelSelection = { instanceId: "codex", model: "gpt-5.6-sol" };
  const requestedRuntimeMode = "approval-required";
  /** @type {Array<{requestId: string, requestKind: string, detail: string, decision: string, resolvedPath: string | null}>} */
  const approvalEvidence = [];
  const handledApprovals = new Set();
  /** @param {Record<string, any>} payload */
  async function dispatch(payload) {
    const { response, body } = await fetchJsonWithTimeout(`${origin}/api/orchestration/dispatch`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }, 10_000);
    if (!response.ok) throw new Error(`T3Code dispatch failed: ${JSON.stringify(body)}`);
    return body;
  }

  await dispatch({
    type: "thread.create",
    commandId: `cmd-${randomUUID()}`,
    threadId,
    projectId: project.id,
    title: "Development System T3Code live probe",
    modelSelection,
    runtimeMode: requestedRuntimeMode,
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: new Date().toISOString(),
  });
  await dispatch({
    type: "thread.turn.start",
    commandId: `cmd-${randomUUID()}`,
    threadId,
    message: {
      messageId: `msg-${randomUUID()}`,
      role: "user",
      text:
        "Read-only Development System recertification. Classify this request using the repository rules. " +
        "Then explicitly invoke and load wayfinder, grill-with-docs, to-spec, to-tickets, flow-implement, and flow-code-review " +
        "only to inspect their operational contracts; do not execute their mutations or create artifacts. " +
        `Audit installed skills using the current evidence file ${skillEvidence}. ` +
        "For shell inspection use only cat, find without -exec/-delete, head, ls, nl, rg, sed, sha256sum, " +
        "shasum, stat, tail, test, wc, git diff/rev-parse/status, or the Development System audit commands; " +
        "send every shell command as a single line. Do not run pwd or git commands; the host measures repository state. " +
        `You MUST read ${hostAuditPath} with cat and base skillAuditHealthy on that host-generated audit output. ` +
        "do not use redirects, command substitution, scripting runtimes, network clients, or mutation commands. " +
        "Do not change files or external state. Return only one compact JSON object with keys harness, routerLoaded, " +
        "lifecycleSkills, influenceSignatures, instructionSources, skillAuditHealthy, model, reasoning, externalState. " +
        "List only skills actually loaded in this turn. influenceSignatures must map every listed lifecycle skill to one " +
        "concise operational rule learned from that skill's own instructions.",
      attachments: [],
    },
    modelSelection,
    runtimeMode: requestedRuntimeMode,
    interactionMode: "default",
    createdAt: new Date().toISOString(),
  });

  const turnTimeoutMs = Number(process.env.T3CODE_TURN_TIMEOUT_MS ?? String(4 * 60 * 1000));
  if (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs <= 0) {
    throw new Error("T3CODE_TURN_TIMEOUT_MS must be positive");
  }
  const poll = await pollT3CodeThread({
    timeoutMs: turnTimeoutMs,
    fetchSnapshot: async () => (await fetchJsonWithTimeout(
      `${origin}/api/orchestration/threads/${threadId}`,
      { headers },
      5_000,
    )).body,
    inspectSnapshot: async (snapshot) => {
      const currentThread = snapshot.thread ?? snapshot;
      for (const activity of currentThread.activities ?? []) {
        if (activity.kind !== "approval.requested" || handledApprovals.has(activity.payload?.requestId)) {
          continue;
        }
        const requestId = activity.payload?.requestId;
        const requestKind = activity.payload?.requestKind;
        const detail = String(activity.payload?.detail ?? "");
        const resolvedFileRead =
          requestKind === "file-read"
            ? resolveAllowedProbeFileRead(detail, allowedFileReadPaths)
            : null;
        const allowedFileRead = resolvedFileRead !== null;
        const allowedCommand = requestKind === "command" && isReadOnlyProbeCommand(detail);
        const decision = allowedFileRead || allowedCommand ? "accept" : "decline";
        await dispatch({
          type: "thread.approval.respond",
          commandId: `cmd-${randomUUID()}`,
          threadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        });
        approvalEvidence.push({
          requestId,
          requestKind,
          detail,
          decision,
          resolvedPath: resolvedFileRead,
        });
        handledApprovals.add(requestId);
      }
      return (currentThread.messages ?? []).some((/** @type {any} */ message) =>
        message.role === "assistant" &&
        message.text?.includes('"routerLoaded"') &&
        message.text?.includes('"skillAuditHealthy"')
      );
    },
  });
  const snapshot = poll.snapshot;
  const receivedExpectedResponse = poll.completed;
  const thread = snapshot?.thread ?? snapshot ?? { activities: [], messages: [] };
  let response = {};
  let probeFailure = null;
  if (!receivedExpectedResponse) {
    const lastPollingFailure = poll.pollingFailures.recentKinds.at(-1) ?? null;
    probeFailure = {
      kind: snapshot ? "turn-timeout" : "thread-poll-failed",
      message: snapshot
        ? `T3Code did not return the expected read-only JSON within ${turnTimeoutMs}ms`
        : `T3Code thread polling produced no usable snapshot within ${turnTimeoutMs}ms${lastPollingFailure ? ` (${lastPollingFailure})` : ""}`,
    };
  } else {
    try {
      response = parseFinalJson(thread.messages ?? []);
    } catch (error) {
      probeFailure = {
        kind: "invalid-response",
        message: error instanceof Error ? error.message : "T3Code returned an invalid response",
      };
    }
  }
  const after = gitState();
  const repositoryAfter = await auditRepository({ repository: probeRepository });
  const homeAfter = managedHomeState();
  const latestContext = [...(thread.activities ?? [])].reverse().find(
    (/** @type {any} */ activity) => activity.kind === "context-window.updated",
  )?.payload;
  const commandEvidence = observedToolEvidence(thread.activities ?? []);
  const finishedAt = new Date();

  report = {
    schemaVersion: 1,
    contractVersion: probeMetadata.contractVersion,
    catalogVersion: probeMetadata.catalogVersion,
    generatedAt: finishedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    operation: "t3code-live-probe",
    sourceCommit: probeMetadata.sourceCommit,
    probeToolCommit: run("git", ["rev-parse", "HEAD"], repositoryRoot),
    application: {
      executable: serverRuntime.executable,
      entrypoint: serverCli,
      version: descriptor.serverVersion,
      environmentCapabilities: descriptor.capabilities,
      providerAdapter: "codex",
    },
    requestedModel: modelSelection,
    requestedRuntimeMode,
    turnTimeoutMs,
    failure: probeFailure,
    pollingEvidence: poll.pollingFailures,
    approvalEvidence,
    allowedFileReads,
    observed: response,
    observedThreadModel: thread.modelSelection ?? null,
    context: latestContext
      ? {
          usedTokens: latestContext.usedTokens ?? null,
          totalProcessedTokens: latestContext.totalProcessedTokens ?? null,
          maxTokens: latestContext.maxTokens ?? null,
        }
      : null,
    hostEvidence: {
      skillAudit: hostSkillAuditEvidence,
    },
    toolEvidence: {
      completedCommandCount: commandEvidence.completedCommands.length,
      blockedCommandCount: commandEvidence.blockedCommands.length,
      completedCommands: commandEvidence.completedCommands,
      blockedCommands: commandEvidence.blockedCommands,
    },
    stateInvariants: {
      repository: {
        headBefore: before.head,
        headAfter: after.head,
        gitHeadUnchanged: before.head === after.head,
        gitStatusUnchanged: before.status === after.status,
        fingerprintBefore: repositoryBefore.repositoryFingerprint,
        fingerprintAfter: repositoryAfter.repositoryFingerprint,
        fingerprintUnchanged:
          repositoryBefore.repositoryFingerprint === repositoryAfter.repositoryFingerprint,
      },
      managedHome: {
        before: homeBefore,
        after: homeAfter,
        unchanged: JSON.stringify(homeBefore) === JSON.stringify(homeAfter),
      },
    },
    diagnostics: [
      ...(readServerLog().includes("Grok CLI health check failed")
        ? ["Unrelated Grok CLI health check failed during startup"]
        : []),
      ...(probeFailure ? [probeFailure.message] : []),
    ],
    ok: false,
  };
  report.ok = evaluateT3CodeProbe(report);
} finally {
  try {
    if (server) await stopDetachedProcess(server);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report?.ok) process.exitCode = 1;
