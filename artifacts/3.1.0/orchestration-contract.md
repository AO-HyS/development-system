# Orchestration contract 3.1.0

## Advisory development profile

Follow coding-orchestration/references/jev-advisory.md. Jev advises at useful
routing, decision and correction boundaries. The parent decides, dispatches with
native host tools, integrates and verifies. No Jev per-tool or Stop gate is active.
An unavailable or malformed classification records failure; the parent can
continue authorized work with an explicit rationale. Advice never grants
permission, proves execution, or substitutes for independent review and evidence.

Keep one writer per surface; parallelize only disjoint eligible work. Preserve
historical runs and unresolved ownership without treating them as new-run gates.
Do not resume or silently revalidate an older governed run under this profile.
The obsolete automatic controller remains disabled. OpenCode is not a default.

A roster requests model, effort and speed; actual host/provider metadata establishes
observed identity and tier. Report missing metadata as unknown. No silent fallback.
Sol 6.1 planning and review stay High. Optional coordinator effort changes use the
native host and retain actual observations; they require no Jev permission token
and do not establish cache reuse without provider evidence.

For nontrivial delivery, provide a readable HTML report using the installed
working-backwards report helper, including behavior passed/failed/not reached,
elapsed time, evidence and material gaps. Use the approved AO HyS r5/p2 presentation,
margin questions, browser drafts and revisioned batch submission. Markdown is
supplementary. Deliver reports durably: render them in the owning T3 thread or
give their persistent path. A temporary tunnel is optional; when used, state its
actual URL and expiry and never make it the only delivery. Keep secrets and
private transcripts outside any served directory. A report is not acceptance evidence.

## Automated tests and evidence

No automated tests in any repository: do not create, run or restore them, and
delete them when found (`development-system check-no-tests` enforces this).
Preserve CI protections. Every task ends with real verification: computer use,
the browser, and the repository's verification CLI and feature map; build, type,
lint and static validation support it. Report a concrete behavior gap and its
smallest useful real observation.

## Headroom transport evidence

Headroom is an explicit same-account per-invocation option. Keep the existing
Codex binary and CODEX_HOME, preserve caller arguments, and request lossless,
cache-conservative operation. Provider cache reuse can still change request
bytes; do not promise byte identity. Keep native usage from the parent and every
actual descendant separate from proxy counters, and separate requested model or
tier from observed identity. Use launch/completion events instead of polling.
Proxy counters and token deltas are descriptive; without complete controlled
evidence, do not claim Headroom caused savings.



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

## 3.1.0: no Codex thread left behind after the merge

Contract 3.1.0 (catalog 0.83.0, unchanged). Owner decision of 2026-11-16: «Sí adelante», to «pongo en el Development System la regla de no cerrar un PR con hallazgos sin contestar». Measured that day over four repositories: 104 of 502 Codex findings never got a reply, none of the 78 that Codex posted about two minutes after the merge was answered, and 42 of the 92 checked were still live defects in develop. Since 3.0.0, `listo <pr>` refuses a merge while a Codex thread is unanswered, but nothing looked at a pull request again after it merged.

- `development-system listo --barrido <owner/repo> [--head develop] [--dias 14]` lists every unanswered Codex thread of the pull requests merged into the head branch in those days, marks `tardío` the ones Codex wrote after the merge, and says how to answer. It publishes nothing and needs no `config/niveles.json`.
- For a merged pull request a thread is answered by «Rechazado: motivo» or by a commit that exists in the repository, is in the head branch (or is a commit of the same pull request), is not the commit Codex reviewed nor an ancestor of it, and touches the thread's file: the fix usually lives in a later pull request. `listo <pr>` before the merge is unchanged.
- `listo --produccion` adds `hilo de Codex sin contestar` to every pull request of its range that has one, whatever its level, so «listo para producción» fails while one exists.
- The global instructions add one sentence to the Codex step: run the sweep before calling the ask done and answer each thread it lists.

Rollback: reinstall 3.0.0.

Everything else is 3.0.0.

## Generated host role profiles

## What is installed, if it helps

None of this is required. The `development-system` CLI, the installed skills, the named agents and the T3 tools (delegation, browser preview, computer use, QuickE2E through Jev) are there to use when they make the work faster or better; a missing or failing one is a gap you report, never a blocker. The independent read of a critical change or of a batch is done by Sol 6.1 High (`gpt-6.1-sol`, reasoning high) in a fresh context that did not write the change; when Sol is unavailable use another model that is not the author and say so in the record. Fable 5.2 is not part of the routine. A mistake seen twice goes to `development-system mistake add`, a paper cut to `development-system friction add`.

## Codex host

For the independent read start a fresh read-only Sol 6.1 High child (native, or `delegate_task`) with the diff and the question; never reuse the thread that wrote the change.

## Claude Code host

For the independent read use `delegate_task` to `codex` / `gpt-6.1-sol` with reasoning high, read-only, or `node ~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs`. The named agents keep their pinned models; none is mandatory.
