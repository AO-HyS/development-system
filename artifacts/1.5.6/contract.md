# Development System Contract 1.5.6

Version 1.5.6 retains every guarantee and authorization boundary of 1.5.5. Published 1.5.0 through 1.5.5 bytes remain unchanged.

## Readable diagrams and complete implementation reporting

- Treat Mermaid legibility as behavioral acceptance, not SVG existence. A realistically wide technical diagram must remain readable in expanded and fullscreen states.
- Fit diagrams to the available viewport only while labels remain legible. When fitting would turn a wide diagram into a thumbnail, preserve a readable minimum scale and expose the rest through pan and scroll.
- Keep inline, expanded, fullscreen, fit, reset, zoom, wheel, drag, and pinch behavior coherent in the offline `file://` Reader without network access or a server.
- Final implementation reports must render explicitly requested prompts and handoffs as reviewable content, not links alone.
- Final reports must include a known-issues ledger whose disposition distinguishes fixed, remaining, external-authorization-blocked, and destructive-authorization-blocked work.

## Product convergence workstreams

- Preserve four named workstreams from Technical Grill through Product Contract, Technical Contract, Implementation Map, Linear tickets, rollout, Check-in evidence, and the final Reader: Product and agent architecture, Convex backend, Observability, and Release Train.
- A workstream may conclude that no change is required only when current evidence and acceptance checks support that conclusion; it may not disappear inside a generic repository audit.
- Until native product-specific Linear teams and keys are explicitly authorized and created, every new or updated issue must use the canonical product project and visible product prefix. Reports must not present a bare shared `AOH-n` key as a complete product identifier.

## Bounded attention quality

- Development Steward selects at most one actionable item per primary repository before selecting a second item from any repository, preserving five-product diversity in the bounded Check-in surface.
- Linear Hygiene remains read-only and cannot claim cleanup from an installed auditor. Live create, update, move, close, and delete operations retain their exact external-write and destructive-cleanup authorization boundaries.
