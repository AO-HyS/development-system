# ADR 0050: Separate observed host and integration roots

Status: Accepted for implementation; operational verification pending.

## Context

A live Codex conversation can remain attached to a dirty historical checkout while authorized implementation needs a separate registered worktree. Version 1.26.1 conflates the authentic session directory with the content root, forcing integration into the historical checkout. Changing a tool working directory does not change the observed session identity.

## Decision

Add optional `hostRoot` to the contract, defaulting to `root`. The host root must match the authentic observation. `root` continues to own sources, content hashes, read/write scopes, integration, native checks and acceptance. Separate roots must be canonical, nonnested registered worktrees of the same Git common directory. Their HEADs may differ.

Pin integration Git identity and HEAD to execution authority and revalidate before consuming permissions, starting processes and accepting results. Inspection needs an explicit integration working directory when roots differ. Patches in this mode require absolute integration paths, including both ends of moves; symlink ancestors and protected paths remain rejected. Writers use a third separate workspace.

Reserve host, integration and unresolved writer roots under the existing lock. Include legacy process bindings and retain reservations across incomplete persistence or unproved termination. Record an authentic process exit before rejecting its result for candidate drift; termination does not imply acceptance.

New run and registry envelopes use version 2. Version 1 is readable as single-root history; do not convert active authority or rewrite receipts. Older runtimes must reject envelopes they cannot interpret.

Once version 2 state exists, reinstalling 1.26.1 is not an operational rollback: its reader rejects the newer envelopes. Recover through a forward repair unless a separate reviewed migration is provided. Installation-only reversal before any version 2 state proves no broader rollback capability.

## Verification and rollout

Use isolated HOME and real Git worktrees, including a dirty divergent host. Exercise lifecycle integration and negative path, identity, collision, replay and recovery cases. Independently review runtime and test changes. Publish a new immutable 1.27.0 contract; preserve previous artifacts and hook command identities. Actual installed observations and a real candidate execution are required before claiming operational support.

This repair uses the user's explicit maintenance and release authorization under ADR 0048. The defective runtime does not certify its own repair. Product release authorization remains separate.
