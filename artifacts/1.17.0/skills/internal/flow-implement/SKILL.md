---
name: flow-implement
description: Complete an authorized software change with bounded ownership, proportional verification and the requested delivery state.
---

For visual acceptance, use `design-quality`; it owns the critique sequence.
Use `evidence-capture` for the final walkthrough.


Capture the complete requested outcome, constraints, owned surfaces, focused
checks and terminal state. Preserve decisions and authorization across turns;
do not relabel pending requested work as out of scope. A follow-up correction
steers the current task unless the user explicitly replaces it.

Load `coding-orchestration` for non-trivial repository implementation. The
session-selected orchestrator owns decisions and integration; each worker gets
a precise bounded packet. Use explicit disjoint ownership for concurrent
writes. Do not introduce new planning ceremonies for an already clear task.
Use `coding-orchestration`'s Session selection and role ownership section for
the selected model and required worker capabilities.

For a stateful UI or routing change, put the existing behavioral invariants in
the writer packet before editing: which owner retains draft/filter/selection
state, what survives responsive recomposition or navigation, and which nested
layer owns dismissal and focus. Preserve domain logic and permissions while
changing presentation. Check the relevant transition as soon as it exists;
static endpoints alone cannot prove state preservation between them.

Use the verification selection in `coding-orchestration`. Add behavioral tests
when they protect a named contract or regression better than the existing checks;
a test file is not a required deliverable for every change. Select
the smallest meaningful checks while editing and the applicable integration
checks when stable. A broad suite is not implicit in every task. Once affected checks and required
gates pass, continue toward delivery; broaden or repeat only after relevant edits,
failures or unresolved concerns. Reuse evidence only for the applicable candidate
and environment, without bypassing required hooks or CI. Get evidence
of affected UI flows early, using the repository's authorized mechanism.
A regression claim needs evidence that distinguishes the broken behavior from
the corrected behavior. A check that passes both versions may still protect a
different contract, but cannot establish that fix. Extend the existing public
behavior check where useful; avoid creating a test for every visual property.

Use one bounded execution and parent review for ordinary work. Split large
initiatives into useful deliverables while retaining completed evidence and
useful context. Preserve test exit codes when summarizing logs.
Review the objective and diff; use an independent capable reviewer for complex
independent judgment.
Correct actual findings, then verify the changes and remaining risks. Reuse
valid evidence when its source and environment still apply. If waiting or
repeated exploration dominates, adjust the execution route while preserving
the work; do not stop simply to request another continuation message.

Finish the installation, commit, push, PR, merge, release or production steps
the user has authorized. Keep their evidence distinct. Missing authority for
one external operation does not prevent preparation and other authorized work.
Use `coding-orchestration`'s execution continuity when resuming or closing a
multi-step run. The final verdict covers the complete requested outcome, including
unproven criteria and the requested review link, not just the writer's changed files.

## Technical document

Before implementing a change with a visible outcome, identify the observable
flow and capture its baseline
with the repository's authorized Computer Use mechanism. Load the existing
product-verification skill (`maintain-product-verification` for maintenance).
Classify the change as `ui`, `backend-visible`, or `nonvisual`. A backend change
that affects an on-screen flow is `backend-visible`, not exempt from visual
evidence. Capture only the task surface, without credentials or private customer
data. Keep original media private and record the source revision and capture time.

For `ui` and `backend-visible` completion reports, use `evidence-capture` to
attach a before/after pair for the affected surface and one representative
real walkthrough, adding distinct risk cases or all flows when explicitly
requested. Reuse evidence for the same candidate, data and environment. Keep
one driver per browser session and let tools handle recording and media checks.
The orchestrator judges behavior and, with `design-quality`, an assigned
visual-capable reviewer judges the visual result. A backend
change with no on-screen outcome uses `nonvisual` and meaningful behavior checks.

If a baseline was not captured, do not relabel the new UI as “before”. Recover
the actual old revision in an isolated preview if feasible and label it as a
recapture; otherwise declare the gap. A missing capture, inaccessible flow or
failed recording stays visible in `evidence.gaps` and in the final response.
Never fabricate media or claim visual acceptance from file presence.

Load `show-me` and `working-backwards/report-reference.md` for the shared visual
presentation. Use `pr-lens` when a relationship map helps explain the change.

Use the final response for ordinary completion. Generate a separate completion
document when the user requests it or the durable evidence package needs one:

`development-system document --input packet.json --home HOME --json`

The packet carries `schemaVersion: 1`, `kind` (`completion`), a non-empty
`title`, `markdown` and editorial `status`, plus optional `source` and
`visuals`, plus `evidence` following `working-backwards/report-reference.md`.
Attach the actual media paths; describing captures in Markdown does not embed them.
The command writes canonical Markdown and shared-reader HTML under
`HOME/.development-system/private/documents` and returns file paths with
content hashes. It grants no workflow authority and performs no external
actions, so this already requested local document needs no extra approvals.

If the work is partial or blocked, say so plainly in the document and the
final message; never claim completion. When the user asks for a review of the
work or an explanation of a spec or implementation, request the matching
`review` or `explanation` document on demand. Conversational automation ends
with this explicit CLI call before the final message; there is no universal
hook or daemon that generates documents on its own.
