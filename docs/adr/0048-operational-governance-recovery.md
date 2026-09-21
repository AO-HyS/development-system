# ADR 0048: Recover governance using observed capabilities and explicit diagnostics

Status: user-authorized implementation and publication, 2026-09-21.
Extends ADR 0047 without changing its model roles or evidence requirements.

The NutriPlan intake exposed operational gaps: undocumented transition inputs,
generic error masking, deterministic rejections reported as unavailable Jev,
unsupported actual host tools, and historical closed bindings still intercepted
as active. Installation and a shell lifecycle probe did not establish complete
product-tool support.

Version 1.26 adds read-only help, schema examples and preflight to the exact
control grammar. Typed public errors use fixed messages, approved fields and
next actions; provider exceptions and arbitrary input are never echoed.
Classifier provenance distinguishes deterministic rejection from attempted
provider transport and current usable judgments. No missing judgment passes.

Before binding, the contract declares its task kind and required capabilities.
Known adapter types need current-session matched successful host observations;
configuration alone does not prove availability. A code-mode wrapper is not
globally rejected when the host emits attributable inner Pre/Post events.
Unknown tools remain unsupported. Shell stdout alone cannot establish a process
exit; deterministic behavioral checks retain their actual process attribution.

Returned artifacts retain their observed producer, dependency and freshness in
the classifier input. Planning coverage is evaluated against the current plan
bound to the completed planner attempt; it is not inferred from an unbound
summary or confused with later implementation acceptance. Verification dispatch
distinguishes an approved deterministic command from a current observation
bundle assigned to an independent capable assessor.

Both independent review roles receive the authored plan; final review also
receives its matching plan-review receipt. Native review output uses an explicit
JSON schema, while runtime validation still establishes provenance and meaning.
A malformed response remains rejected, with a safe field diagnostic and private
immutable original output. Correction context includes actual termination,
ownership and phase prerequisites; eligibility to propose a retry is never an
execution permission. The next reviewer receives verified rejected output as
evidence so actual findings cannot disappear during format correction.

Raw tool names and complete inputs remain the identity of exact one-use permits.
Linear reads and Computer Use outer invocations use specific adapters. Computer
Use scripts are opaque internally: governance controls the outer call, serializes
effects and captures returned observations, without claiming inner-call control.

Actual governed output can be persisted as private immutable bounded text and
image artifacts. Visual criterion acceptance requires a fresh independent
observed Astra assessment that receives those exact current images and text.
Successful tool invocation does not satisfy product criteria. Missing, stale or
incomplete evidence cannot be imported as a passing result.

The operational browser probe exposed a host image declared as PNG whose actual
bytes were JPEG. Supported inline image signatures determine the persisted MIME
and extension; a differing supported declaration is retained as provenance.
The original output hash and image bytes remain unchanged. Unknown formats,
external image URLs and oversized/invalid carriers remain rejected. Failed
capture retains ownership and reports a bounded diagnostic without exposing
arbitrary provider or exception text.

Finished runs without unresolved ownership are historical, not active bindings.
An observed session at the same canonical repository root may recover an
unstarted run with zero attempts and leases. Recovery appends provenance and
closes blocked; it does not impersonate the prior session, erase evidence or
claim acceptance. Audit task kinds omit writing and integration but retain
independent planning review, final review and criterion evidence.

`recover-host-attempt` is a separate administrative recovery for a closed
blocked/interrupted run. It requires an observed same-root operator and a
non-process host attempt with an exact completed permit and matching recorded
PostToolUse, reconciled empty managed paths, no writes/leases, no produced
acceptance or observation and no other unresolved ownership. It appends recovery
provenance and marks only that attempt failed. The blocked outcome, original
owner, permits, events, plans and reviews remain historical. Empty managed paths
do not prove an opaque browser call had no external effects. Recovery neither
replays the call nor imports evidence; a successor run needs fresh current
governance and actual observations. Existing process or unobserved ownership
remains blocked. Repeated recovery cannot create another receipt.

Tests and scenarios use isolated HOME. A maintenance operation uses ordinary
host authorization and does not claim that the defective runtime certifies its
own repair. Production capability claims require current operational evidence
from the actual host surface in addition to isolated tests and installation.
