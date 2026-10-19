# ADR 0073: weekly learning controls

Status: accepted direction; candidate contract 2.6.0 / catalog 0.71.0.

The 2026-10-18 weekly review found repeated mistakes logged under near-duplicate
ids and without a repository, merges to develop without recorded behavioral
evidence, threads that kept growing until compaction, a global install during
active product runs, helper files written to `/tmp` after that was banned, and
no warning before a Codex weekly limit ran out. The owner accepted the action
plan (cross-reviewed, plan-r3) and asked for controls in code before rules.

- Mistake log: `mistake add` requires `--repository` (canonical checkout name),
  refuses an id resembling an existing one unless `--new-id`, and accepts
  `--cause`/`--topic`. `mistake annotate` labels old lines through a hash of
  the exact line; a tampered line drops its annotation. `list --by cause`
  groups recurrences; counts without annotations equal 2.5.0.
- Evidence: `evidence record` writes a hashed receipt per PR, verified head
  and deployed revision with allowed, denied and effects. States are
  missing, ok, failed, incomplete, stale, waived and nonvisual. An owner waiver
  («pásatela») counts only when quoted verbatim in the PR body. Prose-only
  documentation changes need no receipt.
- Merge gate: `pr-review-status <pr> --gate` writes a two-hour gate for the
  head when evidence, review and Codex are clean. Guard policy 2.2.0 refuses
  `gh pr merge` without `--match-head-commit` and a passing gate for that head,
  and refuses the REST merge endpoint. Known gap: MCP merge tools and the web
  UI do not pass through the hook.
- Temporary directories: the guard blocks writes into `/tmp`, `/private/tmp`,
  `/var/tmp` and `$TMPDIR`, including through symlinks; reads stay allowed.
- Handoff: the Stop report gate asks once per session for a handoff at 40
  runs, 1500 items or 75% of the context window (or of the observed
  compaction point). `thread-health` reports the same size for both hosts.
- Active runs: setup, update and install read T3 state read-only and stop
  unless every thread's latest run is closed; `--during-active-runs <who>`
  continues and records who accepted, without granting authority.
- Codex quota: doctor reports the latest weekly-window observation per
  session account across the `.codex*` homes, with freshness, and warns at
  80%. It never changes `ok`.

Installation, merge-gate probes and isolated-HOME runs are verification;
live adoption by product threads needs its own observation.
