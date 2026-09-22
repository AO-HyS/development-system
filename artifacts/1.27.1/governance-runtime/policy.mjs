// @ts-check

/**
 * Pure governance policy: phases, actions, role profiles and the deterministic
 * obligation table. This module performs no I/O so it can be reasoned about and
 * tested without a store or transport.
 */

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";
export const JEV_TIMEOUT_MS = 5000;
export const JEV_MAX_REQUEST_BYTES = 98304;
export const JEV_MAX_SOURCE_BYTES = 65536;
export const JEV_MAX_CHANGED_CONTEXT_BYTES = 65536;
export const JEV_MAX_SOURCE_EXCERPT_BYTES = 4096;
export const JEV_MAX_CRITERIA = 200;

export const ASTRA = Object.freeze({ provider: "codex", model: "gpt-6-astra", reasoning: "xhigh" });
export const FLASH = Object.freeze({ provider: "opencode-go", model: "opencode-go/deepseek-v4.1-flash", reasoning: "high" });
export const LUNA = Object.freeze({ provider: "codex", model: "gpt-5.6-luna", reasoning: "high" });

/** `opencode` and `opencode-go` name the same governed provider.
 * @param {string} left @param {string} right */
export function sameProvider(left, right) {
  if (left === right) return true;
  if ([left, right].every((value) => value === "openai" || value === "codex")) return true;
  return [left, right].every((value) => value === "opencode" || value === "opencode-go");
}

export const PHASES = Object.freeze([
  "intake",
  "research",
  "plan",
  "plan-review",
  "implementation",
  "integration",
  "final-review",
  "evidence",
  "closed",
]);

export const ACTIONS = Object.freeze([
  "inspect", "host-tool",
  "intake-review", "plan-return", "plan-review-return", "integration-return", "final-review-return", "verify-return",
  "research-dispatch",
  "research-return",
  "plan-author",
  "plan-review",
  "writer-dispatch",
  "writer-return",
  "integrate",
  "correct",
  "final-review",
  "verify",
  "close",
]);

/** Explicit compatible phase/action map. `correct` may run in any active phase. */
export const PHASE_ACTIONS = Object.freeze({
  intake: Object.freeze(["intake-review"]),
  research: Object.freeze(["research-dispatch", "research-return", "correct"]),
  plan: Object.freeze(["plan-author", "plan-return", "correct"]),
  "plan-review": Object.freeze(["plan-review", "plan-review-return", "correct"]),
  implementation: Object.freeze(["writer-dispatch", "writer-return", "correct"]),
  integration: Object.freeze(["integrate", "integration-return", "correct"]),
  "final-review": Object.freeze(["final-review", "final-review-return", "correct"]),
  evidence: Object.freeze(["verify", "verify-return", "close", "correct"]),
  closed: Object.freeze([]),
});

export const DISPATCH_ACTIONS = Object.freeze([
  "research-dispatch",
  "plan-author",
  "plan-review",
  "writer-dispatch",
  "final-review",
  "verify",
]);

export const ROLES = Object.freeze([
  "coordinator",
  "researcher",
  "planner",
  "plan-reviewer",
  "writer",
  "reviewer",
  "verifier",
]);

/** Next forward phase. `closed` is reached only through closeRun. */
export const NEXT_PHASE = Object.freeze({
  intake: "research",
  research: "plan",
  plan: "plan-review",
  "plan-review": "implementation",
  implementation: "integration",
  integration: "final-review",
  "final-review": "evidence",
  evidence: null,
});

/**
 * Prerequisite descriptors checked by the core against persisted run state.
 * A research phase with no prerequisite may be evidenced as a no-op when the
 * declared sources already resolve the requirement.
 */
export const PHASE_PREREQUISITES = Object.freeze({
  research: Object.freeze([]),
  plan: Object.freeze(["research-resolved"]),
  "plan-review": Object.freeze(["plan-evidence"]),
  implementation: Object.freeze(["plan-review-pass"]),
  integration: Object.freeze(["writer-return"]),
  "final-review": Object.freeze(["integration-complete"]),
  evidence: Object.freeze(["final-review-pass"]),
});

