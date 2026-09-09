# Project decision record

Update the existing surface brief rather than maintaining a competing tracker.
Use these fields where they resolve an actual decision; keep the current summary
short and archive superseded rationale separately.

- Surface, user task, scope and current phase.
- Selected direction and the qualities that make it distinct.
- Preserved identity, token/component source paths and functional invariants.
- Decisions changed by the user: current rule, superseded rule, affected references.
- References: path, intended use, status (exploratory / approved composition /
  superseded / verified implementation). Mark known text/color/geometry limits.
- Comparison matrix: representative screens × device classes × relevant states.
  Preserve sample data and task meaning between alternatives. Only requested or
  decision-relevant cells need new renders.
- Interaction contract: trigger, closed/open states, responsive fallback,
  movement and reduced motion, focus/scroll/input preservation.
- Acceptance and remaining questions, separating composition from runtime proof.
- Existing spec/tickets and the next authorized action.

For a new project record, prefer `docs/design/<surface>-brief.md`. For an existing
project, its present brief remains canonical. Add a conditional relative-path
pointer to the existing app agent guide or design index so future models can find
it, and include the same pointer in implementation packets. Do not rely solely on
a design tool's automatic discovery or the author's conversation history.

Example of a correction, not a universal layout rule:
"Context is closed with zero reserved width. Explicit open may recompose the
workspace; narrow screens use a sheet. The earlier board requiring an unmoving
center is superseded for geometry." A different product may choose another rule.
