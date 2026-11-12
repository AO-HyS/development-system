# Development contract 2.14.2

This profile supersedes mandatory governance as the default. Historical contracts remain immutable.

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
elapsed time, evidence and material gaps. Use the approved AO HyS r5/p2 presentation
shared with questionnaires, contextual questions, browser drafts and revisioned batch submission. Markdown is
supplementary. Deliver reports durably: render them in the owning T3 thread or
give their persistent path. A temporary tunnel is optional; when used, state its
actual URL and expiry and never make it the only delivery. Keep secrets and
private transcripts outside any served directory. A report is not acceptance evidence.

## Installation and recovery

The manifest explicitly selects advisory-parent-execution. Setup removes only managed Jev handlers, preserves unrelated guards and records a reversible transition. Reinstall retains its original rollback boundary. Rollback preflights backup bytes and hook drift before writes. Old runs remain historical without granting new execution or acceptance.

## HTML report continuity

Contract 1.40.0 supersedes the field-notebook report presentation with the approved AO HyS r5/p2 shared report and questionnaire template (docs/design/report-template-brief.md). Reports lead with a summarized result and visible next steps; reports and questionnaires share warm AO HyS light/dark palettes, a visible persistent theme control and contextual questions. Composers close without sending, retain nonempty drafts and support deletion. Enviar saves a revisioned batch when served and also copies it, reporting save and clipboard outcomes separately. Existing question schemas, storage and same-origin security boundaries remain. Browser drafts, revisioned batch submissions, file-open copy/download, maps, charts, media, themes and offline assets remain. Opening a report grants no implementation or release authority.

## Repository preparation correction

Repository adapter generation is retired. Read product AGENTS.md, README and task-relevant docs; no replacement index is required. The paired skill catalog is 0.81.0.

## Automated tests and evidence

No automated tests anywhere: do not create, run or restore them; delete them
when found (`check-no-tests` and the guard enforce this). Every task includes
real verification without being asked: computer use, browser, and the
repository's verification CLI and feature map. Report passed / failed / not
reached with evidence.

## Headroom transport evidence

Headroom is an explicit same-account per-invocation option. Keep the existing
Codex binary and CODEX_HOME, preserve caller arguments, and request lossless,
cache-conservative operation. Provider cache reuse can still change request
bytes; do not promise byte identity. Keep native usage from the parent and every
actual descendant separate from proxy counters, and separate requested model or
tier from observed identity. Use launch/completion events instead of polling.
Proxy counters and token deltas are descriptive; without complete controlled
evidence, do not claim Headroom caused savings.

## T3 app-server launch correction

Place the Headroom provider overrides after the app-server subcommand. Codex applies command-line configuration in this position when T3 supplies its own -c settings. Ordinary exec argument ordering remains unchanged. This corrects launch configuration; transport coverage and provider usage still require observed evidence.

## Claude Code harness

Claude Code is a native harness. Catalog 0.81.0 links every catalogued skill into .claude/skills from its installed copy. ~/.claude/CLAUDE.md is an operator link to the shared ~/.codex/AGENTS.md, which carries a short Claude Code host section. The destructive-command guard covers Codex hooks and Claude Code user settings. Headroom per-invocation launch is available for Claude Code. Plugins, MCP servers and other Claude settings remain operator configuration outside this manifest. File installation does not prove discovery, loading or behavioral influence.

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



## Shared tooling without repository adapters

Use the global development-system installation for agent work, reports and skills. Discover repository context from AGENTS.md, README and task-relevant docs. No generated adapter or mandatory replacement index. Product-local dependencies provide explicit versioned CI checks only. T3 owns delegated tasks, history, preview and weekly scheduling; run-worker is optional external CLI recovery, never a T3 task route. Legacy launchd enable and adapter generators fail before writes. Setup and rollback reconcile package, contract, catalog, managed hooks and launchers as one serialized recoverable transaction. Run doctor and record actual package/renderer provenance; file-copy success is not operational loading.


## Active release and maintenance

