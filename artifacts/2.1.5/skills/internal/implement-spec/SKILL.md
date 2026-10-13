---
name: implement-spec
description: Execute an approved specification and its authorized tickets, integrating and verifying the complete result.
---

# Implement Spec

The spec's tickets form a **task graph**: blocking relationships leave a
**frontier** of tickets ready to start. The goal is the whole spec integrated on
one task branch, each ticket closed the way the tracker closes work. Adapted
from Matt Pocock's `implement-spec` (pinned in the 2.1.5 catalog provenance);
delivery follows the Development System contract.

`coding-orchestration` is the router for ownership, packets and verification.
Settled definition stays settled across threads: no new interview, no
re-asking retained authorization. Publication, merge, release, production,
external writes, paid services and destructive cleanup keep their
operation-specific authority; when one is missing, prepare the reversible local
work and the reviewable candidate first.

## Steps

1. **Map the graph.** Read the spec and resolve every linked authorized ticket
   and dependency through
   [the shared definition contract](../coding-orchestration/references/spec-ticket-contract.md).
   A missing ticket is unresolved scope. The pure `orchestration-plan`
   operation computes the frontier when dependencies or ownership are not
   obvious. Done when every ticket has a status, its blockers and its owned
   surface.
2. **Explore once.** One read-only exploration writes notes outside the repo
   (`~/.development-system/private/specs/<spec>/`): files, idioms, docs. Every
   later packet points at those notes instead of repeating them.
3. **Fix contracts before parallel work.** Shared types, schemas, routes and
   APIs that two tickets touch land first, in one bounded packet, so parallel
   writers build against real code. Done when the contract compiles on the task
   branch.
4. **Run the frontier.** Disjoint tickets run in parallel within host capacity,
   one writer per surface, each with an exact packet and focused checks.
   Before each dispatch, confirm repository, revision, ticket IDs, owned
   surfaces, protected boundaries and the requested operation still match the
   current instruction. Use the
   canonical checkout and task branch; a worktree only when the user asks for
   one. Approved visual references go through `design-direction` before UI work.
5. **Unblock by integration.** A ticket counts as done when its change is
   integrated on the task branch and its checks pass there; only then recompute
   the frontier and start the tickets it unblocks.
6. **Review the whole.** After the last ticket, one independent review covers
   the integrated spec. Corrections go in bounded packets; rerun only the checks
   their changes affect, plus required gates.
7. **Verify behavior.** Real behavior evidence for the complete feature
   (browser, computer use, the repository verification CLI and feature map),
   reported passed / failed / not reached. No automated tests: they are neither
   created, run nor restored.

Plans for an authorized spec follow the cross-family rule in the shared host
instructions. Jev advises only when the parent asks at an unresolved decision.
