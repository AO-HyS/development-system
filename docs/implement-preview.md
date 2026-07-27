# Implement Preview execution plan

`implement-preview` consumes one already-approved terminal slice and a private local JSON plan. It can run implementation, focused checks, validation, risk-appropriate review, corrections, proportional QA, commit, push, pull-request creation, and preview publication. It cannot run merge, release, or production. A full repository suite is never implied; the user must authorize it explicitly for the current run.

The ordinary plan has one writer. Tiny changes target functional evidence in five minutes and stop for a process audit above the ten-minute exceptional ceiling. Multiple-ticket worktrees require an explicit `$work-multiple` request: overlapping/dependent tickets share a sequential lane, disjoint lanes may run in parallel, and all lanes integrate into one candidate.

```json
{
  "schemaVersion": 1,
  "targetRepository": "/absolute/path/to/repository",
  "terminalSlice": "The exact slice approved by Implement Preview",
  "writer": { "surface": "codex", "role": "implementer" },
  "reviewers": [
    { "lane": "intent", "surface": "factory", "role": "adversarial-reviewer" },
    { "lane": "standards", "surface": "codex", "role": "reviewer" }
  ],
  "tdd": { "selection": "required", "reason": "contract logic", "evidence": "acceptance seam" },
  "qa": { "level": "omitted", "reason": "internal CLI", "alternativeEvidence": "CLI scenario" },
  "visualPlan": { "title": "Decision surface", "sections": ["Scope", "Evidence", "Preview"] },
  "manualChecklist": ["Inspect PR", "Open preview", "Authorize merge separately"],
  "execution": {
    "implement": { "command": "codex", "args": ["exec", "..."] },
    "test": { "command": "pnpm", "args": ["test"] },
    "validate": { "command": "pnpm", "args": ["verify"] },
    "review": {
      "intent": { "command": "droid", "args": ["exec", "..."] },
      "standards": { "command": "codex", "args": ["exec", "review", "..."] }
    },
    "correct": { "command": "codex", "args": ["exec", "..."] },
    "commit": { "command": "git", "args": ["commit", "..."] },
    "push": { "command": "git", "args": ["push", "..."] },
    "open_pr": { "command": "gh", "args": ["pr", "create", "..."] },
    "publish_preview": { "command": "pnpm", "args": ["deploy:preview"] }
  }
}
```

`work-multiple` requires at least two tickets with acceptance criteria,
surfaces, and blockers. It owns lane/worktree grouping, focused verification,
two isolated integrated reviews, measurement, and the authorization stop.

Commands that return structured evidence should print a final JSON object. Review commands return `{"ok":true,"findings":[...]}` with `blocker`, `high`, `medium`, or `low` severity. Pull-request and preview commands return `{"ok":true,"url":"..."}`. Repeated blocker/high fingerprints pause the loop as non-convergent; they never become success.

Run only after the lifecycle state has reached `delivery_authorized`:

```sh
./bin/development-system implement-preview \
  --workflow AOH-145 \
  --plan /private/path/implement-preview.json \
  --home /isolated/or/operator/home
```

The Local Visual Plan and Recap are written with private permissions under `.development-system/private/<workflow>/`, outside the target repository and therefore outside the pull request. The recap links the PR and preview, shows failures/corrections and risk evidence, and ends at `ready-for-human` with no promotion authorization.
