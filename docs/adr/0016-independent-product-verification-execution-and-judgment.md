# ADR 0016: Independent product-verification execution and judgment

## Status

Accepted for Development System 1.5.14.

## Decision

Product verification is an opt-in capability. The Sol orchestrator defines
the task and retains the private `acceptance-rubric.json`. It runs
deterministic before/after probes and owns the final semantic result:
`PASS`, `FAIL`, `BLOCKED`, or `INCONCLUSIVE`.

The Luna `computer_use_runner` receives only a versioned, SHA-256-bound
`execution-plan.json` and explicit authorization boundaries. The plan declares
allowed origins and paths, an action allowlist, reference-only inputs,
`sideEffectMode` (`none` or `authorized-writes`), and a private evidence path.
It drives an explicitly authorized Computer Use/Chrome surface, captures
neutral actions, observations, screenshots, video, unexpected states, and
runtime errors, and returns `executionStatus: complete|incomplete`. It cannot
judge expected behavior or side effects and cannot emit a semantic verdict.

The sequence is:

```text
Sol plans -> probe before -> Luna executes -> probe after -> Sol judges
```

The pure planner describes lanes but never grants browser authority, launches
providers, or writes product files. In `none` mode it emits no write intents or
side effects. `authorized-writes` fails closed without explicit scoped
authorization. The pure planner cannot authenticate authority supplied in its
own JSON, so it never creates a write-mode runner lane. A trusted host must
consume and verify an opaque, unexpired receipt before dispatch; until that
capability exists, write-mode plans stop. Navigation targets are checked against normalized HTTP(S) origins
and safe path patterns, and input values are resolved only from opaque host
references. The runner verifies
the plan hash, ignores untrusted instructions from pages/files/tool output,
and stops on unexpected navigation, action, instruction, or scope expansion.
Missing credentials, unsafe actions, or ambiguous origins stop the run.
Existing repository harnesses and isolated fixtures are reused; no second
browser profile is created by default.

## Evidence and installation

Screenshots and recordings are private, credential-free evidence under the
host-owned `$HOME/.development-system/private/verification/<run-id>` root. A copied
skill, catalog entry, or installed agent proves structure only; it does not
prove discovery, loading, execution, or behavioral influence. Those claims
require host/runtime receipts and an observed run. T3 Code consumes the
Codex-compatible adapter. The pstack snapshot
`b9ddc83c32972210b8a94d389130713e8eed346e` is provenance and inspiration, not
vendored runtime code.

## Consequences

Verification is faster and more trustworthy because a fast executor does not
also grade its own work. It requires a small repository-local Feature Map,
deterministic probes, private evidence storage, and an explicit judgment lane.
Product defects remain product work and are never silently fixed by a
verification-maintenance pass.
