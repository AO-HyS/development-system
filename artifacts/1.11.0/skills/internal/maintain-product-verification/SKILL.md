---
name: maintain-product-verification
description: Maintain an existing project-local verification skill and feature map with a fast evidence pass when explicitly requested.
---

For visual work, finish Impeccable, obtain independent Astra visual critique,
resolve its findings, then record final delivery evidence from that candidate.
Working screenshots may support critique. Astra retains live Computer Use;
Luna may prepare bounded scripts or media files, never inherit browser control
merely to reduce model cost. See `design-quality` and `evidence-capture`.


For recorded UI evidence, use `evidence-capture`: one session driver, stable
host-tool batches and compact receipts. Luna may prepare scripts and media;
Astra keeps acceptance and visual judgment. Existing valid verification evidence
is reusable while candidate, state and environment match. Honor explicitly
requested exhaustive coverage; ordinary changes use a representative flow plus
distinct risk states.


# Maintain Product Verification

Use this skill when a repository already has `verify-<product>` (or its
documented equivalent) and the operator asks to refresh coverage, verify a
feature, or check for drift. It is an explicit maintenance action, not an
automatic step in every feature task.

## Maintenance loop

1. Read repository instructions and the current Feature Map.
2. Inspect source changes, routes, roles, fixtures, and existing harness
   commands for each mapped feature.
3. Reuse the repository harness and run one live pass for the requested
   feature. Capture deterministic probes before and after the pass.
4. Send only neutral execution steps to the Astra computer-use runner. Keep
   the acceptance rubric private to the Astra orchestrator/judge.
5. Update only the verification skill, harness, feature map, or private
   evidence needed to make the capability truthful. Do not edit product code
   as a hidden response to a verification finding.

Report one of these outcomes:

- `clean`: mapped behavior and evidence still agree;
- `changed`: verification artifacts were updated and the new proof is valid;
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
