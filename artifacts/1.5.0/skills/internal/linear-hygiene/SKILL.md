---
name: linear-hygiene
description: Audit collected Linear and delivery evidence for the five primary products and preview a complete, read-only cleanup plan for explicit later authorization.
---

# Linear Hygiene

Make Linear trustworthy without treating it as canonical code or production
truth. This skill is a read-only auditor and planner. It never calls production,
never writes Linear, and never applies its own cleanup preview.

## Scope the five products explicitly

Use the canonical mapping exported by `src/linear-hygiene.mjs` for AO HyS,
Casa Roca, The Barber Central, NutriPlan, and ETERIA. All currently share the
Linear team and key `Aohys` / `AOH`, so the product project, title prefix, and
display identifier must make ownership visible. In particular, Casa Roca must
remain `[Casa Roca]` and `CR/AOH-n`, not generic AO HyS work.

Do not infer an unknown repository. Return an invalid report and request
verified mapping evidence instead.

## Reconcile without claiming production

Pass caller-collected issue snapshots and repository, pull-request, deploy, and
runtime evidence to `buildLinearHygienePlan`. Git owns code continuity. Provider
deploy and runtime observations retain their own identity. Linear is only the
operational tracker and cannot override either source.

The interface does not collect evidence and does not contact a provider. A
green PR, CI result, Linear status, or cleanup plan never proves production.

## Preview complete cleanup

Report fake, duplicate, stale, completed-outside-tracker, orphaned,
wrong-product, and ambiguous-name findings. Produce an ordered preview using
only `create`, `update`, `move`, `close`, and `delete`. Every change includes:

- a reason;
- a structured before/after diff;
- rollback instructions when Linear or an explicit pre-deletion export permits
  rollback;
- an explicit unsupported rollback when destructive deletion has no restore
  handle.

Delete false, duplicate, and unsupported stale clutter rather than renaming it
to deprecated. Applying even a reversible update requires a separate exact
external-write authorization. Applying delete requires separate destructive
cleanup authorization.

## Hand the clean view to Check-in

Use `cleanView` as the reconciled tracker view. Pass `checkInEvidence` to the
canonical Check-in interface. It contains only surviving issues with a real,
well-formed human action; quiet, fake, duplicate, and cleanup-only items do not
become Check-in work.

The audit result must preserve `readOnly: true`, empty
`externalWriteIntents` and `externalSideEffects`, and false Linear mutation and
destructive-cleanup authorization flags.
