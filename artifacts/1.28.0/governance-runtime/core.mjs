// @ts-check

import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIONS,
  DISPATCH_ACTIONS,
  JEV_ENDPOINT,
  JEV_MODEL,
  PHASES,
  PHASE_ACTIONS,
  PHASE_PREREQUISITES,
  ROUTE_CANDIDATES,
  isAdjacentForward,
  mandatoryCapabilities,
  isRewind,
  phaseActionAllowed,
  profileFor,
  requiredObligations,
  roleRequiresReasoning,
  sameProvider,
} from "./policy.mjs";
import { classifyWithJev } from "./jev.mjs";
import { matchesCodexCommand } from "./codex.mjs";
import {
  GovernanceError,
  assertRelativePath,
  assertSafeId,
  sha256Hex,
  isRecord,
  isStringArray,
  pathContainedBy,
  pathsOverlap,
  setsOverlap,
  stableHash,
  validateAction,
  validateActivation,
  validateContract,
  validateHostEvent,
  validateObservation,
  validateOutcome,
  validatePreToolEvent,
  validateProposal,
  validateTransition,
} from "./schemas.mjs";
import * as store from "./store.mjs";
import { describeToolInvocation, classifyToolResult, getAdapterCatalog, patchPaths } from "./adapters.mjs";
import { tokenizeExactCommand, validateWritablePath } from "./hook.mjs";
import { parseGovernanceArguments } from "./cli.mjs";

export { stableHash } from "./schemas.mjs";
export { snapshotPaths } from "./store.mjs";

const RUNTIME_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const RUNTIME_HASH = stableHash(readdirSync(RUNTIME_DIRECTORY).filter((name) => name.endsWith(".mjs")).sort().map((name) => ({ name, sha256: sha256Hex(readFileSync(join(RUNTIME_DIRECTORY, name))) })));
const POLICY_HASH = stableHash({
  runtimeHash: RUNTIME_HASH,
  endpoint: JEV_ENDPOINT,
  model: JEV_MODEL,
  phaseActions: PHASE_ACTIONS,
  routeCandidates: ROUTE_CANDIDATES,
  actions: ACTIONS,
  adapters: getAdapterCatalog(),
  recoveryPolicy: 1,
});

const ACTIVE_ATTEMPT_STATES = Object.freeze(["running", "awaiting-post", "cancelling", "recovery-required"]);
const FORBIDDEN_REVIEW_INPUT_KEYS = Object.freeze(["transcript", "fullHistory", "history", "conversation", "messages"]);

/** @param {string} prefix */
function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** @param {string} model */
function providerOf(model) {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "codex";
}

/** @param {string} path */
function homeFromRunDirectory(path) {
  // <home>/.development-system/governance/runs/<id>
  return store.resolveHome(join(path, "..", "..", "..", ".."));
}

/**
 * @param {string} runDirectory
 * @param {(run: any) => any | Promise<any>} action
 */
async function mutateRun(runDirectory, action) {
  return store.withHomeLock(homeFromRunDirectory(runDirectory), async () => {
    const run = await store.loadRun(runDirectory);
    const result = await action(run);
    run.revision = (Number.isSafeInteger(run.revision) ? run.revision : 0) + 1;
    await store.saveRun(runDirectory, run);
    return result === undefined ? run : result;
  });
}

/** @param {any} run @param {any} actor */
function ensureActor(run, actor) {
  const existing = run.actors.find((/** @type {any} */ entry) => entry.id === actor.id);
  if (existing) return existing;
  run.actors.push(actor);
  return actor;
}

/** @param {any} run @param {string} action */
function boundariesByAction(run, action) {
  return run.boundaries.filter((/** @type {any} */ boundary) => boundary.action === action);
}

/** @param {any} run @param {string} boundaryId */
function boundaryById(run, boundaryId) {
  return run.boundaries.find((/** @type {any} */ boundary) => boundary.id === boundaryId) ?? null;
}

/** @param {any} run @param {string} boundaryId */
function judgmentFor(run, boundaryId) {
  const boundary = boundaryById(run, boundaryId);
  if (!boundary) return null;
  return run.judgments.find((/** @type {any} */ judgment) => judgment.id === boundary.judgmentId) ?? null;
}

/** @param {any} run @param {string} boundaryId @param {string} [action] */
function passingJudgment(run, boundaryId, action) {
  const boundary = boundaryById(run, boundaryId);
  if (!boundary || (action && boundary.action !== action)) return null;
  const judgment = run.judgments.find((/** @type {any} */ entry) => entry.id === boundary.judgmentId);
  return judgment && judgment.verdict === "pass" ? judgment : null;
}

/** @param {any} run @param {string} action */
function hasPassingJudgment(run, action) {
  return boundariesByAction(run, action).some((/** @type {any} */ boundary) => passingJudgment(run, boundary.id));
}

/** @param {any} run */
function activeAttempts(run) {
  return run.attempts.filter((/** @type {any} */ attempt) => ACTIVE_ATTEMPT_STATES.includes(attempt.status));
}

/** @param {any} run */
function activeLeasePaths(run) {
  return Object.keys(run.leases);
}

/**
 * @param {any} run
 * @param {any[]} writeSet
 * @param {any[]} readSet
 * @param {string | null} [excludeAttemptId]
 */
function findOverlap(run, writeSet, readSet, excludeAttemptId) {
  for (const attempt of activeAttempts(run)) {
    if (excludeAttemptId && attempt.id === excludeAttemptId) continue;
    const attemptWrites = Array.isArray(attempt.leasePaths) ? attempt.leasePaths : [];
    const attemptReads = Array.isArray(attempt.readSet) ? attempt.readSet : [];
    if (setsOverlap(writeSet, attemptReads) || setsOverlap(writeSet, attemptWrites) || setsOverlap(readSet, attemptWrites)) {
      return attempt.id;
    }
  }
  for (const [path, attemptId] of Object.entries(run.leases)) {
    if (excludeAttemptId && attemptId === excludeAttemptId) continue;
    if (writeSet.some((candidate) => pathsOverlap(candidate, path)) || readSet.some((candidate) => pathsOverlap(candidate, path))) {
      return /** @type {string} */ (attemptId);
    }
  }
  return null;
}

/** @param {any} run @param {string} provider */
function assertCapacity(run, provider) {
  const capacity = run.capacity;
  const limit = capacity.providers[provider];
  if (!Number.isSafeInteger(limit) || limit < 1) throw new GovernanceError(`provider ${provider} has no configured capacity`, "capacity");
  const active = activeAttempts(run);
  const providerActive = active.filter((/** @type {any} */ attempt) => attempt.provider === provider).length;
  if (providerActive + 1 > limit) throw new GovernanceError(`provider ${provider} is at capacity`, "capacity");
  if (active.length + 1 > capacity.total) throw new GovernanceError("run is at total capacity", "capacity");
}

/** @param {any} proposal */
function proposalFingerprint(proposal) {
  return {
    id: proposal.id,
    phase: proposal.phase,
    action: proposal.action,
    actorId: proposal.actorId,
    attemptId: proposal.attemptId,
    objective: proposal.objective,
    requirementIds: proposal.requirementIds,
    sourceIds: proposal.sourceIds,
    readSet: proposal.readSet,
    writeSet: proposal.writeSet,
    dependsOn: proposal.dependsOn,
    route: proposal.route,
    toolName: proposal.toolName,
    toolInput: proposal.toolInput,
    evidenceRefs: proposal.evidenceRefs,
    observations: proposal.observations,
    ...(proposal.coordinatorEffortTransition ? { coordinatorEffortTransition: proposal.coordinatorEffortTransition } : {}),
  };
}

/** @param {any} run */
async function currentSourceHashes(run, sourceIds = run.sources.map((/** @type {any} */ source) => source.id)) {
  /** @type {Array<{id:string,path:string,kind:string,sha256:string}>} */
  const hashes = [];
  for (const source of run.sources.filter((/** @type {any} */ source) => sourceIds.includes(source.id))) {
    const file = await store.hashRegularFile(run.root, source.path);
    hashes.push({ id: source.id, path: source.path, kind: source.kind, sha256: file.sha256 });
  }
  return hashes;
}

/**
 * @param {any} run
 * @param {string[]} dependsOn
 */
async function dependencyHashesFor(run, dependsOn) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const dependency of [...dependsOn].sort()) {
    const attempt = run.attempts.find((/** @type {any} */ entry) => entry.id === dependency);
    const boundary = boundaryById(run, dependency);
    if (attempt) {
      const artifact = attempt.acceptanceId ? acceptanceArtifact(run, attempt) : null;
      out[dependency] = { kind: "attempt", status: attempt.status, outputHash: attempt.outputHash ?? null, candidateHash: attempt.candidateHash ?? null, acceptanceId: attempt.acceptanceId ?? null, acceptanceHash: artifact ? stableHash(artifact) : null };
    } else if (boundary) {
      const judgment = judgmentFor(run, boundary.id);
      out[dependency] = { kind: "boundary", verdict: judgment?.verdict ?? "none", candidateHash: boundary.candidateHash ?? null };
    } else {
      out[dependency] = { kind: "unknown" };
    }
  }
  return out;
}

/**
 * @param {any} run
 * @param {any} proposal
 */
async function computeBoundaryInput(run, proposal) {
  const rootIdentity = await store.assertRunRoots(run);
  const scopeHash = await store.hashPaths(run.root, [...proposal.readSet, ...proposal.writeSet]);
  const dependencyHashes = await dependencyHashesFor(run, proposal.dependsOn);
  const sourceHashes = await currentSourceHashes(run, proposal.sourceIds);
  const candidateHash = stableHash({ baseSha: run.baseSha, scopeHash, ...(rootIdentity ? { rootIdentity } : {}) });
  const inputHash = stableHash({
    proposal: proposalFingerprint(proposal),
    sources: sourceHashes,
    policyHash: POLICY_HASH,
    scopeHash,
    dependencyHashes,
    candidateHash,
    ...(rootIdentity ? { rootIdentity } : {}),
    evidence: [...run.plans, ...run.reviews, ...run.evidence, ...run.verifications].filter((/** @type {any} */ artifact) => proposal.evidenceRefs.includes(artifact.id) || proposal.action === "close"),
    findings: ["close", "correct", "final-review-return"].includes(proposal.action) ? run.findings : [],
    correctionState: proposal.action === "correct" ? await correctionState(run) : null,
  });
  return { inputHash, scopeHash, dependencyHashes, sourceHashes, candidateHash, rootIdentity };
}

/**
 * @param {any} run @param {any} attempt
 * @param {string[]} changedPaths
 */
async function reconcileScope(run, attempt, changedPaths) {
  for (const path of changedPaths) {
    assertRelativePath(path, "changedPath");
    if (!attempt.leasePaths.some((/** @type {string} */ owned) => pathContainedBy(path, owned))) {
      throw new GovernanceError(`attempt ${attempt.id} changed unowned path ${path}`, "scope");
    }
  }
  const snapshot = await store.snapshotPaths(attempt.process?.candidateRoot ?? run.root, attempt.leasePaths);
  attempt.outputHash = stableHash(snapshot);
  attempt.changedPaths = [...new Set(changedPaths)].sort();
  attempt.snapshotHash = stableHash(snapshot);
}

/** @param {any} run @param {string} attemptId */
function releaseLeases(run, attemptId) {
  for (const path of Object.keys(run.leases)) {
    if (run.leases[path] === attemptId) delete run.leases[path];
  }
}

/**
 * @param {any} run @param {any} proposal
 * @returns {any}
 */
export function executionDescriptor(run, proposal) {
  const shell = describeToolInvocation({ toolName: proposal.toolName, toolInput: proposal.toolInput });
  if (shell.capability !== "shell") throw new GovernanceError("Dispatch requires an actual supported shell invocation", "tool");
  assertObservedShellName(run, proposal.toolName);
  if ((shell.semanticInput.cwd ?? shell.semanticInput.workdir ?? store.hostRootFor(run)) !== store.hostRootFor(run)) throw new GovernanceError("Dispatch shell root differs from the observed host root", "tool");
  const argv = tokenizeExactCommand(shell.semanticInput.command ?? shell.semanticInput.cmd);
  const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  if (!argv || !["node", process.execPath].includes(argv[0]) || argv[1] !== cli || argv[2] !== "execute") throw new GovernanceError("dispatch requires the exact installed governance execute command", "tool");
  const parsed = parseGovernanceArguments(argv.slice(2));
  if (resolve(parsed.options["--home"] ?? store.resolveHome(undefined)) !== resolve(run.home) || (parsed.options["--run"] && parsed.options["--run"] !== run.runId)) throw new GovernanceError("dispatch control context does not match this run", "binding");
  if (!parsed.options["--input-json"]) throw new GovernanceError("governed process dispatch requires an exact inline descriptor", "tool");
  let launch; try { launch = JSON.parse(parsed.options["--input-json"]); } catch { throw new GovernanceError("invalid execution descriptor"); }
  if (!isRecord(launch) || Object.keys(launch).some((key) => !["attemptId", "candidateRoot", "packetPath", "check", "assessment"].includes(key)) || launch.attemptId !== proposal.attemptId) throw new GovernanceError("execution descriptor must select this exact attempt without authority overrides");
  if (launch.packetPath !== undefined && (!isStringArray([launch.packetPath]) || !proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(launch.packetPath, scope)))) throw new GovernanceError("packetPath must be in the hashed read scope");
  const candidateRoot = launch.candidateRoot ?? run.root;
  if (typeof candidateRoot !== "string" || !isAbsolute(candidateRoot) || resolve(candidateRoot) !== candidateRoot) throw new GovernanceError("execution candidateRoot must be canonical and absolute");
  if (proposal.route.role === "writer") {
    if ([run.root, store.hostRootFor(run)].some((root) => store.rootsOverlap(root, resolve(candidateRoot)))) throw new GovernanceError("writer requires a third separate candidate workspace");
  } else if (resolve(candidateRoot) !== run.root || proposal.writeSet.length) throw new GovernanceError("read-only process must inspect the registered candidate root");
  if (proposal.action === "verify" && launch.assessment !== undefined) {
    if (launch.check !== undefined || proposal.route.role !== "verifier" || !sameProvider(proposal.route.provider, "codex") || proposal.route.model !== "gpt-6-astra" || proposal.route.reasoning !== "xhigh" || !isRecord(launch.assessment) || Object.keys(launch.assessment).some((key) => !["observationIds", "criterionIds", "requireImages"].includes(key)) || !isStringArray(launch.assessment.observationIds) || !launch.assessment.observationIds.length || !isStringArray(launch.assessment.criterionIds) || stableHash([...launch.assessment.criterionIds].sort()) !== stableHash([...proposal.requirementIds].sort()) || typeof launch.assessment.requireImages !== "boolean") throw new GovernanceError("Observation assessment requires an exact fresh Astra verifier and bound observations", "observation_invalid");
  } else if (proposal.action === "verify") {
    if (run.criteria.some((/** @type {any} */ criterion) => proposal.requirementIds.includes(criterion.id) && ["visual", "observation"].includes(criterion.evidenceKind))) throw new GovernanceError("Observed criteria require independent observation assessment", "observation_invalid");
    if (proposal.route.provider !== "local" || proposal.route.model !== "deterministic-check" || !isRecord(launch.check) || Object.keys(launch.check).some((key) => !["executable", "argv"].includes(key)) || !isAbsolute(launch.check.executable ?? "") || !isStringArray(launch.check.argv)) throw new GovernanceError("verification requires an approved exact deterministic check");
    if (!launch.check.argv.length || launch.check.argv.some((/** @type {string} */ arg) => /[\u0000-\u001f]/u.test(arg))) throw new GovernanceError("invalid exact check argv");
    const executable = launch.check.executable.split(sep).at(-1);
    if (["sh", "bash", "zsh", "env", "sudo", "opencode", "codex"].includes(executable) || launch.check.argv.some((/** @type {string} */ arg) => ["-c", "-e", "--eval", "-p", "--print"].includes(arg) || /^--(?:eval|print|require|import|loader|input-type)(?:=|$)/u.test(arg) || /^-[ecp].+/u.test(arg))) throw new GovernanceError("check shell wrappers and inline programs are unsupported");
    const files = launch.check.argv.filter((/** @type {string} */ arg) => !arg.startsWith("-") && (arg.includes("/") || /\.(?:js|mjs|cjs|py|json|toml|yaml|yml)$/u.test(arg)));
    for (const path of files) assertRelativePath(path, "check script/config path");
    if (!files.length || files.some((/** @type {string} */ path) => isAbsolute(path) || !proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(path, scope)))) throw new GovernanceError("check script/config must be bound to its read scope");
  } else if (launch.check !== undefined || launch.assessment !== undefined) throw new GovernanceError("only a verifier may select a check command or assessment");
  return { ...launch, candidateRoot: resolve(candidateRoot) };
}

/** @param {any} run @param {any} boundary */
async function requireCurrentJudgment(run, boundary) {
  const judgment = boundary && passingJudgment(run, boundary.id);
  if (!judgment || (await computeBoundaryInput(run, boundary)).inputHash !== judgment.inputHash) throw new GovernanceError("current passing judgment is required; inputs changed or evidence is missing", "stale");
  return judgment;
}

/** Acceptance bytes and relevant sources, never a caller-supplied hash.
 * @param {any} run @param {any} attempt @param {string} kind */
