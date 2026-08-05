# Development System contract 1.1.0

Version 1.1.0 retains every 1.0.0 lifecycle, authorization, adapter, benchmark, repository-preparation, delivery, measurement, privacy, installation, and rollback guarantee. It adds versioned public-web retrieval, executable global command guardrails, calibrated decision review, stepwise setup guidance, and a native-goal contract aligned with current Codex behavior.

## Exa retrieval

- `exa-search` is a global Codex/Factory skill for public-web discovery through the paid Exa Search API. T3 Code uses the Codex installation.
- The safe default is `auto`, five results, and highlights. Full text requires an explicit character cap; deep modes and forced live crawl require a task-specific reason.
- Queries, prompts, filters, and schemas must not contain secrets, private source, customer data, PHI, PII, private URLs, or private identifiers. Repository policies may impose stricter rules.
- The wrapper validates current raw-JSON camelCase, deprecated fields, search-mode conflicts, bounded content, and output-schema limits before network use.
- Private telemetry records status, duration, type, counts, request ID, and the API-reported estimated request cost. It never records query text, result URLs, excerpts, response bodies, credentials, or secrets. Billing remains authoritative.
- The canonical coding-agent guide is checked for version-sensitive changes. Current official Exa pages disagree on the primary authentication header; this adapter follows the coding-agent guide's `Authorization: Bearer` form.

## Executable global guardrails

- `global-agent-guardrails` supplies one versioned policy engine and native adapters for Codex/T3 Code and Factory.
- Codex/T3 Code use a Codex `PreToolUse` hook; Factory uses an `Execute` `PreToolUse` hook compatible with both the Factory App and the older local Droid CLI.
- Activation merges into user-owned JSON and snapshots the exact previous bytes. It never replaces unrelated hooks or settings. Rollback restores the exact snapshot.
- The hook fails closed on malformed matched shell input and hard-blocks recursive forced deletion, disk destruction, destructive Git worktree/history operations, forced pushes, repository deletion, high-impact infrastructure destruction, and download-to-shell pipelines.
- A block cannot be bypassed by the agent. A human must review the exact target and recovery plan and act outside or deliberately remove the guard.
- Guardrails are defense in depth, not a sandbox and not authorization.

## Native goals

- No duplicate `goal-loop` skill is installed. The useful parts are part of `drive-development-flow` and `flow-implement`.
- A terminal slice has exactly one objective, explicit constraints and scope, exact evidence and validation, a verifiable stop condition, and explicit authorization boundaries.
- Native goals are created or managed only when the user explicitly requests the native capability. Persistence never grants new authority or changes the terminal slice.
- Codex 0.146 agent updates are limited to `complete` and `blocked`. Completion requires the objective to be achieved with no required work remaining. Blocked requires the same blocking condition to recur for the platform-defined threshold. Pause, resume, budget, and usage state remain user/platform controls.

## Decisions and setup

- `decisions` is manual-only and reports only consequential choices that remain genuinely uncertain, their strongest alternative, the smallest resolving test, and reversibility. It does not expose hidden reasoning or create ADRs without separate write authorization.
- `setup-help` is manual-only and reveals one verified setup action at a time while maintaining the complete checklist internally. It does not automate credentials, purchases, consent, or consequential account changes.

## Catalog and authorization

- Catalog 0.5.0 adds `exa-search`, `global-agent-guardrails`, `decisions`, and `setup-help`, and updates `drive-development-flow` and `flow-implement` without changing immutable prior catalogs.
- Installation and activation remain separate, reversible operations. This contract does not authorize commits, pushes, pull requests, merges, releases, deployments, purchases, or external-system changes beyond the explicitly requested local installation and repository-policy updates.
