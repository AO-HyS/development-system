# ADR 0053: avoid registry writes for unchanged host observations

Status: user-authorized local environment repair, 2026-09-22.

Concurrent ordinary reads encountered the bounded governance mutex timeout even
without a run bound to the caller. The current global registry is approximately
12 MB. Every PreToolUse registration rewrote it for unchanged identity, and
ordinary passive shell Pre/Post pairs added more serialized writes.

Reuse a checksum-validated registry observation when session, root, model,
reasoning and transcript are unchanged. New or changed identity still acquires
the existing process-owned mutex and rechecks the current snapshot before
writing. Preserve the original observation epoch for unchanged identities.

Restrict passive shell capability discovery to the deliberate exact `pwd`
probe and its existing canonical-root/output correlation. This intentionally
narrows the previous discovery behavior, where structured output from arbitrary
shell commands could also establish availability. It does not restrict or grant
governed execution, change non-shell observation pairs or establish acceptance.

Do not delete locks, alter bounded waits, rewrite history, weaken destructive
guards or make missing judgments pass. No-op registration still validates
snapshot integrity. Keep tests isolated from the operator HOME. Install only
the generated new semantic version after independent review, focused tests and
an isolated upgrade/drift/reinstall/rollback scenario.

This repair reduces avoidable contention; it does not certify every long-lived
governed transaction or every host surface. Current operational read probes
are distinct evidence from installation hashes. Model/profile changes and
phase effort transitions are separate subsequent work.
