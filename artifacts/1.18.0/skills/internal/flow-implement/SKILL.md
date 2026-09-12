---
name: flow-implement
description: Implement a requested software change through verification, corrections, and its authorized delivery endpoint.
---

# Implement a change

Recover the requested outcome, constraints, working surface and authorized
endpoint. Reuse settled decisions and repository context relevant to this change.
Follow-up corrections steer the whole task unless the user replaces it. Define
completion by observable behavior and delivery, not by producing a first diff.

For non-trivial repository work, use `coding-orchestration` for ownership,
delegation and verification. Reuse an already selected `orchestrate-work` method
instead of adding another execution loop. Clear work proceeds without another
planning or approval ceremony. A bounded worker executes its supplied packet.

For a stateful UI or routing change, preserve the relevant state owners and
transitions: drafts, selection, filters, focus, dismissal and permissions. Check
the affected transition early; two static endpoints do not establish continuity.
For a visual redesign, recover the approved assets and criteria through
`design-direction` before implementation. Refinements preserve the current identity.

Use checks that establish the changed behavior and required repository gates.
A new test is useful when it catches a named failure better than existing checks;
it is not a required file per edit. A regression claim needs evidence that
distinguishes the broken and corrected behavior. Preserve command exit codes,
resolve actual findings and rerun affected checks. Reuse still-valid evidence.
Continue through authorized implementation, verification and correction without
asking for another continuation message after the first pass.

For an on-screen outcome, use the repository's existing product-verification
capability to exercise the affected flow. Capture a useful baseline before edits
where possible; missing baseline evidence remains a declared gap. Invoke
`maintain-product-verification` only when that verification capability itself
needs maintenance. When visual quality is acceptance, `design-quality` owns
independent critique before `evidence-capture` packages final media. Record the
affected behavior with useful data and the intended role. A backend change with
no on-screen outcome uses relevant behavior checks without a visual workflow.

Finish every requested criterion and the installation/publication steps already
authorized. A missing authorization for a distinct external action does not stop
preparation or independent work. State partial or blocked work plainly. The final
response covers the complete outcome, checks, remaining gaps, candidate and
requested review link; code, Preview and production are separate claims.

For a requested standalone completion report or a durable media package, read
[completion-report.md](references/completion-report.md). Ordinary completion
uses the final response and useful evidence links without another document tool.
