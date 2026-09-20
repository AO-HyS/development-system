# ADR 0045: Bound retries of invalid Jev contract responses

Status: Accepted bounded runtime repair; product acceptance remains separate.

## Context

A single invalid Jev Choice answer stopped a product run before its final packet
review. An identical live request replay succeeded; the original raw response
was not retained. The strict validator matches the provider contract and remains
in force. A successful replay does not repair or replace the failed-run record.

## Decision

Retry only the same request after a typed malformed-answer response. Each
logical Jev packet has at most three total attempts: initial request plus two
retries. Identity, usage, HTTP, transport, timeout and diagnostics failures
remain hard failures. Preserve provider, model, request bytes and strict
validation. No fallback judgment, other provider or relaxed schema is allowed;
exhausted attempts remain a failure. Keep every existing review, ownership,
integration, QA and acceptance gate.

Retain private parsed, credential-redacted response diagnostics and accounting
per attempt, including failed responses. Each attempt has one ledger event; raw
diagnostic files never count as additional billable attempts. Charge every
attempt and its wait to the task-active interval and full-arm cost. Unknown
usage stays unknown. Existing failed results remain immutable evidence rather
than being reconstructed from the successful replay.

## Release boundary

Extend exact commit b669b89fc7a2384e9aa79d4a0fd854c1dfddc411 in an isolated 1.23.5
worktree. Create new immutable snapshots and manifest; retain all 41 managed
destinations and catalog 0.43.1 with 104 skills / 140 variants. Compatible 1.23.0
policy and prices remain separately pinned. Verify the extracted package and
isolated upgrade/repair/rollback from active 1.23.4 before authorized local
contract-only activation. Preserve all older packages, skills and user-owned
source. No remote publication or additional product variant is implied.
