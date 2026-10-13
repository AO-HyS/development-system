---
name: correct
description: Turn confirmed agent mistakes into architecture, type or lint protections. Use after a correction or retrospective identifies a concrete failure to prevent.
---

# Correct

Adapted from Poteto's PStack. See [provenance and adaptations](UPSTREAM.md)
when updating this skill.

## Establish the incident

Use the correction or existing retrospective first. Read only the commits,
review comments and current code needed to confirm its cause and resolution.
One confirmed mistake is enough; prioritize recurring or consequential causes.
Separate a repaired instance from the class of mistakes still possible. A
reviewer's allegation or style preference alone is not a confirmed defect.

Preserve the current task's authorization, owned paths and accepted sequence.
For diagnosis-only work, return proposed protections and evidence. When fixes
are authorized, continue through the affected verification and corrections.
Use the existing coding-orchestration workflow for nontrivial implementation.

## Choose the strongest useful protection

1. **Architecture:** give state one owner, derive synchronized lists from one
   source, and expose one supported operation. Trace callers and compatibility
   before retiring another path; preserve unrelated work and data.
2. **Types:** express the invariant so an invalid combination cannot be passed
   through the supported API. Explain escape hatches and runtime limits.
3. **Lint or a deterministic check:** reject a faithfully detectable mistake.
   The diagnostic names the replacement function, type or pattern. Check
   existing rules and their actual execution first: repair configuration or
   diagnostic delivery when a rule already covers the incident. An AST pattern
   must handle the syntax it claims to cover without rejecting valid callers.
4. **Guidance:** reserve prose for decisions requiring judgment. If no static
   protection can express a property, state that limit and name the real
   behavior verification that covers it.

Keep equivalent enforcement during the approved Oxlint migration. A legacy
baseline may temporarily reject only new occurrences; record its remaining
debt and coverage rather than claiming the class eliminated.

## Demonstrate and retain

Check the protection against the exact historical bad pattern and its valid
correction using existing lint/type/verification commands and disposable local
inputs when needed. Observe the diagnostic and its absence for valid code.
Do not create or run automated tests or evals. Relevant product behavior still
needs the repository's real verification; a static check is not UI acceptance.

Ensure the same rule configuration reaches the editor, agent completion check
and required commit/CI path. Report any unobserved delivery separately.
Record the incident and enforcing mechanism in the existing mistake log; reuse
existing evidence and avoid a second instruction inventory. Exceptions retain
their reason and bounded scope under the repository policy. Commit or release
only within the retained operation-specific authority.

Return each confirmed cause, evidence, selected protection, why a higher level
was unsuitable, actual checks and remaining gaps. Prefer one concrete protected
class over a speculative repository-wide rewrite.
