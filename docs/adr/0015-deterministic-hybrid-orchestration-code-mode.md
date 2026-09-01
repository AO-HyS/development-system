# ADR 0015: Deterministic hybrid orchestration and bounded Code Mode

Status: Accepted for contract 1.5.13

## Decision

Use a pure deterministic planner to validate task contracts, classify direct,
sequential, and specialist lanes, resolve explicit models, and select optional
read-only Code Mode attempts or `simplify-code` reviews. The planner never launches
agents, invokes providers, edits files, or grants delivery authority.

Keep Sol as the parent for ambiguity, decomposition, conflicts, integration,
and final verification. Use Luna for bounded implementation and focused work,
followed by an independent Sol review. Trivial edits remain direct.

Code Mode eligibility is deterministic from a read-only,
structured-tool-heavy research, audit, or operations-analysis lane. The pure
planner always returns `selected: false` and
`selectionAuthority: "host-runtime"`; it never accepts a caller-asserted
receipt as activation. The actual harness may select Code Mode only when the
callable tool is present. Host events are post-execution evidence, not planner
input authority. A raw CLI or T3 Code runtime without that tool falls back to
the ordinary sequential read-only lane.

Use `simplify-code` as an optional read-only review selected by explicit
diff-risk signals or direct invocation. Raw LOC is not a quality gate, and the
review may not remove correctness, security, accessibility, observability,
performance, architecture, validation, tests, or explicit product behavior.

## Consequences

Predictable routing and lane bookkeeping no longer require repeated agent
deliberation. Novel product and architecture judgment remains with the parent.
Code Mode can reduce tool-call and transformation overhead without becoming a
file-editing escape hatch. Contract 1.5.12 remains the rollback target.
