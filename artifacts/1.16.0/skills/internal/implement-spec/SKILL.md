---
name: implement-spec
description: Implement an approved specification through the Development System's authorized work graph without inheriting delivery or cleanup authority.
---

# Implement Spec

Use `coding-orchestration` as the only router. Read the approved spec and resolve
its authorized ticket set and dependencies. Use the pure `orchestration-plan`
operation when dependencies or disjoint ownership need an explicit frontier.
For an ordinary bounded change, execute directly through the same router.

The user's request may authorize a named spec and its scoped tickets; the user
need not recite IDs or repeat retained authorization. The planner only
returns eligibility and topology: it never authenticates authority or launches
writers. Before dispatch, the parent verifies that the repository, revision,
ticket IDs, owned surfaces, protected boundaries, and requested operation still
match the current user instruction.

Run eligible work with one writer by default. Use isolated worktrees when needed
for safe ownership, not as a mandatory worktree per ticket. Each writer gets an
exact root, bounded scope, focused checks and terminal state. Carry approved
visual references through `design-direction` before UI dispatch. Recompute an
explicit frontier after integration when used. The parent owns integration,
conflicts, applicable integration checks, corrections and final judgment.

Preserve operation-specific authority for publication, merge, release, production,
external writes, paid services and destructive cleanup. Use current and retained
user authorization with the repository policy; do not request a settled approval
again. Prepare reversible local work and the reviewable candidate before stopping
for a genuinely missing external-operation authorization.

This adapter preserves the useful task-graph pattern from Matt Pocock's
upstream `implement-spec` snapshot while replacing its delivery semantics with
the Development System contract.
