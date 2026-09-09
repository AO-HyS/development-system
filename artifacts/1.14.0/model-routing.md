# Model routing operator contract (1.14.0)

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

Astra Medium is the default orchestrator after the four-run local pilot. Low
remains an explicit simple-work choice; the result is provisional, not a universal
model ranking. The original native agent profiles retain task-specific effort.
