# ADR 0021: Muse Spark 1.3 Contributor bounded pilot

Status: Accepted — explicit operator opt-in, 2026-09-04.

## Context

ADR 0020 kept Muse Spark Contributor outside automatic private-code routes
because its training terms differed, allowing only an isolated synthetic
exercise without general coding certification. The operator has now
explicitly resolved the Contributor opt-in and authorized its use,
understanding the provider data policy.

One synthetic run on 2026-09-04 observed `opencode-go/muse-spark-1.3-contributor`
invoked via OpenCode completing 18/18 independent cases in 18.737s vs
`opencode-go/glm-5.3-flash` at 35.734s. n=1; self-checks were flawed on both
sides; no general quality superiority is claimed.

## Decision

Activate `opencode-muse-spark-1.3-contributor`
(`opencode-go/muse-spark-1.3-contributor`, harness `opencode`, reasoning
`high`, `mappingStatus: provisional`, `evidenceStatus: runtime-required`,
boundary `provider:opencode-go`) as the first bounded implementation
candidate. Preserve the existing GLM / Qwen / Devin / Factory / Luna order
after it. Apply the same selection policy as GLM: no
`requiresVerifiedRuntimeAvailability` on Muse; the resolver still reports
`resolvedModel: null` without a matching receipt, and existing provider
policy errors already produce typed policy-blocked fallback. Resolver
semantics are unchanged.

Production routing remains provisional with parent reviews: ordinary review
stays with Astra, complex independent review stays Factory Fable then Devin
Fable then Astra, and Astra UI/computer-use judgment is unchanged.

## Consequences

This ADR supersedes only the Muse exclusion clause of ADR 0020, based on the
new opt-in and observed invocation. All other ADR 0020 assignments,
ownership, safety, and authorization constraints remain, and its history is
not erased.
