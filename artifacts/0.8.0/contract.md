# Development System contract

Contract version: `0.8.0`

## Dual operator interface

Every prepared repository exposes the same lifecycle in two equivalent operator styles. In automatic mode, the operator describes a software goal and `drive-development-flow` classifies or recommends the smallest fitting stage. Classification is read-only with respect to manual gates: it cannot invoke Wayfinder, start requirements, approve requirements, create or approve a spec and Local Visual Plan, create or approve tickets, authorize Implement Preview, or grant promotion authority.

In explicit mode, the operator invokes the exact phase command. Codex and T3Code expose `$wayfinder`, `$grill-with-docs`, `$to-spec`, `$to-tickets`, `$flow-implement`, and `$flow-code-review`; Factory exposes the equivalent slash commands. Explicit phase selection changes routing only within the authority carried by the request.

`flow-implement` is the Implement Preview entry point. It requires one named terminal slice and may autonomously implement, test, validate, review, correct, run proportional QA, commit, push, open or update a pull request, publish a preview, and create a Local Visual Recap. It stops at `ready-for-human`.

Merge, release, and production are excluded from both routing modes. Each requires a separate exact human authorization for that operation. A recommendation, phase invocation, successful validation, pull request, preview, or previous promotion grant is never transitive authority.

## Repository rollout

Repository preparation remains audit-first and reversible. `audit-repository` is read-only. `initialize-repository` and `normalize-repository` require their explicit confirmation and may update only `.development-system/repository.json`, `.codex/development-system/repository.md`, and `.factory/development-system/repository.md`. Product domain language, stack, commands, design, release policy, data, secrets, paid-service state, and existing work remain product-owned.

Versions `0.1.0` through `0.7.0` remain byte-immutable. Version `0.8.0` retains reversible canonical installation, explicit skill provenance, persisted lifecycle gates, observable multi-harness parity, capability-based model mappings, Implement Preview's private human gate, bounded repository fingerprinting, and fail-closed runtime preflight.
