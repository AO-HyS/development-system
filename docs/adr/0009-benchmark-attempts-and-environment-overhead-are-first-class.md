# ADR 0009: Benchmark attempts and environment overhead are first-class

Status: Accepted

## Context

Architecture scoring previously received only completed structured answers.
Timeouts and capability-contaminated attempts were retained privately but
disappeared before measurement v2, allowing a scorecard to show zero timeouts.
Measured Codex processes also loaded unrelated global MCP/plugin configuration,
mixing environment startup with model latency and tokens.

## Decision

Record every unscored architecture attempt in a separate closed,
privacy-minimized manifest bound to the same suite and route identity as an
answer. Surface timeout and integrity counts in architecture reports and
measurement v2. Integrity-invalid attempts count toward operational reliability
and cost, but not validated evidence or model-quality rates.

Run Codex benchmarks with process-scoped user-config isolation while retaining
the canonical `CODEX_HOME`. Attribute this delta to environment overhead. Do
not mutate global integrations to improve a benchmark.

## Consequences

Completed-answer quality and attempt reliability can no longer be conflated.
Timeouts cannot disappear from the scorecard, capability contamination is not
blamed on the model, and operational integrations remain available outside the
measured process.
