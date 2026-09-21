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

Raw tool names and complete inputs remain the identity of exact one-use permits.
Linear reads and Computer Use outer invocations use specific adapters. Computer
Use scripts are opaque internally: governance controls the outer call, serializes
effects and captures returned observations, without claiming inner-call control.

Actual governed output can be persisted as private immutable bounded text and
image artifacts. Visual criterion acceptance requires a fresh independent
observed Astra assessment that receives those exact current images and text.
Successful tool invocation does not satisfy product criteria. Missing, stale or
incomplete evidence cannot be imported as a passing result.

Finished runs without unresolved ownership are historical, not active bindings.
An observed session at the same canonical repository root may recover an
unstarted run with zero attempts and leases. Recovery appends provenance and
closes blocked; it does not impersonate the prior session, erase evidence or
claim acceptance. Audit task kinds omit writing and integration but retain
independent planning review, final review and criterion evidence.

Tests and scenarios use isolated HOME. A maintenance operation uses ordinary
host authorization and does not claim that the defective runtime certifies its
own repair. Production capability claims require current operational evidence
from the actual host surface in addition to isolated tests and installation.
