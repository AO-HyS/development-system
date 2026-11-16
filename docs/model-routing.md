# Model routing (3.1.0)

The generated source of truth is `artifacts/3.1.0/model-routing.md`; this page is
a short operator summary. Edit `config/agent-roster.json`, then publish a new
snapshot. Requested model, effort and tier are not observed identity: report
actual runtime metadata or mark it unknown.

**The model selected when the conversation starts remains the orchestrator, and
it chooses how to work.** No agent, model, skill or order of work is required;
they are installed to be used when they make the work faster or better.

## Current routing

- Sol 6.1 High (`gpt-6.1-sol`, reasoning high): the independent read of a critical change before it merges and of a batch of normal changes at the end of a session, in a fresh context that did not write the change. From Claude Code through `delegate_task` or codex-review; from Codex a fresh read-only child.
- Fable 5.2: not part of the routine.
- Opus 5.5, Sonnet 5.5 and Haiku 5.5 (pinned `claude-haiku-5-5`): the named Claude Code agents keep their pinned models; none is mandatory.
- Terra 6.1 fast (`serviceTier` priority): computer use and browser work for what QuickE2E and Playwright cannot reach.

The roster guard and the stop gate are no longer wired. What a change goes
through is in [listo.md](listo.md): the level from `config/niveles.json`, Codex
answered, the smoke, and for a critical change the read, its cases and the
record.

## Rules that stay

- Computer use is a separate scoped authority for product effects, never permission to edit source.
- Never silently change provider or lower acceptance when a capability is missing.
- File installation does not prove a host loaded the new routing; observe the next real delegation.
