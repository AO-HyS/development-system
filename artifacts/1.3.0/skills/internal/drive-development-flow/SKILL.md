---
name: drive-development-flow
description: Route software goals and process discussions through the user's engineering lifecycle. Use automatically for a development goal, feature idea, initiative, process, plan, spec, tickets, implementation, review, research, QA intake, or multi-session effort; select the appropriate stage without requiring the user to name a skill.
---

# Drive Development Flow

Treat a development conversation as a lifecycle. Determine the current stage, load the matching installed skill, and move only as far as the user's request authorizes.

The internal `flow-*` stage overlays live under `~/.agents/skills/`. Factory exposes the same source through `~/.factory/skills/`. Do not substitute a similarly named managed upstream skill.

## Route only what the user requested

| Situation | Stage to load |
| --- | --- |
| User explicitly asks to resolve a huge, foggy effort or dependency order | `wayfinder` |
| A HumanLayer Freeform task starts from a short feature description without an explicit implementation request; or the user asks for future customer experience, Amazon Working Backwards, PRFAQ/customer story, or one planning document at a time | `working-backwards` |
| User explicitly asks to clarify a feature idea, terminology, boundaries, or trade-offs in a repo | `grill-with-docs` |
| User explicitly asks for runnable evidence before deciding | `prototype`, then return to the prior stage |
| User explicitly asks to turn settled discussion into a durable specification | `to-spec` |
| User explicitly asks to turn a spec, plan, or approved conversation into executable slices | `to-tickets` |
| One clear, session-sized change or one ready ticket | `flow-implement` |
| A branch or diff needs verification against standards and intent | `flow-code-review` |
| A bug, regression, failing test, or performance problem is the starting point | `diagnosing-bugs` |
| Version-sensitive software research or evidence gathering | `flow-research` |
| Conversational bug intake and durable issue filing | `flow-qa` |

If the user explicitly asks for grilling and there is no codebase, use `grill-me` instead of `grill-with-docs`. Never infer Wayfinder, grilling, specification, ticket creation, prototypes, `work-multiple`, a broad suite, or promotion from size, ambiguity, urgency, or the number of tickets.

## Follow the lifecycle without ceremony

These are available compositions after the user explicitly selects their special stages; they are not automatic pipelines.

Ordinary multi-session composition:

`grill-with-docs -> to-spec -> to-tickets -> flow-implement -> flow-code-review`

Working Backwards composition:

`customer story -> research -> product contract -> technical contract -> implementation map -> private T3 handoff`

Short path:

`grill-with-docs -> flow-implement -> flow-code-review`

Foggy composition:

`wayfinder -> to-spec -> to-tickets -> flow-implement -> flow-code-review`

For directly requested definition, implementation, review, diagnosis, research, or QA, load only that matching flow. Start from the most advanced stage already authorized by the conversation, repository evidence, or supplied artifact. Do not force every request through every stage or advance from discussion to a new durable artifact without its own authorization.

## Pin the terminal slice

Before implementation, pin one execution contract:

- exactly one objective;
- the constraints and explicitly out-of-scope adjacent improvements;
- the in-scope files, systems, and repositories;
- the exact evidence and validation required;
- a verifiable stop condition;
- every human-review, preview, production, external-write, or other authorization boundary.

A large program can still have a clear terminal slice. Route back to `wayfinder` only when these boundaries or the dependency path are genuinely unknown.

## Use native goals only when explicit

- Do not create a Codex product goal merely because the user discusses a goal. Create or manage one only when the user explicitly asks for the native goal capability.
- A native goal must use the pinned single objective and verifiable stop condition. It may preserve work across turns, but persistence never broadens scope or grants authorization for commits, pushes, PRs, merges, releases, deployments, paid services, or external writes.
- Follow the active native goal schema. For Codex 0.146, agent updates are limited to `complete` and `blocked`; mark complete only when nothing required remains, and blocked only after the platform's repeated-blocker threshold is met. Pause, resume, budget, and usage states belong to the user or platform.

## Preserve authorization

- Discussion authorizes discovery, clarification, and recommendations only.
- Do not publish specs or tickets, edit code, commit, push, open or merge pull requests, deploy, or activate paid infrastructure unless the user authorizes that action or it is an ordinary in-scope step of an authorized build.
- Before tracker writes, read `docs/agents/issue-tracker.md`. If unconfigured, use `setup-matt-pocock-skills` and ask only for choices that cannot be inferred.

## Keep context healthy

- Keep grilling, spec synthesis, and ticket approval in one continuous context when practical.
- Start each ticket implementation with a fresh context and work one frontier ticket at a time.
- Use `handoff` before context quality degrades or when a prototype must run separately.
- Preserve decisions in configured domain docs, ADRs, specs, and trackers rather than relying on chat memory.

## Compose with coding orchestration

Inside a Git repository, also load `coding-orchestration` for non-trivial work. This skill chooses the lifecycle stage; `coding-orchestration` chooses agents, models, and parallel lanes. Repository-local `AGENTS.md`, validation, branch, review, and release policies still govern completion.
