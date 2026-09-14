---
name: behavioral-evidence
description: Audit changed and new tests for observable value, enforce the reviewed test-change policy, and independently verify an accepted objective.
---

# Behavioral evidence

Tests are subordinate evidence. They demonstrate observable behavior through a
public interface; a green result, count or coverage percentage never overrides
the accepted objective.

## Test-change gate

The default policy is allowedChanges = []. A worker does not add, modify or
delete test files, change snapshots or generate one test per form or feature
until the parent closes a reviewed exception. The parent invokes
findTestPolicyViolations({root, baseRef, policyPath:
"config/test-change-policy.json"}) and receives a violation array. An
exception records path, SHA-256, reason, issue and reviewed content; an
authorized deletion records null SHA-256. Report the actual missing behavior
and smallest useful check when the policy leaves a gap. Do not widen test
scope independently and do not hide failures with skips, ignores, disables or
fake mocks.

For every changed or new test, classify it with evidence:

- behavioral: asserts externally observable behavior through a public
  interface; keep it;
- redundant: duplicates stronger existing coverage; name that coverage before
  deleting it;
- accidental: pins private structure or implementation names; delete or
  rewrite it against behavior;
- weakened: assertions, snapshots, fixtures or skips were changed so the run
  passes; reject it unless an objective-based review justifies the change.

Never delete a test without proving coverage elsewhere or intentional behavior
removal. Test telemetry is supporting evidence and must map to the behavior it
proves.

## Independent verification

The implementer's tests are never the only evidence. A context-isolated
reviewer derives the oracle from the accepted objective and public interface,
rejects weakened or narrowed runs, and reports the verdict against every
acceptance criterion, including unproven items. Independent review returns the
actual evidence gap; it does not invent a test per form or feature.

Lines of code, file counts, test-to-runtime ratios, identifier length and
minified formatting are not quality targets. Complexity signals may inform
diagnosis but cannot fail a run.

## Output

Return each test's disposition (kept, strengthened, deleted with coverage or
removed with behavior), the independent verdict, every weakening or self-
grading finding, the policy receipt and any unproven behavior. This skill is
read-only and never edits.
