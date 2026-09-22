# ADR 0051: Lossless Jev request packing and visible plan packets

Status: Accepted for implementation; operational provider verification pending.

## Evidence

A real NutriPlan planning return exceeded the 65,536-byte classifier envelope. The completed planner artifact appeared twice: in the canonical plans collection and in returnedArtifacts. Selected dependencies were also repeated. Complete rules, ticket requirements and authored plan still exceed 64 KiB after removing duplication. The corrected complete request measures79,464 bytes with three full sources, eight criteria and eight plan packets; no source or criterion is omitted. Read-only measurement preserved closed-run and registry bytes.

## Decision

Normalize only the transport representation. Retain each full canonical plan, review, verification and dependency once; express selected artifacts through ordered typed references and selected dependencies through IDs. Missing, duplicated, contradictory or unbound records fail before transport. Preserve supported dependencies on approved control boundaries by retaining their authentic boundary and matching judgment. Do not change stored artifacts, snapshots, permission hashes, acceptance semantics or schema2.

Set the explicit request-envelope maximum to98,304 bytes (96 KiB). Keep separate complete-source and cumulative changed-context limits at65,536 bytes, the200-criterion limit and existing output caps. No automatic cap increases or truncation. This is a measured bound for complete input, not proof that the provider accepts that input. Require an actual classification with the installed candidate before operational acceptance; provider rejection does not authorize raising the bound again.

Expose complete ordered plan packets and producer metadata through explicit CLI status allowlists. Exclude transcript paths and private command data. Status is read-only and visibility does not imply plan-review approval.

## Validation and release

Independent source and exact test-content review approved the candidate. Focused runtime, recovery, CLI and lifecycle suites pass68/68; typecheck and closed test policy pass. Tests exercise exact UTF-8 envelope bounds, independently bounded sources/changes, criterion limits, full content/reference integrity, approved boundary compatibility and status nonmutation. These use simulated provider identities and do not establish real provider behavior.

Publish a new immutable1.27.1 contract and matching updated governance guidance; preserve all prior manifests, artifacts and closed runs. Use isolated HOME for installation validation. The user's explicit Development System repair/publication authority under ADR0048 applies; the defective runtime does not certify its own repair. Product deployment authority remains separate.
