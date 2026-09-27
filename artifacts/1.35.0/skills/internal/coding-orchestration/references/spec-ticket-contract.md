# Definition that survives a fresh implementation thread

Astra XHigh authors the approved spec and linked tickets. They remain separate
artifacts; the user may request both together. Preserve settled decisions and
retained authorization. Do not require the user to repeat ticket IDs when the
spec already links them. Definition does not imply an unrequested deployment.

The spec contains:

- stable spec ID, revision and all linked ticket IDs/locations;
- intended observable outcome, scope and explicit exclusions;
- stable criterion IDs, each with precondition, action, expected result and the
  evidence that can distinguish success from a plausible-looking failure;
- relevant canonical rules/docs, accepted decisions and unresolved questions;
- invariants, permissions/data boundaries, error/recovery behavior and risks;
- dependencies and the outputs each dependency must produce;
- authorized endpoint and any separately required external-operation authority;
- whether there is a visible outcome and which actual workflow needs inspection.

Each ticket contains its stable ID, parent spec link/revision, criterion IDs,
observable outcome, exclusions, dependencies and consumed/produced contracts,
relevant rule sources, settled decisions, risk and required behavior evidence.
Every ticket has at least one criterion. Spec-level criteria must have an owner;
shared integration criteria remain explicit. A missing linked ticket is a
missing input, not silently out of scope.

Use this compact form; omit irrelevant presentation, not required information:

```md
Spec: WEBHOOK-IDEMPOTENCY / revision 1
Tickets: WEB-1 [source], WEB-2 [source]
Outcome: repeated delivery produces one durable business record.
Scope/exclusions: [accepted boundaries]
Rules and decisions: [canonical sources and approved decisions]
Authorization/endpoint: [retained user instruction and requested endpoint]

| Criterion | Ticket | Scenario | Expected result | Required evidence |
| --- | --- | --- | --- | --- |
| AC-1 | WEB-1 | Deliver the same event twice | One durable record | Read persisted state after both requests |
| AC-2 | WEB-1 | Deliver the same event concurrently | One durable record | Concurrent requests and persisted count |
| AC-3 | WEB-2 | Retry after an interrupted attempt | Accepted recovery behavior | Failure injection and persisted result |

Dependencies: WEB-2 consumes WEB-1's identity/transaction contract.
Visible outcome: none; API responses and persisted state are the evidence.
Unknowns: [explicit question or none; do not invent missing decisions]
```

At implementation time Sol retrieves the current spec and every linked ticket,
records source hashes, locates the relevant repository rules and asks fast
researchers for missing facts. Astra's runtime plan supplies current paths,
ownership, exact commands, dependency outputs and verification steps. Do not
freeze stale file paths or commands into definition merely to satisfy a packet.

The independent plan reviewer gets these artifacts, the plan and evidence in a
fresh context. Jev may advise on coverage; the parent and independent reviewer judge it. Requirements
are not satisfied by checklists alone: closure must refer to actual current
criterion evidence, independent review and the authorized endpoint.
