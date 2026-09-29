# ADR 0066: Codex accounts and native Claude recovery

## Status

Accepted for local candidate 1.39.0 and catalog 0.57.0. The operator explicitly
requested the sequence: existing Codex account, next existing account, then a
fresh native Claude reviewer or computer-use executor. Publication is separate.
This amends ADR 0061 and 0064 for Claude Code; independent review, required
capabilities, platform protections and authorized endpoints still apply.

## Decision

- Discover credential homes from inherited CODEX_HOME, the two standard local
  homes and T3 Codex profile paths. An explicit policy `review.accountHomes`
  array replaces discovery for scoped operation. `--accounts` only inventories
  metadata. Never read, move or copy authentication contents; deduplicate the
  canonical auth-file path. Distinct paths do not prove distinct identities.
- Launch each available profile sequentially with its own CODEX_HOME. Remove
  inherited OPENAI_API_KEY and CODEX_API_KEY so a ChatGPT-account recovery does
  not inadvertently use inherited API authentication. Keep the same binary,
  model, packet, reservation and review round. Attempt at most two profiles in
  discovery order before native recovery; save each attempt separately.
- Retry review only after a recognized terminal provider quota, authentication
  or connectivity failure. Cancellation, refusals, local failures, malformed
  evidence and a completed negative verdict do not trigger availability recovery.
- Computer use permits account recovery only after a complete, explicit
  preturn quota or authentication failure. Activity or incomplete traces require
  reconciliation; neither the next account nor Claude may replay uncertain
  effects. Missing authentication or binary permits a safe native handoff.
- Exhaustion returns `status: fallback_required`, exit 75 and an eligible
  native-role handoff. The coordinator immediately dispatches a fresh native
  reviewer, visual-reviewer or browser-qa and continues the authorized work.
  The launcher itself cannot invoke Claude's native Agent tool.
- Copy `fallback.prompt` verbatim: the full original packet and reason, receipt
  and original packet paths. Reject appended or changed instructions and Agent
  resume; native fallback starts a fresh independent context. Atomically consume
  each computer-use fallback receipt before admission; repeated admission is
  denied even if the first native Agent did not complete. Reconcile rather than
  replay possible effects.
  The guard verifies canonical root, mode, Task-Id, eligibility, attempt trace
  classification and matching original/snapshot hashes. An old receipt cannot
  justify a revised packet. General reviewer covers plan and security review;
  retired agent roles remain retired. Report the provider change and observed
  or unknown runtime identity. Missing browser/vision capability remains a gap.
- Keep older manifests and artifacts byte-identical. New runtime snapshots and
  every destination/hash/mirror are explicit in the 1.39.0 manifest. The updated
  catalog copies only the two AO-owned workflows that need recovery guidance.

## Evidence boundary

Isolated installation, metadata inventory and hook invocation establish their
respective behavior only. Actual account switching, Claude native dispatch and
browser acceptance need corresponding live observations. Never induce quota
exhaustion, fabricate provider errors or label a generated report as acceptance.
Headroom retains its explicit same-account per-invocation boundary; this operator
request authorizes the Claude recovery sequence, not general provider fallback.
