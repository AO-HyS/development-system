# Model routing operator contract (1.5.16)

`model-route` is a pure, read-only policy operation. It consumes the versioned
capability roster plus host-observed candidate availability and returns a
selection, ordered attempts, and a fallback trace. It does not invoke Factory,
Devin, Codex, or any provider.

For high-value adversarial review the declared order is Factory Droid
`claude-fable-5.1`, Devin `claude-fable-5.1`, then Codex `gpt-5.6-sol`.
Fable and Sol use `xhigh` by default. `max` is allowed only for the selected
Codex Sol candidate when an explicit critical escalation is present.

For broad mechanical execution the order is Devin `swe-1-7`, Factory
`glm-5.3-flash`, Devin `gemini-3.8-flash` only with current runtime evidence,
then Codex Luna with reasoning `max` on the priority/fast service path. The
parent resolves and attempts the route before dispatch, verifies exact path
confinement and authorization, and treats quota, unavailable, unsupported,
policy, model-mismatch, and latency-budget evidence as typed fallback. A
provider/runtime receipt is required before the parent claims the resolved
model. The Codex `fast_implementer` runs only when the Luna fallback is
selected. Everyday implementation is never Codex Luna High. The declared
order is operational; receipts measure actual latency and correctness without
silently reordering it. Trivial mechanical edits use the same route, while the
Sol parent retains deliberation and integration judgment.

`escalation: true` changes the selected Codex Sol reasoning level to `max`;
Fable remains `xhigh`. Escalation is for explicit security/authorization risk,
transversal architecture, measured non-convergence, or critical release
review. It is not a default cost setting.

`quota-exhausted`, `unavailable`, `unsupported`, `policy-blocked`,
`latency-budget-exceeded`, and `timeout` are the unavailable reasons. A quota
failure advances only to the next declared candidate and records the provider
boundary. Exhaustion returns `valid: false` and `blocked: true`. No provider
is silently substituted. Bare model-only availability facts that match
multiple provider candidates fail closed instead of being arbitrarily consumed
once; a receipt-named observation on the selected candidate is the only state
that may report the actual resolved model.

Every result includes `requestedModel`, `resolvedModel`, `resolvedModelStatus`,
`reasoning`, `evidenceStatus`, `mappingStatus`, deterministic invocation
descriptors, `attempts`, `fallbackTrace`, and `authority.dispatchAuthorized:
false`. `resolvedModelStatus` is `receipt-required` until a matching
observed-model receipt exists, then `receipt-matched` with the actual resolved
model. `provisional` and `runtime-required` are honest states, not validation
claims.

Invocation descriptors use the current CLI shapes: `droid exec --model ...
--reasoning-effort ...`, `devin --model <exact-model-uid> --print`, and `codex
exec --strict-config --model ... --config model_reasoning_effort=... --config
service_tier=\"priority\"`. The runtime adds only task-authorized
permission, sandbox, worktree, and prompt arguments. A Codex response receipt
must report the effective priority tier before the route calls the fallback
"Fast".