Historical release narratives are superseded; consult immutable contract 1.41.0 for history. The current skill catalog is 0.81.0. Use the installed report helper with passed/failed/not reached and Verification scope in Detail. Keep stable review task IDs, complete receipt validation for declared fallback and one source writer per surface. Record correction root causes with development-system mistake add; repeated incidents propose a code or guard control. The steward records collection separately from recommendation resolution, deduplicates repository plus stable changeId across revisions, and admits at most one useful reviewed PR per repository only with an explicit clean revision and no active writer. Use one scheduler; preserve private history. No automatic merge, release, deployment, product writes, automated tests or evals.

## 2.14.2: one reservation launches one review

Contract 2.14.2 (catalog 0.81.0, unchanged). Codex review of release PR #209: two identical PR review packets sent to the native Fable reviewer before the round was recorded both ran on one reserved lineage slot.

- Review brake: the Claude guard now claims the launch of a PR review reservation before it admits the reviewer, in the same file the Codex wrapper uses (`launches/<reservationId>.json`), for the native `reviewer` and for a T3 `delegate_task`. A second launch on the same reservation is denied and says how to continue: record the round if the review ran, or release the reservation and send the packet again if it never ran. A repeated T3 `clientRequestId` (which T3 answers with the same task) and a retry of the same tool call are the same launch and pass.

Everything else is 2.14.1.

## Generated host role profiles

## Shared host rules

Use the agents: Haiku 5.5 explores, Terra 6.1 fast does computer use and browser QA, Sol 6.1 High reviews, and Fable 5.2 reviews only security work and hard reviews (authorization, roles, data boundaries, money, minors' privacy or consent; a critical finding still open; a third round or later on the branch; a shared contract or primitive; an open architectural decision). Writers by cost: Haiku 5.5 for exact and mechanical edits, Sonnet 5.5 for general bounded work, and Opus only with a packet line `Opus reason: <why>` (UI slices excepted). Parallel lanes serve different things the owner asked for: six to twenty helpers per task, one PR per thing asked, and two review rounds per branch lineage (two more only for a critical finding). A delegated plan is authored by the parent or its planner role and gets one review by a fresh independent Sol 6.1 High, or by Fable 5.2 when it is security work or hard, with one more round only for a blocking finding; a cross-family contrast is not required. The parent integrates the result. Use existing supported read-only native or T3 routes; receipt-bound compatibility roles remain receipt-bound. Resolve each material objection by correction or evidence-backed rejection; an unresolved blocker prevents acceptance. Respect explicit provider restrictions. When Fable is unavailable, record it and continue with the Sol round the gate orders instead of asking. Existing code/security recovery remains unchanged.

After a shared model-instruction update, active threads reread the installed host instructions and task-relevant skills at the next safe turn, before the next delegation. Preserve the selected parent, completed work, current calls and retained authorization; calls already running keep their model. Inactive threads adopt when resumed. Verify adoption on the next real delegation using available runtime metadata; file installation or acknowledging a message alone is not behavioral evidence. Use a new thread only as a last resort or at the size threshold below, with a continuation handoff, never merely to fill a verification matrix.

The selected parent owns decomposition, integration, conflicts, verification and delivery. Preserve its provider and model selection. Requested model, effort and tier are not observed identity: retain actual runtime metadata or mark unknown. No silent provider or capability substitution. No automated tests or evals: use focused verification CLI and real behavior evidence. Every packet contains exact root/revision, exclusive owned paths, settled decisions, ordered actions, authorization, checks, stop conditions and executable Done when. Never stage, commit or stash as a writer; preserve other owners' edits.

Use the existing T3 tools directly, with the live orchestrator_capabilities catalog. Prefer supported native same-provider roles; use delegate_task for cross-provider or unsupported native model selections. Retain each taskId. Every delegated review round is a fresh delegate_task with the original brief, findings, responses and unresolved objections, and a distinct clientRequestId stable across retries. Never send another review round to childThreadId or create a top-level conversation for child work. Use completion events, not polling loops; completed is not accepted behavior.

Child lifecycle: after reading and integrating (or explicitly rejecting) a delegated child's result, settle its thread with t3_thread_organize (action "settle", the child's threadId); settling is not cancelling. Before abandoning a running child, task_cancel it, reconcile its effects, then settle. Native foreground agents return normally and need no settle. Before the first delegate_task, read runtimeMode from orchestrator_capabilities: under approval-required every child command waits for an approval, so ask the owner once to switch the parent's mode and keep doing independent work; never request a mode above the parent's. A child started before a mode change keeps its old mode: cancel it, reconcile and relaunch it with the same packet. A delegate_task review of a PR carries `Review kind: pr`, `PR: owner/repo#N` and `Review scope: full|fix-diff` (plus `Review approval: <id>` past the second round and `Redesign: <path>#<sha256>` when required); plan and visual reviews carry `Review kind: plan` or `Review kind: visual`. When a parent passes 40 runs, 1500 items or about 75% of its context, write a continuation handoff (root, SHA, branch, objective, settled decisions, open findings, evidence, review budget and approvals, live task ids, installed version, actual or unknown identity, retained authority, next command) to ~/.development-system/private/handoffs/ and ask the owner once to continue in a new thread; keep working meanwhile and never launch a thread unasked unless the owner gave a standing instruction to rotate.

