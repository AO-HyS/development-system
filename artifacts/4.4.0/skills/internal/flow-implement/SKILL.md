---
name: flow-implement
description: Implement a requested software change through verification, corrections, and its authorized delivery endpoint.
---

# Implement a change

## Claude Code: the AF way

In Claude Code, the parent of a product ask reads
[forma-af.md](references/forma-af.md) before the first `Agent` and follows it:
the parent manages, `escritor-rapido` writes the product code and one fresh
`verificador-pantalla` proves the screen lines. There it decides where it
differs from this page; in AF this skill calls neither `design-quality` nor a
visual council. The rest of this page is the Codex path and the shared parts
(integration, leaving nothing running, friction, closing, no tests).

## Codex and shared parts

For non-trivial work, first restate in your own words the user's goal, the
problem it solves and how you plan to approach it; keep going unless that
surfaces a real ambiguity. An explicit `in-your-own-words` invocation ends the
turn with the proposal and waits for the user's approval before execution.
Recover the requested outcome,
constraints, working surface and authorized endpoint. Reuse settled decisions and repository context relevant to this change.
Follow-up corrections steer the whole task unless the user replaces it. Define
completion by observable behavior and delivery, not by producing a first diff.

For non-trivial repository work, use `coding-orchestration` for ownership,
delegation and verification. Clear work proceeds without another
planning or approval ceremony. A bounded worker executes its supplied no-plan
packet (exact owned paths, settled decisions, observable `acción -> lo que se
ve` lines or mechanical target, and focused checks; no separate plan document).
Adapt the packet to available capability without reducing acceptance.

For a stateful UI or routing change, preserve the relevant state owners and
transitions: drafts, selection, filters, focus, dismissal and permissions. Check
the affected transition early; two static endpoints do not establish continuity.
For a visual redesign, recover the approved assets and criteria through
`design-direction` before implementation. Refinements preserve the current identity.

Use checks that establish the changed behavior and required repository gates.
Add no automated tests; real verification observes the changed behavior. A
regression claim needs evidence that distinguishes the broken and corrected
behavior. Preserve command exit codes,
resolve actual findings and rerun affected checks. Reuse still-valid evidence.
Continue through authorized implementation, verification and correction without
asking for another continuation message after the first pass.

For an on-screen outcome, use the repository's existing product-verification
capability to exercise the affected flow. Capture a useful baseline before edits
where possible; missing baseline evidence remains a declared gap. Invoke
`maintain-product-verification` only when that verification capability itself
needs maintenance. When visual quality is acceptance, `design-quality` judges
it and `evidence-capture` packages final media. Record the
affected behavior with useful data and the intended role. A backend change with
no on-screen outcome uses relevant behavior checks without a visual workflow.

Finish every requested criterion and the installation/publication steps already
authorized. A missing authorization for a distinct external action does not stop
preparation or independent work. State partial or blocked work plainly. The final
response covers the complete outcome, checks, remaining gaps, candidate and
requested review link; code, Preview and production are separate claims.

For a requested standalone completion report or a durable media package, read
[completion-report.md](references/completion-report.md).

## Before integrating a PR

1. Update `docs/architecture/primitives.json` in the same PR when a primitive
   changes. One PR per thing the owner asked: a fix or a follow-up of the same
   thing is a commit on its open PR, not a new PR.
2. Run `development-system listo <owner/repo#n>` and do what it names; merge
   with the command it prints.
3. Apply the 4.4.0 PR rules:
   - **Net-debt rule**: `file-size` / debt-ledger checks never block a PR that
     strictly reduces net debt without adding new over-budget files.
   - **Conditional TLC / formal checks**: keep fast static checks in the PR
     path; run TLC model checking only when `.tla`/`.cfg` or critical
     concurrency, retry, or state-machine logic changes.
   - **Mechanical batches**: prefer larger codemod/mechanical batches as
     `normal` with one batch read (`development-system registro --lote`) and
     one batch deploy/smoke instead of many tiny PRs.
   - **1-pass P0/P1 review**: no multi-round review loops; recurring defects
     become lint or type rules via `correct`.

## Leave nothing running

Stop every dev server, model server or watcher you started before the final
report: kill the PIDs you launched, never by name, and never another thread's.
Close every browser tab/session you opened and clean up temporary artifacts or
orphan MCP processes before finishing.

## Friction

Before the report, look back at the session for paper cuts: slow or flaky
startup, missing test data, a workaround for a missing tool, a doc that was
wrong. Record each with
`development-system friction add --id <slug> --incident <ref> --evidence <ref> --repository <repo> --summary <text>`.
Frictions feed the Steward; confirmed root causes still go to `mistake add`.

## Close every task

Close in the format of the installed instructions («How to close»).

## Automated tests and evidence

No automated tests anywhere: do not create, run or restore them; delete them
when found (`check-no-tests` and the guard enforce this). Every task includes
real verification without being asked: computer use, browser, and the
repository's verification CLI and feature map. Report passed / failed / not
reached with evidence.

## Spec and ticket handoff

Use [the shared definition contract](../coding-orchestration/references/spec-ticket-contract.md)
for stable criteria, linked tickets, dependencies, rules and required evidence.
When implementation is authorized, cover the complete feature, including
nonvisual behavior. Retrieve all tickets linked by the spec; preserve settled
decisions across threads.
