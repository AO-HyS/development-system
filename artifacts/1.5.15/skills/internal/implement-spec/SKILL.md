---
name: implement-spec
description: Implement an approved specification through the Development System's authorized work graph without inheriting delivery or cleanup authority.
disable-model-invocation: true
---

# Implement Spec

Use `coding-orchestration` as the only router. Read the approved spec and its
exact requested ticket set, build the complete dependency graph, and ask the
pure `orchestration-plan` operation for the current executable frontier.

The current user request must authorize the exact ticket IDs. The planner only
returns eligibility and topology: it never authenticates authority or launches
writers. Before dispatch, the parent verifies that the repository, revision,
ticket IDs, owned surfaces, protected boundaries, and requested operation still
match the current user instruction.

Run only the returned disjoint writer lanes. Each writer gets one bounded
ticket, one worktree, declared focused checks, and one terminal state. Recompute
the frontier after each integration. The parent owns integration, conflicts,
the exactly-once integration checks, corrections, and final judgment.

Implementation authority does not imply branch creation, commit, push, pull
request, merge, release, production, external writes, destructive cleanup, or
worktree removal. Perform each of those only when the current user request and
repository policy explicitly authorize that exact operation. Otherwise stop
with a verified local candidate and report the remaining gate.

This adapter preserves the useful task-graph pattern from Matt Pocock's
upstream `implement-spec` snapshot while replacing its delivery semantics with
the Development System contract.
