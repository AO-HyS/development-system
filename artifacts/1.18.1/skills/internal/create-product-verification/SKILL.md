---
name: create-product-verification
description: Create a project-local verification capability for a real product UI when explicit acceptance needs repeatable browser evidence.
---

The starting model remains the orchestrator. It selects available agents within
the user's provider limits. Assign live Computer Use to a capable runner and
visual judgment to a capable judge; roles and actual host capability matter,
not model names. Keep neutral execution separate from acceptance judgment.
Record observed model identity rather than inferring it from roster defaults.

For visual acceptance, use `design-quality` for Impeccable and independent
critique, resolve material findings, then use `evidence-capture` for final media.
Diagnostic screenshots may support critique. Reuse evidence while candidate,
state and environment match. Internal contract maintenance without an affected
UI surface uses focused validation; it does not require a new browser recording.

# Create Product Verification

Use this skill only when the operator explicitly requests a product
verification capability, asks for real browser acceptance, or is preparing a
repository that does not yet have one. It is not a default ceremony for
ordinary implementation.

## Inspect first

Read the repository instructions and identify the product's current truth.
Map the feature surface, how it runs, how an authorized user drives it, how
state and side effects can be observed, and how the environment is isolated.
Reuse existing scripts, fixtures, test accounts, preview commands, and
artifact conventions. Do not invent a second harness when the repository
already has a reliable one.

## Generate a local capability

Create the repository's canonical `verify-<product>` skill (or update the
existing equivalent) with a small current-truth Feature Map. Each mapped
feature must name its launch route, role/fixture, discriminating behavior,
deterministic probes, cleanup, and evidence location. Keep private evidence
out of source control and exclude credentials, tokens, PHI, and customer data.

Keep the execution plan and acceptance rubric separate:

- `execution-plan.json` contains only neutral typed steps, exact origin/path
  and action allowlists, reference-only inputs, side-effect mode, and the
  host-owned evidence path. Its `sha256` binds canonical JSON in schema order
  with normalized step keys and the `sha256` field omitted. Every navigation
  target must satisfy the declared origin and path policy. Inputs are opaque
  `fixture.*`, `host.*`, `session.*`, or `vault.*` references resolved only by
  the authorized host; never place values in the plan.
- `acceptance-rubric.json` remains private to the orchestrator/judge. Never
  materialize it in the repository, shared workspace, runner prompt, execution
  plan, or evidence directory.

The generated capability must support before/after side-effect probes and a
single mapped end-to-end proof before handoff. A proof is evidence, not a
claim: record exact route, identity, viewport, steps, screenshots/video,
probe results, runtime errors, and cleanup.

The pure planner never authorizes `authorized-writes`: data supplied in its
own JSON cannot prove authority. A trusted host must consume and verify an
opaque, unexpired receipt before dispatching any write-mode run. Until the
host exposes that capability, write-mode plans stop without a runner lane.

## Computer Use boundary

The capable Computer Use runner executes authorized UI steps and returns a
neutral execution record. It may report incomplete execution, observations,
screenshots, video, and runtime errors, but it must not decide whether the
product passed, failed, was blocked, or was inconclusive. The verification judge
retains the rubric, compares evidence with before/after probes, and owns that
semantic judgment.

Do not grant browser authority from this skill or from the pure planner. Use
the existing authorized browser/profile only when the operator has authorized
it. Stop and report missing credentials, destructive actions, or ambiguous
environment routing.

See `references/feature-map.md`, `references/execution-plan.schema.json`, and
`references/execution-record.md` for the minimum portable shapes. Use the
global `skill-creator` skill for general skill authoring and validation; do not
duplicate its guidance here.