async function acceptanceStamp(run, attempt, kind) {
  const rootIdentity = await store.assertRunRoots(run);
  const boundary = boundaryById(run, attempt.boundaryId);
  const paths = ["plan", "plan-review"].includes(kind) ? [] : [...boundary.readSet];
  return { root: run.root, ...(rootIdentity ? { rootIdentity } : {}), paths, snapshotHash: await store.hashPaths(run.root, paths), sources: await currentSourceHashes(run, boundary.sourceIds), epoch: run.acceptanceEpoch ?? 0 };
}

/** @param {any} run @param {any} artifact */
async function artifactCurrent(run, artifact) {
  if (!artifact?.stamp || artifact.invalidated) return false;
  try { if (stableHash(await store.assertRunRoots(run)) !== stableHash(artifact.stamp.rootIdentity ?? null)) return false; }
  catch { return false; }
  if (artifact.kind === "observation-assessment") {
    try {
      if (!artifact.assessmentSelection || (await assessmentInput(store.runDirectoryFor(run.home, run.runId), run, artifact.assessmentSelection)).manifestHash !== artifact.manifestHash) return false;
    } catch { return false; }
  }
  const stamp = artifact.stamp;
  if (!["plan", "plan-review"].includes(artifact.kind) && stamp.epoch !== (run.acceptanceEpoch ?? 0)) return false;
  return stamp.snapshotHash === await store.hashPaths(run.root, stamp.paths)
    && stableHash(stamp.sources) === stableHash(await currentSourceHashes(run, stamp.sources.map((/** @type {any} */ source) => source.id)));
}

/** @param {any} run @param {any} proposal */
async function assertBoundarySemantics(run, proposal) {
  if (run.pendingCoordinatorEffortTransition) throw new GovernanceError("coordinator effort confirmation is pending", "effort_pending");
  if (proposal.coordinatorEffortTransition) {
    const change = proposal.coordinatorEffortTransition;
    if (!proposal.action.endsWith("-return") || proposal.route.role !== "coordinator" || proposal.toolName !== "governance" || proposal.attemptId !== null || proposal.writeSet.length || !isAdjacentForward(run.phase, change.to, run.taskKind)) throw new GovernanceError("effort changes require an adjacent phase return", "effort");
    if (run.coordinator.model !== "gpt-6-sol" || change.provider !== run.coordinator.provider || change.model !== run.coordinator.model || change.sessionId !== run.rootSessionId || change.oldEffort !== run.coordinator.reasoning) throw new GovernanceError("effort change must retain the observed Sol coordinator identity", "identity");
  }
  const descriptor = !["governance", "control"].includes(proposal.toolName) ? describeToolInvocation({ toolName: proposal.toolName, toolInput: proposal.toolInput }) : null;
  if (descriptor?.capability === "patch") {
    for (const path of patchPaths(descriptor.semanticInput.patch)) {
      if (store.hostRootFor(run) !== run.root && !isAbsolute(path)) throw new GovernanceError("Split-root patches require absolute integration paths", "scope");
      const relativePath = await validateWritablePath(run.root, path, run.home);
      if (!proposal.writeSet.some((/** @type {string} */ scope) => pathContainedBy(relativePath, scope))) throw new GovernanceError("Patch path is outside the declared integration scope", "scope");
    }
  }
  if (run.taskKind === "audit" && (proposal.writeSet.length || ["writer-dispatch", "writer-return", "integrate", "integration-return"].includes(proposal.action))) throw new GovernanceError("Audit runs cannot dispatch writers or integrate changes", "task_kind");
  if (proposal.action === "host-tool") {
    const descriptor = describeToolInvocation({ toolName: proposal.toolName, toolInput: proposal.toolInput });
    if (proposal.route.role !== "coordinator" || proposal.writeSet.length || !descriptor || !["linear-read", "linear-write", "computer-use"].includes(descriptor.capability)) throw new GovernanceError("Host tool requires an exact supported coordinator adapter", "tool");
    if (!run.requiredCapabilities?.includes(descriptor.capability) || run.capabilityPreflight?.policyHash !== POLICY_HASH || !run.capabilityPreflight?.availableCapabilities.includes(descriptor.capability)) throw new GovernanceError("Host capability was not declared and observed before binding", "capability_missing", { field: "proposal.toolName", missingCapabilities: [descriptor.capability] });
  }
  if (proposal.actorId !== run.rootSessionId) throw new GovernanceError("only the observed coordinator may request a boundary");
  if (!proposal.requirementIds.length || new Set(proposal.requirementIds).size !== proposal.requirementIds.length || proposal.requirementIds.some((/** @type {string} */ id) => !run.criteria.some((/** @type {any} */ c) => c.id === id))) throw new GovernanceError("boundary requires unique known criteria");
  if (!proposal.sourceIds.length || proposal.sourceIds.some((/** @type {string} */ id) => !run.sources.some((/** @type {any} */ source) => source.id === id))) throw new GovernanceError("boundary requires known canonical sources");
  if (proposal.action === "inspect") {
    if (proposal.writeSet.length || proposal.route.role !== "coordinator" || !["Bash", "exec_command"].includes(proposal.toolName)) throw new GovernanceError("inspect is an exact coordinator read with empty write scope");
    const shell = describeToolInvocation({ toolName: proposal.toolName, toolInput: proposal.toolInput });
    assertObservedShellName(run, proposal.toolName);
    if ((shell.semanticInput.cwd ?? shell.semanticInput.workdir ?? store.hostRootFor(run)) !== run.root) throw new GovernanceError("Inspect requires the effective integration workdir", "tool");
    const argv = tokenizeExactCommand(shell.semanticInput.command ?? shell.semanticInput.cmd);
    if (!argv || !["cat", "pwd", "ls", "rg"].includes(argv[0])) throw new GovernanceError("inspect supports exact cat, pwd, ls or rg reads only");
    if (argv[0] === "pwd" && argv.length !== 1) throw new GovernanceError("inspect pwd takes no arguments");
    const flags = new Set(["-n", "-l", "-i", "-S", "--files", "--hidden", "-a", "-la", "-1"]);
    if (argv.slice(1).some((arg) => arg.startsWith("-") && !flags.has(arg))) throw new GovernanceError("inspect read flag is unsupported");
    const values = argv.slice(1).filter((arg) => !arg.startsWith("-"));
    const paths = argv[0] === "rg" && !argv.includes("--files") ? values.slice(1) : values;
    if (["cat", "rg"].includes(argv[0]) && !paths.length) throw new GovernanceError("inspect must declare bounded read paths");
    for (const path of paths) { assertRelativePath(path, "inspect path"); if (!proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(path, scope))) throw new GovernanceError("inspect path is outside its declared read scope"); }
  }
  if (DISPATCH_ACTIONS.includes(proposal.action)) {
    const launch = executionDescriptor(run, proposal);
    await store.readProcessRootIdentity(run, launch.candidateRoot, proposal.route.role);
    if (launch.assessment) await assessmentInput(store.runDirectoryFor(run.home, run.runId), run, launch.assessment);
  }
  const returnKinds = /** @type {Record<string,string>} */ ({ "research-return": "researcher", "plan-return": "planner", "plan-review-return": "plan-reviewer", "writer-return": "writer", "integration-return": "coordinator", "final-review-return": "reviewer", "verify-return": "verifier" });
  const expected = returnKinds[proposal.action];
  if (expected) {
    if (!proposal.dependsOn.length) throw new GovernanceError("return requires an actual completed attempt dependency");
    for (const id of proposal.dependsOn) {
      const attempt = attemptById(run, id);
      if (!attempt || attempt.status !== "completed" || !attempt.invocationObserved || attempt.role !== expected) throw new GovernanceError("return dependency lacks completed observed role output");
      if (attempt.process && !attempt.process.terminated) throw new GovernanceError("process termination is unobserved");
      if (["planner", "plan-reviewer", "reviewer", "verifier"].includes(expected) && !attempt.acceptanceId) throw new GovernanceError("return lacks designated acceptance output");
      if (attempt.acceptanceId) {
        const artifact = acceptanceArtifact(run, attempt);
        const kinds = /** @type {Record<string,string[]>} */ ({ planner: ["plan"], "plan-reviewer": ["plan-review"], reviewer: ["final-review"], verifier: ["verification", "observation-assessment"] });
        const artifactCriteria = artifact?.criterionIds ?? artifact?.results?.map((/** @type {any} */ result) => result.criterionId);
        const dispatch = boundaryById(run, attempt.boundaryId);
        if (!artifact || !kinds[expected]?.includes(artifact.kind) || artifact.source !== "process-output" || artifact.attemptId !== attempt.id || artifact.actorId !== attempt.actorId || artifact.sessionId !== attempt.sessionId || artifact.boundaryId !== attempt.boundaryId || artifact.role !== attempt.role || artifact.candidateHash !== attempt.candidateHash || !isStringArray(artifactCriteria) || !dispatch || stableHash([...artifactCriteria].sort()) !== stableHash([...dispatch.requirementIds].sort())) throw new GovernanceError("Return artifact is not bound to the completed designated producer", "identity");
        if (!await artifactCurrent(run, artifact) || artifact.verdict === "revise") throw new GovernanceError("return evidence is stale or requires correction");
      }
    }
  }
  if (["final-review", "verify", "close"].includes(proposal.action)) {
    for (const path of run.candidatePaths ?? []) if (!proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(path, scope))) throw new GovernanceError("acceptance scope omits an integrated candidate path");
    if (proposal.action !== "verify" && proposal.requirementIds.length !== run.criteria.length) throw new GovernanceError("acceptance must cover every criterion");
  }
  if (["plan-author", "plan-review"].includes(proposal.action) && proposal.requirementIds.length !== run.criteria.length) throw new GovernanceError("planning must cover every criterion");
  if (proposal.action === "plan-review" && !await artifactCurrent(run, run.plans.at(-1))) throw new GovernanceError("plan reviewer requires a current actual authored plan");
  if (proposal.action === "integrate" && !proposal.dependsOn.some((/** @type {string} */ id) => { const attempt = attemptById(run, id); return attempt?.role === "writer" && attempt.status === "completed"; })) throw new GovernanceError("integration requires a completed writer output dependency");
  if (proposal.action === "writer-dispatch") {
    const tickets = run.tickets.filter((/** @type {any} */ ticket) => run.criteria.some((/** @type {any} */ criterion) => criterion.ticketId === ticket.id && proposal.requirementIds.includes(criterion.id)));
    for (const ticket of tickets) for (const dependencyId of ticket.dependsOn) {
      const required = run.criteria.filter((/** @type {any} */ criterion) => criterion.ticketId === dependencyId).map((/** @type {any} */ criterion) => criterion.id);
      const covered = new Set();
      for (const attemptId of proposal.dependsOn) {
        const completed = attemptById(run, attemptId);
        if (!completed || completed.status !== "completed") continue;
        const boundary = boundaryById(run, completed.boundaryId);
        if (boundary.action !== "integrate") continue;
        for (const writerId of boundary.dependsOn) {
          const writer = attemptById(run, writerId);
          if (writer?.role === "writer" && writer.status === "completed") for (const criterionId of boundaryById(run, writer.boundaryId).requirementIds) covered.add(criterionId);
        }
      }
      if (required.some((/** @type {string} */ id) => !covered.has(id))) throw new GovernanceError("dependent ticket writer must name integrated predecessor outputs");
    }
  }
}

/** @param {any} run @param {any} attempt */
function acceptanceArtifact(run, attempt) {
  const matches = [...run.plans, ...run.reviews, ...run.verifications].filter((/** @type {any} */ entry) => entry.id === attempt.acceptanceId);
  return matches.length === 1 ? matches[0] : null;
}

/** Runtime-derived classification facts. Reading this projection does not create
 * a judgment, permit, actor or acceptance artifact.
 * @param {any} run @param {any} proposal */
export async function buildCompletedContext(run, proposal) {
  const plan = run.plans.at(-1) ?? null;
  /** @param {any} artifact */
  const provenance = async (artifact) => ({ id: artifact.id, kind: artifact.kind, attemptId: artifact.attemptId, actorId: artifact.actorId, sessionId: artifact.sessionId, boundaryId: artifact.boundaryId, role: artifact.role, candidateHash: artifact.candidateHash, source: artifact.source, current: await artifactCurrent(run, artifact), invalidated: artifact.invalidated === true, stamp: artifact.stamp });
  const plans = await Promise.all(run.plans.map(async (/** @type {any} */ entry) => ({ ...await provenance(entry), summary: entry.summary, criterionIds: entry.criterionIds, packets: entry.packets })));
  const reviews = await Promise.all(run.reviews.map(async (/** @type {any} */ review) => ({ ...await provenance(review), verdict: review.verdict, criterionIds: review.criterionIds, findings: review.findings, planId: review.planId })));
  const verifications = await Promise.all(run.verifications.map(async (/** @type {any} */ verification) => ({ ...await provenance(verification), command: verification.command, results: verification.results, manifestHash: verification.manifestHash, observationRefs: verification.observationRefs })));
  const declaredAttempts = run.attempts.filter((/** @type {any} */ attempt) => proposal.dependsOn.includes(attempt.id));
  const returnedArtifacts = declaredAttempts.flatMap((/** @type {any} */ attempt) => [...plans, ...reviews, ...verifications].filter((artifact) => artifact.id === attempt.acceptanceId && artifact.attemptId === attempt.id && artifact.actorId === attempt.actorId && artifact.sessionId === attempt.sessionId && artifact.boundaryId === attempt.boundaryId && artifact.role === attempt.role));
  let verificationDispatch = null;
  if (proposal.action === "verify") {
    const launch = executionDescriptor(run, proposal);
    if (launch.assessment) {
      const bundle = await assessmentInput(store.runDirectoryFor(run.home, run.runId), run, launch.assessment);
      verificationDispatch = { kind: "observation-assessment", designatedProfile: proposal.route, selectedCriterionIds: launch.assessment.criterionIds, bundle, observations: launch.assessment.observationIds.map((/** @type {string} */ id) => {
        const observation = run.observations.find((/** @type {any} */ item) => item.id === id);
        return { id, manifestHash: observation.manifestHash, candidateHash: observation.candidateHash, criterionIds: observation.criterionIds, result: observation.result, artifacts: observation.artifacts, source: observation.source };
      }), processContract: "Fresh independent observed Astra process receives the exact runtime bundle and every image as --image. Actual process identity, returned hashes and per-criterion outcomes are checked on return; host success is not criterion success." };
    } else verificationDispatch = { kind: "deterministic-check", designatedProfile: proposal.route, selectedCriterionIds: proposal.requirementIds, check: launch.check };
  }
  return {
    ...(proposal.action === "correct" ? { correctionState: await correctionState(run) } : {}),
    activeOwnership: activeAttempts(run).map((/** @type {any} */ attempt) => ({ id: attempt.id, status: attempt.status, role: attempt.role, provider: attempt.provider, readSet: attempt.readSet, writeSet: attempt.leasePaths })),
    capacity: run.capacity,
    dependencies: run.attempts.map((/** @type {any} */ attempt) => ({ id: attempt.id, status: attempt.status, role: attempt.role, boundaryId: attempt.boundaryId, acceptanceId: attempt.acceptanceId ?? null, candidateHash: attempt.candidateHash, executionKind: attempt.expectedProcess ? "attached-process" : "ordinary-host-tool", invocationObserved: attempt.invocationObserved === true, terminationObserved: attempt.expectedProcess ? attempt.process?.terminated === true : null, actorId: attempt.actorId, sessionId: attempt.sessionId, outputHash: attempt.outputHash, failureDiagnostic: safeAttemptDiagnostic(attempt), returnedObservation: attempt.returnedObservation ?? null })),
    actors: run.actors.map((/** @type {any} */ actor) => ({ id: actor.id, role: actor.role, sessionId: actor.sessionId, provider: actor.provider, model: actor.model, reasoning: actor.reasoning, provenance: actor.provenance })),
    plans,
    reviews,
    returnedArtifacts,
    verificationDispatch,
    findings: run.findings,
    verifications,
    planAuthorActorId: plan?.actorId ?? null,
    planAuthorSessionId: plan?.sessionId ?? null,
    ticketStatuses: run.tickets.map((/** @type {any} */ ticket) => ({ id: ticket.id, dependsOn: ticket.dependsOn, status: ticket.status })),
  };
}

/** Public diagnostics contain runtime-defined text and bounded typed fields,
 * never raw provider output or arbitrary exception text.
 * @param {any} attempt */
