# ADR 0035: Pin execution contracts and review test changes

Status: accepted for release 1.20.0, September 14, 2026.

The delivery loop needs a small, durable handoff that survives model changes,
parallel workers and resumed sessions. A worker must know the exact root,
revision, ownership, behavior, checks and authorized endpoint before it writes.
Repeated status polling and a second coordinator add context without adding
evidence, while unconstrained test edits can make a green run misleading.

The starting conversation model remains the orchestrator. The parent pins one
execution contract containing the objective or ticket, root and revision,
owned paths, expected observable behavior, authorization, enumerated checks,
evidence receipt and stop conditions. Exact-instruction mode carries an ordered
recipe; outcome-delegation mode lets the worker choose an implementation. Both
use the same constraints, ownership and acceptance bar. Parallel workers require
disjoint surfaces and synchronize through completion events. No new coordinator,
engine, tracker or approval protocol is introduced. Local product recipes and
form architecture remain canonical.

The default test policy is allowedChanges = []. The parent calls the shared
findTestPolicyViolations({root, baseRef, policyPath:
"config/test-change-policy.json"}) helper when test paths change. A reviewed
exception records path, SHA-256, reason, issue and reviewed content; an
authorized deletion records null SHA-256. Workers report an actual evidence gap
instead of expanding scope or generating one test per form or feature.

For UI work, identity, role, organization and useful entities are resolved once.
Neutral browser execution receives exact actions and observable values; the
parent retains private acceptance criteria. Impeccable and independent capable
critique complete before final evidence. Deterministic media keeps each
original and a 4–6 frame contact sheet; crops or video are added only for a
disputed detail or motion claim.

The current private benchmark may use a synthetic Barber ticket on the latest
develop revision and compare Astra xHigh with Sol xHigh across exact and outcome
arms. That protocol is run-specific evidence, not a global specialist default
or model ranking. Historical videos and restoring a prior base are outside this
simulation unless its private packet explicitly requires them.

Published artifacts remain immutable. This release updates the four existing
skills and their catalog/manifest provenance; it does not alter the 1.19.1
questionnaire or claim that installation alone proves discovery, loading,
behavioral influence, speed or product acceptance.
