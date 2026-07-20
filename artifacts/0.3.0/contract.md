# AOHYS Development System contract

Contract version: `0.3.0`

## Lifecycle state machine

The normal lifecycle is observable and persisted per workflow. A recommendation never changes state or grants authority. Wayfinder is outside the normal lifecycle and can be recorded only from Alejandro's explicit invocation.

The normal persisted stages are:

1. `grill-with-docs` / requirements in progress;
2. requirements approved;
3. spec plus Local Visual Plan ready;
4. spec plus plan approved;
5. tickets ready;
6. tickets approved;
7. Implement Preview authorized for one named terminal slice;
8. pre-release evidence ready for the final human gate.

Natural-language requests map to exact transition records. Every record includes the original request, operation, authorization source, prior stage, next stage, and timestamp. Negated, ambiguous, and out-of-order manual transitions are denied without persistence or external side effects.

## Operation-specific authorization

Implement Preview authorizes only the named terminal slice and its delivery loop: implementation, edits, tests, validation, review, correction, proportional QA, commits, push, pull request, preview, PR updates, and recap. Pre-release cannot become ready until evidence records implementation, tests, validation, review, QA, commit, push, PR, and preview. It does not authorize merge, release, production, paid activation, or destructive operations.

Merge, release, production, paid activation, and destructive operations each require a separate explicit authorization after pre-release evidence is ready. Each grant is exact and one-shot; consuming one operation never authorizes another operation or a later repetition.

## Skill catalog

The canonical `0.2.0` skill catalog remains pinned by repository, exact commit, upstream path, folder hash, logical name, physical destination, harness, and mirror or adapter relationship. T3Code consumes the Codex surface and does not create a third physical copy.

Byte-identical Codex and Factory installations are declared mirrors of one logical skill. Divergent content is valid only for named harness adapters that share an explicit observable contract.

## Operational evidence

Lifecycle acceptance scenarios inspect only observable stage, requested or denied transition, external side effects, evidence, authorization consumption, and terminal state. They prove that recommendations and manual-only stages remain inert before an explicit trigger.

Skill evidence continues to report `exists`, `discovered`, `catalogued`, `loadable`, `loaded`, and `influenced` independently. File copy, discovery metadata, or catalog count never proves runtime loading or influence.

## Reversibility and boundary

Lifecycle state is stored separately from installation snapshots under the selected isolated HOME. The lifecycle Interface refuses unsafe symlink paths and invalid persisted schemas. Published contract artifacts remain immutable and installation rollback continues to restore only manifest-declared bytes.

The lifecycle module records and enforces authorization; harness-specific execution adapters remain a separate implementation slice. No lifecycle request itself merges, releases, deploys to production, activates paid infrastructure, or performs destructive cleanup without the exact operation grant.
