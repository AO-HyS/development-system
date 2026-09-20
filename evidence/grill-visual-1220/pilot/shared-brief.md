# Blind pilot brief

Build one isolated, reviewable HTML/CSS/JS exploration for a fictional NutriPlan
clinical product. This is synthetic evidence only; do not edit NutriPlan or use
its sessions. The output remains exploratory and must not imply user approval.

## Same task for every condition

Create one cohesive direction with two switchable views:

1. **Expediente:** clinician reviews the record of Mariana Torres, 38. Primary
   task: understand immediate clinical context before the next consultation.
2. **Portal:** Mariana sees today's plan, next appointment and one progress
   signal without dashboard overload.

Add a working `Abrir contexto` interaction. It opens an overlay panel above the
current view without changing the background layout or scroll position. Closing
returns focus to the trigger. `Escape` closes it. Include reduced-motion behavior.

## Fixed synthetic data and states

- Patient: Mariana Torres, 38; next visit 18 Sep, 10:30.
- Clinical priority: diabetes type 2; shellfish allergy; metformin 850 mg;
  HbA1c 7.2%; weight trend -1.8 kg / 8 weeks.
- Today's portal: breakfast completed, lunch next; 2 of 4 habits completed;
  care-team message available.
- Context panel: recent lab note, medication, allergy, last contact.
- Default state is populated. Panel must have visible closed and open behavior.

## Confirmed constraints

- Preserve the existing palette and identity: warm off-white `#f0f4f2`, ink
  `#202f4b`, primary `#3a5779`, secondary `#5d8a9b`, pale blue `#c2d3d6`.
- Preserve Figtree-like headings and Plus Jakarta Sans-like body typography.
- Clinical information priority; fewer words visible at once.
- Discreet photographic portrait; imagery pertinent and subordinate to the task.
- Professional dashboard and patient portal. Admin is a later adaptation and is
  out of this pilot.
- Equal data, tasks, panel content and finish level across conditions.

## Reference functions

- NutriPlan tokens (`apps/dashboard/src/app/globals.css`): palette and identity.
- NutriPlan UI context (`apps/dashboard/docs/context/ui_design_system.md`): calm,
  typography, spacing and motion language.
- Synthetic portrait strip (`../../assets/synthetic-patient-portraits.png`):
  discreet photographic identity, never a hero image.

## Output contract

- Write only `index.html` and `receipt.json` in the assigned condition directory.
- The page must be self-contained except for the shared portrait asset.
- Implement both views and the overlay interaction; do not create a static mock.
- `receipt.json` records condition code, source instructions actually read,
  model/reasoning if observable, start/end timestamps, thesis, visible choices,
  expressive opportunity, concrete risk, checks performed and limitations.
- Do not read sibling condition directories. Do not disclose the condition in
  visible HTML. Use no network assets, secrets, real patient data or product writes.
