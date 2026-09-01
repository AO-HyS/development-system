# Development System Contract 1.5.13

Version 1.5.13 retains every guarantee and authorization boundary of 1.5.12
and adds a deterministic planner for hybrid orchestration. Version 1.5.12
remains the supported rollback target. Published contract, catalog, and
manifest bytes remain immutable.

Ordinary work remains direct by default; definition ceremonies stay opt-in.

## Deterministic hybrid orchestration

The fast-model-first policy remains in force, with deterministic routing
removing unnecessary orchestration overhead.

Every non-trivial implementation starts from an explicit task contract and
observed signals. The pure `orchestration-plan` operation validates the
objective, owned scope, acceptance evidence, focused checks, and stop
condition, then returns direct, sequential, or specialist lanes with explicit
roles, resolved models, reasoning, ownership, checks, and terminal conditions.
It never launches agents, calls providers, writes files, or grants delivery
authority.

Trivial localized work remains direct on the Sol parent. Normal non-trivial
work uses one bounded Luna `fast_implementer` writer followed by an
independent Sol reviewer. Specialists are added only for an explicit observed
risk. The Sol parent retains ambiguity, decomposition, conflict resolution,
integration, and final verification.

## Code Mode and simplification

The planner determines Code Mode eligibility only from the lane kind and its
explicit `readOnly` and `structuredToolHeavy` signals. It always returns
`selected: false` with `selectionAuthority: "host-runtime"`; a claimed receipt,
model report, flag, or configuration cannot activate it. The actual harness
may select Code Mode only when its callable tool is present. After execution,
host events are evidence for the report, not planner-input authority. A raw
CLI or T3 Code runtime without that tool uses the ordinary sequential
read-only fallback without blocking. Code Mode is an execution primitive for
tool composition, not a product-file editing route.

The optional `simplify-code` review is selected only by explicit diff-risk
signals or direct invocation. It recommends safe deletion, reuse, native
platform, standard-library, or already-installed dependency alternatives. It
does not use raw LOC as a quality gate and never trades away correctness,
trust-boundary validation, security, accessibility, observability,
architecture clarity, required tests, or explicit product behavior.

## Priorities and boundaries

The operating priority is speed to a verified result, then quality, then cost.
The policy never grants commit, push, PR, merge, release, production,
external-write, paid-service, or destructive-cleanup authority. Missing
telemetry remains unproven. Codex and T3 Code are supported; Factory remains
out of scope for this release.

## Rollback

If planner routing or Code Mode capability detection does not produce the
expected result, reinstall contract `1.5.12` and catalog `0.19.0`. This
release never changes the published 1.5.12 bytes.
