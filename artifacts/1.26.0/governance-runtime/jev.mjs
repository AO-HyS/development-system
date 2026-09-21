// @ts-check

import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import {
  GovernanceError,
  isRecord,
  stableHash,
  sha256Hex,
} from "./schemas.mjs";
import {
  JEV_ENDPOINT,
  JEV_MAX_CRITERIA,
  JEV_MAX_REQUEST_BYTES,
  JEV_MAX_SOURCE_EXCERPT_BYTES,
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  DISPATCH_ACTIONS,
  profileFor,
  OBLIGATION_MEANINGS,
  PRIORITY_LABELS,
  TOOL_LABELS,
} from "./policy.mjs";
import { readBoundedText, resolveHome, snapshotPaths } from "./store.mjs";

export const THREE_LABELS = Object.freeze(["satisfied", "violated", "insufficient_evidence"]);

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function checkedKey(value, label) {
  if (typeof value !== "string") throw new GovernanceError(`${label} must be a string`);
  const key = value.trim();
  if (!key || /[\s\u0000-\u001f\u007f]/u.test(key)) throw new GovernanceError(`${label} must be one non-empty token`);
  return key;
}

/**
 * Load the Jev credential privately. Never logs the secret or a provider body.
 * @param {{home?: string, env?: Record<string, string | undefined>}} [options]
 * @returns {Promise<string | null>}
 */
export async function loadApiKey(options = {}) {
  const env = options.env ?? process.env;
  if (typeof env.TYPESAFE_API_KEY === "string" && env.TYPESAFE_API_KEY.trim()) return checkedKey(env.TYPESAFE_API_KEY, "TYPESAFE_API_KEY");
  const home = resolveHome(options.home);
  const explicit = env.TYPESAFE_ENV_FILE?.trim();
  const path = explicit ?? join(home, ".development-system", "private", "secrets", "typesafe.env");
  const contents = await readBoundedText(path, 64 * 1024);
  if (contents === null) {
    if (explicit) throw new GovernanceError("TYPESAFE_ENV_FILE is unavailable or is not a readable regular file");
    return null;
  }
  const assignments = [...contents.matchAll(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*([^\r\n]*)$/gmu)];
  if (assignments.length !== 1) throw new GovernanceError("private credential file requires exactly one TYPESAFE_API_KEY assignment");
  let value = assignments[0][1].trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    if (value.length < 2 || value.at(-1) !== value[0]) throw new GovernanceError("private credential assignment has unmatched quotes");
    value = value.slice(1, -1);
  }
  return checkedKey(value, "TYPESAFE_API_KEY");
}

/**
 * @param {readonly string[]} obligations
 * @param {readonly string[]} candidates
 * @param {{priority:boolean, tool:boolean}} applicability
 */
export function buildQuestions(obligations, candidates, applicability) {
  /** @type {Record<string, any>} */
  const questions = {};
  for (const obligation of obligations) {
    questions[`obligation:${obligation}`] = {
      type: "choice",
      instructions: /** @type {Record<string,string>} */ (OBLIGATION_MEANINGS)[obligation] ?? `Is the ${obligation} obligation satisfied?`,
      criteria: {
        satisfied: "The supplied evidence satisfies this obligation for the current phase and action.",
        violated: "The supplied evidence contradicts this obligation or shows it is not met.",
        insufficient_evidence: "The supplied evidence does not establish this obligation either way.",
      },
    };
  }
  questions.route = {
    type: "choice",
    instructions: "Choose the target role for this boundary among the proposed candidates only. This is a target, not an execution grant. Do not invent a role.",
    criteria: Object.fromEntries(candidates.map((role) => [role, `Route this boundary to the ${role} role.`])),
  };
  if (applicability.tool) {
    questions.tool = {
      type: "choice",
      instructions: "Do the named tool and normalized arguments comply with the route, scope and approved tool set for this action?",
      criteria: {
        compliant: "The tool and arguments are permitted and pin the matching target model/effort.",
        noncompliant: "The tool or arguments violate scope, route or the approved tool set.",
        insufficient_evidence: "Tool compliance cannot be established from the supplied evidence.",
      },
    };
  }
  if (applicability.priority) {
    questions.priority = {
      type: "choice",
      instructions: "What is the correct next ordering priority for this boundary given the declared dependencies?",
      criteria: {
        execute_now: "Dependencies are complete and this boundary may execute now.",
        wait_for_dependency: "A declared dependency is incomplete and this boundary must wait.",
        blocked: "This boundary cannot proceed and requires a correction or new decision.",
      },
    };
  }
  return questions;
}

