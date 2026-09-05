---
name: flow-implement
description: Complete an authorized software change with bounded ownership, proportional verification and the requested delivery state.
---

Capture the complete requested outcome, constraints, owned surfaces, focused
checks and terminal state. Preserve decisions and authorization across turns;
do not relabel pending requested work as out of scope. A follow-up correction
steers the current task unless the user explicitly replaces it.

Load `coding-orchestration` for non-trivial repository implementation. Astra
owns decisions and integration; a fast worker gets a precise bounded packet.
Use explicit disjoint ownership for concurrent writes. Do not introduce new
planning ceremonies for an already clear task.

Use behavioral tests where they protect a real contract or regression. Select
the smallest meaningful checks while editing and the applicable integration
checks when stable. A broad suite is not implicit in every task. Once affected checks and required
gates pass, continue toward delivery; broaden or repeat only after relevant edits,
failures or unresolved concerns. Reuse evidence only for the applicable candidate
and environment, without bypassing required hooks or CI. Get evidence
of affected UI flows early, using the repository's authorized mechanism.

Review the objective and diff; use Fable for complex independent judgment.
Correct actual findings, then verify the changes and remaining risks. Reuse
valid evidence when its source and environment still apply. If waiting or
repeated exploration dominates, adjust the execution route while preserving
the work; do not stop simply to request another continuation message.

Finish the installation, commit, push, PR, merge, release or production steps
the user has authorized. Keep their evidence distinct. Missing authority for
one external operation does not prevent preparation and other authorized work.

## Technical document

Before implementing a change with a visible outcome, identify the observable
flow and capture its baseline
with the repository's authorized Computer Use mechanism. Load the existing
product-verification skill (`maintain-product-verification` for maintenance).
Classify the change as `ui`, `backend-visible`, or `nonvisual`. A backend change
that affects an on-screen flow is `backend-visible`, not exempt from visual
evidence. Capture only the task surface, without credentials or private customer
data. Keep original media private and record the source revision and capture time.

For `ui` and `backend-visible` completion reports, attach a before/after pair
from the same route, state, data and viewport, plus a short real recording of the
affected flow reaching its expected result. Use the active host's recording tool
when available (T3 preview recording start/stop, or supported browser capture).
Actually operate the UI during recording and verify playback. A slideshow,
mockup, animated diagram or screenshots alone are not a workflow video. A
backend-only change with no visible outcome uses `nonvisual` and an explicit
reason, with meaningful behavioral evidence in the report instead.

If a baseline was not captured, do not relabel the new UI as “before”. Recover
the actual old revision in an isolated preview if feasible and label it as a
recapture; otherwise declare the gap. A missing capture, inaccessible flow or
failed recording stays visible in `evidence.gaps` and in the final response.
Never fabricate media or claim visual acceptance from file presence.

Load `show-me` and `working-backwards/report-reference.md` for the shared visual
presentation. Use `pr-lens` when a relationship map helps explain the change.

After non-trivial authorized work and its verification, generate a completion
document from the current evidence and link it in the final message, unless
the user explicitly opts out:

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
