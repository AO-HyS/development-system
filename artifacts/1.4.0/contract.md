# Development System Contract 1.4.0

Version 1.4.0 retains every 1.3.0 lifecycle, authorization, adapter, benchmark, repository-preparation, delivery, measurement, privacy, installation, rollback, paid-tool, provider-readiness, Working Backwards gate, publication, and T3 handoff guarantee. Published 1.3.0 bytes remain unchanged.

## T3-native Working Backwards amendment

- Make T3 Code the complete Working Backwards surface. An explicit `working-backwards` invocation plus an ordinary feature sentence starts the workflow; HumanLayer is not a prerequisite.
- Store canonical draft artifacts as numbered Markdown outside Git under private Development System HOME, defaulting to `~/.development-system/private/working-backwards/<repository-slug>-<feature-slug>/`.
- Generate one local static `index.html` from a reusable plain JSON Reader model derived from canonical Markdown and workflow state. HTML is the default human format, never a second source of truth or a separate planning product.
- Render local, escaped Mermaid flowcharts, explicit-data bar/line charts with accessible table fallbacks, semantic tables and callouts, and filename-aware code/diff blocks directly from canonical Markdown. The Reader remains offline and sends no private planning content to CDNs or third parties.
- Make the Reader document-first: expose a compact artifact rail, one continuous `760–900px` technical document, an active in-page outline, restrained metadata, the next action, and secondary mobile navigation.
- Treat Mermaid as first-class review evidence with inline, expanded, and fullscreen states plus zoom, fit, copy, source, keyboard, touch, and textual fallback behavior.
- Work on exactly one concise artifact at a time, ask one high-leverage question only when its answer changes the active document, persist settled answers, and announce the next document immediately after approval.
- Preserve the customer story, research questions, research report, Product Contract, Technical Contract, Implementation Map, and private T3 handoff sequence.
- Preserve exactly three formal, hash-bound gates for Product Contract, Technical Contract, and Implementation Map. Repository or artifact drift invalidates descendants.
- Bind the private handoff to all three receipts, the exact repository revision, the approved implementation map, and its declared first executable slice.
- Keep `implementationAuthorized: false`. Implement Preview remains the only trigger for implementation; publication and promotion boundaries remain operation-specific and non-transitive.