/**
 * @param {any} run
 * @param {any} proposal
 * @param {any} sources
 * @param {any} criteria
 * @param {any} completed
 */
function buildState(run, proposal, sources, criteria, completed) {
  return {
    run: { runId: run.runId, root: run.root, baseSha: run.baseSha, phase: run.phase, taskKind: run.taskKind ?? "implementation", endpoint: run.endpoint, authorization: run.authorization, observedCoordinator: run.coordinator, integratedCandidatePaths: run.candidatePaths ?? [] },
    policy: {
      executionRequested: DISPATCH_ACTIONS.includes(proposal.action) || !["governance", "control"].includes(proposal.toolName),
      boundaryKind: ["governance", "control"].includes(proposal.toolName) ? "non-executing-control-boundary" : DISPATCH_ACTIONS.includes(proposal.action) ? "process-dispatch-readiness" : "ordinary-tool-permit",
      lifecycleContract: run.taskKind === "audit" ? "Audit order: intake, research, authored plan, independent plan review, independent final review, actual criterion evidence, closure. Audit omits only writer and integration; every review and evidence gate remains required." : "Implementation order: intake, research, authored plan, independent plan review, writers, integration, independent final review, actual criterion evidence, closure.",
      routeValidation: profileFor(proposal.route.role, proposal.route, run.coordinator),
      routeContract: "The coordinator retains the actual observed starting profile. Research uses approved fast profiles; planner/reviewer use Astra xhigh; writer uses Flash high; exact checks use local/deterministic-check. A dispatch selects a target distinct from the caller; actual target identity is required only after process launch.",
      processLaunchContract: "The registered execute adapter starts a fresh Codex exec process for each planner/reviewer, never resume or fork. It supplies only the current contract, declared packet and applicable stored plan/findings; no author conversation. Return acceptance requires actual new session metadata and a distinct observed actor. The current proposal actorId is the dispatching coordinator, not the future process reviewer.",
      toolContract: ["governance", "control"].includes(proposal.toolName)
        ? "governance with empty toolInput is the registered non-executing control interface for intake, returns, corrections and closure. It does not dispatch a model or run a command; model-pinning flags are inapplicable. It can evaluate observed evidence but cannot import success."
        : "Bash process dispatch uses the exact installed governance execute command. Its descriptor selects the stored attempt and optional isolated candidate/check; the target model and effort are derived exclusively from the already validated stored route, never fabricated extra Bash fields. Ordinary tool permits bind exact toolInput and hashed read/write scope.",
    },
    boundary: {
      id: proposal.id,
      phase: proposal.phase,
      action: proposal.action,
      objective: proposal.objective,
      actorId: proposal.actorId,
      attemptId: proposal.attemptId,
      route: proposal.route,
      toolName: proposal.toolName,
      toolInputHash: stableHash(proposal.toolInput),
      toolInput: proposal.toolInput,
      requirementIds: proposal.requirementIds,
      sourceIds: proposal.sourceIds,
      readSet: proposal.readSet,
      writeSet: proposal.writeSet,
      dependsOn: proposal.dependsOn,
      observations: proposal.observations,
      evidenceRefs: proposal.evidenceRefs,
    },
    sources,
    criteria,
    completed: { ...completed, requiredDependencies: (completed.dependencies ?? []).filter((/** @type {any} */ entry) => proposal.dependsOn.includes(entry.id)) },
  };
}

/**
 * @param {any} run @param {any} proposal @param {readonly string[]} obligations @param {readonly string[]} candidates
 * @param {any} sources @param {any} criteria @param {any} completed
 * @param {{priority:boolean, tool:boolean}} applicability
 */
