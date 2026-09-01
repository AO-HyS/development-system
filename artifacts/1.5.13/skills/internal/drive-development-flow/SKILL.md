---
name: drive-development-flow
description: Route software goals and process discussions through the smallest user-requested lifecycle stage, using deterministic hybrid orchestration for non-trivial implementation.
---

# Drive Development Flow

Treat a development conversation as a lifecycle. Route only the stage the
operator requested; ordinary implementation remains direct and definition
ceremonies remain opt-in.

Use the pure `orchestration-plan` operation before non-trivial implementation.
It validates the explicit task contract and observed runtime signals, chooses
the smallest direct, sequential, or specialist lane, and records its exact
roles and models. Runtime absence or an unavailable capability uses the
declared fallback; it does not block work. The planner has no side effects.

Do not create or require Working Backwards, grilling, specs, tickets, or
parallel work unless explicitly requested or already supplied by the current
conversation or repository. A clear trivial edit stays on the parent.

Preserve all authorization boundaries: implementation, commit, push, PR,
merge, release, production, external writes, paid services, and destructive
cleanup are separate operations. Planning never grants them.

For non-trivial work, the Sol parent retains ambiguity, decomposition,
conflicts, integration, and final verification. Luna owns bounded mapping,
research, implementation, and focused tests. An independent Sol review follows
the diff. Code Mode is only a read-only structured-tool-heavy execution
primitive when runtime evidence proves it is available. `simplify-code` is an
optional explicit or planner-selected read-only review and never replaces
correctness, security, performance, or visual review.
