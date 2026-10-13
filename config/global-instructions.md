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
other workers' edits, leaves staging, commits and stashes to the parent and
returns concrete blockers.

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
- An `AGENTS.md`/`CLAUDE.md` rewrite or a lint-tool migration proves it kept every rule: `development-system check-agents-rules --base <ref> <file>` and `development-system check-lint-floor --base <ref>` pass before merge.
- No evals.

## Report and Headroom evidence

Nontrivial delivery gets a readable HTML report from `development-system
document` (behavior passed/failed/not reached, elapsed time, evidence, material
gaps); Markdown is supplementary. Serve sanitized assets through the authorized temporary tunnel
and state its actual URL and availability/expiry; secrets and private
transcripts stay outside the served directory. A report is not acceptance
evidence.

Headroom is an explicit same-account per-invocation option requesting lossless,
cache-conservative operation; provider cache reuse can still change request
bytes, so never promise byte identity. Keep native usage of the parent and every
actual descendant apart from proxy counters. Use launch/completion events, not
polling. Proxy counters and token deltas are descriptive; without complete
controlled evidence, never claim Headroom caused savings.

## Shared agent tooling

Use the active global development-system CLI for reports, skills and orchestration; doctor identifies package, contract, catalog and drift. Read each repository AGENTS.md, README and task-relevant docs; no adapter is required. Product-local packages are pinned CI checks only. T3 owns child tasks, history, browser and scheduling; run-worker is only an optional external process utility. Legacy launchd activation is retired. Updates and rollback restore the complete shared tuple.

{{shared-host-rules}}

{{codex-host}}

{{claude-host}}

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

## Browser resource preparation

Use development-system browser-pool for explicit dedicated-browser reservations. Inventory never proves login or Computer Use readiness. Personal Chrome is disabled unless the operator explicitly dedicates it. Registered account observations expire; verify the exact controllable account again before effects. Native computer-use reservations remain desktop-exclusive until a real adapter enforces application confinement. No waiting queue: capacity-needed means continue independent work or provide another verified resource, never steal a browser. Expiry, cancellation and uncertain effects require quarantine and explicit reconciliation. The pool gates participating launches only; it does not intercept direct T3/browser MCP calls or hot-switch existing threads. For T3 preview, each parallel worker opens its own tab and passes its exact tabId; a shared persistent profile still shares login state. Imported T3 profiles are not automatically selected by the current preview_open route.
