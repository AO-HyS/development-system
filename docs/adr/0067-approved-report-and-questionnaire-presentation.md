# ADR 0067: approved report and questionnaire presentation

Status: accepted for Development System 1.40.0 / catalog 0.58.0.

The operator approved the r5 prototype and AO HyS p2 palette in
`docs/design/report-template-brief.md`, then explicitly requested production of
thread cafc99ea-2383-4209-b177-6e287bb4bf6e. This supersedes the visual direction
of ADR 0056 for newly generated reports and questionnaires. Historical reports,
packets, versions and account recovery 1.39.0 remain preserved.

Use one light/dark presentation. Real completion Markdown findings populate the
opening column and next steps appear before detail. Generic next steps use the
full strip when the author supplies no user/team split; do not invent ownership.
Packet headings and document identity remain compatible. The CLI imports the
1.40 renderer explicitly.

Questions stay beside their content, support keyboard/touch, keep nonempty
browser drafts on close and expose edit/delete. Normal links, selection, native
controls and evidence/media remain usable. New long section question IDs are
bounded; legacy IDs retain an alias and locally recoverable metadata.

Enviar synchronously flushes the composer and uses one immutable snapshot for
clipboard and revisioned persistence. Save and copy outcomes are independent.
Failed copying exposes selectable text and copy retry performs no POST. Edits
invalidate stale status/text; in-flight results retain the receipt and describe
new unsent edits. Questionnaire questions are additive and optional through
validation, drafts, import/export and recovery; questions-only batches are valid.

Existing endpoint, revision, receipt, payload, origin/path and atomic write
protections remain. Report scripts and the early theme bootstrap are hashed.
Sending a question is editorial evidence and grants no release authority.

Acceptance requires real browser observation and saved-file/clipboard readback,
independent source and visual review, repository gates and isolated installation.
No automated tests or evals. Production/adoption is a separate observed endpoint.
