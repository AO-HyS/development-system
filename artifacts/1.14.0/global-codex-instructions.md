# Personal Codex Instructions

## Bounded delegated workers

When the parent supplies an exact working root, owned task, constraints and
checks, lifecycle and provider routing are already complete. Execute that packet
and its task-specific references. The lifecycle-loading rules below apply to the
parent's orchestration, not to restarting discovery inside each worker. Return
blockers to the parent. Resolve skill aliases through the supplied roots table.

## Development goals and process

When the conversation concerns a software-development goal, feature idea, initiative, process, plan, spec, tickets, implementation sequence, or review:

1. Load the global `drive-development-flow` skill before planning or acting, even when the user does not name it.
2. Let the skill infer the current lifecycle stage and select the next Matt Pocock workflow skill; do not make the user remember or type skill names.
3. Do not force the whole lifecycle when the conversation or repository already provides a spec, tickets, implementation, or review target.
4. Apply this rule even from a projectless conversation when the user is discussing a named software project or repository.
5. Do not apply it to personal, business, or product goals that are unrelated to software development.

## Coding repositories

When the current task is software-engineering work and the working directory is inside a Git repository:

1. Load the global `coding-orchestration` skill for every non-trivial coding prompt before planning or acting.
2. Let the skill decide whether delegation is useful. Loading the skill does not require spawning subagents for trivial or tightly localized work.
3. Use custom agents only from `${CODEX_HOME:-$HOME/.codex}/agents`; those TOML files are the single source of truth for model, reasoning, and sandbox selection.
4. Keep the parent agent responsible for decomposition, integration, conflicts, verification, and the user's requested end state.
5. Keep one writer by default. Parallel writes require explicit, disjoint ownership.
6. Astra owns UI design, visual craft, visual review and Computer Use. Use the installed Development System roster for task-specific effort; OpenCode Go handles bounded implementation; Codex Luna uses Max with priority as the alternative, and Astra owns independent review. Only OpenCode Go and Codex are active providers.
7. When `drive-development-flow` also applies, use it to choose the lifecycle stage and use `coding-orchestration` to choose delegation, agents, and model routing.

Do not apply `coding-orchestration` to non-code conversations or work outside software repositories.
