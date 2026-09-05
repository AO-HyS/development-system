# Technical Reader Design System

## Visual documents, version 1.8.1

The operator's PR Lens report is the pinned reference for standalone completion,
review and explanation documents. This direction supersedes the older report
presentation below; canonical workflow Readers retain their existing design.

- Near-white paper `#fbfbf8`, ink `#20242c`, blue `#365ad4`; dark paper
  `#13161c` with `#9eafff` accent. Use color sparingly for orientation.
- System sans, 18px prose with 1.75 leading and a 68-character measure.
  Section titles sit above their paragraphs in a continuous reading column.
  Never split a title and its introduction into parallel columns.
- A persistent desktop contents rail highlights the current section. The topbar
  identifies the task, with the product secondary. Collapse navigation on mobile.
  Metadata follows the summary in one wrapping row; maps use the full content width.
- PR Lens SVG images arrive drawn inside a dark canvas. Improve node title and
  subtitle readability without changing graph geometry. Keep two visible
  controls: expand/close and optional animate/pause. Default to static.
- At narrow widths, preserve map text size and allow horizontal scrolling inside
  the viewport. Explicitly announce that interaction. Expansion and Escape
  return focus to the initiating control. Keep a plain-language flow description.
- Bar charts show direct numbers, units and a visible zero origin when signed.
  Essential data and diagrams do not require scripts or network.
- One shared presentation serves all repositories. Canonical Markdown plus the
  complete packet preserves SVGs, references and editorial state for regeneration.
- Visual acceptance must inspect the delivered document, not an example fixture.

## Direction contract

**THESIS** — A calm technical briefing paper with developer-grade evidence, not a dashboard wearing documentation colors.

**OWN-WORLD** — Soft paper, precise ink, restrained teal signals, compact lifecycle context, and diagrams that become manipulable work surfaces only when needed.

**STORY** — Orient to initiative and artifact, understand the compact summary, scan decisions and structure, inspect rich evidence, then leave with one clear next action.

**FIRST VIEWPORT** — Initiative, document type/status, readable title and summary, current workflow position, and the opening section. Navigation supports this view without boxing it in.

**FORM** — Information-dense reading layout, quiet rails, 68–72 character prose measure, bounded rich blocks, strong code typography, and progressive disclosure for tools and metadata.

## Typography

- Prose and interface: Atkinson Hyperlegible Next Variable, embedded Latin WOFF2, 17px base, 1.72 line-height.
- Code: Monaspace Neon, embedded WOFF2, coding ligatures enabled, 14px base, 1.68 line-height.
- H1: `clamp(2rem, 4vw, 2.75rem)`, maximum 19 characters wide, balanced wrapping.
- H2: 1.55rem; H3: 1.2rem. Avoid display-scale headings.
- Labels use sentence case. Uppercase tracking is reserved for a rare semantic kicker, never general navigation.

## Color

Light theme is cool paper, not white: page `#f2f3f0`, document `#f7f8f5`, ink `#202522`, muted `#69716d`, line `#d8ddd8`, accent `#176b68`.

Dark theme is charcoal paper: page `#121513`, document `#181c19`, ink `#edf0ec`, muted `#a6aea8`, line `#323833`, accent `#73c9c2`.

Color communicates state sparingly. The active artifact uses an accent hairline and stronger text, never a filled card.

## Layout

- Desktop: quiet artifact rail, document track up to 56rem, contextual TOC rail.
- Prose stays within 68–72ch. Diagrams, code, charts, and tables may use the full document track.
- Rails have no tinted full-height panel. They collapse below 76rem into two accessible mobile sheets.
- Document header is linear and editorial; metadata is secondary and wraps naturally.
- Section rhythm uses whitespace and hairlines, not nested cards.

## Rich blocks

### Mermaid

The official Mermaid browser runtime accepts all supported families, including flowchart, sequence, state, class, ER, Gantt/progress, timeline, journey, pie, quadrant, Sankey, architecture, C4, Git graph, mindmap, requirement, Kanban, and XY chart.

Every diagram has:

- lazy rendering near the viewport;
- drag to pan and pinch to zoom;
- trackpad/mouse-wheel pan, with Ctrl/Cmd + wheel focal zoom;
- Fit, Reset, Expand, Fullscreen, Copy source, and View source;
- inline, expanded, and fullscreen states;
- strict Mermaid security and readable failure fallback;
- theme-aware rendering and rerendering after theme changes.

The Reader is a viewer: drag moves the canvas, not individual nodes.

### Code, charts, and tables

- Code shows filename, language, copy action, horizontal scrolling, optional line numbers, highlights, wrap, and diff states.
- JSON `chart` fences remain an explicit-data chart option; Mermaid remains available for timeline, Gantt, quadrant, pie, Sankey, and XY semantics.
- Tables scroll horizontally without shrinking type.

## Interaction and accessibility

- Controls have visible labels or accessible names, 40px minimum touch targets in compact groups, and a clear focus ring.
- Diagram source is always available as text. Rendering never removes canonical source evidence.
- Reduced-motion preference disables transitions.
- Mobile panels are mutually exclusive and close on navigation, outside click, or Escape.
- The page remains useful with JavaScript unavailable: content, source, and workflow context stay readable.
