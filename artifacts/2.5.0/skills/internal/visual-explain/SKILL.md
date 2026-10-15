---
name: visual-explain
description: Present a substantive plan or end-of-work delivery as an interactive visual in T3, preserving existing HTML questionnaires.
---

# Visual plans and deliveries

Use this for presenting a substantive plan and for closing nontrivial work.
Ordinary answers, progress updates and brief confirmations stay in text unless
the user asks for a visual. An explicit text-only request wins. Grill sessions
keep their existing HTML questionnaires, questions, drafts and submission flow.

The approved direction is **the line and the window**: one meaningful sequence,
a movable focus, and two annotations explaining the focused step. Draw the work
before arranging prose. Do not turn the output into a table, tabs, a dashboard,
repeated cards or a second questionnaire. Use the user's actual content and
authority; an approval marker records a real boundary, never creates one.

## Compose

- For a plan, show the objective, proposed work, dependencies and any real
  decision needed. The focused annotations say what the step includes and
  leaves out. Preserve an already approved plan and continue authorized work.
- For a delivery, show the actual result, evidence and remaining limits. The
  annotations say what was verified and what was not. Distinguish preparing,
  installing, loading and observed behavior; use pending/blocked honestly.
- Use 2–8 meaningful stages. Do not add stages to fill a template. If the work
  branches, say so in its annotations; never invent a linear dependency or
  reduce a comparison to a decorative timeline. A different visual explicitly
  requested by the user takes precedence.

Read [the approved direction](references/direction.md) for composition and
responsive behavior. Use [the packet reference](references/packet.md) and adapt
the plan or delivery example in `examples/`. The renderer supplies the approved
mechanics; do not independently redesign them for each response.

```sh
node /absolute/path/to/visual-explain/scripts/render.mjs --input /private/packet.json --output /private/visual.html
```

All output is self-contained. Text is escaped, there are no remote resources,
storage, submissions, clipboard actions or external calls. Focusing a stage
only changes the local explanation. Keep secrets and private transcripts out.

## Verify and deliver

Only the parent publishes the visual in its owning thread. Discover T3 tools
from the live catalog. Use `html_preview` on the exact HTML before `html_render`;
use the measured content height within the host's limit. Retain the candidate
hash and any unreadable, inaccessible or unverified state. Reuse an unchanged
candidate's valid evidence. Browser authority, review budgets and required
specialist roles still apply; this skill grants no extra sessions or effects.

Check the focused stage, annotations, keyboard, mobile reflow, both themes and
reduced motion within the authorized pass. Meaningful visual changes need
independent critique against the approved direction, not only a clean console.
Resolve material findings before describing the result as accepted.

If T3 preview/render is unavailable or not authorized, deliver a concise text
summary and the durable HTML path, explicitly marked unpreviewed when applicable.
Do not silently substitute another browser or claim inline delivery. If a
dependency is missing, record it without inventing a successful rendering.

A nontrivial closure still produces the normal `development-system document`
report with evidence and verification scope. Link its persistent `htmlPath` in
the closing message; the inline visual summarizes it instead of duplicating the
whole report. Keep reports and questionnaire renderers unchanged. The final
prose adds the useful caveat, next action and report link, not a transcription
of the visual. No global installation, publication or acceptance is implied.
