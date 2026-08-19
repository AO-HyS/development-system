---
name: coding-orchestration
description: Orchestrate non-trivial software work in Git repositories with bounded Codex agents, one writer by default, explicit lane closure, and measurable outcomes. Keep trivial localized work on the parent.
---

# Coding Orchestration

The parent owns decomposition, integration, conflicts, verification, and the requested end state. Optimize for verified delivery, not agent count or first-diff speed.

## Choose direct, sequential, or delegated execution

1. Read repository instructions and lock the smallest executable slice.
2. Keep trivial, localized, reversible edits and short diagnostics on the parent.
3. Delegate only when work is genuinely independent, crosses specialties, or an independent risk review materially improves confidence.
4. Use direct or sequential execution when multi-agent v2 is unavailable, unhelpful, or would cost more coordination than the task.
5. Never spawn agents merely to restate a prompt, duplicate discovery, or edit a few obvious lines.

## Bound concurrency and ownership

- Use at most three concurrent subagents in the normal path. Exceed that only with a recorded, task-specific reason.
- Keep one writer for every non-trivial slice. Multiple writers require disjoint files or packages and explicit ownership.
- Keep the parent useful while agents run. Prefer one event-driven wait when a result is the last blocker; do not poll with repeated list or wait calls.
- Reuse a stable task name with a follow-up message instead of spawning replacement agents for corrections.
- Keep spawned depth at one. Workers must not create more workers.

## Route by evidence and risk

Use the installed custom agent whose name matches the work: discovery and mapping, focused implementation, backend, UI design, browser QA, performance, security, review, tests, or release. The custom agent TOML is the source of truth for model and reasoning.

Run only the review or QA lane justified by the changed risk. UI interactions need browser evidence; security boundaries need security review; a tiny deterministic code edit does not need a generic reviewer swarm. A full suite requires explicit authorization for that run.

Each delegated prompt includes one objective, exact ownership, absolute worktree and branch, applicable instructions, whether edits are allowed, expected evidence, and escalation conditions.

## Close every lane

Before the parent reports completion, every planned lane must have exactly one terminal state:

- `integrated`: useful work or evidence was incorporated;
- `discarded`: output was intentionally rejected with a reason;
- `blocked-with-owner`: a named owner and concrete blocker remain;
- `not-started`: the planned lane was deliberately unnecessary.

An open, merely idle, or unaccounted lane makes the orchestration run incomplete. Delegation never expands implementation, tracker, merge, release, production, migration, or paid-service authorization.

## Measure the natural-work pilot

Record direct, sequential, and delegated runs so a correct zero-agent decision counts as evidence. At the first checkpoint after five non-trivial runs or five calendar days, compare the candidate period with historical comparable runs; do not repeat product work solely to create an A/B test.

Retain the policy only when verified outcomes do not regress and at least one coordination signal improves without another regressing: waits, open lanes, or correction/rework. Otherwise adjust the policy or collect more evidence. Do not claim causal savings from uncontrolled history.

Feed at most one first action per repository into Check-in, labeled `mobile`, `computer`, or `no-action`. The weekly Development Steward and on-demand Check-in surface the pilot; raw session evidence remains private.

## Final evidence

Report the chosen mode, agents used, terminal lane states, focused checks, review/QA rationale, waits, corrections, and verified outcome. Missing runtime or model evidence remains unresolved rather than inferred.
