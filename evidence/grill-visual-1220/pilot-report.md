# Visual Grill 1.22.0 pilot report

## Outcome boundary

This is a bounded, synthetic, observational comparison. It demonstrates three
working responses, real browser behavior and an independent visual critique. It
does not establish universal superiority, user approval, clinical validation,
mobile adaptation or authority to extend a direction into NutriPlan.

The anonymous evaluator is retained as historical experimental evidence only;
it is not part of the installed or operational Grill flow:

- [`pilot/historical-blind-comparison.html`](pilot/historical-blind-comparison.html)

Record a preference and literal corrections before consulting the separate
mapping in [`pilot/blind-key.json`](pilot/blind-key.json). The mapping is not
loaded or linked by the evaluator page.

## Controlled case

All conditions received the same synthetic brief, palette, patient data, tasks,
states, portrait strip, requested surfaces and overlay interaction. Each wrote
only an `index.html` and `receipt.json` in its owned directory. NutriPlan was
read only for palette and UI-context references; no product file, session or
patient record was changed.

The orchestrator requested the same model family, reasoning setting, tools and
budget for all three workers. The exact resolved runtime model identity and
reasoning effort were not exposed consistently in the worker receipts, so model
equivalence cannot be certified and the result remains observational.

| Condition | Instruction source actually loaded | Elapsed wall time |
| --- | --- | ---: |
| A | Published current skills: 1.21.0 routing, 1.19.1 Grill, 1.18.0 design skills, 1.16.0 reviewer | 6m 56s |
| B | Public article material, shared brief and NutriPlan references; no current/corrected design skill | 6m 32s |
| C | Corrected 1.22.0 routing, Grill, design skills, references and reviewer | 7m 49s |

The exact file lists, checks, timestamps, thesis, visible choices and limitations
are in each receipt:

- [`pilot/condition-a-current/receipt.json`](pilot/condition-a-current/receipt.json)
- [`pilot/condition-b-article/receipt.json`](pilot/condition-b-article/receipt.json)
- [`pilot/condition-c-corrected/receipt.json`](pilot/condition-c-corrected/receipt.json)

## Article access and adaptation

The live public page exposed its introduction and techniques 1–6; technique 7's
body was behind the subscriber boundary and was neither read nor inferred. The
accessible method was adapted to local, provider-safe execution: broad
exploration, specific references, visible taste calibration, fresh-context
critique, grounded convergence checks, purposeful media and subtractive polish.
The local workflow does not need the article URL to operate. Details are in
[`article-access-note.md`](article-access-note.md).

## Browser execution

Chrome rendered the blind comparator and every variant over the local HTTP
server. The run exercised all six primary views (three Expediente, three Portal)
and all overlay panels. In Variante 01, Escape closed the panel, removed the
background lock and restored focus to the exact “Abrir contexto” trigger. The
panel remained over the current view without changing its layout.

The historical comparison form stores each variant independently in browser-local storage
and exports a blind JSON evaluation. It asks for diversity, fidelity, clarity,
information load, finish, literal corrections and a preference including
“Ninguna”. A score supports but never replaces visible observations.

## Independent critique

The reviewer was kept blind to the condition mapping and implementation
rationales. Their provisional preference is Variante 02 because it makes the
clinical priority most direct and keeps information load lowest. Variante 03 is
the most structurally distinct but lets editorial headlines and date compete
with the clinical task. Variante 01 communicates the current meal well but its
generic headline and professional framing weaken priority and patient voice.

The complete separate conformity and composition review is in
[`pilot/independent-critique.md`](pilot/independent-critique.md).

The findings were not applied to the pilot arms after observation; doing so
would invalidate the one-run comparison. Refinement is deliberately pending a
real user selection. If every option is rejected, the next round must preserve
the literal correction and change the hypothesis instead of forcing a choice.

The one required Impeccable detector pass also found low-contrast labels,
undersized functional text, overly tight display tracking and generated-UI
signatures inside the already-observed pilot arms. Those arms remain frozen as
experimental evidence. Mechanical contrast and font-stack findings in the
neutral comparison shell and the later redundant corrected-flow decision page were fixed;
the remaining prototype findings join the critique for any selected refinement.

## Corrected-flow procedure receipt

An additional bounded run recorded seven grounded structures, then ran the real
Impeccable surface `concept-seed` (`54e745af`), which dealt indices 3, 2 and 5.
Its custom chooser was subsequently identified as redundant and removed in
1.22.1. The corrected operational flow sends those dealt candidates to
Impeccable's own decision page instead.

- [`corrected-flow/pre-seed-candidates.json`](corrected-flow/pre-seed-candidates.json)
- [`corrected-flow/exploration-receipt.json`](corrected-flow/exploration-receipt.json)

The real generated Impeccable surface and its observable three-card receipt are
recorded in [`../grill-visual-1221/impeccable-decision-receipt.json`](../grill-visual-1221/impeccable-decision-receipt.json).

## Interpretation

The run shows that changing instruction sources can produce materially different
composition and interaction framing under the same brief. It does not isolate
causality perfectly because the platform did not expose exact resolved model
identity, and a single execution cannot estimate variability. The appropriate
next evidence is the user's blind preference and corrections, followed by a
focused refinement of only the selected direction.

The withheld mapping also prevents a causal overclaim: the blind reviewer
preferred Variant 02 (current skills), not Variant 03 (article direct). Variant
03 was the most structurally distinct but weakened the clinical hierarchy.
