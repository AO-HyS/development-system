# Three-pilot rollout and recovery playbook

## Scope freeze

Only NutriPlan, The Barber Central, and AOHYS participate. Escuela 360 and every other repository remain unready and untouched. Do not copy product instructions, design language, commands, release policy, or data between pilots.

## Per-repository sequence

1. Record branch, base revision, dirty state, product stack, product-owned commands, release policy, design files, and existing preview path.
2. Run `audit-repository --json` and prove `externalSideEffects` is empty.
3. Resolve only blocking process-integration findings. Preserve explicit exclusions, external tracker references, Impeccable integration, and product-owned release/design files.
4. Run `normalize-repository --confirm normalize --json`. Its mutation scope is limited to `.development-system/repository.json`, `.codex/development-system/repository.md`, and `.factory/development-system/repository.md`.
5. Re-run audit. Structural `prepared` status is necessary but not sufficient for operational acceptance.
6. Exercise the lifecycle and manual boundaries through the Codex adapter, T3Code client surface, and Factory equivalent. Capture live skill/instruction influence only from fingerprint- and path-bound read-only observations.
7. Run the repository's real review, validation, QA, and preview checks. Record the real commands and their exit status; a green label without exercised output is not evidence.
8. Commit only rollout-owned files, push a feature branch, open a PR, obtain a reviewable preview, and generate the private Local Visual Recap.
9. Stop at `ready-for-human`. Do not merge, release, synchronize production HOME, or deploy production.

## Recovery

- Before mutation, record the exact product base commit and the absence or prior bytes of every managed file.
- Repository normalization is recovered through the feature branch: close the PR or revert the rollout commit. Do not delete unrelated local files.
- Canonical HOME installation uses integrity-checked snapshots and `development-system rollback`; skill synchronization uses `rollback-skills`.
- A failed live observation, review, QA, or preview keeps the pilot unready. Correct and rerun only the failed lane; retain first-failure evidence.
- A conflicting dirty worktree is not cleaned destructively. Commit only rollout-owned paths and leave pre-existing work untouched.

## Candidate decision

The integrated candidate is reviewable only when all three pilots have comparable evidence, no blocker/high review findings, green required checks, a PR and preview, explicit residual risks, and a rollback path. The final decision is either `ready-for-human` or `blocked`; it is never an implicit promotion authorization.
