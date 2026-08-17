---
name: convex-guardian
description: Produce a fast, deterministic, read-only Convex review with prioritized findings and focused checks for security, performance, cost, official components, and storage boundaries.
---

# Convex Guardian

Use this skill when a repository declares the `convex` capability and changed
surfaces include Convex schema, functions, subscriptions, scheduling, storage,
or data operations. It reviews evidence; it never executes a live query,
mutation, action, migration, backfill, scheduled function, or provider write.

## Collect concrete evidence

Build a normalized packet for `auditConvexGuardian` from source and existing
read-only test or runtime evidence. Give every item a stable id and, when
available, an exact path, line, and evidence statement. Inventory:

- public and internal queries, mutations, actions, and HTTP actions;
- authorization plus argument and return validators at every public boundary;
- index choice and field order, pagination, maximum result bounds, and broad
  reactive subscriptions or invalidations;
- shared-document hotspots, transaction fanout, action boundaries, scheduled
  work, idempotency, migrations, backfills, and observed function limits;
- custom infrastructure with a verified current official alternative such as a
  Component, Workpool, Workflow, or Agents capability;
- storage kind, current provider, and evidence for whether Cloudflare is a real
  fit. Domain records and relationships remain in Convex.

Do not turn missing evidence into a pass. Use `unprovenEvidence`; do not infer
authorization, boundedness, component fit, or storage economics from a file
name or an installed package.

## Review and act on the report

Call the canonical interface with the normalized packet:

```js
import { auditConvexGuardian } from "./src/convex-guardian.mjs";

const report = auditConvexGuardian(packet);
```

Review findings in their returned priority order. Each finding must retain the
concrete evidence and exact focused-check ids that can disprove it. Run only
those focused checks for changed surfaces. Do not replace them with an
aggregate score or a full repository suite.

An official component is a review candidate, not an automatic migration.
Verify its current primary documentation and local fit before recording
`fit: "confirmed"`. A binary or static asset moves toward Cloudflare only when
the packet records a confirmed fit; its domain metadata and relationships stay
in Convex.

## Preserve authorization

The report is always read-only, carries empty external-write and side-effect
arrays, and grants no migration, backfill, or storage change. Any such change
requires an isolated plan, bounded dry run, ordering, rollback evidence, and
separate authorization. Never use a Guardian recommendation to perform a live
write or destructive operation.
