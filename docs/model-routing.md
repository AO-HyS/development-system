# Model routing (2.13.1)

The generated source of truth is `artifacts/2.13.1/model-routing.md`; this page is
a short operator summary. Edit `config/agent-roster.json`, then publish a new
snapshot. Requested model, effort and tier are not observed identity: report
actual runtime metadata or mark it unknown.

**The model selected when the conversation starts remains the orchestrator.**
The parent chooses agents from the available native capabilities and delegates
only useful independent work, one writer per surface.

## Current routing

- Sol 6.1 High: plans with an Anthropic parent, and reviews backend, security and the integrated result.
- Opus 5.5: plans with an OpenAI parent; difficult implementation, UI, and independent plan and visual review.
- Sonnet 5.5: general bounded execution.
- Haiku 5.5 Medium (pinned `claude-haiku-5-5`): exact and mechanical writers through protected native roles, and read-only mapping and research.
- Terra 6.1 fast (`serviceTier` priority): computer use and simulator QA Low, browser app testing High, video recording Medium.

Delegated planning crosses provider families: an OpenAI parent has Opus 5.5
author and Sol 6.1 High review; an Anthropic parent has Sol 6.1 High author and
Opus 5.5 review. Same-family recovery or an unavailable family leaves the
contrast not reached.

## Rules that stay

- Computer use is a separate scoped authority for product effects, never permission to edit source.
- T3 source-code writers are not admitted until exclusive ownership and writer Git protections are observed; otherwise the authorized parent edits directly and reports the gap.
- Never silently change provider or lower acceptance when a capability is missing.
- Settle a delegated child's thread after integrating its result, and read `runtimeMode` before the first `delegate_task`.
- Review rounds follow the budget in `config/global-instructions.md` (per branch lineage, approvals bound to a round).
- File installation does not prove a host loaded the new routing; observe the next real delegation.
