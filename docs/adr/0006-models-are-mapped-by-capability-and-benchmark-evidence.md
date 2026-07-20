# ADR 0006: Models are mapped by capability and benchmark evidence

Status: Accepted

## Context

One model does not dominate orchestration, implementation, review, architecture, browser QA, and visual judgment. First-diff speed also hides correction cost, slop, and time to verified delivery. Factory `inherit` can make a run irreproducible when the resolved model is absent from evidence.

## Decision

Maintain one rerunnable benchmark suite with identical fixtures, instructions, and checks per candidate. Record harness, model, reasoning, duration, correction time, verified-delivery time, tokens, reported cost, corrections, findings, and slop. Rank only within a capability.

Maintain a capability roster independently from lifecycle code. Treat current Codex and Factory mappings as provisional. Resolve every Factory `inherit` value to an explicit model in the versioned roster before execution.

## Consequences

Model changes do not modify lifecycle behavior. History can compare replacements over time. A fast unverified response cannot outrank a slower verified delivery merely by being the first diff.
