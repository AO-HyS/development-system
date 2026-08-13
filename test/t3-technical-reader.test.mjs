import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTechnicalReaderModel,
  renderTechnicalReaderHtml,
} from "../artifacts/1.4.0/skills/internal/working-backwards/scripts/t3-reader.mjs";

const representativePlan = `---
working_backwards_role: technical-contract
working_backwards_status: in-review
title: Technical reader contract
summary: Review one settled plan without dashboard chrome competing with the document.
priority: high
profile: Standard
created_at: 2026-08-10
updated_at: 2026-08-12
---

# Technical reader contract

The canonical Markdown remains readable and complete in the derived file.

## Architecture

The reader accepts a plain JSON input and never mutates lifecycle state.

\`\`\`mermaid
flowchart LR
  A[Private Markdown] --> B{Contract valid}
  B -->|Yes| C[Offline reader]
\`\`\`

## Evidence

\`\`\`chart
{"type":"bar","title":"Fixtures by kind","labels":["Prose","Code","Diagram"],"values":[10,7,4]}
\`\`\`

| Surface | Expected |
| --- | --- |
| Desktop | Three columns |
| Mobile | Document first |

> [!DECISION]
> Preserve the workflow authority boundary.

\`\`\`typescript filename="scripts/t3-reader.mjs" showLineNumbers {2} wrap
export function renderReader(status) {
  return serialize(createModel(status));
}
\`\`\`

\`\`\`diff filename="scripts/t3-workflow.mjs" showLineNumbers
-return renderDashboard(status);
+return renderTechnicalReader(status);
\`\`\`

## Architecture

Duplicate headings still receive stable unique anchors.
`;

function readerInput(markdown = representativePlan) {
  return {
    language: "en",
    productName: "Working Backwards",
    workflow: {
      id: "reader-contract",
      profile: "Standard",
      action: "Review and approve Technical Contract",
      implementationAuthorized: false,
      repository: "github.com/aohys/development-system",
      revision: "revision-1",
    },
    document: {
      type: "Technical Contract",
      status: "In review",
      sourceFile: "05-technical-contract.md",
      markdown,
    },
    artifacts: [
      { id: "customer-story", label: "Customer Story", state: "complete", fileName: "01-customer-story.md" },
      { id: "technical-contract", label: "Technical Contract", state: "active", fileName: "05-technical-contract.md" },
      { id: "implementation-map", label: "Implementation Map", state: "pending" },
    ],
  };
}

test("the reusable model builder turns Markdown plus JSON metadata into a serializable reader model", () => {
  const model = buildTechnicalReaderModel(readerInput());

  assert.equal(model.schemaVersion, 1);
  assert.equal(model.document.title, "Technical reader contract");
  assert.equal(model.document.summary, "Review one settled plan without dashboard chrome competing with the document.");
  assert.equal(model.document.priority, "high");
  assert.equal(model.document.profile, "Standard");
  assert.equal(model.document.readTimeMinutes >= 1, true);
  assert.deepEqual(model.outline.map((entry) => entry.id), ["architecture", "evidence", "architecture-2"]);
  assert.deepEqual(
    model.blocks.filter((block) => ["mermaid", "chart", "table", "callout", "code"].includes(block.type)).map((block) => block.type),
    ["mermaid", "chart", "table", "callout", "code", "code"],
  );
  assert.equal(model.blocks.find((block) => block.type === "code" && block.language === "typescript")?.filename, "scripts/t3-reader.mjs");
  assert.deepEqual(model.blocks.find((block) => block.type === "code" && block.language === "typescript")?.highlightLines, [2]);
  assert.equal(model.blocks.find((block) => block.type === "code" && block.language === "diff")?.diff, true);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
});

