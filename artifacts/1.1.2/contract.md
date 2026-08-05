# Development System contract 1.1.2

Version 1.1.2 retains every 1.1.1 lifecycle, authorization, adapter, benchmark, repository-preparation, delivery, measurement, privacy, installation, and rollback guarantee. Published 1.1.1 bytes remain unchanged.

This patch closes rollout ambiguities in generated repository adapters and live harness evidence:

- `services.paidActivation: false` means adapter generation and normalization never call, enable, subscribe to, or spend against a paid service. It does not contradict declaring an installed paid agent tool. Actual use of `exa-search` still requires repository opt-in or explicit user invocation and remains subject to its privacy, cost, and source-verification contract.
- Provider readiness is a conditional delivery gate for changes that affect authentication, data migrations, seeds, roles, provider configuration, or environment contracts. A repository without a provider-readiness command is not structurally unprepared merely because no provider surface is changing. When such a surface does change, the delivery plan must require authentic provider evidence or stop; it must never invent an alias or green state.
- Failed live harness probes classify authentication, timeout, missing-binary, permission, and runtime failures without persisting raw provider output. A nonzero probe can never claim that a skill was loaded or influenced behavior.

Skill catalog 0.5.1 remains current and byte-for-byte unchanged because this patch changes repository adapter generation and readiness semantics, not skill contents.
