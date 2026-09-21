// @ts-check
const transition = { to: "research", reason: "Current intake is classified and complete.", boundaryId: "intake-current" };
const outcome = { status: "blocked", reason: "Required capability is unavailable; retain the evidence for recovery.", boundaryId: "recovery-current" };
const proposal = {
  id: "read-ticket", phase: "intake", action: "host-tool", actorId: "OBSERVED_SESSION_ID", attemptId: null,
  objective: "Read the authorized linked ticket.", requirementIds: ["C1"], sourceIds: ["spec", "rules"],
  readSet: ["docs/spec.md", "AGENTS.md"], writeSet: [], dependsOn: [],
  route: { role: "coordinator", provider: "codex", model: "OBSERVED_MODEL", reasoning: "OBSERVED_EFFORT", capabilities: [] },
  toolName: "mcp__linear__get_issue", toolInput: { id: "NUTRI-346" }, evidenceRefs: [], observations: [],
};
const contract = {
  id: "feature-run", root: "/absolute/repository", baseSha: "CURRENT_40_CHARACTER_GIT_SHA", endpoint: "local accepted",
  authorization: "The retained user instruction and authorized endpoint.", taskKind: "implementation", requiredCapabilities: ["shell", "linear-read", "computer-use"],
  sources: [{ id: "spec", path: "docs/spec.md", kind: "spec" }, { id: "rules", path: "AGENTS.md", kind: "rule" }],
  tickets: [{ id: "NUTRI-346", dependsOn: [] }],
  criteria: [{ id: "C1", ticketId: "NUTRI-346", requirement: "The requested observable behavior.", evidenceRequired: "Actual rendered behavior and an independent assessment.", evidenceKind: "visual" }],
  capacity: { total: 1, providers: { codex: 1, "opencode-go": 1, local: 1 } },
};

/** @type {Record<string,{description:string,input:unknown,notes:string[]}>} */
const commands = {
  begin: { description: "Validate the complete contract and current capabilities before binding this observed session.", input: contract, notes: ["Required capabilities must already have successful same-session host observations. Unknown or missing capabilities do not grant a pass.", "taskKind audit skips implementation and integration only. Independent review and behavior evidence remain required."] },
  preflight: { description: "Check the same begin contract without binding a run or creating its directory.", input: contract, notes: ["A tool listed in configuration is not observed capability. A successful tool call is not product acceptance."] },
  classify: { description: "Classify one exact lifecycle boundary and retain its cause and transport provenance.", input: proposal, notes: ["Use preflight observedTools to select the actual host shape. On Codex, a native exec_command call is observed as Bash with toolInput.command; classify and prepare that observed form. Do not drop semantic execution options.", "Raw observed input identity is retained for one-use permits. A native request name is not automatically its hook name.", "Linear get_issue and get_document use linear-read. save_issue uses linear-write and requires an existing id plus explicit title, description, state or priority; creation and other fields are unsupported."] },
  prepare: { description: "Issue a one-use permission for a current passing boundary.", input: { actorId: "OBSERVED_SESSION_ID", attemptId: null, toolName: proposal.toolName, toolInput: proposal.toolInput }, notes: ["Requires --boundary with the exact classified boundary ID."] },
  advance: { description: "Advance only through a classified, completed lifecycle boundary.", input: transition, notes: ["All three keys are required: to, reason, boundaryId. Forward skips are forbidden."] },
  close: { description: "Record accepted, blocked or interrupted without erasing receipts or unresolved ownership.", input: outcome, notes: ["All three keys are required: status, reason, boundaryId.", "Accepted requires the evidence phase and complete current evidence. Blocked/interrupted can preserve a failed run for recovery."] },
  recover: { description: "Close an unstarted run as blocked from an observed session at the same root.", input: { reason: "The old intake is obsolete; continue with the current authorized spec." }, notes: ["Requires explicit --run. Only zero-attempt, zero-lease runs are eligible. The original owner and history remain recorded."] },
  status: { description: "Read active state or explicit retained history.", input: null, notes: ["Use --run to read a historical run. No --input is accepted."] },
  execute: { description: "Launch a designated process under an already consumed exact dispatch permission.", input: { attemptId: "prepared-attempt", candidateRoot: "/absolute/candidate", packetPath: "docs/packet.md" }, notes: ["This operation is never exempt from governance. Actual process identity and completion are required."] },
};

export const REFERENCE_COMMANDS = Object.freeze(["help", "schema", "examples"]);
/** @param {string | undefined} command */
export function commandReference(command) {
  if (command && !Object.hasOwn(commands, command)) return null;
  return { usage: "node /absolute/governance-runtime/cli.mjs <command> [--home /absolute/home] [--run ID] [--input file.json | --input-json JSON] [--json]",
    referenceUsage: "help|schema|examples [COMMAND] [--json]",
    commands: command ? { [command]: commands[command] } : commands,
    recovery: ["Read status and the exact schema. Correct the first reported mismatch.", "Do not retry unchanged rejection variants. A different diagnosis requires new evidence or corrected input.", "Use close blocked/interrupted for the current run. Use recover --run only for an unstarted historical run at the same observed root."] };
}

/** @param {ReturnType<typeof commandReference>} reference */
export function formatReference(reference) {
  if (!reference) return "Unknown command.";
  return [reference.usage, reference.referenceUsage,
    ...Object.entries(reference.commands).map(([name, entry]) => `${name}: ${entry.description}\n${entry.input ? JSON.stringify(entry.input, null, 2) + "\n" : ""}${entry.notes.join("\n")}`),
    ...reference.recovery].join("\n\n");
}