const BASE_OBLIGATIONS = ["scope", "rules", "route", "tool", "order"];
const DISPATCH_EXTRA = ["ownership", "context"];
const PLAN_AUTHOR_DISPATCH = ["planned_criteria_coverage", "verification_strategy"];
const PLAN_REVIEW_DISPATCH = ["reviewer_independence"];
const PLAN_REVIEW_RETURN = ["completed_coverage"];
const RETURN_OBLIGATIONS = ["changed_scope", "repo_patterns", "docs_consistency"];
const FINAL_REVIEW_DISPATCH = ["planned_review_coverage", "reviewer_independence"];
const VERIFY_DISPATCH = ["approved_check_identity"];
const COMPLETED_OBLIGATIONS = ["criterion_evidence", "review_coverage", "unresolved_findings"];
const CLOSE_OBLIGATIONS = [...COMPLETED_OBLIGATIONS, "endpoint", "every_ticket"];

/**
 * @param {string} action
 * @param {{completed?: boolean}} [context]
 * @returns {string[]}
 */
export function requiredObligations(action, context = {}) {
  switch (action) {
    case "host-tool": return [...BASE_OBLIGATIONS, "context", "ownership"];
    case "inspect": return [...BASE_OBLIGATIONS, "context"];
    case "intake-review": return [...BASE_OBLIGATIONS, "context"];
    case "plan-return": return [...BASE_OBLIGATIONS, "completed_coverage", "context"];
    case "plan-review-return": return [...BASE_OBLIGATIONS, "completed_coverage", "reviewer_independence"];
    case "integration-return": return [...BASE_OBLIGATIONS, ...RETURN_OBLIGATIONS];
    case "final-review-return": return [...BASE_OBLIGATIONS, ...RETURN_OBLIGATIONS, "review_coverage", "unresolved_findings"];
    case "verify-return": return [...BASE_OBLIGATIONS, ...COMPLETED_OBLIGATIONS];
    case "research-dispatch": return [...BASE_OBLIGATIONS, ...DISPATCH_EXTRA];
    case "research-return": return [...BASE_OBLIGATIONS, "completed_coverage", "context"];
    case "plan-author": return [...BASE_OBLIGATIONS, ...DISPATCH_EXTRA, ...PLAN_AUTHOR_DISPATCH];
    case "plan-review": return [...BASE_OBLIGATIONS, ...DISPATCH_EXTRA, ...PLAN_REVIEW_DISPATCH];
    case "writer-dispatch": return [...BASE_OBLIGATIONS, ...DISPATCH_EXTRA];
    case "writer-return": return [...BASE_OBLIGATIONS, ...RETURN_OBLIGATIONS];
    case "integrate": return [...BASE_OBLIGATIONS, ...RETURN_OBLIGATIONS];
    case "correct": return [...BASE_OBLIGATIONS, "context", "correction_relevance"];
    case "final-review": return [...BASE_OBLIGATIONS, ...DISPATCH_EXTRA, ...FINAL_REVIEW_DISPATCH];
    case "verify": return [...BASE_OBLIGATIONS, ...DISPATCH_EXTRA, ...VERIFY_DISPATCH];
    case "close": return [...BASE_OBLIGATIONS, ...CLOSE_OBLIGATIONS];
    default: return [...BASE_OBLIGATIONS];
  }
}

