# ADR 0011: User-triggered flows and goal evidence

Status: Accepted

## Context

Automatic lifecycle inference added skills, agents, tests, previews, and UI
checks that often did not prove the requested behavior. The resulting context
and latency obscured the actual goal. A small UI label change could receive the
same browser ceremony as an interactive regression, while counts of tests or
destinations were reported as quality without mapping them to acceptance
criteria.

## Decision

The development flow holds one constant:

> Deliver correct functionality to the authorized state as fast as possible,
> with useful quality, the lowest measured cost, and the least complexity.

Normal authorized implementation uses one fixed implementation loop. Every
other lifecycle flow is user-triggered: Wayfinder, grilling, specification,
ticket generation, prototype work, multiple-ticket execution, broad suites,
and promotion are not inferred from task size or wording that merely describes
the work.

`work-multiple` is a separate explicit skill. It groups overlapping tickets
into sequential lanes and runs only disjoint lanes in parallel worktrees,
integrating them into one candidate. Its current Codex implementation route is
defined by ADR 0012. A named model remains a candidate, not proof; same-packet
measurements determine replacements.

Manual UI QA follows a deterministic value rule:

- no UI change means not applicable;
- label, copy, icon, or obvious style-only work without behavior risk is
  skipped;
- interaction, navigation, mutation, responsive behavior, a meaningful
  regression, or a critical flow requires one direct acceptance flow.

Quality evidence is limited to checks that explain what they prove: affected
linters or type checks, focused fast tests, applicable React Doctor or
Impeccable checks, two context-isolated reviews for multiple work, and manual
acceptance only when the rule requires it. Full-suite, test-count, route-count,
destination-count, and generic green status are not quality by themselves.

Goal evaluation reports correctness, quality, speed, cost, and simplicity
separately as `met`, `missed`, or `unproven`. It has no composite score. Tiny
work meets the speed goal only at five minutes or less; five to ten minutes is
an exception and still misses the goal. Multiple work needs a comparable
sequential baseline to prove speedup, and cost remains unproven without
authoritative comparable evidence.

## Consequences

The user chooses when additional thinking or parallelism is worth its context
cost. The ordinary path stays small and predictable. UI verification is tied
to observable risk. Reports can say that a goal is not yet demonstrated
instead of converting missing evidence into an optimistic score.
