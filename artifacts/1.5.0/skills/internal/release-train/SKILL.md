---
name: release-train
description: Plan and execute a fast provider-aware release from changed surfaces through focused validation, preview, data gates, promotion, production smoke, and rollback evidence. Use for repository release or production work.
---

# Release Train v2

Build the release graph before running jobs:

```text
development-system release-train-v2 --input <release-plan.json> --json
```

The input declares the exact revision, changed surfaces, stack-selected checks, provider capabilities, existing build provenance, data operations, and already observed evidence. The output selects only applicable work and never contacts a provider.

## Execute the selected graph

1. Run changed validation once.
2. Run integrated certification only at its repo gate.
3. Reuse an exact revision-bound build when the provider accepts it; record a provider-forced rebuild otherwise.
4. Keep preview, data operations, promotion, and production smoke as separate measured phases.
5. Deduplicate checks by evidence key. A workflow and deploy script cannot both own the same audit.
6. Isolate migration and backfill dry runs, ordering, rollback, and high-risk authorization from ordinary deploy work.
7. A credential failure blocks only that provider lane while shared evidence and healthy lanes continue.

Git or CI success never proves preview or production. Claim a deployed state only from exact-revision provider evidence, a destination, smoke evidence, and a rollback handle. A repository without a deploy contract is code-only and reports an explicit skip.

Merge, release, production, data mutation, paid activation, and destructive work retain separate exact authorization. Return phase timings and skip reasons without copying provider logs or secrets.
