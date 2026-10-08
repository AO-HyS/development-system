---
name: coding-orchestration
description: Choose delegation, ownership, and verification for non-trivial repository execution with a pinned task contract.
---

# Coding orchestration

Optimize rápido → bien → barato: reach the complete usable result quickly,
correct it with focused evidence, and keep measured cost and complexity low.
Preserve behavior, data boundaries and authorization.

## Coordinate the full feature

Read [Jev advisory execution](references/jev-advisory.md) once for nontrivial work.
Preserve the selected parent. With an OpenAI parent, Opus 5.5 authors the
plan and a fresh independent Sol 6.1 High reviews it; with an Anthropic parent,
Sol 6.1 High authors and a fresh independent Opus 5.5 reviews it. Use the
existing read-only routes and honor provider restrictions. Missing cross-family
contrast stays not reached; unresolved blocking objections prevent acceptance.
Fast researchers supply bounded source facts. Use bounded writers, independent final review and
actual behavior evidence. Jev advises at useful routing and correction decisions;
the parent records the decision and executes through native tools. Classification
failure does not globally block work. Tiny deterministic edits stay direct.

## Resolve the run

The model selected when the conversation starts remains the orchestrator. It
chooses workers within the user's provider, quota and capability limits and
integrates their results. A roster or native profile is a recommendation, not
runtime identity or a provider chain. A restricted family stays restricted for
every descendant; report a missing browser or vision capability instead of
substituting a different family.

Before a worker starts, pin one execution contract. It names the objective or
ticket, root and revision, owned paths, expected observable behavior, mode,
authorization and endpoint, enumerated checks, evidence receipt, stop
conditions, and the required completion report. Read
[the execution contract](references/execution-contract.md) for the compact
packet fields.

Use **exact instructions by default**: give ordered actions, expected
observations, checks and stops using the execution contract. Outcome delegation
is an explicit, reasoned exception for a bounded implementation decision; record
why a recipe would be premature and keep the same acceptance requirements.

The method is model-agnostic. Preserve the acceptance standard when capability
or availability changes: reduce packet size and simultaneous decisions, supply
concrete examples and observable checkpoints, then correct from the returned
evidence. A model label never proves capability or acceptance. If an essential
capability is unavailable, retain the gap and continue independent work; do not
silently substitute a provider or promise equivalent results from every model.

## Execute with useful ownership

The parent owns decomposition, architecture, integration, conflicts,
verification, findings and the terminal state. Jev advises this parent; native host tools perform the work. Execute the repository's
local canonical recipe; a skill does not migrate a product's form or other
domain architecture to match its own examples.

Use deterministic tools directly and batch independent reads. Keep one writer
per surface. Parallel workers are allowed only for disjoint paths with no
shared dependency sequence. Start them from the same pinned contract and
receive completion events. Do not send repeated unchanged status requests or
poll a worker when no new event or observation exists. Reuse a worker for a
focused correction while it owns the same surface; verify termination before
transferring ownership.

Every worker packet includes the exact root and branch or revision, owned
surface, settled routing, relevant references, constraints, focused checks,
expected receipt and known failures when resuming. Workers preserve unrelated
edits and return changed paths, commands, results and remaining gaps. A clean
diff, first implementation or passing lint does not close unverified behavior.

Writer packets: `Done when:` is executable (command plus expected
observation); the writer retries up to 3 times and the coordinator reruns it.
`Outcome:` is optional.

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

When visual quality matters, complete Impeccable and independent capable
critique first, resolve material findings on this candidate, then call
evidence-capture for final media. A screenshot or copied file proves neither
live harness influence nor product acceptance. Backend-only work does not need
a visual workflow.

## Finish

Continue through implementation, focused checks, corrections and the
authorized endpoint. Separate source, local runtime, PR, Preview, production
and acceptance. Report the candidate, actual observed model/tool identity,
changed paths, checks, evidence references and remaining gaps. If blocked,
name the concrete dependency and finish independent work; a timeout or missing
receipt cannot become a passing result.

## Close every task

