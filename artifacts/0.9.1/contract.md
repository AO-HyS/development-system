# Development System contract

Contract version: `0.9.1`

## Constant goal

Deliver correct functionality to the authorized state as fast as possible,
with useful quality, the lowest measured cost, and the least complexity.

Normal implementation follows one fixed proportional loop. Wayfinder,
grilling, specifications, tickets, prototypes, multiple-ticket execution,
broad suites, and promotion are user-triggered and never inferred from project
size, ambiguity, or urgency.

## Fast evidence

A tiny change targets working functional evidence within five minutes. Ten
minutes is an exceptional ceiling and requires a written reason. Crossing that
ceiling pauses the run for a process audit; it does not authorize more agents,
tests, or release ceremony.

The smallest check that directly proves the acceptance criterion is primary.
Test, route, destination, and surface totals are not quality claims unless the
report maps them to the behavior they prove. A full repository suite is
forbidden by default and may run only when the user explicitly authorizes it
for the current execution.

## Explicit `work-multiple` mode

Providing several tickets does not authorize parallel worktrees. Clear user
intent such as "trabaja múltiples tickets", "modo múltiple", or "ejecuta los
tickets en paralelo" activates the mode.

The separate `work-multiple` skill requires explicit surfaces and blockers for each ticket. Tickets
that share a surface or dependency chain execute sequentially in one lane.
Disjoint lanes may run in parallel in separate worktrees. The orchestrator
integrates all lanes into one candidate, two context-isolated reviews, and one
pull request when publication is authorized.

## Value-selected UI QA

No UI change makes manual UI QA not applicable. A label, copy, icon, or obvious
style-only change without behavioral risk skips it. Interaction, navigation,
mutation, responsive behavior, a meaningful regression, or a critical flow
requires one direct acceptance flow. A user-visible file alone does not trigger
browser QA.

The goal evaluator reports correctness, quality, speed, cost, and simplicity
separately as `met`, `missed`, or `unproven`; it does not produce a composite
score.

## Observable model routing

The plan records its selected route. Every delegated runtime result records
role, agent or droid, harness, actual resolved model, reasoning, and runtime
source. A selected model copied into the plan is not execution evidence;
`inherit` is unresolved, not successful routing.
Codex routes bounded implementation and focused tests to Luna, browser QA to
Terra, and uses Sol only for work needing its judgment. Spark is not part of
the normal implementation route.

Every delegated writer receives an expected absolute worktree and branch. It
must verify both before reading or editing and reject patch targets outside
that Git root. A mismatch interrupts the writer before diff relocation or
restoration.

Factory droids installed by this contract use explicit models exposed by
`droid 0.111.0`: GPT-5.4 Mini for mapping/planning/tests, GPT-5.3 Codex Fast for
bounded implementation, Claude Sonnet 4.6 for browser QA, and Claude Opus 4.7
for independent review. Availability is verified; performance mappings remain
provisional until repeated same-packet benchmarks establish delivery time,
quality, and cost.

## Authorization

This contract does not authorize merge, release, production, paid activation,
destructive cleanup, HOME installation, or automatic multi-ticket work. Those
boundaries remain explicit and operation-specific.
