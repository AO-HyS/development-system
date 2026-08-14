# Development System Technical Reader

## Product

The Technical Reader is the default local presentation layer for plans, reports, architecture notes, decisions, and implementation handoffs produced by the Development System. It turns canonical Markdown plus workflow JSON into one private, portable HTML file that opens directly from disk.

## Primary user and context

Alejandro reads generated technical documents on laptop and mobile, often with little uninterrupted time. He needs to understand the objective, current artifact, decisions, risks, implementation order, and next human action without operating a dashboard or reading a wall of unstyled Markdown.

## Jobs to be done

- Read and scan long technical documents comfortably.
- Know which workflow and artifact is open, what is complete, and what comes next.
- Inspect code, tables, charts, and any supported Mermaid diagram at a useful scale.
- Pan, zoom, fit, expand, copy, and inspect diagram source without a server.
- Open the same durable HTML later from the private workflow library.

## Positioning

This is a technical briefing reader, not a dashboard, blog, marketing page, canvas, or generic documentation site. The document is always the protagonist. Navigation and lifecycle context remain quiet and secondary.

## Product constraints

- One self-contained HTML file; no CDN, remote font, server, or network request.
- Canonical content remains Markdown and workflow JSON; the Reader never becomes the source of truth.
- Safe for private local documents: strict CSP, noindex, escaped Markdown subset, and strict Mermaid rendering.
- Complete Mermaid language support through the official browser runtime, not a flowchart-only parser.
- Responsive, keyboard accessible, printable, and coherent in soft light and dark themes.
- Shared renderer changes are versioned immutably and verified in isolated HOME directories.

## Visual references

Use the reading hierarchy of Mintlify, the diagram inspection patterns of Traycer, Stripe's code density, and Linear's quiet metadata. Do not clone any of them. Avoid card grids, decorative gradients, glass effects, excessive borders, huge titles, tiny labels, and harsh white surfaces.

## Evidence

- Current published renderer: `artifacts/1.5.0/skills/internal/working-backwards/scripts/t3-reader.mjs`
- Current focused tests: `test/t3-technical-reader.test.mjs`
- Current private workflow: `~/.development-system/private/working-backwards/development-system-next-generation/`
- Visual issue reference: `/Users/corrortiz/.t3/userdata/attachments/03ede281-4c43-4376-bcdd-ec4990a5b2ca-2f22ffc0-2c9f-4b6d-b238-c294a2e2891a.png`
