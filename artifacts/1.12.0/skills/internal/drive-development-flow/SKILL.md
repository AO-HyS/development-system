---
name: drive-development-flow
description: Route software work to the smallest authorized lifecycle stage while preserving the complete outcome and avoiding repeated approvals.
---

For visual acceptance, use `design-quality`; it owns the critique sequence.
Use `evidence-capture` for the final walkthrough.


The governing priority is **rápido → bien → barato**: shorten delivery of the
whole usable result. `coding-orchestration` owns execution and verification
selection. Keep a compact record of the goal, settled decisions and pending work
so follow-ups do not displace the rest of the system.

Choose the stage already supported by the request and repository. Clear
implementation proceeds directly; definition, grilling and tickets are opt-in.
Load `flow-implement` for implementation and `coding-orchestration` for
non-trivial repository work. Clear bounded work needs a concise task contract,
not a separate planning ceremony. The pure planner describes complex work; it grants no
authority and does not dispatch providers.

Keep the requested outcome, settled decisions, pending work and authorized
terminal state explicit through follow-up messages and handoffs. Do not narrow
the goal to the easiest subtask or make the user repeat settled instructions.
One user instruction can authorize several publication steps; preserve that
authorization instead of asking again. Missing approval for a distinct action
does not stop useful work that is already authorized.

Astra owns orchestration, design, review and integration. `evidence-capture`
owns the capture workflow; Luna prepares bounded scripts when useful and the
host executes them. Astra owns novel Computer Use decisions and acceptance. The
installed roster selects OpenCode Go workers and explicit provider fallbacks.
Use deterministic tools directly. Read only the skills needed for the current
task; specialist work must have an observed reason.

Invoke product-verification skills when requested, when acceptance needs a
real UI flow, or when creating/maintaining that capability. Test the affected
flow early. Astra may operate Computer Use directly; a delegated neutral runner
receives only its bounded execution plan and authorization, not the private
rubric. Existing origin/path/action limits, host validation and opaque receipts
for authorized writes remain in force. A planner JSON cannot authorize writes.

Preserve separate authority for implementation, installation, commit, push,
PR, merge, release, production, external writes, paid services and destructive
cleanup. Continue independent work when one operation is blocked.

Route document requests without starting implementation. When the user asks to
`create a review of what you did`, run `flow-code-review` and generate a
`review` technical document. When the user asks to `explain this spec` or
`explain how something was implemented`, generate an `explanation` technical
document directly:

`development-system document --input packet.json --home HOME --json`


## Conflicting guidance

Current user instructions take precedence over skill guidelines. Preserve
platform security requirements and applicable repository protections. Historical
specs and ADRs describe earlier decisions; they do not reopen approvals already
settled by the user or replace the current versioned contract. If a skill blocks
authorized progress, name and link its exact file, quote the instruction and
explain its applicability. Separate a real requirement from an inferred pause.
