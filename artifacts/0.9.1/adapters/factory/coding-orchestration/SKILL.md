---
name: coding-orchestration
description: Orchestrate software-engineering work inside Git repositories with custom Droid subagents. Use for coding analysis, implementation, debugging, refactors, reviews, tests, UI or design work, security checks, performance work, and releases. Apply to every non-trivial coding task in a Git repo; keep trivial one-step work on the parent agent. Do not use for non-code conversations or folders that are not software repositories.
---

# Coding Orchestration

Keep the parent agent responsible for integration. A tiny change stays on the
parent unless delegation is demonstrably faster. Its target is functional
evidence within five minutes; ten minutes is an exceptional ceiling that
requires a written reason. If it crosses ten minutes, stop and audit the
process instead of adding gates.

## Decide whether to delegate

1. Confirm the task is software work inside a Git repository.
2. Read applicable `AGENTS.md` files and required repo skills before delegating.
3. Keep the task on the parent when it is a trivial read, one-step command, tiny localized edit, or quick answer.
4. Delegate when at least one condition holds:
   - two or more independent discovery or verification lanes exist;
   - the task crosses packages, apps, services, or specialties;
   - noisy searches, logs, tests, or browser evidence would pollute the parent context;
   - an independent correctness, security, performance, or release review materially reduces risk.
5. Keep one writer and no ticket worktrees by default. When the user explicitly
   invokes `work-multiple`, let that separate skill own lane planning,
   worktrees, integration, and measurement.

Subagents cost additional tokens. Never spawn agents merely to restate the prompt or duplicate the same search.

## Lock the terminal slice

Before delegating or editing, state the smallest executable slice that advances the requested end state:

- a binary done condition;
- exact ownership and scope;
- the focused checks needed during work;
- the single final gate needed before handoff;
- any preview, production, merge, or human-review stop boundary.

Freeze adjacent improvements. If work reaches roughly twice its expected duration or token budget, waiting dominates the run, or a lane produces no useful evidence, stop expanding the slice and audit the process before continuing.

## Route by role

Use the Task tool with `subagent_type` matching the custom droid from `~/.factory/droids/` whose `name` matches the job:

| Droid | subagent_type | Assign when |
| --- | --- | --- |
| code-mapper | `code-mapper` | Locate code paths, ownership, repo rules, tests, and commands. |
| docs-researcher | `docs-researcher` | Verify version-sensitive framework or API behavior from primary sources. |
| qa-planner | `qa-planner` | Translate changed surfaces into the smallest sufficient verification matrix. |
| test-runner | `test-runner` | Run focused checks and summarize failures without editing product code. |
| mechanical-worker | `mechanical-worker` | Execute large, explicit, low-ambiguity edits or migrations. |
| fast-implementer | `fast-implementer` | Execute exact bounded packets with low complexity for rapid mechanical writes. |
| implementer | `implementer` | Make a scoped general code change after ownership is clear. |
| backend-specialist | `backend-specialist` | Own backend, schema, auth, migration, or data-contract implementation. |
| browser-qa | `browser-qa` | Reproduce and verify user-visible behavior with browser tooling. |
| performance-auditor | `performance-auditor` | Inspect rendering, bundle, query, or runtime performance risks. |
| ui-designer | `ui-designer` | Design or implement user-facing UI where visual judgment is central. |
| visual-reviewer | `visual-reviewer` | Independently inspect design quality and rendered UI evidence. |
| architecture-planner | `architecture-planner` | Resolve ambiguous, cross-cutting, or high-risk technical design. |
| reviewer | `reviewer` | Independently review correctness, regressions, and missing tests. |
| security-reviewer | `security-reviewer` | Review trust boundaries, auth, permissions, secrets, and data exposure. |
| release-manager | `release-manager` | Evaluate and execute an authorized repo release path and smoke checks. |

The droid `.md` files in `~/.factory/droids/` are the single source of truth for model and reasoning settings. Do not copy model maps into repositories.

## Execute in bounded waves

Choose only the lanes the task needs:

1. Discovery: run `code-mapper`, `docs-researcher`, or `qa-planner` in parallel (multiple Task calls in the same turn, or `run_in_background: true`) when their scopes are independent.
2. Decision: have the parent integrate evidence; use `architecture-planner` only when judgment remains genuinely hard.
3. Implementation: default to one writer. Use `fast-implementer` with `complexity: light` first for exact bounded packets, `implementer` or `backend-specialist` with `complexity: medium`, or `ui-designer` with `complexity: heavy`, with explicit file or package ownership.
4. Verification: run focused tests and browser checks independently when useful.
5. Review: add only the risk-specific reviewer needed, then let the parent integrate findings and finish repo gates.

