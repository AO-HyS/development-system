# Development System contract

Contract version: `0.8.0`

## Dual operator interface

Every prepared repository exposes the same lifecycle in two equivalent operator styles. In automatic mode, the operator describes a software goal and `drive-development-flow` infers, loads, and runs the smallest fitting stage as far as the request already authorizes. A request that asks only for a recommendation remains read-only. Automatic routing may enter a stage without an explicit phase command, but it cannot approve a human gate, broaden the request's authority, or grant promotion authority.

In explicit mode, the operator invokes the exact phase command. Codex exposes `$wayfinder`, `$grill-with-docs`, `$to-spec`, `$to-tickets`, `$flow-implement`, and `$flow-code-review`; Factory exposes the equivalent slash commands. T3Code remains a structural Codex client surface and shares its adapter and state namespace, but independent live command discovery and activation are not certified by this contract. Explicit phase selection changes routing only within the authority carried by the request.

`flow-implement` is the Implement Preview entry point. It requires one named terminal slice and autonomously runs the bounded development loop inside the authority already carried by the request. Tests, validation, review, correction, and proportional QA are development substeps, not independent authority to mutate external state. Commit, push, pull-request, preview, deployment, and promotion state changes occur only when the request and repository policy authorize each operation. The phase stops at its pinned human-review or delivery boundary and never crosses `ready-for-human` by itself.

Merge, release, and production are excluded from both routing modes. Each requires a separate exact human authorization for that operation. A recommendation, phase invocation, successful validation, pull request, preview, or previous promotion grant is never transitive authority.

## Repository rollout

Repository preparation remains audit-first and reversible. `audit-repository` is read-only. `initialize-repository` and `normalize-repository` require their explicit confirmation and may update only `.development-system/repository.json`, `.codex/development-system/repository.md`, and `.factory/development-system/repository.md`. Product domain language, stack, commands, design, release policy, data, secrets, paid-service state, and existing work remain product-owned.

Repository readiness covers the generated adapter and the product's declared commands; it does not claim that lifecycle skills are loaded. Operational use also requires the global `0.2.0` skill catalog to be synchronized and the active Codex or Factory harness to discover the six explicit commands plus `drive-development-flow`. T3Code readiness is structural compatibility with the Codex adapter until separately probed live.

Versions `0.1.0` through `0.7.0` remain byte-immutable. Version `0.8.0` retains reversible canonical installation, explicit skill provenance, persisted lifecycle gates, observable multi-harness parity, capability-based model mappings, Implement Preview's private human gate, bounded repository fingerprinting, and fail-closed runtime preflight.
