---
name: flow-implement
description: Implement one authorized terminal slice from an approved spec, ticket, or explicit user request with bounded scope, proportional verification, and a final integrated review. Use when drive-development-flow selects the implementation stage.
---

# Flow Implement

Implement the work described by the user, spec, or current frontier ticket.

## Contract

Before editing, pin:

- exactly one objective and a binary done condition;
- explicit constraints and exact in-scope files, packages, systems, or repositories;
- exact focused checks required while editing;
- the broad final validation gate after integration;
- a verifiable stop condition;
- every merge, preview, production, external-write, paid-service, or human-review authorization boundary;
- adjacent improvements explicitly out of scope.

If the user explicitly requested a native goal, its objective and stop condition must match this terminal slice. Goal persistence never expands authorization.

Inside a Git repository, load the active harness's `coding-orchestration` skill for non-trivial work. Keep one writer by default and delegate only bounded packets whose ownership and return evidence are explicit.

Use TDD where useful at pre-agreed seams. Run the smallest relevant tests or typechecks during implementation. After the integrated diff stabilizes, run the broad required gate once and confirm that its real command exercised the intended surface.

If the work reaches roughly twice its expected duration or budget, waiting dominates, or scope expands, stop and audit the process before adding work.

When the terminal slice is complete, load `flow-code-review`. Commit, push, open or merge a pull request, deploy, or promote only when the user's request and repository policy authorize that state change.
