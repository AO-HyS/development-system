---
name: coding-orchestration
description: Use the deterministic orchestration planner for non-trivial Codex and T3 Code work, with fast-model-first bounded lanes and one writer by default.
---

# Coding Orchestration

The parent owns the requested end state, integration, conflicts, and final
verification. Before non-trivial work, provide an explicit task contract and
observed signals to `orchestration-plan`. Follow its valid output exactly.

## Routing

- A trivial, localized, reversible edit stays direct on the Sol parent.
- Normal non-trivial work uses one Luna `fast_implementer` writer and then one
  independent Sol `reviewer`.
- Add a specialist only when the planner receives an explicit observed risk
  such as security, performance, visual, backend, or data risk.
- The planner marks Code Mode eligible only for a read-only,
  structured-tool-heavy research, audit, or operations-analysis lane. It
  always reports `selected: false` and `selectionAuthority: "host-runtime"`;
  only the actual harness may select it when its callable tool is present.
  Code Mode is not a product file-editing mechanism. A raw CLI or T3 Code
  runtime without that tool uses the planner's sequential read-only fallback.
- Select `simplify-code` only when explicitly invoked or when explicit diff-risk
  signals select it. It is read-only and does not replace independent
  correctness, security, performance, accessibility, or visual review.

The planner selects mechanics; the Sol parent handles ambiguity, decomposition,
architecture judgment, conflicts, integration, and the requested end state.
Do not infer runtime capability from a model's self-report, an installed file,
or caller-provided planner input. Host execution events may be recorded as
post-execution evidence, but they do not activate Code Mode in the pure
planner. Never use raw LOC as a quality gate.

## Lane contract

Each lane must carry one objective, exact ownership, resolved model and
reasoning, expected output, focused checks, stop condition, and terminal state.
Keep one writer by default. Do not launch agents or providers from the pure
planner. Every started lane closes as `integrated`, `discarded`,
`blocked-with-owner`, or `not-started`.

## Final evidence

Report the planner mode, selected lanes, resolved runtime models, Code Mode
observation or fallback, simplification findings when selected, focused
checks, corrections, lane states, and verified outcome. Missing runtime,
model, or capability evidence remains unresolved rather than inferred.
