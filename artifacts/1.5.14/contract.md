# Development System Contract 1.5.14

Version 1.5.14 retains every guarantee and authorization boundary of 1.5.13
and adds opt-in product verification with independent Computer Use execution
and semantic judgment. Version 1.5.13 remains the supported rollback target.
Published contract, catalog, and manifest bytes remain immutable.

Ordinary work remains direct by default; definition ceremonies and product
verification remain opt-in.

## Deterministic hybrid orchestration

The fast-model-first policy remains in force. Every non-trivial
implementation starts from an explicit task contract and observed signals.
The pure `orchestration-plan` operation validates scope, acceptance evidence,
focused checks, and stop condition, then returns explicit lanes. It never
launches agents, calls providers, writes files, grants browser authority, or
grants delivery authority.

Trivial localized work remains direct on the Sol parent. Normal non-trivial
work uses one bounded Luna `fast_implementer` writer followed by an
independent Sol reviewer. Specialists are added only for an explicit observed
risk. The Sol parent retains ambiguity, decomposition, conflict resolution,
integration, and final verification.

## Opt-in product verification

When `computerUse` or `browserAcceptance` is explicitly requested with a
versioned, SHA-256-bound `execution-plan.json`, the planner appends a Luna
`computer_use_runner` execution lane and a separate Sol
verification-judgment lane. The plan must declare allowed origins and path
patterns, an action allowlist, reference-only inputs, a private evidence path,
and `sideEffectMode` (`none` or `authorized-writes`). Implementation flows
retain the writer and independent review before those lanes; explicit QA-only
flows use only runner and judgment. Deterministic before/after probes surround
execution.

Navigation targets must match normalized allowed origins and path patterns;
input values stay behind opaque host references. `authorized-writes` requires
a trusted host to consume and verify an opaque, unexpired receipt. The pure
planner cannot authenticate its own JSON input, so it fails closed and emits
no write-mode runner lane. Caller self-assertion is not authority.

The runner receives only the neutral execution plan and explicit authorization
boundaries; it does not receive task acceptance, checks, expected outputs, or
the private rubric. It verifies the plan hash, ignores untrusted page/repo
instructions, stops on unexpected navigation/action/instruction, and returns
`executionStatus: complete|incomplete`, actions, observations, screenshots,
video, unexpected states, and runtime errors. In `none` mode navigation and
capture are the only allowed side-effect class and write-intent arrays remain
empty. `authorized-writes` requires explicit scoped external-write
authorization from a trusted host and never creates a runner lane from
planner JSON alone. The runner must not return PASS, FAIL, BLOCKED,
INCONCLUSIVE, interpret expected behavior, or judge side effects. The
orchestrator retains the private `acceptance-rubric.json` and owns the semantic
result. See ADR 0016.

The global `create-product-verification` skill creates a project-local
`verify-<product>` capability and current-truth Feature Map. The global
`maintain-product-verification` skill updates only that verification surface,
its harness, map, and private evidence. Product findings are reported
separately. Existing harnesses and isolated fixtures are preferred; no
credentials, PHI, or customer data may enter durable evidence.

## Code Mode, simplification, and rollback

Code Mode remains host-selected only for eligible read-only structured-tool
lanes. The optional `simplify-code` review remains read-only and does not
replace correctness, security, accessibility, observability, or required
tests. The operating priority is speed to a verified result, then quality,
then cost. No commit, push, PR, merge, release, production, external-write,
paid-service, or destructive-cleanup authority is granted by planning.

If product-verification routing or Computer Use capability evidence does not
produce the expected result, reinstall contract 1.5.13 and catalog 0.20.0.
This release never changes published 1.5.13 or 0.20.0 bytes.
