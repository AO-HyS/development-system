---
name: architect
description: Sketch caller usage, types and module ownership for a concrete structural change before implementation. Use when shared contracts or competing designs need resolution.
---

# Architect

Adapted from Poteto's PStack. See [provenance and adaptations](UPSTREAM.md)
when updating this skill. Reuse the selected orchestrator and accepted plan.

Before writing code, trace every system the change touches, then sketch two different shapes for it (types, signatures, module boundaries) and pick the one where each piece of state has one owner, each task has one way to do it, and callers need to know least. Redesign instead of patching if workarounds repeat.

Show realistic caller imports and calls first, then derive signatures, types and module boundaries. Screen each shape against [design warning signs](references/design-red-flags.md). Keep sketches in the design notes until implementation; empty implementations are never working behavior.

Tiny local edits skip this. For a large or contested design, compare the shapes inside the existing plan and the host's authorized delegation policy; this skill supplies design criteria, not another runner. Ask the user only for a missing product decision.

If the request is design-only, return the design. Otherwise continue through the existing development flow. A deviation from the sketch is evidence: decide whether the sketch, the requirement or the implementation is wrong before spreading a workaround, and redesign the smallest responsible boundary.

Output: caller examples, ownership and types, rejected alternative, relevant verification and remaining limits. A sketch does not establish acceptance.