test("the reader HTML is offline, document-first, responsive, and exposes rich evidence controls", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput()));

  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.doesNotMatch(html, /script-src[^;]*unsafe-inline/);
  assert.match(html, /class="reader-layout"/);
  assert.match(html, /class="document-column"/);
  assert.match(html, /class="artifacts-rail"/);
  assert.match(html, /class="toc-rail"/);
  assert.match(html, /class="mobile-reader-tools"/);
  assert.match(html, /grid-template-columns:minmax\(12rem,1fr\) minmax\(0,56rem\) minmax\(11rem,1fr\)/);
  assert.match(html, /@media\(max-width:70rem\)/);
  assert.match(html, /Implementation not authorized/);
  assert.doesNotMatch(html, /class="hero"|class="score"|KPI/);

  for (const action of ["zoom-out", "zoom-in", "fit", "expand", "fullscreen", "copy-source", "view-source"]) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }
  assert.match(html, /class="diagram-fallback"/);
  assert.match(html, /<table class="chart-data-table">/);
  assert.match(html, /<table class="data-table">/);
  assert.match(html, /scripts\/t3-reader\.mjs/);
  assert.match(html, /data-copy-code/);
  assert.match(html, /class="code-line is-highlighted"/);
  assert.match(html, /class="code-line diff-added"/);
  assert.match(html, /class="code-line diff-removed"/);
  assert.match(html, /aria-live="polite"/);

  assert.doesNotMatch(html, /https?:\/\//iu);
  assert.doesNotMatch(html, /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage/iu);
});

test("inline evidence stays inside the document track while expanded evidence becomes an overlay", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput()));

  assert.match(html, /\.visual-block,\.code-block,\.table-scroll\{width:100%;/);
  assert.doesNotMatch(html, /\.visual-block,\.code-block,\.table-scroll\{width:min\(68rem/);
  assert.match(html, /class="diagram-viewport"[^>]*><div class="diagram-canvas" data-diagram-canvas/);
  assert.match(html, /\.mermaid-block\.is-expanded\{position:fixed;z-index:\d+;inset:/);
  assert.match(html, /\.mermaid-block\.is-expanded\{[^}]*width:auto;[^}]*transform:none/);
});

test("Mermaid zoom sizes an inner canvas so the viewport gains real scroll geometry", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput()));

  assert.match(html, /data-natural-width="780" data-natural-height="340"/);
  assert.match(html, /const canvas=figure\.querySelector\("\[data-diagram-canvas\]"\)/);
  assert.match(html, /canvas\.style\.width=/);
  assert.match(html, /canvas\.style\.height=/);
  assert.match(html, /\.diagram-viewport\{[^}]*overscroll-behavior:contain/);
  assert.doesNotMatch(html, /svg\.style\.transform=/);
});

test("mobile panels expose workflow context and dismiss predictably", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput()));
  const mobileTools = /<nav class="mobile-reader-tools"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";

  assert.match(mobileTools, /data-mobile-reader/);
  assert.equal((mobileTools.match(/data-mobile-details/g) ?? []).length, 2);
  assert.match(mobileTools, /data-mobile-context/);
  assert.match(mobileTools, /Review and approve Technical Contract/);
  assert.match(mobileTools, /Gate[\s\S]*Technical Contract/);
  assert.match(mobileTools, /Implementation not authorized · requires Implement Preview/);
  assert.match(html, /addEventListener\("toggle"/);
  assert.match(html, /closest\("\.mobile-reader-tools a"\)/);
  assert.match(html, /closest\("\.mobile-reader-tools"\)/);
  assert.match(html, /event\.key==="Escape"/);
});

test("canonical content is escaped and preserved instead of summarized away", () => {
  const hostile = `---
working_backwards_role: customer-story
working_backwards_status: draft
---

# <script>alert("title")</script>

Every canonical sentence remains visible.

<img src=x onerror=alert(1)>

\`\`\`mermaid
flowchart LR
  A[<script>bad</script>] --> B[Safe]
\`\`\`
`;
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput(hostile)));

  assert.match(html, /Every canonical sentence remains visible\./);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert|<img src=x/iu);
});

test("the same reader accepts a JSON-authored document without Working Backwards fields", () => {
  const model = buildTechnicalReaderModel({
    language: "en",
    productName: "Operations",
    workflow: { id: "runbook", implementationAuthorized: false },
    document: {
      type: "Runbook",
      status: "Ready",
      title: "Recover the queue",
      summary: "A bounded operator procedure.",
      priority: "critical",
      profile: "Complex",
      repository: "local/operations",
      markdown: "## Check\n\nInspect the local queue before retrying.",
    },
    artifacts: [],
  });

  assert.equal(model.document.type, "Runbook");
  assert.equal(model.document.title, "Recover the queue");
  assert.equal(model.document.repository, "local/operations");
  assert.match(renderTechnicalReaderHtml(model), /Recover the queue/);
});
