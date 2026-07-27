---
name: work-multiple
description: Execute several authorized software tickets through conflict-aware parallel worktrees and one integrated candidate. Use only when the user explicitly invokes $work-multiple or clearly says to work multiple tickets in parallel; never infer activation from ticket count, project size, or urgency.
---

# Work Multiple

Optimize for one constant goal:

> Deliver correct functionality to the authorized state as fast as possible,
> with useful quality, the lowest measured cost, and the least complexity.

This skill is an explicit execution mode, not a router. If the current request
does not clearly authorize multiple-ticket execution, stop without creating
worktrees or agents.

## Freeze the run

Require at least two authorized tickets. For each ticket, record:

- its acceptance criterion;
- owned product and code surfaces;
- declared blockers;
- whether it changes behavior or only mechanical text/style;
- the publication and production boundary.

Do not create, expand, reorder, merge, release, or deploy tickets unless that
operation is separately authorized.

## Build the smallest lane graph

1. Put tickets sharing a product surface, file surface, or dependency chain in
   one sequential lane.
2. Put only disjoint lanes in separate registered Git worktrees.
3. Use no more writers than disjoint lanes.
4. Start disjoint lanes together. Run tickets inside a lane sequentially.
5. Keep the parent responsible for conflicts and one integrated candidate.
6. Create one review and one pull request, when publication is authorized.

Before starting writers, capture each lane's absolute worktree path, branch,
HEAD, and `git worktree list --porcelain` evidence.
Include the expected absolute path and branch in every writer packet. The writer
must verify both before its first read or edit and reject every patch target
outside that Git root. A mismatch interrupts the writer before any relocation,
restoration, or integration begins.

## Route for speed

- Keep trivial mapping and integration on the parent.
- Use the active harness roster's explicit `fast_implementer` route for exact
  bounded implementation. Codex resolves that route to Luna High; Factory uses
  its separately versioned explicit droid mapping.
- If the fast route fails the same bounded packet twice, use the active
  harness's judgment-capable implementer only when the packet needs judgment;
  otherwise keep the bounded work on the parent. Browser-QA models remain
  reserved for browser QA.
- Use discovery or QA agents only when their parallel work saves more time than
  their startup and context cost.
- Record actual harness runtime worker, model, reasoning, session, and event
  metadata. A planned model or `inherit` is not execution evidence.

## Run the fixed implementation loop

For each ticket:

1. implement the smallest complete behavior;
2. run the affected linter or typecheck when it is locally available and fast;
3. run only focused local tests that prove the changed contract;
4. run React Doctor or the applicable Impeccable CLI only when React,
   interaction, or visual implementation changed and the repo exposes it;
5. never run a full repository suite unless the user requests it for this run.

After integration, run two independent code reviews concurrently. Give both
reviewers only the fixed diff, acceptance criteria, and their own review brief.
Do not give either reviewer the implementation narrative or the other report.
Resolve blocker/high findings before continuing.

## Select manual QA by value

Run `node scripts/select-qa.mjs --input <change.json>` from this skill.

- No UI change: manual UI QA is not applicable.
- Label, copy, icon, or obvious style-only change with no behavioral risk:
  skip manual UI QA.
- Interactive behavior, navigation, mutation, responsive behavior, a meaningful
  regression, or a critical user flow: run one direct manual acceptance flow.
- If the useful flow no longer exists, verify the closest observable
  acceptance criterion instead of recreating obsolete ceremony.

Record the decision and one-sentence reason. Do not cite route, destination, or
test totals as quality.

## Measure the goal

Start timing when execution begins and stop `functionalEvidenceMs` when every
acceptance criterion has observable evidence. Review, PR, CI, deployment, and
promotion are separate timings.

Finalize a private run record, then execute:

```sh
node scripts/evaluate-goal.mjs --input /private/path/run.json
```

The evaluator reports correctness, quality, speed, cost, and simplicity as
separate axes:

- tiny work meets the speed goal only at five minutes or less;
- five to ten minutes is an exception, not success;
- above ten minutes stops the run for process audit;
- multiple work needs a comparable sequential baseline to prove speedup;
- missing comparable authoritative price evidence makes the cost goal
  unproven; token counts remain resource evidence, not price;
- any missing acceptance proof, failed relevant check, non-independent review,
  or unresolved blocker/high finding fails quality.

Do not create a composite score. Return `met`, `missed`, or `unproven` with the
exact failed or unavailable axes.