export function buildBody(run, proposal, obligations, candidates, sources, criteria, completed, applicability) {
  const state = buildState(run, proposal, sources, criteria, completed);
  const questions = buildQuestions(obligations, candidates, applicability);
  if (questions["obligation:unresolved_findings"]) questions["obligation:unresolved_findings"] = {
    type: "choice",
    instructions: "Inspect the actual `state.completed.findings` records. Does any recorded gating finding still require resolution? Historical failed process attempts are not review findings. A future verification check is assessed under criterion_evidence, not this finding-list question.",
    criteria: {
      satisfied: "The supplied findings list is empty, or every gating finding has resolved=true.",
      violated: "At least one supplied finding has gating=true and resolved=false.",
      insufficient_evidence: "The findings list is missing or its gating/resolution facts cannot be established.",
    },
  };
  if (questions["obligation:every_ticket"]) questions["obligation:every_ticket"] = {
    type: "choice",
    instructions: "For every ticket in state.completed.ticketStatuses, find its criteria in state.criteria and their latest actual verification results in state.completed.verifications. Can every ticket be accepted at this closure? Ticket status remains pending until close atomically marks it accepted; that pre-close status is not a missing check.",
    criteria: {
      satisfied: "Every linked ticket has at least one criterion and every one of those criteria has a current passing verification result; none is omitted.",
      violated: "A linked ticket or one of its criteria is omitted, or its latest verification result fails.",
      insufficient_evidence: "At least one ticket lacks a clear criterion mapping or current actual verification result.",
    },
  };
  if (questions.priority) questions.priority.instructions = "Judge the next order using boundary.dependsOn and completed.requiredDependencies. Only named dependencies are prerequisites of this proposal; a superseded failed attempt elsewhere in history is not automatically a new dependency. An ordinary-host-tool completes through its matching observed PostToolUse and needs no child process exit; an attached-process needs observed termination. Current missing requirements or ownership conflicts still block execution.";
  if (DISPATCH_ACTIONS.includes(proposal.action) && questions["obligation:context"]) {
    questions["obligation:context"] = {
      type: "choice",
      instructions: "Inspect the target role, objective, canonical sources, declared readable paths and applicable completed artifacts. Can a fresh worker begin this exact packet by reading those inputs without needing the coordinator's hidden conversation? Reviewers must receive the existing plan/candidate being reviewed. The worker may inspect its declared paths; its future findings are not prerequisites.",
      criteria: {
        satisfied: "The task and constraints are explicit, required prior artifacts are supplied, and the worker can inspect named current inputs to perform this bounded role.",
        violated: "The packet contradicts its required inputs or expressly depends on unavailable hidden context.",
        insufficient_evidence: "A required prior artifact, relevant input location or material task decision is missing or too ambiguous to begin this role.",
      },
    };
  }
  const control = ["governance", "control"].includes(proposal.toolName);
  if (!control && !DISPATCH_ACTIONS.includes(proposal.action)) {
    state.policy.toolContract = "This is an ordinary exact tool invocation by the observed coordinator, not a model launch. Supported reads and scoped patches do not carry model-pinning flags. Integration applies observed worker candidate bytes under parent ownership; a new writer must use a separate writer-dispatch.";
    if (questions["obligation:tool"]) questions["obligation:tool"].instructions = "Judge the exact ordinary tool input against the proposed action and owned scope. No model is launched by this tool; model-pinning flags are inapplicable. A coordinator can apply a scoped patch to integrate the observed writer candidate.";
    if (questions.tool) {
      questions.tool.instructions = "Judge the exact ordinary coordinator tool under state.policy.toolContract and the declared owned scope. This is not a worker/model dispatch.";
      questions.tool.criteria.compliant = "The exact tool and arguments fit this coordinator action and stay within the declared scope.";
    }
  }
  if (control) {
    if (questions["obligation:tool"]) questions["obligation:tool"].instructions = "This is a non-executing governance control boundary. Judge whether its registered control interface and empty toolInput fit the requested intake/return/correction/closure. Do not require an execution command or model flags: no tool dispatch is requested.";
    if (questions.tool) {
      questions.tool.instructions = "Judge this non-executing governance control interface under state.policy.toolContract. Model pinning and execution arguments are inapplicable to control classification.";
      questions.tool.criteria.compliant = "The registered governance control interface and arguments comply with this non-executing action.";
    }
  }
  if (questions["obligation:route"]) questions["obligation:route"].instructions = "Using state.run.observedCoordinator and state.policy.routeValidation/routeContract, judge the proposed role profile. Control boundaries retain the observed coordinator; dispatch target identity is distinct and will be observed after launch.";
  if (proposal.action === "intake-review" && questions["obligation:context"]) questions["obligation:context"].instructions = "Judge whether retained user authorization, delivery endpoint, criteria, selected complete canonical sources and observed coordinator provide sufficient intake context to enter research. A completed implementation, research result or plan is not required at intake.";
  if (proposal.action === "research-dispatch" && questions["obligation:context"]) questions["obligation:context"].instructions = "Judge whether the bounded research question, canonical requirements/rules and named readable paths are sufficient for the researcher to begin investigating. The research process is expected to inspect those paths and discover facts; completed research findings and full contents of each investigation target are not dispatch prerequisites. Unspecified objectives or missing authorization remain insufficient.";
  if (proposal.action === "research-return" && questions["obligation:context"]) questions["obligation:context"].instructions = "Judge the actual completed dependency returnedObservation as a research handoff: does it identify the relevant paths, criterion mapping, repository constraints and remaining unknowns needed to begin planning? This reconciles read-only findings, not implemented code or a finished plan. Material unresolved research facts remain insufficient.";
  if (["research-return", "plan-return", "plan-review-return"].includes(proposal.action) && questions["obligation:completed_coverage"]) {
    questions["obligation:completed_coverage"] = {
      type: "choice",
      instructions: `For this ${proposal.action}, inspect state.completed.requiredDependencies and their bound state.completed.returnedArtifacts (research uses the dependency returnedObservation). Compare their criterionIds and actual content with state.criteria selected by boundary.requirementIds. Were all selected criteria addressed by the returning role? Artifact source, role, producer identity and current stamp are supplied separately from the coordinator's claims. This is coverage of research, planning or plan review; implementation and behavioral acceptance come in later phases.`,
      criteria: {
        satisfied: "The current returned role artifact addresses every declared criterion, without dropping any from research, planning or plan review.",
        violated: "The returned artifact omits or explicitly excludes at least one declared criterion from this role's coverage.",
        insufficient_evidence: "The required returned artifact or its criterion mapping is missing or too unclear to establish coverage.",
      },
    };
  }
  if (proposal.action === "plan-return" && questions["obligation:context"]) questions["obligation:context"] = {
    type: "choice",
    instructions: "Inspect the completed planner dependency and its bound current plan in state.completed.returnedArtifacts. Does the actual summary and packet sequence provide enough criterion, source, scope and verification direction for the next independent plan reviewer? The plan is a completed authoring output; its proposed future reviews and criterion checks are not completed behavioral evidence. Missing material planning decisions still block the handoff.",
    criteria: {
      satisfied: "The bound current authored plan gives the next reviewer explicit scope, ordered work and verification direction for the selected criteria.",
      violated: "The actual authored plan contradicts the contract or relies on hidden context or unsupported acceptance claims.",
      insufficient_evidence: "A current bound planner artifact or material planning direction is missing or unclear.",
    },
  };
  if (proposal.action === "verify" && completed.verificationDispatch?.kind === "observation-assessment" && questions["obligation:approved_check_identity"]) questions["obligation:approved_check_identity"] = {
    type: "choice",
    instructions: "This selected check is independent observation assessment. Inspect state.completed.verificationDispatch: designated fresh Astra profile, exact runtime bundle manifest/candidate hashes, selected criteria, observation refs and actual private text/image artifact identities. Does this define an appropriate reproducible assessment input for those criteria? The process adapter attaches each declared image via --image; observed process identity and assessment outcomes are checked after execution. A shell assertion is not the selected evidence kind.",
    criteria: {
      satisfied: "The current runtime-bound observation bundle and exact designated independent evaluator cover the selected observation/visual criteria, including image assets for visual criteria.",
      violated: "The selected evaluator or assets contradict the criteria, substitute shell success for visual judgment, or include an unsupported producer or input identity.",
      insufficient_evidence: "The selected criterion mapping, evaluator identity or current observation/image asset binding is missing or ambiguous.",
    },
  };
  if (proposal.action === "verify-return" && questions["obligation:criterion_evidence"]) questions["obligation:criterion_evidence"].instructions = "For exactly boundary.requirementIds, inspect actual results in the dependency-bound current returned verification artifacts. Does each selected criterion have passing evidence from its designated producer? Other criteria remain required at final closure but are not silently attributed to this verifier's subset. Failed or insufficient outcomes cannot pass this return.";
  if (proposal.action === "correct") {
    if (questions["obligation:order"]) questions["obligation:order"] = {
      type: "choice",
      instructions: "Inspect state.completed.correctionState: current phase, actual allowed actions, active attempts, retained leases, observed failed-attempt termination and current phase prerequisites. This boundary prepares a correction; it does not advance the phase or execute a replacement. Is correction preparation correctly ordered under those recorded facts and the named dependencies? A terminated rejected result is an observed reason for correction, not a missing successful prerequisite unless explicitly named as such.",
      criteria: {
        satisfied: "Correction is an allowed current-phase action and its bounded preparation respects actual dependencies and any retained ownership.",
        violated: "The proposal skips a required phase, treats unresolved ownership as released, or executes an unpermitted replacement.",
        insufficient_evidence: "The applicable phase, dependency or ownership facts needed to order this correction are unavailable or ambiguous.",
      },
    };
    if (questions["obligation:context"]) questions["obligation:context"] = {
      type: "choice",
      instructions: "Compare the runtime-recorded correctionState failed attempts, typed failure diagnostics and actual prerequisites with this correction objective, declared sources and observations. Is enough context supplied to prepare the stated bounded repair or fresh retry? The rejected result remains rejected; a future successful replacement is not a prerequisite for preparing its correction. An actual unresolved finding must be retained and addressed, not silently dropped.",
      criteria: {
        satisfied: "Recorded failure facts and current inputs identify a bounded next step that addresses the failure while retaining findings and acceptance gates.",
        violated: "The correction contradicts the recorded failure, discards actual findings, imports success, or depends on unavailable hidden material context.",
        insufficient_evidence: "The relevant failure or necessary repair inputs are missing or too unclear to prepare the correction.",
      },
    };
  }
  if (["plan-review", "final-review"].includes(proposal.action) && questions["obligation:reviewer_independence"]) {
    questions["obligation:reviewer_independence"] = {
      type: "choice",
      instructions: "Judge this review dispatch against `state.policy.processLaunchContract`. Does it request a fresh independent reviewer process with only the declared review inputs? The coordinator making this proposal is not the reviewer. Actual distinct process identity must be checked after execution, not invented before launch.",
      criteria: {
        satisfied: "The designated review uses the registered fresh-process adapter and its instructions do not reuse the author or implementer's conversation.",
        violated: "The dispatch requests self-review, resume/fork of the author or implementer, or inherited author conversation.",
        insufficient_evidence: "The supplied dispatch does not establish which fresh-review contract applies or what context is shared.",
      },
    };
  }
  if (proposal.action === "plan-author") {
    if (questions["obligation:context"]) questions["obligation:context"].instructions = "Inspect the proposed plan-author objective and source paths plus completed research returnedObservation. Is there enough relevant context for a new planner to author the requested plan by reading its declared inputs? The plan itself is the future output, not a prerequisite. Earlier failed attempts do not satisfy this request and do not by themselves make a new, fully specified attempt invalid.";
    if (questions["obligation:planned_criteria_coverage"]) questions["obligation:planned_criteria_coverage"] = {
      type: "choice",
      instructions: "Compare `state.boundary.requirementIds` and its authoring objective with `state.criteria`. Does this dispatch explicitly require the new plan to cover every declared criterion? Judge the instructions, not a produced plan.",
      criteria: {
        satisfied: "All declared criteria are assigned and the planner is instructed to cover them in its future plan.",
        violated: "The dispatch omits a declared criterion or instructs the planner to leave it out.",
        insufficient_evidence: "The supplied criterion assignment or authoring objective is too unclear to establish complete planned coverage.",
      },
    };
    if (questions["obligation:verification_strategy"]) questions["obligation:verification_strategy"] = {
      type: "choice",
      instructions: "Inspect `state.boundary.objective`, `state.boundary.observations` and `state.criteria`. Is the planner explicitly instructed to specify check commands and expected observable outcomes for every criterion? Evaluate the authoring instructions, before the plan exists.",
      criteria: {
        satisfied: "The dispatch asks the planner to define a check or other appropriate behavioral evidence and its expected observation for every criterion.",
        violated: "The dispatch instructs the planner to omit required verification or to substitute unsupported claims for behavioral evidence.",
        insufficient_evidence: "The supplied authoring instructions do not establish which criteria need checks or what verification strategy the planner must define.",
      },
    };
  }
  if (proposal.action === "inspect") {
    if (questions["obligation:context"]) questions["obligation:context"].instructions = "Judge whether the supplied objective, canonical sources, exact read command and declared read scope establish why this inspection is needed and what may be read. Inspection gathers additional context; its unread result, completed research or an implementation plan are not prerequisites. Missing information needed to authorize the read still requires insufficient_evidence.";
    if (questions["obligation:tool"]) questions["obligation:tool"].instructions = "Judge this coordinator's exact read-only cat/pwd/ls/rg command, bounded read paths and empty write scope. It is not a model dispatch and needs no model-pinning flags or completed code evidence.";
    if (questions.tool) { questions.tool.instructions = "Judge the exact coordinator inspection command and declared read scope. Supported read tools are cat, pwd, ls and rg with closed safe flags. No model launch is requested."; questions.tool.criteria.compliant = "The exact supported read command stays within its declared scope and requests no mutation."; }
  }
  return JSON.stringify({ state, model: JEV_MODEL, questions });
}