/** Full meaning sent to Jev, one three-label choice per obligation. */
export const OBLIGATION_MEANINGS = Object.freeze({
  scope: "The proposal stays inside the authorized root and owned read/write scope with no protected or managed path as a write target.",
  rules: "The supplied rule and source references are the current canonical ones and were actually included in the request.",
  route: "The proposed role/model/effort is a permitted profile for this action with no silent substitution or fallback.",
  tool: "The named tool and normalized arguments are permitted for this action and pin the matching target model/effort.",
  order: "This action is ordered correctly: its declared dependencies are complete and it is not running ahead of the phase.",
  ownership: "Ownership is exclusive: no active attempt holds an overlapping read/write or write/write path.",
  context: "The supplied bounded context is sufficient to perform this action without rediscovery or hidden transcript.",
  correction_relevance: "The proposed correction identifies an observed failure, missing fact or finding and describes the bounded next step that addresses it. Completed correction evidence is not required before the correction starts.",
  planned_criteria_coverage: "Author dispatch instructions require the future plan to cover every criterion; no produced plan is required before dispatch.",
  verification_strategy: "Author dispatch instructs the planner to define evidence and approved checks for every criterion; completion is checked on return.",
  reviewer_independence: "Dispatch requires a fresh independent process; completed review must have a distinct observed actor and session from its author or implementer.",
  completed_coverage: "Every declared criterion is represented in the returned coverage with no silently omitted requirement.",
  planned_review_coverage: "The fresh review dispatch explicitly names every criterion and all integrated candidate paths, and instructs inspection of their correctness; a completed review is not required at dispatch.",
  changed_scope: "Returned changes stay inside the owned scope and every changed path is accounted for.",
  repo_patterns: "Returned changes follow the repository's existing conventions and patterns.",
  docs_consistency: "Returned changes keep documentation, contracts and configuration consistent with the code.",
  approved_check_identity: "The exact executable, argv and hashed script/config inputs are approved; actual exit status is required only on completed return.",
  criterion_evidence: "Current criterion evidence exists for every criterion and comes from a registered producer.",
  review_coverage: "Independent review covers the candidate and the affected risk surface.",
  unresolved_findings: "No unresolved gating finding remains open against the candidate.",
  endpoint: "The authorization endpoint covers this work and its acceptance evidence.",
  every_ticket: "Every linked ticket has current passing evidence for all its criteria and is ready to be marked accepted atomically during closure; no ticket is omitted.",
});

export const ROUTE_CANDIDATES = Object.freeze({
  inspect: Object.freeze(["coordinator"]),
  "host-tool": Object.freeze(["coordinator"]),
  "intake-review": Object.freeze(["coordinator"]),
  "plan-return": Object.freeze(["coordinator"]),
  "plan-review-return": Object.freeze(["coordinator"]),
  "integration-return": Object.freeze(["coordinator"]),
  "final-review-return": Object.freeze(["coordinator"]),
  "verify-return": Object.freeze(["coordinator"]),
  "research-dispatch": Object.freeze(["researcher"]),
  "research-return": Object.freeze(["coordinator"]),
  "plan-author": Object.freeze(["planner"]),
  "plan-review": Object.freeze(["plan-reviewer", "reviewer"]),
  "writer-dispatch": Object.freeze(["writer"]),
  "writer-return": Object.freeze(["coordinator"]),
  integrate: Object.freeze(["coordinator"]),
  correct: Object.freeze(["coordinator"]),
  "final-review": Object.freeze(["reviewer", "plan-reviewer"]),
  verify: Object.freeze(["verifier", "coordinator"]),
  close: Object.freeze(["coordinator"]),
});

export const PRIORITY_LABELS = Object.freeze(["execute_now", "wait_for_dependency", "blocked"]);
export const TOOL_LABELS = Object.freeze(["compliant", "noncompliant", "insufficient_evidence"]);

/**
 * Role profile check. `observedCoordinator` is the coordinator identity loaded
 * from the host observation record; unknown effort never becomes a pass.
 * @param {string} role
 * @param {{role:string,provider:string,model:string,reasoning:string|null}} route
 * @param {{provider:string,model:string,reasoning:string|null}|null} [observedCoordinator]
 * @returns {{ok:boolean, reason:string}}
 */
