# Branch-first repository workflow

User decision: 2026-09-23. Applies to normal work and model experiments.

## Start and resume

- Work in the repository's canonical checkout. One active task per repository
  is the default. A new worktree requires the user's explicit request for that
  particular task; a benchmark, dirty checkout, or desire for isolation is not
  implicit permission to create one. Do not substitute another clone.
- At the start, report the absolute root, branch, canonical/linked checkout
  identity, current task, and any existing owner or pending changes.
- For a new task, inspect Git status and existing continuity first. From a clean
  canonical checkout, fetch the remote, switch to `develop`, update it using
  `git pull --ff-only`, and create a descriptive task branch from it.
- If pending changes or another task exist, preserve and reconcile that work
  before starting a different task. Do not reset, clean, stash, move changes,
  switch branches forcibly, or create a worktree to avoid this decision.
- If `develop` does not exist or cannot be advanced safely, report that specific
  condition; do not invent a replacement base or overwrite branch history.
- Finish and verify the task, commit and push its branch within the authorized
  scope. Before the next new task, return to `develop` and repeat. Preserve the
  task branch and any open PR; push does not imply merge or production release.
- On resume, continue the existing task branch and valid evidence. Do not
  recreate the environment, experiment, or task simply because the chat resumed.

## Task and experiment boundaries

- Execute the task that was described, in its actual product repository. A
  NutriPlan experiment uses a small new NutriPlan feature and its normal backend,
  environment, and verification workflow. Do not substitute a generic project.
- Keep experiments short and representative. Record the agreed task, variants,
  repetitions, fixed roles, acceptance checks, and time limit before running.
  Do not add variants or repetitions or expand the time limit without direction.
- Give each experiment/variant fresh agent sessions. Do not reuse agents,
  conversation histories, or candidate edits from another variant or repository.
  Reuse established setup instructions and tools, not another candidate's answer.
- Run variants sequentially unless parallel execution was explicitly requested.
  Preserve each result before moving on. An interrupted comparison resumes only
  its pending work; previous attempts remain labeled valid, invalid, or incomplete.
- Record process ownership and stop the task's processes at its terminal state.
  Do not launch a background continuation after a pause or steering instruction.

## Visible continuity and storage

- Maintain one small `docs/current-work.md` in the canonical repository with
  objective, status, branch/root, completed/pending work, evidence locations,
  owned active processes, and the next action. Git is authoritative for branch
  and code state; verify the note rather than treating its snapshot as live.
- Update it when the task changes, pauses, fails, or hands off. Keep credentials,
  private transcripts, and product data out of the note and public reports.
- Do not multiply workspaces, dependency installations, or reports on resume.
  Inventory generated files and their owners before cleanup. Preserve dirty
  code, results, and recovery evidence; disk usage alone never authorizes their
  deletion. Report logical/allocated sizes separately from actual free space.
- These are operating instructions, not a new per-tool hook or execution gate.
