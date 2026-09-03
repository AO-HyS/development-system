# ADR 0018: Explicit fast-model fallback with evidence-bound routing

## Decision

Development System 1.5.16 keeps Codex and T3 Code canonical for lifecycle and
review. The ordinary implementation route and all mechanical, non-deliberative
work follow one shared ordered runtime attempt chain: Devin SWE-1.7
(`swe-1-7`), Factory Droid GLM 5.3 Flash (`glm-5.3-flash`), Devin Gemini 3.8
Flash (`gemini-3.8-flash`) only when current runtime availability is verified,
then Codex GPT-5.6 Luna with reasoning `max` on the priority/fast service path.
`implementation-default` is no longer Luna-first; it references the same shared
chain as the `fast-execution` mechanical route so the two cannot drift. The
route applies to trivial edits, code/file search, file creation, code
generation, evidence collection, and focused tests. Its order is the user's
operational policy; receipts measure latency and correctness but do not
silently reorder it.

The high-value `adversarial-review` route is ordered across independent
provider boundaries: Factory Droid Claude Fable 5.1, Devin Claude Fable 5.1,
then Codex GPT-5.6 Sol. Fable is not the everyday writer.

The pure resolver records every attempted candidate, typed unavailable reason,
quota boundary, requested and next-attempt model, reasoning, evidence status,
and mapping status. It never calls a provider or grants dispatch authority.
A pure selection exposes the requested model and `resolvedModel: null` plus a
receipt-required state until a matching observed-model receipt exists; a
matching receipt may then report the actual resolved model, and a mismatch is
a failed attempt that advances. Bare model-only availability facts that match
multiple provider candidates fail closed instead of being arbitrarily consumed
once. Malformed observations and candidates fail closed.
`latency-budget-exceeded` and `timeout` are typed unavailable reasons so fast
failure is representable. An exhausted route is blocked (fail closed); fallback
is never an inferred or silent substitution, and no provider or quota boundary
is crossed silently. A provisional or runtime-required route remains labeled
as such until an operational receipt proves it.

Version 1.5.15 remains immutable and is the rollback target. The skill catalog
moves to 0.23.0 with a new immutable 1.5.16 `coding-orchestration` skill copy
and a new immutable 1.5.16 `fast_implementer` agent artifact (Luna, `max`);
catalog 0.22.0 and the 1.5.15 agent artifacts stay untouched rollback targets.
Factory and Devin are model/harness routes, not skill installations or
lifecycle authorities. Computer Use remains Codex Luna Max execution with
separate Sol judgment and the existing visible-acceptance boundaries.
Fable 5.1 uses `xhigh` by default and is never elevated by this resolver.
`max` is reserved for the selected Codex Sol fallback on explicit critical
escalation for risk, authorization, cross-repository architecture,
non-convergence, or critical release review.