export function profileFor(role, route, observedCoordinator = null) {
  const matches = (/** @type {{provider:string,model:string,reasoning:string}} */ profile) =>
    sameProvider(route.provider, profile.provider) && route.model === profile.model && route.reasoning === profile.reasoning;
  switch (role) {
    case "coordinator": {
      if (!observedCoordinator) return { ok: false, reason: "coordinator observation unavailable" };
      if (!sameProvider(route.provider, observedCoordinator.provider)) return { ok: false, reason: "coordinator provider must match observation" };
      if (route.model !== observedCoordinator.model) return { ok: false, reason: "coordinator route must keep the observed model" };
      if (observedCoordinator.reasoning && route.reasoning !== observedCoordinator.reasoning) return { ok: false, reason: "coordinator route must keep the observed reasoning" };
      return { ok: true, reason: "observed coordinator profile" };
    }
    case "researcher":
      return matches(LUNA) || matches(FLASH) ? { ok: true, reason: "approved fast research profile" } : { ok: false, reason: "researcher requires approved Luna/high or Flash/high" };
    case "planner":
      return matches(ASTRA) ? { ok: true, reason: "planner requires Astra xhigh" } : { ok: false, reason: "planner requires gpt-6-astra/xhigh" };
    case "plan-reviewer":
      return matches(ASTRA) ? { ok: true, reason: "plan reviewer requires Astra xhigh" } : { ok: false, reason: "plan reviewer requires gpt-6-astra/xhigh" };
    case "writer":
      return matches(FLASH) ? { ok: true, reason: "writer requires Flash high" } : { ok: false, reason: "writer requires opencode-go/deepseek-v4.1-flash/high" };
    case "reviewer":
      return matches(ASTRA) ? { ok: true, reason: "reviewer requires Astra xhigh" } : { ok: false, reason: "reviewer requires gpt-6-astra/xhigh" };
    case "verifier":
      if (route.provider === "local" && route.model === "deterministic-check" && route.reasoning === null) return { ok: true, reason: "approved exact check process" };
      if (matches(ASTRA) || matches(FLASH)) return { ok: true, reason: "approved verifier profile" };
      if (observedCoordinator && route.model === observedCoordinator.model) return { ok: true, reason: "observed coordinator verifier profile" };
      return { ok: false, reason: "verifier requires Astra xhigh, Flash high or the observed coordinator" };
    default:
      return { ok: false, reason: `unknown role ${role}` };
  }
}

/** @param {string} phase @param {string} action */
export function phaseActionAllowed(phase, action) {
  if (["inspect", "host-tool"].includes(action)) return PHASES.includes(phase) && phase !== "closed";
  const allowed = /** @type {Record<string, readonly string[]>} */ (PHASE_ACTIONS)[phase];
  return Array.isArray(allowed) && allowed.includes(action);
}

/** @param {string} from @param {string} to @param {string} [taskKind] */
export function isAdjacentForward(from, to, taskKind = "implementation") {
  if (taskKind === "audit" && from === "plan-review") return to === "final-review";
  return /** @type {Record<string, string | null>} */ (NEXT_PHASE)[from] === to;
}

/** @param {string} from @param {string} to */
export function isRewind(from, to) {
  const fromIndex = PHASES.indexOf(from);
  const toIndex = PHASES.indexOf(to);
  return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex;
}

/** @param {string} role */
export function roleRequiresReasoning(role) {
  return role !== "coordinator";
}

export const PHASE_INDEX = Object.freeze(
  /** @type {Record<string, number>} */ (Object.fromEntries(PHASES.map((phase, index) => [phase, index]))),
);

/** Mandatory capabilities are structural, never inferred from arbitrary prose.
 * @param {any} contract */
export function mandatoryCapabilities(contract) {
  const required = new Set(["shell"]);
  for (const criterion of contract.criteria) {
    if (criterion.evidenceKind === "visual") required.add("computer-use");
    for (const capability of criterion.requiredCapabilities ?? []) required.add(capability);
  }
  return [...required].sort();
}