The parent owns conflicts, final integration, and the requested end state.

Reuse a suitable existing droid for follow-up work instead of spawning a fresh copy. Re-run only a failed or materially changed lane.

## Keep prompts lean

When spawning a custom droid via the Task tool, set `subagent_type` to its exact `name`. Include the required task-local context in the delegated `prompt` instead of relying on parent conversation history. Subagents run with a fresh context window.

Every delegated prompt must include:

- one concrete objective;
- exact scope or ownership boundaries;
- expected absolute Git worktree path and branch;
- relevant repo instructions or paths to read;
- whether edits are allowed;
- the evidence or output format to return;
- conditions that require escalation to the parent.

Pass task-local context, not the full conversation. Ask for concise summaries with file references instead of raw logs.

## Escalate by evidence

Start with the cheapest explicitly resolved droid model adequate for the
bounded job. `inherit` is not routing evidence. Escalate only when its output
is incomplete, contradictory, repeatedly failing, or reaches a high-risk
decision outside its mandate.

Use this complexity progression:

1. `complexity: light` for exact bounded implementation packets (`fast-implementer`), focused test execution (`test-runner`), and explicit mechanical edits (`mechanical-worker`).
2. `complexity: light` for discovery, docs, and QA planning (`code-mapper`, `docs-researcher`, `qa-planner`).
3. `complexity: medium` for implementation, backend work, performance analysis, everyday review, and release work.
4. Use explicit Claude Opus 4.7 droids for visual review, UI design,
   architecture, and security judgment.
5. Keep those judgment routes explicit and provisional until same-packet
   benchmarks support a cheaper replacement.

Judge the returned work, not the complexity tier. Re-run only the failed lane; do not restart the whole workflow.

Fast model labels are candidates, not routing proof. Confirm model IDs and
supported reasoning levels from the installed Factory runtime. The installed
droid roster must name the model explicitly; `inherit` is not accepted.
Re-rank a route only after a same-packet benchmark shows that a challenger
improves wall time and pass rate at an acceptable credit multiplier.

## Minimize orchestration overhead

- Do useful parent work while droids, tests, or CI run; do not actively poll.
- Store the run identifier and check once when the result can unblock a decision. Wait only when it is the last blocker.
- Run the smallest check that proves the acceptance criterion. A full suite is
  forbidden by default and may run only when the user explicitly requests it
  for that run. Do not infer that authorization from change size, ticket
  count, a release label, or a generic "verify everything" convention.
- Run UI acceptance only when UI changed and the observable risk justifies it.
  A label, copy, icon, or obvious style-only change without behavior risk skips
  browser QA. Interaction, navigation, mutation, responsive behavior,
  meaningful regression, or a critical flow gets one direct acceptance flow.
- Report what every cited check actually proved. Never present total tests,
  destinations, routes, or surfaces as quality evidence without mapping them
  to acceptance criteria.
- Inspect the real command, log, route, or runtime behavior behind a green label. A named check is not evidence that it exercised the intended surface.
- Prefer one coherent implementation wave and one integrated review over repeated global reviews after every small change.
- Record each delegated lane's role, droid, harness, resolved model, reasoning,
  session id, event id, and runtime metadata source. Copying the selected model
  from the plan is not evidence. Missing, self-reported, or `inherit` model
  evidence is unresolved.

## Preserve safety and repo policy

- Delegation never expands authorization.
- A writer must verify the expected absolute worktree, Git root, and branch before its first read or edit, and must reject patch targets outside that root.
- If a writer reports or exhibits a path mismatch, interrupt it before moving, restoring, or integrating any diff.
- Apply the repo's branch, test, review, deploy, and approval policy.
- Subagents cannot spawn further subagents (depth is one).
- Do not treat generated plans as proof; verify the real repository and runtime state.
- Route design decisions, UI craft, and independent visual judgment to their
  explicit Claude Opus 4.7 droids; escalate unresolved design judgment back to
  `ui-designer`.
- For cross-harness workflow changes, run `python3 ~/.agents/scripts/validate-development-system.py --repos-root <projects-directory>`.
