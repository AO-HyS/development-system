# Operator interface

Use either style in every prepared repository.

## Automatic

Describe the software goal normally. The router may identify the appropriate stage and proceed only as far as the request already authorizes. Recommendations never cross a human gate.

## Explicit

Invoke one phase directly:

1. `wayfinder` for optional large-scale discovery outside the normal lifecycle.
2. `grill-with-docs` for requirements, followed by a human gate.
3. `to-spec` for the spec and Local Visual Plan, followed by a human gate.
4. `to-tickets` for executable slices, followed by a human gate.
5. `flow-implement` for one named Implement Preview terminal slice; its implementation-review-correction loop is autonomous inside the authority already granted, while delivery state changes remain separately bounded.
6. `flow-code-review` for an independent review of an existing branch or pull request.

Codex presents these as `$` skill commands. Factory presents them as `/` commands. T3Code shares the Codex adapter and state namespace structurally; this release does not claim independent live T3Code command discovery or activation. The authorization boundaries remain the same.

Prepared repository adapters require the global `0.2.0` skill catalog to be synchronized and discovered by the active Codex or Factory harness. Adapter readiness alone is not proof that a skill is loaded or has influenced behavior.

Commit, push, pull request, preview, deploy, merge, release, and production occur only when the request and repository policy authorize the relevant state change. Merge, release, and production always require separate exact commands or requests after the final human review.
