# Development System contract 1.3.0

Version 1.3.0 retains every 1.2.0 lifecycle, authorization, adapter, benchmark, repository-preparation, delivery, measurement, privacy, installation, rollback, paid-tool, provider-readiness, Working Backwards gate, publication, and T3 handoff guarantee. Published 1.2.0 bytes remain unchanged.

This version makes Working Backwards operational in HumanLayer as a progressive definition workflow:

- Accept a short natural-language feature idea and begin with one Future Customer Story artifact; never require the operator to construct a structured mega-prompt.
- Use HumanLayer Freeform as the native carrier because the installed HumanLayer API exposes four fixed workflow types and no custom workflow registry. Store the six definition documents as numbered Markdown artifacts under the task directory so HumanLayer can display, version, and comment on them.
- Advance one artifact at a time through Future Customer Story, Research Questions, Research Report, Product Contract, Technical Contract, Implementation Map, and a private T3 Handoff.
- Ask one high-leverage question per message while an artifact is active. Feedback revises that artifact; only an unambiguous live approval at its checkpoint advances.
- Persist ordinary document acceptances separately from exactly three formal definition receipts. Product Contract, Technical Contract, and Implementation Map approvals map to the canonical operations from 1.2.0.
- Bind every acceptance to the exact artifact hash and formal receipts to normalized repository identity and revision. Artifact drift returns the workflow to the earliest changed document and invalidates its descendants.
- Reject negated, combined, quoted, historical, or ambiguous approval language. HumanLayer comments and task state remain feedback and cannot grant authority.
- Keep ticket publication and implementation outside this workflow. Store the terminal T3 handoff only in private Development System HOME, bound to the canonical gate receipt file, with `implementationAuthorized: false`; Implement Preview remains the only implementation trigger.

Skill catalog 0.7.0 updates `drive-development-flow` so natural requests for Amazon-style Working Backwards, a future customer story, PRFAQ, or progressive HumanLayer planning route automatically to the updated `working-backwards` skill. Codex and Factory receive explicit mirrors; T3 Code inherits the Codex surface. Structural installation still does not prove live loading or behavioral influence.
