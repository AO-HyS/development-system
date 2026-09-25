# ADR 0057: Opt-in Headroom delivery with observed evidence

Status: Accepted for implementation; installed-host behavior remains a separate
verification result.

## Context

The operator wants to evaluate Headroom as an optional local transport for
Codex work while keeping the selected account, native provider and normal
execution available. Proxy counters alone do not account for every actual
descendant or establish provider billing, cache reuse or causal savings.

## Decision

Headroom is explicit per invocation and uses the existing Codex binary and
`CODEX_HOME`. It does not copy credentials, switch accounts, install a daemon,
or silently fall back to another provider. Lossless request handling and
conservative cache settings are used for comparison; provider-side cache reuse
may still change request bytes, so byte identity is not promised.

Keep native usage records for the parent and every actual descendant separate
from Headroom proxy counters. Report requested model and service-tier settings
separately from each observed runtime identity and tier. Do not poll for worker
results: consume launch and completion events, bound readiness and cancellation,
and clean up only processes owned by the invocation. Starting, version-checking
or measuring the transport does not prove that a task used it.

An observed token or counter difference is descriptive evidence. Without a
controlled comparison that accounts for all descendants and provider-side
behavior, it is not evidence that Headroom caused savings. Reports must not
claim causal savings from proxy counters or installation state.

The native browser integration applies only the documented CUA launcher and
the missing browser/computer environment declaration through the supported
process configuration. Preserve unrelated MCP configuration and security
boundaries; do not bypass host policy.

New Codex T3 coordinator threads may explicitly request Sol 6 High using the
supported invocation setting. This per-thread request does not replace the
conversation's selected parent or rewrite the global roster. Record the actual
host identity when it is observable; otherwise report it as unknown.

## Verification boundary

Source checks and copied hashes establish release integrity only. Headroom use,
transport coverage, native usage completeness, CUA behavior and product
acceptance require their own observed evidence. A preview or local result does
not imply production acceptance. Do not create, modify, generate or run
automated tests by default unless the user explicitly asks; preserve existing
tests and CI protections.
