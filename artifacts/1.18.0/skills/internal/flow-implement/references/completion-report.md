# Completion report and media package

Read when the user requests a standalone completion document or a durable media
package. Classify its evidence as `ui`, `backend-visible`, or `nonvisual` based on
the changed outcome. Use the existing product-verification capability; loading
its maintenance skill is only necessary when changing that capability.

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

Use `show-me` or `pr-lens` only when a visualization helps explain the result.
For the Development System Reader format, read `working-backwards/report-reference.md`
and run the installed `development-system document --input packet.json --home HOME
--json`. A normal final response does not require this renderer. If the command
is unavailable, provide the requested report in Markdown with working media links.

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
