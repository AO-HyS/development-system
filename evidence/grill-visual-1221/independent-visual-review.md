# Independent visual review — 1.22.1 correction

The critic received the task, confirmed constraints, rendered questionnaire and
real Impeccable decision page without implementer rationale or self-scores. No
answers, direction selections or product writes were made.

## Constraint conformity

- One questionnaire contains the reference image, descriptive alternative text,
  caption, named function, response choices and literal free-text field.
- It contains no direction-selection controls. The real Impeccable page contains
  exactly three direction cards plus steer and re-roll.
- No answer or direction was preselected. The existing green/cool-paper language
  remains recognizable; exact equality to external tokens was not certified.

## Compositional quality

The reference block remained readable and uncropped at 1440 × 900 and 390 × 844.
The first pass found that the expanded pending list delayed the first question
and that a free-text question displayed an inapplicable choice instruction and
clear-choice action. After correction, the critic confirmed:

- pending questions start collapsed and still expand;
- the free-text question keeps its literal field and defer action without choice
  copy or a clear-choice button;
- no new clipping appeared in the affected states.

The mobile questionnaire still spends its first viewport on orientation copy;
this is a non-blocking density observation, not a failure of the new reference
block.

## External Impeccable renderer limits

At 390 × 844, Impeccable's floating Back control overlapped wireframe labels on
the second and third cards. Its accessibility tree named each drawing only
“Layout schematic” instead of exposing the specific region relationships. The
desktop three-card comparison was legible and equal-salience. These are findings
in the installed Impeccable renderer, not this repository's payload. The local
candidate records them and does not hide them with a fork or second chooser.

Scope: questionnaire at 1440 × 900 and 390 × 844; Impeccable at desktop and
390 × 844. The follow-up covered only the two corrected questionnaire states.
This review does not prove answer persistence, user approval, complete screen-
reader navigation or product mobile adaptation.
