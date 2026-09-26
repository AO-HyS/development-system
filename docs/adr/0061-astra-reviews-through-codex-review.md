# ADR 0061: Astra reviews through codex-review

## Status

Accepted. Whether Claude Code launches `codex-review` in the background, wakes
the coordinator on exit and runs the guard as installed remains separate
operational evidence.

## Context

Since 1.32.0 the Claude roster reviewed plans, diffs and security with Claude
roles, and very large specs with the Fable reviewers, the most expensive model.
Astra XHigh on Codex is available again and is the operator's independent
reviewer. Foreground reviews stalled the coordinator, review rounds on the same
objective kept repeating on low-severity findings, and halted subagents' work
was absorbed by the coordinator.

## Decision

Contract 1.34.0 with catalog 0.51.0 (unchanged):

- **D1 codex-review.** `claude/orchestration/codex-review.mjs`, installed under
  `.codex/development-system/runtime/claude-orchestration/`, runs
  `codex exec` read-only with the model and effort from policy `review`
  (`gpt-6-astra`, `xhigh`) on a packet file, with `--image` for visual review.
  It writes packet.md, findings.md, events.jsonl, stderr.log and receipt.json
  and prints one JSON receipt line.
- **D2 Observed identity.** The receipt's observed model and effort come from
  the last `turn_context` of the Codex session log matching the thread id, or
  `unknown`; requested values are never copied into them.
- **D3 Background launch.** The coordinator runs it with Bash
  `run_in_background: true`, keeps working, and is woken when it exits; it
  never polls or sleeps and reads only findings.md.
- **D4 Round rationale.** From the fourth round of the same objective and root,
  the packet needs a `Round rationale:` line naming an open critical or high
  finding; otherwise remaining findings become documented gaps or next-version
  work.
- **D5 Parallel cap.** At most five reviews run at once, counted by live
  pending markers.
- **D6 Guard.** With policy `review.engine` `codex` (policy `2026-09-26.1`),
  the roster guard refuses the retired plan-reviewer and security-reviewer and
  admits reviewer, reviewer-medium and visual-reviewer only with a
  `Codex fallback: <reason>` line. These refusals are not Jev refusals.
- **D7 Stop gate.** The Stop report gate returns without blocking and without
  advancing its state while a codex-review is running.
- **D8 Split halted packets.** When a subagent is halted or fails, its packet
  is split into smaller packets and dispatched again.

## Consequences

Installed files do not prove that Claude Code runs the guard or the Stop gate,
or that Codex honors the requested model and effort; the receipt's observed
fields and session evidence answer that. The retired agent files stay installed
because installation does not remove artifacts dropped from a manifest. Reviews
depend on Codex quota; the declared fallback keeps them possible without it.
