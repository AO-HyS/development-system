---
name: create-product-verification
description: Create or refresh a project-local verification capability that drives the real product the way a user does (web, CLI, service or mobile) and captures evidence. Use when a repository has no scripted way to prove behavior, when acceptance needs repeatable real evidence, or for /create-verification-skill.
---

# Create product verification

Adapted from pstack `create-verification-skill` (cursor/plugins
`c86f349b102feb91f1966f8a6a60882a4e601b50`, MIT). Local changes: QuickE2E with
Jev drives web flows, the repository's existing feature map and verification CLI
stay the source of truth, and evidence stays private.

The output is a project-local skill (`verify-<product>`) written for the next
agent, read cold mid-task by someone who has never seen the app.

## 1. Interview the repo, not the user

Answer from the codebase; ask the operator only what you cannot observe:

- **Surface:** what a user touches (web UI, CLI, API, mobile). Pick the primary one.
- **Run:** the repo's own dev command, ports, environment, seed data, auth.
  Test accounts come from the repo's env files (names only, never values in
  output); ask only if they are missing.
- **Drive:** existing harnesses first (the repo's verification CLI, feature map,
  scripts). For web flows, QuickE2E with Jev (`quicke2e run <flow> --engine jev`,
  with the Development System TypeSafe preload; see `behavioral-evidence`).
  T3 browser for visual judgment. No emitted spec is kept.
- **Observe:** screenshots, video (`--video`), response bodies, logs, database
  state, side effects.
- **Isolate:** can two instances run side by side? If not, the skill says so:
  refusing to double-drive a shared instance beats corrupting someone's session.

If the checkout does not build or start, fix that first or report it exactly.

## 2. Generate the skill

Reuse the repository's existing feature map file and verification CLI; never
create a second source of truth. The skill body has, grounded in what the
interview found, no placeholders:

- **Launch:** exact command, the observable "ready" signal (usable, not just a
  port answering), teardown.
- **Doctor:** one read-only check: process up, right revision, port owned by
  this run, auth valid. Run it first whenever anything looks off.
- **Drive:** real handles from this repo (ARIA names, routes, prompts), one
  QuickE2E flow file per mapped feature where web applies.
- **Evidence:** the real user path, never test-only endpoints; the action and the
  resulting state; side effects (rows, emails, messages, payments in test mode)
  alongside what is visible. A denied role is observed denied, not assumed.
- **Cleanup:** kill what you started, never by process name; remove scratch
  data; evidence survives under
  `$HOME/.development-system/private/verification/<run-id>`.

Keep identity, effects and privacy explicit: no credentials, tokens, PHI or
customer data in the repository or in evidence. The runner's PASS is evidence,
not acceptance: the orchestrator judges against the accepted objective.

## 3. Seed the feature map

Each mapped feature answers, from the user's point of view: what it is, how to
reach it, how to drive it, what end state proves it, and gotchas. If seed data
lacks a precondition, the journey reports the failure and the reason goes in
Gotchas; never weaken a journey to make it pass.

## 4. Prove the generated skill before handing it over

Run it end to end once: launch, doctor, drive one mapped feature, capture
evidence, clean up, then confirm the evidence still exists. Clean up after every
failed attempt too. A skill never executed is a draft. If proven in a stand-in
(another backend, a local stack), list what the real target still needs.

## 5. Hand over

Point at `maintain-product-verification` for keeping the map honest.
