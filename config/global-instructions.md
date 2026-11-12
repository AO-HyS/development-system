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
computer use and browser QA; Sol 6.1 High reviews finished PRs and plans
through codex-review; Fable 5.2 reviews only security work and hard reviews
(owner decision 2026-11-12: «Fable para las revisiones de seguridad y las
difíciles; todo lo demás, Sol»). When one question needs broad reading of unfamiliar code
(about ten searches or file reads), send it to one mapper and work from its
map; a known file or exact name stays with the parent. Launch ready lanes with
disjoint owned paths together in one message and serialize only real
dependencies. Ask for a secret or sudo password at most once per task: put the
privileged steps in one script first and check `sudo -n true` before asking
again.

Agents are for speed and cost, not for their own sake (council measurements of
2026-11-12 over the owner's asks that closed and were verified). Writers by
cost: exact or mechanical edits go to Haiku 5.5 (exact-implementer,
mechanical-worker) and general bounded work to Sonnet 5.5 (implementer); an
Opus writer needs a packet line `Opus reason: <why>` (open cross-cutting
decisions, a shared primitive, two failed rounds with a cheaper writer), and UI
slices stay on ui-implementer. Parallel lanes serve different things the owner
asked for, never more passes over the same thing: tasks with six to twenty
helpers closed the most per minute and per dollar, and past twenty they cost
and took twice as much. One PR per thing the owner asked: a fix or a follow-up
of the same thing is a commit on its open PR, not a new PR.

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
Sol 6.1 reviews (Fable 5.2 for security and hard ones) by affected behavior and required gates.

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
- Reviews (owner decisions 2026-10-14 and 2026-11-11: «Una vez que llegue a 5 y todavía no encuentre el freno, ya quiero que avance»; 2.14.1 lowers that cap from five to two on the council's measurements of 2026-11-12, a coordinator's proposal shown to the owner that day, which he can restore): review the finished PR, never each push, and never ask the owner for a round, to resolve PR threads, to run a command you can run or to waive a develop merge. Run `development-system pr-review-status <pr> --gate` and do what its `siguiente` says; for a PR into develop it is always an action of yours. The gate names the reviewer of each round: Sol 6.1 High through codex-review, and Fable 5.2 for security work and hard reviews (authorization, roles, data boundaries, money, minors' privacy or consent; a critical finding still open; a third round or later on the branch; a shared contract or primitive; an open architectural decision). Fable is a fresh read-only reviewer (Claude Code: Agent `reviewer` with `Review kind: security`, or another `Review kind:` plus `Review difficulty: hard: <reason>`; Codex: a read-only `delegate_task` to `claude-fable-5-2`). The gate runs up to two rounds per branch lineage (closing a PR and opening another from the same branch never resets the count), and then advances; when Fable fails on quota or is not offered, record it with `development-system review release --pr <ref> --reservation-id <id> --reason "fable-unavailable: <observed message>"` and the gate orders that round to Sol 6.1 High, without asking; only a critical finding (security, authorization, data loss, money, minors' privacy, consent, or no stated domain) gets rounds three and four, and if it is still open the disputed change leaves the PR. Stopping reviews is not acceptance: the ledger keeps what nobody re-read. Ask Codex (`--request`) at most twice; answer each Codex thread in the thread with the fix commit or «Rechazado: <reason>», without resolving it. The reviewer packet comes from `development-system review brief`. A wrong ledger row is annulled with `development-system review void`, never by hand. When the owner says to stop reviewing, quote the words in the PR and record them with `development-system review waive --pr <ref> --head <sha> --quote "<words>"`.
- `cross-review` runs only when the operator asks for it; plans and primitive lists otherwise get the single plan review of the shared host rules, with at most one more round for a blocking finding.
- Computer use and simulator QA run on Terra 6.1 Low fast, browser app testing on Terra 6.1 High fast and video recording on Terra 6.1 Medium fast (model screen of 2026-10-29); a parent on another model delegates the browser work instead of driving it at extra-high effort.
- Browser budget (operator decision 2026-10-14): one browser or computer-use session per PR, on its ready head, covering every affected flow in one pass. A second session only when the first found a real defect, and it checks only that fix; never a session per push or per polish change. An independent visual critique runs once per PR and only for UI changes. Never a third session without the operator.
- Primitives: each product repo keeps `docs/architecture/primitives.json` true (`development-system check-primitives`); `primitives-gardener` fixes them and the Steward tends them. PRs carry a `system-recap`.
- Two-way (reversible: a screen on develop, a rename, a revertible PR): the agent decides and records it in the closing. Other decisions stop only when they meet one of the five stops (spend, destruction not ordered, messages to people, account security, production).
- Gardener ladder (Lauren Tan): make the error impossible in code > lint/CI/guard > rule/skill, never a style guide alone. A mistake seen twice becomes a proposed hard rule at the highest possible level. A class of finding that reviews raised twice becomes a lint, guard or check before another round is spent finding it again.
- Mistake log: record each root cause a retro or correction finds with `development-system mistake add --id <slug> --incident <ref> --evidence <ref> --repository <repo>`, reusing the existing id it suggests for the same cause (`--new-id` only for a truly new cause) and adding `--cause <slug>` once the root cause is confirmed; a cause with two distinct incidents (`mistake list --repeated --by cause`) becomes a proposed hard rule on that ladder. Paper cuts go to `development-system friction add` before the closing; frictions feed the Steward and never count as mistakes.
- An `AGENTS.md`/`CLAUDE.md` rewrite or a lint-tool migration proves it kept every rule before merge: `development-system check-agents-rules --base <ref> <file>`, and `development-system check-lint-floor --write <snapshot>` on the base checkout then `--snapshot <snapshot>` on the candidate.
- No evals.

{{visual-delivery}}

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

{{shared-host-rules}}

{{codex-host}}

{{claude-host}}

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
