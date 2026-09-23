# Technical report surface brief

Surface: standalone reports produced by `working-backwards/scripts/t3-report.mjs`
(`presentation: "report"`). Mode: Read. Phase: selected.

## Direction contract

THESIS: A report is a field notebook page: the verdict is written first, in large
type directly on the paper, and every finding is a numbered entry. It refuses
the documentation-site pattern of boxed callouts, cards and ruled modules.

OWN-WORLD: Warm memo-book paper with a faint dot grid, charcoal ink, a kraft
accent for chrome and stamps, and three status marks (green, amber, vermilion)
used only as dots and ticks. Condensed grotesk index with tabular numbers; no
boxes, separation by space and baselines.

STORY: Read the verdict and its three status marks, scan the numbered findings
and their verification glyphs, open evidence and diagrams where they prove a
claim, ask questions in the margin, send them together.

FIRST VIEWPORT: Stamped label, large title, verdict statement at display scale,
status row, then the first numbered findings. Contents index at the left,
margin column at the right for sidenotes and question notes.

FORM: Pocket memo book, candidate 7 of the round-3 list, seed key `75618c73`
(re-roll 1). Margin question composer adopted from the annotated-edition card.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Decision ledger

User-confirmed (2026-09-22, questionnaire):

- `first-read`: "Veredicto: qué pasó, si salió bien y qué sigue".
- `problem`: "Muro de texto: todo pesa igual, sin jerarquía" and "Monótono: sin
  color, sin carácter, parece documento genérico".
- `scope`: "Solo reportes independientes (t3-report, como la captura)". Workflow
  Readers and PR Lens visual documents keep their current design.
- `boldness`: "Muéstrame ambos extremos y decido".
- `preserve`: every current capability stays: contents rail with active section,
  metadata, Mermaid with pan/zoom/fit/expand/fullscreen/source, JSON charts,
  tables, code, before/after evidence with lightbox, recordings with transcript,
  evidence gaps, light/dark theme, print/PDF, source footer, offline single file,
  strict CSP.

Product facts: renderer `artifacts/1.26.0/skills/internal/working-backwards/`
(`scripts/t3-reader.mjs`, `scripts/t3-report.mjs`, `scripts/report-evidence.mjs`,
`assets/report.css`, `assets/report-evidence.css`); installed copy matches.
Representative report: `~/.development-system/private/benchmarks/nutri-mini-20260922/report/report.md`.

## Exploration receipt

Candidates, ordered by resonance before the roll:

1. Investigation report (NTSB / flight-test findings): verdict, findings, recommendations.
2. Mission control GO/NO-GO status board.
3. Swiss International Typographic Style annual report.
4. Engineering drawing title block and revision sheets.
5. Clinical-trial results summary / lab notebook.
6. Weather-service bulletin: verdict glyph first, detail after.
7. Ulm/Braun product instruction manual with color-coded functions.

Concept seed: key `75618c73`, mode `read`, assigned index 7 (instruction manual).
Challengers: calendar pin-up pad (declined), Saville catalog sleeve
(competitive), film cutting-bench select rail (competitive), hand-drawn zine
(declined), provenance ribbon (declined), orizuru fold sequence (declined).
Pick card: candidate 1. Canon: documentation-site report.

Decision page: Impeccable `serve-question`, payload
`.impeccable/decision/direction-round-1.json`. The page closed unanswered (exit 4);
the round was re-presented through the structured question tool.

Round 1 answer (literal): "Me gusta una combinación de manuales de instrucciones
con documentación moderna. Dame otras opciones parecidas o inspiradas por ese
camino. También, un informe de investigación no está nada mal. 'Mesa de montaje'
[...] es lo que sí, de plano, no." Build path: "una vez que ya tengamos las
imágenes y la dirección".

- `direction-space` (user-pinned): instruction manual × modern documentation,
  investigation report welcome. Rejected: Mesa de montaje, Catálogo.
- Because the user pinned the space, round 2 did not re-roll concept-seed.

Round 2 comps (exploration, synthetic numbers and logos are not product truth):

- `r2-manual-de-uso.png`: numbered parts-list sidebar, control-face verdict
  panel, manual-callout diagram card, key-sentence underline.
- `r2-ficha-de-hallazgos.png`: main finding + light stack, numbered findings
  with verification glyphs, inline evidence thumbnail, recommendation line.
  The "BRAUN" mark is a generation artifact and never ships.
- `r2-hoja-tecnica.png`: datasheet title block, key-figure cells, verdict strip,
  full-width chart card.

Round 2 answer (literal): "La que más me gusta es la que dice Fichas de
hallazgos, pero aun así se me hace aburrida y muy cuadrada. [...] tirándola más
hacia la documentación, pero sin ser tan aburrida. [...] algo distinto."

- Shared failure: boxed, ruled modules read boring and square.
- `paragraph-questions` (user-confirmed functional requirement): click a
  paragraph, ask about it, questions persist like the grill questionnaire, gather
  several, and send them together to the model. Reuse the grill-with-docs
  mechanism (browser drafts, local server Submit, `responses.json` with revision,
  export when served from file).

Round 3: concept-seed `--reroll 1` (key 75618c73, assigned index 7). New grounded
list: annotated edition (Tufte), science-magazine explainer, airport wayfinding,
field guide, museum wall text, recipe card, pocket memo book. Challengers:
brick build instructions (competitive), cracktro (declined, kept: nothing
enclosed by boxes), Japanese high density (declined), exposure record
(declined, kept: tabular numbers), ice press (declined, kept: strict measure),
sneaker boxes (declined, kept: consistent label grid).

- `r3-libreta-de-campo.png` (assigned): memo book × docs, no boxes. The
  "FIELD NOTES" mark is a generation artifact and never ships.
- `r3-edicion-anotada.png` (pick): three columns, margin sidenotes, question
  composer in the margin beside the selected paragraph.
- `r3-instructivo-de-armado.png` (challenger): sky-blue chrome, big step
  numerals, ghosted completed steps.

Round 3 answer (literal): "Libreta de campo: papel cálido, hallazgos con
numerales grandes, pregunta flotante junto al párrafo" and, for the question
composer, "En el margen, junto al párrafo (como notas al pie laterales)".

- `direction` selected: `r3-libreta-de-campo.png` (reference: approved
  identity; composition refined in the comp round).
- `question-placement`: margin beside the paragraph; `r3-edicion-anotada.png`
  governs that interaction only.
- `build-path`: comp-led ("Guiado por imagen").
- `dark-theme`: "Mantener ambos: libreta clara y una versión nocturna de la
  misma libreta".

Comp round: `.impeccable/mocks/comp-1-apertura.png` (approved),
`comp-2-tres-columnas.png`, `comp-3-pestanas-cifras.png`. User rejected as
false: "Cinta adhesiva en capturas, Nota a lápiz / letra manuscrita, Gráfica con
rayado". Rich blocks (diagram, evidence, chart, margin composer) follow comp 2's
placement minus those three details. Do not literalize the comp's synthetic
section names, finding copy or the "FIELD NOTES" mark; content always comes from
the report Markdown.
