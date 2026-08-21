import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildTechnicalReaderModel,
  renderTechnicalReaderHtml,
  renderTechnicalReaderLibraryHtml,
} from "../artifacts/1.5.9/skills/internal/working-backwards/scripts/t3-reader.mjs";

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

\`\`\`mermaid
gantt
  title Release progress
  dateFormat YYYY-MM-DD
  section Reader
  Visual system :done, v1, 2026-08-10, 2d
  Offline runtime :active, v2, after v1, 3d
\`\`\`

\`\`\`mermaid
sequenceDiagram
  User->>Reader: Open local HTML
  Reader-->>User: Render without a server
\`\`\`

\`\`\`mermaid
timeline
  title Reader delivery
  2026-08-10 : Visual system
  2026-08-12 : Offline runtime
\`\`\`

\`\`\`mermaid
architecture-beta
  group library(cloud)[Private Library]
  service source(database)[Markdown] in library
  service reader(server)[Reader] in library
  source:R -- L:reader
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
      name: "Development System Next",
      slug: "development-system-next",
      profile: "Standard",
      action: "Review and approve Technical Contract",
      implementationAuthorized: false,
      repository: "github.com/aohys/development-system",
      revision: "revision-1",
      libraryHref: "../index.html",
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

function inlineScriptIntegrity(html) {
  const declared = /script-src 'sha256-([^']+)'/u.exec(html)?.[1] ?? "";
  const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? "";
  return {
    declared,
    actual: createHash("sha256").update(script).digest("base64"),
  };
}

test("final reports keep requested prompt and handoff content reviewable with explicit known-issue dispositions", async () => {
  const skill = await readFile(new URL("../artifacts/1.5.9/skills/internal/working-backwards/SKILL.md", import.meta.url), "utf8");

  assert.match(skill, /full text or clearly separated Reader sections/i);
  assert.match(skill, /product-convergence prompt or handoff/i);
  assert.match(skill, /Known issues/);
  for (const disposition of ["fixed", "remaining", "authorization-blocked"]) assert.match(skill, new RegExp(`\\b${disposition}\\b`));
  assert.match(skill, /Links may support those sections but never replace their reviewable content/);
});

test("the reusable model builder turns Markdown plus JSON metadata into a serializable reader model", () => {
  const model = buildTechnicalReaderModel(readerInput());

  assert.equal(model.schemaVersion, 1);
  assert.equal(model.document.title, "Technical reader contract");
  assert.equal(model.document.summary, "Review one settled plan without dashboard chrome competing with the document.");
  assert.equal(model.document.priority, "high");
  assert.equal(model.document.profile, "Standard");
  assert.equal(model.workflow.name, "Development System Next");
  assert.equal(model.workflow.slug, "development-system-next");
  assert.equal(model.document.readTimeMinutes >= 1, true);
  assert.deepEqual(model.outline.map((entry) => entry.id), ["architecture", "evidence", "architecture-2"]);
  assert.deepEqual(
    model.blocks.filter((block) => ["mermaid", "chart", "table", "callout", "code"].includes(block.type)).map((block) => block.type),
    ["mermaid", "mermaid", "mermaid", "mermaid", "mermaid", "chart", "table", "callout", "code", "code"],
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
  assert.match(html, /font-src data:/);
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.doesNotMatch(html, /script-src[^;]*unsafe-inline/);
  assert.match(html, /<meta name="generator" content="development-system-technical-reader">/);
  assert.match(html, /class="reader-layout"/);
  assert.match(html, /class="document-column"/);
  assert.match(html, /class="artifacts-rail"/);
  assert.match(html, /class="toc-rail"/);
  assert.match(html, /class="mobile-reader-tools"/);
  assert.match(html, /grid-template-columns:minmax\(12rem,15\.5rem\) minmax\(0,58rem\) minmax\(11rem,14\.5rem\)/);
  assert.match(html, /@media\(max-width:76rem\)/);
  assert.match(html, /Implementation not authorized/);
  assert.doesNotMatch(html, /class="hero"|class="score"|KPI/);

  for (const action of ["zoom-out", "zoom-in", "fit", "reset", "expand", "fullscreen", "copy-source", "view-source"]) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }
  assert.match(html, /data-rendered="false"/);
  assert.match(html, /securityLevel:"strict"/);
  assert.match(html, /htmlLabels:false/);
  assert.match(html, /IntersectionObserver/);
  assert.match(html, /Panzoom\(svg/);
  assert.match(html, /<table class="chart-data-table">/);
  assert.match(html, /<table class="data-table">/);
  assert.match(html, /scripts\/t3-reader\.mjs/);
  assert.match(html, /data-copy-code/);
  assert.match(html, /class="code-line is-highlighted"/);
  assert.match(html, /class="code-line diff-added"/);
  assert.match(html, /class="code-line diff-removed"/);
  assert.match(html, /aria-live="polite"/);

  const staticMarkup = html.replace(/<style>[\s\S]*?<\/style>/u, "").replace(/<script>[\s\S]*?<\/script>/u, "");
  assert.doesNotMatch(staticMarkup, /<script[^>]+src=|<link[^>]+href=|<iframe/iu);
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage/iu);
});

test("inline evidence stays inside the document track while expanded evidence becomes an overlay", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput()));

  assert.match(html, /\.visual-block,\.code-block,\.table-scroll\{width:100%;/);
  assert.doesNotMatch(html, /\.visual-block,\.code-block,\.table-scroll\{width:min\(68rem/);
  assert.match(html, /class="diagram-viewport"[^>]*>[\s\S]*?<div class="diagram-canvas" data-diagram-canvas/);
  assert.match(html, /\.mermaid-block\.is-expanded\{position:fixed;z-index:\d+;inset:/);
  assert.match(html, /\.mermaid-block\.is-expanded\{[^}]*display:flex/);
  assert.match(html, /@media print\{[\s\S]*?\.diagram-viewport\{height:auto;overflow:visible/);
});

test("official Mermaid supports many diagram families and Panzoom provides direct manipulation", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput()));

  assert.match(html, /Release progress/);
  assert.match(html, /sequenceDiagram/);
  assert.match(html, /timeline/);
  assert.match(html, /architecture-beta/);
  assert.match(html, /mermaid\.render\("reader-mermaid-/);
  assert.match(html, /instance\.zoomWithWheel\(event\)/);
  assert.match(html, /instance\.pan\(pan\.x-event\.deltaX,pan\.y-event\.deltaY/);
  assert.match(html, /touch-action:none/);
  assert.match(html, /minimumReadableScale=\.875/);
  assert.match(html, /Math\.max\(minimumReadableScale,containScale\)/);
  assert.match(html, /svg\.style\.width=naturalWidth\+"px"/);
  assert.match(html, /figure\.dataset\.fitScale=String\(scale\)/);
  assert.match(html, /maxScale:4,minScale:\.5/);
  assert.match(html, /overflow:auto[^}]*scrollbar-gutter:stable/);
  assert.match(html, /pinchAndPan:true/);
  assert.doesNotMatch(html, /function parseMermaidNode|function mermaidModel|function layoutMermaid|Local safe render/);
});

test("the visual system uses readable embedded type, soft paper light mode, and quiet active navigation", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput()));

  assert.match(html, /@font-face\{font-family:"Atkinson Hyperlegible Next"/);
  assert.match(html, /@font-face\{font-family:"Monaspace Neon"/);
  assert.match(html, /font-size:1\.1875rem;line-height:1\.68/);
  assert.match(html, /--page:#f2f3f0;--document:#f7f8f5/);
  assert.match(html, /font-size:clamp\(2\.35rem,4vw,2\.75rem\)/);
  assert.match(html, /font-size:clamp\(2\.05rem,8vw,2\.45rem\)/);
  assert.match(html, /min-width:2\.75rem;min-height:2\.75rem/);
  assert.match(html, /@media\(pointer:coarse\)/);
  assert.match(html, /\.artifact-link\.is-active\{background:transparent;color:var\(--ink\)\}/);
  assert.match(html, /\.artifact-link\.is-active::before\{background:var\(--accent\)\}/);
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

test("safe inline links render before CSP while active-content protocols remain text", () => {
  const markdown = `# Evidence\n\nRead [the source](https://example.com/evidence?q=reader) and keep [unsafe](javascript:alert(1)) inert.`;
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput(markdown)));

  assert.match(html, /<a href="https:\/\/example\.com\/evidence\?q=reader" target="_blank" rel="noopener noreferrer">the source<\/a>/);
  assert.match(html, /\[unsafe\]\(javascript:alert\(1\)\)/);
  assert.doesNotMatch(html, /href="javascript:/iu);
  const integrity = inlineScriptIntegrity(html);
  assert.equal(integrity.declared, integrity.actual);
});

