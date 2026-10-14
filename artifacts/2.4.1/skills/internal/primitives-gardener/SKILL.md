---
name: primitives-gardener
description: Give a repository good primitives and keep them good. Mode fix inventories the system, decides what to create, combine, expand, keep or retire, and composes the primitives through small reviewed PRs until docs/architecture/primitives.json is true. Mode tend is the weekly upkeep the Development Steward runs. Use for "fix the primitives", "primitives inventory", or the Steward's weekly pass.
---

# Primitives gardener

A primitive is the smallest unit of meaning a system exposes so features are
composed from it instead of re-implemented (Kent C. Dodds, "Your Coding Agent
Needs Better Primitives"). When one is missing or has twins, agents copy the
nearest variant and re-implement the rest. Fewer, sharper primitives shrink what
an agent can get wrong.

Categories: `ui` (components, tokens), `api` (resources and verbs), `data`
(entities, relationships), `infra` (jobs, storage, deploy, secrets,
environments), `agent-tools` (CLIs, feature map, scripts), `workflow` (retries,
queues, batches, idempotency), `auth` (identity, roles, permissions, audit).

The map is `docs/architecture/primitives.json`, schema version 1:

```json
{ "schemaVersion": 1, "primitives": [
  { "id": "org-context", "category": "auth", "status": "active",
    "summary": "Resolves the caller's organization and capabilities.",
    "paths": ["packages/convex/src/lib/orgContext.ts"],
    "symbols": ["packages/convex/src/lib/orgContext.ts#getOrgUser"],
    "guarantees": [{ "statement": "Every org query checks membership.", "verifiedBy": "lint rule get-org-user-first" }],
    "goals": ["Actions use the same entry point."],
    "replaces": [], "docs": ["CONTEXT.md"] } ] }
```

`status` is `active`, `proposed` or `deprecated`. A guarantee is something the
system already holds and names how it is verified; anything not yet true is a
goal. `development-system check-primitives --root <repo>` validates paths,
symbols, guarantees and docs.

## Mode fix

Run in the owning thread on the repository's own branch. Restate the owner's
goal in your own words first. Order:

1. **Fix what is broken.** Real bugs and security findings from the inventory,
   and unanswered Codex findings on merged PRs
   (`development-system pr-review-status`), each in its own small PR.
2. **Prepare verification.** Exact revision, instance and backend, test
   accounts and roles, fixtures, the corrected feature map, allowed actions and
   expected evidence. For permissions plan observations that are allowed and
   denied; for money, messages and publication, the side effects. Whatever is
   missing is recorded as not reached; it does not count as fixed.
3. **Inventory** (reuse a recent one when its revision still matches): per
   category, what exists with paths, twins and bypasses with two or more paths,
   and missing primitives with the workaround that proves it.
4. **Finite list.** For each item: keep, combine, expand, create or retire;
   why; effort; one-way or two-way; dependencies; acceptance. Not every
   category needs new infrastructure: defer with a reason and the condition
   that reopens it. Product decisions go to the owner once, with a
   recommendation; one-way data changes wait for explicit confirmation.
5. **Authorization contract before migrating.** Name the entry kinds (session,
   patient or customer, admin, operator, internal, cron, public), which
   canonical guard each uses, and the per-resource checks that stay. Wrappers
   reuse the canonical guards; a client-supplied actor is never authority;
   crons do not fake a session. Migrate module by module with a written list of
   current exceptions, and make new bypasses impossible (lint or a CI check that
   recognizes the guard by what it calls, not by a function name).
6. **Compose.** Small PRs, each with a `system-recap`, real verification of the
   affected flows (QuickE2E with Jev, including the denied case and side
   effects), and the review budget of the global rules: one Sol review of the
   finished PR, Codex asked once when ready, one browser session on the
   ready head (a second only to check the fix of a real defect). Dead code
   that looks like a pattern goes first: agents copy what they find. Documents
   that contradict the code are corrected or marked superseded.
7. **Close.** `primitives.json` passes `check-primitives`, the finite list has
   no open item that is not deferred with a reason, and the repo moves to tend.

The finite list and the authorization contract get one independent plan
review; use `cross-review` only when the operator asks for it.

## Mode tend (weekly, from the Development Steward)

Read-only discovery within the Steward's limits:

- `check-primitives` on develop; drift is a finding.
- New twins or bypasses since the last pass (new role comparisons, new copies
  of a domain list, new raw membership reads, new hard-coded deployment ids).
- `proposed` primitives with no progress, `deprecated` ones still imported.
- Frictions from `development-system friction list` that point at a missing
  primitive.

Each finding becomes one pending recommendation in the Steward ledger,
deduplicated and closed only by evidence. A draft PR is prepared only under the
Steward's own conditions (proven revision, clean checkout, no other writer,
focused checks, never merge); never migrations, provider changes or external
effects.
