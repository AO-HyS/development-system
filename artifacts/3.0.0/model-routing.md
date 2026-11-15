# Model routing 3.0.0

Requested profiles are not observed runtime identity or tier. No silent fallback.
Browser and vision work require actual capabilities. Native effort changes are
optional; Sol 6.1 plan/review stays High. Cache metrics remain unknown unless
observed. Use coding-orchestration/references/jev-advisory.md. Historical governance
tools remain installed for explicit history/recovery and are inactive by default.

For a new Codex T3 coordinator thread, Sol 6.1 High may be requested through the supported per-invocation setting. This does not change the selected session parent or any global role route. Requested and observed model/tier values remain separate.



## Shared tooling without repository adapters

Use the global development-system installation for agent work, reports and skills. Discover repository context from AGENTS.md, README and task-relevant docs. No generated adapter or mandatory replacement index. Product-local dependencies provide explicit versioned CI checks only. T3 owns delegated tasks, history, preview and weekly scheduling; run-worker is optional external CLI recovery, never a T3 task route. Legacy launchd enable and adapter generators fail before writes. Setup and rollback reconcile package, contract, catalog, managed hooks and launchers as one serialized recoverable transaction. Run doctor and record actual package/renderer provenance; file-copy success is not operational loading.


## Active release and maintenance

Historical release narratives are superseded; consult immutable contract 1.41.0 for history. The current skill catalog is 0.83.0. Use the installed report helper with passed/failed/not reached and Verification scope in Detail. Keep stable review task IDs, complete receipt validation for declared fallback and one source writer per surface. Record correction root causes with development-system mistake add; repeated incidents propose a code or guard control. The steward records collection separately from recommendation resolution, deduplicates repository plus stable changeId across revisions, and admits at most one useful reviewed PR per repository only with an explicit clean revision and no active writer. Use one scheduler; preserve private history. No automatic merge, release, deployment, product writes, automated tests or evals.

## 3.0.0: libre

Contract 3.0.0 (catalog 0.83.0). Owner decisions of 2026-11-14 and 2026-11-15: «la meta es que sea rápido, funcione bien y que reduzca el costo, en ese orden», «sí podemos quitar los candados… sin obligarlo a nada, incluyendo los hooks de seguridad», «El plan ya lo puedes implementar». Design ds-libre-propuesta-20261115 v4, accepted in a cross review (four rounds, Sol 6.1 High). Where an earlier section of this contract tells the agent how to plan, delegate, review or gate a change, this note and the installed global instructions replace it.

- The model chooses how to work: the global instructions are one page (what the owner wants, the standing decisions, what every change goes through, the five stops, how to close). Skills, agents and tools stay installed and none is required. The practices of each product live in its repository.
- Fewer hooks: the roster guard (PreToolUse, PostToolUse, SubagentStop) and the stop gate are no longer wired on Claude Code or Codex; an install removes their managed entries and keeps every unrelated one. Their runtime files stay installed, unwired.
- A small command lock: it blocks production (push or merge to main, production deploys, releases), destruction of uncommitted or untracked work, a forced push to develop or main, new spend, reading the secrets folder and automated test files. It no longer blocks what it cannot read. Production passes with `DS_PRODUCCION="<the owner's words>"` and destruction the owner ordered with `DS_ORDENADO="<the owner's words>"`; both are logged.
- Three levels from the paths a change touches (`config/niveles.json`, read from the base branch): critical needs one independent read that lists the necessary cases, those cases run for real and a record before merging; normal merges into develop at once and stays «sin verificar» until one batch read at the end of the session; mechanical needs lint and typecheck only.
- Codex: its review has finished on a commit of the pull request and every thread is answered; a rejected P0 or P1 makes the change critical; one 15-minute clock that never restarts.
- A QuickE2E smoke runs for every change to an app or the backend (`development-system smoke`), is published as the commit status `smoke`, never blocks a merge into develop and is required for production.
- `development-system listo <owner/repo#n>` evaluates all of it on the exact head and publishes the commit status «listo para fusionar»; `development-system registro` writes the record as a pull request comment; `development-system listo --produccion <owner/repo>` publishes «listo para producción» only with nothing pending in the range.
- Fable 5.2 leaves the routine; the independent read is Sol 6.1 High.

Rollback: three separate steps, each reversible on its own. Reinstall 2.15.0 (it restores the complete tuple, the hooks included); remove the two required statuses from the GitHub rules (the previous rules are saved under `~/.development-system/private/cross-review/ds-libre-propuesta-20261115/github-before/`); delete `config/niveles.json` from a repository.

Everything else is 2.15.0.

## Generated host role profiles

## What is installed, if it helps

None of this is required. The `development-system` CLI, the installed skills, the named agents and the T3 tools (delegation, browser preview, computer use, QuickE2E through Jev) are there to use when they make the work faster or better; a missing or failing one is a gap you report, never a blocker. The independent read of a critical change or of a batch is done by Sol 6.1 High (`gpt-6.1-sol`, reasoning high) in a fresh context that did not write the change; when Sol is unavailable use another model that is not the author and say so in the record. Fable 5.2 is not part of the routine. A mistake seen twice goes to `development-system mistake add`, a paper cut to `development-system friction add`.

## Codex host

For the independent read start a fresh read-only Sol 6.1 High child (native, or `delegate_task`) with the diff and the question; never reuse the thread that wrote the change.

## Claude Code host

For the independent read use `delegate_task` to `codex` / `gpt-6.1-sol` with reasoning high, read-only, or `node ~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs`. The named agents keep their pinned models; none is mandatory.
