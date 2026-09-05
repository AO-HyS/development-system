# ADR 0023: Align active instructions with Astra and stop redundant work

Status: Accepted — operator requests implementation and publication, 2026-09-04.

## Evidence

The operator supplied Bradley Bernard's post about auditing AGENTS and skills:
https://x.com/bradleybernard/status/2095983699728953836
Its linked primary source is the current OpenAI model guidance:
https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra

Our installed contract already assigns Astra judgment, Go bounded execution,
Fable complex review and Luna fallback. The generated repository adapter still
mandates independent review handoffs and describes implementation as one terminal
slice. The review skill's opening and roster descriptions also conflict with
their proportional-review instructions. The historical spec opens with gates
from the bootstrap proposal despite later accepted contracts.

## Decision

Publish 1.8.2 and catalog 0.29.2 with consistent adapter, contract, roster and
skill guidance. Preserve the whole requested result and retained authorization.
Explain an actual instruction conflict by exact source, instead of silently
pausing. Keep ordinary review in Astra and independent assistance proportional
to risk. Stop repeating verification after relevant checks and required gates
pass; valid evidence can be reused, but required hooks and CI remain intact.
Batch independent tool work and overlap CI with other useful work where safe.

Preserve current effort settings and the Go-first route. Model guidance is not
an end-to-end benchmark of this workload. Do not enable API-only async tools,
configuration_update, cache parameters or endpoint migrations in a Codex/T3
adapter that does not implement those APIs. No latency SLA is inferred.

## Consequences

This supersedes contradictory mandatory handoff and old approval interpretations
in generated adapters and the historical bootstrap spec. It does not remove
authorization boundaries, independent review where required, data protections,
or repository release gates. Earlier releases remain immutable rollback targets.
Installation and instruction checks prove distribution and consistency, not
universal live influence or a measured improvement in time to production.
