---
name: coding-orchestration
description: Choose delegation, ownership, and verification for non-trivial repository execution.
---

# Coding orchestration

Optimize rápido → bien → barato: reach the complete usable result quickly,
correct it with focused evidence, and keep measured cost and complexity low.
Preserve behavior, data boundaries and authorization.

## Claude Code: the AF way

In Claude Code the parent of a product ask manages and does not write product
code: it follows `~/.claude/skills/flow-implement/references/forma-af.md`,
read before the first `Agent`. `escritor-rapido` writes from the guard's typed
packet, one short line per field (files, decision and lines go in `Actions`,
lint/type commands in `Checks`); corrections go to the same writer by `SendMessage`; one fresh
`verificador-pantalla` proves the screen lines. No `Explore` or other model's
read inside the run; the integration read, `listo` and the close stay. The
sections below are the Codex path and stay as they were.

## Coordinate the full feature

When one question needs broad reading of unfamiliar code (about ten searches or
file reads), the parent sends it to one Explore or code-mapper and works from
the map. Scale parallel subagents responsibly for disjoint owned surfaces
without saturating RAM or CPU (no rigid fixed cap), and launch ready lanes
together in one message. Use bounded no-plan writer packets and actual behavior
evidence. Tiny deterministic edits stay direct.

Prefer larger mechanical/codemod batches as `normal` with one batch read
(`development-system registro --lote`) and one batch deploy/smoke instead of
many tiny PRs. Run TLC model checking conditionally—only when `.tla`/`.cfg` or
critical concurrency, retry, or state-machine logic changes, never on routine
PRs. Limit independent review to at most one P0/P1 pass (no review-fix loops;
repeated mistakes become lint or type rules via `correct`).

## Resolve the run

The model selected when the conversation starts remains the orchestrator. It
chooses workers within the user's provider, quota and capability limits and
integrates their results. A restricted family stays restricted for every
descendant; report a missing browser or vision capability instead of
substituting a different family.

The method is model-agnostic. Preserve the acceptance standard when capability
or availability changes: reduce packet size and simultaneous decisions, supply
concrete examples and observable checkpoints, then correct from the returned
evidence. A model label never proves capability or acceptance. If an essential
capability is unavailable, retain the gap and continue independent work; do not
silently substitute a provider or promise equivalent results from every model.

## Execute with useful ownership

The parent owns decomposition, architecture, integration, conflicts,
verification, findings and the terminal state. Execute the repository's
local canonical recipe; a skill does not migrate a product's form or other
domain architecture to match its own examples.

Use deterministic tools directly and batch independent reads. Keep one writer
per surface. Parallel workers are allowed only for disjoint paths with no
shared dependency sequence. Start them from the same brief and receive
completion events. Do not send repeated unchanged status requests or
poll a worker when no new event or observation exists. Reuse a worker for a
focused correction while it owns the same surface; verify termination before
transferring ownership.

Every worker packet is a no-plan contract (no separate plan document): it
includes the exact root and branch or revision, owned paths/surface, settled
decisions, observable `acción -> lo que se ve` lines or mechanical target,
relevant references, constraints, focused checks and known failures when
resuming. Workers preserve unrelated edits and return changed paths, commands,
results and remaining gaps. A clean diff, first implementation or passing lint
does not close unverified behavior.

Before finishing, clean up every resource you spawned: stop every server and
watcher by PID, close every opened browser tab/session, and remove temporary
directories and orphan processes.

## Automated tests and evidence

No automated tests anywhere: do not create, run or restore them; delete them
when found (`check-no-tests` and the guard enforce this). Every task includes
real verification without being asked: computer use, browser, and the
repository's verification CLI and feature map. Report passed / failed / not
reached with evidence.

## UI acceptance and evidence

For visible work, resolve fixture identity, role, organization and useful
entities once before the main pass. Give a neutral browser executor exact
action inputs and the values to record; the parent retains the acceptance
rubric and judges the resulting values. Use the authorized browser mechanism
and one driver per session.

A screenshot or copied file proves neither live harness influence nor product
acceptance. Backend-only work does not need a visual workflow.

## Finish

Continue through implementation, focused checks, corrections and the
authorized endpoint. Separate source, local runtime, PR, Preview, production
and acceptance. Report the candidate, actual observed model/tool identity,
changed paths, checks, evidence references and remaining gaps. If blocked,
name the concrete dependency and finish independent work; a timeout or missing
receipt cannot become a passing result. Close in the format of the installed
instructions («How to close»).

For host-specific CLI dispatch, read [host-dispatch](references/host-dispatch.md).
For interruption or ownership recovery, read
[execution-continuity](references/execution-continuity.md). T3 packet details
are in [worker-reference](worker-reference.md); T3 cross-provider dispatch and
browser capability checks are in [t3-native](references/t3-native.md).