export function safeAttemptDiagnostic(attempt) {
  if (!attempt.failure && !attempt.failureDiagnostic) return null;
  const stored = attempt.failureDiagnostic;
  const code = ["malformed", "identity", "candidate", "scope", "observation_invalid", "observation_stale", "observation_missing"].includes(stored?.code) ? stored.code : attempt.failure === "review finding is malformed" ? "malformed" : "invalid";
  if (stored?.kind === "host-capture") return { kind: "host-capture", code, field: null,
    message: "The actual host output could not be retained as an observation.",
    nextAction: "Inspect status and correct the host capture before a fresh permitted invocation. For a closed blocked or interrupted run, use recover-host-attempt only if its ownership guards pass. Recovery does not import acceptance or prove absence of external effects.", rejectedOutput: null };
  if (stored?.kind === "host-reconciliation") return { kind: "host-reconciliation", code, field: null,
    message: "The actual host invocation failed runtime reconciliation.",
    nextAction: "Inspect the retained scope and ownership before correcting the host invocation. Preserve unresolved ownership; no acceptance was imported.", rejectedOutput: null };
  const field = typeof stored?.field === "string" && /^(?:review\.(?:kind|verdict|criterionIds|findings|resolvedFindingIds)(?:\[\d{1,3}\](?:\.(?:id|criterionIds|severity|message))?)?|process\.output)$/u.test(stored.field) ? stored.field : attempt.failure === "review finding is malformed" ? "review.findings" : null;
  const rejectedOutput = attempt.rejectedOutput && /^[a-f0-9]{64}$/u.test(attempt.rejectedOutput.sha256 ?? "") && /^rejected-outputs\/[a-f0-9]{64}\.txt$/u.test(attempt.rejectedOutput.relativePath ?? "") && Number.isSafeInteger(attempt.rejectedOutput.size) && attempt.rejectedOutput.size >= 0 && attempt.rejectedOutput.size <= 128 * 1024 ? { relativePath: attempt.rejectedOutput.relativePath, sha256: attempt.rejectedOutput.sha256, size: attempt.rejectedOutput.size } : null;
  return { code, field, message: code === "malformed" ? "The actual process result does not satisfy the designated output schema." : "The actual process result failed runtime reconciliation.",
    ...(field?.endsWith(".severity") ? { expectedValues: ["blocking", "blocker", "high", "medium", "low"] } : {}),
    nextAction: "Inspect the private rejected output and correct the identified input or schema through a fresh designated process. Preserve every actual finding; no acceptance was imported.", rejectedOutput };
}

/** Deterministic recovery facts describe readiness to propose a fresh attempt,
 * never permission to run it or an acceptance verdict.
 * @param {any} run */
async function correctionState(run) {
  const active = activeAttempts(run), leaseOwners = [...new Set(Object.values(run.leases))];
  const prerequisites = run.taskKind === "audit" && run.phase === "final-review" ? ["plan-review-pass"] : /** @type {Record<string,readonly string[]>} */ (PHASE_PREREQUISITES)[run.phase] ?? [];
  const prerequisiteResults = await Promise.all(prerequisites.map(async (kind) => ({ kind, satisfied: await prerequisiteSatisfied(run, kind) })));
  const allowedActions = ACTIONS.filter((action) => phaseActionAllowed(run.phase, action) && !(run.taskKind === "audit" && ["writer-dispatch", "writer-return", "integrate", "integration-return"].includes(action)));
  const failedAttempts = run.attempts.filter((/** @type {any} */ attempt) => attempt.status === "failed" && boundaryById(run, attempt.boundaryId)?.phase === run.phase).map((/** @type {any} */ attempt) => ({ id: attempt.id, boundaryId: attempt.boundaryId, role: attempt.role, acceptanceId: attempt.acceptanceId ?? null, invocationObserved: attempt.invocationObserved === true, terminationObserved: attempt.process?.terminated === true, exitCode: Number.isSafeInteger(attempt.process?.exitCode) ? attempt.process.exitCode : null, identityObserved: Boolean(attempt.observed && !attempt.identityMismatch), failureDiagnostic: safeAttemptDiagnostic(attempt), leaseRetained: leaseOwners.includes(attempt.id) }));
  const prerequisitePass = prerequisiteResults.every((entry) => entry.satisfied);
  return { phase: run.phase, allowedActions, correctionAllowed: allowedActions.includes("correct"), activeAttemptIds: active.map((/** @type {any} */ attempt) => attempt.id), leaseOwners, prerequisites: prerequisiteResults, failedAttempts,
    retryEligibleAttemptIds: !active.length && !leaseOwners.length && prerequisitePass ? failedAttempts.filter((/** @type {any} */ attempt) => attempt.invocationObserved && attempt.terminationObserved && attempt.identityObserved && !attempt.leaseRetained).map((/** @type {any} */ attempt) => attempt.id) : [],
    acceptanceImported: false, executionPermissionGranted: false };
}

/** @param {any} run @param {string} action */
function completedForAction(run, action) {
  if (action === "final-review") return run.reviews.some((/** @type {any} */ review) => review.kind === "final-review");
  if (action === "verify") return run.verifications.length > 0;
  if (action === "plan-review") return run.reviews.some((/** @type {any} */ review) => review.kind === "plan-review");
  return false;
}

/** @param {any} run @param {any} boundary @param {any} result */
function judgmentRecord(run, boundary, result) {
  return {
    id: `judgment_${stableHash({ runId: run.runId, boundaryId: boundary.id, inputHash: result.inputHash, policyHash: POLICY_HASH }).slice(0, 32)}`,
    runId: run.runId,
    boundaryId: boundary.id,
    action: boundary.action,
    phase: boundary.phase,
    proposal: proposalFingerprint(boundary),
    inputHash: result.inputHash,
    policyHash: POLICY_HASH,
    modelObserved: result.model ?? null,
    requestHash: result.requestHash ?? null,
    usage: result.usage ?? null,
    obligations: result.obligations,
    route: result.route ?? null,
    priority: result.priority ?? null,
    toolChoice: result.toolChoice ?? null,
    blockers: result.blockers,
    verdict: result.verdict,
    reason: result.reason,
    transport: result.transport ?? "not_evaluated",
    transportAttempted: result.transportAttempted ?? ["live", "injected"].includes(result.transport),
    code: result.code ?? null,
    createdAt: nowIso(),
  };
}

/** @param {any} run @param {any} boundary @param {any} judgment */
function attachJudgment(run, boundary, judgment) {
  run.judgments.push(judgment);
  boundary.judgmentId = judgment.id;
  boundary.verdict = judgment.verdict;
}

/**
 * @param {any} run
 * @param {any} proposal
 * @param {any} result
 * @param {string} transport
 */
function buildJudgmentOutcome(run, proposal, result, transport) {
  const obligations = result.obligations;
  const blockers = [];
  if (obligations.some((/** @type {any} */ entry) => entry.outcome !== "satisfied")) {
    for (const entry of obligations) if (entry.outcome !== "satisfied") blockers.push(`obligation:${entry.id}:${entry.outcome}`);
  }
  if (result.route && result.route.choice !== proposal.route.role) blockers.push(`route:${result.route.choice}`);
  if (result.tool && result.tool.choice !== "compliant") blockers.push(`tool:${result.tool.choice}`);
  if (result.priority && result.priority.choice !== "execute_now") blockers.push(`priority:${result.priority.choice}`);
  for (const dependency of proposal.dependsOn) {
    const attempt = run.attempts.find((/** @type {any} */ entry) => entry.id === dependency);
    const boundary = boundaryById(run, dependency);
    const resolved = attempt ? attempt.status === "completed" : Boolean(boundary && passingJudgment(run, boundary.id));
    if (!resolved) blockers.push(`dependency:${dependency}`);
  }
  return {
    obligations,
    route: result.route ?? null,
    priority: result.priority ?? null,
    toolChoice: result.tool?.choice ?? null,
    usage: result.usage ?? null,
    model: result.model ?? null,
    requestHash: result.requestHash ?? null,
    verdict: blockers.length === 0 ? "pass" : "insufficient",
    reason: blockers.length === 0 ? "all required obligations satisfied" : `unresolved: ${[...new Set(blockers)].join(", ")}`,
    blockers: [...new Set(blockers)],
    transport,
  };
}

/** @param {any} run @param {any} proposal @param {string} reason */
function insufficientObligations(run, proposal, reason) {
  return {
    obligations: requiredObligations(proposal.action, { completed: completedForAction(run, proposal.action) }).map((/** @type {string} */ id) => ({ id, outcome: "insufficient_evidence", evidenceRefs: [] })),
    route: null,
    priority: null,
    toolChoice: null,
    usage: null,
    model: null,
    requestHash: null,
    verdict: "insufficient",
    reason,
    blockers: [`insufficient:${reason}`],
    transport: "not_evaluated",
    transportAttempted: false,
  };
}

/**
 * @param {any} run
 * @param {any} proposal
 * @param {{transport?: Function, home?: string, env?: Record<string,string|undefined>, timeoutMs?: number}} [options]
 */