T3 source-code writers are not admitted until exclusive ownership and writer Git protections are observed. Keep source-writing on protected native named writer routes. Computer use is a separate scoped authority for product effects, never permission to edit source. Computer use and simulator QA request Terra 6.1 Low fast (serviceTier priority), browser app testing and reproduction request Terra 6.1 High fast, and video recording requests Terra 6.1 Medium fast; check capability early with preview_status then preview_open and a harmless in-scope observation, one browser operator at a time. Retain gaps if capability or access is unavailable. Parent reruns semantic acceptance. An independent fresh Opus 5.5 critiques approved references and the operator's captures without source writes.

Jev advises only at useful unresolved decisions or corrections at the parent's explicit request. No automatic route classification or askTier is active in normal dispatch. Keep the standalone advisory CLI and historical records. Permission, independent review and evidence are never supplied by Jev.

Protected writer packet syntax (all headers required, values non-empty):

```text
Objective: implement the accepted bounded change
Root: /absolute/canonical/repository
Revision: 0123456789abcdef0123456789abcdef01234567
Owned paths: src/example.mjs
Settled decisions: preserve the accepted API and other owners edits
Actions: edit the named file, then run the listed checks
Authorization: source edits only; no external effects; return candidate to parent
Checks: node --check src/example.mjs
Stop conditions: first out-of-scope mismatch; up to three bounded corrections
Evidence receipt: changed paths, command outputs, observed identity, remaining gaps
Done when: node --check src/example.mjs -> exit 0 and candidate returned to parent
```

Root must be an existing absolute directory equal to the hook invocation cwd after realpath resolution. Revision is exactly 40 hexadecimal characters. Done when uses an explicit command/action followed by `->` and its expected observation, or a non-empty Done when action plus a separate Expected observation header. Admission validates these fields before reserving writer ownership. The coordinator reruns applicable completion checks; syntax does not prove behavior or grant authority.

## Codex host

New sessions request Sol 6.1 High normal speed; preserve an already selected parent. Bounded source facts and read-only research request Claude Haiku 5.5 Medium through an available native Claude or T3 read-only route. Independent Sol 6.1 High reviews the integrated result. Fable 5.2 reviews security work and hard reviews through a read-only delegate_task to claude-fable-5-2 after `development-system review reserve`; the gate's `siguiente` names the reviewer of each round. For explicitly selected Codex-only work, native general writers request Sol 6.1 Medium; exact and mechanical writing requests Claude Haiku 5.5 Medium through protected native Claude mechanical-worker or exact-implementer roles. Preferred mixed roles are Opus 5.5 difficult implementation and UI, Sonnet 5.5 general bounded execution and Haiku 5.5 exact/mechanical execution only when the protected native host supports them; do not assign unsupported Claude models to Codex native tools. Existing Codex Sol/Luna profiles remain available for explicitly selected Codex-only work, not automatic fallback. If a protected Haiku writer route is unavailable, the authorized parent edits directly and reports the gap. Sol 6.1 High is preferred for backend review and Fable 5.2 for security and hard reviews; computer use, browser QA and video run on Terra 6.1 fast as the shared host rules assign. Launch ready read-only children together; a secret or sudo password is asked at most once per task. Opus 5.5 independent visual critique may use T3 read-only delegation.

