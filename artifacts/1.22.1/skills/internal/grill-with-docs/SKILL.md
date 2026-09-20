---
name: grill-with-docs
description: Run one recoverable interview for functional, visual, or mixed software grills; reuse equivalent answers and offer the shared HTML questionnaire.
---

# Grill With Docs

Use when the user asks to define an idea through questions, refine planning
documents conversationally, or run a software or design grill. This is not an
automatic gate for ordinary implementation.

Reuse settled decisions. Use `grilling` for the interview and `domain-modeling`
when domain concepts need clarification. Ask useful questions for one topic
together, with recommended options and concrete examples. Stop questioning when
the user asks to proceed, skip ceremony, create a spec, or implement.

Use one interview per session. Give each question a stable decision key such as
`task.primary`, `identity.palette`, `composition.density`, or
`interaction.panel-open`. An existing literal answer satisfies every equivalent
question from another skill; link it instead of asking again. Recover answers
from the exact saved response path, the current brief/spec, and referenced
earlier rounds before composing new questions. Preserve corrections verbatim and
mark tentative, deferred and rejected proposals as such.

For a visual or mixed grill, `design-direction` leads topic selection. Ask only
for unresolved decisions that change the next visible proposal. Show accessible
references, including useful images in the questionnaire, before asking the user
to invent an abstract style vocabulary. The questionnaire owns questions,
constraints, references and literal corrections; it does not compare or select
directions. Impeccable's decision page is the only runtime surface for that.
Do not require the complete application's functional contract before producing
a useful bounded visual exploration. If all proposals are rejected, record the
correction and return it to Impeccable's steer or re-roll path; rejection is not
approval and does not force a choice.

## Questions in HTML

For a grill, prefer the bundled questionnaire: the user reads and answers in
HTML, submits, then tells the agent in chat that they answered. Respect a request
to keep questions in chat. The HTML changes where questions are answered; it
does not add a planning stage.

Read [the questionnaire reference](references/questionnaire.md) when preparing
HTML or retrieving submitted answers. Reuse `assets/questionnaire.html` and
`scripts/questionnaire.py`; write only the small question JSON for each round.
Attach a reference image only when seeing it helps answer that question. Give
each image accessible alternative text and state the quality it illustrates;
the helper embeds a safe local raster so the questionnaire stays recoverable.
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

For a visual-design grill, use `design-direction` to prepare Impeccable's decision
page and preserve the selected direction. Reuse the same decision keys without a
second interview or another comparison page. Before creating specs or tickets,
complete its visual handoff: selected images must be retrievable and visible to
a fresh thread, with the composition criteria that distinguish the approved
direction. Questionnaire images calibrate or clarify; they do not become an
approved direction without an explicit choice on Impeccable's page.