test("final-report status is modeled before serialization so CSP remains valid", () => {
  const input = readerInput();
  input.workflow.reportStatusLabel = "Delivery complete · follow-ups documented";
  input.workflow.authorityLabel = "Implementation authorized";
  input.workflow.gateLabel = "Status";
  const model = buildTechnicalReaderModel(input);
  const html = renderTechnicalReaderHtml(model);

  assert.equal(model.workflow.reportStatusLabel, "Delivery complete · follow-ups documented");
  assert.equal("authorityLabel" in model.workflow, false);
  assert.match(html, /Delivery complete · follow-ups documented/);
  assert.match(html, /<span>Status<\/span><strong>Technical Contract<\/strong>/);
  assert.match(html, /Implementation not authorized · requires Implement Preview/);
  assert.doesNotMatch(html, /class="authority-state is-authorized"/);
  const integrity = inlineScriptIntegrity(html);
  assert.equal(integrity.declared, integrity.actual);

  const authorizedInput = readerInput();
  authorizedInput.workflow.implementationAuthorized = true;
  authorizedInput.workflow.reportStatusLabel = "Delivery complete";
  const authorizedHtml = renderTechnicalReaderHtml(buildTechnicalReaderModel(authorizedInput));
  assert.match(authorizedHtml, /class="authority-state is-authorized"[^>]*>Implementation authorized<\/span>/);
  assert.doesNotMatch(authorizedHtml, /Implementation not authorized/);

  const unsafePostprocessed = renderTechnicalReaderHtml(buildTechnicalReaderModel(readerInput())).replaceAll("Implementation", "Delivery");
  const brokenIntegrity = inlineScriptIntegrity(unsafePostprocessed);
  assert.notEqual(brokenIntegrity.declared, brokenIntegrity.actual);
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

test("the metadata-only library is searchable, responsive, offline, and rejects remote Reader links", () => {
  const html = renderTechnicalReaderLibraryHtml({
    language: "en",
    entries: [
      {
        id: "development-system-next-123",
        name: "Development System Next",
        slug: "development-system-next",
        repository: "github.com/aohys/development-system",
        phase: "Technical Contract",
        status: "in-review",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-14T12:00:00.000Z",
        nextAction: "Review and approve Technical Contract",
        readerHref: "development-system-next/index.html",
      },
      {
        id: "remote-reader",
        name: "Remote Reader",
        slug: "remote-reader",
        readerHref: "https://example.com/reader",
      },
    ],
  });

  assert.match(html, /Technical Reader Library/);
  assert.match(html, /Development System Next/);
  assert.match(html, /github\.com\/aohys\/development-system/);
  assert.match(html, /Technical Contract/);
  assert.match(html, /Review and approve Technical Contract/);
  assert.match(html, /data-library-search/);
  assert.match(html, /\.library-header h1\{[^}]*font-size:clamp\(2rem,5vw,2\.8rem\)/);
  assert.match(html, /@media\(max-width:58rem\)/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.doesNotMatch(html, /https:\/\/example\.com\/reader/);
});
