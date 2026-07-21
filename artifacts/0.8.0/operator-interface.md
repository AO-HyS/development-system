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
5. `flow-implement` for one named Implement Preview terminal slice, ending at `ready-for-human`.
6. `flow-code-review` for an independent review of an existing branch or pull request.

Codex and T3Code present these as `$` skill commands. Factory presents them as `/` commands. The observable lifecycle and authorization boundaries are the same.

Merge, release, and production are always separate exact commands or requests after the final human review.
