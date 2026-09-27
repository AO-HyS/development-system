# ADR 0062: Stable review rounds, advisory Jev and fixed report sections

## Status

Accepted. Whether Claude Code runs the installed hooks and reviewers follow the
previous-findings instruction remains separate operational evidence.

## Context

The NutriPlan rescue of 2026-09-27 repeated failures that the 1.34.x runtime
allowed:

- codex-review keyed rounds on the first 120 characters of the Objective, so
  rewording reset the count.
- It counted a round when Codex spawned, so a quota or transport failure counted
  as a review.
- It reserved slots without exclusion (the ADR 0061 known gap).
- Each round started without the previous findings, so findings were re-raised
  or silently dropped.
- The roster guard ran Jev in gate mode although ADR 0055 and the operator
  treat Jev as advice.
- The guard guessed owned paths from prose.
- Writers ran `git add -A` and commit gates that staged each other's files.
- A writer restructured code so a React Doctor rule stopped recognizing it.
- Writer holds expired silently.
- Completion reports came back table-heavy and did not lead with the result.

## Decision

Contract 1.35.0 with catalog 0.53.0:

- **D1 Task identity.** Review packets need a `Task-Id: <slug>` line. Rounds are
  counted per (Task-Id, repository root), so rewording keeps the count. Rows
  written before 1.35.0 are ignored.
- **D2 Complete rounds.** A round counts only when Codex exits 0 and
  findings.md ends with `Verdict: merge` or `Verdict: do not merge`. Other
  endings go to attempts.jsonl. The receipt records the outcome, the verdict
  and the Task-Id. The `Round rationale:` rule counts complete rounds only. A
  complete round is not approval.
- **D3 Reservation lock.** The scan of live markers, the cap check and the
  marker write run under a lock directory with an owner file (pid and token).
  A lock is reclaimed only when its owner is dead, never by age alone. It is
  released only by its owner, and a refusal releases it before exiting.
- **D4 Previous findings.** When the task has a complete earlier round, its
  findings are copied into the new run as previous-findings.md, after a hash
  check. The reviewer marks each one fixed, still open or dismissed. `--out`
  must be a new or empty directory.
- **D5 Jev advisory.** `jev.mode` is `advisory` (policy 2026-09-27.1). Jev
  classifies each writer or planner packet and the guard records the route
  without refusing.
- **D6 Structured owned paths.** `Owned paths:` takes one path per entry,
  either comma-separated or as `- path` lines. The only globs are `*` and a
  trailing `/**`. Prose is denied and the denial shows the format.
- **D7 Writer Git boundary.** The six writer roles run a `writer-bash` hook
  that denies Git commands that change the index, the history or the working
  tree. The coordinator stages and commits. This hook stops the habit; it is not
  a security boundary.
- **D8 Lint honesty.** Writers never restructure code so a lint or React Doctor
  rule stops recognizing it; they report a suspected false positive.
- **D9 Hold expiry.** A writer hold that expires is logged once as
  `writer-hold-expired`.
- **D10 Report sections.** A completion document opens with at most 600
  characters, followed by `## Qué se hizo`, `## Hallazgos`, `## Qué sigue` and
  `## Detalle` in that order. In English the sections are What was done,
  Findings, What's next and Detail. Every document kind rejects tables unless
  `allowTables: true`. The delivery recap uses the English sections.
  flow-implement, coding-orchestration and working-backwards move to 1.35.0
  copies. A chat-only request produces no document and no tunnel.

## Consequences

- Review packets must carry a Task-Id.
- A failed Codex run no longer uses up a round.
- Writers report changed files instead of committing them.
- Jev can no longer block a dispatch; only the path-clash, model and role
  checks deny.
- Report packets that used the old Veredicto sections or tables fail until they
  are rewritten.
- 1.34.x artifacts stay published and unchanged.
- Known gap (next version): if the PostToolUse update cannot take the
  active-writer lock within 2 s, a background writer's hold keeps no agent id
  and expires after 5 minutes like a foreground hold.

## Amendment 1.35.1

The pin review of the product rollout found that orchestrate-work, still at its
1.33.0 copy, prescribed Veredicto and the other retired sections, which the
1.35.0 validator rejects. Contract 1.35.1 with catalog 0.53.1 moves it to a copy
with the four sections, and the release build fails when any installed
instruction names a retired section.
