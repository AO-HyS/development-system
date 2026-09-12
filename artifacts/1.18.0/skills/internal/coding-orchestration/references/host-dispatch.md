# Host-specific dispatch

Read this only when a selected worker needs an external CLI or a provider
availability failure needs handling. Prefer existing native agent tools; a
skill does not add capabilities or authorize provider substitution.

When using the Development System CLI resolver, use the real argument array
from `model-route` for the parent-selected model. For an OpenCode Go selection,
the command shape is `opencode run --pure --model opencode-go/<model> --variant
<effort> --format json`; verify the installed host's supported model and variant.
The resolver grants no permissions or publication authority. Record the observed
model before claiming resolution. If the resolver is unavailable, use an already
available native route rather than building another launcher.

The installed roster at `$HOME/.codex/development-system/agent-roster.json`
provides recommendations when available. It cannot reconfigure a running turn.
Read active host settings before claiming an update took effect; new sessions
may be needed to load installed defaults.

For a typed quota or availability failure with this resolver, record its bounded
expiry with `record-provider-failure --input <observation.json>` (at most seven
days). `model-route` reads that private cache unless an observation packet
overrides it. Reuse a current failure observation rather than retrying the same
unavailable provider on every task. Any alternative must respect user constraints.

On T3, an external CLI worker uses `development-system run-worker --input
packet.json --json`; read [worker-reference.md](../worker-reference.md) for exact
identity, lifecycle, private receipts and cancellation limits. Other hosts keep
workers attached to their native cancellation lifecycle. Confirm startup, then
completion or an observed stall; use host supervision rather than repeated
model-driven polling. Verify path confinement before writable dispatch. A pure
plan, copied file or process exit code does not prove authorization or correctness.
