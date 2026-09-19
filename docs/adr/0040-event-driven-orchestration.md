# ADR 0040: Persist orchestration state and dispatch from events

Status: Accepted design; operational acceptance is recorded separately.

## Context

The earlier Jev candidate did not integrate its dispatcher with an effective
scheduler. Hooks could observe or deny a native spawn but could not establish
that a proposed model argument rewrite was applied. Parallel jobs also shared
provider state, so disjoint product files were insufficient to prevent process
contention. Model polling, preparation time and incomplete cost totals obscured
time to accepted delivery.

The initial development checkout predates the installed release. Version 1.23.0
therefore extends canonical source commit 24efbe31b085e29ffc6d18b63bad4f4d57552b3e
for 1.22.1, preserving its complete CLI, 30 managed destinations and catalog
of 104 logical skills with 140 physical variants. Installed copies confirmed
those published hashes; HOME remains generated output, never canonical source.

## Decision

Keep the run's starting orchestrator fixed: Sol High or Astra xhigh. Astra xhigh
handles planning, consequential decisions and review. DeepSeek V4.1 Flash High
executes exact bounded implementation packets through its explicit adapter.
Exclude Luna throughout the run. Attest actual provider, model, effort and
capabilities at dispatch and every resume; requested profile names alone do not
prove runtime identity.

Deterministic code persists the dependency graph, attempt state, exclusive path
ownership, concurrency limits and ordered events. Persist dispatch intent before
starting a worker. Reconcile native completion and external process-close events
with the active attempt, required checks and receipt. Ignore duplicate/stale
completion attempts without releasing another attempt's ownership. Recover from
durable state and reconcile an old writer before ownership transfer.

Jev receives compact, dense context for typed judgments at packet, change and
review boundaries. It advises the parent; code owns policy, arithmetic,
dependencies, permissions and side effects. A known dependency blocker cannot
be overridden by a recommendation for a capability that remains unavailable.

Benchmark arms measure task-active work from executable task dispatch through
accepted delivery. Report preparation and calibration separately. Each arm's
complete ledger includes its orchestrator, writers, Jev, planning, review,
browser, failed attempts and corrections. Preserve unknown values and distinguish
elapsed time from concurrent worker-duration sums. Incomplete attempts receive
no accepted-delivery time or successful ranking.

## Consequences

The parent retains integration, semantic correctness and final acceptance.
Installing policy is distinct from proving host enforcement, and passing
scheduler checks is distinct from proving a real product flow. This design
requires isolated installation/drift/repair/rollback evidence, operational
adapter/model-attestation evidence and the authorized product benchmark before
claiming those respective outcomes.

Version 1.23.0 sources and manifests are new versioned artifacts. Prior versions
remain unchanged unless exact published bytes are recovered with provenance;
updating an old expected hash to match unexpected bytes is not remediation.
