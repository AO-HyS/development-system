# Standalone report

For an engineering report outside a Working Backwards workflow, author Markdown
and plain JSON metadata, then run:

```sh
node <skill-dir>/scripts/t3-report.mjs --input metadata.json --markdown report.md --output report.html
```

Metadata: `{"language":"es","productName":"Development System","document":{"type":"Informe","status":"Evidencia revisada"}}`.

Lead with the decision and its evidence. Use Mermaid for relationships and a
`chart` JSON fence for explicit measurements. Preserve sample sizes, limits,
sources and the next concrete action. Keep private outputs outside repositories
and synchronized folders. The shared renderer owns layout, embedded fonts,
theme, mobile navigation and CSP. Report mode never creates workflow state,
receipts or implementation authority. Regenerate managed reports from their
sources and deliver a clickable HTML file link. Use the authorized browser
mechanism for visual checks; respect browser access restrictions.
