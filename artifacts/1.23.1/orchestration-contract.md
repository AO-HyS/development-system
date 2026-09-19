# Persistent orchestration protocol 1.23.1

This protocol implements the orchestration portion of the development contract.
The versioned policy supplies concrete model routes, limits and classifier
settings; a manifest pins those policy bytes and every installed runtime source.

## Run and attempt identity

A durable run record contains its selected fixed orchestrator, executable task,
authorized endpoint, accepted constraints, repository, initial candidate,
dependency graph and accounting boundary. Each dispatch has a unique packet and
attempt identity. Every event identifies the run and attempt it affects.

Attest requested and observed provider/model/effort and actual capabilities at
start and on resume. Store host evidence separately from requested settings.
Unknown, contradictory or unavailable identities cannot produce an attested
benchmark result. The selected arm never silently changes its orchestrator or
writer family.

## State ownership

Persist packet state and ownership before dispatch. A packet may start only when
all required dependencies are satisfied, its overlapping write paths are free,
its adapter has capacity and its model/capability route is authorized. Scheduling
is deterministic for the same durable state and ordered events.

Native and external workers return completion events through their host adapter.
A process close establishes that a process ended; acceptance still requires the
receipt, permitted changes and required validation. Duplicate, stale and
out-of-order events are diagnosed without completing the wrong attempt.

Cancellation must stop the old writer before its ownership is transferred.
Recover abandoned attempts by reconciling persisted leases, process/session
identity and evidence. Do not blindly restart an interrupted writer or run a
second writer while its predecessor may still write.

## Packet and receipt

A packet names the exact root/revision, permitted reads/writes, settled behavior,
ordered commands, expected observations, dependency IDs, mandatory checks,
acceptance IDs and stop conditions. The worker preserves unrelated edits and
reports a concrete blocker when a required capability is absent.

The receipt includes actual identity evidence, completed/pending steps, changed
paths, check commands and outcomes, unresolved findings, blocker details,
retained authority and usage. The parent reconciles this evidence with the
candidate before satisfying downstream dependencies.

Jev may advise on packet readiness, change risk and review coverage using bounded
typed responses. It cannot mutate scheduling state or replace the parent's
semantic acceptance. Requests and failures remain attributable to their
boundary, including latency and usage.

## Verification and accounting receipt

Record installation and host behavior independently. An operational adapter
receipt proves observed dispatch identity, ownership and concurrency behavior,
event completion, duplicate protection and recovery in an isolated environment.
A product receipt separately proves the affected real flow, review/corrections
and required checks for the final candidate.

For each benchmark arm preserve its task-active interval and every provider/tool
cost through acceptance or stop, including planner, review, browser, failed
attempt and correction work. Experiment setup has a separate ledger. Unknown
costs or incomplete acceptance remain explicit; they cannot be used as zero-cost
or accepted-delivery evidence.

## Optional planning envelope

An explicit direct/single run skips the separate discovery model stage and asks
Astra xhigh for exactly one bounded Flash packet. Existing defaults remain
unchanged. Packet counts are validated before dispatch; independent plan review,
packet review, integration, neutral QA and acceptance still govern progression.
Record the selected planning and packetization modes with controllerVersion
1.23.1. The inherited policy remains version 1.23.0 and is pinned independently.
