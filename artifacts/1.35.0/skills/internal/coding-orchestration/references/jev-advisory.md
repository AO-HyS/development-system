# Jev advisory execution

The selected parent owns execution. Read this once for nontrivial work; workers
execute bounded packets without repeating lifecycle selection.

1. Pin the objective, authorized endpoint, root/revision, requirements and checks.
2. Luna 6 High priority collects missing source facts. Astra 6 XHigh writes the
   plan; a different fresh Astra 6 XHigh reviews requirements, rules, plan and
   evidence before writers start. Reuse accepted planning on resume.
3. Ask Jev at a meaningful routing or correction decision, using a small typed
   packet and current ownership. Record the parent's selected route and rationale.
   Do not call Jev on every read, file, wait, tool invocation or lifecycle event.
4. Dispatch exact owned packets through the native host. Sol 6 Medium writes
   general packets; Luna 6 High priority writes mechanical/exact packets. Run
   disjoint packets concurrently only when dependencies and capacity allow.
5. Integrate, run relevant checks, receive independent Astra 6 XHigh review,
   correct actual findings and verify behavior through the authorized endpoint.

The installed CLI is
`node /absolute/HOME/.codex/development-system/advisory-runtime/cli.mjs`.
Use `status`, `classify-atom` and `record-route-decision`. The package exposes the
same commands (`advisory-status` for status). Classify with `--atom packet.json`,
`--run-context run.json`, optional `--active-atoms active.json` and a fresh
`--receipt`. A packet names `id`, `objective`, `readSet`, `writeSet`, `dependsOn`
and `acceptanceIds`; context names `runId`, `baseSha`, `rootModel`, `phase` and
`verifiedAtomIds`. Credentials use the existing environment or private credential
file, never packets or output.

Record a decision using the same atom/context plus `--route-receipt`,
`--chosen-route`, `--rationale` and a fresh `--receipt`.
`exact_implementation` requests Luna 6 High priority; `general_implementation`
requests Sol 6 Medium normal. Preserve actual capability gaps.

A valid request that fails classification writes a sanitized bound failure receipt
when a receipt destination is supplied. The parent records continuation with a
nonempty rationale through `record-route-decision`. A failure remains a failure;
this decision claims no successful judgment, execution, authorization or acceptance.
Invalid input may fail before a bound receipt exists; record the error and correct
the packet or continue independent authorized work. Never fabricate a receipt.

No global Jev hooks, automatic executor, phase permits, lease database or Stop
continuation gate is required for a new advisory task. User authorization,
repository checks, destructive-command protection and real ownership still apply.
Old governed histories remain intact and are not automatically resumed. Their
explicit recovery tools describe historical state, not the default workflow.
