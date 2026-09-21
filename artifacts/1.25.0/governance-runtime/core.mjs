// @ts-check

import { randomUUID } from "node:crypto";
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
  isRewind,
  phaseActionAllowed,
  profileFor,
  requiredObligations,
  roleRequiresReasoning,
  sameProvider,
} from "./policy.mjs";
import { classifyWithJev } from "./jev.mjs";
import {
  GovernanceError,
  assertRelativePath,
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
import { tokenizeExactCommand } from "./hook.mjs";
import { parseGovernanceArguments } from "./cli.mjs";

export { stableHash } from "./schemas.mjs";
export { snapshotPaths } from "./store.mjs";

const POLICY_HASH = stableHash({
  endpoint: JEV_ENDPOINT,
  model: JEV_MODEL,
  phaseActions: PHASE_ACTIONS,
  routeCandidates: ROUTE_CANDIDATES,
  actions: ACTIONS,
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
      out[dependency] = { kind: "attempt", status: attempt.status, outputHash: attempt.outputHash ?? null, candidateHash: attempt.candidateHash ?? null };
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
  const scopeHash = await store.hashPaths(run.root, [...proposal.readSet, ...proposal.writeSet]);
  const dependencyHashes = await dependencyHashesFor(run, proposal.dependsOn);
  const sourceHashes = await currentSourceHashes(run, proposal.sourceIds);
  const candidateHash = stableHash({ baseSha: run.baseSha, scopeHash });
  const inputHash = stableHash({
    proposal: proposalFingerprint(proposal),
    sources: sourceHashes,
    policyHash: POLICY_HASH,
    scopeHash,
    dependencyHashes,
    candidateHash,
    evidence: [...run.plans, ...run.reviews, ...run.evidence, ...run.verifications].filter((/** @type {any} */ artifact) => proposal.evidenceRefs.includes(artifact.id) || proposal.action === "close"),
    findings: ["close", "correct", "final-review-return"].includes(proposal.action) ? run.findings : [],
  });
  return { inputHash, scopeHash, dependencyHashes, sourceHashes, candidateHash };
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
 */
export function executionDescriptor(run, proposal) {
  if (proposal.toolName !== "Bash" || Object.keys(proposal.toolInput).some((key) => !["command", "description", "timeout", "timeout_ms"].includes(key))) throw new GovernanceError("dispatch requires actual Bash input with no fabricated profile fields", "tool");
  const argv = tokenizeExactCommand(proposal.toolInput.command);
  const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  if (!argv || !["node", process.execPath].includes(argv[0]) || argv[1] !== cli || argv[2] !== "execute") throw new GovernanceError("dispatch requires the exact installed governance execute command", "tool");
  const parsed = parseGovernanceArguments(argv.slice(2));
  if (resolve(parsed.options["--home"] ?? store.resolveHome(undefined)) !== resolve(run.home) || (parsed.options["--run"] && parsed.options["--run"] !== run.runId)) throw new GovernanceError("dispatch control context does not match this run", "binding");
  if (!parsed.options["--input-json"]) throw new GovernanceError("governed process dispatch requires an exact inline descriptor", "tool");
  let launch; try { launch = JSON.parse(parsed.options["--input-json"]); } catch { throw new GovernanceError("invalid execution descriptor"); }
  if (!isRecord(launch) || Object.keys(launch).some((key) => !["attemptId", "candidateRoot", "packetPath", "check"].includes(key)) || launch.attemptId !== proposal.attemptId) throw new GovernanceError("execution descriptor must select this exact attempt without authority overrides");
  if (launch.packetPath !== undefined && (!isStringArray([launch.packetPath]) || !proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(launch.packetPath, scope)))) throw new GovernanceError("packetPath must be in the hashed read scope");
  const candidateRoot = launch.candidateRoot ?? run.root;
  if (typeof candidateRoot !== "string" || !isAbsolute(candidateRoot)) throw new GovernanceError("execution candidateRoot must be absolute");
  if (proposal.route.role === "writer") {
    if (resolve(candidateRoot) === run.root || resolve(candidateRoot).startsWith(`${run.root}${sep}`)) throw new GovernanceError("writer requires a separate candidate workspace");
  } else if (resolve(candidateRoot) !== run.root || proposal.writeSet.length) throw new GovernanceError("read-only process must inspect the registered candidate root");
  if (proposal.action === "verify") {
    if (proposal.route.provider !== "local" || proposal.route.model !== "deterministic-check" || !isRecord(launch.check) || Object.keys(launch.check).some((key) => !["executable", "argv"].includes(key)) || !isAbsolute(launch.check.executable ?? "") || !isStringArray(launch.check.argv)) throw new GovernanceError("verification requires an approved exact deterministic check");
    if (!launch.check.argv.length || launch.check.argv.some((/** @type {string} */ arg) => /[\u0000-\u001f]/u.test(arg))) throw new GovernanceError("invalid exact check argv");
    const executable = launch.check.executable.split(sep).at(-1);
    if (["sh", "bash", "zsh", "env", "sudo", "opencode", "codex"].includes(executable) || launch.check.argv.some((/** @type {string} */ arg) => ["-c", "-e", "--eval", "-p", "--print"].includes(arg) || /^--(?:eval|print|require|import|loader|input-type)(?:=|$)/u.test(arg) || /^-[ecp].+/u.test(arg))) throw new GovernanceError("check shell wrappers and inline programs are unsupported");
    const files = launch.check.argv.filter((/** @type {string} */ arg) => !arg.startsWith("-") && (arg.includes("/") || /\.(?:js|mjs|cjs|py|json|toml|yaml|yml)$/u.test(arg)));
    for (const path of files) assertRelativePath(path, "check script/config path");
    if (!files.length || files.some((/** @type {string} */ path) => isAbsolute(path) || !proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(path, scope)))) throw new GovernanceError("check script/config must be bound to its read scope");
  } else if (launch.check !== undefined) throw new GovernanceError("only a verifier may select a check command");
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
  const boundary = boundaryById(run, attempt.boundaryId);
  const paths = ["plan", "plan-review"].includes(kind) ? [] : [...boundary.readSet];
  return { root: run.root, paths, snapshotHash: await store.hashPaths(run.root, paths), sources: await currentSourceHashes(run, boundary.sourceIds), epoch: run.acceptanceEpoch ?? 0 };
}

/** @param {any} run @param {any} artifact */
async function artifactCurrent(run, artifact) {
  if (!artifact?.stamp || artifact.invalidated) return false;
  const stamp = artifact.stamp;
  if (!["plan", "plan-review"].includes(artifact.kind) && stamp.epoch !== (run.acceptanceEpoch ?? 0)) return false;
  return stamp.snapshotHash === await store.hashPaths(run.root, stamp.paths)
    && stableHash(stamp.sources) === stableHash(await currentSourceHashes(run, stamp.sources.map((/** @type {any} */ source) => source.id)));
}

/** @param {any} run @param {any} proposal */
async function assertBoundarySemantics(run, proposal) {
  if (proposal.actorId !== run.rootSessionId) throw new GovernanceError("only the observed coordinator may request a boundary");
  if (!proposal.requirementIds.length || new Set(proposal.requirementIds).size !== proposal.requirementIds.length || proposal.requirementIds.some((/** @type {string} */ id) => !run.criteria.some((/** @type {any} */ c) => c.id === id))) throw new GovernanceError("boundary requires unique known criteria");
  if (!proposal.sourceIds.length || proposal.sourceIds.some((/** @type {string} */ id) => !run.sources.some((/** @type {any} */ source) => source.id === id))) throw new GovernanceError("boundary requires known canonical sources");
  if (proposal.action === "inspect") {
    if (proposal.writeSet.length || proposal.route.role !== "coordinator" || proposal.toolName !== "Bash") throw new GovernanceError("inspect is an exact coordinator read with empty write scope");
    const argv = tokenizeExactCommand(proposal.toolInput.command);
    if (!argv || !["cat", "pwd", "ls", "rg"].includes(argv[0])) throw new GovernanceError("inspect supports exact cat, pwd, ls or rg reads only");
    if (argv[0] === "pwd" && argv.length !== 1) throw new GovernanceError("inspect pwd takes no arguments");
    const flags = new Set(["-n", "-l", "-i", "-S", "--files", "--hidden", "-a", "-la", "-1"]);
    if (argv.slice(1).some((arg) => arg.startsWith("-") && !flags.has(arg))) throw new GovernanceError("inspect read flag is unsupported");
    const values = argv.slice(1).filter((arg) => !arg.startsWith("-"));
    const paths = argv[0] === "rg" && !argv.includes("--files") ? values.slice(1) : values;
    if (["cat", "rg"].includes(argv[0]) && !paths.length) throw new GovernanceError("inspect must declare bounded read paths");
    for (const path of paths) { assertRelativePath(path, "inspect path"); if (!proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(path, scope))) throw new GovernanceError("inspect path is outside its declared read scope"); }
  }
  if (DISPATCH_ACTIONS.includes(proposal.action)) executionDescriptor(run, proposal);
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
        const artifact = [...run.plans, ...run.reviews, ...run.verifications].find((/** @type {any} */ entry) => entry.id === attempt.acceptanceId);
        if (!await artifactCurrent(run, artifact) || artifact.verdict === "revise") throw new GovernanceError("return evidence is stale or requires correction");
      }
    }
  }
  if (["final-review", "verify", "close"].includes(proposal.action)) {
    for (const path of run.candidatePaths ?? []) if (!proposal.readSet.some((/** @type {string} */ scope) => pathContainedBy(path, scope))) throw new GovernanceError("acceptance scope omits an integrated candidate path");
    if (proposal.requirementIds.length !== run.criteria.length) throw new GovernanceError("acceptance must cover every criterion");
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

/** @param {any} run */
function completedContext(run) {
  const plan = run.plans.at(-1) ?? null;
  return {
    activeOwnership: activeAttempts(run).map((/** @type {any} */ attempt) => ({ id: attempt.id, status: attempt.status, role: attempt.role, provider: attempt.provider, readSet: attempt.readSet, writeSet: attempt.leasePaths })),
    capacity: run.capacity,
    dependencies: run.attempts.map((/** @type {any} */ attempt) => ({ id: attempt.id, status: attempt.status, executionKind: attempt.expectedProcess ? "attached-process" : "ordinary-host-tool", invocationObserved: attempt.invocationObserved === true, terminationObserved: attempt.expectedProcess ? attempt.process?.terminated === true : null, actorId: attempt.actorId, sessionId: attempt.sessionId, outputHash: attempt.outputHash, returnedObservation: attempt.returnedObservation ?? null })),
    actors: run.actors.map((/** @type {any} */ actor) => ({ id: actor.id, role: actor.role, sessionId: actor.sessionId, provider: actor.provider, model: actor.model, reasoning: actor.reasoning, provenance: actor.provenance })),
    plans: run.plans.map((/** @type {any} */ entry) => ({ id: entry.id, summary: entry.summary, criterionIds: entry.criterionIds, packets: entry.packets, invalidated: entry.invalidated === true })),
    reviews: run.reviews.map((/** @type {any} */ review) => ({ id: review.id, kind: review.kind, verdict: review.verdict, actorId: review.actorId, sessionId: review.sessionId, criterionIds: review.criterionIds, findings: review.findings, invalidated: review.invalidated === true })),
    findings: run.findings,
    verifications: run.verifications.map((/** @type {any} */ verification) => ({ id: verification.id, attemptId: verification.attemptId, actorId: verification.actorId, sessionId: verification.sessionId, command: verification.command, candidateHash: verification.candidateHash, results: verification.results, invalidated: verification.invalidated === true })),
    planAuthorActorId: plan?.actorId ?? null,
    planAuthorSessionId: plan?.sessionId ?? null,
    ticketStatuses: run.tickets.map((/** @type {any} */ ticket) => ({ id: ticket.id, dependsOn: ticket.dependsOn, status: ticket.status })),
  };
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
    transport: result.transport ?? "live",
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
    transport: "unavailable",
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
    return { result: insufficientObligations(run, proposal, profile.reason), transport: "deterministic" };
  }
  try { await assertBoundarySemantics(run, proposal); }
  catch (error) { return { result: insufficientObligations(run, proposal, error instanceof Error ? error.message : "boundary semantics are invalid"), transport: "deterministic" }; }

  let input;
  try {
    input = await computeBoundaryInput(run, proposal);
  } catch (error) {
    return { result: insufficientObligations(run, proposal, error instanceof Error ? error.message : "boundary inputs are unavailable"), transport: "deterministic" };
  }

  const classification = await classifyWithJev({
    run,
    proposal,
    obligations,
    candidates,
    completed: completedContext(run),
    home: options?.home,
    env: options?.env,
    transport: /** @type {any} */ (options?.transport),
    timeoutMs: options?.timeoutMs,
  });
  if (!classification.ok) {
    return { result: insufficientObligations(run, proposal, classification.reason), input, transport: options?.transport ? "injected" : "live" };
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
  await store.withHomeLock(home, async () => {
    const registry = await store.readRegistry(home);
    registry.sessions[observation.sessionId] = observation;
    await store.writeRegistry(home, registry);
  });
  return observation;
}

/** Read the stored host observation for a session; never invents identity.
 * @param {{home?: string, sessionId: string}} input */
export async function getHostSession(input) {
  const home = store.resolveHome(input.home);
  return store.readSessionObservation(home, input.sessionId);
}

/** @param {string} home @param {string} sessionId */
export async function resolveRunDirectory(home, sessionId) {
  return store.registryRunDirectory(store.resolveHome(home), sessionId);
}

/**
 * @param {{home?: string, contract: unknown, activation: unknown}} input
 */
export async function createRun(input) {
  const home = store.resolveHome(input.home);
  const contract = validateContract(input.contract, { endpoint: JEV_ENDPOINT });
  const root = await store.canonicalDirectory(contract.root);
  const observation = await store.readSessionObservation(home, isRecord(input.activation) ? String(input.activation.sessionId ?? "") : "");
  if (!observation) throw new GovernanceError("activation requires a stored host observation; register the session first", "activation");
  validateActivation(input.activation, /** @type {any} */ (observation));
  if (await store.canonicalDirectory(observation.cwd) !== root) throw new GovernanceError("contract root does not match the actual observed session root", "activation");
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
    runId,
    home,
    root,
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
  };

  await store.ensureDirectory(runDirectory);
  await store.withHomeLock(home, async () => {
    const registry = await store.readRegistry(home);
    const unfinished = Object.values(registry.runs).find((/** @type {any} */ entry) => (entry.rootSessionId === observation.sessionId || entry.root === root) && entry.finished !== true);
    if (unfinished) throw new GovernanceError("this session already owns an unfinished run; close it before starting another", "binding");
    if (registry.runs[runId] || await store.pathExists(store.runSnapshotPath(runDirectory))) throw new GovernanceError("run id already exists; published run history cannot be replaced", "binding");
    await store.saveRun(runDirectory, run);
    registry.runs[runId] = { runId, runDirectory, rootSessionId: observation.sessionId, root, finished: false };
    await store.writeRegistry(home, registry);
  });
  return run;
}

