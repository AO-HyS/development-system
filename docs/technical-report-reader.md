# Shared reports

Standalone engineering reports use the same offline Technical Reader as
Working Backwards. Author canonical Markdown, add plain editorial metadata,
and generate the HTML through the installed helper:

```sh
node "$HOME/.agents/skills/working-backwards/scripts/t3-report.mjs" \
  --input metadata.json --markdown report.md --output report.html
```

Metadata example:

```json
{
  "language": "es",
  "productName": "Development System",
  "document": { "type": "Informe", "status": "Evidencia revisada", "updatedAt": "2026-09-04" }
}
```

Use `status` for the report's observed editorial state, not a production claim
inferred from successful tests. Put conclusions first, diagrams beside the
explanation they support, measurement limits beside numbers, and one concrete
next step at the end. Mermaid and explicit JSON `chart` fences already work;
no second diagram implementation is needed.

The helper always selects `presentation: "report"`. It does not create workflow
state or receipts. Workflow callers still default to the existing presentation.
Reports omit implementation authority and an empty artifact rail. A current
managed report can be regenerated; unrelated output files are preserved.
HTML is disposable; Markdown and evidence remain the canonical sources.

Keep private reports outside repositories and synchronized folders. Deliver a
file link; use authorized Computer Use for visual verification. Browser access
restrictions remain in force. The renderer embeds fonts and Mermaid, makes no
network requests, escapes Markdown and binds executable code to a CSP hash.
Opening a report never installs software or grants release authority.
