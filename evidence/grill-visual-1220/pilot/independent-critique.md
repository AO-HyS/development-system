# Independent visual critique

Date: 2026-09-15 (America/Mexico_City)

Scope: one independent pass in Chrome through `comparison.html` at a 2560 ×
1296 browser viewport and a 2177 × 1120 prototype frame. The reviewer did not
read `blind-key.json`, receipts or implementer rationale and did not edit files.

The reviewer opened all three anonymous variants, their Expediente and Portal
states, and the panel from both views. They verified panel closing with the
visible close control in Variants 01 and 02, the return control in Variant 03,
and Escape in Variant 03, including visible focus return. A separate parent run
verified Escape, background unlock and exact trigger focus restoration in
Variant 01.

## 1. Conformity with confirmed constraints

### Variante 01

The portrait is discreet, content is bounded, both views exist, and the panel
overlays without reflow. Clinical priority is only partial: the generic “Lo que
importa hoy” headline dominates diagnosis, allergy and medication. The Portal
retains professional navigation and the “Consulta preparada” label, weakening
its patient-space perspective.

### Variante 02

Best visible correspondence with clinical priority and fewer simultaneous
words. Diagnosis is unambiguous, the portrait is subordinate and navigation is
explicit. Portal changes to an everyday accompaniment perspective and makes the
next food clear. The overlay behavior was observed.

### Variante 03

The portrait is discreet, both views exist, and the panel overlays. Its folio
language is a real alternative, but two introductory headlines and the large
day “18” outweigh the clinical signals. It also presents more explanatory text
at once.

All three use a visibly consistent dark-blue, blue-grey and light-surface
family. The reviewer did not receive a current product screenshot or calculated
token values, so exact product-palette fidelity was not certified. No admin view
was present.

## 2. Compositional quality against the reference bar

### Variante 01

Strengths: understandable grouping, a clear current-meal state in Portal, and a
well-grouped panel whose allergy is visually distinct.

Gaps: overly heavy display type and a generic headline dominate; supporting
clinical data has a much smaller scale. The strong blur removes most visual
continuity with the background while the panel is open.

### Variante 02

Strengths: best relationship between task, primary subject and supporting
content. Identity and diagnosis are immediate. The panel is easy to scan.

Gaps: the dark diagnosis surface is large for its content; small pale labels
are weak; the navigation rail consumes substantial width for two destinations.

### Variante 03

Strengths: aligned clinical rows are easy to compare, the horizontal folio
rhythm is structurally distinct, and the habits indicator is legible.

Gaps: introduction, repetition and ornamental scale are excessive. In Portal,
the large gap between the opening line and meal task breaks proximity.

## Priority findings

1. Variante 03 / Expediente: reduce the introductory lines and date dominance;
   start with identity and priority while preserving the strong clinical rows.
2. Variante 01 / Expediente: make diagnosis, alert and values the first reading
   level; demote the generic headline.
3. Variante 01 / Portal: use patient-specific navigation and voice. The panel
   also contains a professional instruction in a patient view.
4. Variante 03 / Portal: reduce empty height and move meals closer to the task
   heading.
5. All panels: remove explanatory copy about the overlay mechanism from the
   product surface; keep the content focused on clinical or personal context.

## Cross-variant judgment

- Useful diversity: moderate. Navigation, grouping and signal placement differ;
  all three still rely on one large block, heavy display type and secondary cards.
- Fidelity: Variante 02 is most consistent with the visible constraints.
- Clarity: Variante 02 leads in Expediente; Variante 01 communicates meal state well.
- Information load: Variante 02 is most restrained.
- Finish: no clipping was found at the reviewed size, but compositional gaps remain.

Provisional reviewer preference: **Variante 02**. This is exploratory criticism,
not user selection, product approval or final acceptance.

## Limits

The pass did not verify mobile, tablet, zoom, calculated contrast, interactive
messages/meals or durable persistence. The hierarchy findings remain open by
design: changing pilot arms after observing results would contaminate the
comparison. They should be addressed only after a real user selection or a new,
explicitly versioned pilot round.
