---
name: maintain-product-verification
description: Maintain an existing project-local verification skill and feature map with a fast evidence pass when explicitly requested.
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

# Maintain Product Verification

Use this skill when a repository already has `verify-<product>` (or its
documented equivalent) and the operator asks to refresh coverage, verify a
feature, or check for drift. It is an explicit maintenance action, not an
automatic step in every feature task.

## Maintenance loop

1. Read repository instructions and the current Feature Map.
2. Inspect source changes, routes, roles, fixtures, and existing harness
   commands for each mapped feature.
3. For an affected product flow, reuse the repository harness and run the
   requested live pass with deterministic before/after probes. For a contract
   or skill-only change, validate that contract without claiming product coverage.
4. Send only neutral execution steps to the capable Computer Use runner. Keep
   the acceptance rubric private to the verification judge.
5. Update only the verification skill, harness, feature map, or private
   evidence needed to make the capability truthful. Do not edit product code
   as a hidden response to a verification finding.

Report one of these outcomes:

- `clean`: mapped behavior and evidence still agree;
- `changed`: verification artifacts were updated; identify whether validation
  covered the contract or a live product flow;
- `blocked`: the environment, credentials, route, or safety boundary prevents
  a valid proof.

Report product defects separately with route, reproducible steps, evidence,
and impact. The runner never emits PASS/FAIL/BLOCKED/INCONCLUSIVE and never
judges side effects; the orchestrator owns semantic acceptance after comparing
the rubric with execution evidence and before/after probes.

Keep screenshots and recordings private, credential-free, and reversible.
Do not claim a feature is covered because a file exists or a command was
installed: coverage requires an observed run and evidence artifacts. Store
those artifacts only under `$HOME/.development-system/private/verification/<run-id>`
and use the host-provided path in the maintenance record.

See `references/maintenance-record.md` for the record shape. The runner never
writes the repository or workspace.
