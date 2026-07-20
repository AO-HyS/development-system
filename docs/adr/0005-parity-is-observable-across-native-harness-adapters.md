# ADR 0005: Parity is observable across native harness adapters

Status: Accepted

## Context

Codex and Factory expose different tools, roles, models, hooks, discovery behavior, and command syntax. T3Code currently presents Codex rather than a distinct runtime. Comparing copied files or command names can report false parity while authorization, side effects, or runtime state diverge.

## Decision

Treat Codex and Factory as native adapters behind one Development Contract Scenario Interface. Validate instructions, catalog, actual load, hooks, roster, model/role, side effects, external state, overflow, transition, authorization, and terminal state through real harness processes. Attribute failures to canonical source, adapter, harness runtime, or repository policy.

Treat T3Code as a Codex client surface sharing the Codex state namespace. Any observable divergence fails validation and must be explained before a third adapter is introduced.

## Consequences

Adapter filenames and commands may differ without breaking parity. A green structural check cannot replace operational evidence. Live validation is portable across AO, simple and mature repositories, and nested CWDs without mutating the operator's HOME.