async function classifyProposal(run, proposal, options) {
  if (run.phase === "closed") throw new GovernanceError("run is closed", "closed");
  if (!phaseActionAllowed(run.phase, proposal.action)) throw new GovernanceError(`action ${proposal.action} is not compatible with phase ${run.phase}`, "phase");
  if (proposal.phase !== run.phase) throw new GovernanceError(`proposal.phase must equal the current phase ${run.phase}`, "phase");
  const candidates = /** @type {Record<string, readonly string[]>} */ (ROUTE_CANDIDATES)[proposal.action] ?? [];
  if (candidates.length === 0) throw new GovernanceError(`action ${proposal.action} has no route candidates`, "route");
  if (!candidates.includes(proposal.route.role)) throw new GovernanceError(`role ${proposal.route.role} is not a candidate for ${proposal.action}`, "route");
  if (!run.actors.some((/** @type {any} */ actor) => actor.id === proposal.actorId)) {
    throw new GovernanceError(`proposal.actorId ${proposal.actorId} is not a registered actor`, "actor");
  }
  const completed = completedForAction(run, proposal.action);
  const obligations = requiredObligations(proposal.action, { completed });

  // Deterministic profile and dispatch-argument checks happen before the network call.
  const profile = profileFor(proposal.route.role, proposal.route, run.coordinator);
  if (!profile.ok) {
    return { result: { ...insufficientObligations(run, proposal, profile.reason), code: "route" }, transport: "not_evaluated" };
  }
  try { await assertBoundarySemantics(run, proposal); }
  catch (error) { return { result: { ...insufficientObligations(run, proposal, error instanceof GovernanceError ? error.message : "Boundary semantics are invalid"), code: error instanceof GovernanceError ? error.code : "invalid" }, transport: "not_evaluated" }; }

  let input;
  try {
    input = await computeBoundaryInput(run, proposal);
  } catch (error) {
    return { result: { ...insufficientObligations(run, proposal, "Boundary inputs are unavailable"), code: error instanceof GovernanceError ? error.code : "invalid" }, transport: "not_evaluated" };
  }

  const classification = await classifyWithJev({
    run,
    proposal,
    obligations,
    candidates,
    completed: await buildCompletedContext(run, proposal),
    home: options?.home,
    env: options?.env,
    transport: /** @type {any} */ (options?.transport),
    timeoutMs: options?.timeoutMs,
  });
  if (!classification.ok) {
    const transport = classification.transportAttempted ? options?.transport ? "injected" : "live" : "not_evaluated";
    return { result: { ...insufficientObligations(run, proposal, classification.reason), transport, transportAttempted: classification.transportAttempted, code: classification.code }, input, transport };
  }
  const outcome = buildJudgmentOutcome(run, proposal, classification, options?.transport ? "injected" : "live");
  return { result: outcome, input, transport: options?.transport ? "injected" : "live" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Normalize an adapter observation (snake_case or camelCase) to the stored shape.
 * @param {unknown} event */
function normalizeObservation(event) {
  if (!isRecord(event)) throw new GovernanceError("event must be an object");
  return {
    kind: event.kind ?? "session",
    sessionId: event.sessionId ?? event.session_id,
    model: event.model,
    reasoning: event.reasoning ?? null,
    cwd: event.cwd,
    transcriptPath: event.transcriptPath ?? event.transcript_path,
    observedAt: event.observedAt ?? event.observed_at ?? nowIso(),
  };
}

/** @param {{home?: string, event: unknown}} input */
export async function registerHostSession(input) {
  const home = store.resolveHome(input.home);
  const observation = validateObservation(normalizeObservation(input.event), "event");
  /** @param {any} prior */
  const matches = (prior) => prior && prior.sessionId === observation.sessionId && prior.cwd === observation.cwd && prior.model === observation.model
    && prior.reasoning === observation.reasoning && prior.transcriptPath === observation.transcriptPath;
  // A validated snapshot is sufficient for the common unchanged hook event.
  // A changed identity still needs the lock and a second read to avoid losing
  // another session's concurrent registration.
  const snapshot = await store.readRegistry(home);
  if (matches(snapshot.sessions[observation.sessionId])) return snapshot.sessions[observation.sessionId];
  let stored = observation;
  await store.withHomeLock(home, async () => {
    const registry = await store.readRegistry(home);
    const prior = registry.sessions[observation.sessionId];
    if (matches(prior)) { stored = prior; return; }
    registry.sessions[observation.sessionId] = observation;
    await store.writeRegistry(home, registry);
  });
  return stored;
}

/** Read the stored host observation for a session; never invents identity.
 * @param {{home?: string, sessionId: string}} input */
export async function getHostSession(input) {
  const home = store.resolveHome(input.home);
  return store.readSessionObservation(home, input.sessionId);
}

/** @param {string} home @param {string} sessionId @param {{includeFinished?:boolean}} [options] */
export async function resolveRunDirectory(home, sessionId, options = {}) {
  return store.registryRunDirectory(store.resolveHome(home), sessionId, options);
}

/**
 * @param {{home?: string, contract: unknown, activation: unknown}} input
 */
export async function createRun(input) {
  const home = store.resolveHome(input.home);
  const preflight = await preflightRun(input);
  if (!preflight.ok) throw new GovernanceError("Required host capabilities have no current successful observed invocation", "capability_missing", { field: "contract.requiredCapabilities", missingCapabilities: preflight.missingCapabilities });
  const contract = validateContract(input.contract, { endpoint: JEV_ENDPOINT });
  const root = contract.root, hostRoot = contract.hostRoot;
  const rootIdentity = await store.readRootIdentity(contract);
  const observation = await store.readSessionObservation(home, isRecord(input.activation) ? String(input.activation.sessionId ?? "") : "");
  if (!observation) throw new GovernanceError("activation requires a stored host observation; register the session first", "activation");
  validateActivation(input.activation, /** @type {any} */ (observation));
  if (await store.canonicalDirectory(observation.cwd) !== hostRoot) throw new GovernanceError("contract hostRoot does not match the actual observed session root", "activation");
  const baseSha = await store.readGitHead(root);
  if (baseSha !== contract.baseSha) throw new GovernanceError("contract.baseSha must match the current Git HEAD", "base");

  /** @type {Array<any>} */
  const sources = [];
  for (const source of contract.sources) {
    const file = await store.hashRegularFile(root, source.path);
    sources.push({ id: source.id, path: source.path, kind: source.kind, sha256: file.sha256, size: file.size, mode: file.mode });
  }

  const runId = contract.id;
  const runDirectory = store.runDirectoryFor(home, runId);
  const coordinator = {
    actorId: observation.sessionId,
    role: "coordinator",
    provider: providerOf(observation.model),
    model: observation.model,
    reasoning: observation.reasoning,
    sessionId: observation.sessionId,
    transcriptPath: observation.transcriptPath,
  };
  const run = {
    schemaVersion: store.RUN_SCHEMA_VERSION,
    taskKind: contract.taskKind,
    requiredCapabilities: contract.requiredCapabilities,
    capabilityPreflight: preflight,
    policyHash: POLICY_HASH,
    observations: [],
    runId,
    home,
    root,
    hostRoot,
    rootIdentity,
    baseSha,
    rootSessionId: observation.sessionId,
    coordinator,
    authorization: contract.authorization,
    endpoint: contract.endpoint,
    phase: "intake",
    outcome: null,
    sources,
    criteria: contract.criteria.map((/** @type {any} */ criterion) => ({ ...criterion })),
    tickets: contract.tickets.map((/** @type {any} */ ticket) => ({ id: ticket.id, dependsOn: [...ticket.dependsOn], status: "open" })),
    capacity: contract.capacity,
    actors: [{
      id: coordinator.actorId,
      role: "coordinator",
      provider: coordinator.provider,
      model: coordinator.model,
      reasoning: coordinator.reasoning,
      sessionId: coordinator.sessionId,
      parentActorId: null,
      capabilities: [],
      provenance: "host-observation",
      status: "active",
    }],
    attempts: [],
    boundaries: [],
    judgments: [],
    permits: [],
    evidence: [],
    findings: [],
    reviews: [],
    verifications: [],
    plans: [],
    childSessions: {},
    eventKeys: {},
    leases: {},
    revision: 0,
    candidatePaths: [],
    acceptanceEpoch: 0,
    coordinatorIdentityEpoch: 0,
    pendingCoordinatorEffortTransition: null,
    coordinatorEffortReceipts: [],
    effortControlInvocations: [],
  };

  await store.withHomeLock(home, async () => {
    const registry = await store.readRegistry(home);
    await store.assertRunRoots(run);
    await store.assertRootsAvailable(home, [root, hostRoot], { sessionId: observation.sessionId });
    const currentPreflight = await capabilityPreflight(registry, contract, observation);
    if (!currentPreflight.ok) throw new GovernanceError("Required capabilities changed before binding", "capability_missing", { field: "contract.requiredCapabilities", missingCapabilities: currentPreflight.missingCapabilities });
    if (registry.runs[runId] || await store.pathExists(store.runSnapshotPath(runDirectory))) throw new GovernanceError("run id already exists; published run history cannot be replaced", "binding");
    await store.saveRun(runDirectory, run);
    registry.runs[runId] = { runId, runDirectory, rootSessionId: observation.sessionId, root, hostRoot, finished: false };
    await store.writeRegistry(home, registry);
  });
  return run;
}

/**
 * @param {{runDirectory: string, proposal: unknown, transport?: Function, home?: string, env?: Record<string,string|undefined>, timeoutMs?: number}} input
 */
export async function classifyBoundary(input) {
  const run = await store.loadRun(input.runDirectory);
  if (run.pendingCoordinatorEffortTransition) throw new GovernanceError("coordinator effort confirmation is pending", "effort_pending");
  const proposal = validateProposal(input.proposal);
  const { result, input: computed, transport } = await classifyProposal(run, proposal, {
    transport: input.transport,
    home: input.home,
    env: input.env,
    timeoutMs: input.timeoutMs,
  });
  return mutateRun(input.runDirectory, async (fresh) => {
    if (fresh.phase !== proposal.phase || fresh.permits.some((/** @type {any} */ permit) => permit.boundaryId === proposal.id && permit.status !== "prepared")) throw new GovernanceError("used boundary ids are immutable; propose a new boundary", "stale");
    if (computed && computed.inputHash !== (await computeBoundaryInput(fresh, proposal)).inputHash) throw new GovernanceError("boundary changed during classification", "stale");
    const boundary = {
      ...proposalFingerprint(proposal),
      runId: fresh.runId,
      candidateHash: computed?.candidateHash ?? null,
      rootIdentity: computed?.rootIdentity ?? null,
      scopeHash: computed?.scopeHash ?? null,
      dependencyHashes: computed?.dependencyHashes ?? null,
      sourceHashes: computed?.sourceHashes ?? null,
      inputHash: computed?.inputHash ?? stableHash({ proposal: proposalFingerprint(proposal), policyHash: POLICY_HASH }),
      judgmentId: null,
      verdict: null,
      createdAt: nowIso(),
    };
    const existing = boundaryById(fresh, proposal.id);
    if (existing) Object.assign(existing, boundary);
    else fresh.boundaries.push(boundary);
    const target = boundaryById(fresh, proposal.id);
    const record = judgmentRecord(fresh, target, { ...result, inputHash: target.inputHash });
    attachJudgment(fresh, target, record);
    return record;
  });
}

/**
 * @param {{runDirectory: string, boundaryId: string, action: unknown}} input
 */
export async function prepareAction(input) {
  const action = validateAction(input.action);
  return mutateRun(input.runDirectory, async (run) => {
    if (run.pendingCoordinatorEffortTransition) throw new GovernanceError("coordinator effort confirmation is pending", "effort_pending");
    const boundary = boundaryById(run, input.boundaryId);
    if (!boundary) throw new GovernanceError("boundary does not exist", "missing");
    const judgment = passingJudgment(run, boundary.id);
    if (!judgment) throw new GovernanceError("boundary has no current passing judgment", "judgment");
    if (action.toolName !== boundary.toolName || stableHash(action.toolInput) !== stableHash(boundary.toolInput)) {
      throw new GovernanceError("action tool name and input must match the classified proposal", "tool");
    }
    if (action.actorId !== boundary.actorId) throw new GovernanceError("action actor must match the classified proposal actor", "actor");
    if (action.attemptId !== boundary.attemptId) throw new GovernanceError("action attempt must match the classified attempt", "attempt");
    if (action.attemptId && (run.attempts.some((/** @type {any} */ attempt) => attempt.id === action.attemptId) || run.permits.some((/** @type {any} */ permit) => permit.attemptId === action.attemptId))) throw new GovernanceError("attempt id is already reserved; it cannot be rebound", "attempt");
    if (["governance", "control"].includes(boundary.toolName)) throw new GovernanceError("control judgments are not tool permits", "tool");
    await assertBoundarySemantics(run, boundary);

    const current = await computeBoundaryInput(run, boundary);
    if (current.inputHash !== judgment.inputHash) throw new GovernanceError("boundary inputs changed; classify a fresh proposal", "stale");

    const adapter = boundary.action === "host-tool" ? describeToolInvocation({ toolName: action.toolName, toolInput: action.toolInput }) : null;
    assertExternalSerialization(run, adapter);
    const overlap = findOverlap(run, boundary.writeSet, boundary.readSet, null);
    if (overlap) throw new GovernanceError(`scope overlaps active attempt ${overlap}`, "overlap");
    assertCapacity(run, boundary.route.provider);

    const attemptId = action.attemptId ?? `attempt_${stableHash({ boundaryId: boundary.id, actorId: action.actorId, toolName: action.toolName, toolInputHash: stableHash(action.toolInput) }).slice(0, 24)}`;
    if (run.attempts.some((/** @type {any} */ attempt) => attempt.id === attemptId) || run.permits.some((/** @type {any} */ permit) => permit.attemptId === attemptId)) throw new GovernanceError("attempt id is already reserved; it cannot be rebound", "attempt");
    const permit = {
      id: `permit_${stableHash({ runId: run.runId, boundaryId: boundary.id, judgmentId: judgment.id, actorId: action.actorId, attemptId, toolInputHash: stableHash(action.toolInput), scopeHash: current.scopeHash }).slice(0, 32)}`,
      runId: run.runId,
      boundaryId: boundary.id,
      judgmentId: judgment.id,
      actorId: action.actorId,
      attemptId,
      role: boundary.route.role,
      provider: boundary.route.provider,
      model: boundary.route.model,
      reasoning: boundary.route.reasoning,
      adapter,
      toolName: action.toolName,
      toolInput: action.toolInput,
      toolInputHash: stableHash(action.toolInput),
      scopeHash: current.scopeHash,
      inputHash: current.inputHash,
      dependencyHashes: current.dependencyHashes,
      candidateHash: current.candidateHash,
      rootIdentity: current.rootIdentity,
      capabilityHash: stableHash({ role: boundary.route.role, model: boundary.route.model, reasoning: boundary.route.reasoning, capabilities: boundary.route.capabilities }),
      status: "prepared",
      invocation: null,
      plannedAttempt: { attemptId, role: boundary.route.role, provider: boundary.route.provider, model: boundary.route.model, reasoning: boundary.route.reasoning, candidateHash: current.candidateHash },
      createdAt: nowIso(),
    };
    run.permits.push(permit);
    return permit;
  });
}

/**
 * @param {{home?: string, preToolEvent: unknown}} input
 */
export async function authorizeAction(input) {
  const event = validatePreToolEvent(input.preToolEvent);
  const home = store.resolveHome(input.home);
  const runDirectory = await store.registryRunDirectory(home, event.sessionId);
  if (!runDirectory) return { decision: "allow", reason: "session is not governed", permitId: null };
  return mutateRun(runDirectory, async (run) => {
    if (run.pendingCoordinatorEffortTransition) return { decision: "deny", reason: "coordinator effort confirmation is pending", permitId: null };
    if (run.phase === "closed") return { decision: "deny", reason: "run is closed", permitId: null };
    const toolInputHash = stableHash(event.toolInput);
    if (event.sessionId !== run.rootSessionId) return { decision: "deny", reason: "native child governance is unsupported", permitId: null };
    if (!event.turnId || !event.toolUseId) return { decision: "deny", reason: "actual turn and tool-use identity required", permitId: null };
    const observedModel = event.model;
    if (!observedModel) return { decision: "deny", reason: "unknown event model cannot be authorized", permitId: null };
    const matching = run.permits.filter((/** @type {any} */ permit) => permit.toolName === event.toolName && permit.toolInputHash === toolInputHash && permit.actorId === event.sessionId);
    const prepared = matching.find((/** @type {any} */ permit) => permit.status === "prepared");
    if (!prepared) {
      const consumed = matching.find((/** @type {any} */ permit) => permit.status === "consumed" || permit.status === "completed");
      return { decision: "deny", reason: consumed ? "permit already consumed; one-shot replay denied" : "no current permit for this exact tool input", permitId: consumed?.id ?? null };
    }
    if (event.sessionId === run.rootSessionId && (observedModel !== run.coordinator.model || event.reasoning !== run.coordinator.reasoning || !event.cwd || await store.canonicalDirectory(event.cwd) !== store.hostRootFor(run))) {
      return { decision: "deny", reason: "root event model does not match the observed coordinator", permitId: prepared.id };
    }
    if (prepared.actorId !== run.rootSessionId && !run.childSessions[event.sessionId]) {
      return { decision: "deny", reason: "native child attribution is unproven; writable permit denied", permitId: prepared.id };
    }

    const boundary = boundaryById(run, prepared.boundaryId);
    if (boundary.phase !== run.phase) return { decision: "deny", reason: "permit phase is no longer current", permitId: prepared.id };
    let recomputed, launch = null, launchIdentity = null;
    try {
      await assertBoundarySemantics(run, boundary);
      recomputed = await computeBoundaryInput(run, boundary);
      launch = DISPATCH_ACTIONS.includes(boundary.action) ? executionDescriptor(run, boundary) : null;
      if (launch) {
        launchIdentity = await store.readProcessRootIdentity(run, launch.candidateRoot, boundary.route.role);
        await store.assertRootsAvailable(home, [launch.candidateRoot], { runId: run.runId, attemptId: prepared.attemptId });
      }
    } catch {
      prepared.status = "failed";
      return { decision: "deny", reason: "Root identity, scope or workspace ownership changed before consumption", permitId: prepared.id };
    }
    if (recomputed.inputHash !== prepared.inputHash) {
      prepared.status = "failed";
      return { decision: "deny", reason: "boundary inputs changed before consumption; permit invalidated", permitId: prepared.id };
    }
    const overlap = findOverlap(run, boundary.writeSet, boundary.readSet, prepared.attemptId);
    if (overlap) {
      prepared.status = "failed";
      return { decision: "deny", reason: `scope overlaps active attempt ${overlap}`, permitId: prepared.id };
    }
    try {
      assertExternalSerialization(run, prepared.adapter);
      assertCapacity(run, prepared.provider);
    } catch {
      prepared.status = "failed";
      return { decision: "deny", reason: "provider capacity is exhausted", permitId: prepared.id };
    }

    if (run.permits.some((/** @type {any} */ permit) => permit.invocation?.sessionId === event.sessionId && permit.invocation.turnId === event.turnId && permit.invocation.toolUseId === event.toolUseId)) return { decision: "deny", reason: "host invocation already consumed", permitId: prepared.id };
    prepared.status = "consumed";
    prepared.invocation = { sessionId: event.sessionId, turnId: event.turnId, toolUseId: event.toolUseId, model: event.model, reasoning: event.reasoning, cwd: event.cwd, rawToolName: event.toolName, rawToolInput: event.toolInput, policyHash: POLICY_HASH, at: nowIso() };

    const attempt = {
      id: prepared.attemptId,
      runId: run.runId,
      boundaryId: prepared.boundaryId,
      actorId: DISPATCH_ACTIONS.includes(boundary.action) ? null : prepared.actorId,
      callerActorId: prepared.actorId,
      role: prepared.role,
      provider: prepared.provider,
      model: prepared.model,
      reasoning: prepared.reasoning,
      sessionId: DISPATCH_ACTIONS.includes(boundary.action) ? null : event.sessionId,
      adapter: prepared.adapter ?? null,
      expectedProcess: DISPATCH_ACTIONS.includes(boundary.action),
      launch,
      launchIdentity,
      status: "running",
      leasePaths: [...boundary.writeSet],
      writeSet: [...boundary.writeSet],
      readSet: [...boundary.readSet],
      invocation: prepared.invocation,
      process: null,
      observed: null,
      candidateHash: prepared.candidateHash,
      outputHash: null,
      changedPaths: [],
      identityMismatch: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (run.attempts.some((/** @type {any} */ entry) => entry.id === attempt.id)) throw new GovernanceError("attempt reuse is forbidden");
    run.attempts.push(attempt);
    for (const path of boundary.writeSet) run.leases[path] = attempt.id;
    return { decision: "allow", reason: "permit consumed", permitId: prepared.id, attemptId: attempt.id };
  });
}

/** @param {any} value */
function extractAcceptanceJson(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/u.exec(value.trim());
  if (fenced) value = fenced[1];
  try {
    const parsed = JSON.parse(value);
    if (isRecord(parsed) && typeof parsed.kind === "string") return parsed;
  } catch {
    // fall through to line scan
  }
  for (const line of value.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed) && typeof parsed.kind === "string") return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

/** @param {any} run @param {any} attempt */
function assertReviewerIndependence(run, attempt) {
  if (attempt.role === "plan-reviewer") {
    const plan = run.plans.at(-1);
    if (plan && (plan.actorId === attempt.actorId || plan.sessionId === attempt.sessionId)) {
      throw new GovernanceError("plan reviewer must differ from the plan author", "independence");
    }
  }
  if (attempt.role === "reviewer") {
    const implementers = run.attempts.filter((/** @type {any} */ entry) => entry.role === "writer").map((/** @type {any} */ entry) => entry.actorId);
    if (implementers.includes(attempt.actorId)) throw new GovernanceError("implementer cannot certify its own review", "independence");
  }
}

/**
 * @param {any} run @param {any} attempt @param {any} parsed
 */
async function ingestOutput(run, attempt, parsed) {
  const boundary = boundaryById(run, attempt.boundaryId);
  if (!boundary) throw new GovernanceError("attempt has no boundary", "missing");
  if (!attempt.actorId || !attempt.sessionId || !attempt.observed || attempt.identityMismatch || !attempt.process?.terminated) throw new GovernanceError("acceptance requires a designated observed completed process", "identity");
  const coverage = (/** @type {any} */ ids) => isStringArray(ids) && ids.length === boundary.requirementIds.length && new Set(ids).size === ids.length && ids.every((/** @type {string} */ id) => boundary.requirementIds.includes(id));
  if (attempt.candidateHash && boundary.candidateHash && attempt.candidateHash !== boundary.candidateHash) {
    throw new GovernanceError("output candidate does not match the registered boundary", "candidate");
  }
  const provenance = { attemptId: attempt.id, actorId: attempt.actorId, sessionId: attempt.sessionId, boundaryId: attempt.boundaryId, role: attempt.role, candidateHash: attempt.candidateHash, processId: attempt.process.processId, command: attempt.process.command, candidateRoot: attempt.process.candidateRoot };
  if (parsed.kind === "plan") {
    if (attempt.role !== "planner") throw new GovernanceError("plan output requires a registered planner", "role");
    if (Object.keys(parsed).some((key) => !["kind", "summary", "criterionIds", "packets"].includes(key)) || !isNonEmpty(parsed.summary) || !coverage(parsed.criterionIds) || !Array.isArray(parsed.packets) || !parsed.packets.length) throw new GovernanceError("plan output must cover every declared criterion", "malformed");
    const packetIds = new Set();
    for (const packet of parsed.packets) {
      if (!isRecord(packet) || Object.keys(packet).some((key) => !["id", "readSet", "writeSet", "dependsOn"].includes(key)) || !isNonEmpty(packet.id) || packetIds.has(packet.id) || !isStringArray(packet.readSet) || !isStringArray(packet.writeSet) || !isStringArray(packet.dependsOn)) throw new GovernanceError("plan packet is malformed");
      packetIds.add(packet.id);
      for (const path of [...packet.readSet, ...packet.writeSet]) assertRelativePath(path, "plan packet path");
    }
    const known = new Set(run.criteria.map((/** @type {any} */ criterion) => criterion.id));
    if (parsed.criterionIds.some((/** @type {string} */ id) => !known.has(id))) throw new GovernanceError("plan references unknown criteria", "malformed");
    const plan = { id: newId("plan"), kind: "plan", runId: run.runId, ...provenance, summary: parsed.summary.trim(), criterionIds: [...parsed.criterionIds], packets: parsed.packets, stamp: await acceptanceStamp(run, attempt, "plan"), source: "process-output", createdAt: nowIso() };
    run.plans.push(plan);
    attempt.acceptanceId = plan.id;
    return { kind: "plan", id: plan.id };
  }
  if (parsed.kind === "review") {
    if (!["plan-reviewer", "reviewer"].includes(attempt.role)) throw new GovernanceError("review output requires a registered reviewer", "role");
    if (Object.keys(parsed).some((key) => !["kind", "verdict", "findings", "criterionIds", "resolvedFindingIds"].includes(key)) || !["pass", "revise"].includes(parsed.verdict) || !Array.isArray(parsed.findings) || !coverage(parsed.criterionIds)) throw new GovernanceError("review output must cover the exact declared criteria", "malformed");
    assertReviewerIndependence(run, attempt);
    const kind = attempt.role === "plan-reviewer" ? "plan-review" : "final-review";
    const findings = parsed.findings.map((/** @type {any} */ finding, /** @type {number} */ index) => {
      const field = `review.findings[${index}]`;
      if (!isRecord(finding)) throw new GovernanceError("Review finding must be an object", "malformed", { field });
      if (!isNonEmpty(finding.id)) throw new GovernanceError("Review finding requires an identifier", "malformed", { field: `${field}.id` });
      if (!isStringArray(finding.criterionIds) || !finding.criterionIds.length || finding.criterionIds.some((/** @type {string} */ id) => !boundary.requirementIds.includes(id))) throw new GovernanceError("Review finding requires selected criterion identifiers", "malformed", { field: `${field}.criterionIds` });
      if (!["blocking", "blocker", "high", "medium", "low"].includes(finding.severity)) throw new GovernanceError("Review finding severity is outside the designated enum", "malformed", { field: `${field}.severity` });
      if (!isNonEmpty(finding.message)) throw new GovernanceError("Review finding requires a message", "malformed", { field: `${field}.message` });
      return { id: finding.id, criterionIds: [...finding.criterionIds], severity: finding.severity, message: finding.message, gating: ["blocking", "blocker", "high"].includes(finding.severity) };
    });
    if (new Set(findings.map((/** @type {any} */ finding) => finding.id)).size !== findings.length || (parsed.verdict === "pass" && findings.some((/** @type {any} */ finding) => finding.gating))) throw new GovernanceError("review verdict contradicts its findings");
    const resolvedIds = parsed.resolvedFindingIds ?? [];
    if (!isStringArray(resolvedIds) || (resolvedIds.length && parsed.verdict !== "pass")) throw new GovernanceError("resolution requires an explicit passing independent review");
    for (const id of resolvedIds) {
      const finding = run.findings.find((/** @type {any} */ entry) => entry.id === id && !entry.resolved);
      if (!finding || finding.criterionIds.some((/** @type {string} */ criterion) => !boundary.requirementIds.includes(criterion))) throw new GovernanceError("finding resolution omits affected criteria");
    }
    const review = { id: newId("review"), runId: run.runId, kind, ...provenance, verdict: parsed.verdict, criterionIds: [...parsed.criterionIds], findings: findings.map((/** @type {any} */ finding) => finding.id), stamp: await acceptanceStamp(run, attempt, kind), planId: kind === "plan-review" ? run.plans.at(-1)?.id : null, source: "process-output", createdAt: nowIso() };
    if (kind === "plan-review" && !review.planId) throw new GovernanceError("plan review has no observed plan");
    run.reviews.push(review);
    attempt.acceptanceId = review.id;
    for (const finding of findings) run.findings.push({ id: finding.id, runId: run.runId, reviewId: review.id, criterionIds: finding.criterionIds, severity: finding.severity, message: finding.message, gating: finding.gating, resolved: false, createdAt: nowIso() });
    for (const id of resolvedIds) { const finding = run.findings.find((/** @type {any} */ entry) => entry.id === id && !entry.resolved); finding.resolved = true; finding.resolvedByReviewId = review.id; }
    return { kind: "review", id: review.id, verdict: review.verdict };
  }
  if (parsed.kind === "observation-assessment") {
    if (attempt.role !== "verifier" || !sameProvider(attempt.provider, "codex") || attempt.model !== "gpt-6-astra" || attempt.reasoning !== "xhigh" || !attempt.launch.assessment || !attempt.processBinding?.assessment) throw new GovernanceError("Observation assessment requires the designated independent Astra process", "role");
    if (attempt.sessionId === run.rootSessionId || run.attempts.some((/** @type {any} */ item) => item.id !== attempt.id && ["planner", "writer", "reviewer", "plan-reviewer"].includes(item.role) && (item.actorId === attempt.actorId || item.sessionId === attempt.sessionId))) throw new GovernanceError("Observation assessor must be fresh and independent", "independence");
    const current = await assessmentInput(store.runDirectoryFor(run.home, run.runId), run, attempt.launch.assessment);
    const supplied = attempt.processBinding.assessment;
    if (stableHash(current) !== stableHash(supplied) || parsed.manifestHash !== supplied.manifestHash || parsed.candidateHash !== supplied.candidateHash || stableHash(parsed.observationRefs) !== stableHash(supplied.observationRefs)) throw new GovernanceError("Assessment output does not bind the exact current input bundle", "observation_stale");
    if (Object.keys(parsed).some((key) => !["kind", "manifestHash", "candidateHash", "observationRefs", "results"].includes(key)) || !Array.isArray(parsed.results) || !coverage(parsed.results.map((/** @type {any} */ result) => result.criterionId))) throw new GovernanceError("Assessment must cover the exact criterion set", "malformed");
    const results = parsed.results.map((/** @type {any} */ result) => {
      if (!isRecord(result) || Object.keys(result).some((key) => !["criterionId", "outcome", "observationIds", "reason"].includes(key)) || !["pass", "fail", "insufficient"].includes(result.outcome) || !isStringArray(result.observationIds) || !result.observationIds.length || new Set(result.observationIds).size !== result.observationIds.length || !isNonEmpty(result.reason) || result.reason.length > 4096) throw new GovernanceError("Assessment result is malformed", "malformed");
      const observations = result.observationIds.map((/** @type {string} */ id) => {
        if (!supplied.observationRefs.some((/** @type {any} */ ref) => ref.id === id)) throw new GovernanceError("Assessment cites an observation that was not supplied", "observation_invalid");
        const observation = run.observations.find((/** @type {any} */ item) => item.id === id);
        if (!observation.criterionIds.includes(result.criterionId)) throw new GovernanceError("Assessment observation omits the criterion", "observation_invalid");
        return observation;
      });
      const criterion = run.criteria.find((/** @type {any} */ item) => item.id === result.criterionId);
      if (result.outcome === "pass" && observations.some((/** @type {any} */ observation) => observation.result.status !== "success")) throw new GovernanceError("Failed or unknown host results cannot provide passing observation evidence", "observation_invalid");
      if (criterion.evidenceKind === "visual" && !observations.some((/** @type {any} */ observation) => observation.artifacts.some((/** @type {any} */ artifact) => artifact.type === "image"))) throw new GovernanceError("Visual assessment requires actually supplied images", "observation_missing");
      return { criterionId: result.criterionId, outcome: result.outcome, observationIds: result.observationIds, reason: result.reason };
    });
    const verification = { id: newId("assessment"), kind: "observation-assessment", runId: run.runId, ...provenance, manifestHash: supplied.manifestHash, assessmentSelection: attempt.launch.assessment, observedCandidateHash: supplied.candidateHash, observationRefs: supplied.observationRefs, results, stamp: await acceptanceStamp(run, attempt, "observation-assessment"), source: "process-output", createdAt: nowIso() };
    run.verifications.push(verification); attempt.acceptanceId = verification.id;
    for (const result of results) run.evidence.push({ id: newId("evidence"), kind: "observation-assessment", runId: run.runId, criterionId: result.criterionId, candidateHash: attempt.candidateHash, outcome: result.outcome, observation: result.reason, observationRefs: supplied.observationRefs, manifestHash: supplied.manifestHash, assessmentSelection: attempt.launch.assessment, producer: provenance, stamp: verification.stamp, source: "process-output", createdAt: nowIso() });
    return { kind: "observation-assessment", id: verification.id };
  }
  if (parsed.kind === "verification") {
    if (attempt.role !== "verifier" || attempt.provider !== "local" || attempt.model !== "deterministic-check" || !attempt.launch?.check || stableHash(attempt.process.command) !== stableHash(attempt.launch.check)) throw new GovernanceError("verification requires the actual approved check command", "role");
    if (run.criteria.some((/** @type {any} */ criterion) => boundary.requirementIds.includes(criterion.id) && ["visual", "observation"].includes(criterion.evidenceKind))) throw new GovernanceError("Check success cannot certify observed criteria", "observation_invalid");
    const results = boundary.requirementIds.map((/** @type {string} */ criterionId) => ({ criterionId, outcome: attempt.process.exitCode === 0 ? "pass" : "fail", observation: `Approved command exited ${attempt.process.exitCode}.` }));
    const verification = { id: newId("verification"), kind: "verification", runId: run.runId, ...provenance, results, stamp: await acceptanceStamp(run, attempt, "verification"), source: "process-output", createdAt: nowIso() };
    run.verifications.push(verification);
    attempt.acceptanceId = verification.id;
    for (const result of results) {
      run.evidence.push({ id: newId("evidence"), kind: "verification", runId: run.runId, criterionId: result.criterionId, candidateHash: attempt.candidateHash, outcome: result.outcome, observation: result.observation, producer: provenance, stamp: verification.stamp, source: "process-output", createdAt: nowIso() });
    }
    return { kind: "verification", id: verification.id };
  }
  throw new GovernanceError("output kind is not a governed acceptance artifact", "malformed");
}

/** @param {unknown} value */
function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {any} run @param {string} attemptId */
function attemptById(run, attemptId) {
  return run.attempts.find((/** @type {any} */ entry) => entry.id === attemptId) ?? null;
}

/** @param {any} run @param {string} key @param {any} event */
function assertNotConflictingDuplicate(run, key, event) {
  const hash = stableHash(event);
  if (Object.hasOwn(run.eventKeys, key)) {
    if (run.eventKeys[key] !== hash) throw new GovernanceError("conflicting duplicate host event", "duplicate");
    return { duplicate: true, hash };
  }
  run.eventKeys[key] = hash;
  return { duplicate: false, hash };
}

/**
 * @param {{home?: string, event: unknown}} input
 */
export async function recordHostEvent(input) {
  const home = store.resolveHome(input.home);
  const event = /** @type {any} */ (validateHostEvent(input.event));
  const runDirectory = event.sessionId ? await store.registryRunDirectory(home, event.sessionId) : await findRunDirectoryByAttempt(home, event.attemptId);
  if (!runDirectory) return { ok: false, status: "unsupported", reason: "no unambiguous governed run is bound to this event" };
  return mutateRun(runDirectory, async (run) => {
    const key = eventKey(event);
    const duplicate = assertNotConflictingDuplicate(run, key, event);
    if (duplicate.duplicate) return { ok: true, status: "idempotent", revision: run.revision };
    if (event.kind === "process-start" || event.kind === "process-exit") {
      const attempt = attemptById(run, event.attemptId);
      if (!attempt?.expectedProcess) throw new GovernanceError("event has no designated process attempt");
      const boundary = boundaryById(run, attempt.boundaryId);
      // Correlate the recorded path first. Filesystem drift must not erase a
      // genuinely observed PID termination during return reconciliation.
      const candidateRoot = event.candidateRoot;
      if (candidateRoot !== attempt.launch.candidateRoot) throw new GovernanceError("process candidate root differs from the consumed dispatch");
      const check = attempt.launch.check;
      if (check && stableHash(event.command) !== stableHash(check)) throw new GovernanceError("actual check command differs from its approved exact argv");
      if (!check) {
        const argv = event.command.argv;
        const model = argv[argv.indexOf("--model") + 1];
        const effort = argv[argv.indexOf("--variant") + 1];
        const codex = sameProvider(attempt.provider, "codex");
        const valid = codex ? matchesCodexCommand(argv, { role: attempt.role, model: attempt.model, reasoning: attempt.reasoning, candidateRoot })
          : model === attempt.model && argv[0] === "run" && effort === attempt.reasoning && argv.includes("--pure");
        if (!valid) throw new GovernanceError("actual process command does not pin the designated profile");
      }
      if (event.kind === "process-start") {
        if (attempt.process || attempt.status !== "running") throw new GovernanceError("process attempt already started or is not runnable");
        if (!attempt.processBinding || attempt.processBinding.candidateRoot !== candidateRoot || stableHash(attempt.processBinding.command) !== stableHash(event.command)) throw new GovernanceError("process candidate and command were not bound before spawn");
        attempt.process = { processId: event.processId, candidateRoot, command: event.command, terminated: false };
        attempt.identityUnconfirmed = true;
        try {
          const identity = await store.readProcessRootIdentity(run, candidateRoot, attempt.role);
          if (attempt.processBinding.rootIdentity && stableHash(identity) !== stableHash(attempt.processBinding.rootIdentity)) throw new GovernanceError("Process root changed before start", "candidate");
        } catch {
          attempt.status = "cancelling";
          return { ok: false, status: "rejected", reason: "worktree identity changed; terminate the actual PID; ownership retained" };
        }
        if (event.model !== "unknown" && (!sameProvider(event.provider, attempt.provider) || event.model !== attempt.model || event.reasoning !== attempt.reasoning)) {
          attempt.identityMismatch = true; attempt.status = "cancelling";
          return { ok: false, status: "rejected", reason: "profile mismatch; terminate and reconcile the actual PID; leases retained" };
        }
        return { ok: true, status: "identity-pending", attemptId: attempt.id };
      }
      if (!attempt.process || attempt.process.processId !== event.processId || stableHash(attempt.process.command) !== stableHash(event.command)) throw new GovernanceError("process exit does not match the registered PID and command");
      if (attempt.process.terminated) throw new GovernanceError("process already terminated");
      if (event.terminated !== true) { attempt.status = "cancelling"; return { ok: false, status: "cancelling", reason: "termination remains unobserved" }; }
      attempt.process.terminated = true; attempt.process.exitCode = event.exitCode;
      attempt.process.exitSignal = event.exitSignal;
      attempt.process.reconciliationFailed = event.reconciliationFailed;
      if (event.serviceTierObservation) attempt.serviceTierObservation = event.serviceTierObservation;
      const cancelled = attempt.cancelled === true || attempt.status === "cancelling" || event.cancelled === true;
      attempt.cancelled = cancelled;
      const identity = event.model !== "unknown" && event.processSessionId && sameProvider(event.provider, attempt.provider) && event.model === attempt.model && event.reasoning === attempt.reasoning;
      if (!identity || attempt.identityMismatch || cancelled) {
        attempt.status = "failed"; attempt.identityMismatch = !identity || attempt.identityMismatch;
        releaseLeases(run, attempt.id);
        return { ok: false, status: "failed", reason: cancelled ? "cancelled process cannot produce acceptance" : "actual process profile/session is unconfirmed or mismatched" };
      }
      try {
        if (event.reconciliationFailed) throw new GovernanceError("Observed process completion failed adapter reconciliation", "candidate");
        const rootIdentity = await store.readProcessRootIdentity(run, candidateRoot, attempt.role);
        if (attempt.processBinding.rootIdentity && stableHash(rootIdentity) !== stableHash(attempt.processBinding.rootIdentity)) throw new GovernanceError("Process worktree identity changed before return", "candidate");
        if (stableHash(await currentSourceHashes(run, boundary.sourceIds)) !== stableHash(boundary.sourceHashes)) throw new GovernanceError("Canonical sources changed while the process ran", "stale");
        if (run.actors.some((/** @type {any} */ actor) => actor.sessionId === event.processSessionId)) throw new GovernanceError("fresh process session was already used by another actor");
        attempt.actorId = `process_${attempt.id}`; attempt.sessionId = event.processSessionId;
        attempt.observed = { provider: event.provider, model: event.model, reasoning: event.reasoning, processSessionId: event.processSessionId };
        attempt.identityUnconfirmed = false;
        ensureActor(run, { id: attempt.actorId, role: attempt.role, ...attempt.observed, sessionId: attempt.sessionId, parentActorId: run.rootSessionId, provenance: "observed-process", status: "terminated" });
        if (["planner", "plan-reviewer", "reviewer", "verifier"].includes(attempt.role) && (typeof event.output !== "string" || Buffer.byteLength(event.output) > 128 * 1024)) throw new GovernanceError("Designated process output is missing or exceeds the bounded limit", "malformed", { field: "process.output" });
        if (["researcher", "writer"].includes(attempt.role)) {
          if (typeof event.output !== "string" || Buffer.byteLength(event.output) > 32768) throw new GovernanceError("returned observation is missing or exceeds the bounded output cap");
          attempt.returnedObservation = event.output;
        }
        if (attempt.role === "writer") {
          if (await store.hashPaths(run.root, [...boundary.readSet, ...boundary.writeSet]) !== boundary.scopeHash) throw new GovernanceError("parent dependency inputs changed while the writer ran");
          const after = await store.snapshotRepository(candidateRoot);
          const observedDelta = store.repositoryDelta(attempt.processBinding.baseline, after);
          if (stableHash(observedDelta) !== stableHash([...new Set(event.changedPaths)].sort())) throw new GovernanceError("reported writer delta differs from actual candidate changes");
        }
        if (attempt.role !== "writer" && (await store.hashPaths(run.root, [...boundary.readSet, ...boundary.writeSet])) !== boundary.scopeHash) throw new GovernanceError("candidate changed while the process observed it");
        await reconcileScope(run, attempt, event.changedPaths);
        const acceptanceRole = ["planner", "plan-reviewer", "reviewer", "verifier"].includes(attempt.role);
        // Research and writing may return structured factual reports. They have
        // no authority to produce a plan, review or verification artifact.
        const parsed = check ? { kind: "verification" } : acceptanceRole ? extractAcceptanceJson(event.output) : null;
        if (acceptanceRole && !parsed) throw new GovernanceError("designated role returned no acceptance artifact");
        if (parsed && (event.exitCode === 0 || check)) await ingestOutput(run, attempt, parsed);
        attempt.outputHash = stableHash({ output: event.output ?? "", snapshotHash: attempt.snapshotHash ?? null, observed: attempt.observed, exitCode: event.exitCode });
        attempt.status = event.exitCode === 0 ? (attempt.invocationObserved ? "completed" : "awaiting-post") : "failed";
      } catch (error) {
        attempt.status = "failed"; attempt.failure = error instanceof Error ? error.message : "process reconciliation failed";
        attempt.failureDiagnostic = { code: error instanceof GovernanceError ? error.code : "invalid", field: error instanceof GovernanceError ? error.details?.field ?? null : null };
        if (typeof event.output === "string" && Buffer.byteLength(event.output) <= 128 * 1024) {
          const relativePath = `rejected-outputs/${sha256Hex(event.output)}.txt`;
          try {
            const artifact = await store.writeImmutablePrivate(join(runDirectory, relativePath), event.output);
            attempt.rejectedOutput = { relativePath, sha256: artifact.sha256, size: artifact.size };
          } catch { attempt.rejectedOutputUnavailable = true; }
        }
      }
      releaseLeases(run, attempt.id);
      return { ok: ["completed", "awaiting-post"].includes(attempt.status), status: attempt.status, attemptId: attempt.id, reason: attempt.failure ?? null };
    }
    if (event.kind === "hook") {
      if (event.hookEventName === "PostToolUse") {
        const permit = run.permits.find((/** @type {any} */ item) => item.invocation?.sessionId === event.sessionId && item.invocation.turnId === event.turnId && item.invocation.toolUseId === event.toolUseId && item.toolName === event.toolName && item.toolInputHash === stableHash(event.toolInput));
        if (!permit || !event.turnId || !event.toolUseId) throw new GovernanceError("PostToolUse does not match the exact consumed invocation");
        const attempt = attemptById(run, permit.attemptId);
        if (!attempt) throw new GovernanceError("post has no consumed attempt");
        if (event.model !== permit.invocation.model || event.reasoning !== permit.invocation.reasoning || !event.cwd || await store.canonicalDirectory(event.cwd) !== store.hostRootFor(run)) throw new GovernanceError("PostToolUse does not match the observed host identity", "identity");
        attempt.invocationObserved = true; permit.status = "completed";
        if (attempt.expectedProcess) {
          if (!attempt.process?.terminated) return { ok: false, status: "recovery-required", reason: "outer tool returned without matching observed process termination" };
          if (attempt.status === "awaiting-post") {
            try { await store.assertRunRoots(run); attempt.status = "completed"; }
            catch { attempt.status = "failed"; attempt.failureDiagnostic = { code: "candidate", field: null }; }
          }
          return { ok: attempt.status === "completed", status: attempt.status };
        }
        if (attempt.status !== "running") return { ok: false, status: attempt.status };
        try {
          await store.assertRunRoots(run);
          await reconcileScope(run, attempt, event.changedPaths.length ? event.changedPaths : attempt.leasePaths);
          const boundary = boundaryById(run, attempt.boundaryId);
          if (boundary.action === "host-tool") {
            const observation = await persistObservation(runDirectory, run, event);
            attempt.observationId = observation.id; attempt.toolResult = observation.result;
            attempt.status = observation.result.status === "success" ? "completed" : "failed";
            releaseLeases(run, attempt.id);
            return { ok: attempt.status === "completed", status: attempt.status, observationId: observation.id, productAcceptance: false };
          }
          if (boundary.action === "integrate") for (const dependency of boundary.dependsOn) {
            const writer = attemptById(run, dependency);
            if (writer?.role !== "writer") continue;
            const identity = await store.readProcessRootIdentity(run, writer.process.candidateRoot, "writer");
            if (writer.processBinding?.rootIdentity && stableHash(identity) !== stableHash(writer.processBinding.rootIdentity)) throw new GovernanceError("Writer worktree changed before integration", "candidate");
            const candidate = await store.hashPaths(writer.process.candidateRoot, writer.leasePaths);
            if (candidate !== writer.snapshotHash || await store.hashPaths(run.root, writer.leasePaths) !== candidate) throw new GovernanceError("integration does not match the observed writer candidate bytes");
          }
          attempt.status = "completed";
          run.candidatePaths = [...new Set([...run.candidatePaths, ...attempt.leasePaths])].sort();
          if (attempt.leasePaths.length) run.acceptanceEpoch += 1;
        } catch (error) {
          const hostCapture = boundaryById(run, attempt.boundaryId)?.action === "host-tool";
          attempt.status = "recovery-required";
          attempt.failure = hostCapture ? "The actual host output could not be retained as an observation." : "The actual host invocation failed runtime reconciliation.";
          attempt.failureDiagnostic = { kind: hostCapture ? "host-capture" : "host-reconciliation", code: error instanceof GovernanceError && ["scope", "observation_invalid", "observation_stale", "observation_missing"].includes(error.code) ? error.code : "invalid", field: null };
          return { ok: false, status: attempt.status, failureDiagnostic: safeAttemptDiagnostic(attempt), reason: attempt.failure };
        }
        releaseLeases(run, attempt.id);
        return { ok: true, status: attempt.status };
      }
      if (event.hookEventName === "SubagentStart") {
        if (!event.agentId || event.parentSessionId !== run.rootSessionId) return { ok: false, status: "unsupported", reason: "ambiguous child attribution" };
        run.childSessions[event.agentId] = { supported: false, parentSessionId: run.rootSessionId, ended: false };
        const registry = await store.readRegistry(home);
        const entry = registry.runs[run.runId];
        entry.childSessionIds = [...new Set([...(entry.childSessionIds ?? []), event.agentId])];
        await store.writeRegistry(home, registry);
        return { ok: false, status: "unsupported", reason: "child tools are registered for denial, not authorized" };
      }
      if (event.hookEventName === "SubagentStop") {
        if (run.childSessions[event.agentId]) run.childSessions[event.agentId].ended = true;
        return { ok: false, status: "unsupported" };
      }
      if (event.hookEventName === "Stop") return { ok: true, status: run.phase === "closed" ? "stop" : "continue" };
    }
    if (event.kind === "interruption") {
      const targets = event.attemptId ? [attemptById(run, event.attemptId)].filter(Boolean) : activeAttempts(run);
      for (const attempt of targets) { attempt.cancelled = true; if (!attempt.process?.terminated) attempt.status = "cancelling"; }
      return { ok: true, status: "cancelling", cancelled: targets.map((/** @type {any} */ attempt) => attempt.id) };
    }
    return { ok: false, status: "unsupported" };
  });
}

/** Adapter-only preparation immediately before spawn. Captures the current
 * candidate baseline before the process can change it, not original Git HEAD.
 * @param {{runDirectory:string,attemptId:string,candidateRoot:string,command:{executable:string,argv:string[]}}} input */
export async function bindProcessCandidate(input) {
  return mutateRun(input.runDirectory, async (run) => {
    const attempt = attemptById(run, input.attemptId);
    if (!attempt?.expectedProcess || attempt.status !== "running" || attempt.process || attempt.processBinding) throw new GovernanceError("candidate binding requires one current consumed process dispatch");
    const boundary = boundaryById(run, attempt.boundaryId);
    await requireCurrentJudgment(run, boundary);
    const candidateRoot = input.candidateRoot;
    if (candidateRoot !== attempt.launch.candidateRoot) throw new GovernanceError("candidate binding does not match dispatch");
    if (sameProvider(attempt.provider, "codex") && !matchesCodexCommand(input.command.argv, { role: attempt.role, model: attempt.model, reasoning: attempt.reasoning, candidateRoot })) throw new GovernanceError("actual process command does not pin the designated profile");
    const rootIdentity = await store.readProcessRootIdentity(run, candidateRoot, attempt.role);
    if (attempt.launchIdentity && stableHash(rootIdentity) !== stableHash(attempt.launchIdentity)) throw new GovernanceError("Candidate identity changed after dispatch consumption", "candidate");
    await store.assertRootsAvailable(run.home, [candidateRoot], { runId: run.runId, attemptId: attempt.id });
    const paths = [...new Set([...boundary.readSet, ...boundary.writeSet, ...run.sources.filter((/** @type {any} */ source) => boundary.sourceIds.includes(source.id)).map((/** @type {any} */ source) => source.path)])];
    if (await store.hashPaths(candidateRoot, paths) !== await store.hashPaths(run.root, paths)) throw new GovernanceError("writer candidate does not contain the current parent dependency inputs");
    const assessment = attempt.launch.assessment ? await assessmentInput(input.runDirectory, run, attempt.launch.assessment) : null;
    if (assessment) {
      const images = input.command.argv.flatMap((arg, index) => arg === "--image" ? [input.command.argv[index + 1]] : []);
      if (stableHash(images) !== stableHash(assessment.imagePaths) || !input.command.argv.at(-1)?.includes(JSON.stringify(assessment))) throw new GovernanceError("Assessment process must receive the exact generated bundle and image arguments", "observation_invalid");
    }
    attempt.processBinding = { candidateRoot, rootIdentity, command: input.command, assessment, baseline: attempt.role === "writer" ? await store.snapshotRepository(candidateRoot) : null };
    return { ok: true, candidateRoot, baselineHash: stableHash(attempt.processBinding.baseline) };
  });
}

/** @param {any} event */
function eventKey(event) {
  if (event.kind === "hook") return `hook:${event.sessionId}:${event.hookEventName}:${event.turnId ?? ""}:${event.toolUseId ?? ""}:${event.agentId ?? ""}`;
  if (event.kind === "process-start" || event.kind === "process-exit") return `${event.kind}:${event.attemptId}:${event.processId}`;
  return `interruption:${event.sessionId ?? ""}:${event.attemptId ?? ""}:${event.turnId ?? ""}:${event.reason ?? ""}`;
}

/** @param {string} home @param {string} attemptId */
async function findRunDirectoryByAttempt(home, attemptId) {
  if (typeof attemptId !== "string" || attemptId.length === 0) return null;
  let entries;
  try {
    entries = await readdir(store.runsDirectory(home));
  } catch {
    return null;
  }
  const matches = [];
  for (const entry of entries) {
    const runDirectory = store.runDirectoryFor(home, entry);
    try {
      const run = await store.loadRun(runDirectory);
      if (run.attempts.some((/** @type {any} */ attempt) => attempt.id === attemptId)) matches.push(runDirectory);
    } catch {
      continue;
    }
  }
  if (matches.length > 1) throw new GovernanceError("process attempt id is ambiguous across runs");
  return matches[0] ?? null;
}

/** @param {any} run */
async function missingClosureEvidence(run) {
  const missing = [];
  const plan = run.plans.at(-1);
  if (!await artifactCurrent(run, plan)) missing.push("current-plan");
  const planReview = run.reviews.filter((/** @type {any} */ review) => review.kind === "plan-review" && review.planId === plan?.id).at(-1);
  if (planReview?.verdict !== "pass" || !await artifactCurrent(run, planReview)) missing.push("current-independent-plan-review");
  const finalReview = run.reviews.filter((/** @type {any} */ review) => review.kind === "final-review").at(-1);
  if (finalReview?.verdict !== "pass" || !await artifactCurrent(run, finalReview)) missing.push("current-independent-final-review");
  for (const criterion of run.criteria) {
    const evidence = run.evidence.filter((/** @type {any} */ entry) => entry.criterionId === criterion.id).at(-1);
    if (evidence?.outcome !== "pass" || !await artifactCurrent(run, evidence)) missing.push(`criterion:${criterion.id}`);
  }
  if (run.findings.some((/** @type {any} */ finding) => finding.gating && !finding.resolved)) missing.push("unresolved-findings");
  if (activeAttempts(run).length || Object.keys(run.leases).length) missing.push("live-or-unreconciled-ownership");
  if (run.attempts.some((/** @type {any} */ attempt) => attempt.status === "recovery-required" || !attempt.invocationObserved || (attempt.process && !attempt.process.terminated))) missing.push("missing-completion-correlation");
  return missing;
}

/** @param {any} run @param {string} kind */
async function prerequisiteSatisfied(run, kind) {
  if (kind === "research-resolved") return run.boundaries.some((/** @type {any} */ boundary) => boundary.action === "research-return" && passingJudgment(run, boundary.id));
  if (kind === "plan-evidence") return artifactCurrent(run, run.plans.at(-1));
  if (kind === "plan-review-pass") {
    const review = run.reviews.filter((/** @type {any} */ entry) => entry.kind === "plan-review" && entry.planId === run.plans.at(-1)?.id).at(-1);
    return review?.verdict === "pass" && await artifactCurrent(run, review);
  }
  if (kind === "writer-return") return run.attempts.some((/** @type {any} */ attempt) => attempt.role === "writer" && attempt.status === "completed" && attempt.invocationObserved);
  if (kind === "integration-complete") return run.attempts.some((/** @type {any} */ attempt) => boundaryById(run, attempt.boundaryId)?.action === "integrate" && attempt.status === "completed");
  if (kind === "final-review-pass") {
    const review = run.reviews.filter((/** @type {any} */ entry) => entry.kind === "final-review").at(-1);
    return review?.verdict === "pass" && await artifactCurrent(run, review) && !run.findings.some((/** @type {any} */ finding) => finding.gating && !finding.resolved);
  }
  return false;
}

/** @param {any} run @param {string} to */
function phasePrerequisites(run, to) {
  return run.taskKind === "audit" && to === "final-review"
    ? ["plan-review-pass"]
    : /** @type {Record<string,readonly string[]>} */ (PHASE_PREREQUISITES)[to] ?? [];
}

/** @param {{runDirectory:string,transition:unknown,argv?:string[]}} input */
export async function advancePhase(input) {
  const transition = validateTransition(input.transition);
  return mutateRun(input.runDirectory, async (run) => {
    if (run.phase === "closed") throw new GovernanceError("run is closed");
    if (run.pendingCoordinatorEffortTransition) throw new GovernanceError("coordinator effort confirmation is pending", "effort_pending");
    const boundary = boundaryById(run, transition.boundaryId);
    if (!boundary || boundary.phase !== run.phase) throw new GovernanceError("transition judgment must belong to the current phase");
    if (stableHash(boundary.coordinatorEffortTransition ?? null) !== stableHash(transition.coordinatorEffortTransition ?? null)) throw new GovernanceError("phase effort transition must match the classified return", "effort");
    await requireCurrentJudgment(run, boundary);
    await assertBoundarySemantics(run, boundary);
    if (activeAttempts(run).length || activeLeasePaths(run).length) throw new GovernanceError("cannot change phase while ownership/completion remains active");
    if (isAdjacentForward(run.phase, transition.to, run.taskKind)) {
      const required = /** @type {Record<string,string>} */ ({ intake: "intake-review", research: "research-return", plan: "plan-return", "plan-review": "plan-review-return", implementation: "writer-return", integration: "integration-return", "final-review": "final-review-return" })[run.phase];
      if (boundary.action !== required) throw new GovernanceError("phase advance requires its completed return boundary");
      for (const prerequisite of phasePrerequisites(run, transition.to)) if (!await prerequisiteSatisfied(run, prerequisite)) throw new GovernanceError(`phase ${transition.to} requires ${prerequisite}`);
    } else if (!(run.taskKind === "audit" && ["implementation", "integration"].includes(transition.to)) && isRewind(run.phase, transition.to) && boundary.action === "correct") {
      const index = PHASES.indexOf(transition.to);
      for (const artifact of [...run.plans, ...run.reviews, ...run.evidence, ...run.verifications]) {
        const phase = artifact.kind === "plan" ? "plan" : artifact.kind === "plan-review" ? "plan-review" : artifact.kind === "final-review" ? "final-review" : "evidence";
        if (PHASES.indexOf(phase) >= index) artifact.invalidated = true;
      }
      run.acceptanceEpoch += 1;
      run.correctionCount = (run.correctionCount ?? 0) + 1;
      // Findings are resolved only by explicit current independent review output.
    } else throw new GovernanceError("forward skips and unclassified rewinds are forbidden");
    for (const permit of run.permits) if (permit.status === "prepared") permit.status = "failed";
    if (transition.coordinatorEffortTransition) {
      const change = transition.coordinatorEffortTransition;
      if (run.attempts.some((/** @type {any} */ attempt) => attempt.status === "recovery-required")) throw new GovernanceError("recovery ownership prevents effort transition", "ownership");
      const invocation = consumeEffortControl(run, "advance", transition, input.argv);
      if (invocation.observation.reasoning !== change.oldEffort || invocation.observation.model !== change.model || invocation.observation.sessionId !== change.sessionId) throw new GovernanceError("advance host effort identity differs from the classified coordinator", "identity");
      run.pendingCoordinatorEffortTransition = { descriptor: change, descriptorHash: stableHash(change), boundaryId: boundary.id, judgmentId: boundary.judgmentId, candidateHash: boundary.candidateHash, transition, initiatingTurnId: invocation.turnId, initiatingTurnOrdinal: invocation.observation.turnOrdinal, rootIdentity: await store.assertRunRoots(run), at: nowIso() };
      return run;
    }
    run.phase = transition.to; run.phaseReason = transition.reason;
    return run;
  });
}

/** Hook ingress for only the exact advance/confirm control invocation.
 * @param {{runDirectory:string,command:string,input:any,fullCommand:string,argv:string[],event:any,observation:any}} input */
export async function recordEffortControlInvocation(input) {
  if (!['advance', 'confirm-effort'].includes(input.command) || !isRecord(input.event) || !isRecord(input.observation) || !Array.isArray(input.argv)) throw new GovernanceError("invalid effort control ingress", "identity");
  return mutateRun(input.runDirectory, async (run) => {
    const observed = input.observation;
    if (observed.sessionId !== run.rootSessionId || observed.model !== run.coordinator.model || observed.transcriptPath !== run.coordinator.transcriptPath || observed.cwd !== store.hostRootFor(run) || !Number.isSafeInteger(observed.turnOrdinal) || !input.event.turn_id || !input.event.tool_use_id) throw new GovernanceError("effort control host identity differs from coordinator", "identity");
    if (input.command === 'confirm-effort') {
      const pending = run.pendingCoordinatorEffortTransition;
      if (!pending || observed.reasoning !== pending.descriptor.newEffort || observed.turnOrdinal <= pending.initiatingTurnOrdinal || input.event.turn_id === pending.initiatingTurnId) throw new GovernanceError("effort confirmation requires a later observed turn at the expected effort", "identity");
    } else {
      const change = validateTransition(input.input).coordinatorEffortTransition;
      if (!change || run.pendingCoordinatorEffortTransition || observed.reasoning !== run.coordinator.reasoning) throw new GovernanceError("advance effort control is not current", "effort");
    }
    if (run.effortControlInvocations.some((/** @type {any} */ prior) => prior.turnId === input.event.turn_id && prior.toolUseId === input.event.tool_use_id)) throw new GovernanceError("effort control invocation was already observed", "replay");
    // A later, exact host invocation replaces an abandoned unconsumed handoff.
    // Its original turn/tool identity remains retained and cannot be replayed.
    for (const prior of run.effortControlInvocations) if (!prior.used && prior.command === input.command && prior.inputHash === stableHash(input.input)) prior.superseded = true;
    run.effortControlInvocations.push({ command: input.command, inputHash: stableHash(input.input), fullCommand: input.fullCommand, argv: input.argv, turnId: input.event.turn_id, toolUseId: input.event.tool_use_id, observation: observed, used: false });
    return { ok: true };
  });
}

/** @param {any} run @param {string} command @param {any} input @param {string[]|undefined} argv */
function consumeEffortControl(run, command, input, argv) {
  const matches = run.effortControlInvocations.filter((/** @type {any} */ item) => !item.used && !item.superseded && item.command === command && item.inputHash === stableHash(input) && stableHash(item.argv) === stableHash(argv));
  if (matches.length !== 1) throw new GovernanceError("exact one-use host effort control handoff is required", "handoff");
  matches[0].used = true;
  return matches[0];
}

/** Atomically finish a host-observed, later-turn coordinator effort change.
 * @param {{runDirectory:string,confirmation:any,argv?:string[]}} input */
export async function confirmCoordinatorEffort(input) {
  const result = await mutateRun(input.runDirectory, async (run) => {
    const pending = run.pendingCoordinatorEffortTransition;
    if (!pending || !isRecord(input.confirmation) || Object.keys(input.confirmation).some((key) => key !== 'transitionHash') || input.confirmation.transitionHash !== pending.descriptorHash) throw new GovernanceError("no matching pending coordinator effort transition", "effort");
    const handoff = consumeEffortControl(run, 'confirm-effort', input.confirmation, input.argv);
    try {
      const observed = handoff.observation;
      if (observed.sessionId !== run.rootSessionId || observed.model !== run.coordinator.model || observed.reasoning !== pending.descriptor.newEffort || observed.transcriptPath !== run.coordinator.transcriptPath || observed.cwd !== store.hostRootFor(run) || observed.turnOrdinal <= pending.initiatingTurnOrdinal || handoff.turnId === pending.initiatingTurnId) throw new GovernanceError("confirmed host turn does not match pending coordinator identity", "identity");
      const boundary = boundaryById(run, pending.boundaryId);
      if (!boundary || boundary.judgmentId !== pending.judgmentId || boundary.candidateHash !== pending.candidateHash || run.phase !== boundary.phase || stableHash(await store.assertRunRoots(run)) !== stableHash(pending.rootIdentity)) throw new GovernanceError("pending phase evidence or root changed", "stale");
      await requireCurrentJudgment(run, boundary);
      if (activeAttempts(run).length || activeLeasePaths(run).length || run.attempts.some((/** @type {any} */ attempt) => attempt.status === 'recovery-required')) throw new GovernanceError("active ownership prevents effort confirmation", "ownership");
      for (const prerequisite of phasePrerequisites(run, pending.transition.to)) if (!await prerequisiteSatisfied(run, prerequisite)) throw new GovernanceError("phase prerequisite changed before effort confirmation", "stale");
      run.phase = pending.transition.to;
      run.phaseReason = pending.transition.reason;
      run.coordinator.reasoning = pending.descriptor.newEffort;
      run.coordinatorIdentityEpoch = (run.coordinatorIdentityEpoch ?? 0) + 1;
      const receipt = { id: newId('effort'), descriptorHash: pending.descriptorHash, boundaryId: pending.boundaryId, judgmentId: pending.judgmentId, turnId: handoff.turnId, toolUseId: handoff.toolUseId, coordinatorIdentityEpoch: run.coordinatorIdentityEpoch, at: nowIso() };
      run.coordinatorEffortReceipts.push(receipt);
      run.pendingCoordinatorEffortTransition = null;
      return run;
    } catch (error) {
      // Save the one-use consumption even when fresh evidence rejects the phase.
      return { rejected: error instanceof GovernanceError ? { message: error.message, code: error.code } : { message: "effort confirmation failed", code: "stale" } };
    }
  });
  if (result?.rejected) throw new GovernanceError(result.rejected.message, result.rejected.code);
  return result;
}

/** @param {{runDirectory:string,outcome:unknown}} input */
export async function closeRun(input) {
  const outcome = validateOutcome(input.outcome);
  return mutateRun(input.runDirectory, async (run) => {
    if (run.phase === "closed" && outcome.status === "accepted") throw new GovernanceError("closed runs cannot be reaccepted");
    if (outcome.status === "accepted") {
      if (run.phase !== "evidence") throw new GovernanceError("accepted closure requires the evidence phase");
      const boundary = boundaryById(run, outcome.boundaryId);
      if (!boundary || boundary.action !== "close" || boundary.phase !== run.phase) throw new GovernanceError("closure requires a current close boundary");
      await requireCurrentJudgment(run, boundary);
      await assertBoundarySemantics(run, boundary);
      const missing = await missingClosureEvidence(run);
      if (missing.length) throw new GovernanceError(`accepted closure is missing ${missing.join(", ")}`);
      if (!boundary.observations.some((/** @type {string} */ observation) => observation.includes(run.endpoint))) throw new GovernanceError("closure must explicitly evaluate the retained delivery endpoint");
      if (run.endpoint !== "local accepted") {
        const endpointChecks = run.verifications.filter((/** @type {any} */ verification) => {
          const attempt = attemptById(run, verification.attemptId);
          return boundaryById(run, attempt?.boundaryId)?.route.capabilities.includes(`endpoint:${run.endpoint}`) && verification.results.every((/** @type {any} */ result) => result.outcome === "pass");
        });
        let observedEndpoint = false;
        for (const verification of endpointChecks) if (await artifactCurrent(run, verification)) observedEndpoint = true;
        if (!observedEndpoint) throw new GovernanceError("delivery endpoint requires a current observed approved endpoint check");
      }
      for (const ticket of run.tickets) ticket.status = "accepted";
    }
    run.outcome = { status: outcome.status, reason: outcome.reason, at: nowIso() };
    run.phase = "closed";
    const unfinished = activeAttempts(run).length > 0 || Object.keys(run.leases).length > 0 || run.attempts.some((/** @type {any} */ attempt) => attempt.status === "recovery-required" || !attempt.invocationObserved || (attempt.process && !attempt.process.terminated));
    run.leasePreserved = unfinished;
    const registry = await store.readRegistry(run.home);
    if (registry.runs[run.runId]) registry.runs[run.runId].finished = !unfinished;
    await store.writeRegistry(run.home, registry);
    return run;
  });
}

/** @param {{runDirectory: string}} input */
export async function getRun(input) {
  return store.loadRun(input.runDirectory);
}

/** @param {any} run @param {any} adapter */
function assertExternalSerialization(run, adapter) {
  const active = activeAttempts(run);
  if ((["external-write", "opaque"].includes(adapter?.effect) && active.length) || active.some((/** @type {any} */ attempt) => ["external-write", "opaque"].includes(attempt.adapter?.effect))) {
    throw new GovernanceError("External effects require exclusive active execution", "overlap");
  }
}

/** Shell identity is the actual hook representation; native wrapper names are
 * not interchangeable with the observed Bash envelope.
 * @param {any} run @param {string} toolName */
function assertObservedShellName(run, toolName) {
  const observed = run.capabilityPreflight?.observedTools ?? [];
  if (run.capabilityPreflight?.policyHash !== POLICY_HASH || !observed.some((/** @type {any} */ tool) => tool.capability === "shell" && tool.toolName === toolName)) throw new GovernanceError("Use the exact shell tool name and input shape observed by this host", "host_tool_mapping", { field: "proposal.toolName" });
}

/** @param {any} registry @param {any} contract @param {any} observation */
async function capabilityPreflight(registry, contract, observation) {
  const mandatory = mandatoryCapabilities(contract);
  const omitted = mandatory.filter((capability) => !contract.requiredCapabilities.includes(capability));
  if (omitted.length) throw new GovernanceError("Required capability declaration omits a capability required by the task", "declaration_missing", { field: "contract.requiredCapabilities", missingCapabilities: omitted });
  const available = new Set();
  /** @type {Array<{capability:string,adapterId:string,toolName:string}>} */ const observedTools = [];
  for (const item of Object.values(registry.passiveTools ?? {})) {
    if (item.status === "success" && item.sessionId === observation.sessionId && item.model === observation.model && item.reasoning === observation.reasoning && item.cwd === await store.canonicalDirectory(observation.cwd) && item.policyHash === POLICY_HASH && item.sessionObservedAt === observation.observedAt) {
      available.add(item.capability);
      if (!observedTools.some((tool) => tool.toolName === item.rawToolName)) observedTools.push({ capability: item.capability, adapterId: item.adapterId, toolName: item.rawToolName });
    }
  }
  const missingCapabilities = contract.requiredCapabilities.filter((/** @type {string} */ capability) => !available.has(capability));
  return { ok: !missingCapabilities.length, ready: !missingCapabilities.length, sessionId: observation.sessionId, root: contract.root, hostRoot: contract.hostRoot, model: observation.model, reasoning: observation.reasoning, policyHash: POLICY_HASH, runtimeHash: RUNTIME_HASH, observedTools, requiredCapabilities: contract.requiredCapabilities, availableCapabilities: [...available].sort(), missingCapabilities };
}

/** Read-only preflight. A failed capability check never binds a run.
 * @param {{home?:string,contract:unknown,activation:unknown}} input */
export async function preflightRun(input) {
  const home = store.resolveHome(input.home);
  const contract = validateContract(input.contract, { endpoint: JEV_ENDPOINT });
  const registry = await store.readRegistry(home);
  const observation = registry.sessions[isRecord(input.activation) ? String(input.activation.sessionId ?? "") : ""];
  if (!observation) throw new GovernanceError("Activation requires an actual stored host session", "activation", { field: "activation.sessionId" });
  validateActivation(input.activation, observation);
  if (await store.canonicalDirectory(observation.cwd) !== contract.hostRoot) throw new GovernanceError("Contract hostRoot differs from the observed session root", "activation", { field: "contract.hostRoot" });
  await store.readRootIdentity(contract);
  return capabilityPreflight(registry, contract, observation);
}

/** Adapter-only passive availability, never acceptance evidence.
 * @param {{home?:string,event:any}} input */
export async function recordPassiveToolObservation(input) {
  const home = store.resolveHome(input.home), event = input.event;
  if (!isRecord(event)) throw new GovernanceError("Passive hook event must be an object", "observation_invalid");
  const sessionId = event.session_id ?? event.sessionId, turnId = event.turn_id ?? event.turnId, toolUseId = event.tool_use_id ?? event.toolUseId;
  const phase = event.hook_event_name ?? event.hookEventName;
  for (const value of [sessionId, turnId, toolUseId]) assertSafeId(value, "event.identity");
  if (!["PreToolUse", "PostToolUse"].includes(phase)) throw new GovernanceError("Passive observations require PreToolUse or PostToolUse", "observation_invalid");
  const descriptor = describeToolInvocation({ toolName: event.tool_name ?? event.toolName, toolInput: event.tool_input ?? event.toolInput });
  if (!descriptor) return { ok: false, status: "unsupported" };
  // Passive shell discovery is limited to the deliberate root probe. Governed
  // shell calls continue through the regular authorization path.
  if (descriptor.capability === "shell") {
    const argv = tokenizeExactCommand(descriptor.semanticInput.command ?? descriptor.semanticInput.cmd);
    if (!argv || argv.length !== 1 || argv[0] !== "pwd") return { ok: false, status: "unsupported" };
  }
  return store.withHomeLock(home, async () => {
    if (await store.registryRunDirectory(home, sessionId)) return { ok: false, status: "governed" };
    const registry = await store.readRegistry(home), observation = registry.sessions[sessionId];
    if (!observation || event.model !== observation.model || event.reasoning !== observation.reasoning || !event.cwd || await store.canonicalDirectory(event.cwd) !== await store.canonicalDirectory(observation.cwd)) throw new GovernanceError("Passive observation does not match current observed root, model and reasoning", "observation_invalid");
    registry.passiveTools ??= {};
    const key = stableHash({ sessionId, turnId, toolUseId });
    const identity = { sessionId, turnId, toolUseId, model: observation.model, reasoning: observation.reasoning, cwd: await store.canonicalDirectory(observation.cwd), sessionObservedAt: observation.observedAt, policyHash: POLICY_HASH, ...descriptor };
    const prior = registry.passiveTools[key];
    if (phase === "PreToolUse") {
      if (prior && prior.identityHash !== stableHash(identity)) throw new GovernanceError("Conflicting passive invocation identity", "observation_invalid");
      if (!prior) registry.passiveTools[key] = { ...identity, identityHash: stableHash(identity), status: "pending", preObservedAt: nowIso() };
    } else {
      if (!prior || prior.identityHash !== stableHash(identity)) throw new GovernanceError("Passive PostToolUse has no exact current PreToolUse", "observation_invalid");
      const output = event.rawOutput ?? event.tool_response ?? event.output;
      const result = descriptor.capability === "shell" && tokenizeExactCommand(descriptor.semanticInput.command ?? descriptor.semanticInput.cmd)?.join(" ") === "pwd" && typeof output === "string" && output.trim() === identity.cwd && (descriptor.semanticInput.cwd ?? descriptor.semanticInput.workdir ?? identity.cwd) === identity.cwd
        ? { status: "success", code: "observed-pwd-root" } : classifyToolResult(descriptor, output);
      const outputHash = stableHash(output ?? null);
      if (prior.postObservedAt && prior.outputHash !== outputHash) throw new GovernanceError("Conflicting passive PostToolUse result", "observation_invalid");
      Object.assign(prior, result, { outputHash, postObservedAt: prior.postObservedAt ?? nowIso() });
    }
    await store.writeRegistry(home, registry);
    return { ok: phase === "PreToolUse" || registry.passiveTools[key].status === "success", status: registry.passiveTools[key].status, capability: descriptor.capability, observationLevel: descriptor.observationLevel };
  });
}

/** Supported operator recovery for runs that never acquired execution ownership.
 * @param {{home?:string,runId:string,sessionId:string,reason:string}} input */
export async function recoverUnstartedRun(input) {
  const home = store.resolveHome(input.home);
  assertSafeId(input.runId, "runId");
  if (!isNonEmpty(input.reason) || input.reason.length > 2048) throw new GovernanceError("Recovery requires a bounded reason", "invalid", { field: "recovery.reason" });
  return mutateRun(store.runDirectoryFor(home, input.runId), async (run) => {
    const registry = await store.readRegistry(home), observer = registry.sessions[input.sessionId];
    if (!observer || await store.canonicalDirectory(observer.cwd) !== store.hostRootFor(run)) throw new GovernanceError("Recovery requires a currently observed session at the host root", "activation");
    if (run.attempts.length || Object.keys(run.leases).length || store.hasUnresolvedOwnership(run)) throw new GovernanceError("Recovery cannot release a run with execution or ownership history", "recovery_ownership");
    if (run.phase === "closed" && run.outcome?.status === "accepted") throw new GovernanceError("Accepted history cannot be recovered", "closed");
    await store.assertRunRootOwnership(run);
    run.recoveryReceipts ??= [];
    run.recoveryReceipts.push({ id: newId("recovery"), originalSessionId: run.rootSessionId, operatorSessionId: input.sessionId, operatorModel: observer.model, operatorReasoning: observer.reasoning, root: run.root, hostRoot: store.hostRootFor(run), reason: input.reason, at: nowIso(), policyHash: POLICY_HASH });
    for (const permit of run.permits) if (permit.status === "prepared") permit.status = "failed";
    run.phase = "closed"; run.outcome = { status: "blocked", reason: input.reason, at: nowIso() }; run.leasePreserved = false;
    if (!registry.runs[run.runId]) throw new GovernanceError("Run registry entry is missing", "corrupt");
    registry.runs[run.runId].finished = true;
    await store.writeRegistry(home, registry);
    return run;
  });
}

/** Administrative recovery retains failed history, never observation or acceptance.
 * Empty managed paths say nothing about external effects of the host invocation.
 * @param {{home?:string,runId:string,sessionId:string,attemptId:string,reason:string}} input */
export async function recoverHostAttempt(input) {
  const home = store.resolveHome(input.home);
  if (Object.keys(input).some((key) => !["home", "runId", "sessionId", "attemptId", "reason"].includes(key))) throw new GovernanceError("Recovery input contains unsupported fields", "invalid", { field: "input" });
  assertSafeId(input.runId, "run");
  assertSafeId(input.sessionId, "sessionId");
  assertSafeId(input.attemptId, "recovery.attemptId");
  if (!isNonEmpty(input.reason) || input.reason.length > 2048) throw new GovernanceError("Recovery requires a bounded reason", "invalid", { field: "recovery.reason" });
  const runDirectory = store.runDirectoryFor(home, input.runId);
  return mutateRun(runDirectory, async (run) => {
    const registry = await store.readRegistry(home), observer = registry.sessions[input.sessionId];
    if (!observer || observer.sessionId !== input.sessionId || await store.canonicalDirectory(observer.cwd) !== store.hostRootFor(run)) throw new GovernanceError("Recovery requires an observed operator at the canonical host root", "binding");
    const entry = registry.runs[input.runId];
    if (run.runId !== input.runId || !entry || entry.runId !== run.runId || entry.rootSessionId !== run.rootSessionId || entry.root !== run.root || store.hostRootFor(entry) !== store.hostRootFor(run) || entry.runDirectory !== runDirectory || await store.canonicalDirectory(run.root) !== run.root) throw new GovernanceError("Recovery requires a valid registry root mapping", "corrupt");
    const attempt = attemptById(run, input.attemptId);
    if (attempt?.recoveryReceiptId || (run.recoveryReceipts ?? []).some((/** @type {any} */ receipt) => receipt.attemptId === input.attemptId)) throw new GovernanceError("Host attempt was already recovered", "duplicate");
    const reject = () => { throw new GovernanceError("Host attempt does not satisfy the administrative recovery guards", "recovery_host_attempt"); };
    const emptyPaths = (/** @type {any} */ paths) => Array.isArray(paths) && paths.length === 0;
    const isHash = (/** @type {any} */ hash) => typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash);
    if (run.phase !== "closed" || !["blocked", "interrupted"].includes(run.outcome?.status) || !attempt || attempt.status !== "recovery-required" || run.attempts.filter((/** @type {any} */ item) => item.id === input.attemptId).length !== 1) reject();
    const boundary = boundaryById(run, attempt.boundaryId);
    if (boundary?.action !== "host-tool" || attempt.runId !== run.runId || attempt.expectedProcess !== false || attempt.process != null || attempt.processBinding != null || attempt.launch != null || !emptyPaths(boundary.writeSet) || !emptyPaths(attempt.writeSet) || !emptyPaths(attempt.leasePaths) || !emptyPaths(attempt.changedPaths) || !isRecord(run.leases) || Object.keys(run.leases).length || attempt.invocationObserved !== true) reject();
    if (store.hasUnresolvedOwnership({ ...run, attempts: run.attempts.filter((/** @type {any} */ item) => item.id !== attempt.id) })) reject();
    if (attempt.snapshotHash !== stableHash([]) || attempt.outputHash !== stableHash([]) || attempt.observationId != null || attempt.acceptanceId != null) reject();
    const produced = [run.observations ?? [], run.evidence, run.reviews, run.plans, run.verifications];
    if (produced.some((items) => !Array.isArray(items) || items.some((/** @type {any} */ artifact) => artifact.attemptId === attempt.id || artifact.boundaryId === boundary.id || artifact.producer?.attemptId === attempt.id || artifact.producer?.boundaryId === boundary.id))) reject();
    const permits = run.permits.filter((/** @type {any} */ permit) => permit.attemptId === attempt.id);
    if (permits.length !== 1) reject();
    const permit = permits[0], invocation = permit.invocation;
    if (permit.status !== "completed" || permit.runId !== run.runId || permit.boundaryId !== boundary.id || !isRecord(invocation) || !isRecord(attempt.invocation) || stableHash(attempt.invocation) !== stableHash(invocation)) reject();
    if (!isNonEmpty(invocation.sessionId) || !isNonEmpty(invocation.turnId) || !isNonEmpty(invocation.toolUseId) || !isNonEmpty(invocation.model) || !isNonEmpty(invocation.cwd) || !isNonEmpty(invocation.at) || !isHash(invocation.policyHash) || invocation.policyHash !== run.policyHash || !isRecord(invocation.rawToolInput)) reject();
    if (run.permits.filter((/** @type {any} */ item) => item.invocation?.sessionId === invocation.sessionId && item.invocation.turnId === invocation.turnId && item.invocation.toolUseId === invocation.toolUseId).length !== 1) reject();
    if (invocation.sessionId !== run.rootSessionId || attempt.sessionId !== invocation.sessionId || attempt.actorId !== invocation.sessionId || attempt.callerActorId !== invocation.sessionId || permit.actorId !== invocation.sessionId || boundary.actorId !== invocation.sessionId || invocation.model !== run.coordinator.model || invocation.reasoning !== run.coordinator.reasoning || await store.canonicalDirectory(invocation.cwd) !== store.hostRootFor(run)) reject();
    if (permit.toolName !== invocation.rawToolName || boundary.toolName !== invocation.rawToolName || !isHash(permit.toolInputHash) || permit.toolInputHash !== stableHash(invocation.rawToolInput) || stableHash(permit.toolInput) !== permit.toolInputHash || stableHash(boundary.toolInput) !== permit.toolInputHash) reject();
    const adapter = permit.adapter, knownAdapter = getAdapterCatalog().find((item) => item.adapterId === adapter?.adapterId && item.toolNames.includes(invocation.rawToolName));
    if (!knownAdapter || !attempt.adapter || stableHash(attempt.adapter) !== stableHash(adapter) || adapter.capability !== knownAdapter.capability || adapter.effect !== knownAdapter.effect || adapter.observationLevel !== knownAdapter.observationLevel || adapter.rawToolName !== invocation.rawToolName || stableHash(adapter.rawToolInput) !== permit.toolInputHash || adapter.toolInputHash !== stableHash({ name: invocation.rawToolName, input: invocation.rawToolInput })) reject();
    // The immutable normalized PostToolUse hash is retained; recovery never imports
    // or reconstructs a transcript to supply missing completion evidence.
    const postEventKey = eventKey({ kind: "hook", hookEventName: "PostToolUse", sessionId: invocation.sessionId, turnId: invocation.turnId, toolUseId: invocation.toolUseId });
    const postEventHash = run.eventKeys?.[postEventKey];
    if (!isHash(postEventHash)) reject();
    await store.assertRunRootOwnership(run);
    const receipt = { id: newId("recovery"), kind: "host-attempt-recovery", runId: run.runId, attemptId: attempt.id, boundaryId: boundary.id, permitId: permit.id,
      postEventKey, postEventHash, invocationHash: stableHash(invocation), originalSessionId: run.rootSessionId, originalModel: run.coordinator.model, originalReasoning: run.coordinator.reasoning,
      operatorSessionId: observer.sessionId, operatorModel: observer.model, operatorReasoning: observer.reasoning, root: run.root, hostRoot: store.hostRootFor(run),
      originalPolicyHash: invocation.policyHash, originalRunPolicyHash: run.policyHash, originalRuntimeHash: isHash(run.capabilityPreflight?.runtimeHash) ? run.capabilityPreflight.runtimeHash : null,
      recoveryPolicyHash: POLICY_HASH, recoveryRuntimeHash: RUNTIME_HASH, previousStatus: attempt.status, status: "failed", reason: input.reason, at: nowIso() };
    run.recoveryReceipts ??= []; run.recoveryReceipts.push(receipt);
    attempt.status = "failed"; attempt.recoveryReceiptId = receipt.id;
    const unfinished = store.hasUnresolvedOwnership(run);
    run.leasePreserved = unfinished; entry.finished = !unfinished;
    await store.writeRegistry(home, registry);
    return run;
  });
}

/** Extract only inline host-returned content, never operator-supplied paths.
 * @param {any} output */
function observedBlocks(output) {
  /** @type {Array<{type:string,text?:string,data?:Buffer,mimeType?:string,declaredMimeType?:string}>} */ const blocks = [];
  let total = 0;
  const addText = (/** @type {string} */ text) => {
    const size = Buffer.byteLength(text);
    if (size > 256 * 1024) throw new GovernanceError("Observed text exceeds the bounded artifact size", "observation_invalid");
    total += size; blocks.push({ type: "text", text });
  };
  /** @param {any} value @param {number} depth */
  const visit = (value, depth) => {
    if (depth > 6 || blocks.length > 32) throw new GovernanceError("Observed content exceeds the bounded block count", "observation_invalid");
    if (typeof value === "string") {
      let parsed; try { parsed = JSON.parse(value); } catch {}
      if (isRecord(parsed) && Array.isArray(parsed.content)) visit(parsed, depth + 1); else addText(value);
      return;
    }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (!isRecord(value)) return;
    if (["image", "image_url", "input_image"].includes(value.type)) {
      let encoded = value.data, mimeType = value.mimeType;
      const url = typeof value.image_url === "string" ? value.image_url : value.image_url?.url ?? value.url;
      if (typeof url === "string") {
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(url);
        if (!match) throw new GovernanceError("Observation images must contain actual inline bytes", "observation_invalid");
        mimeType = match[1]; encoded = match[2];
      }
      if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType) || typeof encoded !== "string" || encoded.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new GovernanceError("Observation image encoding is unsupported", "observation_invalid");
      const data = Buffer.from(encoded, "base64");
      const effectiveMimeType = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "image/jpeg" : data.subarray(0,4).toString() === "RIFF" && data.subarray(8,12).toString() === "WEBP" ? "image/webp" : null;
      if (!effectiveMimeType || !data.length || data.length > 8 * 1024 * 1024 || blocks.filter((block) => block.type === "image").length >= 8) throw new GovernanceError("Observation image bytes are invalid or exceed the limit", "observation_invalid");
      total += data.length; blocks.push({ type: "image", mimeType: effectiveMimeType, ...(mimeType !== effectiveMimeType ? { declaredMimeType: mimeType } : {}), data }); return;
    }
    if (typeof value.text === "string") addText(value.text);
    if (Array.isArray(value.content)) visit(value.content, depth + 1);
    else if (Array.isArray(value.output)) visit(value.output, depth + 1);
    else if (typeof value.text !== "string") addText(JSON.stringify(value));
  };
  visit(output, 0);
  if (!blocks.length || total > 24 * 1024 * 1024) throw new GovernanceError("Observed output is missing or exceeds the total limit", "observation_missing");
  return blocks;
}

/** @param {any} run @param {any} event */
function matchedObservationPermit(run, event) {
  const permit = run.permits.find((/** @type {any} */ item) => item.invocation?.sessionId === event.sessionId && item.invocation.turnId === event.turnId && item.invocation.toolUseId === event.toolUseId && item.toolName === event.toolName && item.toolInputHash === stableHash(event.toolInput));
  if (!permit || !["consumed", "completed"].includes(permit.status) || !permit.adapter || event.hookEventName !== "PostToolUse" || event.model !== permit.invocation.model || event.reasoning !== permit.invocation.reasoning || event.cwd !== permit.invocation.cwd || permit.invocation.policyHash !== POLICY_HASH) throw new GovernanceError("Observed output has no exact current consumed host invocation", "observation_invalid");
  return permit;
}

/** @param {string} runDirectory @param {any} run @param {any} event */
async function persistObservation(runDirectory, run, event) {
  await store.assertRunRoots(run);
  const permit = matchedObservationPermit(run, event), attempt = attemptById(run, permit.attemptId), boundary = boundaryById(run, permit.boundaryId);
  const id = `observation_${stableHash({ runId: run.runId, invocation: permit.invocation }).slice(0,32)}`;
  const output = event.rawOutput ?? event.output;
  const outputHash = stableHash(output ?? null);
  const prior = (run.observations ?? []).find((/** @type {any} */ item) => item.id === id);
  if (prior) {
    if (prior.outputHash !== outputHash) throw new GovernanceError("Observation output conflicts with immutable history", "observation_invalid");
    return prior;
  }
  if (await store.hashPaths(run.root, [...boundary.readSet, ...boundary.writeSet]) !== boundary.scopeHash) throw new GovernanceError("Candidate changed while the host observation was executing", "observation_stale");
  const blocks = observedBlocks(output), directory = join(runDirectory, "observations", id), artifacts = [];
  for (const [index, block] of blocks.entries()) {
    const extension = block.type === "text" ? "txt" : block.mimeType === "image/png" ? "png" : block.mimeType === "image/jpeg" ? "jpg" : "webp";
    const name = `${index}.${extension}`;
    const artifact = await store.writeImmutablePrivate(join(directory, name), block.type === "text" ? /** @type {string} */ (block.text) : /** @type {Buffer} */ (block.data));
    artifacts.push({ name, type: block.type, mimeType: block.mimeType ?? "text/plain", ...(block.declaredMimeType ? { declaredMimeType: block.declaredMimeType } : {}), sha256: artifact.sha256, size: artifact.size });
  }
  const stamp = await acceptanceStamp(run, attempt, "observation");
  const manifest = { id, runId: run.runId, kind: "host-observation", attemptId: attempt.id, boundaryId: boundary.id, invocation: permit.invocation, adapter: permit.adapter, result: classifyToolResult(permit.adapter, output), outputHash, criterionIds: boundary.requirementIds, candidateHash: permit.candidateHash, stamp, artifacts, source: "actual-host-output", createdAt: nowIso() };
  const manifestHash = stableHash(manifest);
  await store.writeImmutablePrivate(join(directory, "manifest.json"), JSON.stringify(manifest));
  const observation = { ...manifest, manifestHash };
  run.observations ??= []; run.observations.push(observation);
  return observation;
}

/** Adapter-only persistence. CLI never accepts imported observations.
 * @param {{runDirectory:string,event:any}} input */
export async function persistObservedToolOutput(input) {
  const event = validateHostEvent(input.event);
  return mutateRun(input.runDirectory, (run) => persistObservation(input.runDirectory, run, event));
}

/** @param {string} runDirectory @param {any} run @param {{observationIds:string[],criterionIds:string[],requireImages:boolean}} selection */
async function assessmentInput(runDirectory, run, selection) {
  if (!isStringArray(selection.observationIds) || !selection.observationIds.length || selection.observationIds.length > 32 || new Set(selection.observationIds).size !== selection.observationIds.length || !isStringArray(selection.criterionIds) || !selection.criterionIds.length || new Set(selection.criterionIds).size !== selection.criterionIds.length || typeof selection.requireImages !== "boolean") throw new GovernanceError("Assessment must select bounded unique observations and criteria", "observation_invalid");
  const criteria = run.criteria.filter((/** @type {any} */ item) => selection.criterionIds.includes(item.id));
  if (criteria.length !== selection.criterionIds.length) throw new GovernanceError("Assessment criteria are unknown", "observation_invalid");
  if (criteria.some((/** @type {any} */ item) => !["observation", "visual"].includes(item.evidenceKind))) throw new GovernanceError("Observation assessment cannot substitute for deterministic checks", "observation_invalid");
  const requireImages = selection.requireImages;
  const observationRefs = [], textInputPaths = [], imagePaths = [], manifests = [];
  for (const id of selection.observationIds) {
    assertSafeId(id, "observationId");
    const observation = (run.observations ?? []).find((/** @type {any} */ item) => item.id === id);
    if (!observation || observation.source !== "actual-host-output") throw new GovernanceError("Selected observation is not governed actual host output", "observation_missing");
    if (!await artifactCurrent(run, observation)) throw new GovernanceError("Selected observation is stale", "observation_stale");
    const manifestPath = join(runDirectory, "observations", id, "manifest.json");
    const bytes = await store.readPrivateArtifact(manifestPath, 512 * 1024);
    let manifest; try { manifest = JSON.parse(bytes.toString()); } catch { throw new GovernanceError("Observation manifest is malformed", "observation_invalid"); }
    if (stableHash(manifest) !== observation.manifestHash) throw new GovernanceError("Observation manifest changed", "observation_invalid");
    for (const artifact of manifest.artifacts) {
      if (!/^[0-9]+\.(?:txt|png|jpg|webp)$/u.test(artifact.name)) throw new GovernanceError("Observation artifact name is invalid", "observation_invalid");
      const path = join(runDirectory, "observations", id, artifact.name), content = await store.readPrivateArtifact(path);
      if (content.length !== artifact.size || sha256Hex(content) !== artifact.sha256) throw new GovernanceError("Observation artifact changed", "observation_invalid");
      if (artifact.type === "image") imagePaths.push(path); else textInputPaths.push(path);
    }
    textInputPaths.push(manifestPath); manifests.push(manifest); observationRefs.push({ id, manifestHash: observation.manifestHash });
  }
  for (const criterion of criteria) {
    const observations = manifests.filter((manifest) => manifest.criterionIds.includes(criterion.id));
    if (!observations.length || ((requireImages || criterion.evidenceKind === "visual") && !observations.some((manifest) => manifest.artifacts.some((/** @type {any} */ artifact) => artifact.type === "image")))) throw new GovernanceError("A criterion has no bound observed image or text", "observation_missing");
  }
  const paths = [...new Set(manifests.flatMap((manifest) => manifest.stamp.paths))].sort();
  const rootIdentity = await store.assertRunRoots(run);
  const candidateHash = stableHash({ root: run.root, ...(rootIdentity ? { rootIdentity } : {}), baseSha: run.baseSha, epoch: run.acceptanceEpoch, snapshotHash: await store.hashPaths(run.root, paths), sources: await currentSourceHashes(run) });
  const bundle = { kind: "observation-assessment-input", runId: run.runId, policyHash: POLICY_HASH, candidateHash, criterionIds: selection.criterionIds, criteria, observationRefs, textInputPaths, imagePaths, requireImages };
  const manifestHash = stableHash(bundle), bundlePath = join(runDirectory, "assessments", `${manifestHash}.json`);
  await store.writeImmutablePrivate(bundlePath, JSON.stringify(bundle));
  return { manifestHash, candidateHash, criterionIds: selection.criterionIds, observationRefs, textInputPaths: [bundlePath, ...textInputPaths], imagePaths };
}

/** @param {{runDirectory:string,observationIds:string[],criterionIds:string[],requireImages:boolean}} input */
export async function buildObservationAssessmentInput(input) {
  const run = await store.loadRun(input.runDirectory);
  return assessmentInput(input.runDirectory, run, input);
}
