# Development System contract 1.2.0

Version 1.2.0 retains every 1.1.2 lifecycle, authorization, adapter, benchmark, repository-preparation, delivery, measurement, privacy, installation, rollback, paid-tool, and provider-readiness guarantee. Published 1.1.2 bytes remain unchanged.

This version adds the portable `working-backwards` definition workflow:

- Begin with a plain-language explanation of the finished customer experience, then ask evidence-backed product questions before designing entities or modules.
- Route definition depth through Quick, Standard, or Complex. Hard risk triggers set a minimum Complex profile and require only their risk-specific ADR, prototype, migration, security, or rollout evidence.
- Persist exactly three definition gates through exact canonical approval operations: Product Contract Approved, Technical Contract Approved, and Implementation Map Approved. Each receipt binds workflow, repository revision, governing artifact IDs, roles, content hashes, lineage, and source revisions; drift invalidates the smallest affected gate and descendants. Drafting is read-only. Risk or unsupported customer evidence can block the smallest applicable gate.
- Treat HumanLayer as an optional local definition surface whose configuration, observations, comments, and receipts never grant lifecycle authority. Caller snapshots are unverified; operational evidence requires a provenance-bound read-only local probe, and influence requires a verifiable signature.
- Prepare ticket publication intent without side effects and bind it to the approved Implementation Map receipt and exact ticket-map hash. Actual tracker publication requires exact intent-bound authorization, an injected one-shot authority and tracker adapter, deterministic idempotency, reconciliation when available, and a safe-resume receipt after partial failure.
- Generate a compact private T3 handoff only from approved, non-stale, hash-verified artifacts and complete persisted gate receipts, plus repository revision, tracker state, dependency frontier, checks, and risks. Freshness drift requests refresh.
- Evaluate dogfood evidence fail-closed. A bounded live pilot may be recommended only from hashed dogfood provenance and exactly two complete historical-validation-case replays with explicit signal dispositions and comparison limitations; ticket 07 remains blocked pending a selected real product feature and authorization.
- Keep `implementationAuthorized: false` through definition, publication, and handoff. The existing Implement Preview remains the only implementation trigger for one terminal slice.

Skill catalog 0.6.0 adds explicit Codex and Factory mirrors of the canonical model-invoked `working-backwards` skill. T3 Code inherits the Codex surface. The catalog makes no claim of live loading or behavioral influence without separate operational evidence.
