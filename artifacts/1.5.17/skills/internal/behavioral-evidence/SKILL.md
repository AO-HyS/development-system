---
name: behavioral-evidence
description: Audit changed and new tests for behavioral value, reject weakened assertions or snapshots, and independently verify a diff against the accepted objective's public interface. Explicit invocation or deterministic-plan selection only; read-only; never the implementer grading its own work.
---

# Behavioral Evidence

Tests are subordinate evidence. They demonstrate observable behavior; they
never override the objective or the observable product behavior, and a green
result alone justifies nothing.

## Test-value review

For every changed or new test, classify it with evidence:

- `behavioral`: asserts externally observable behavior through a public interface; keep.
- `redundant`: duplicates stronger existing coverage of the same behavior; delete only after naming the stronger coverage.
- `accidental`: pins implementation accidents, private structure, or internal names; delete or rewrite against observable behavior.
- `weakened`: an existing test whose assertions, snapshots, fixtures, or skips were changed so the run passes.

Rules:

- A weakened test, updated snapshot, or newly added private-structure coupling
  is rejected unless the diff supplies an observable-behavior justification
  that survives review on the objective's terms.
- Never delete a test without proving its behavior is covered elsewhere or the
  behavior was intentionally removed as part of the accepted objective.
- Test counts and coverage totals are supporting telemetry; map them to the
  behavior they prove instead of treating them as goals.

## Independent verification

The implementation writer's own tests are never the only evidence.
Independent review and verification must:

1. Derive the oracle from the accepted objective and the public interface,
   not from the implementation's conclusions, internal names, or the diff's
   narrative.
2. Use context isolated from the implementation session; a reviewer sharing
   the implementer's reasoning is not independent.
3. Reject green runs produced by weakened assertions, relaxed snapshots,
   skipped checks, or narrowed scope, and report each as a finding.
4. Report the verdict against the acceptance criteria exactly as written
   before implementation, including anything unproven.

Lines of code, file counts, test-to-runtime line ratios, identifier length,
and minified or compressed formatting are excluded as quality targets and can
never fail a run. Complexity signals are diagnostic evidence only.

## Output

Return the per-test disposition (kept, strengthened, deleted with coverage,
removed with behavior), the independent verdict against the objective, and
every weakening or self-grading finding. Read-only: this skill never edits.
