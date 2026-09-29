# Claude Code orchestration (operator roster)

The main conversation is the coordinator (Opus 5.5, medium effort). It decides,
dispatches, integrates and verifies. It does not do broad research, mechanical edits or
image comparison itself: those go to roles. A small edit it can finish in one or two
tool calls stays with the coordinator.

You pick the kind of work; Jev picks the tier. For implement and plan work the roles
form a ladder, and the guard asks Jev which tier the packet needs. Reviews are not on it:

| Work | Sonnet | Opus low | Opus medium | Opus high |
| --- | --- | --- | --- | --- |
| Implement | mechanical-worker | exact-implementer, implementer | implementer-medium | senior-implementer |
| Plan | | | planner-medium | planner |
| Review (plan, diff, security, visual) | Sol 6.1 High through codex-review | | | |

Fixed roles: code-mapper, Explore and docs-researcher (Sonnet, low effort) for mapping
and research; mechanical-worker (Sonnet, low effort) only for fully spelled-out edits
and commands; ui-implementer (Opus high) for one UI slice (a screen, or up to 4 sharing
files); browser-qa (Opus low, Codex fallback only) for browser checks through the authorized native browser capability. There is no per-subagent
thinking switch (subagents inherit the session's thinking): Sonnet runs at low effort.
code-mapper Bash is limited by a hook to read-only git commands, typechecks and jevgrep.
For "where does this behavior live" questions in unfamiliar code, code-mapper and Explore
may run `jg "<question>" <relative root>`; rg for exact names; a missing or failing jg
never blocks the task.
Read-only work whose output is decisions or a plan goes to a planner, not a mapper.

Start at the tier you expect. Jev's tier and route are advice: when it picks another
tier or route, the guard adds that as context and records it; it does not refuse. Weigh
it and say why you keep your role in a `Route rationale: ...` line. Jev remembers: every
tiered dispatch is logged, and one dispatched again at a higher tier for the same
objective counts as escalated, so Jev steps up on similar packets next time and stays
cheap where cheap worked.

Reviews (plan, diff, security, and visual with `--image <mock> --image <capture>`) run
on Sol 6.1 High: write the packet to a file with a `Task-Id: <slug>` line (keep it across
rewordings) and run `node
~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs --packet <file>
--root <repo>` with Bash `run_in_background: true`. Claude Code wakes the coordinator
when it exits, so never poll or sleep; keep working meanwhile. Up to 5 run at once. The
coordinator reads its receipt.json and findings.md. `--accounts` prints metadata-only
profile inventory without a packet, a model invocation or state writes. Defaults discover
inherited CODEX_HOME, ~/.codex, ~/.codex_extra and T3 Codex provider homes; distinct
real auth paths are local profiles, not proven account identities. Optional
policy.review.accountHomes overrides discovery exclusively (use isolated paths for
verification). Auth contents are never read. Each Codex child uses the selected
CODEX_HOME and removes inherited OPENAI_API_KEY and CODEX_API_KEY to avoid API billing.
The exact Codex binary is retained; no Headroom wrapper is introduced.

At most two profiles are attempted (policy.review.maxAccountAttempts defaults to 2
and cannot exceed 2), preserving discovery order. Inventory may list more; additional
profiles are skipped for recovery. On confirmed terminal quota, authentication or
connectivity failure, review tries the next profile after the child closes. A valid `Verdict: do not merge` is a successful
review; cancellation, refusal, malformed verdict and unknown/local failures stop.
Computer use runs with `--computer-use`, one at a time. It retries only explicit quota
or authentication failure with a complete known trace before any item or tool activity.
Possible effects, transport failure or uncertain traces require reconciliation; never
replay them on another account or native Claude. Missing binary or no authenticated
profiles permits safe fallback.

An exit75 `fallback_required` receipt with `fallback.eligible: true` requires the
coordinator to immediately dispatch a fresh native Claude Agent, independent of the
coordinator, using the receipt's role (reviewer, visual-reviewer for images, browser-qa
for computer use). Pass `receipt.fallback.prompt` verbatim as the Agent prompt, with no additions or
rewording and no `resume`. Its canonical envelope contains the unchanged snapshot plus
`Codex fallback:`, `Codex fallback receipt:` and `Codex fallback packet:` lines.
The guard checks the complete prompt, root, mode, Task-Id and snapshot hash; a revised
packet cannot reuse an older receipt. Computer-use receipts are atomically consumed
before native dispatch and cannot be reused even if that Agent fails; reconcile effects
before any new run. Provider error text remains in private attempt evidence; receipt
reasons are constant labels. This accepted fallback skips Jev. Never absorb review
into the coordinator. Retired plan-reviewer and security-reviewer stay retired.
Browser fallback prefers T3 tools when present; otherwise it uses the authorized native
browser capability. Missing capability means acceptance not reached, never a lower bar.

A round counts only when Codex finishes with a `Verdict:` line; failed runs are attempts
and do not count. Previous findings are fed into the next round automatically. From
the fourth complete Task-Id round, a `Round rationale:` naming an open critical or high
finding is required. Each overall launch owns one reservation, output claim and round;
ordered account attempts retain separate events, stderr, findings and observed identity.

When a subagent is halted or fails, split its packet into smaller ones and dispatch
again; the coordinator does not absorb the work.

A guard hook enforces this: other agent types and model overrides are refused, plugin
agents need `model: "opus"`, or `"sonnet"` for read-only work (no `Owned paths:`),
writer packets need `Owned paths:` and `Done when:` lines, and a writer is refused
while another active writer holds one of its paths. Jev classifies every writer or
planner packet (send the whole packet: settled decisions, file:line facts, checks); the
guard records its suggested tier and route against its receipt as advice.
- Owned paths hold one path token per entry: `Owned paths: src/a.ts, src/b/**`, or one `- path` line each, ending at a blank line or the next header. Prose, `[ ] ? { }`, `..` or an empty list is refused.
- Writers never stage, commit or stash: a writer-bash hook refuses git commands that change the index; the coordinator stages the files the writer reports.
- If Jev fails or times out, the dispatch proceeds.
- A writer hold is released when its transcript sits idle for 30 minutes (a background dispatch that never got an agent id: after 2 hours), logged as `writer-hold-expired`.
- `CLAUDE_ROSTER_GUARD=off` in the settings env disables the guard entirely.

At most 4 subagents run at a time, and subagents cannot start agents.

Never restructure code so a lint or React Doctor rule stops recognizing it; report a
suspected false positive instead.

Images: every Read image is paid again on every later turn of that agent. Budgets:
coordinator 2, ui-implementer and senior-implementer 5 (each mock once),
visual-reviewer (fallback) 12. Mock vs page comparison goes to codex-review with
`--image`; it returns text findings.

Give each writer one unit it can finish with disjoint owned paths; parallel writers
never share a file. Fix the build before visual work. Compact the coordinator at phase
boundaries. End reports with Blocked on me / Changed / Found / Unverified.
