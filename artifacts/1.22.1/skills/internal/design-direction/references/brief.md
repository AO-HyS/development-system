# Project decision record

Update the existing surface brief rather than maintaining a competing tracker.
Use only fields that resolve a real decision; archive superseded rationale.

- Surface, user task, scope and phase (`exploring`, `selected`, `refining`,
  `implementing`, `verified`).
- Decision ledger with stable keys and literal source text:
  - user-confirmed constraints;
  - product facts with current evidence path, route or capture;
  - agent proposals marked provisional, rejected, selected or superseded.
- Identity: preserved brand, palette, type and imagery character. Record
  composition, hierarchy and interaction separately so fixed identity does not
  freeze them.
- Selected direction and the composition/interaction qualities that make it
  distinct. `ready-to-compare` is not a selection.
- Token/component source paths and functional invariants.
- Decisions changed by the user: literal current rule, superseded rule, affected
  references and decision keys.
- References: path, intended function (density / typography / composition /
  rhythm / imagery / interaction), status (exploration / approved composition /
  superseded / verified implementation), retrievable file or attachment ID and
  preview link. Mark text/color/geometry limits without discarding approved
  hierarchy or density. Follow [handoff.md](handoff.md) for publication.
- Exploration receipt: candidate theses and risks, candidate derivation receipt,
  concept-seed receipt, Impeccable decision-page path and their order. Record why
  alternatives differ beyond palette. Do not add a separate comparator.
- Comparison matrix: representative screens × device classes × relevant states.
  Preserve data and task meaning between alternatives. Render only requested or
  decision-relevant cells.
- Interaction contract: trigger, closed/open states, responsive fallback,
  movement and reduced motion, focus/scroll/input preservation.
- Interview ledger: decision key → exact questionnaire/response/spec source. An
  equivalent answered key is closed; tentative and deferred answers remain open.
  For questionnaire references, retain the image purpose and durable source;
  displaying a reference does not select a direction.
- Critique receipt: inputs supplied, separate constraint and composition verdicts,
  optional grounded score, named gaps, pass count and convergence decision.
- Acceptance and remaining questions, separating comparison readiness, user
  selection, composition review and runtime proof.
- Existing spec/tickets and the next authorized action.

For a new record, prefer `docs/design/<surface>-brief.md`. For an existing
project, its current brief remains canonical. Add a conditional relative-path
pointer to the app guide or design index so future models can find it, and carry
that pointer in implementation packets. Do not rely on a design tool's automatic
discovery or the author's conversation history.

Example correction, not a universal layout rule:
"Context is closed with zero reserved width. Explicit open may recompose the
workspace; narrow screens use a sheet. The earlier board requiring an unmoving
center is superseded for geometry." A different product may choose another rule.
