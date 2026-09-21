// @ts-check
/** Typed internal errors. Messages may contain input and are never serialized. */
export class GovernanceError extends Error {
  /** @param {string} message @param {string} [code] @param {{field?:string,missingCapabilities?:string[]}} [details] */
  constructor(message, code = "invalid", details = {}) {
    super(message);
    this.name = "GovernanceError";
    this.code = code;
    this.details = details;
  }
}

/** Public text comes only from this registry, never from a provider/input message. */
const messages = Object.freeze({
  invalid: ["The input does not satisfy the command schema.", "Run schema for this command; correct the named field before retrying."],
  invalid_argument: ["The command arguments are invalid.", "Run help or examples for the command; use exactly one JSON input option."],
  invalid_json: ["Input must be one bounded regular JSON object.", "Use --input with a regular JSON file or --input-json with one object."],
  session_missing: ["This operation requires an observed root session.", "Run a supported read-only tool in this session, then run preflight."],
  binding: ["The selected run does not belong to this observed session or root.", "Inspect status. Recovery of an unstarted run requires the same repository root."],
  run_missing: ["No active run is bound to this session.", "Run preflight and begin, or use status --run to inspect retained history."],
  missing: ["Required local governance state is missing.", "Inspect status and preflight; do not fabricate a receipt."],
  corrupt: ["Stored governance state failed integrity validation.", "Preserve the state and repair or restore it through a supported recovery operation."],
  stale: ["The evidence no longer matches the current inputs.", "Reclassify the affected boundary using current sources and candidate evidence."],
  scope: ["The action exceeds its declared ownership.", "Split or correct the packet and classify its exact paths before dispatch."],
  capacity: ["The observed execution capacity is unavailable.", "Wait for the active owner to finish; do not start a conflicting worker."],
  role: ["The observed actor cannot produce this artifact.", "Dispatch the required independent profile and retain its actual process evidence."],
  tool: ["The tool input is not supported by this action.", "Use examples and the adapter catalog, then classify the exact host tool input."],
  unsupported_tool: ["This exact tool has no supported adapter.", "Select a supported tool or keep the required capability explicitly blocked."],
  invalid_tool_input: ["The adapter cannot validate this tool input.", "Use the documented exact tool shape; retain all meaningful input fields."],
  host_tool_mapping: ["The proposed tool shape differs from the observed host invocation.", "Use the observedTools descriptor from preflight. On this Codex host, native exec_command is observed as Bash with toolInput.command; do not discard execution options."],
  capability_missing: ["Required capabilities have no current successful host observation.", "Observe each supported capability in this session while unbound, then run preflight again."],
  missing_capabilities: ["Required capabilities have no current successful host observation.", "Observe each supported capability in this session while unbound, then run preflight again."],
  declaration_missing: ["The contract does not declare all required capabilities.", "Use schema begin and declare the capabilities required by each acceptance criterion."],
  observation_invalid: ["Observed output does not match its consumed invocation or declared evidence.", "Capture a new exact permitted observation and have the designated verifier assess it."],
  observation_stale: ["Observed output no longer matches the current candidate.", "Capture new output from the current candidate before independent assessment."],
  observation_missing: ["Required observed text or images are unavailable.", "Capture complete output through the supported host adapter; do not import a passing assessment."],
  recovery_ownership: ["This run cannot be recovered by the unstarted-run operation.", "Use the same observed repository root. Any existing attempts or leases require their normal ownership and termination flow."],
  recovery_host_attempt: ["This host attempt does not satisfy administrative recovery requirements.", "Inspect status for the closed blocked or interrupted run. Recovery requires exact completed host invocation evidence, no declared managed paths, no acceptance artifacts, and no other unresolved ownership; it does not prove absence of external effects."],
  task_kind: ["The declared task kind is unsupported.", "Choose implementation or audit using schema begin."],
  activation: ["The supplied activation does not match the observed host identity.", "Use the current observed root session; do not supply another actor's identity."],
  base: ["The declared base revision does not match the repository.", "Refresh the current repository revision and contract, then run preflight."],
  route: ["The proposed route does not match the required role.", "Use the designated profile or retain an explicitly authorized exception."],
  provider_unavailable: ["The designated provider capability is unavailable.", "Resolve the provider capability before dispatch; do not silently substitute it."],
  overlap: ["An active owner overlaps the proposed work.", "Wait for observed termination and integrate its result before transferring ownership."],
  context_unavailable: ["The required classifier context is missing or exceeds its bounded limit.", "Read the missing sources or split the packet; no provider request was made for this context."],
  credential_missing: ["The classifier credential is unavailable to this execution.", "Restore the configured credential through the normal provider setup; never put it in a packet."],
  protected_context: ["The selected context includes protected material.", "Use only the applicable public or authorized project evidence, without credentials or transcripts."],
  protected_output: ["The output includes material that cannot be retained in this receipt.", "Produce a bounded result without protected material through the designated actor."],
  closed: ["The run has already reached a terminal outcome.", "Read its retained history with status --run; start a new run after preflight if work remains."],
  malformed: ["The returned artifact does not satisfy its declared schema.", "Correct the artifact through its designated producer; imported success is not accepted."],
  unavailable: ["The classifier request did not produce a usable response.", "Inspect the recorded transport result and retry only after the cause changes."],
  duplicate: ["A host event conflicts with an already recorded invocation.", "Use a new exact invocation; do not replay or modify an existing receipt."],
  git: ["The declared root is not an available Git repository.", "Correct the absolute root and current base revision, then run preflight."],
  "lock-timeout": ["A governance transaction still owns the state lock.", "Wait for the active transaction to complete; preserve its lock and receipts."],
  internal_error: ["The governance operation failed without a safe public diagnostic.", "Preserve local evidence and inspect status; do not assume acceptance."],
});

const fields = new Set(["command", "input", "run", "boundary", "home", "sessionId", "contract", "contract.id", "contract.root", "contract.baseSha", "contract.endpoint", "contract.authorization", "contract.sources", "contract.tickets", "contract.criteria", "contract.capacity", "contract.taskKind", "contract.requiredCapabilities", "proposal", "proposal.toolName", "proposal.toolInput", "proposal.route", "proposal.readSet", "proposal.writeSet", "transition", "transition.to", "transition.reason", "transition.boundaryId", "outcome", "outcome.status", "outcome.reason", "outcome.boundaryId", "recovery.reason", "requiredCapabilities"]);
const capabilities = new Set(["shell", "patch", "linear-read", "linear-write", "computer-use"]);
for (const field of ["activation.sessionId", "contract.criteria.evidenceKind", "proposal.phase", "proposal.action", "proposal.objective", "proposal.requirementIds", "proposal.sourceIds", "proposal.dependsOn", "recovery.attemptId"]) fields.add(field);

/** @param {unknown} error @param {{operation:string}} context */
export function safeGovernanceError(error, { operation }) {
  const code = error instanceof GovernanceError && Object.hasOwn(messages, error.code) ? error.code : "internal_error";
  const [message, nextAction] = /** @type {Record<string,readonly string[]>} */ (messages)[code];
  const details = error instanceof GovernanceError ? error.details : {};
  return { ok: false, operation,
    error: { code, message, nextAction,
      ...(details?.field && fields.has(details.field) ? { field: details.field } : {}),
      ...(Array.isArray(details?.missingCapabilities) ? { missingCapabilities: [...new Set(details.missingCapabilities.filter((id) => capabilities.has(id)))] } : {}),
    },
  };
}
