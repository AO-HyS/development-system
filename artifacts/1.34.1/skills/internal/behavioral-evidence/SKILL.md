---
name: behavioral-evidence
description: Independently verify an accepted objective with real evidence (computer use, browser, the repository's verification CLI) and confirm the change adds no automated tests.
---

# Behavioral evidence

Real verification is the evidence. Computer use, the browser and the
repository's verification CLI and feature map observe the accepted behavior
through its public interface; a green check, count or coverage percentage never
overrides the accepted objective.

## No automated tests

The change adds no automated tests, test runner configuration, test scripts,
test dependencies or CI test steps. Run
`development-system check-no-tests --root <repository> --json` and report its
findings; automated tests found in the change are deleted, not kept or
strengthened. Report the actual missing behavior and the smallest real
observation that would prove it instead of proposing a test.

## Independent verification

The implementer's own checks are never the only evidence. A context-isolated
reviewer derives the oracle from the accepted objective and public interface,
observes the behavior for real (computer use, the browser, the repository's
verification CLI), rejects narrowed or unsupported runs, and reports the verdict
against every acceptance criterion, including unproven items. Independent
review returns the actual evidence gap; it does not invent a check per form or
feature.

Lines of code, file counts, identifier length and minified formatting are not
quality targets. Complexity signals may inform diagnosis but cannot fail a run.

## Output

Return the check-no-tests result, each acceptance criterion with its real
evidence (passed, failed or not reached), the independent verdict, every
self-grading finding and any unproven behavior. This skill is read-only and
never edits.
