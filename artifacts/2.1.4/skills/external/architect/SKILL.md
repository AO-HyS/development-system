---
name: architect
description: Sketch caller usage, types and module ownership for a concrete structural change before implementation. Use when shared contracts or competing designs need resolution.
---

# Architect

Adapted from Poteto's PStack. See [provenance and adaptations](UPSTREAM.md)
when updating this skill. Reuse the selected orchestrator and accepted plan.

## Ground the concrete change

Start from the desired user outcome and existing callers, state owners,
invariants and compatibility obligations. Reuse prior exploration. Follow the
actual path through the relevant code; naming files alone is insufficient.
Investigate the rationale of a boundary before proposing to move it. Keep
domain, authorization and runtime behavior intact unless the task owns changes.

## Sketch the caller's experience first

Show realistic imports and calls, then derive function signatures, data types
and module boundaries. Keep sketches and pseudocode in the design artifact
until implementation; do not publish empty implementations as working behavior.

For a material structural choice compare at least two distinct arrangements of
ownership or public interface. When constraints force one viable choice,
explain the rejected alternative and reuse that conclusion. Tiny local edits
do not need this workflow. Use the host's proportional planning and authorized
model/delegation policy; this skill supplies design criteria, not another runner.

Read [design warning signs](references/design-red-flags.md) to screen the
candidates. Prefer an interface that hides meaningful policy and complexity,
with one owner for each invariant. A short public interface with a long chain
of pass-through calls is not automatically a simpler design. Preserve required
compatibility instead of deleting alternate paths merely because they exist.

Record the chosen shape, evidence, tradeoffs and rejected alternatives using
[the rationale outline](references/rationale-template.md) only as much as the
decision needs. Resolve technical unknowns from source or an authorized bounded
prototype; ask the user only for a material missing product decision or authority.

## Implement within the retained endpoint

If the request is design-only or asks for a checkpoint, return the design.
Otherwise continue authorized implementation through the existing development
flow. Settle shared names and contracts before delegating writers. A deviation
is evidence: determine whether the sketch, requirements or implementation is
wrong before spreading a workaround.

Repeated special branches, casts, duplicated ownership or callers depending on
internal stages are reasons to revisit the affected design. A single difficult
case is not proof of a bad architecture. Redesign the smallest responsible
boundary and reverify affected behavior, preserving completed valid work.

Output: caller examples, ownership and types, rationale, relevant verification
and remaining limits. A sketch does not establish implementation or acceptance.
