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

Before planning non-trivial work, restate in your own words the user's goal, the
problem it solves and your approach, then continue; stop only for a real
ambiguity. An explicit `in-your-own-words` invocation ends the turn with the
proposal and waits for the user's approval before execution.

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

Use the agents (owner decision 2026-11-12: «que utilice sus agentes»). Haiku
5.5 explores (Explore, code-mapper, docs-researcher); Terra 6.1 fast does
computer use and browser QA; Fable 5.2 reviews finished PRs and plans; Sol 6.1
High is for a cross review the operator asks for and for a review round when
Fable is unavailable. When one question needs broad reading of unfamiliar code
(about ten searches or file reads), send it to one mapper and work from its
map; a known file or exact name stays with the parent. Launch ready lanes with
disjoint owned paths together in one message and serialize only real
dependencies. Ask for a secret or sudo password at most once per task: put the
privileged steps in one script first and check `sudo -n true` before asking
again.

Completion means requested behavior, relevant validation and the authorized
endpoint; continue through implementation and corrections without an
unrequested first-draft checkpoint, reusing settled decisions and valid evidence
on resume. Authorization is operation-specific; a missing permission for a
distinct external action does not stop independent authorized preparation. Jev
advice never grants permission, proves execution, or replaces independent review
and evidence.

## When to stop and ask: five stops

Owner decisions of 2026-11-08 («Adelante, adelante, implementa todo esto»; «el
merge a producción … sí sea algo de lo que me preguntes»). Ask the owner before
only these five, and keep working on everything else:

1. Incremental spend: buying, upgrading a plan, starting metered usage, running
   or activating ads, moving money. Exempt only usage the billing inventory
   (`~/.development-system/private/permission-audit/`) proves included or
   prepaid with no overage or auto-recharge (Vercel Hobby, Jev through
   TypeSafe). When that cannot be shown, stop or leave the capability unused.
2. Destruction the agent proposes and the owner did not order in this task:
   deleting or overwriting data that cannot be recovered (local or remote),
   another thread's uncommitted work, infrastructure, production data,
   destructive migrations. Destruction the owner ordered runs without asking
   again.
3. New messages to customers or real people (email, WhatsApp, posts,
   broadcasts, calendar invites, shared files) beyond what is already
   authorized.
4. Account-security changes beyond what is already authorized: new OAuth
   grants, passwords, 2FA, organization members or roles, exporting secrets.
