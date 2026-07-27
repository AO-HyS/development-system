# ADR 0010: Fast functional evidence and explicit multiple-ticket mode

Status: Accepted

## Context

The delivery system repeatedly treated large test counts, route matrices,
review lanes, and release receipts as quality even when none asserted the new
user behavior. Tiny product changes could spend tens of minutes in broad local
gates and duplicated orchestration. Multiple tickets were either serialized
one at a time or delegated without a deterministic overlap plan. The capability
roster existed for benchmarks, but delivery did not consume it, so actual work
could silently inherit one expensive model.

## Decision

A tiny change targets functional evidence within five minutes. Ten minutes is
an exceptional ceiling and requires a recorded reason; exceeding it stops the
run for a process audit. The primary evidence is the smallest check that proves
the acceptance criterion. A full suite is forbidden by default and runs only
from explicit user authorization for that execution.

Multiple-ticket worktrees are a separate opt-in mode. Natural language that
clearly requests multiple-ticket or parallel execution activates it; merely
providing several tickets does not. The planner maps every ticket to explicit
surfaces and blockers. Shared surfaces and dependency chains form one
sequential lane. Disjoint lanes may use separate worktrees in parallel. The
orchestrator integrates all lanes into one candidate, two context-isolated
reviews, and one pull request when publication is separately authorized.

The plan records its selected route. Every delegated result records role, agent
or droid, harness, actual resolved model, reasoning, and runtime source.
Copying the selected model into a receipt is not execution evidence; `inherit`
is unresolved evidence. Codex uses
Spark for exact bounded implementation, Luna for mapping/planning/focused test
execution, Terra for browser QA, and Sol only where its judgment is warranted.
Factory uses explicit models exposed by the installed `droid 0.111.0` runtime;
new mappings remain provisional until same-packet benchmarks establish their
speed, quality, and cost.

## Consequences

Quality reports must map every ticket acceptance criterion to what the check
proved and what was observed instead of citing totals or an empty green flag.
Ordinary tiny changes avoid agent, review, and suite ceremony. Explicit
multiple-ticket runs gain parallelism without allowing overlapping writers.
Model usage becomes auditable, while unbenchmarked Factory routes remain
visibly provisional rather than being mislabeled as optimal.
