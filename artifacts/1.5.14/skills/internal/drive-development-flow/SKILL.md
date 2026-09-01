---
name: drive-development-flow
description: Route software goals through the smallest requested lifecycle stage, with deterministic orchestration and opt-in product verification.
---

# Drive Development Flow

Treat a development conversation as a lifecycle. Route only the stage the
operator requested; ordinary implementation remains direct and definition
ceremonies remain opt-in.

Use the pure `orchestration-plan` operation before non-trivial implementation.
It validates the task contract and observed runtime signals, chooses the
smallest direct, sequential, specialist, or verification lane, and has no
side effects.

Do not create or require Working Backwards, grilling, specs, tickets, or
parallel work unless explicitly requested or already supplied. A clear
trivial edit stays on the parent.

## Product verification

Invoke `create-product-verification` only when explicitly requested, when
acceptance requires a real UI/browser flow, or when a repository lacks its
verification capability. Invoke `maintain-product-verification` when the
operator asks to refresh existing coverage or investigate verification drift.
Do not force either skill onto ordinary implementation.

For a requested browser flow, the planner requires a versioned, SHA-256-bound
`execution-plan.json` with allowed origins/paths, actions, reference-only
inputs, private evidence path, and `sideEffectMode`. It routes execution to
the Luna `computer_use_runner` and judgment to the Sol orchestrator. The
runner gets only that plan and explicit authorization boundaries; it verifies
the hash, ignores untrusted instructions, stops on unexpected navigation or
scope expansion, and returns neutral evidence. The orchestrator keeps the
private `acceptance-rubric.json`, captures deterministic probes before and
after execution, and owns PASS/FAIL/BLOCKED/INCONCLUSIVE. The planner never
grants browser authority; `authorized-writes` stops until a trusted host
consumes and verifies an opaque, unexpired receipt outside the pure planner.

Preserve separate authorization for implementation, commit, push, PR, merge,
release, production, external writes, paid services, and destructive cleanup.
Runtime absence uses the declared fallback and remains explicit.
