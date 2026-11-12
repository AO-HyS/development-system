# Model routing (2.14.0)

The generated source of truth is `artifacts/2.14.0/model-routing.md`; this page is
a short operator summary. Edit `config/agent-roster.json`, then publish a new
snapshot. Requested model, effort and tier are not observed identity: report
actual runtime metadata or mark it unknown.

**The model selected when the conversation starts remains the orchestrator.**
The parent chooses agents from the available native capabilities and delegates
only useful independent work, one writer per surface.

## Current routing

- Fable 5.2 (pinned `claude-fable-5-2`): the fresh read-only reviewer of finished PRs, plans, diffs and security (Claude Code role `reviewer`; from Codex a read-only `delegate_task`).
- Sol 6.1 High: a cross review the operator asks for, and a review round while Fable is recorded unavailable.
- Opus 5.5: planning, difficult implementation, UI, and independent visual review.
- Sonnet 5.5: general bounded execution.
- Haiku 5.5 Medium (pinned `claude-haiku-5-5`): read-only mapping and research (the mapper may search with `rg`, `grep`, `ls`, `sed -n` and `find`), and exact and mechanical writers through protected native roles.
- Terra 6.1 fast (`serviceTier` priority): computer use and simulator QA Low, browser app testing High, video recording Medium.

A plan gets one review by a fresh Fable 5.2 reviewer, and one more only for a
blocking finding. The Claude guard coaches the parent with one sentence, never
a block: after ten consecutive reads without a mapper, when a second writer in
a row is launched alone, and from the second secret request of a session.

## Rules that stay

- Computer use is a separate scoped authority for product effects, never permission to edit source.
- T3 source-code writers are not admitted until exclusive ownership and writer Git protections are observed; otherwise the authorized parent edits directly and reports the gap.
- Never silently change provider or lower acceptance when a capability is missing.
- Settle a delegated child's thread after integrating its result, and read `runtimeMode` before the first `delegate_task`.
- Review rounds follow the budget in `config/global-instructions.md` (per branch lineage; a Fable round and a Sol round take the same slot).
- File installation does not prove a host loaded the new routing; observe the next real delegation.
