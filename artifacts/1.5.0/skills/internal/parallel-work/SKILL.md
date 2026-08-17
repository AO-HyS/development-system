---
name: parallel-work
description: Execute several authorized software tickets through dependency-aware, conflict-safe lanes and one integrated candidate. Use only when the user explicitly asks to work several tickets or repositories in parallel. `work-multiple` is a deprecated migration alias.
---

# Parallel Work

This is an explicit execution mode. Never infer it from ticket count, project size, or urgency. Accept `work-multiple` only as a documented migration alias and use `parallel-work` in every new instruction, report, and contract.

## Plan before writers

Pass the authorized tickets, dependencies, owned surfaces, acceptance evidence, checks, stop conditions, branch/worktree when applicable, and the observed agent route to:

```text
development-system parallel-work --input <plan.json> --json
```

The returned frontier and lanes are authoritative:

- dependency chains and shared surfaces stay sequential in one lane;
- only disjoint lanes may run concurrently;
- every lane has exactly one writer at a time;
- every writer verifies its absolute Git root, branch, and owned surfaces before editing;
- `resolvedModel` is runtime evidence and can never be `inherit`;
- a lane failure blocks its descendants but not independent lanes while the shared base remains healthy.

Do not create a worktree merely because a lane exists. Use the current repository when one writer can advance safely; create registered worktrees only when concurrent writers require isolation and the user authorized parallel execution.

## Integrate once

The default delivery shape is one integrated branch and one pull request. Separate pull requests require an explicit reason. Before claiming coherence, compare the candidate against the recorded base, detect drift and conflicts, run the focused checks declared by each lane, and complete one integrated Standards + Spec review.

Return a compact status: executable frontier, active lanes, blocked descendants, evidence, candidate state, and next action. Do not paste raw logs. Planning has no external side effects and grants no merge, release, production, paid-service, or destructive authority.

Record real phase timings with the canonical development-run recorder. Missing timing, token, cost, provider, or quality data stays `unproven`; never run a synthetic benchmark in the normal path.
