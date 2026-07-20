---
name: coding-orchestration
description: Orchestrate software-engineering work inside Git repositories with the user's global Codex agents. Use for coding analysis, implementation, debugging, refactors, reviews, tests, UI or design work, security checks, performance work, and releases. Apply to every non-trivial coding task in a Git repo; keep trivial one-step work on the parent agent. Do not use for non-code conversations or folders that are not software repositories.
---

# Coding Orchestration

Keep the parent agent as the Sol orchestrator. Delegate bounded work only when doing so improves speed, context quality, or independent verification.

## Decide whether to delegate

1. Confirm the task is software work inside a Git repository.
2. Read applicable `AGENTS.md` files and required repo skills before delegating.
3. Keep the task on the parent when it is a trivial read, one-step command, tiny localized edit, or quick answer.
4. Delegate when at least one condition holds:
   - two or more independent discovery or verification lanes exist;
   - the task crosses packages, apps, services, or specialties;
   - noisy searches, logs, tests, or browser evidence would pollute the parent context;
   - an independent correctness, security, performance, or release review materially reduces risk.
5. Use one subagent for ordinary non-trivial work and two only for genuinely independent lanes. Use at most three concurrent children for an exceptional large task; leave one slot for the parent.

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

Use the global custom agent from `${CODEX_HOME:-$HOME/.codex}/agents` whose `name` matches the job:

| Agent | Assign when |
| --- | --- |
| `code_mapper` | Locate code paths, ownership, repo rules, tests, and commands. |
| `docs_researcher` | Verify version-sensitive framework or API behavior from primary sources. |
| `qa_planner` | Translate changed surfaces into the smallest sufficient verification matrix. |
| `test_runner` | Run focused checks and summarize failures without editing product code. |
| `mechanical_worker` | Execute large, explicit, low-ambiguity edits or migrations. |
| `fast_implementer` | Execute exact bounded packets with Spark low for rapid mechanical writes. |
| `implementer` | Make a scoped general code change after ownership is clear. |
| `backend_specialist` | Own backend, schema, auth, migration, or data-contract implementation. |
| `browser_qa` | Reproduce and verify user-visible behavior with browser tooling. |
| `performance_auditor` | Inspect rendering, bundle, query, or runtime performance risks. |
| `ui_designer` | Design or implement user-facing UI where visual judgment is central. |
| `visual_reviewer` | Independently inspect design quality and rendered UI evidence. |
| `architecture_planner` | Resolve ambiguous, cross-cutting, or high-risk technical design. |
| `reviewer` | Independently review correctness, regressions, and missing tests. |
| `security_reviewer` | Review trust boundaries, auth, permissions, secrets, and data exposure. |
| `release_manager` | Evaluate and execute an authorized repo release path and smoke checks. |

The custom agent TOML files are the single source of truth for model and reasoning settings. Do not copy model maps into repositories.

## Execute in bounded waves

Choose only the lanes the task needs:

1. Discovery: run `code_mapper`, `docs_researcher`, or `qa_planner` in parallel when their scopes are independent.
2. Decision: have the parent integrate evidence; use `architecture_planner` only when judgment remains genuinely hard.
3. Implementation: default to one writer. Use Spark low `fast_implementer` first for exact bounded packets, Sol Medium `implementer` or `backend_specialist`, or Sol Extra High `ui_designer`, with explicit file or package ownership.
4. Verification: run focused tests and browser checks independently when useful.
5. Review: add only the risk-specific reviewer needed, then let the parent integrate findings and finish repo gates.

Parallel writes are opt-in. Permit them only for disjoint file sets with an explicit owner per set. The parent owns conflicts, final integration, and the user's requested end state.

Reuse a suitable existing agent for follow-up work instead of spawning a fresh copy. Re-run only a failed or materially changed lane.

## Keep prompts lean

When spawning a named custom agent, set `agent_type` to its exact `name` and set `fork_turns="none"`. Full-history forks intentionally inherit the parent role, model, and reasoning effort, so they must not be used for Luna or Terra delegation. Include the required task-local context in the delegated prompt instead.

Every delegated prompt must include:

- one concrete objective;
- exact scope or ownership boundaries;
- relevant repo instructions or paths to read;
- whether edits are allowed;
- the evidence or output format to return;
- conditions that require escalation to the parent.

Pass task-local context, not the full conversation. Ask for concise summaries with file references instead of raw logs.

## Escalate by evidence

Start with the cheapest agent adequate for the bounded job. Escalate only when its output is incomplete, contradictory, repeatedly failing, or reaches a high-risk decision outside its mandate.

Use this progression:

1. Spark Low for exact bounded implementation packets; Luna High for focused test execution and explicit mechanical edits when Spark does not apply; Luna Extra High for discovery, docs, and QA planning.
2. Terra Max only for browser QA, where its computer-use performance justifies the middle tier.
3. Sol Medium for implementation, backend work, performance analysis, everyday review, and release work.
4. Sol High for independent visual review.
5. Sol Extra High for architecture, security, and UI design. Never lower these protected judgment roles.

Judge the returned work, not the price tier. Re-run only the failed lane; do not restart the whole workflow.

Fast model labels are candidates, not routing proof. Use only model IDs exposed by the installed Codex catalog. Keep `fast_implementer` on its validated specialized coding model until a same-packet benchmark shows that a challenger improves wall time and pass rate at an acceptable token and service-tier cost.

## Minimize orchestration overhead

- Do useful parent work while agents, tests, or CI run; do not actively poll.
- Store the run identifier and check once when the result can unblock a decision. Wait only when it is the last blocker.
- Run the smallest relevant test or typecheck while editing. Run the broad required suite once after the integrated diff stabilizes.
- Inspect the real command, log, route, or runtime behavior behind a green label. A named check is not evidence that it exercised the intended surface.
- Prefer one coherent implementation wave and one integrated review over repeated global reviews after every small change.

## Preserve safety and repo policy

- Delegation never expands authorization.
- Apply the repo's branch, test, review, deploy, and approval policy.
- Keep spawned depth at one; workers must not create further workers.
- Stop or close completed agents so thread capacity is available.
- Do not treat generated plans as proof; verify the real repository and runtime state.
- Route design decisions and UI craft to `ui_designer` at Sol Extra High. Use `visual_reviewer` at Sol High for independent rendered-quality review; escalate unresolved design judgment back to `ui_designer`.
- For Codex roster changes, run `python3 scripts/validate_agents.py` from this skill directory.
- For cross-harness workflow changes, run `python3 ~/.agents/scripts/validate-development-system.py --repos-root <projects-directory>`.