/**
 * @param {{runDirectory: string, proposal: unknown, transport?: Function, home?: string, env?: Record<string,string|undefined>, timeoutMs?: number}} input
 */
export async function classifyBoundary(input) {
  const run = await store.loadRun(input.runDirectory);
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

    const current = await computeBoundaryInput(run, boundary);
    if (current.inputHash !== judgment.inputHash) throw new GovernanceError("boundary inputs changed; classify a fresh proposal", "stale");

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
      toolName: action.toolName,
      toolInput: action.toolInput,
      toolInputHash: stableHash(action.toolInput),
      scopeHash: current.scopeHash,
      inputHash: current.inputHash,
      dependencyHashes: current.dependencyHashes,
      candidateHash: current.candidateHash,
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
    if (event.sessionId === run.rootSessionId && observedModel !== run.coordinator.model) {
      return { decision: "deny", reason: "root event model does not match the observed coordinator", permitId: prepared.id };
    }
    if (prepared.actorId !== run.rootSessionId && !run.childSessions[event.sessionId]) {
      return { decision: "deny", reason: "native child attribution is unproven; writable permit denied", permitId: prepared.id };
    }

    const boundary = boundaryById(run, prepared.boundaryId);
    if (boundary.phase !== run.phase) return { decision: "deny", reason: "permit phase is no longer current", permitId: prepared.id };
    const recomputed = await computeBoundaryInput(run, boundary);
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
      assertCapacity(run, prepared.provider);
    } catch {
      prepared.status = "failed";
      return { decision: "deny", reason: "provider capacity is exhausted", permitId: prepared.id };
    }

    if (run.permits.some((/** @type {any} */ permit) => permit.invocation?.sessionId === event.sessionId && permit.invocation.turnId === event.turnId && permit.invocation.toolUseId === event.toolUseId)) return { decision: "deny", reason: "host invocation already consumed", permitId: prepared.id };
    prepared.status = "consumed";
    prepared.invocation = { sessionId: event.sessionId, turnId: event.turnId, toolUseId: event.toolUseId, at: nowIso() };

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
      expectedProcess: DISPATCH_ACTIONS.includes(boundary.action),
      launch: DISPATCH_ACTIONS.includes(boundary.action) ? executionDescriptor(run, boundary) : null,
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
    const findings = parsed.findings.map((/** @type {any} */ finding) => {
      if (!isRecord(finding) || !isNonEmpty(finding.id) || !isStringArray(finding.criterionIds) || !finding.criterionIds.length || finding.criterionIds.some((/** @type {string} */ id) => !boundary.requirementIds.includes(id)) || !["blocking", "blocker", "high", "medium", "low"].includes(finding.severity) || !isNonEmpty(finding.message)) throw new GovernanceError("review finding is malformed", "malformed");
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
  if (parsed.kind === "verification") {
    if (attempt.role !== "verifier" || attempt.provider !== "local" || attempt.model !== "deterministic-check" || !attempt.launch?.check || stableHash(attempt.process.command) !== stableHash(attempt.launch.check)) throw new GovernanceError("verification requires the actual approved check command", "role");
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
      const candidateRoot = await store.canonicalDirectory(event.candidateRoot);
      if (candidateRoot !== await store.canonicalDirectory(attempt.launch.candidateRoot)) throw new GovernanceError("process candidate root differs from the consumed dispatch");
      const check = attempt.launch.check;
      if (check && stableHash(event.command) !== stableHash(check)) throw new GovernanceError("actual check command differs from its approved exact argv");
      if (!check) {
        const argv = event.command.argv;
        const model = argv[argv.indexOf("--model") + 1];
        const effort = argv[argv.indexOf("--variant") + 1];
        const codex = sameProvider(attempt.provider, "codex");
        const valid = model === attempt.model && (codex
          ? argv[0] === "exec" && argv.includes("read-only") && argv.includes(`model_reasoning_effort="${attempt.reasoning}"`) && !argv.some((/** @type {string} */ arg) => ["resume", "fork", "--ignore-user-config", "--dangerously-bypass-approvals-and-sandbox"].includes(arg))
          : argv[0] === "run" && effort === attempt.reasoning && argv.includes("--pure"));
        if (!valid) throw new GovernanceError("actual process command does not pin the designated profile");
      }
      if (event.kind === "process-start") {
        if (attempt.process || attempt.status !== "running") throw new GovernanceError("process attempt already started or is not runnable");
        if (!attempt.processBinding || attempt.processBinding.candidateRoot !== candidateRoot || stableHash(attempt.processBinding.command) !== stableHash(event.command)) throw new GovernanceError("process candidate and command were not bound before spawn");
        attempt.process = { processId: event.processId, candidateRoot, command: event.command, terminated: false };
        attempt.identityUnconfirmed = true;
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
      const cancelled = attempt.cancelled === true || attempt.status === "cancelling" || event.cancelled === true;
      attempt.cancelled = cancelled;
      const identity = event.model !== "unknown" && event.processSessionId && sameProvider(event.provider, attempt.provider) && event.model === attempt.model && event.reasoning === attempt.reasoning;
      if (!identity || attempt.identityMismatch || cancelled) {
        attempt.status = "failed"; attempt.identityMismatch = !identity || attempt.identityMismatch;
        releaseLeases(run, attempt.id);
        return { ok: false, status: "failed", reason: cancelled ? "cancelled process cannot produce acceptance" : "actual process profile/session is unconfirmed or mismatched" };
      }
      if (run.actors.some((/** @type {any} */ actor) => actor.sessionId === event.processSessionId)) throw new GovernanceError("fresh process session was already used by another actor");
      attempt.actorId = `process_${attempt.id}`; attempt.sessionId = event.processSessionId;
      attempt.observed = { provider: event.provider, model: event.model, reasoning: event.reasoning, processSessionId: event.processSessionId };
      attempt.identityUnconfirmed = false;
      ensureActor(run, { id: attempt.actorId, role: attempt.role, ...attempt.observed, sessionId: attempt.sessionId, parentActorId: run.rootSessionId, provenance: "observed-process", status: "terminated" });
      try {
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
        attempt.invocationObserved = true; permit.status = "completed";
        if (attempt.expectedProcess) {
          if (!attempt.process?.terminated) return { ok: false, status: "recovery-required", reason: "outer tool returned without matching observed process termination" };
          if (attempt.status === "awaiting-post") attempt.status = "completed";
          return { ok: attempt.status === "completed", status: attempt.status };
        }
        if (attempt.status !== "running") return { ok: false, status: attempt.status };
        try {
          await reconcileScope(run, attempt, event.changedPaths.length ? event.changedPaths : attempt.leasePaths);
          const boundary = boundaryById(run, attempt.boundaryId);
          if (boundary.action === "integrate") for (const dependency of boundary.dependsOn) {
            const writer = attemptById(run, dependency);
            if (writer?.role !== "writer") continue;
            const candidate = await store.hashPaths(writer.process.candidateRoot, writer.leasePaths);
            if (candidate !== writer.snapshotHash || await store.hashPaths(run.root, writer.leasePaths) !== candidate) throw new GovernanceError("integration does not match the observed writer candidate bytes");
          }
          attempt.status = "completed";
          run.candidatePaths = [...new Set([...run.candidatePaths, ...attempt.leasePaths])].sort();
          if (attempt.leasePaths.length) run.acceptanceEpoch += 1;
        } catch { attempt.status = "recovery-required"; return { ok: false, status: attempt.status }; }
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
    const candidateRoot = await store.canonicalDirectory(input.candidateRoot);
    if (candidateRoot !== await store.canonicalDirectory(attempt.launch.candidateRoot)) throw new GovernanceError("candidate binding does not match dispatch");
    const paths = [...new Set([...boundary.readSet, ...boundary.writeSet, ...run.sources.filter((/** @type {any} */ source) => boundary.sourceIds.includes(source.id)).map((/** @type {any} */ source) => source.path)])];
    if (await store.hashPaths(candidateRoot, paths) !== await store.hashPaths(run.root, paths)) throw new GovernanceError("writer candidate does not contain the current parent dependency inputs");
    attempt.processBinding = { candidateRoot, command: input.command, baseline: attempt.role === "writer" ? await store.snapshotRepository(candidateRoot) : null };
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

/** @param {{runDirectory:string,transition:unknown}} input */
export async function advancePhase(input) {
  const transition = validateTransition(input.transition);
  return mutateRun(input.runDirectory, async (run) => {
    if (run.phase === "closed") throw new GovernanceError("run is closed");
    const boundary = boundaryById(run, transition.boundaryId);
    if (!boundary || boundary.phase !== run.phase) throw new GovernanceError("transition judgment must belong to the current phase");
    await requireCurrentJudgment(run, boundary);
    await assertBoundarySemantics(run, boundary);
    if (activeAttempts(run).length) throw new GovernanceError("cannot change phase while ownership/completion remains active");
    if (isAdjacentForward(run.phase, transition.to)) {
      const required = /** @type {Record<string,string>} */ ({ intake: "intake-review", research: "research-return", plan: "plan-return", "plan-review": "plan-review-return", implementation: "writer-return", integration: "integration-return", "final-review": "final-review-return" })[run.phase];
      if (boundary.action !== required) throw new GovernanceError("phase advance requires its completed return boundary");
      for (const prerequisite of /** @type {Record<string,readonly string[]>} */ (PHASE_PREREQUISITES)[transition.to] ?? []) if (!await prerequisiteSatisfied(run, prerequisite)) throw new GovernanceError(`phase ${transition.to} requires ${prerequisite}`);
    } else if (isRewind(run.phase, transition.to) && boundary.action === "correct") {
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
    run.phase = transition.to; run.phaseReason = transition.reason;
    return run;
  });
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
