---
name: coding-orchestration
description: Orchestrate non-trivial software work with fast-model-first bounded Codex lanes, one writer by default, explicit lane closure, and measurable outcomes. Keep trivial localized work on the parent.
---

# Coding Orchestration

The parent owns decomposition, integration, conflicts, verification, and the requested end state. Optimize for verified delivery, not agent count or first-diff speed.

## Choose direct, sequential, or delegated execution

1. Read repository instructions and lock the smallest executable slice.
2. Keep trivial, localized, reversible edits and short diagnostics on the parent.
3. For every non-trivial slice, delegate the single writer lane to Luna `fast_implementer` and run one independent Sol reviewer after the diff. Apply independence, cross-specialty, and material-risk criteria only when deciding whether to add mapping, research, test, specialist, or additional specialized-review lanes.
4. Use fast-model-first execution: Sol High remains the parent; Luna handles bounded mapping, research, focused implementation, and focused tests; an independent Sol reviewer follows the diff.
5. Use direct or sequential execution when multi-agent v2 is unavailable, unhelpful, or would cost more coordination than the task.
6. Never spawn agents merely to restate a prompt, duplicate discovery, or edit a few obvious lines.

## Bound concurrency and ownership

- Use at most three concurrent subagents in the normal path. Exceed that only with a recorded, task-specific reason.
- Keep spawned depth at one. Reject inherited model evidence; every lane records its resolved runtime model.
- Keep one writer for every non-trivial slice. Multiple writers require disjoint files or packages and explicit ownership.
- Keep the parent useful while agents run. Prefer one event-driven wait when a result is the last blocker; do not poll with repeated list or wait calls.
- Reuse a stable task name with a follow-up message instead of spawning replacement agents for corrections.

## Route by evidence and risk

Use the installed custom agent whose name matches the work: discovery and mapping, focused implementation, backend, UI design, browser QA, performance, security, review, tests, or release. The custom agent TOML is the source of truth for model and reasoning.

Every non-trivial slice receives one independent Sol review after the diff. Add specialized review or QA lanes only when justified by changed risk. UI interactions need browser evidence; security boundaries need security review; a tiny deterministic code edit does not need a reviewer swarm beyond the single required review. A full suite requires explicit authorization for that run.

Each delegated prompt includes one objective, exact ownership, absolute worktree and branch, applicable instructions, whether edits are allowed, expected evidence, and escalation conditions.

For non-trivial work, the default route is one sequential Luna
`fast_implementer` writer lane even when mapping is not independently useful.
Add Luna `code_mapper` or `docs_researcher` only when bounded discovery has
real value, and add Luna `test_runner` only when focused verification has real
value. The Sol parent integrates and an independent Sol reviewer follows the
diff.

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
