# ADR 0071: Cross-family planning with the selected parent

Status: accepted by operator instruction on 2026-10-08. Contract 2.1.3.
Supersedes the universal Sol plan/Sol plan-review instruction in ADR 0070.

Preserve the selected parent. With any OpenAI parent, Opus 5.5 writes the plan
and a fresh independent Sol 6.1 High reviews it. With any Anthropic parent,
Sol 6.1 High writes the plan and a fresh independent Opus 5.5 reviews it.
The parent integrates corrections and evidence-backed responses; an unresolved
blocking objection prevents acceptance. If a provider restriction or outage
prevents contrast, including same-family recovery, report it not reached and
retain the plan pending contrast or an explicit user decision.

The installed implementation roles already provide Haiku 5.5 exact/mechanical
execution, Sonnet 5.5 general execution and Opus 5.5 difficult/UI execution.
Retain the roles, the orchestrator's choice, Jev's advisory behavior, technical
review/computer use on Sol, and independent visual critique on Opus. Preserve
capability limits and protected writer admission; unsupported routes remain gaps.

Use existing native/T3 read-only routes for planning and review. No T3 changes,
new bridge, dispatcher, guard or classifier. Receipt-bound roles remain so.
Code/security account recovery remains unchanged.

Publish new immutable instruction snapshots using the existing local package
mechanism. At the next safe turn before delegation, active threads reread the
installed rules; current calls retain their model. Preserve work and authority.
Inactive threads adopt on resume. Confirm with the next real delegation, not a
file copy or acknowledgement. A new thread is only a last-resort handoff.
