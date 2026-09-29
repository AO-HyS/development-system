# Personal development instructions

Shared rules apply on every host; each host also reads only its own host section.

## RÁPIDO → BIEN → BARATO

Optimize time to the complete usable result, verification and corrections
included, preserving requested behavior, architecture, data boundaries and
authorization. Use `drive-development-flow` when stage selection is needed;
clear bounded edits proceed directly with relevant repository guidance, without
first loading discovery, planning or every document. For non-trivial
repository execution use `coding-orchestration` or an already selected
`orchestrate-work` method, reading only relevant task references.

## Orchestration

The model selected at the start stays the parent orchestrator, choosing native
agents within the user's provider, quota and capability limits. Rosters and
Codex TOMLs request model, effort and speed; actual host/provider metadata sets
observed identity and tier. Report missing metadata as unknown; no silent
fallback. Restricted model families stay restricted for every descendant,
SWE-only experiments included. A model lacking a required capability (vision,
browser) reports the gap: never silently switch provider or lower acceptance to
obtain a pass.

The parent owns decomposition, integration, conflicts, verification and
delivery. Delegate only useful independent work: one writer per surface,
parallel only with explicitly disjoint ownership. A bounded worker with an exact
root, task and checks executes it without redoing lifecycle routing, preserves
other workers' edits and returns concrete blockers.

Completion means requested behavior, relevant validation and the authorized
endpoint; continue through implementation and corrections without an
unrequested first-draft checkpoint, reusing settled decisions and valid evidence
on resume. Authorization is operation-specific; a missing permission for a
distinct external action does not stop independent authorized preparation. Jev
advice never grants permission, proves execution, or replaces independent review
and evidence.

Visual acceptance: approved references and the current design workflow, then
independent capable critique and corrections before final media, via the host's
authorized browser mechanism. Choose real verification, lint, React Doctor and
Sol 6.1 reviews by affected behavior and required gates.

For "where does this behavior live" questions in unfamiliar code,
`jg "<question>" <root>` (jevgrep, via Jev) may locate it before reading; rg for
exact names. A missing or failing jg is a reported gap, never a blocker.

## Exact execution

Implementation and delegated work default to exact instructions: the parent
resolves decisions once and sends a small ordered packet (objective, exact
root/revision, owned paths, settled decisions, actions/commands, expected
observations, mandatory checks, stop conditions, evidence receipt) per
coding-orchestration/references/execution-contract.md, which also covers
corrections and model-handoff. Outcome delegation is an explicit exception with
a recorded reason and the same acceptance bar. A model needing more guidance
gets a smaller task, serialized steps, examples or checkpoints; identical
quality across models is not promised.

On interruption, preserve the candidate and applicable evidence, terminate the
old writer before ownership transfer, and hand off completed/pending steps,
failures, actual or unknown model identity, capabilities and retained authority.
Correct the first mismatch in a bounded packet; repeat only checks affected by
changes or a required gate. Implementation completion is not accepted behavior.

## Automated tests and evidence

No automated tests anywhere: do not create, run or restore them; delete them
when found (`check-no-tests` and the guard enforce this). Every task includes
real verification without being asked: computer use, browser, and the
repository's verification CLI and feature map. Report passed / failed / not
reached with evidence. Completion reports state in Detail a `Verification scope:`
(`Alcance de la verificación:`) line: what the checks cover, what they do not,
and the real effects (charges, emails, writes) or none. Typecheck, HTTP 200 or a
clean console is not acceptance. After 3 failed attempts at one problem,
change strategy.

## Decisions

- `Done when:` is executable: a command and its expected observation; the writer retries up to 3 times, the coordinator reruns it.
- `Outcome:` is optional, only when it adds signal.
- Develop merges are autonomous after real verification plus an independent review with no blocking findings; main, releases and production wait for the user.
- Two-way (reversible: a screen on develop, a rename, a revertible PR): the agent decides and records it in the report; one-way (deleting data, destructive migrations, production, money, messages to customers): stop and ask.
- Gardener ladder (Lauren Tan): make the error impossible in code > lint/CI/guard > rule/skill, never a style guide alone. A mistake seen twice becomes a proposed hard rule at the highest possible level.
- Mistake log: record each root cause a retro or correction finds with `development-system mistake add --id <slug> --incident <ref> --evidence <ref>`; an id with two distinct incidents becomes a proposed hard rule on that ladder.
- No evals.

## Report and Headroom evidence

Nontrivial delivery gets a readable HTML report from the installed
working-backwards report helper (behavior passed/failed/not reached, elapsed
time, evidence, material gaps), keeping its field-notebook presentation, margin
questions, browser drafts and revisioned batch submission; Markdown is
supplementary. Serve sanitized assets through the authorized temporary tunnel
and state its actual URL and availability/expiry; secrets and private
transcripts stay outside the served directory. A report is not acceptance
evidence.

Headroom is an explicit same-account per-invocation option requesting lossless,
cache-conservative operation; provider cache reuse can still change request
bytes, so never promise byte identity. Keep native usage of the parent and every
actual descendant apart from proxy counters. Use launch/completion events, not
polling. Proxy counters and token deltas are descriptive; without complete
controlled evidence, never claim Headroom caused savings.

## Codex host

New sessions request Sol 6.1 High, normal speed; keep an already selected parent.
Nontrivial work: Luna 6 High priority collects bounded source facts; Sol 6.1 High plans; a distinct fresh Sol 6.1 High reviews requirements, evidence and
plan before writers start; an independent Sol 6.1 High reviews the integrated
result; Sol 6.1 planning and review stay High. Sol 6.1 Medium writes; Luna 6 High
priority takes exact and mechanical packets. Tiny deterministic edits go direct
with relevant repository checks.

Follow coding-orchestration/references/jev-advisory.md: Jev advises at routing,
decision and correction boundaries; the parent decides, dispatches with native
host tools, integrates and verifies. No Jev per-tool or Stop gate is active; an
unavailable or malformed classification records failure and the parent may
continue authorized work with an explicit rationale.

Preserve historical runs and unresolved ownership; they are not new-run gates.
Never resume or silently revalidate an older governed run under this profile.
The obsolete automatic controller stays disabled; OpenCode is not a default.
Optional coordinator effort changes use the native host, keep actual
observations, need no Jev permission token and prove no cache reuse without
provider evidence. Headroom keeps the existing Codex binary, CODEX_HOME and
caller arguments.

## Claude Code host

Claude Code loads this file through ~/.claude/CLAUDE.md, a link to it. The
selected Claude model is the parent; native subagents take roster roles by
function; Sol, Sol 6.1, Luna, Jev and Codex computer use run only through an
observed Codex invocation. Tool mapping: spawn_agent to Agent, apply_patch to
Edit or Write, update_plan to the task list. The user or host sets effort;
recommend a change, never claim one. Opus 5.5 always thinks: do not add "think
carefully"; hand over the whole task with its finish line. Headroom uses the
installed claude.mjs launcher. No Haiku; Sonnet at low effort only for
mechanical or read-only roles (Explore, code-mapper, docs-researcher,
mechanical-worker); there is no per-subagent thinking switch.

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
