# ADR 0044: Preserve terminal evidence and stable acceptance progress

Status: Accepted bounded runtime repairs; product acceptance remains separate.

## Context

A timed product run exposed three defects: changing QA evidence paths obscured
repeated acceptance failure, a Codex process could exit zero without a completed
turn or final response, and model-level usage completeness contradicted the
full-arm incomplete-usage count. The failed run and its evidence are retained.

## Decision

Key acceptance progress by the candidate and stable failed criterion IDs.
Changing evidence paths alone cannot create apparent progress. Keep the same
acceptance criteria, validation, review/QA gates and correction authority.

Require a completed native Codex turn and final response before treating an
exit-zero process as successful. Preserve incomplete-turn failure evidence and
any available usage; do not substitute empty output or synthetic completion.

Count incomplete usage at the model level consistently with full-arm accounting.
Partial reported usage remains useful evidence, but cannot certify complete
cost. Preserve pricing, known token counts and existing accounting boundaries.

## Release boundary

Extend exact commit bfd845704a28b9fdbd5911dad65c6e42bc82730b in an isolated 1.23.4
worktree. Create new immutable snapshots and manifest; retain all 41 managed
destinations and catalog 0.43.1 with 104 skills / 140 variants. Compatible 1.23.0 policy
and prices remain separately pinned. Verify the extracted package and isolated
upgrade/repair/rollback from active 1.23.2 before the authorized local contract-only
activation. Preserve all older packages, installed skills and user-owned source.
No remote publication, merge, deployment or product acceptance is implied.
