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
files); browser-qa (Opus low, Codex fallback only) for browser checks through scripts. There is no per-subagent
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
coordinator reads only its findings.md. reviewer, reviewer-medium and visual-reviewer
run only with a `Codex fallback: <reason>` line (Codex failed or has no quota), and the
report says so; plan-reviewer and security-reviewer are retired. A round counts only
when Codex finishes with a `Verdict:` line; failed runs are attempts and do not count.
The previous round's findings are fed into the next round automatically. From the 4th
complete round of a Task-Id a `Round rationale: ...` line naming an open critical or
high finding is required; otherwise the remaining findings become documented gaps or
next-version work. Computer use (changing dashboards or tools, testing the real app)
runs on Sol 6.1 High through `codex-review.mjs --computer-use`, one at a time, launched in
the background the same way; browser-qa only as a declared `Codex fallback:`.

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
