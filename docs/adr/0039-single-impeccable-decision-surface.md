# ADR 0039: One Impeccable decision surface for visual grills

Status: accepted for local contract 1.22.1, September 16, 2026. Supersedes
ADR 0038 only where that decision used the generic word “comparison”.

## Context

Contract 1.22.0 correctly separated visual discovery, interview recovery and
independent critique, but its language allowed a second comparison page to be
created beside Impeccable's own decision page. The pilot consequently produced
both a custom corrected-flow chooser and a blind experimental comparator. That
duplication did not collect a decision Impeccable could carry into its build
path, and made the questionnaire, experiment and product workflow look like
three competing owners.

The public article still informs the method, but it does not require a custom
chooser. Impeccable already renders the dealt directions together, supports
steer/re-roll/reject behavior and records the locked choice. `grill-with-docs`
can make abstract questions concrete by embedding accessible reference images.

## Decision

- Impeccable's generated decision page is the only runtime comparison and
  selection surface for open visual directions.
- `design-direction` recovers decisions, classifies the branch, records
  candidates before `concept-seed`, and preserves continuity. Its ordered
  receipt is `candidates → concept-seed → Impeccable decision page → selection`.
- `grill-with-docs` owns one interview, questions, constraints, accessible
  visual references, literal corrections and answer persistence. Its HTML may
  show images beside a question but never selects a direction.
- `design-quality` and the independent `visual-reviewer` own the two-part
  critique after rendered work exists. They do not add a chooser.
- The old blind page is retained only as archived pilot evidence. It is not
  installed, routed, linked as the next workflow step or reused for a product
  decision. The redundant corrected-flow chooser is removed.
- Article-derived operational rules live in the versioned skills. The article
  URL remains provenance and is not needed in a new thread.

## Consequences

The user answers questions in one HTML surface and chooses a visual direction in
one Impeccable surface. Reference images can travel with questions without
turning the questionnaire into a concept tournament. A pilot may still use a
blinded evaluator when an experiment explicitly needs one, but it is labeled
historical/experimental and cannot become the product workflow by accident.

Contract 1.22.1 and catalog 0.43.1 publish the correction without rewriting the
immutable 1.22.0 artifacts or manifests.
