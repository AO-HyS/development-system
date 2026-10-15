# ADR 0072: visual plans and end-of-work deliveries

Status: accepted direction; candidate contract 2.5.0 / catalog 0.70.0.

The owner narrowed visual explanations to plans and end-of-work deliveries,
explicitly preserved grill HTML questionnaires, rejected two design rounds and
tables/tabs, then approved Opus 5.5's “the line and the window” direction on
2026-10-15. Existing report/questionnaire presentation under ADR 0067 remains.

The internal `visual-explain` skill supplies the approved reading mechanism:
a meaningful work sequence, a movable focus and two annotations for scope or
evidence. A small self-contained renderer keeps keyboard, mobile, theme and
text escaping consistent. Its plain-text packet changes stages and content;
states and authorization boundaries must come from actual evidence. Focusing
a stage is not submission or approval. There is no network or persistence.

Two triggers apply to both hosts: substantive plan presentation and nontrivial
completion. Ordinary messages remain text; explicit user requests take priority.
The parent previews exact HTML before publishing in T3. Unavailable capability
or exhausted browser authority produces an honest text/durable-path fallback,
not an extra session or an unverified inline render.

`config/visual-delivery.md` is canonical for both the global instruction block
and a declared Claude rule artifact. The latter makes the trigger available in
isolated fresh installations without assuming the operator's existing manual
CLAUDE.md-to-AGENTS.md symlink. The skill has one Codex copy and an explicit
Claude symlink mirror in the new catalog. Published versions remain immutable.

Closures retain the normal durable `development-system document` report and
link it from the message. Inline content summarizes rather than repeats the
report. Shared reader, questionnaire, drafts, replies and submission paths are
unchanged. No new approval flow or global installation is authorized.

Acceptance covers focused source checks, isolated package installation,
independent review and authorized browser observation of the actual candidate.
File installation does not establish discovery, host adoption or user acceptance.
