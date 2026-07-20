---
name: flow-implement
description: Implement one authorized terminal slice from an approved spec, ticket, or explicit user request with bounded scope, proportional verification, and a final integrated review. Use when drive-development-flow selects the implementation stage.
---

# Flow Implement

Implement the work described by the user, spec, or current frontier ticket.

## Contract

Before editing, pin:

- one binary done condition;
- exact in-scope files, packages, or systems;
- focused checks required while editing;
- the broad final gate required after integration;
- any merge, preview, production, or human-review stop boundary;
- adjacent improvements that are explicitly out of scope.

Inside a Git repository, load the active harness's `coding-orchestration` skill for non-trivial work. Keep one writer by default and delegate only bounded packets whose ownership and return evidence are explicit.

Use TDD where useful at pre-agreed seams. Run the smallest relevant test files or typechecks during implementation. After the integrated diff stabilizes, run the broad required gate once and confirm that its real command exercised the intended surface.

If the work reaches roughly twice its expected duration or budget, waiting dominates, or the scope starts expanding, stop and audit the process before adding work.

When the terminal slice is complete, load `flow-code-review`. Commit, push, open or merge a pull request, deploy, or promote only when the user's request and repository policy authorize that state change.
