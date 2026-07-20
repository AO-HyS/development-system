# ADR 0004: Lifecycle gates are persisted and operation-specific

Status: Accepted

## Context

A router or skill recommendation can be mistaken for permission to advance the development lifecycle. Chat-only approvals are also difficult to inspect and can accidentally become transitive permission for merge, release, production, economic activation, or destructive work.

## Decision

Represent each workflow as a persisted state machine with explicit manual transitions. Recommendations are read-only. Wayfinder remains outside the normal lifecycle and requires an explicit invocation. Requirements, spec plus Local Visual Plan, tickets, Implement Preview, and the final decision surface are separate observable stages.

Implement Preview records one terminal slice and grants only its delivery operations. Pre-release readiness requires recorded implementation, tests, validation, review, QA, commit, push, PR, and preview evidence. Merge, release, production, paid activation, and destructive operations use exact, concurrency-safe, one-shot authorizations that are available only after pre-release evidence. A negated, denied, or out-of-order request does not persist state or report external side effects.

Natural-language requests are mapped to canonical operation names, and evidence retains the original request, stages before and after, authorization source, and timestamp. Lifecycle state is separate from installation state and is validated before use.

## Consequences

- Classification and recommendation cannot expand authority.
- Humans can inspect the exact transition or operation they authorized.
- Delivery automation can reach a review surface without inheriting promotion rights.
- Harness adapters can consume one shared observable contract without changing its authorization semantics.
- Corrupt or unsafe state paths fail closed.
