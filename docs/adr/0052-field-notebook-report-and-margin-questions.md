# ADR 0052: Field-notebook reports and margin questions

Status: Accepted for implementation; installed-host verification pending.

## Evidence

The operator judged the standalone report presentation hard to read and scan. Long prose opened the page, the conclusion was buried, sections had no numbering and nothing distinguished verified findings from open ones. Reviewing a report meant copying sentences into chat by hand, so questions about a specific paragraph lost their anchor. The redesign followed a recorded brief, three decision rounds and an approved comp (`docs/design/technical-report-brief.md`).

## Decision

Render `presentation: "report"` as a field notebook: warm paper with a dot grid, Bricolage Grotesque display type, Atkinson Hyperlegible prose and Monaspace code, all embedded. A night palette is available and persists per browser. Canonical workflow Readers keep their existing presentation.

Lead with one verdict. Use explicit `document.verdict` when supplied; otherwise promote a bold opening sentence of at most 170 characters, or a summary of at most 150. Longer summaries stay prose. A stamp line shows type, date and optional `document.reference`. Optional `document.signals` (`ok`, `warn`, `risk`; unknown tones fall back to `ok`) and `document.findings` (`verified`, `estimated`, `pending`; other values show no mark) render as a compact signal row and numbered findings with drawn status marks. Sections and contents are numbered. Every existing capability (maps, charts, Mermaid, PR Lens evidence, callouts, code, offline operation) is preserved.

Add margin questions. Each paragraph, list item, quote, callout, table, chart and code block carries a stable `data-q` anchor. Readers select a block with a pointer or keyboard, write a question in the margin, and keep drafts in `localStorage` under a document-scoped key. A batch is sent together. When served by `reader-live`, the batch is POSTed to `<report>.questions.json` with an expected revision; the server stores it under `<workspace>/.questions/<report>/` with mode 0600 and atomic writes, and returns a receipt. Revision conflicts return 409; cross-origin writes 403; non-JSON 415; bodies over 256 KiB 413; missing readers and symlinked storage 404. Opened as a file, the report offers copy and download instead. The CSP allows only same-origin connections.

## Validation and release

Rendered gates on the delivered renderer passed: hero 86%, responsive 84%, and an independent finish review returned ship after one fix round. Focused tests cover verdict selection, status marks, numbering, anchors, font embedding, CSP hash binding, managed regeneration and the question endpoint's safety refusals. These establish local rendering and server behavior, not installed-host discovery.

Publish immutable contract 1.28.0 and catalog 0.47.0; only the copied working-backwards skill changes. Preserve all prior manifests, artifacts and catalogs. Opening a report never installs software, sends data off the machine or grants release authority.
