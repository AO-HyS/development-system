---
name: pstack-engineering
description: Apply PStack-derived tactics when repeated investigation, handoff drift or shared-state contention slows repository work.
---

Use as a tactics reference beneath `coding-orchestration`. Select the observed
bottleneck and read [tactics.md](references/tactics.md). Keep one accountable
owner for a coupled change; parallelize only independently verifiable work.

A handoff carries root/revision, decisions, exclusions, ownership, known state,
checks and completion. Reuse the decision record on resume rather than rebuilding
it from a long transcript. Treat completion as an event, not a reason for repeated
progress messages. Use a small script when it removes repeated tool decisions.

For visual work use `design-quality`; for capture use `evidence-capture`.
These are responsibilities in the existing lifecycle, not additional gates.
Upstream playbooks and model choices are references, not installed policy.
