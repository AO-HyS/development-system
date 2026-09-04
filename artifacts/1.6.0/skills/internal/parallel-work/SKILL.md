---
name: parallel-work
description: Execute an explicitly invoked set or an already-authorized multi-ticket initiative through dependency-aware, conflict-safe lanes and one integrated candidate.
---

# Parallel Work

The `orchestration-plan` operation is the sole automatic router. It activates
this planner only when a task contract names at least two exact requested work
items and the work graph matches that set completely. Mere ticket count,
project size, or urgency does not authorize work. Explicit `$parallel-work`
remains a compatibility entry point for one release.

The returned `frontier` is dependency-ready work. The
`executableFrontier` is the deterministic subset that fits writer capacity and
has no overlapping ownership. `waitingTickets` states whether each remaining
item waits on dependencies, a surface conflict, or capacity. Dependency edges
do not permanently union lanes; surface locks prevent overlapping lanes from
running together. Failures block descendants while independent work continues
if the shared base is healthy.

Each active lane has one writer, exact ownership, dependencies, phase,
terminal state, explicit model, focused checks, and an orchestration bundle.
Run integration checks once on the integrated candidate. Default to one branch
and one pull request; separate delivery requires a reason. Planning has zero
authority and no side effects.

Before dispatch, the parent verifies the current user request against the
returned repository, revision, exact IDs, and operation. `dispatchAuthorized`
always remains false in the pure plan. One integration barrier runs the smallest
checks justified by changed behavior. Repeat only after a relevant edit, failure,
or unresolved risk. Logical review phases do not require separate agents; Astra
reviews ordinary work and requests Fable for complex or adversarial review.
