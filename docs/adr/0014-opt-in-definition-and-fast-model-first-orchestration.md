# ADR 0014: Opt-in definition and fast-model-first orchestration

Date: 2026-08-28  
Status: Accepted for contract 1.5.12

## Context

The prior default treated ordinary feature language as a reason to begin
Product Grill or Working Backwards. That added ceremony to work that was
already understood. Historical execution evidence also showed that the fast
Luna capacity was used mostly for mapping while the actual implementation and
focused verification stayed on slower parent lanes.

## Decision

Ordinary feature, bug-fix, review, research, and QA requests route directly to
their matching flow. Product Grill, Grill With Docs, Future Customer Story,
Technical Grill, Working Backwards, specification, ticket generation, and
Parallel Work are explicit user choices. Only Working Backwards intent enters
the Product Grill route; `grill-with-docs` remains its own explicit flow.

For non-trivial implementation, Sol High remains the parent and owns
decomposition, integration, conflicts, and final verification. The default
execution lane is one sequential Luna `fast_implementer` writer. Luna mapping
or research and focused test lanes are added only when their evidence value is
real, followed by an independent Sol review. Depth is one and corrections
reuse the original lane.

## Consequences

This reduces ceremony and puts fast capacity on the critical implementation
path while retaining proportional quality. Explicit definition requests remain
available for work that benefits from them. Missing evidence, inherited model
names, unclosed lanes, and unsafe parallel ownership remain invalid; this
decision does not grant delivery or production authority.
