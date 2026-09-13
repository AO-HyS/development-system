---
name: grill-with-docs
description: Interview the user and maintain specs when they request a software or design grill; reuse settled answers and offer the shared HTML questionnaire.
---

# Grill With Docs

Use when the user asks to define an idea through questions, refine planning
documents conversationally, or run a software or design grill. This is not an
automatic gate for ordinary implementation.

Reuse settled decisions. Use `grilling` for the interview and `domain-modeling`
when domain concepts need clarification. Ask useful questions for one topic
together, with recommended options and concrete examples. Stop questioning when
the user asks to proceed, skip ceremony, create a spec, or implement.

## Questions in HTML

For a grill, prefer the bundled questionnaire: the user reads and answers in
HTML, submits, then tells the agent in chat that they answered. Respect a request
to keep questions in chat. The HTML changes where questions are answered; it
does not add a planning stage.

Read [the questionnaire reference](references/questionnaire.md) when preparing
HTML or retrieving submitted answers. Reuse `assets/questionnaire.html` and
`scripts/questionnaire.py`; write only the small question JSON for each round.
Share a tunnel when available and authorized by the session. Give the user the
actual working link and retain the exact `responsesPath` returned by the script.

When the user says they answered, read that file and continue the interview in
chat. Preserve literal partial answers, comments and deferred questions. If no
submission exists, distinguish an unsubmitted browser draft from saved answers.
If further questions are needed, render a new JSON with a new questionnaire ID
through the same template. Do not overwrite earlier questions or answers.

Keep the existing planning document current as the conversation requires. Do not
build automatic HTML brief rewriting, a cross-thread session manager, polling,
or an agent loop waiting for Submit. In an unfamiliar thread, locate the exact
questionnaire by its topic or supplied path; do not guess which answers apply.

## Design handoff

For a visual-design grill, use `design-direction` to compare alternatives and
preserve the selected direction. Reuse that interview without a second question
round. Before creating specs or tickets, complete its visual handoff: selected
images must be retrievable and visible to a fresh thread, with the composition
criteria that distinguish the approved direction. The questionnaire does not
replace those reference images or acceptance criteria.