Every task that changed files ends with a report:

1. Write the concise packet (`flow-implement/references/completion-report.md`).
   Its Markdown opens with the four sections the command requires, in order:
   Qué se hizo, Hallazgos, Qué sigue, Detalle (English: What was done,
   Findings, What's next, Detail). Real verification (pasó / falló / no se
   alcanzó, con evidencia) goes in Qué se hizo; a mistake seen twice goes in
   Hallazgos as a proposed hard rule at the highest level (código >
   lint/CI/guard > regla/skill). No tables unless a real comparison needs one.
2. Render it with `development-system document --input <packet> --json`.
3. Serve it with working-backwards `reader-live.mjs --tunnel` from a
   per-report copy directory.
4. Put the URL in the final answer.

A Stop hook asks once when files changed and no report was produced. If a
report is truly not useful, say why in one line. When the user asks for the
answer in the chat only, produce no document and no tunnel.

For host-specific CLI dispatch, read [host-dispatch](references/host-dispatch.md).
For interruption or ownership recovery, read
[execution-continuity](references/execution-continuity.md). T3 packet details
are in [worker-reference](worker-reference.md).

For nontrivial delivery and benchmark results, default to a readable HTML report with passed/failed/not-reached behavior, timing, evidence and limitations. Markdown is supplementary. Publish sanitized report assets through the user-authorized temporary tunnel and state its actual lifetime conditions; keep secrets and raw transcripts outside the served directory. A post-deadline report cannot convert a failed timed run into success.

## Authorized Claude Code account recovery (1.39.0)

For Claude Code review and computer use, the operator explicitly authorizes the
local Codex credential-home sequence followed by a fresh native Claude role.
Run codex-review once; it discovers existing profiles without copying credentials
and records at most two sequential profile attempts. Read receipt.json as well as findings.
When status is fallback_required and fallback.eligible is true, immediately
dispatch reviewer (plan, diff or security), visual-reviewer (image review) or
browser-qa (computer use) through the native Agent tool with the original packet.
Copy fallback.prompt verbatim from the receipt; it contains the original packet
and Codex fallback:, Codex fallback receipt: and Codex fallback packet: lines.
The guard verifies the full dispatched packet, hash, root, mode and Task-Id and
rejects resume so the native agent stays fresh. Computer-use fallback receipts
are admitted once only; a consumed receipt requires reconciliation, not replay.
Do not let a failed Codex attempt silently omit the independent review or absorb
it into the coordinator. Preserve the endpoint and actual capability requirements.
Cancellation, safety refusal and uncertain computer-use effects are not fallback
permission: reconcile observed state before more actions. If the native role lacks
vision or an authorized browser, retain the gap and continue independent work.
Report the provider change and actual or unknown identity. This explicit Claude
exception does not change restricted Codex-only tasks or Headroom's same-account
per-invocation contract. HOME installation does not prove live host loading.

## Generated host profile

Use the installed host instructions generated from config/agent-roster.json for role/model selection; do not infer a role from older example packets. For T3 cross-provider dispatch and browser capability checks, read coding-orchestration/references/t3-native.md only when needed. Source writers remain on protected routes; scoped product actions are separate authority.

## Shared installation and task context

Use `development-system` from the active shared installation for agent tooling,
reports and diagnostics (`development-system doctor --json`). Product-local
pinned dependencies supply only explicit CI checks; never use a product alias
as the source of skills or report rendering. Discover the repository AGENTS.md,
README and task-relevant documentation when needed; no repository adapter is
required or generated. A new task records actual CLI/package provenance; file
copying alone does not establish host loading.

T3 owns delegated tasks, history, preview and scheduling through its native
tools. Native tools support same-provider children; writing children require
observed ownership admission and Git restrictions. Without that protection, the
selected coordinator may perform authorized sequential direct editing while
children remain read-only. Do not describe prompt-only profiles as enforcement.
`run-worker` is an optional external process supervisor, never the route for
T3-owned child tasks. Preserve lifecycle acceptance and operation-specific
authority; task completion does not prove accepted behavior.