5. Production: a merge to `main` or another production branch and a production
   deploy, with the release and global install that follow it. Prepare
   everything first (gates passed, evidence recorded), then ask one question
   naming the PR, head and what reaches production. Only an answer that
   approves that production step counts («sí, a producción», «mergea a main»,
   «pásalo a prod», or the owner's merge itself); it covers that step's
   release, install and rollback, nothing later.

Common rule: a prior owner authorization for the same operation, account,
resource and scope is recognized and never asked again; ask only for a wider
scope or a decision the owner has not made. The owner says "do not ask me" in
many ways («te apruebo todo», «ya no me preguntes», «adelante con todo», «haz
lo que tengas que hacer», «no me consultes», «pásatela», «dale»): each grants
everything in the task's scope without further questions, except the five
stops, which still need their own explicit answer. Never ask again for
something such a phrase covers. Without asking: merges to develop and staging
or preview branches once their gates pass, deploys to develop, preview and
staging, non-production deploys on services without incremental spend, restarting or stopping your own services
and processes, deleting caches and regenerable artifacts, reading the owner's
dashboards. A login, 2FA or CAPTCHA only the owner can complete is a handoff
(`request_secret` or one named action), not a permission question. A hook or
classifier block is not a sixth stop: read its reason, take the allowed route
it names and keep working; report it only when no allowed route exists. File
ownership between threads and hook integrity stay in force. Do not stop early:
an open goal item with remaining authority means keep working.

Visual acceptance: approved references and the current design workflow, then
independent capable critique and corrections before final media, via the host's
authorized browser mechanism. Choose real verification, lint, React Doctor and
Fable 5.2 reviews by affected behavior and required gates.

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
when found (`check-no-tests` and the guard enforce this). Only the operator
lifts this, for one directory and a limited time, by running
`development-system allow-tests <dir> [--hours N]` in their own terminal; inside
an active grant (`development-system test-grants`) tests may be created and run
for the ordered task, never outside it. When a task needs a grant, name it as
one owner action in the closing and keep doing the independent work; never
create one yourself. Every task includes
real verification without being asked: computer use, browser, and the
repository's verification CLI and feature map. Report passed / failed / not
reached with evidence. The closing states a `Verification scope:`
(`Alcance de la verificación:`) line, and so does the report when one is
requested: what the checks cover, what they do not, and the real effects
(charges, emails, writes) or none. Typecheck, HTTP 200 or a
clean console is not acceptance. After 3 failed attempts at one problem,
change strategy.

Web flows are verified with QuickE2E on Jev (`behavioral-evidence`), logged in
with the repository's test accounts, proving the allowed and the denied role
and the side effects. A live QuickE2E run is real verification, not an
automated test: its flow file lives in private evidence, never in a repository,
and no emitted spec is kept (the operator decided this on 2026-10-13); keeping
a replay spec needs a test grant. The T3 browser covers visual
judgment. Jev through the operator's TypeSafe key is prepaid: bans on hosted
inference or paid APIs do not cover it, data limits do. Try a tool with its
documented model before any local substitute.

Stop every dev server, model server or watcher you started before reporting:
kill what you launched, never by name and never another thread's.

## Decisions

- `Done when:` is executable: a command and its expected observation; the writer retries up to 3 times, the coordinator reruns it.
- `Outcome:` is optional, only when it adds signal.
- Develop merges are autonomous after real verification recorded with `development-system evidence record` for the PR head (or the owner's explicit waiver, such as «pásatela», quoted verbatim in the PR and recorded with `--owner-waiver`) and `development-system pr-review-status <pr> --gate` showing `mergeReady`. A merge to main, a release, a global install and a production deploy follow the same gates (`mergeReady` for main, `release:prepare` and the release train's production smoke and rollback) and then wait for the owner's explicit production answer (stop 5); a general approval («te apruebo todo») does not cover them.
- Reviews (owner decisions 2026-10-14 and 2026-11-11: «Una vez que llegue a 5 y todavía no encuentre el freno, ya quiero que avance»): review the finished PR, never each push, and never ask the owner for a round. Run `development-system pr-review-status <pr> --gate` and do what its `siguiente` says; for a PR into develop it is always an action of yours. The gate orders each round to Fable 5.2 as a fresh read-only reviewer (Claude Code: Agent `reviewer` with a `Review kind: pr` packet; Codex: a read-only `delegate_task` to `claude-fable-5-2`), up to five rounds per branch lineage (closing a PR and opening another from the same branch never resets the count), and then advances; when Fable fails on quota or is not offered, record it with `development-system review release --pr <ref> --reason "fable-unavailable: <observed message>"` and the gate orders that round to Sol 6.1 High through codex-review, without asking; only a critical finding (security, authorization, data loss, money, minors' privacy, consent, or no stated domain) gets rounds six and seven, and if it is still open the disputed change leaves the PR. Stopping reviews is not acceptance: the ledger keeps what nobody re-read. Ask Codex (`--request`) at most twice; answer each Codex thread in the thread with the fix commit or «Rechazado: <reason>», without resolving it. The reviewer packet comes from `development-system review brief`. A wrong ledger row is annulled with `development-system review void`, never by hand. When the owner says to stop reviewing, quote the words in the PR and record them with `development-system review waive --pr <ref> --head <sha> --quote "<words>"`.
- `cross-review` runs only when the operator asks for it; plans and primitive lists otherwise get the single plan review of the shared host rules, with at most one more round for a blocking finding.
- Computer use and simulator QA run on Terra 6.1 Low fast, browser app testing on Terra 6.1 High fast and video recording on Terra 6.1 Medium fast (model screen of 2026-10-29); a parent on another model delegates the browser work instead of driving it at extra-high effort.
- Browser budget (operator decision 2026-10-14): one browser or computer-use session per PR, on its ready head, covering every affected flow in one pass. A second session only when the first found a real defect, and it checks only that fix; never a session per push or per polish change. An independent visual critique runs once per PR and only for UI changes. Never a third session without the operator.
- Primitives: each product repo keeps `docs/architecture/primitives.json` true (`development-system check-primitives`); `primitives-gardener` fixes them and the Steward tends them. PRs carry a `system-recap`.
- Two-way (reversible: a screen on develop, a rename, a revertible PR): the agent decides and records it in the closing. Other decisions stop only when they meet one of the five stops (spend, destruction not ordered, messages to people, account security, production).
- Gardener ladder (Lauren Tan): make the error impossible in code > lint/CI/guard > rule/skill, never a style guide alone. A mistake seen twice becomes a proposed hard rule at the highest possible level. A class of finding that reviews raised twice becomes a lint, guard or check before another round is spent finding it again.
- Mistake log: record each root cause a retro or correction finds with `development-system mistake add --id <slug> --incident <ref> --evidence <ref> --repository <repo>`, reusing the existing id it suggests for the same cause (`--new-id` only for a truly new cause) and adding `--cause <slug>` once the root cause is confirmed; a cause with two distinct incidents (`mistake list --repeated --by cause`) becomes a proposed hard rule on that ladder. Paper cuts go to `development-system friction add` before the closing; frictions feed the Steward and never count as mistakes.
- An `AGENTS.md`/`CLAUDE.md` rewrite or a lint-tool migration proves it kept every rule before merge: `development-system check-agents-rules --base <ref> <file>`, and `development-system check-lint-floor --write <snapshot>` on the base checkout then `--snapshot <snapshot>` on the candidate.
- No evals.

## Progress and delivery format

One closing says how the work is going (owner decisions 2026-11-11 and
2026-11-12: «qué se hizo a grandes rasgos, qué necesita de mí… en qué relación
está con esa definición de done… sin tablas»; «visualmente alegre… que se
entienda enseguida»). Write it in the thread every time: when a batch or a PR
ends, whenever you stop, and whenever the owner asks how it is going. Use the
user's language. The owner must understand it at once, without opening anything
else and without asking a follow-up question.

1. First sentence: whether you need something from the owner, and the state of
   the work. A request to the owner always goes in that first sentence. Never
   bury a required response in a selectable stage, a questionnaire, a report,
   a page served through a tunnel or a generic approval marker.
2. **What was done** («Qué se hizo»): two to four plain sentences that a person
   outside the task understands. When there is a plan, summarize it here in one
   or two sentences. No file lists and no term without its meaning.
3. **Against done** («Cómo vamos contra el terminado»): every task has a
   definition of done; when the owner gave none, state the one you work to.
   Name it in one line, then one short line per part with ✅ (met), ⏳ (in
   progress), 🧱 (blocked) or ❌ (not met).
4. **What I need from you** («Lo que necesito de ti») and **What happens next**
   («Lo que sigue»).

Cheerful and easy to scan: emojis and short lines are welcome. No tables. At
most 2,000 characters. One 💡 line with what was not verified, or what is
stopped and why, when there is something to say. A small change may use one
line per part. Detail comes only when the owner asks; the HTML report from
`development-system document` is produced on request, never as the explanation.

**What I need from you** names the exact decision, input or action and what it
unlocks; when nothing is needed, say so. **What happens next** names the next
action, who owns it and any real dependency; when the authorized work is
complete, say so without inventing another step. Do not ask again for retained
authorization or turn an optional choice into a blocker; keep doing independent
authorized work. Before naming a need, use the access already granted
(repository test accounts, a session the owner shared, logging in yourself);
when it fails, try another route and report the gap instead of asking. An
optional item carried over by a compaction summary is not a need.

The facts come from a command, not from memory: `development-system progress
<owner/repo#number>...` with every PR of the initiative prints what is merged,
what is open and at which step of the gate, and prints what it could not read
as «desconocido». It never says that something waits for the owner or that the
work is finished: you decide that, after checking the authorization you already
have in the conversation.

A real request also uses the host's question tool when that tool is enabled for
the current mode (`request_user_input` in Codex, `AskUserQuestion` in Claude
Code); when it is not, the first sentence carries the request. When the thread
hands control to the owner (a question, a PR ready for them, a real block),
stop watching the PR (`unwatch_pull_request`): a watched thread looks busy and
never reaches the inbox. While you wait on your own for checks or reviews, keep
the watch and end the turn without a message; never write "still waiting".

The Stop hook checks this: when a turn changed files and the last message
lacks «Lo que necesito de ti» / "What I need from you" or «Lo que sigue» /
"What happens next", it returns this format once.

A visual rendered in the thread is for when a picture explains faster than
text: a substantive plan (the `visual-explain` line and window), a trend or a
comparison, or when the owner asks for one. It carries the same four parts and
shows all of its content without clicks. Explicit text-only requests win. Only
the parent publishes in the owning T3 thread, using `html_preview` before
`html_render` on the exact HTML; without the capability or authorization, give
the text closing and state the gap. Grill keeps its existing HTML
questionnaires, contextual questions, drafts and submission flow; the question
tool and the visual-choice tool stay as they are. A visual, a report or an
approval marker grants no authority and proves no installation, adoption or
acceptance.

## Report and Headroom evidence

The closing in the thread is the delivery (owner decision 2026-11-12: «ya no
es necesario ir a un lugar distinto para leer»). `development-system document`
writes the readable HTML report (behavior passed/failed/not reached, elapsed
time, evidence, material gaps) in the approved AO HyS r5/p2 presentation it
shares with questionnaires, contextual questions, browser drafts and revisioned
batch submission only when the owner asks for it; then link its persistent
path, and render it in the owning T3 thread when asked. No hook requires a
report. A temporary tunnel is optional; when used, state its actual
URL and expiry and never make it the only delivery. Secrets and private
transcripts stay outside any served directory. A report is not acceptance
evidence.

Headroom is an explicit same-account per-invocation option requesting lossless,
cache-conservative operation; provider cache reuse can still change request
bytes, so never promise byte identity. Keep native usage of the parent and every
actual descendant apart from proxy counters. Use launch/completion events, not
polling. Proxy counters and token deltas are descriptive; without complete
controlled evidence, never claim Headroom caused savings.

## Shared agent tooling

Use the active global development-system CLI for reports, skills and orchestration; doctor identifies package, contract, catalog and drift. Read each repository AGENTS.md, README and task-relevant docs; no adapter is required. Product-local packages are pinned CI checks only. T3 owns child tasks, history, browser and scheduling; run-worker is only an optional external process utility. Legacy launchd activation is retired. Updates and rollback restore the complete shared tuple.

## Shared host rules

Use the agents: Haiku 5.5 explores, Terra 6.1 fast does computer use and browser QA, Fable 5.2 reviews, and Sol 6.1 High runs a cross review the operator asks for or a review round while Fable is recorded unavailable. A delegated plan is authored by the parent or its planner role and gets one review by a fresh independent Fable 5.2 reviewer (`Review kind: plan`), with one more round only for a blocking finding; a cross-family contrast is not required. The parent integrates the result. Use existing supported read-only native or T3 routes; receipt-bound compatibility roles remain receipt-bound. Resolve each material objection by correction or evidence-backed rejection; an unresolved blocker prevents acceptance. Respect explicit provider restrictions. When Fable is unavailable, record it and continue with the Sol round the gate orders instead of asking. Existing code/security recovery remains unchanged.

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

New sessions request Sol 6.1 High normal speed; preserve an already selected parent. Bounded source facts and read-only research request Claude Haiku 5.5 Medium through an available native Claude or T3 read-only route. An independent Fable 5.2 reviews the integrated result through a read-only delegate_task to claude-fable-5-2 after `development-system review reserve`; the gate's `siguiente` gives the exact step and orders Sol 6.1 High through codex-review while Fable is recorded unavailable. For explicitly selected Codex-only work, native general writers request Sol 6.1 Medium; exact and mechanical writing requests Claude Haiku 5.5 Medium through protected native Claude mechanical-worker or exact-implementer roles. Preferred mixed roles are Opus 5.5 difficult implementation and UI, Sonnet 5.5 general bounded execution and Haiku 5.5 exact/mechanical execution only when the protected native host supports them; do not assign unsupported Claude models to Codex native tools. Existing Codex Sol/Luna profiles remain available for explicitly selected Codex-only work, not automatic fallback. If a protected Haiku writer route is unavailable, the authorized parent edits directly and reports the gap. Fable 5.2 is the reviewer for backend, security and plans; computer use, browser QA and video run on Terra 6.1 fast as the shared host rules assign. Launch ready read-only children together; a secret or sudo password is asked at most once per task. Opus 5.5 independent visual critique may use T3 read-only delegation.

Without observed native writer ownership admission and Git restrictions, admit no writing children. The selected coordinator may perform authorized sequential direct editing, with read-only children and independent review. Prompt-only profiles do not establish protection.

## Claude Code host

The selected Claude model remains the parent. Opus 5.5 handles difficult implementation, UI design and writing, and fresh independent visual critique. Haiku 5.5 Medium uses the exact pinned model claude-haiku-5-5 for protected mechanical-worker and exact-implementer packets and read-only Explore, code-mapper and docs-researcher. When one question needs broad reading of unfamiliar code (about ten or more searches or file reads), the parent sends it to one Explore or code-mapper without a model parameter and works from the returned map; a known file or exact name stays with the parent. Haiku writers require exclusive Owned paths and writerGit hooks. Sonnet 5.5 retains the general implementer role. Other Haiku versions, aliases, plugin and unregistered Haiku roles are denied. No per-subagent thinking switch; the host/operator controls effort, and actual metadata must be observed. Fable 5.2 reviews finished PRs, plans, diffs and security as the fresh read-only `reviewer` role (exact model claude-fable-5-2) with a `Review kind:` line; a `PR:` line reserves the lineage slot. Sol 6.1 High reviews through codex-review only in a cross review the operator asks for or while Fable is recorded unavailable. The guard coaches the parent with one sentence, never a block: after ten consecutive reads without a mapper, when a second writer in a row is launched alone, and from the second secret request of a session. Computer use runs through an observed Codex invocation on Terra 6.1 fast as the shared host rules assign (codex-review.mjs --computer-use requests low; --flow browser-testing requests high and --flow video medium), using native T3 delegation when available. Cross-provider specialization is separate from account recovery.

Native CLI compatibility: codex-review.mjs preserves at most two sequential credential-home attempts without copying credentials. Read receipt.json and findings. Only fallback_required with eligible true authorizes a fresh receipt-bound native reviewer (reviewer-medium while Fable is recorded unavailable) or browser-qa using receipt.fallback.prompt verbatim, with unchanged packet/hash/root/Task-Id and no resume. Any fallback envelope sent to visual-reviewer also requires the same validation. Computer-use receipts remain single-use; cancellation, refusal or uncertain effects require reconciliation, never replay. Primary visual-reviewer needs no fallback receipt: it is fresh, has no Owned paths and cannot write source. Retired review roles remain retired.

The Agent hook enforces named models, ownership syntax/locking, writer Git restrictions and writer expiry; plugin agents with ownership or writer declarations are denied, even on Opus. These Agent checks do not prove delegate_task coverage. At most four native subagents; descendants cannot start agents.

## Authorized Claude Code account recovery (1.39.0)

For Claude Code review and computer use, the operator explicitly authorizes the
local Codex credential-home sequence followed by a fresh native Claude role.
Run codex-review once; it discovers existing profiles without copying credentials
and records at most two sequential profile attempts. Read receipt.json as well as findings.
When status is fallback_required and fallback.eligible is true, immediately
dispatch reviewer-medium (plan, diff or security; reviewer is Fable 5.2), visual-reviewer (image review) or
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

Use development-system browser-pool for explicit dedicated-browser reservations. Inventory never proves login or Computer Use readiness. Personal Chrome is disabled unless the operator explicitly dedicates it; the 2.12.0 Browse pilot is that dedication for read-only sessions on dashboards the owner names, after a recorded precondition (billing inventory, guard active, the session's capabilities reviewed), with the five stops applying to every click. Registered account observations expire; verify the exact controllable account again before effects. Native computer-use reservations remain desktop-exclusive until a real adapter enforces application confinement. No waiting queue: capacity-needed means continue independent work or provide another verified resource, never steal a browser. Expiry, cancellation and uncertain effects require quarantine and explicit reconciliation. The pool gates participating launches only; it does not intercept direct T3/browser MCP calls or hot-switch existing threads. For T3 preview, each parallel worker opens its own tab and passes its exact tabId; a shared persistent profile still shares login state. Imported T3 profiles are not automatically selected by the current preview_open route.
