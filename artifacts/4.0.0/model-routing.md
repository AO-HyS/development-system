# Model routing 4.0.0

Requested profiles are not observed runtime identity or tier. No silent fallback.
Browser and vision work require actual capabilities. Native effort changes are
optional; Sol 6.1 plan/review stays High. Cache metrics remain unknown unless
observed. Use coding-orchestration/references/jev-advisory.md. Historical governance
tools remain installed for explicit history/recovery and are inactive by default.

For a new Codex T3 coordinator thread, Sol 6.1 High may be requested through the supported per-invocation setting. This does not change the selected session parent or any global role route. Requested and observed model/tier values remain separate.



## Shared tooling without repository adapters

Use the global development-system installation for agent work, reports and skills. Discover repository context from AGENTS.md, README and task-relevant docs. No generated adapter or mandatory replacement index. Product-local dependencies provide explicit versioned CI checks only. T3 owns delegated tasks, history, preview and weekly scheduling; run-worker is optional external CLI recovery, never a T3 task route. Legacy launchd enable and adapter generators fail before writes. Setup and rollback reconcile package, contract, catalog, managed hooks and launchers as one serialized recoverable transaction. Run doctor and record actual package/renderer provenance; file-copy success is not operational loading.


## Active release and maintenance

Historical release narratives are superseded; consult immutable contract 1.41.0 for history. The current skill catalog is 0.85.0. Use the installed report helper with passed/failed/not reached and Verification scope in Detail. Keep stable review task IDs, complete receipt validation for declared fallback and one source writer per surface. Record correction root causes with development-system mistake add; repeated incidents propose a code or guard control. The steward records collection separately from recommendation resolution, deduplicates repository plus stable changeId across revisions, and admits at most one useful reviewed PR per repository only with an explicit clean revision and no active writer. Use one scheduler; preserve private history. No automatic merge, release, deployment, product writes, automated tests or evals.

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

## 3.2.0: a clean and current skill catalog

Contract 3.2.0 (catalog 0.84.0). Owner decision of 2026-11-17: «vamos a hacer la limpieza, vamos a corregir, vamos a poner todas al día y vamos a hacer una manera … para que todas estuvieran al día».

- 43 skills leave the catalog and their installed copies are cleaned up: adapt, animate, animation-vocabulary, ask-matt, audit, bolder, break, clarify, claude-handoff, code-review, colorize, critique, delight, distill, emil-prototype, explain-interface, find-animation-opportunities, find-skills, firecrawl, git-guardrails-claude-code, grill-me, implement, install-anti-slop, layout, loop-me, make-interfaces-feel-better, optimize, orchestrate-work, orchestration-pilot, overdrive, parallel-work, polish, pr-lens, quieter, research, scaffold-exercises, shape, teach, typeset, write-swift, writing-beats, writing-fragments, writing-shape. `code-review` only forwarded to `flow-code-review`, which keeps its name; `research` and `install-anti-slop` no longer carry operational evidence contracts.
- 56 skills install reviewed copies: corrected against the current way of working (no automated tests, `development-system listo`, the five stops), brought up to their authors' current commits keeping the local adaptations, and pointed away from the retired skills. Impeccable moves to 4.9.2 (engine 0.1.25).
- `development-system skills-upstream [--json]` compares the pinned commit of every catalogued skill of another author with the last commit that touched its path upstream and lists it as up to date, behind (pinned → new commit, date) or gone upstream. It reads public repositories through temporary blobless clones and changes nothing. The weekly Development Steward report carries the same list.

Rollback: reinstall 3.1.0.

Everything else is 3.1.0.

## 4.0.0: how an ask runs (DS 2, first version)

Contract 4.0.0 (catalog 0.85.0). Owner decisions of 2026-11-17: Browse by MCP verifies screens, the skills must load, no loop of reviews, everything a lint rule can catch is caught there; and the first reply keeps every part `in-your-own-words` has.

- The global instructions gain «How an ask runs» and stay within their size: the first reply to a product ask is the five parts of `in-your-own-words` and its «Terminado» lines are the contract; four defences in order (lint at edit time, types, the reads the level orders, verification); a defect a rule or a type could have caught leaves that rule in the same pull request; every line ends PASA, NO PASA or NO ALCANZADO with a receipt and a third NO PASA is diagnosed and reported instead of patched again; Linear holds what outlives the thread. The reads by level, `listo`, the smoke and the five stops are unchanged.
- New skill `verificar`: who proves each kind of line (a fresh Opus 5.5 High verifier through Browse by MCP for the screen, the product's CLI for the server, lint and types for a rule), the verifier brief, the local helper that hands a test password to the product page only, the limits of Browse in the owner's Chrome and how results are recorded.
- `in-your-own-words` keeps its five parts and may now be loaded by the agent; each done item says where it is checked and the skill says when an uninvoked first reply waits.
- Claude Code settings: the installation sets `skillListingBudgetFraction` to 0.03 (three times the default listing budget) and restores the earlier value on rollback. `development-system doctor` reports, for the newest session of each host, how many skills were announced with and without description and which were loaded.
- `development-system tarjeta` keeps one card per ask: its lines, the result and receipt of each, whether the lines existed before the first code change, changes after the owner's yes, clock time and the counts the weekly scoreboard compares.
- Nothing installed for agents orders `pr-review-status` or `review` rounds; the commands remain for old records.

Rollback: reinstall 3.2.0.

Everything else is 3.2.0.

## Generated host role profiles

## Tools and reads

A missing or failing tool, skill or agent is a gap you report, never a blocker. The independent read of a critical change or of a batch is done by Sol 6.1 High (`gpt-6.1-sol`, reasoning high) in a fresh context that did not write the change; without Sol, another model that is not the author, said in the record. Fable 5.2 only judges how a screen looks. A mistake seen twice goes to `development-system mistake add`, a paper cut to `friction add`.

## Codex host

For the independent read start a fresh read-only Sol 6.1 High child (native, or `delegate_task`) with the diff and the question; never reuse the thread that wrote the change.

## Claude Code host

For the independent read use `delegate_task` to `codex` / `gpt-6.1-sol` with reasoning high, read-only, or `node ~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs`.