/**
 * Default live transport. The abort timeout sits below the hook deadline.
 * @param {{endpoint:string, apiKey:string, body:string, timeoutMs?:number, signal?:AbortSignal}} request
 */
async function defaultTransport(request) {
  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? JEV_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const response = await fetch(request.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
      body: request.body,
    });
    if (!response.ok) throw new GovernanceError("Jev request failed", "unavailable");
    return await response.json();
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError("Jev request was unavailable", "unavailable");
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** @param {unknown} value */
function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * @param {any} answer @param {readonly string[]} labels @param {string} label
 * @returns {{choice:string, confidence:number, probabilities:Record<string,number>}}
 */
function validateChoice(answer, labels, label) {
  if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string" || !labels.includes(answer.choice)
    || !probability(answer.confidence) || !isRecord(answer.probabilities)) {
    throw new GovernanceError(`${label} is not a valid three-label choice`, "malformed");
  }
  const keys = Object.keys(answer.probabilities);
  if (keys.length !== labels.length || labels.some((key) => !Object.hasOwn(answer.probabilities, key))) {
    throw new GovernanceError(`${label} probability map must contain exactly ${labels.join(", ")}`, "malformed");
  }
  const values = labels.map((key) => answer.probabilities[key]);
  if (values.some((value) => !probability(value))) throw new GovernanceError(`${label} probabilities must be finite in [0,1]`, "malformed");
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.01) throw new GovernanceError(`${label} probabilities must sum to one`, "malformed");
  const chosen = answer.probabilities[answer.choice];
  if (values.some((value) => value > chosen)) throw new GovernanceError(`${label} probability map must peak at the chosen label`, "malformed");
  return { choice: answer.choice, confidence: answer.confidence, probabilities: { ...answer.probabilities } };
}