Without observed native writer ownership admission and Git restrictions, admit no writing children. The selected coordinator may perform authorized sequential direct editing, with read-only children and independent review. Prompt-only profiles do not establish protection.

## Claude Code host

The selected Claude model remains the parent. Opus 5.5 handles difficult implementation, UI design and writing, and fresh independent visual critique. Haiku 5.5 Medium uses the exact pinned model claude-haiku-5-5 for protected mechanical-worker and exact-implementer packets and read-only Explore, code-mapper and docs-researcher. When one question needs broad reading of unfamiliar code (about ten or more searches or file reads), the parent sends it to one Explore or code-mapper without a model parameter and works from the returned map; a known file or exact name stays with the parent. Haiku writers require exclusive Owned paths and writerGit hooks. Sonnet 5.5 retains the general implementer role. Other Haiku versions, aliases, plugin and unregistered Haiku roles are denied. No per-subagent thinking switch; the host/operator controls effort, and actual metadata must be observed. Sol 6.1 High reviews backend, integration, plans and finished PRs through codex-review. Fable 5.2 reviews only security work and hard reviews, as the fresh read-only `reviewer` role (exact model claude-fable-5-2) with `Review kind: security`, or another `Review kind:` plus `Review difficulty: hard: <reason>`; a `PR:` line reserves the lineage slot. The guard coaches the parent with one sentence, never a block: after ten consecutive reads without a mapper, when a second writer in a row is launched alone, from the second secret request of a session, when an Opus writer other than ui-implementer is launched without an `Opus reason:` line, at helper 21 of a session and every ten after, and at the third `gh pr create`. A mapper may join read-only commands with `;` or `&&` after one leading `cd <path>`, with `echo` labels between them. Computer use runs through an observed Codex invocation on Terra 6.1 fast as the shared host rules assign (codex-review.mjs --computer-use requests low; --flow browser-testing requests high and --flow video medium), using native T3 delegation when available. Cross-provider specialization is separate from account recovery.

Native CLI compatibility: codex-review.mjs preserves at most two sequential credential-home attempts without copying credentials. Read receipt.json and findings. Only fallback_required with eligible true authorizes a fresh receipt-bound native reviewer-medium (never reviewer, which is Fable 5.2) or browser-qa using receipt.fallback.prompt verbatim, with unchanged packet/hash/root/Task-Id and no resume. Any fallback envelope sent to visual-reviewer also requires the same validation. Computer-use receipts remain single-use; cancellation, refusal or uncertain effects require reconciliation, never replay. Primary visual-reviewer needs no fallback receipt: it is fresh, has no Owned paths and cannot write source. Retired review roles remain retired.

The Agent hook enforces named models, ownership syntax/locking, writer Git restrictions and writer expiry; plugin agents with ownership or writer declarations are denied, even on Opus. These Agent checks do not prove delegate_task coverage. At most four native subagents; descendants cannot start agents.

## Browser resource preparation

Use development-system browser-pool for explicit dedicated-browser reservations. Inventory never proves login or Computer Use readiness. Personal Chrome is disabled unless the operator explicitly dedicates it. Registered account observations expire; verify the exact controllable account again before effects. Native computer-use reservations remain desktop-exclusive until a real adapter enforces application confinement. No waiting queue: capacity-needed means continue independent work or provide another verified resource, never steal a browser. Expiry, cancellation and uncertain effects require quarantine and explicit reconciliation. The pool gates participating launches only; it does not intercept direct T3/browser MCP calls or hot-switch existing threads. For T3 preview, each parallel worker opens its own tab and passes its exact tabId; a shared persistent profile still shares login state. Imported T3 profiles are not automatically selected by the current preview_open route.
