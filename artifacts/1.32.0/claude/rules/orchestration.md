# Claude Code orchestration (operator roster)

The main conversation is the coordinator (Opus 5.5, medium effort). It decides,
dispatches, integrates and verifies. It does not do broad research, mechanical edits or
image comparison itself: those go to roles. A small edit it can finish in one or two
tool calls stays with the coordinator.

You pick the kind of work; Jev picks the tier. For implement, plan and review work the
roles form a ladder, and the guard asks Jev which tier the packet needs:

| Work | Haiku | Opus low | Opus medium | Opus high | Fable 5.1 |
| --- | --- | --- | --- | --- | --- |
| Implement | mechanical-worker | exact-implementer, implementer | implementer-medium | senior-implementer | |
| Plan | | | planner-medium | planner | |
| Review (plan, diff, security) | | | reviewer-medium | reviewer | plan-reviewer, security-reviewer |

Fixed roles: code-mapper, Explore and docs-researcher (Haiku) for mapping and research;
ui-implementer (Opus high) for one UI slice (a screen, or up to 4 sharing files);
visual-reviewer (Opus high) for mock vs live page, fresh each time; browser-qa (Opus
low) for browser behavior checks through scripts.

Start at the tier you expect. If Jev picks another tier with confidence, the guard
refuses once and names the role at Jev's tier: dispatch that role, or keep yours with
a `Route rationale: ...` line. Jev remembers: every tiered dispatch is logged, and one
dispatched again at a higher tier for the same objective counts as escalated, so Jev
steps up on similar packets next time and stays cheap where cheap worked.

Fable 5.1 is the most expensive model and is used minimally: only for very large or
ultra-hard specs that touch many modules. The Fable roles run when Jev picks fable (or
gives it p >= 0.4), or when the packet has a `Fable scope: ...` line naming the
surfaces and why Opus high is not enough. Sonnet is not used. Astra/Codex are not
available right now.

A guard hook enforces this: other agent types and model overrides are refused, plugin
agents need `model: "opus"` or `"haiku"`, writer packets need `Owned paths:` and
`Done when:` lines, and a writer is refused while another active writer holds one of
its paths. Jev classifies every writer or planner packet (send the whole packet:
settled decisions, file:line facts, checks) and the chosen route is recorded against
its receipt. Jev never stalls work:
- A packet (by its `Objective:` line) is refused at most once, for any reason. Dispatching it again proceeds.
- Route refusals apply only to writer packets; tier refusals to implement, plan and review roles.
- After three refusals in a session, Jev only advises.
- If Jev fails or times out, the dispatch proceeds (the Fable roles then need the `Fable scope:` line).
- A writer hold is released when its transcript sits idle for 30 minutes.
- `CLAUDE_ROSTER_GUARD=off` in the settings env disables the guard entirely.

At most 4 subagents run at a time, and subagents cannot start agents.

Images: every Read image is paid again on every later turn of that agent. Budgets:
coordinator 2, ui-implementer and senior-implementer 5 (each mock once),
visual-reviewer 12. The visual-reviewer is the only role that compares mock and page,
and it returns text findings.

Give each writer one unit it can finish with disjoint owned paths; parallel writers
never share a file. Fix the build before visual work. Compact the coordinator at phase
boundaries. End reports with Blocked on me / Changed / Found / Unverified.