/**
 * Validate the exact Jev response. Throws GovernanceError with code
 * "malformed" for structural problems and "unavailable" for transport issues.
 * @param {any} payload
 * @param {readonly string[]} obligations
 * @param {readonly string[]} candidates
 * @param {{priority:boolean, tool:boolean}} applicability
 */
export function validateJevResponse(payload, obligations, candidates, applicability) {
  if (!isRecord(payload)) throw new GovernanceError("Jev returned no payload", "malformed");
  if (payload.model !== JEV_MODEL) throw new GovernanceError("Jev returned an unpinned model", "malformed");
  if (!isRecord(payload.usage) || Object.values(payload.usage).some((value) => !Number.isSafeInteger(value) || /** @type {number} */ (value) < 0)) {
    throw new GovernanceError("Jev returned invalid usage telemetry", "malformed");
  }
  if (!isRecord(payload.answers)) throw new GovernanceError("Jev returned no answers", "malformed");
  const expectedAnswers = [...obligations.map((id) => `obligation:${id}`), "route", ...(applicability.tool ? ["tool"] : []), ...(applicability.priority ? ["priority"] : [])];
  if (Object.keys(payload.answers).length !== expectedAnswers.length || expectedAnswers.some((key) => !Object.hasOwn(payload.answers, key))) throw new GovernanceError("Jev answer keys do not exactly match the requested obligations", "malformed");
  const obligationsOut = obligations.map((obligation) => {
    const answer = validateChoice(payload.answers[`obligation:${obligation}`], THREE_LABELS, `obligation ${obligation}`);
    return { id: obligation, outcome: /** @type {"satisfied"|"violated"|"insufficient_evidence"} */ (answer.choice), confidence: answer.confidence };
  });
  const route = validateChoice(payload.answers.route, candidates, "route");
  const tool = applicability.tool ? validateChoice(payload.answers.tool, TOOL_LABELS, "tool") : null;
  const priority = applicability.priority ? validateChoice(payload.answers.priority, PRIORITY_LABELS, "priority") : null;
  return {
    obligations: obligationsOut,
    route,
    tool,
    priority,
    usage: { ...payload.usage },
    model: payload.model,
  };
}

