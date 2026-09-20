---
name: coding-orchestration
description: Choose delegation, ownership, and verification for non-trivial repository execution with a pinned task contract.
---

# Coding orchestration

Optimize rápido → bien → barato: reach the complete usable result quickly,
correct it with focused evidence, and keep measured cost and complexity low.
Preserve behavior, data boundaries and authorization.

## Use the installed advisory profile

For non-trivial implementation, a material decision or independent review,
read [Jev advisory execution](references/jev-advisory.md) once and use its
Sol/Flash/Astra profile. The current selected parent stays the orchestrator.
Tiny deterministic work stays direct; the recipe does not add a second planner.

## Resolve the run

The model selected when the conversation starts remains the orchestrator. It
chooses workers within the user's provider, quota and capability limits and
integrates their results. A roster or native profile is a recommendation, not
runtime identity or a provider chain. A restricted family stays restricted for
every descendant; report a missing browser or vision capability instead of
substituting a different family.

Before a worker starts, pin one execution contract. It names the objective or
ticket, root and revision, owned paths, expected observable behavior, mode,
authorization and endpoint, enumerated checks, evidence receipt, stop
conditions, and the required completion report. Read
[the execution contract](references/execution-contract.md) for the compact
packet fields.

Use **exact instructions by default**: give ordered actions, expected
observations, checks and stops using the execution contract. Outcome delegation
is an explicit, reasoned exception for a bounded implementation decision; record
why a recipe would be premature and keep the same acceptance requirements.

The method is model-agnostic. Preserve the acceptance standard when capability
or availability changes: reduce packet size and simultaneous decisions, supply
concrete examples and observable checkpoints, then correct from the returned
evidence. A model label never proves capability or acceptance. If an essential
capability is unavailable, retain the gap and continue independent work; do not
silently substitute a provider or promise equivalent results from every model.

## Execute with useful ownership

The parent owns decomposition, architecture, integration, conflicts,
verification, findings and the terminal state. Do not add another coordinator,
engine, tracker, approval protocol or browser bridge. Execute the repository's
local canonical recipe; a skill does not migrate a product's form or other
domain architecture to match its own examples.

Use deterministic tools directly and batch independent reads. Keep one writer
per surface. Parallel workers are allowed only for disjoint paths with no
shared dependency sequence. Start them from the same pinned contract and
receive completion events. Do not send repeated unchanged status requests or
poll a worker when no new event or observation exists. Reuse a worker for a
focused correction while it owns the same surface; verify termination before
transferring ownership.

Every worker packet includes the exact root and branch or revision, owned
surface, settled routing, relevant references, constraints, focused checks,
expected receipt and known failures when resuming. Workers preserve unrelated
edits and return changed paths, commands, results and remaining gaps. A clean
diff, first implementation or passing lint does not close unverified behavior.

## Test changes and evidence gaps

Treat tests as evidence for observable behavior. The default policy is
allowedChanges = []: a worker does not add, modify, delete or generate a test
file unless the parent closes a reviewed policy exception first. Never create
one test per form or feature as a reflex. When a required behavior lacks
evidence, report the actual gap and its smallest useful check to the parent;
the worker does not widen test scope on its own.

When test files do change, the parent invokes the shared runtime policy helper:
findTestPolicyViolations({root, baseRef, policyPath:
"config/test-change-policy.json"}). It returns a violation array. An exception
must name each path, its SHA-256 (or null for an authorized deletion), the
reason, issue and reviewed content. Do not hide a violation with a skipped
assertion, ignore, disable or fake mock.

Choose the quickest adequate existing check plus the checks named in the
contract. Preserve exit codes and rerun only after a relevant change, failure,
required gate or unresolved risk. A test count or green run never substitutes
for the accepted objective.

## UI acceptance and evidence

For visible work, resolve fixture identity, role, organization and useful
entities once before the main pass. Give a neutral browser executor exact
action inputs and the values to record; the parent retains the acceptance
rubric and judges the resulting values. Use the authorized browser mechanism
and one driver per session.

When visual quality matters, complete Impeccable and independent capable
critique first, resolve material findings on this candidate, then call
evidence-capture for final media. A screenshot or copied file proves neither
live harness influence nor product acceptance. Backend-only work does not need
a visual workflow.

## Finish

Continue through implementation, focused checks, corrections and the
authorized endpoint. Separate source, local runtime, PR, Preview, production
and acceptance. Report the candidate, actual observed model/tool identity,
changed paths, checks, evidence references and remaining gaps. If blocked,
name the concrete dependency and finish independent work; a timeout or missing
receipt cannot become a passing result.

For host-specific CLI dispatch, read [host-dispatch](references/host-dispatch.md).
For interruption or ownership recovery, read
[execution-continuity](references/execution-continuity.md). T3 packet details
are in [worker-reference](worker-reference.md).
