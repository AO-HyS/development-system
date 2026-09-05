# Visual documents

Use this shared presentation for completion reports, reviews and spec explanations.
Load `show-me` to choose a useful visual and `pr-lens` for maps of relationships
or code changes. Astra owns design and Computer Use. Do not create per-repo HTML.

## Generate

Run `development-system document --input packet.json --home HOME --json`.
The packet requires `schemaVersion:1`, `kind` (`completion`, `review` or
`explanation`), `title`, canonical `markdown`, and an honest editorial `status`.
Optional: `language`, `productName`, `source:{repository,revision,references}`,
and `visuals`. A request to explain a spec maps to `explanation`.

The command writes private Markdown, HTML and the complete source packet, with
paths and hashes. Regenerate from `packetPath`; changed content, maps or rendering
produces another snapshot. `generated:true` grants no workflow or deployment authority.
The earlier `scripts/t3-report.mjs --input metadata.json --markdown report.md
--output report.html` helper remains available and also accepts top-level visuals.

## Maps that arrive drawn

Follow the PR Lens skill: author the graph directly, validate, and render with its
pinned CLI. Keep graph and SVG private; no public canvas upload is needed.
Attach `{id,svg,title,caption,description}` to `visuals`: SVG bytes and a useful
plain-language description of the entire flow. Reference it in Markdown:

```pr-lens
{"id":"delivery"}
```

The shared renderer embeds an SVG image with readable labels, expansion and
horizontal scrolling. Motion starts only on request. Missing/unsafe images fail
generation. No network or diagram runtime is required to see a map.
Mermaid in a standalone report preserves source as text. Canonical workflow
Readers retain their interactive Mermaid viewer. Use a PR Lens SVG for the
portable report map.

## Measurements

Use a `chart` fence with actual numeric data. Example shape:
`{"type":"bar","title":"Size","labels":["Before","After"],"values":[3.79,0.11],
"unit":"MB","precision":2,"note":"Example only; replace with measured values."}`.
Bars and numbers are HTML/CSS. Include units, sample sizes, comparability limits
and sources. Never invent a metric to fill a chart; use a table when clearer.

## Content and acceptance

Lead with the outcome, changed behavior, evidence, remaining risk and next action.
Use a concrete task title: the reader must recognize the work from the topbar.
Write each section as a continuous reading sequence, with the heading above its
paragraphs. Desktop navigation belongs in the persistent contents rail. Keep
prose within the reading measure and give maps and measurements the wider track.
A spec explanation covers problem, expected behavior, flow, implementation approach
and unresolved decisions. It does not authorize implementation. Partial or blocked
work stays explicit.

Generate before the final response. When visual acceptance applies, open that exact
file with authorized Computer Use and check its maps, charts, controls and mobile
layout. A fixture preview is insufficient. Return a clickable HTML link.
Do not add approval ceremony or claim a universal background turn-close hook.
