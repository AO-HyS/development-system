# Implement Preview execution plan

`implement-preview` consumes one already-approved terminal slice and a private local JSON plan. It can run implementation, focused checks, validation, risk-appropriate review, corrections, proportional QA, commit, push, pull-request creation, and preview publication. It cannot run merge, release, or production. A full repository suite is never implied; the user must authorize it explicitly for the current run.

The ordinary plan has one writer. Tiny changes target functional evidence in five minutes and stop for a process audit above the ten-minute exceptional ceiling. Multiple-ticket worktrees require an explicit `$work-multiple` request: overlapping/dependent tickets share a sequential lane, disjoint lanes may run in parallel, and all lanes integrate into one change.

```json
{
  "schemaVersion": 2,
  "targetRepository": "/absolute/path/to/repository",
  "terminalSlice": "The exact slice approved by Implement Preview",
  "writer": { "surface": "codex", "role": "implementer" },
  "reviewers": [
    { "lane": "intent", "surface": "factory", "role": "adversarial-reviewer" },
    { "lane": "standards", "surface": "codex", "role": "reviewer" }
  ],
  "tdd": { "selection": "required", "reason": "contract logic", "evidence": "acceptance seam" },
  "qa": { "level": "omitted", "reason": "internal CLI", "alternativeEvidence": "CLI scenario" },
  "providerReadiness": {
    "required": true,
    "reason": "preview environment contract changed",
    "surfaces": ["environment"]
  },
  "visualPlan": { "title": "Decision surface", "sections": ["Scope", "Evidence", "Preview"] },
  "manualChecklist": ["Inspect PR", "Open preview", "Authorize merge separately"],
  "execution": {
    "implement": { "command": "codex", "args": ["exec", "..."] },
    "test": { "command": "pnpm", "args": ["test"] },
    "changed_validation": { "command": "pnpm", "args": ["quality:changed"] },
    "review": {
      "intent": { "command": "droid", "args": ["exec", "..."] },
      "standards": { "command": "codex", "args": ["exec", "review", "..."] }
    },
    "correct": { "command": "codex", "args": ["exec", "..."] },
    "commit": { "command": "commit-wrapper", "args": [] },
    "full_certification": { "command": "full-certification-wrapper", "args": [] },
    "provider_readiness": { "command": "provider-readiness-wrapper", "args": [] },
    "push": { "command": "push-wrapper", "args": [] },
    "open_pr": { "command": "pull-request-wrapper", "args": [] },
    "publish_preview": { "command": "preview-wrapper", "args": [] }
  }
}
```

`work-multiple` requires at least two tickets with acceptance criteria,
surfaces, and blockers. It owns lane/worktree grouping, focused verification,
two isolated integrated reviews, measurement, and the authorization stop.

Commands that return structured evidence should print a final JSON object. Review commands return `{"ok":true,"findings":[...]}` with `blocker`, `high`, `medium`, or `low` severity. Certification and provider readiness return `certified:true` or `ready:true`; pull-request and preview commands return their native `url`. Git supplies repository continuity, so wrappers do not transcribe SHAs between steps. Repeated blocker/high fingerprints pause the loop as non-convergent; they never become success.

Schema version 1 remains readable for existing private plans. New plans use version 2: ordinary implementation and every correction run `changed_validation`; full certification runs exactly once after commit; provider readiness runs before push only when the plan maps an affected auth, data, migration, seed, role, or environment surface; and `develop` publishes one shared branch preview. Git owns commit continuity, so publication steps do not copy or compare SHAs.

Run only after the lifecycle state has reached `delivery_authorized`:

```sh
./bin/development-system implement-preview \
  --workflow AOH-145 \
  --plan /private/path/implement-preview.json \
  --home /isolated/or/operator/home
```

The Local Visual Plan and Recap are written with private permissions under `.development-system/private/<workflow>/`, outside the target repository and therefore outside the pull request. The recap links the PR and preview, shows failures/corrections and risk evidence, and ends at `ready-for-human` with no promotion authorization.
