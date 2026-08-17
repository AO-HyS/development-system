// @ts-check

/*
THESIS — A calm technical briefing paper where evidence leads and navigation recedes.
OWN-WORLD — Cool paper, precise ink, restrained teal, quiet rails, and bounded work surfaces.
STORY — Orient to the initiative, scan its workflow, read the decision, inspect evidence, act once.
FIRST VIEWPORT — Initiative and artifact context sit above a readable title, summary, workflow state, and opening section.
FORM — A responsive three-track reader with a 70ch prose measure and progressively disclosed technical controls.
*/

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const calloutTones = new Set(["warning", "important", "decision", "risk", "note"]);

const labelsByLanguage = Object.freeze({
  en: {
    artifacts: "Artifacts",
    authorized: "Implementation authorized",
    authority: "Implementation not authorized · requires Implement Preview",
    copy: "Copy",
    copied: "Copied",
    created: "Created",
    currentDocument: "Current document",
    diagram: "Diagram",
    expand: "Expand",
    fit: "Fit",
    fullscreen: "Fullscreen",
    gate: "Gate",
    initiative: "Initiative",
    library: "Library",
    nextAction: "Next action",
    onThisPage: "On this page",
    priority: "Priority",
    profile: "Profile",
    readTime: "Read time",
    repository: "Repository",
    reset: "Reset",
    source: "Source",
    updated: "Updated",
    viewData: "Accessible data",
    viewSource: "View source",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
  },
  es: {
    artifacts: "Artefactos",
    authorized: "Implementación autorizada",
    authority: "Implementación no autorizada · requiere Implement Preview",
    copy: "Copiar",
    copied: "Copiado",
    created: "Creado",
    currentDocument: "Documento actual",
    diagram: "Diagrama",
    expand: "Expandir",
    fit: "Ajustar",
    fullscreen: "Pantalla completa",
    gate: "Gate",
    initiative: "Iniciativa",
    library: "Biblioteca",
    nextAction: "Siguiente acción",
    onThisPage: "En esta página",
    priority: "Prioridad",
    profile: "Perfil",
    readTime: "Lectura",
    repository: "Repositorio",
    reset: "Restablecer",
    source: "Fuente",
    updated: "Actualizado",
    viewData: "Datos accesibles",
    viewSource: "Ver fuente",
    zoomIn: "Acercar",
    zoomOut: "Alejar",
  },
});

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {unknown} value */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** @param {string} value */
function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

/** @param {string} markdown */
function splitFrontmatter(markdown) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/u);
  if (!match) return { frontmatter: {}, body: markdown };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (entry) frontmatter[entry[1]] = unquote(entry[2]);
  }
  return { frontmatter, body: markdown.slice(match[0].length) };
}

