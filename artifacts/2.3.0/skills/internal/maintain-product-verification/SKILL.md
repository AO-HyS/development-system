---
name: maintain-product-verification
description: Keep a project's verification skill and feature map honest - source readers per feature, one live pass driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill, "audit the verify skill", or when the Steward finds verification drift.
---

# Maintain product verification

Adapted from pstack `maintain-verification-skill` (cursor/plugins
`c86f349b102feb91f1966f8a6a60882a4e601b50`, MIT). Local changes: QuickE2E with
Jev for web drives, private evidence, and the Steward's write limits.

A feature map rots the moment the app changes. The unit of rigor is the feature:
every feature file gets source coverage and a live exercise.

## Outcomes

Say which:

- **clean**: every feature got source and live coverage; nothing to ship.
- **changed**: one PR of proven map, harness or doc corrections.
- **blocked**: coverage could not finish or a fix could not ship safely; say exactly why.

## Edit scope

Only the verification skill, its feature map and harness scripts. Never product
code: behavior the map describes that the app no longer does is either doc drift
(fix the map) or a product regression (report it, don't paper over it). When the
checkout belongs to another writer, write proposed corrections to
`$HOME/.development-system/private/verification/<run-id>/` instead.

## Pass

1. **Locate** the verification skill and feature map. None: stop and point at
   `create-product-verification`.
2. **Index hygiene:** fix missing, extra, duplicate or dead entries.
3. **Source wave:** one read-only subagent per feature, in parallel. Each
   explains how the feature works from source, flags likely drift with
   citations, and returns one live recipe. Children never drive or edit.
4. **Reconcile:** merge recipes into few app states; spot-check cited drift;
   look for user-facing surfaces missing from the map (with a concrete path).
5. **Live pass**, required even when source looks clean. The coordinator drives
   serially. Doctor before the first drive and after any failure; evidence
   survives every cleanup; nothing a drive started outlives it. A feature is
   `verified-unreachable` only with its concrete prerequisite and the route tried.
6. **Triage:** wrong description = doc drift (fix); working behavior the harness
   cannot drive = harness gap (fix and re-drive live); broken app = product gap
   (report, keep out of the PR).
7. **Ship or stop:** changed = one PR of proven corrections; clean or blocked =
   no PR, report coverage honestly.
