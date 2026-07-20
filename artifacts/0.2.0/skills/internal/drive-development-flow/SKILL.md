---
name: drive-development-flow
description: Route software goals and process discussions through the user's engineering lifecycle. Use automatically for a development goal, feature idea, initiative, process, plan, spec, tickets, implementation, review, research, QA intake, or multi-session effort; select the appropriate stage without requiring the user to name a skill.
---

# Drive Development Flow

Treat a development conversation as a lifecycle. Determine the current stage, load the matching installed skill, and move only as far as the user's request authorizes.

The internal `flow-*` stage overlays live under `~/.agents/skills/`. Factory exposes the same source through `~/.factory/skills/`. Do not substitute the similarly named managed upstream skill.

## Select the stage

Use the smallest fitting route:

| Situation | Stage to load |
| --- | --- |
| Huge, foggy effort with unresolved destination, boundaries, or dependency order | `wayfinder` |
| Unresolved feature idea, terminology, boundaries, or trade-offs in a repo | `grill-with-docs` |
| Design question that needs runnable evidence | `prototype`, then return to the prior stage |
| Discussion is settled and the build spans multiple sessions | `to-spec` |
| A spec, plan, or approved conversation needs executable slices | `to-tickets` |
| One clear, session-sized change or one ready ticket | `flow-implement` |
| A branch or diff needs verification against standards and intent | `flow-code-review` |
| A bug, regression, failing test, or performance problem is the starting point | `diagnosing-bugs` |
| Version-sensitive software research or evidence gathering | `flow-research` |
| Conversational bug intake and durable issue filing | `flow-qa` |

If there is no codebase, use `grill-me` instead of `grill-with-docs`.

## Follow the happy paths

Use the full path for ordinary multi-session work:

`grill-with-docs -> to-spec -> to-tickets -> flow-implement -> flow-code-review`

Use the short path when the work fits safely in one session:

`grill-with-docs -> flow-implement -> flow-code-review`

Use the foggy path only when the destination is too large or unclear to chart in one session:

`wayfinder -> to-spec -> to-tickets -> flow-implement -> flow-code-review`

Do not force every request through every stage. Start from the most advanced stage already supported by the conversation, repo evidence, or supplied artifact.

## Separate the program from the terminal slice

A program may be large while its next executable slice is already clear. Do not route an execution-authorized request back to `wayfinder` merely because the overall effort is broad.

Before implementation, pin the next terminal slice:

- the concrete outcome that ends the slice;
- the in-scope files, systems, or repositories;
- the evidence required to call it done;
- any human-review, preview, production, or other authorization boundary;
- an explicit scope freeze for adjacent improvements.

Use `wayfinder` only when those boundaries or the dependency route are still genuinely unknown. If the supplied artifact already defines ordered work and authorizes execution, start from `flow-implement` (or the more advanced stage the evidence supports) and stop at its stated terminal boundary.

## Remove skill-name guesswork

- Do not ask the user which Matt Pocock skill to invoke when the stage is inferable.
- Load and follow the selected installed skill completely before acting.
- State the current stage and immediate next action only when it helps orientation; avoid workflow ceremony on every response.
- When the user asks what to do next, choose the next stage and give a concrete prompt or proceed when the request already authorizes it.

## Preserve authorization boundaries

- Treat discussion of a goal as authorization for discovery, clarification, and recommendations only.
- Do not publish specs or tickets, edit code, commit, push, open or merge pull requests, or deploy unless the user's request authorizes that action or it is an ordinary in-scope step of an authorized build.
- Before a tracker-writing stage, read `docs/agents/issue-tracker.md`. If the repo is not configured, use `setup-matt-pocock-skills` and ask only for choices that cannot be inferred.
- Do not create a Codex product goal merely because the user says “goal”; use product goal tooling only when the user explicitly asks to create or manage one.

## Keep context healthy

- Keep grilling, spec synthesis, and ticket approval in one continuous context when practical.
- Start each ticket implementation with a fresh context and work one frontier ticket at a time.
- Use `handoff` before context quality degrades or when a prototype must run in a separate session.
- Preserve decisions in the configured domain docs, ADRs, spec, and tracker rather than relying on chat memory alone.

## Compose with coding orchestration

Inside a Git repository, also load `coding-orchestration` for non-trivial work. Let this skill choose **what lifecycle stage** to run; let `coding-orchestration` choose **which agents, models, and parallel lanes** execute it. Repo-local `AGENTS.md`, validation, branch, review, and release policies still govern completion.
