# Model routing operator contract (1.15.0)

OpenCode Go and Codex are the only active providers. Factory, Droid and Devin
are retired from current execution and review routes by operator instruction.
Historical immutable releases remain available for rollback.

Edit config/agent-roster.json for candidate ordering, models and reasoning.
OpenCode Go tries Muse, then GLM, then Qwen only with observed availability.
Luna Max with priority requested is the Codex execution alternative; Astra owns
orchestration and review. Deterministic operations use host tools directly.
The parent selects once; workers execute the supplied bounded task.

The resolver reads an input roster, then an explicit version snapshot, otherwise
the executing package's config/agent-roster.json. A HOME copy is not automatically
reloaded by that CLI. Native TOML profiles are installed artifacts and running
agents do not change when files change. Verify the effective runtime model,
reasoning and service tier before claiming they were applied. Fast is service
priority; Max is reasoning effort. A priority request is not a billing receipt.

Respect current authorization and path confinement. Keep existing host-attached
cancellation. Reuse typed provider failures and useful work rather than retrying
an unavailable provider at every step. Selection itself grants no authority.

Astra xHigh at normal/default speed is the provisional feature-orchestration
choice from the full-flow pilot. Specialists retain Medium or High as measured.
Luna uses High with priority for code-mapper, implementer, evidence-preparer and
test-runner; fast-implementer and mechanical-worker keep Max with priority.
A missing CLI service tier requests default, never implicit priority. Every
Astra route and native profile explicitly requests default. Native profiles own
specialist sandbox settings, which this tuning preserves. Already-running turns
retain their configuration; load a new session to pick up installed defaults.
