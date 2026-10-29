---
name: flow-implement
description: Implement a requested software change through verification, corrections, and its authorized delivery endpoint.
---

# Implement a change

For non-trivial work, first restate in your own words the user's goal, the
problem it solves and how you plan to approach it; keep going unless that
surfaces a real ambiguity. An explicit `in-your-own-words` invocation ends the
turn with the proposal and waits for the user's approval before execution.
Recover the requested outcome,
constraints, working surface and authorized endpoint. Reuse settled decisions and repository context relevant to this change.
Follow-up corrections steer the whole task unless the user replaces it. Define
completion by observable behavior and delivery, not by producing a first diff.

For non-trivial repository work, use `coding-orchestration` for ownership,
delegation and verification. Reuse an already selected `orchestrate-work` method
instead of adding another execution loop. Clear work proceeds without another
planning or approval ceremony. A bounded worker executes its supplied packet.
Use the [exact-default execution contract](../coding-orchestration/references/execution-contract.md)
for ordered actions, expected observations and receipts. Adapt the packet to
available capability without reducing acceptance. Resume model/quota changes
through its linked continuity handoff, preserving valid evidence and ownership.

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
needs maintenance. When visual quality is acceptance, `design-quality` owns
independent critique before `evidence-capture` packages final media. Record the
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

1. Write or refresh the `system-recap` block from the diff; update
   `docs/architecture/primitives.json` in the same PR when a primitive changes.
2. Review the finished PR once, never each push. One independent Sol 6.1 High
   review of the ready head; a docs-only or small low-risk PR skips it. A
   second round only for a blocking finding (security, authorization, data
   loss, money), reviewing only the fix diff. Non-blocking findings are fixed
   without re-review or recorded as follow-ups. No third round without the
   operator. The same budget holds for the browser: one Terra 6.1 High fast browser
   session on the ready head covering every affected flow, a second only to
   check the fix of a real defect it found, one visual critique for UI changes.
3. Codex review: `development-system pr-review-status <pr>`. `pending` → run
   it with `--request` once and wait (T3 `watch_pull_request` when available);
   `findings` → fix or answer each one in its thread. Ask again at most once
   after the fixes; after that second review, answer its findings, push
   only their fixes and integrate on `budget-spent`, naming the later fix
   commits in the report. Integrate on `no-findings` or `budget-spent` only. `unavailable` is
   not approval.

## Leave nothing running

Stop every dev server, model server or watcher you started before the final
report: kill the PIDs you launched, never by name, and never another thread's.

## Friction

Before the report, look back at the session for paper cuts: slow or flaky
startup, missing test data, a workaround for a missing tool, a doc that was
wrong. Record each with
`development-system friction add --id <slug> --incident <ref> --evidence <ref> --repository <repo> --summary <text>`.
Frictions feed the Steward; confirmed root causes still go to `mistake add`.

## Close every task

Every task that changed files ends with a report:

1. Write the concise packet (`references/completion-report.md`). Its
   Markdown opens with the sections Qué se hizo, Hallazgos, Qué sigue, Detalle
   in that order (English: What was done, Findings, What's next, Detail);
   the command rejects other shapes and tables without `allowTables`.
2. Render it with `development-system document --input <packet> --json`.
3. Deliver it durably: in T3, render the page in the owning thread; otherwise
   give the persistent `htmlPath` the command returns.
4. A working-backwards `reader-live.mjs --tunnel` link is optional; when you
   add one, state its expiry next to the durable delivery, never instead of it.

A Stop hook asks once when files changed and no report was produced. If a
report is truly not useful, say why in one line. When the user asks for the
answer in the chat only, produce no document and no tunnel.

## Automated tests and evidence

No automated tests anywhere: do not create, run or restore them; delete them
when found (`check-no-tests` and the guard enforce this). Every task includes
real verification without being asked: computer use, browser, and the
repository's verification CLI and feature map. Report passed / failed / not
reached with evidence.

## Headroom transport evidence

Headroom is an explicit same-account per-invocation option. Keep the existing
Codex binary and CODEX_HOME, preserve caller arguments, and request lossless,
cache-conservative operation. Provider cache reuse can still change request
bytes; do not promise byte identity. Keep native usage from the parent and every
actual descendant separate from proxy counters, and separate requested model or
tier from observed identity. Use launch/completion events instead of polling.
Proxy counters and token deltas are descriptive; without complete controlled
evidence, do not claim Headroom caused savings.

## Spec and ticket handoff

Use [the shared definition contract](../coding-orchestration/references/spec-ticket-contract.md)
for stable criteria, linked tickets, dependencies, rules and required evidence.
Preserve the selected parent. With an OpenAI parent, Opus 5.5 authors the
plan and a fresh independent Sol 6.1 High reviews it; with an Anthropic parent,
Sol 6.1 High authors and a fresh independent Opus 5.5 reviews it. Use the
existing read-only routes and honor provider restrictions. Missing cross-family
contrast stays not reached; unresolved blocking objections prevent acceptance.
Fast researchers supply bounded source facts.
When implementation is authorized, use coding-orchestration and its advisory
Jev recipe across the complete feature, including nonvisual behavior. Retrieve
all tickets linked by the spec; preserve settled decisions across threads.