/**
 * Full classifier call. Returns a structured result; provider unavailability or
 * malformed output is reported, never thrown as a raw provider body.
 * @param {{
 *   run:any, proposal:any, obligations:readonly string[], candidates:readonly string[],
 *   completed:any, home?:string, env?:Record<string,string|undefined>,
 *   transport?:(request:{endpoint:string,apiKey:string,body:string,timeoutMs:number,signal?:AbortSignal,model:string})=>Promise<any>,
 *   timeoutMs?:number, signal?:AbortSignal,
 * }} input
 * @returns {Promise<{ok:true, obligations:Array<{id:string,outcome:string,confidence:number}>, route:any, tool:any, priority:any, usage:any, model:string, requestHash:string, requestBytes:number, latencyMs:number,transportAttempted:true} | {ok:false, reason:string,code:string,transportAttempted:boolean}>}
 */
export async function classifyWithJev(input) {
  const { run, proposal, obligations, candidates, completed } = input;
  const applicability = {
    priority: proposal.action !== "close",
    tool: true,
  };
  if (run.criteria.length > JEV_MAX_CRITERIA) return { ok: false, reason: "criteria exceed the classifier cap", code: "context_unavailable", transportAttempted: false };

  /** @type {Array<{id:string,path:string,kind:string,sha256:string,excerpt:string}>} */
  const sources = [];
  for (const source of run.sources.filter((/** @type {any} */ entry) => proposal.sourceIds.includes(entry.id))) {
    const excerpt = await readBoundedText(join(run.root, source.path), JEV_MAX_REQUEST_BYTES);
    if (excerpt === null) return { ok: false, reason: "a required source is missing or exceeds the complete-source byte cap", code: "context_unavailable", transportAttempted: false };
    sources.push({ id: source.id, path: source.path, kind: source.kind, sha256: sha256Hex(excerpt), excerpt });
  }
  const criteria = run.criteria.map((/** @type {any} */ criterion) => ({
    id: criterion.id,
    ticketId: criterion.ticketId,
    requirement: criterion.requirement,
    evidenceRequired: criterion.evidenceRequired,
    evidenceKind: criterion.evidenceKind ?? "check",
    requiredCapabilities: criterion.requiredCapabilities ?? [],
  }));
  /** @type {any[]} */ const changeEvidence = [];
  if (obligations.some((id) => ["changed_scope", "repo_patterns", "docs_consistency"].includes(id))) {
    let contentBytes = 0;
    const seen = new Set();
    /** @param {string} root @param {string[]} paths @param {string} provenance */
    const collect = async (root, paths, provenance) => {
      for (const file of await snapshotPaths(root, paths)) {
        if (file.state === "directory") continue;
        const key = `${root}:${file.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { stdout: diff } = await execFileAsync("git", ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=4", "HEAD", "--", file.path], { cwd: root, timeout: 5000, maxBuffer: JEV_MAX_REQUEST_BYTES });
        const metadataOnly = !diff && file.state === "file" && (file.size ?? 0) > JEV_MAX_SOURCE_EXCERPT_BYTES;
        const contents = diff || file.state === "missing" || metadataOnly ? null : await readBoundedText(join(root, file.path), JEV_MAX_REQUEST_BYTES);
        if (!diff && !metadataOnly && file.state !== "missing" && contents === null) throw new GovernanceError("required changed-file content is unavailable or oversized");
        contentBytes += Buffer.byteLength(diff || contents || "");
        if (contentBytes > JEV_MAX_REQUEST_BYTES) throw new GovernanceError("required changed-file context exceeds the classifier byte cap");
        changeEvidence.push({ provenance, root, path: file.path, state: file.state, mode: file.mode, sha256: file.sha256, contents,
          diff: diff || null, diffBase: diff ? "Git HEAD; cumulative working-candidate hunks, which may include preexisting edits" : null,
          coverage: diff ? "complete changed hunks with four context lines; full unchanged file not supplied" : metadataOnly ? "metadata only for large unchanged reference; no content claim" : "complete current file or observed deletion" });
      }
    };
    try {
      for (const id of proposal.dependsOn) {
        const attempt = run.attempts.find((/** @type {any} */ entry) => entry.id === id);
        if (attempt?.status === "completed") await collect(attempt.process?.candidateRoot ?? run.root, attempt.changedPaths ?? [], `observed-attempt:${id}`);
      }
      await collect(run.root, proposal.readSet, "current-declared-read-context");
    } catch { return { ok: false, reason: "required returned-code context is missing, unsupported or exceeds the complete-context cap", code: "context_unavailable", transportAttempted: false }; }
  }
  const body = buildBody(run, proposal, obligations, candidates, sources, criteria, { ...completed, changeEvidence }, applicability);
  const requestBytes = Buffer.byteLength(body);
  if (requestBytes > JEV_MAX_REQUEST_BYTES) return { ok: false, reason: "request exceeds the classifier byte cap", code: "context_unavailable", transportAttempted: false };

  let apiKey;
  try {
    apiKey = await loadApiKey({ home: input.home, env: input.env });
  } catch {
    return { ok: false, reason: "private Jev credential is unavailable", code: "credential_missing", transportAttempted: false };
  }
  if (!apiKey) return { ok: false, reason: "TYPESAFE_API_KEY is not configured", code: "credential_missing", transportAttempted: false };

  const endpoint = JEV_ENDPOINT;
  if (body.includes(apiKey)) return { ok: false, reason: "protected credential data appeared in classifier context", code: "protected_context", transportAttempted: false };
  const transport = input.transport ?? defaultTransport;
  const timeoutMs = input.timeoutMs ?? JEV_TIMEOUT_MS;
  const started = Date.now();
  let payload;
  try {
    payload = await transport({ endpoint, apiKey, body, timeoutMs, signal: input.signal, model: JEV_MODEL });
  } catch (error) {
    return { ok: false, reason: "Jev transport failed", code: "provider_unavailable", transportAttempted: true };
  }
  try {
    const validated = validateJevResponse(payload, obligations, candidates, applicability);
    if (JSON.stringify(payload).includes(apiKey)) return { ok: false, reason: "protected credential data appeared in classifier output", code: "protected_output", transportAttempted: true };
    return { ok: true, ...validated, requestHash: stableHash(body), requestBytes, latencyMs: Date.now() - started, transportAttempted: true };
  } catch (error) {
    return { ok: false, reason: "Jev response was malformed", code: "malformed", transportAttempted: true };
  }
}

/** @param {string} home */
export async function privateSecretPath(home) {
  return join(resolveHome(home), ".development-system", "private", "secrets", "typesafe.env");
}