/** @param {string} value */
function plainInline(value) {
  return value.replace(/[*_`~]/gu, "").trim();
}

/** @param {unknown} value */
function safeInlineHref(value) {
  const href = text(value);
  if (!href || href.startsWith("//")) return null;
  if (href.startsWith("#") || /^(?:\.{1,2}\/)/u.test(href)) return href;
  if (/^https?:\/\//iu.test(href)) return href;
  if (!/^[a-z][a-z0-9+.-]*:/iu.test(href)) return href;
  return null;
}

/** @param {string} value */
function inlineMarkdown(value) {
  const links = [];
  const withLinkTokens = value.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/gu, (match, label, href) => {
    const safeHref = safeInlineHref(href);
    if (!safeHref) return match;
    const remote = /^https?:\/\//iu.test(safeHref);
    links.push(`<a href="${escapeHtml(safeHref)}"${remote ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(label)}</a>`);
    return `\uE000${links.length - 1}\uE001`;
  });
  return escapeHtml(withLinkTokens)
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, "<em>$1</em>")
    .replace(/\uE000(\d+)\uE001/gu, (_, index) => links[Number(index)] ?? "");
}

/** @param {string} value */
function baseHeadingId(value) {
  const normalized = plainInline(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized || `section-${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

/** @param {Map<string, number>} counts @param {string} value */
function uniqueHeadingId(counts, value) {
  const base = baseHeadingId(value);
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

/** @param {string} row */
function tableCells(row) {
  const trimmed = row.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split(/(?<!\\)\|/u).map((cell) => cell.replaceAll("\\|", "|").trim());
}

/** @param {string} row */
function isTableDelimiter(row) {
  const cells = tableCells(row);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

/** @param {string} value */
function rangeLines(value) {
  const lines = new Set();
  for (const part of value.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/u.exec(part.trim());
    if (!match) continue;
    const start = Number(match[1]);
    const end = Math.min(Number(match[2] ?? match[1]), start + 200);
    for (let line = start; line <= end; line += 1) lines.add(line);
  }
  return [...lines].sort((left, right) => left - right);
}

/** @param {string} info */
function parseFenceInfo(info) {
  const trimmed = info.trim();
  const language = trimmed.split(/\s+/u)[0]?.toLowerCase() || "text";
  const filename = /(?:filename|title)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/u.exec(trimmed);
  const highlight = /\{([0-9,\-\s]+)\}/u.exec(trimmed) ?? /highlight=(?:"([0-9,\-\s]+)"|'([0-9,\-\s]+)'|([^\s]+))/u.exec(trimmed);
  return {
    language,
    filename: text(filename?.[1] ?? filename?.[2] ?? filename?.[3]),
    showLineNumbers: !/\bnoLineNumbers\b/iu.test(trimmed),
    highlightLines: rangeLines(text(highlight?.[1] ?? highlight?.[2] ?? highlight?.[3])),
    wrap: /\bwrap\b/iu.test(trimmed),
    diff: language === "diff" || /\bdiff\b/iu.test(trimmed),
  };
}

/**
 * Parse a deliberately bounded, escaped Markdown subset for private technical
 * documents. Unsupported syntax remains visible as prose instead of becoming
 * executable HTML.
 * @param {string} markdown
 */
function parseMarkdown(markdown) {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const lines = body.split(/\r?\n/u);
  const blocks = [];
  const outline = [];
  const headingCounts = new Map();
  let title = "";

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```\s*(.*?)\s*$/u.exec(line);
    if (fence) {
      const source = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index])) {
        source.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const options = parseFenceInfo(fence[1]);
      blocks.push({
        id: `block-${blocks.length + 1}`,
        type: options.language === "mermaid" ? "mermaid" : options.language === "chart" ? "chart" : "code",
        source: source.join("\n"),
        ...options,
      });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      const headingText = heading[2].trim();
      const id = uniqueHeadingId(headingCounts, headingText);
      if (level === 1 && !title) title = plainInline(headingText);
      else {
        blocks.push({ id: `block-${blocks.length + 1}`, type: "heading", level, text: headingText, anchorId: id });
        if (level === 2 || level === 3) outline.push({ id, level, label: plainInline(headingText) });
      }
      index += 1;
      continue;
    }

    const callout = /^>\s*\[!([A-Za-z]+)\]\s*(.*)$/u.exec(line);
    if (callout) {
      const requestedTone = callout[1].toLowerCase();
      const bodyLines = [callout[2]];
      index += 1;
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        bodyLines.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({
        id: `block-${blocks.length + 1}`,
        type: "callout",
        tone: calloutTones.has(requestedTone) ? requestedTone : "note",
        text: bodyLines.join(" ").trim(),
      });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const columns = tableCells(line);
      const alignments = tableCells(lines[index + 1]).map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = tableCells(lines[index]);
        rows.push(columns.map((_, columnIndex) => cells[columnIndex] ?? ""));
        index += 1;
      }
      blocks.push({ id: `block-${blocks.length + 1}`, type: "table", columns, alignments, rows });
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/u.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items = [];
      while (index < lines.length) {
        const item = isOrdered ? /^\s*\d+[.)]\s+(.+)$/u.exec(lines[index]) : /^\s*[-*]\s+(.+)$/u.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ id: `block-${blocks.length + 1}`, type: "list", ordered: isOrdered, items });
      continue;
    }

    if (/^>\s?/u.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ id: `block-${blocks.length + 1}`, type: "blockquote", text: quote.join(" ").trim() });
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/u.test(line)) {
      blocks.push({ id: `block-${blocks.length + 1}`, type: "divider" });
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      const candidate = lines[index];
      if (paragraph.length > 0 && (/^```/u.test(candidate) || /^#{1,4}\s/u.test(candidate) || /^>\s?/u.test(candidate) || /^\s*(?:[-*]|\d+[.)])\s+/u.test(candidate) || (candidate.includes("|") && index + 1 < lines.length && isTableDelimiter(lines[index + 1])))) break;
      paragraph.push(candidate.trim());
      index += 1;
    }
    blocks.push({ id: `block-${blocks.length + 1}`, type: "paragraph", text: paragraph.join(" ") });
  }

  return { frontmatter, body, blocks, outline, title };
}

/** @param {string} body */
function readingMinutes(body) {
  const words = body.replace(/```[\s\S]*?```/gu, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(words / 210));
}

/**
 * Build the JSON-serializable reader model. The input is intentionally plain
 * data so other local flows can reuse this renderer without importing Working
 * Backwards state or mutation logic.
 * @param {Record<string, unknown>} input
 */
export function buildTechnicalReaderModel(input) {
  const source = record(input);
  const documentInput = record(source.document);
  const workflowInput = record(source.workflow);
  const markdown = typeof documentInput.markdown === "string" ? documentInput.markdown : "";
  const parsed = parseMarkdown(markdown);
  const frontmatter = parsed.frontmatter;
  const language = text(source.language).toLowerCase() === "en" ? "en" : "es";
  const firstParagraph = parsed.blocks.find((block) => block.type === "paragraph" && text(block.text));
  const explicitSummary = text(documentInput.summary) || text(frontmatter.summary);
  const summary = explicitSummary || text(firstParagraph?.text);
  if (!explicitSummary && firstParagraph) firstParagraph.headerOnly = true;
  const artifacts = Array.isArray(source.artifacts) ? source.artifacts.map((artifact, index) => {
    const item = record(artifact);
    const state = ["complete", "active", "pending"].includes(text(item.state)) ? text(item.state) : "pending";
    return {
      id: text(item.id) || `artifact-${index + 1}`,
      label: text(item.label) || text(item.id) || `Artifact ${index + 1}`,
      state,
      fileName: text(item.fileName) || null,
    };
  }) : [];
  const profile = text(documentInput.profile) || text(frontmatter.profile) || text(workflowInput.profile) || null;
  const repository = text(documentInput.repository) || text(frontmatter.repository) || text(workflowInput.repository) || null;
  const status = text(documentInput.status) || text(frontmatter.working_backwards_status) || text(frontmatter.status) || "Draft";

  return {
    schemaVersion: 1,
    language,
    productName: text(source.productName) || "Technical Reader",
    workflow: {
      id: text(workflowInput.id) || "local-reader",
      name: text(workflowInput.name) || text(documentInput.initiative) || text(frontmatter.initiative) || text(frontmatter.initiative_name) || "",
      slug: text(workflowInput.slug) || "",
      action: text(workflowInput.action) || null,
      implementationAuthorized: workflowInput.implementationAuthorized === true,
      reportStatusLabel: text(workflowInput.reportStatusLabel) || null,
      gateLabel: text(workflowInput.gateLabel) || null,
      revision: text(workflowInput.revision) || null,
      libraryHref: text(workflowInput.libraryHref) || null,
    },
    document: {
      type: text(documentInput.type) || text(frontmatter.working_backwards_role) || "Technical document",
      status,
      title: text(documentInput.title) || text(frontmatter.title) || parsed.title || text(documentInput.type) || "Untitled technical document",
      summary,
      priority: text(documentInput.priority) || text(frontmatter.priority) || null,
      profile,
      readTimeMinutes: readingMinutes(parsed.body),
      createdAt: text(documentInput.createdAt) || text(frontmatter.created_at) || text(frontmatter.createdAt) || null,
      updatedAt: text(documentInput.updatedAt) || text(frontmatter.updated_at) || text(frontmatter.updatedAt) || null,
      repository,
      sourceFile: text(documentInput.sourceFile) || null,
    },
    artifacts,
    outline: parsed.outline,
    blocks: parsed.blocks,
  };
}

/** @param {Record<string, unknown>} block @param {Record<string, string>} labels */
function renderCodeBlock(block, labels) {
  const source = text(block.source);
  const lines = source.split(/\r?\n/u);
  const highlighted = new Set(Array.isArray(block.highlightLines) ? block.highlightLines : []);
  const showLineNumbers = block.showLineNumbers !== false;
  const rows = lines.map((line, index) => {
    const number = index + 1;
    const diffClass = block.diff === true ? line.startsWith("+") ? " diff-added" : line.startsWith("-") ? " diff-removed" : " diff-context" : "";
    const highlightClass = highlighted.has(number) ? " is-highlighted" : "";
    const label = showLineNumbers ? `<span class="line-number" aria-hidden="true">${number}</span>` : "";
    return `<span class="code-line${highlightClass}${diffClass}">${label}<span class="line-source">${escapeHtml(line) || " "}</span></span>`;
  }).join("\n");
  const filename = text(block.filename);
  const language = text(block.language) || "text";
  return `<figure class="code-block${block.wrap === true ? " code-wrap" : ""}" data-copied-label="${escapeHtml(labels.copied)}"><figcaption><div><strong>${escapeHtml(filename || language)}</strong>${filename ? `<span>${escapeHtml(language)}</span>` : ""}</div><button type="button" data-copy-code aria-label="${escapeHtml(labels.copy)} ${escapeHtml(filename || language)}"><span>${escapeHtml(labels.copy)}</span></button></figcaption><pre tabindex="0"><code>${rows}</code></pre><pre hidden data-code-source>${escapeHtml(source)}</pre><span class="copy-status" aria-live="polite"></span></figure>`;
}

/** @param {Record<string, unknown>} block @param {Record<string, string>} labels */
function renderMermaid(block, labels) {
  const source = text(block.source);
  const firstDirective = source.split(/\r?\n/u).map((line) => line.trim()).find((line) => line && !line.startsWith("%%") && line !== "---") ?? "Mermaid";
  const diagramType = firstDirective.split(/[\s:{]/u)[0] || "Mermaid";
  return `<figure class="visual-block mermaid-block" data-mermaid data-rendered="false" data-copied-label="${escapeHtml(labels.copied)}"><figcaption><div class="visual-title"><strong>${escapeHtml(labels.diagram)}</strong><span>${escapeHtml(diagramType)}</span></div><div class="visual-actions" role="toolbar" aria-label="Mermaid"><button type="button" data-action="zoom-out" aria-label="${escapeHtml(labels.zoomOut)}">−</button><button type="button" data-action="zoom-in" aria-label="${escapeHtml(labels.zoomIn)}">+</button><button type="button" data-action="fit">${escapeHtml(labels.fit)}</button><button type="button" data-action="reset">${escapeHtml(labels.reset)}</button><button type="button" data-action="expand" aria-pressed="false">${escapeHtml(labels.expand)}</button><button type="button" data-action="fullscreen">${escapeHtml(labels.fullscreen)}</button><button type="button" data-action="copy-source">${escapeHtml(labels.copy)}</button><button type="button" data-action="view-source">${escapeHtml(labels.viewSource)}</button></div></figcaption><div class="diagram-viewport" tabindex="0" aria-label="${escapeHtml(labels.diagram)}"><div class="diagram-loading" data-diagram-loading role="status">Mermaid · ${escapeHtml(diagramType)}</div><div class="diagram-canvas" data-diagram-canvas></div></div><details class="diagram-source"><summary>${escapeHtml(labels.viewSource)}</summary><pre><code data-diagram-source>${escapeHtml(source)}</code></pre></details><span class="copy-status" aria-live="polite"></span></figure>`;
}

/** @param {Record<string, unknown>} block @param {Record<string, string>} labels */
function renderChart(block, labels) {
  const source = text(block.source);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return `<div class="render-error" role="note"><strong>Chart could not be rendered.</strong><p>The chart fence must contain explicit JSON data.</p>${renderCodeBlock({ ...block, language: "json" }, labels)}</div>`;
  }
  const title = text(parsed?.title) || "Chart";
  const type = parsed?.type === "line" ? "line" : "bar";
  const chartLabels = Array.isArray(parsed?.labels) ? parsed.labels.map(String).slice(0, 12) : [];
  const values = Array.isArray(parsed?.values) ? parsed.values.map(Number).slice(0, 12) : [];
  if (chartLabels.length === 0 || chartLabels.length !== values.length || values.some((value) => !Number.isFinite(value))) {
    return `<div class="render-error" role="note"><strong>Chart data is incomplete.</strong><p><code>labels</code> and <code>values</code> must be finite arrays of equal length.</p>${renderCodeBlock({ ...block, language: "json" }, labels)}</div>`;
  }
  const width = 860;
  const height = 340;
  const left = 70;
  const top = 28;
  const right = 28;
  const bottom = 64;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const y = (value) => top + ((maximum - value) / range) * plotHeight;
  const baseline = y(0);
  const step = plotWidth / values.length;
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const value = minimum + range * ratio;
    const position = y(value);
    return `<g class="chart-grid"><line x1="${left}" y1="${position}" x2="${width - right}" y2="${position}"/><text x="${left - 10}" y="${position + 4}" text-anchor="end">${Math.round(value * 100) / 100}</text></g>`;
  }).join("");
  const marks = type === "line"
    ? `<polyline class="chart-line" points="${values.map((value, index) => `${left + step * index + step / 2},${y(value)}`).join(" ")}"/>${values.map((value, index) => `<circle class="chart-dot" cx="${left + step * index + step / 2}" cy="${y(value)}" r="5"><title>${escapeHtml(chartLabels[index])}: ${value}</title></circle>`).join("")}`
    : values.map((value, index) => {
      const valueY = y(value);
      return `<rect class="chart-bar" x="${left + step * index + step * .18}" y="${Math.min(valueY, baseline)}" width="${step * .64}" height="${Math.max(2, Math.abs(baseline - valueY))}" rx="4"><title>${escapeHtml(chartLabels[index])}: ${value}</title></rect>`;
    }).join("");
  const axisLabels = chartLabels.map((label, index) => `<text class="chart-label" x="${left + step * index + step / 2}" y="${height - 26}" text-anchor="middle">${escapeHtml(label.length > 14 ? `${label.slice(0, 13)}…` : label)}</text>`).join("");
  const table = `<table class="chart-data-table"><caption>${escapeHtml(labels.viewData)} · ${escapeHtml(title)}</caption><thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead><tbody>${chartLabels.map((label, index) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${values[index]}</td></tr>`).join("")}</tbody></table>`;
  return `<figure class="visual-block chart-block"><figcaption><strong>${escapeHtml(title)}</strong><span>${type === "line" ? "Trend" : "Comparison"} · explicit document data</span></figcaption><div class="chart-viewport"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${grid}${marks}${axisLabels}</svg></div>${table}</figure>`;
}

/** @param {Record<string, unknown>} block */
function renderTable(block) {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const alignments = Array.isArray(block.alignments) ? block.alignments : [];
  return `<div class="table-scroll" tabindex="0"><table class="data-table"><thead><tr>${columns.map((column, index) => `<th scope="col" style="text-align:${alignments[index] ?? "left"}">${inlineMarkdown(String(column))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((_, index) => `<td style="text-align:${alignments[index] ?? "left"}">${inlineMarkdown(String(row[index] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** @param {Record<string, unknown>} block */
function renderBlock(block, labels) {
  if (block.type === "heading") return `<h${block.level} id="${escapeHtml(block.anchorId)}" tabindex="-1">${inlineMarkdown(text(block.text))}</h${block.level}>`;
  if (block.type === "paragraph") return block.headerOnly === true ? "" : `<p>${inlineMarkdown(text(block.text))}</p>`;
  if (block.type === "list") {
    const tag = block.ordered === true ? "ol" : "ul";
    return `<${tag}>${(Array.isArray(block.items) ? block.items : []).map((item) => `<li>${inlineMarkdown(String(item))}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "blockquote") return `<blockquote>${inlineMarkdown(text(block.text))}</blockquote>`;
  if (block.type === "callout") {
    const tone = calloutTones.has(text(block.tone)) ? text(block.tone) : "note";
    return `<aside class="callout callout-${tone}" role="note"><strong>${escapeHtml(tone)}</strong><p>${inlineMarkdown(text(block.text))}</p></aside>`;
  }
  if (block.type === "divider") return "<hr>";
  if (block.type === "table") return renderTable(block);
  if (block.type === "mermaid") return renderMermaid(block, labels);
  if (block.type === "chart") return renderChart(block, labels);
  if (block.type === "code") return renderCodeBlock(block, labels);
  return "";
}

/** @param {Record<string, unknown>} model */
function assertModel(model) {
  if (model.schemaVersion !== 1 || !record(model.document).title || !Array.isArray(model.blocks) || !Array.isArray(model.artifacts) || !Array.isArray(model.outline)) {
    throw new Error("Technical reader model is invalid");
  }
}

const mermaidRuntime = readFileSync(new URL("../assets/mermaid.min.js", import.meta.url), "utf8").replaceAll("</script", "<\\/script");
const panzoomRuntime = readFileSync(new URL("../assets/panzoom.min.js", import.meta.url), "utf8").replaceAll("</script", "<\\/script");
const atkinsonFont = readFileSync(new URL("../assets/atkinson-hyperlegible-next-latin.woff2", import.meta.url)).toString("base64");
const monaspaceRegularFont = readFileSync(new URL("../assets/monaspace-neon-latin-400.woff2", import.meta.url)).toString("base64");
const monaspaceSemiboldFont = readFileSync(new URL("../assets/monaspace-neon-latin-600.woff2", import.meta.url)).toString("base64");

const controller = `(()=>{"use strict";
const root=document.documentElement;
const diagrams=[...document.querySelectorAll("[data-mermaid]")];
const panzoomByDiagram=new WeakMap();
const mobileDetails=[...document.querySelectorAll("[data-mobile-details]")];
let diagramSequence=0;
const prefersDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme:dark)").matches;
const closeMobilePanels=except=>mobileDetails.forEach(details=>{if(details!==except)details.open=false});
const syncOverlayState=()=>document.body.classList.toggle("has-reader-overlay",Boolean(document.querySelector(".mermaid-block.is-expanded,.mermaid-block.is-fullscreen-fallback")));
const status=(scope,message)=>{const output=scope.querySelector(".copy-status");if(output){output.textContent=message;setTimeout(()=>{output.textContent=""},1600)}};
const copy=async(value,scope)=>{let ok=false;if(navigator.clipboard&&navigator.clipboard.writeText){try{await navigator.clipboard.writeText(value);ok=true}catch{ok=false}}if(!ok){const area=document.createElement("textarea");area.value=value;area.setAttribute("readonly","");area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();ok=document.execCommand("copy");area.remove()}status(scope,ok?scope.dataset.copiedLabel||"Copied":"Copy unavailable")};
const themeOptions=()=>{const styles=getComputedStyle(root);return{startOnLoad:false,securityLevel:"strict",suppressErrorRendering:true,htmlLabels:false,theme:"base",fontFamily:"Atkinson Hyperlegible Next, sans-serif",themeVariables:{background:styles.getPropertyValue("--diagram-bg").trim(),primaryColor:styles.getPropertyValue("--diagram-node").trim(),primaryTextColor:styles.getPropertyValue("--ink").trim(),primaryBorderColor:styles.getPropertyValue("--accent").trim(),lineColor:styles.getPropertyValue("--diagram-line").trim(),secondaryColor:styles.getPropertyValue("--surface-2").trim(),tertiaryColor:styles.getPropertyValue("--document").trim(),noteBkgColor:styles.getPropertyValue("--surface-2").trim(),noteTextColor:styles.getPropertyValue("--ink").trim(),fontSize:"16px"}}};
const currentPanzoom=figure=>panzoomByDiagram.get(figure)||null;
const resetDiagram=(figure,animate=true)=>{const instance=currentPanzoom(figure);if(!instance)return;instance.reset({animate});figure.dataset.zoom="1"};
const fitDiagram=(figure,animate=true)=>{const instance=currentPanzoom(figure);const viewport=figure.querySelector(".diagram-viewport");const svg=figure.querySelector(".diagram-canvas svg");if(!instance||!viewport||!svg)return;instance.reset({animate:false});const box=svg.getBoundingClientRect();const horizontal=Math.max(1,viewport.clientWidth-40);const vertical=Math.max(1,viewport.clientHeight-40);const scale=Math.max(.3,Math.min(1,horizontal/Math.max(1,box.width),vertical/Math.max(1,box.height)));instance.zoom(scale,{animate});instance.pan(0,0,{animate,force:true});figure.dataset.zoom=String(scale)};
const zoomDiagram=(figure,direction)=>{const instance=currentPanzoom(figure);if(!instance)return;const scale=instance.getScale();const next=Math.max(.3,Math.min(4,scale+(direction*.2)));instance.zoom(next,{animate:true});figure.dataset.zoom=String(next)};
const setupPanzoom=figure=>{const viewport=figure.querySelector(".diagram-viewport");const svg=figure.querySelector(".diagram-canvas svg");if(!viewport||!svg||typeof Panzoom!=="function")return;const prior=currentPanzoom(figure);if(prior)prior.destroy();const viewBox=svg.viewBox&&svg.viewBox.baseVal;const naturalWidth=viewBox&&viewBox.width?viewBox.width:960;svg.removeAttribute("height");svg.style.maxWidth="none";svg.style.width=Math.max(280,Math.min(naturalWidth,Math.max(280,viewport.clientWidth-32)))+"px";svg.style.height="auto";svg.setAttribute("role","img");svg.setAttribute("aria-label",figure.querySelector(".visual-title")?.textContent?.trim()||"Mermaid diagram");const instance=Panzoom(svg,{maxScale:4,minScale:.3,step:.2,canvas:true,pinchAndPan:true,animate:true,duration:180,excludeClass:"diagram-control"});panzoomByDiagram.set(figure,instance);figure.dataset.zoom="1";viewport.onwheel=event=>{event.preventDefault();if(event.ctrlKey||event.metaKey){instance.zoomWithWheel(event);figure.dataset.zoom=String(instance.getScale());return}const pan=instance.getPan();instance.pan(pan.x-event.deltaX,pan.y-event.deltaY,{force:true})};requestAnimationFrame(()=>fitDiagram(figure,false))};
const renderFailure=(figure,error)=>{figure.dataset.rendered="error";const target=figure.querySelector("[data-diagram-canvas]");const loading=figure.querySelector("[data-diagram-loading]");if(loading)loading.remove();if(!target)return;target.replaceChildren();const box=document.createElement("div");box.className="diagram-error";box.setAttribute("role","note");const strong=document.createElement("strong");strong.textContent="Mermaid could not render this diagram.";const message=document.createElement("p");message.textContent=error instanceof Error?error.message:"Invalid Mermaid source.";box.append(strong,message);target.append(box)};
const renderDiagram=async(figure,force=false)=>{if(!force&&(figure.dataset.rendered==="true"||figure.dataset.rendered==="loading"))return;figure.dataset.rendered="loading";const source=figure.querySelector("[data-diagram-source]")?.textContent||"";const target=figure.querySelector("[data-diagram-canvas]");if(!target)return;const prior=currentPanzoom(figure);if(prior){prior.destroy();panzoomByDiagram.delete(figure)}try{mermaid.initialize(themeOptions());const result=await mermaid.render("reader-mermaid-"+(++diagramSequence),source);target.innerHTML=result.svg;const loading=figure.querySelector("[data-diagram-loading]");if(loading)loading.remove();figure.dataset.rendered="true";setupPanzoom(figure)}catch(error){renderFailure(figure,error)}};
const rerenderVisibleDiagrams=async()=>{for(const figure of diagrams.filter(item=>item.dataset.rendered==="true"))await renderDiagram(figure,true)};
mobileDetails.forEach(details=>details.addEventListener("toggle",()=>{if(details.open)closeMobilePanels(details)}));
if("IntersectionObserver"in window){const diagramObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){diagramObserver.unobserve(entry.target);renderDiagram(entry.target)}}},{rootMargin:"420px 0px"});diagrams.forEach(figure=>diagramObserver.observe(figure))}else diagrams.forEach(figure=>renderDiagram(figure));
document.addEventListener("click",async event=>{const mobileLink=event.target.closest(".mobile-reader-tools a");if(mobileLink)closeMobilePanels();else if(!event.target.closest(".mobile-reader-tools"))closeMobilePanels();const button=event.target.closest("button");if(!button)return;if(button.hasAttribute("data-theme-toggle")){const current=root.dataset.theme||(prefersDark?"dark":"light");root.dataset.theme=current==="light"?"dark":"light";button.setAttribute("aria-pressed",String(root.dataset.theme==="dark"));await rerenderVisibleDiagrams();return}if(button.hasAttribute("data-copy-code")){const scope=button.closest(".code-block");const source=scope&&scope.querySelector("[data-code-source]");if(scope&&source)await copy(source.textContent||"",scope);return}const action=button.dataset.action;if(!action)return;const figure=button.closest("[data-mermaid]");if(!figure)return;await renderDiagram(figure);if(action==="zoom-in")zoomDiagram(figure,1);else if(action==="zoom-out")zoomDiagram(figure,-1);else if(action==="fit")fitDiagram(figure);else if(action==="reset")resetDiagram(figure);else if(action==="expand"){document.querySelectorAll(".mermaid-block.is-expanded").forEach(item=>{if(item!==figure)item.classList.remove("is-expanded")});const expanded=figure.classList.toggle("is-expanded");button.setAttribute("aria-pressed",String(expanded));syncOverlayState();requestAnimationFrame(()=>fitDiagram(figure))}else if(action==="fullscreen"){if(document.fullscreenElement===figure){await document.exitFullscreen()}else if(figure.requestFullscreen){await figure.requestFullscreen()}else{const expanded=figure.classList.toggle("is-fullscreen-fallback");button.setAttribute("aria-pressed",String(expanded));syncOverlayState();requestAnimationFrame(()=>fitDiagram(figure))}}else if(action==="copy-source"){const source=figure.querySelector("[data-diagram-source]");if(source)await copy(source.textContent||"",figure)}else if(action==="view-source"){const details=figure.querySelector(".diagram-source");if(details){details.open=!details.open;if(details.open)details.scrollIntoView({block:"nearest"})}}});
document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeMobilePanels();document.querySelectorAll(".is-expanded,.is-fullscreen-fallback").forEach(node=>node.classList.remove("is-expanded","is-fullscreen-fallback"));document.querySelectorAll('[data-action="expand"],[data-action="fullscreen"]').forEach(button=>button.setAttribute("aria-pressed","false"));syncOverlayState()}});
document.addEventListener("fullscreenchange",()=>{document.querySelectorAll('[data-action="fullscreen"]').forEach(button=>button.setAttribute("aria-pressed",String(Boolean(document.fullscreenElement))));const figure=document.fullscreenElement&&document.fullscreenElement.matches("[data-mermaid]")?document.fullscreenElement:null;if(figure)requestAnimationFrame(()=>fitDiagram(figure))});
let resizeFrame=0;window.addEventListener("resize",()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>diagrams.filter(figure=>figure.dataset.rendered==="true").forEach(figure=>fitDiagram(figure,false)))});
if("IntersectionObserver"in window){const links=[...document.querySelectorAll(".toc-link")];const sections=links.map(link=>document.getElementById((link.getAttribute("href")||"").slice(1))).filter(Boolean);const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(!visible)return;links.forEach(link=>{const active=link.getAttribute("href")==="#"+visible.target.id;link.classList.toggle("is-active",active);if(active)link.setAttribute("aria-current","location");else link.removeAttribute("aria-current")})},{rootMargin:"-15% 0px -70% 0px"});sections.forEach(section=>observer.observe(section))}
})();`;

const readerCss = String.raw`
@font-face{font-family:"Atkinson Hyperlegible Next";src:url(data:font/woff2;base64,${atkinsonFont}) format("woff2");font-style:normal;font-weight:200 800;font-display:swap}
@font-face{font-family:"Monaspace Neon";src:url(data:font/woff2;base64,${monaspaceRegularFont}) format("woff2");font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:"Monaspace Neon";src:url(data:font/woff2;base64,${monaspaceSemiboldFont}) format("woff2");font-style:normal;font-weight:600;font-display:swap}
:root{color-scheme:light;--page:#f2f3f0;--document:#f7f8f5;--surface:#eef0ec;--surface-2:#e8ebe6;--ink:#202522;--muted:#69716d;--faint:#858d88;--line:#d8ddd8;--accent:#176b68;--accent-ink:#f7fbf9;--accent-soft:rgba(23,107,104,.08);--ok:#397853;--warn:#8d651f;--risk:#a4494b;--code:#151a18;--code-ink:#edf2ee;--focus:#176b68;--diagram-bg:#f7f8f5;--diagram-node:#eef3ef;--diagram-line:#66716b;--shadow:0 22px 55px rgba(44,55,49,.13)}
@media(prefers-color-scheme:dark){:root:not([data-theme]){color-scheme:dark;--page:#121513;--document:#181c19;--surface:#1d221f;--surface-2:#232925;--ink:#edf0ec;--muted:#a6aea8;--faint:#7d8780;--line:#323833;--accent:#73c9c2;--accent-ink:#0c1715;--accent-soft:rgba(115,201,194,.1);--ok:#86c99c;--warn:#d7ad65;--risk:#d98f91;--code:#0f1311;--code-ink:#e9eeea;--focus:#91d9d3;--diagram-bg:#171b18;--diagram-node:#202722;--diagram-line:#8b9690;--shadow:0 24px 70px rgba(0,0,0,.42)}}
:root[data-theme="light"]{color-scheme:light;--page:#f2f3f0;--document:#f7f8f5;--surface:#eef0ec;--surface-2:#e8ebe6;--ink:#202522;--muted:#69716d;--faint:#858d88;--line:#d8ddd8;--accent:#176b68;--accent-ink:#f7fbf9;--accent-soft:rgba(23,107,104,.08);--ok:#397853;--warn:#8d651f;--risk:#a4494b;--code:#151a18;--code-ink:#edf2ee;--focus:#176b68;--diagram-bg:#f7f8f5;--diagram-node:#eef3ef;--diagram-line:#66716b;--shadow:0 22px 55px rgba(44,55,49,.13)}
:root[data-theme="dark"]{color-scheme:dark;--page:#121513;--document:#181c19;--surface:#1d221f;--surface-2:#232925;--ink:#edf0ec;--muted:#a6aea8;--faint:#7d8780;--line:#323833;--accent:#73c9c2;--accent-ink:#0c1715;--accent-soft:rgba(115,201,194,.1);--ok:#86c99c;--warn:#d7ad65;--risk:#d98f91;--code:#0f1311;--code-ink:#e9eeea;--focus:#91d9d3;--diagram-bg:#171b18;--diagram-node:#202722;--diagram-line:#8b9690;--shadow:0 24px 70px rgba(0,0,0,.42)}
*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--page)}body{margin:0;background:var(--page);color:var(--ink);font-family:"Atkinson Hyperlegible Next",system-ui,sans-serif;font-size:1.1875rem;line-height:1.68;font-kerning:normal;text-rendering:optimizeLegibility}body.has-reader-overlay{overflow:hidden}button,a,summary,input{font:inherit}button{color:inherit}a{color:var(--accent)}button:focus-visible,a:focus-visible,summary:focus-visible,[tabindex="0"]:focus-visible{outline:2px solid var(--focus);outline-offset:3px}button:disabled{cursor:not-allowed;opacity:.45}button:active,.source-button:active{background:var(--accent-soft)}
.skip-link{position:fixed;z-index:100;left:1rem;top:-5rem;padding:.65rem .85rem;border-radius:.45rem;background:var(--accent);color:var(--accent-ink);font-weight:700;text-decoration:none}.skip-link:focus{top:1rem}
.reader-topbar{position:sticky;z-index:40;top:0;display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:4rem;padding:.65rem clamp(1rem,2.2vw,2rem);border-bottom:1px solid color-mix(in srgb,var(--line) 72%,transparent);background:color-mix(in srgb,var(--page) 96%,transparent)}.reader-identity,.reader-actions{display:flex;align-items:center;gap:.75rem;min-width:0}.reader-mark{display:grid;place-items:center;width:2rem;height:2rem;border:1px solid var(--accent);border-radius:50%;color:var(--accent);font-size:.75rem;font-weight:750;letter-spacing:.02em}.reader-identity{font-size:.95rem}.reader-identity strong,.reader-identity span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reader-identity>span:last-child{color:var(--muted);font-size:.875rem}.reader-actions{justify-content:flex-end}.report-state,.authority-state{display:inline-flex;align-items:center;gap:.5rem;color:var(--muted);font-size:.875rem}.report-state{color:var(--ink);font-weight:600}.report-state::before,.authority-state::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:var(--accent)}.authority-state::before{background:var(--warn)}.authority-state.is-authorized::before{background:var(--ok)}.source-button{display:inline-flex;align-items:center;min-height:2.75rem;padding:.35rem .75rem;border-radius:.35rem;color:var(--muted);font-size:.875rem;text-decoration:none}.source-button:hover{color:var(--ink);background:var(--accent-soft)}.icon-button{display:grid;place-items:center;min-width:2.75rem;min-height:2.75rem;border:0;border-radius:.35rem;background:transparent;cursor:pointer}.icon-button:hover{background:var(--accent-soft)}
.reader-layout{display:grid;grid-template-columns:minmax(12rem,15.5rem) minmax(0,58rem) minmax(11rem,14.5rem);align-items:start;gap:clamp(1rem,2.5vw,3rem);max-width:96rem;margin:0 auto;padding:0 clamp(1rem,2vw,2rem)}.document-column{position:relative;grid-column:2;min-width:0;padding:clamp(3rem,6vw,5.25rem) clamp(1rem,3vw,2.5rem) 7rem}.document-column::before{content:"";position:absolute;inset:1.75rem 0 3rem;border-radius:.9rem;background:var(--document);box-shadow:0 0 0 1px color-mix(in srgb,var(--line) 42%,transparent);pointer-events:none}.artifacts-rail{grid-column:1;grid-row:1}.toc-rail{grid-column:3;grid-row:1}.artifacts-rail,.toc-rail{position:sticky;top:4rem;max-height:calc(100vh - 4rem);overflow:auto;padding:2.5rem 0;color:var(--muted)}.artifacts-rail{padding-left:.2rem}.toc-rail{padding-right:.2rem}
.document-header,.document-body{position:relative}
.rail-label{display:flex;justify-content:space-between;gap:.5rem;margin:0 0 1rem;color:var(--faint);font-size:.875rem;font-weight:650}.artifact-list,.toc-list{list-style:none;margin:0;padding:0}.artifact-link{position:relative;display:grid;grid-template-columns:1.75rem minmax(0,1fr);gap:.75rem;align-items:center;min-height:3.25rem;margin:.15rem 0;padding:.65rem .25rem .65rem .75rem;border-radius:0;color:var(--muted);text-decoration:none}.artifact-link::before{content:"";position:absolute;left:0;top:.72rem;bottom:.72rem;width:1px;background:transparent}.artifact-link:hover{color:var(--ink)}.artifact-link strong,.artifact-link small{display:block}.artifact-link strong{color:inherit;font-size:.95rem;font-weight:580;line-height:1.32}.artifact-link small{margin-top:.14rem;color:var(--faint);font-size:.8125rem;line-height:1.4;overflow-wrap:anywhere}.artifact-marker{display:grid;place-items:center;width:1.75rem;height:1.75rem;border:0;border-radius:50%;background:transparent;font-size:.75rem;font-weight:650}.artifact-link.is-complete .artifact-marker{color:var(--ok)}.artifact-link.is-active{background:transparent;color:var(--ink)}.artifact-link.is-active::before{background:var(--accent)}.artifact-link.is-active .artifact-marker{background:var(--accent-soft);color:var(--accent)}.artifact-link.is-pending{opacity:.72}
.rail-action,.gate-card{margin-top:1.5rem;padding-top:1.15rem;border-top:1px solid var(--line);font-size:.875rem}.rail-action strong,.gate-card strong,.rail-action span,.gate-card span{display:block}.rail-action strong,.gate-card strong{margin:.3rem 0;color:var(--ink);font-size:.95rem;line-height:1.4}.gate-card .report-status{color:var(--ink);font-weight:600}.gate-card .authorization-label{margin-top:.3rem}.toc-link{display:block;margin:.08rem 0;padding:.55rem .35rem .55rem .8rem;border-left:1px solid var(--line);color:var(--muted);font-size:.9rem;line-height:1.42;text-decoration:none}.toc-link.level-3{padding-left:1.25rem;font-size:.85rem}.toc-link:hover,.toc-link.is-active{background:transparent;color:var(--ink);border-left-color:var(--accent)}
.document-header{padding:0 0 2.6rem;border-bottom:1px solid var(--line)}.document-kicker{display:flex;align-items:center;flex-wrap:wrap;gap:.65rem;color:var(--muted);font-size:.9rem;font-weight:620}.status-chip,.priority-chip{display:inline-flex;align-items:center;min-height:2rem;padding:.25rem .7rem;border-radius:999px}.status-chip{background:var(--accent-soft);color:var(--accent)}.priority-chip{border:1px solid var(--line)}h1{max-width:19ch;margin:1.15rem 0 1rem;font-size:clamp(2.35rem,4vw,2.75rem);line-height:1.08;letter-spacing:-.025em;text-wrap:balance}.document-summary{max-width:68ch;margin:0;color:var(--muted);font-size:1.25rem;line-height:1.58}.document-meta{display:flex;flex-wrap:wrap;gap:.95rem 1.6rem;margin:1.65rem 0 0}.document-meta div{display:flex;align-items:baseline;gap:.4rem;min-width:0}.document-meta dt{color:var(--faint);font-size:.8125rem;font-weight:600}.document-meta dd{margin:0;font-size:.9rem;overflow-wrap:anywhere}.document-body{padding-top:2.6rem}.document-body>p,.document-body>ul,.document-body>ol,.document-body>blockquote{max-width:70ch}.document-body h2,.document-body h3,.document-body h4{scroll-margin-top:5.8rem;text-wrap:balance}.document-body h2{margin:4rem 0 1rem;font-size:1.8rem;line-height:1.2;letter-spacing:-.015em}.document-body h3{margin:2.9rem 0 .8rem;font-size:1.4rem;line-height:1.3}.document-body h4{margin:2.2rem 0 .6rem;font-size:1.125rem}.document-body p{margin:.75rem 0 1.2rem}.document-body li{margin:.5rem 0}.document-body code:not(.code-block code){padding:.08em .3em;border-radius:.25rem;background:var(--surface-2);font-family:"Monaspace Neon",monospace;font-size:.86em;font-variant-ligatures:contextual common-ligatures discretionary-ligatures}.document-body blockquote{margin:1.6rem 0;padding:.25rem 0 .25rem 1rem;border-left:1px solid var(--accent);color:var(--muted)}.document-body hr{margin:3.2rem 0;border:0;border-top:1px solid var(--line)}
.visual-block,.code-block,.table-scroll{width:100%;margin:2.2rem 0 2.7rem;transform:none;border:1px solid var(--line);border-radius:.7rem;background:var(--surface);overflow:hidden}.visual-block figcaption,.code-block figcaption{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:4.25rem;padding:.7rem .9rem;color:var(--muted);font-size:.9rem}.visual-block figcaption>div,.code-block figcaption>div{display:flex;align-items:center;gap:.65rem;min-width:0}.visual-block figcaption strong,.code-block figcaption strong{color:var(--ink);overflow-wrap:anywhere}.visual-title{display:flex;align-items:baseline;gap:.65rem}.visual-title strong{font-weight:650}.visual-title span{color:var(--faint);font-family:"Monaspace Neon",monospace;font-size:.8125rem}.visual-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.2rem}.visual-actions button,.code-block button{min-width:2.75rem;min-height:2.75rem;padding:.4rem .7rem;border:0;border-radius:.35rem;color:var(--muted);background:transparent;font-size:.875rem;font-weight:560;cursor:pointer}.visual-actions button:hover,.visual-actions button[aria-pressed="true"],.code-block button:hover{color:var(--ink);background:var(--accent-soft)}
.diagram-viewport{position:relative;display:grid;place-items:center;min-height:clamp(21rem,44vw,31rem);overflow:hidden;padding:1.4rem;border-top:1px solid var(--line);background:var(--diagram-bg);overscroll-behavior:contain;touch-action:none;cursor:grab}.diagram-viewport:active{cursor:grabbing}.diagram-canvas{display:grid;place-items:center;width:100%;min-width:0;min-height:18rem;transform:none}.diagram-canvas svg{display:block;height:auto;max-height:none;overflow:visible;font-family:"Atkinson Hyperlegible Next",sans-serif}.diagram-loading{position:absolute;color:var(--faint);font-family:"Monaspace Neon",monospace;font-size:.9rem}.diagram-source{padding:.65rem .95rem;border-top:1px solid var(--line);color:var(--muted);font-size:.875rem}.diagram-source summary{display:flex;align-items:center;min-height:2.75rem;cursor:pointer}.diagram-source pre{max-height:22rem;margin:.7rem 0 0;padding:1rem;border-radius:.45rem;background:var(--code);color:var(--code-ink);font:400 .9375rem/1.68 "Monaspace Neon",monospace;overflow:auto}.diagram-error{place-self:stretch;padding:1.4rem;color:var(--risk);background:color-mix(in srgb,var(--risk) 7%,var(--diagram-bg))}.diagram-error p{margin:.4rem 0 0;color:var(--muted)}
.mermaid-block.is-expanded{position:fixed;z-index:80;inset:1rem;display:flex;flex-direction:column;width:auto;height:auto;margin:0;border:1px solid var(--line);border-radius:.8rem;background:var(--document);box-shadow:var(--shadow)}.mermaid-block.is-expanded .diagram-viewport{flex:1;min-height:0;height:auto}.mermaid-block:fullscreen,.mermaid-block.is-fullscreen-fallback{position:fixed;z-index:90;inset:0;display:flex;flex-direction:column;width:100%;height:100%;margin:0;border:0;border-radius:0;background:var(--document)}.mermaid-block:fullscreen .diagram-viewport,.mermaid-block.is-fullscreen-fallback .diagram-viewport{flex:1;height:auto;min-height:0}
.chart-viewport{overflow:auto;padding:.9rem;border-top:1px solid var(--line);background:var(--diagram-bg)}.chart-viewport svg{display:block;width:100%;height:auto}.chart-grid line{stroke:var(--line)}.chart-grid text,.chart-label{fill:var(--muted);font-family:"Atkinson Hyperlegible Next",sans-serif}.chart-bar{fill:var(--accent)}.chart-line{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.chart-dot{fill:var(--surface);stroke:var(--accent);stroke-width:3}.chart-data-table,.data-table{width:100%;border-collapse:collapse;font-size:.95rem}.chart-data-table caption{padding:.7rem .9rem;color:var(--muted);text-align:left}.chart-data-table th,.chart-data-table td,.data-table th,.data-table td{padding:.7rem .8rem;border-top:1px solid var(--line);text-align:left}.chart-data-table th,.data-table th{color:var(--muted);font-weight:650}.chart-data-table tbody th{color:var(--ink)}.table-scroll{overflow:auto}.data-table{min-width:34rem}.data-table thead{position:sticky;top:0;background:var(--surface)}
.code-block{background:var(--code);color:var(--code-ink)}.code-block figcaption{border-bottom:1px solid #2c342f;background:color-mix(in srgb,var(--code) 80%,var(--surface))}.code-block figcaption span{color:#9aa6a0;font-size:.8125rem}.code-block pre{margin:0;padding:1rem 0;overflow:auto;tab-size:2}.code-block code{display:block;min-width:max-content;font-family:"Monaspace Neon",monospace;font-size:.9375rem;line-height:1.7;font-variant-ligatures:contextual common-ligatures discretionary-ligatures}.code-line{display:grid;grid-template-columns:3.7rem minmax(max-content,1fr);min-height:1.75em}.line-number{padding-right:1rem;color:#85918b;text-align:right;user-select:none}.line-source{padding-right:1.3rem;white-space:pre}.code-line.is-highlighted{background:#17333b}.code-line.diff-added{background:#173528}.code-line.diff-removed{background:#3b2024}.code-wrap code{min-width:0}.code-wrap .line-source{white-space:pre-wrap;overflow-wrap:anywhere}.copy-status{display:block;min-height:1.5rem;padding:.25rem .9rem;color:var(--muted);font-size:.8125rem}
.callout{max-width:70ch;margin:1.5rem 0;padding:.85rem 1rem;border-width:0 0 0 1px;border-style:solid;border-color:var(--line);background:transparent}.callout strong{color:var(--muted);font-size:.76rem;font-weight:650}.callout p{margin:.3rem 0 0}.callout-warning,.callout-important{border-color:var(--warn)}.callout-risk{border-color:var(--risk)}.callout-decision{border-color:var(--accent)}.render-error{margin:1.5rem 0;padding:1rem;border:1px solid var(--warn);border-radius:.55rem;background:var(--surface-2)}.render-error p{margin:.3rem 0}.mobile-reader-tools{display:none}.mobile-context{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line)}.empty-document{padding:1.25rem;border:1px dashed var(--line);color:var(--muted)}
@media(max-width:76rem){body{padding-bottom:4.5rem}.reader-layout{display:block;max-width:none;padding:0}.document-column{max-width:60rem;margin:0 auto;padding:3rem clamp(1rem,5vw,3rem) 6rem}.document-column::before{inset:1rem 0 2rem}.artifacts-rail,.toc-rail{display:none}.mobile-reader-tools{position:fixed;z-index:60;right:0;bottom:0;left:0;display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);background:var(--document)}.mobile-reader-tools details{position:relative}.mobile-reader-tools summary{display:flex;align-items:center;justify-content:center;min-height:4rem;padding:.6rem;color:var(--muted);font-size:.95rem;cursor:pointer;list-style:none}.mobile-reader-tools summary::-webkit-details-marker{display:none}.mobile-reader-tools details[open] summary{color:var(--accent);background:var(--accent-soft)}.mobile-panel{position:fixed;right:.75rem;bottom:4.75rem;left:.75rem;max-height:min(70vh,34rem);overflow:auto;padding:1.1rem;border:1px solid var(--line);border-radius:.7rem;background:var(--document);box-shadow:var(--shadow)}.mobile-panel .artifact-link{grid-template-columns:1.75rem 1fr}.mobile-panel .toc-link{padding:.65rem}.document-meta{grid-template-columns:none}}
@media(max-width:42rem){.reader-topbar{padding:.55rem .75rem}.reader-identity>span:last-child,.report-state,.authority-state,.reader-actions>.source-button{display:none}.document-column{padding:2.25rem 1rem 5.75rem}.document-column::before{inset:.5rem 0 1rem;border-radius:.65rem}h1{font-size:clamp(2.05rem,8vw,2.45rem)}.document-summary{font-size:1.15rem}.document-meta{gap:.6rem 1.1rem}.visual-block figcaption,.code-block figcaption{align-items:flex-start;flex-direction:column}.visual-actions{justify-content:flex-start;width:100%}.visual-actions button{flex:1 1 6.5rem;font-size:.875rem}.diagram-viewport{min-height:22rem;padding:.75rem}.mermaid-block.is-expanded{inset:.35rem}.chart-data-table th,.chart-data-table td,.data-table th,.data-table td{padding:.65rem}}
@media(pointer:coarse){.visual-actions button,.code-block button,.source-button,.icon-button{min-height:3rem}.mobile-reader-tools summary{min-height:4.25rem}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important}}
@media print{.reader-topbar,.artifacts-rail,.toc-rail,.mobile-reader-tools,.visual-actions,.code-block button{display:none!important}.reader-layout{display:block}.document-column{max-width:56rem;margin:0 auto;padding:0}.document-column::before{display:none}.visual-block,.code-block,.table-scroll{width:100%;margin:1.5rem 0;transform:none;break-inside:avoid}body{background:#fff;color:#000}}
`;

/** @param {Record<string, unknown>} model */
export function renderTechnicalReaderHtml(model) {
  assertModel(model);
  const language = model.language === "en" ? "en" : "es";
  const labels = labelsByLanguage[language];
  const document = record(model.document);
  const workflow = record(model.workflow);
  const blocks = model.blocks;
  const artifacts = model.artifacts;
  const outline = model.outline;
  const meta = [
    workflow.name ? [labels.initiative, workflow.name] : null,
    document.profile ? [labels.profile, document.profile] : null,
    document.priority ? [labels.priority, document.priority] : null,
    document.readTimeMinutes ? [labels.readTime, `${document.readTimeMinutes} min`] : null,
    document.createdAt ? [labels.created, document.createdAt] : null,
    document.updatedAt ? [labels.updated, document.updatedAt] : null,
    document.repository ? [labels.repository, document.repository] : null,
    workflow.revision ? ["Revision", workflow.revision] : null,
  ].filter(Boolean);
  const artifactItems = artifacts.map((artifact, index) => {
    const item = record(artifact);
    const state = text(item.state) || "pending";
    const marker = state === "complete" ? "✓" : String(index + 1).padStart(2, "0");
    const body = `<span class="artifact-marker">${escapeHtml(marker)}</span><span><strong>${escapeHtml(item.label)}</strong>${item.fileName ? `<small>${escapeHtml(item.fileName)}</small>` : ""}</span>`;
    return `<li>${item.fileName ? `<a class="artifact-link is-${escapeHtml(state)}" href="${encodeURIComponent(text(item.fileName))}"${state === "active" ? ' aria-current="page"' : ""}>${body}</a>` : `<span class="artifact-link is-${escapeHtml(state)}">${body}</span>`}</li>`;
  }).join("");
  const tocItems = outline.map((entry) => `<li><a class="toc-link level-${entry.level}" href="#${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</a></li>`).join("");
  const sourceButton = document.sourceFile ? `<a class="source-button" href="${encodeURIComponent(text(document.sourceFile))}">${escapeHtml(labels.source)}</a>` : "";
  const libraryButton = workflow.libraryHref ? `<a class="source-button library-link" href="${escapeHtml(text(workflow.libraryHref))}">${escapeHtml(labels.library)}</a>` : "";
  const runtimeScript = `${mermaidRuntime}\n${panzoomRuntime}\n${controller}`;
  const controllerHash = createHash("sha256").update(runtimeScript).digest("base64");
  const copiedLabel = labels.copied;
  const authorizationLabel = workflow.implementationAuthorized === true ? labels.authorized : labels.authority;
  const reportStatusLabel = text(workflow.reportStatusLabel);
  const reportState = reportStatusLabel ? `<span class="report-state" title="${escapeHtml(reportStatusLabel)}">${escapeHtml(reportStatusLabel)}</span>` : "";
  const gateReportState = reportStatusLabel ? `<span class="report-status">${escapeHtml(reportStatusLabel)}</span>` : "";
  const gateLabel = text(workflow.gateLabel) || labels.gate;
  const mobileContext = `<div class="mobile-context" data-mobile-context>${workflow.action ? `<div class="rail-action"><span>${escapeHtml(labels.nextAction)}</span><strong>${escapeHtml(workflow.action)}</strong></div>` : ""}<div class="gate-card"><span>${escapeHtml(gateLabel)}</span><strong>${escapeHtml(document.type)}</strong>${gateReportState}<span class="authorization-label">${escapeHtml(authorizationLabel)}</span></div></div>`;
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="generator" content="development-system-technical-reader">
  <meta name="robots" content="noindex,nofollow">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; frame-src 'none'; img-src data:; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'sha256-${controllerHash}'; style-src 'unsafe-inline'; worker-src 'none'">
  <title>${escapeHtml(document.title)} · ${escapeHtml(model.productName)}</title>
  <style>${readerCss}</style>
</head>
<body>
  <a class="skip-link" href="#document">Skip to document</a>
  <header class="reader-topbar">
    <div class="reader-identity"><span class="reader-mark" aria-hidden="true">WB</span><strong>${escapeHtml(workflow.name || model.productName)}</strong><span>${escapeHtml(document.type)}</span></div>
    <div class="reader-actions">${reportState}<span class="authority-state${workflow.implementationAuthorized === true ? " is-authorized" : ""}" title="${escapeHtml(authorizationLabel)}">${escapeHtml(authorizationLabel)}</span>${libraryButton}${sourceButton}<button class="icon-button" type="button" data-theme-toggle aria-label="Toggle light and dark theme" aria-pressed="false"><span aria-hidden="true">◐</span></button></div>
  </header>
  <main class="reader-layout">
    <article class="document-column" id="document">
      <header class="document-header">
        <div class="document-kicker"><span>${escapeHtml(document.type)}</span><span class="status-chip">${escapeHtml(document.status)}</span>${document.priority ? `<span class="priority-chip">${escapeHtml(labels.priority)} · ${escapeHtml(document.priority)}</span>` : ""}</div>
        <h1>${escapeHtml(document.title)}</h1>
        ${document.summary ? `<p class="document-summary">${inlineMarkdown(text(document.summary))}</p>` : ""}
        ${meta.length ? `<dl class="document-meta">${meta.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
      </header>
      <div class="document-body" data-copied-label="${escapeHtml(copiedLabel)}">${blocks.length ? blocks.map((block) => renderBlock(block, labels)).join("\n") : '<div class="empty-document"><p>This document has not been authored yet.</p></div>'}</div>
    </article>
    <aside class="artifacts-rail" aria-label="${escapeHtml(labels.artifacts)}"><p class="rail-label"><span>${escapeHtml(labels.artifacts)}</span><span>${escapeHtml(document.profile ?? "")}</span></p><ol class="artifact-list">${artifactItems || '<li class="artifact-link">No artifacts yet</li>'}</ol>${workflow.action ? `<div class="rail-action"><span>${escapeHtml(labels.nextAction)}</span><strong>${escapeHtml(workflow.action)}</strong></div>` : ""}</aside>
    <aside class="toc-rail" aria-label="${escapeHtml(labels.onThisPage)}"><p class="rail-label">${escapeHtml(labels.onThisPage)}</p><ol class="toc-list">${tocItems || '<li class="toc-link">No sections yet</li>'}</ol><div class="gate-card"><span>${escapeHtml(gateLabel)}</span><strong>${escapeHtml(document.type)}</strong>${gateReportState}<span class="authorization-label">${escapeHtml(authorizationLabel)}</span></div></aside>
  </main>
  <nav class="mobile-reader-tools" aria-label="Reader navigation" data-mobile-reader><details name="reader-navigation" data-mobile-details><summary>${escapeHtml(labels.artifacts)}</summary><div class="mobile-panel"><ol class="artifact-list">${artifactItems || '<li class="artifact-link">No artifacts yet</li>'}</ol>${mobileContext}</div></details><details name="reader-navigation" data-mobile-details><summary>${escapeHtml(labels.onThisPage)}</summary><div class="mobile-panel"><ol class="toc-list">${tocItems || '<li class="toc-link">No sections yet</li>'}</ol>${mobileContext}</div></details></nav>
  <script>${runtimeScript}</script>
</body>
</html>`;
}

/** @param {unknown} value */
function readerLibraryHref(value) {
  const href = text(value);
  if (!href || href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(href)) return null;
  return href;
}

/**
 * Render the private metadata-only library. Canonical plan contents never
 * enter this index; each row links to a disposable workflow Reader.
 * @param {Record<string, unknown>} input
 */
export function renderTechnicalReaderLibraryHtml(input) {
  const source = record(input);
  const language = text(source.language).toLowerCase() === "en" ? "en" : "es";
  const entries = (Array.isArray(source.entries) ? source.entries : []).map((candidate) => {
    const item = record(candidate);
    return {
      id: text(item.id),
      name: text(item.name) || text(item.slug) || "Untitled initiative",
      slug: text(item.slug),
      repository: text(item.repository),
      phase: text(item.phase),
      status: text(item.status),
      createdAt: text(item.createdAt),
      updatedAt: text(item.updatedAt),
      nextAction: text(item.nextAction),
      readerHref: readerLibraryHref(item.readerHref),
    };
  }).filter((entry) => entry.id && entry.slug && entry.readerHref).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name));
  const copy = language === "en" ? {
    title: "Technical Reader Library",
    summary: "Private initiatives, current workflow position, and the next human action.",
    search: "Search initiatives",
    empty: "No workflow Readers have been generated yet.",
    noResults: "No initiatives match this search.",
    result: "initiative",
    results: "initiatives",
    phase: "Current phase",
    updated: "Updated",
    next: "Next action",
    open: "Open Reader",
    theme: "Toggle light and dark theme",
  } : {
    title: "Biblioteca del Technical Reader",
    summary: "Iniciativas privadas, posición actual del workflow y la siguiente acción humana.",
    search: "Buscar iniciativas",
    empty: "Todavía no se ha generado ningún Reader de workflow.",
    noResults: "Ninguna iniciativa coincide con esta búsqueda.",
    result: "iniciativa",
    results: "iniciativas",
    phase: "Fase actual",
    updated: "Actualizado",
    next: "Siguiente acción",
    open: "Abrir Reader",
    theme: "Alternar tema claro y oscuro",
  };
  const rows = entries.map((entry) => {
    const searchValue = [entry.name, entry.slug, entry.repository, entry.phase, entry.status, entry.nextAction].join(" ").toLocaleLowerCase(language);
    return `<li class="library-entry" data-library-entry data-search="${escapeHtml(searchValue)}"><a href="${escapeHtml(entry.readerHref)}"><span class="entry-main"><strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.repository || entry.slug)}</span></span><span class="entry-state"><span>${escapeHtml(entry.phase)}</span><small>${escapeHtml(entry.status)}</small></span><span class="entry-date"><span>${escapeHtml(copy.updated)}</span><time datetime="${escapeHtml(entry.updatedAt)}">${escapeHtml(entry.updatedAt.slice(0, 10))}</time></span><span class="entry-action"><span>${escapeHtml(copy.next)}</span><strong>${escapeHtml(entry.nextAction)}</strong></span><span class="entry-open">${escapeHtml(copy.open)} <span aria-hidden="true">→</span></span></a></li>`;
  }).join("");
  const libraryController = `(()=>{"use strict";const root=document.documentElement;const search=document.querySelector("[data-library-search]");const entries=[...document.querySelectorAll("[data-library-entry]")];const count=document.querySelector("[data-library-count]");const empty=document.querySelector("[data-library-empty]");const theme=document.querySelector("[data-theme-toggle]");const apply=()=>{const query=(search?.value||"").trim().toLocaleLowerCase();let visible=0;for(const entry of entries){const matches=!query||(entry.dataset.search||"").includes(query);entry.hidden=!matches;if(matches)visible+=1}if(count)count.textContent=visible+" "+(visible===1?count.dataset.singular:count.dataset.plural);if(empty){empty.hidden=visible!==0;empty.textContent=query?empty.dataset.noResults:empty.dataset.empty}};search?.addEventListener("input",apply);theme?.addEventListener("click",()=>{const prefersDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme:dark)").matches;const current=root.dataset.theme||(prefersDark?"dark":"light");root.dataset.theme=current==="light"?"dark":"light";theme.setAttribute("aria-pressed",String(root.dataset.theme==="dark"))});apply()})();`;
  const controllerHash = createHash("sha256").update(libraryController).digest("base64");
  const libraryCss = String.raw`
@font-face{font-family:"Atkinson Hyperlegible Next";src:url(data:font/woff2;base64,${atkinsonFont}) format("woff2");font-style:normal;font-weight:200 800;font-display:swap}
:root{color-scheme:light;--page:#f2f3f0;--document:#f7f8f5;--ink:#202522;--muted:#69716d;--faint:#858d88;--line:#d8ddd8;--accent:#176b68;--accent-soft:rgba(23,107,104,.08);--focus:#176b68}
@media(prefers-color-scheme:dark){:root:not([data-theme]){color-scheme:dark;--page:#121513;--document:#181c19;--ink:#edf0ec;--muted:#a6aea8;--faint:#7d8780;--line:#323833;--accent:#73c9c2;--accent-soft:rgba(115,201,194,.1);--focus:#91d9d3}}
:root[data-theme="light"]{color-scheme:light;--page:#f2f3f0;--document:#f7f8f5;--ink:#202522;--muted:#69716d;--faint:#858d88;--line:#d8ddd8;--accent:#176b68;--accent-soft:rgba(23,107,104,.08);--focus:#176b68}:root[data-theme="dark"]{color-scheme:dark;--page:#121513;--document:#181c19;--ink:#edf0ec;--muted:#a6aea8;--faint:#7d8780;--line:#323833;--accent:#73c9c2;--accent-soft:rgba(115,201,194,.1);--focus:#91d9d3}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:17px/1.65 "Atkinson Hyperlegible Next",system-ui,sans-serif}button,input{font:inherit}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.library-shell{width:min(74rem,calc(100% - 2rem));margin:0 auto;padding:clamp(2rem,7vw,5rem) 0 6rem}.library-header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2rem;padding-bottom:2.5rem;border-bottom:1px solid var(--line)}.library-header h1{max-width:18ch;margin:0;font-size:clamp(2rem,5vw,2.8rem);line-height:1.06;letter-spacing:-.028em;text-wrap:balance}.library-header p{max-width:54ch;margin:.85rem 0 0;color:var(--muted)}.theme-button{display:grid;place-items:center;width:2.75rem;height:2.75rem;border:0;border-radius:.4rem;background:transparent;color:var(--muted);cursor:pointer}.theme-button:hover{background:var(--accent-soft);color:var(--ink)}.library-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:1rem;padding:1.5rem 0}.search-field{display:grid;gap:.35rem;max-width:34rem;color:var(--muted);font-size:.8rem}.search-field input{width:100%;min-height:2.8rem;padding:.55rem .75rem;border:1px solid var(--line);border-radius:.45rem;background:var(--document);color:var(--ink)}.library-count{margin:0;color:var(--muted);font-size:.82rem}.library-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.library-entry{border-bottom:1px solid var(--line)}.library-entry[hidden]{display:none}.library-entry>a{display:grid;grid-template-columns:minmax(12rem,1.35fr) minmax(8rem,.75fr) minmax(7rem,.55fr) minmax(12rem,1fr) auto;align-items:center;gap:1rem;min-height:6.2rem;padding:1rem .35rem;color:inherit;text-decoration:none}.library-entry>a:hover{background:var(--accent-soft)}.entry-main strong,.entry-main span,.entry-state span,.entry-state small,.entry-date span,.entry-action span,.entry-action strong{display:block}.entry-main strong{font-size:1.1rem}.entry-main span,.entry-state small,.entry-date,.entry-action span{color:var(--muted);font-size:.78rem}.entry-state span{font-size:.84rem}.entry-date span,.entry-action span{margin-bottom:.15rem;color:var(--faint)}.entry-action strong{font-size:.84rem;line-height:1.35}.entry-open{color:var(--accent);font-size:.82rem;font-weight:650;white-space:nowrap}.library-empty{padding:3rem 0;color:var(--muted)}
@media(max-width:58rem){.library-entry>a{grid-template-columns:minmax(0,1fr) auto}.entry-state,.entry-date{display:none}.entry-action{grid-column:1}.entry-open{grid-column:2;grid-row:1 / span 2}}
@media(max-width:36rem){.library-shell{width:min(100% - 1.5rem,74rem);padding-top:2rem}.library-header{grid-template-columns:minmax(0,1fr) auto;gap:.75rem}.library-header h1{font-size:2.25rem}.library-tools{grid-template-columns:1fr;align-items:start}.library-entry>a{min-height:7rem}.entry-open{align-self:end}.entry-action strong{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important}}
`;
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; frame-src 'none'; img-src data:; object-src 'none'; script-src 'sha256-${controllerHash}'; style-src 'unsafe-inline'; worker-src 'none'">
  <title>${escapeHtml(copy.title)}</title>
  <style>${libraryCss}</style>
</head>
<body>
  <main class="library-shell">
    <header class="library-header"><div><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.summary)}</p></div><button class="theme-button" type="button" data-theme-toggle aria-label="${escapeHtml(copy.theme)}" aria-pressed="false"><span aria-hidden="true">◐</span></button></header>
    <div class="library-tools"><label class="search-field">${escapeHtml(copy.search)}<input type="search" autocomplete="off" data-library-search></label><p class="library-count" data-library-count data-singular="${escapeHtml(copy.result)}" data-plural="${escapeHtml(copy.results)}" aria-live="polite"></p></div>
    <ol class="library-list">${rows}</ol>
    <p class="library-empty" data-library-empty data-empty="${escapeHtml(copy.empty)}" data-no-results="${escapeHtml(copy.noResults)}"${entries.length ? " hidden" : ""}>${escapeHtml(copy.empty)}</p>
  </main>
  <script>${libraryController}</script>
</body>
</html>`;
}
