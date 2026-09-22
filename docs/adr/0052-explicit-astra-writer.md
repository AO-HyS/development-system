# ADR 0052: Explicit Astra writer and researcher routes

Status: user-authorized local maintenance candidate, 2026-09-22.

The existing role contract permits a deliberately selected Astra packet, but
the 1.27.1 executable policy accepts only Flash writers. Support the exact
Codex/OpenAI `gpt-6-astra` / `xhigh` route for writing and research without
substituting models, changing the parent, or making Astra the universal default.

A writable Codex process uses the third isolated candidate workspace. Its
permission policy must constrain writes and network access independently of
broader inherited configuration. Validate its exact command before binding and
spawning, and again when processing observed events. Treat prompt contents as
data, never command options. All writers share baseline/delta reconciliation;
outside-scope changes cannot be integrated. Preserve actual metadata observation,
root identity, source hashes, leases, Jev judgments and independent acceptance.

Pin `approval_policy="never"` as well as the writer sandbox settings. Before
binding a writer, ask the same Codex executable and environment for its typed
`configRequirements/read` result through a bounded app-server helper. Managed
permission profiles, incompatible approval/sandbox allowlists, unknown response
shapes or unconfirmed helper termination are unsupported and stop the launch.
The writer's actual session metadata must also establish the expected restricted
filesystem/network policy before its output can be accepted. Preflight and
writing are separate processes; this does not make mutable administrator policy
atomic across their lifetimes.

Version 1.27.3 adds an immutable runtime snapshot and manifest while retaining
catalog 0.46.1. Version 1.27.2 recovery work and 1.28.0 development in other
worktrees are outside this candidate. Published artifacts remain immutable.

This repair follows the authorized maintenance exception in ADR 0048. Isolated
tests and installation checks do not certify provider identity or operational
enforcement. Require an installed-Codex sandbox boundary probe and an actual
governed writer receipt before reporting operational support. No public release
or product promotion is implied by local installation.
