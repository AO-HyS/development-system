# ADR 0008: Repository audit and preparation are separate transitions

Status: Accepted

## Context

Product repositories have different stacks, commands, release policies, designs, nested instructions, and harness integrations. A structural scan can mistake copied files for operational capabilities, while an automatic repair can silently import another product's rules or mutate product-owned configuration.

## Decision

Expose a read-only `audit-repository` Interface that fingerprints the repository and reports instructions, precedence, skills, agents/droids, hooks, six-state load evidence, foreign-product residue, stack capabilities, preview gaps, and readiness per harness. Accept runtime load evidence only when it matches the current repository fingerprint.

Expose `initialize-repository` and `normalize-repository` as distinct, explicitly confirmed transitions. Both may write only the three Development System-managed repository files. They preserve product-owned domain, stack, commands, release policy, and design, remain idempotent, and never activate paid services. Codex and Factory receive behaviorally equivalent repository contracts; T3Code remains a Codex client surface.

Keep `improve-codebase-architecture` manual and proposal-only. Its report may propose deepening, but cannot trigger a refactor.

## Consequences

- Audit can be run safely before any repository mutation is authorized.
- Preparation cannot rewrite product identity or silently clone another repository.
- Missing operational evidence remains visible instead of being inferred from files.
- React and Convex rules can vary behind one observable repository-preparation Interface.
- Pilot repositories remain unready until their own audits and rollout gates are completed.
