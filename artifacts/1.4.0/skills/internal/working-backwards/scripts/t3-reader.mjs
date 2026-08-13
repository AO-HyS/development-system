// @ts-check

import { createHash } from "node:crypto";

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
    expand: "Expand",
    fit: "Fit",
    fullscreen: "Fullscreen",
    gate: "Gate",
    nextAction: "Next action",
    onThisPage: "On this page",
    priority: "Priority",
    profile: "Profile",
    readTime: "Read time",
    repository: "Repository",
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
    expand: "Expandir",
    fit: "Ajustar",
    fullscreen: "Pantalla completa",
    gate: "Gate",
    nextAction: "Siguiente acción",
    onThisPage: "En esta página",
    priority: "Prioridad",
    profile: "Perfil",
    readTime: "Lectura",
    repository: "Repositorio",
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

/** @param {string} value */
function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, "<em>$1</em>");
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
      action: text(workflowInput.action) || null,
      implementationAuthorized: workflowInput.implementationAuthorized === true,
      revision: text(workflowInput.revision) || null,
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

/** @param {string} token */
function parseMermaidNode(token) {
  const clean = token.trim();
  const match = /^([A-Za-z][A-Za-z0-9_-]*)(?:\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\))?$/u.exec(clean);
  if (!match) return null;
  return { id: match[1], label: (match[2] ?? match[3] ?? match[4] ?? match[1]).trim(), decision: Boolean(match[3]) };
}

/** @param {string} source */
function mermaidModel(source) {
  const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const header = /^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)$/iu.exec(lines.shift() ?? "");
  if (!header) return null;
  const nodes = new Map();
  const edges = [];
  for (const line of lines) {
    const edge = /^(.+?)\s*(-->|-.->|---)\s*(?:\|([^|]+)\|\s*)?(.+)$/u.exec(line);
    if (edge) {
      const from = parseMermaidNode(edge[1]);
      const to = parseMermaidNode(edge[4]);
      if (!from || !to) continue;
      const priorFrom = nodes.get(from.id);
      const priorTo = nodes.get(to.id);
      nodes.set(from.id, from.label === from.id && priorFrom ? priorFrom : { ...priorFrom, ...from });
      nodes.set(to.id, to.label === to.id && priorTo ? priorTo : { ...priorTo, ...to });
      edges.push({ from: from.id, to: to.id, label: edge[3]?.trim() ?? "", dashed: edge[2] === "-.->" });
      continue;
    }
    const node = parseMermaidNode(line);
    if (node) nodes.set(node.id, { ...nodes.get(node.id), ...node });
  }
  if (nodes.size === 0 || edges.length === 0) return null;
  return { direction: header[1].toUpperCase(), nodes: [...nodes.values()], edges };
}

/** @param {ReturnType<typeof mermaidModel> extends infer T ? Exclude<T, null> : never} diagram */
function layoutMermaid(diagram) {
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const depth = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (let pass = 0; pass < nodes.size; pass += 1) {
    let changed = false;
    for (const edge of diagram.edges) {
      const next = Math.min(nodes.size - 1, (depth.get(edge.from) ?? 0) + 1);
      if (next > (depth.get(edge.to) ?? 0)) {
        depth.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (diagram.direction === "BT" || diagram.direction === "RL") {
    const maximum = Math.max(...depth.values());
    for (const id of depth.keys()) depth.set(id, maximum - (depth.get(id) ?? 0));
  }
  const horizontal = diagram.direction === "LR" || diagram.direction === "RL";
  const layers = new Map();
  for (const id of nodes.keys()) {
    const layer = depth.get(id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), id]);
  }
  const layerKeys = [...layers.keys()].sort((left, right) => left - right);
  const widestLayer = Math.max(...[...layers.values()].map((items) => items.length));
  const width = horizontal ? Math.max(780, layerKeys.length * 250) : Math.max(780, widestLayer * 230);
  const height = horizontal ? Math.max(340, widestLayer * 135 + 90) : Math.max(360, layerKeys.length * 155 + 70);
  const positions = new Map();
  for (const [layerOrder, layer] of layerKeys.entries()) {
    const ids = layers.get(layer) ?? [];
    for (const [itemOrder, id] of ids.entries()) {
      const x = horizontal ? 125 + layerOrder * ((width - 250) / Math.max(1, layerKeys.length - 1)) : ((itemOrder + 1) * width) / (ids.length + 1);
      const y = horizontal ? ((itemOrder + 1) * height) / (ids.length + 1) : 78 + layerOrder * ((height - 156) / Math.max(1, layerKeys.length - 1));
      positions.set(id, { x, y });
    }
  }
  return { width, height, positions };
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
  const diagram = mermaidModel(source);
  if (!diagram) return `<div class="render-error" role="note"><strong>Mermaid could not be rendered.</strong><p>Use the local safe subset: <code>flowchart TD</code> or <code>flowchart LR</code>.</p>${renderCodeBlock({ ...block, language: "mermaid" }, labels)}</div>`;
  const { width, height, positions } = layoutMermaid(diagram);
  const markerId = `arrow-${text(block.id).replace(/[^A-Za-z0-9_-]/gu, "") || "diagram"}`;
  const edges = diagram.edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const labelX = (from.x + to.x) / 2;
    const labelY = (from.y + to.y) / 2 - 10;
    return `<g class="diagram-edge${edge.dashed ? " dashed" : ""}"><line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" marker-end="url(#${markerId})"/>${edge.label ? `<text x="${labelX}" y="${labelY}" text-anchor="middle">${escapeHtml(edge.label)}</text>` : ""}</g>`;
  }).join("");
  const nodes = diagram.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position) return "";
    const nodeLabel = node.label.length > 42 ? `${node.label.slice(0, 41)}…` : node.label;
    return node.decision
      ? `<g class="diagram-node decision"><polygon points="${position.x},${position.y - 44} ${position.x + 88},${position.y} ${position.x},${position.y + 44} ${position.x - 88},${position.y}"/><text x="${position.x}" y="${position.y + 5}" text-anchor="middle">${escapeHtml(nodeLabel)}</text></g>`
      : `<g class="diagram-node"><rect x="${position.x - 100}" y="${position.y - 36}" width="200" height="72" rx="12"/><text x="${position.x}" y="${position.y + 5}" text-anchor="middle">${escapeHtml(nodeLabel)}</text></g>`;
  }).join("");
  const fallback = `<details class="diagram-fallback"><summary>Accessible diagram text</summary><ul>${diagram.nodes.map((node) => `<li><strong>${escapeHtml(node.id)}</strong>: ${escapeHtml(node.label)}</li>`).join("")}${diagram.edges.map((edge) => `<li>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}${edge.label ? `: ${escapeHtml(edge.label)}` : ""}</li>`).join("")}</ul></details>`;
  return `<figure class="visual-block mermaid-block" data-mermaid data-scale="1" data-copied-label="${escapeHtml(labels.copied)}"><figcaption><div><strong>Mermaid</strong><span>Local safe render</span></div><div class="visual-actions"><button type="button" data-action="zoom-out" aria-label="${escapeHtml(labels.zoomOut)}">−</button><button type="button" data-action="zoom-in" aria-label="${escapeHtml(labels.zoomIn)}">+</button><button type="button" data-action="fit">${escapeHtml(labels.fit)}</button><button type="button" data-action="expand" aria-pressed="false">${escapeHtml(labels.expand)}</button><button type="button" data-action="fullscreen">${escapeHtml(labels.fullscreen)}</button><button type="button" data-action="copy-source">${escapeHtml(labels.copy)}</button><button type="button" data-action="view-source">${escapeHtml(labels.viewSource)}</button></div></figcaption><div class="diagram-viewport" tabindex="0"><div class="diagram-canvas" data-diagram-canvas data-natural-width="${width}" data-natural-height="${height}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mermaid flowchart" preserveAspectRatio="xMidYMid meet"><defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>${edges}${nodes}</svg></div></div><details class="diagram-source"><summary>${escapeHtml(labels.viewSource)}</summary><pre><code data-diagram-source>${escapeHtml(source)}</code></pre></details>${fallback}<span class="copy-status" aria-live="polite"></span></figure>`;
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

const controller = `(()=>{"use strict";
const root=document.documentElement;
const mobileDetails=[...document.querySelectorAll("[data-mobile-details]")];
const closeMobilePanels=except=>mobileDetails.forEach(details=>{if(details!==except)details.open=false});
const syncOverlayState=()=>document.body.classList.toggle("has-reader-overlay",Boolean(document.querySelector(".mermaid-block.is-expanded,.mermaid-block.is-fullscreen-fallback")));
const status=(scope,message)=>{const output=scope.querySelector(".copy-status");if(output){output.textContent=message;setTimeout(()=>{output.textContent=""},1600)}};
const copy=async(value,scope)=>{let ok=false;if(navigator.clipboard&&navigator.clipboard.writeText){try{await navigator.clipboard.writeText(value);ok=true}catch{ok=false}}if(!ok){const area=document.createElement("textarea");area.value=value;area.setAttribute("readonly","");area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();ok=document.execCommand("copy");area.remove()}status(scope,ok?scope.dataset.copiedLabel||"Copied":"Copy unavailable")};
const setScale=(figure,value)=>{const scale=Math.max(.5,Math.min(2.5,value));const viewport=figure.querySelector(".diagram-viewport");const canvas=figure.querySelector("[data-diagram-canvas]");if(!viewport||!canvas)return;const naturalWidth=Number(canvas.dataset.naturalWidth)||1;const naturalHeight=Number(canvas.dataset.naturalHeight)||1;const styles=getComputedStyle(viewport);const padding=(parseFloat(styles.paddingLeft)||0)+(parseFloat(styles.paddingRight)||0);const baseWidth=Math.max(240,viewport.clientWidth-padding);const oldWidth=canvas.offsetWidth||baseWidth;const oldHeight=canvas.offsetHeight||baseWidth*naturalHeight/naturalWidth;const centerX=(viewport.scrollLeft+viewport.clientWidth/2)/oldWidth;const centerY=(viewport.scrollTop+viewport.clientHeight/2)/oldHeight;const nextWidth=Math.round(baseWidth*scale);const nextHeight=Math.round(nextWidth*naturalHeight/naturalWidth);figure.dataset.scale=String(scale);canvas.style.width=nextWidth+"px";canvas.style.height=nextHeight+"px";requestAnimationFrame(()=>{viewport.scrollLeft=Math.max(0,centerX*nextWidth-viewport.clientWidth/2);viewport.scrollTop=Math.max(0,centerY*nextHeight-viewport.clientHeight/2)})};
mobileDetails.forEach(details=>details.addEventListener("toggle",()=>{if(details.open)closeMobilePanels(details)}));
document.querySelectorAll("[data-mermaid]").forEach(figure=>setScale(figure,Number(figure.dataset.scale||"1")));
document.addEventListener("click",async event=>{const mobileLink=event.target.closest(".mobile-reader-tools a");if(mobileLink)closeMobilePanels();else if(!event.target.closest(".mobile-reader-tools"))closeMobilePanels();const button=event.target.closest("button");if(!button)return;if(button.hasAttribute("data-theme-toggle")){const current=root.dataset.theme;root.dataset.theme=current==="light"?"dark":current==="dark"?"light":"light";button.setAttribute("aria-pressed",String(root.dataset.theme==="light"));return}if(button.hasAttribute("data-copy-code")){const scope=button.closest(".code-block");const source=scope&&scope.querySelector("[data-code-source]");if(scope&&source)await copy(source.textContent||"",scope);return}const action=button.dataset.action;if(!action)return;const figure=button.closest("[data-mermaid]");if(!figure)return;const scale=Number(figure.dataset.scale||"1");if(action==="zoom-in")setScale(figure,scale+.2);else if(action==="zoom-out")setScale(figure,scale-.2);else if(action==="fit")setScale(figure,1);else if(action==="expand"){const expanded=figure.classList.toggle("is-expanded");button.setAttribute("aria-pressed",String(expanded));syncOverlayState();requestAnimationFrame(()=>setScale(figure,scale))}else if(action==="fullscreen"){if(figure.requestFullscreen)await figure.requestFullscreen();else{figure.classList.toggle("is-fullscreen-fallback");syncOverlayState();requestAnimationFrame(()=>setScale(figure,scale))}}else if(action==="copy-source"){const source=figure.querySelector("[data-diagram-source]");if(source)await copy(source.textContent||"",figure)}else if(action==="view-source"){const details=figure.querySelector(".diagram-source");if(details)details.open=!details.open}});
document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeMobilePanels();document.querySelectorAll(".is-expanded,.is-fullscreen-fallback").forEach(node=>node.classList.remove("is-expanded","is-fullscreen-fallback"));document.querySelectorAll('[data-action="expand"]').forEach(button=>button.setAttribute("aria-pressed","false"));syncOverlayState()}});
document.addEventListener("fullscreenchange",()=>{const figure=document.fullscreenElement&&document.fullscreenElement.matches("[data-mermaid]")?document.fullscreenElement:null;if(figure)requestAnimationFrame(()=>setScale(figure,Number(figure.dataset.scale||"1")))});
let resizeFrame=0;window.addEventListener("resize",()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>document.querySelectorAll("[data-mermaid]").forEach(figure=>setScale(figure,Number(figure.dataset.scale||"1"))))});
if("IntersectionObserver"in window){const links=[...document.querySelectorAll(".toc-link")];const sections=links.map(link=>document.getElementById((link.getAttribute("href")||"").slice(1))).filter(Boolean);const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(!visible)return;links.forEach(link=>{const active=link.getAttribute("href")==="#"+visible.target.id;link.classList.toggle("is-active",active);if(active)link.setAttribute("aria-current","location");else link.removeAttribute("aria-current")})},{rootMargin:"-15% 0px -70% 0px"});sections.forEach(section=>observer.observe(section))}
})();`;

const readerCss = String.raw`
:root{color-scheme:dark;--page:#0c0f12;--rail:#101419;--surface:#151a20;--surface-2:#1a2027;--ink:#eef2f5;--muted:#a4afb9;--faint:#74808b;--line:#2a333d;--accent:#70d5e5;--accent-ink:#061418;--accent-soft:#17343b;--ok:#7bd6a8;--warn:#f2be68;--risk:#ef8f91;--code:#090c0f;--code-ink:#e7edf1;--focus:#a6e6ef;--shadow:0 14px 38px rgba(0,0,0,.28)}
@media(prefers-color-scheme:light){:root:not([data-theme]){color-scheme:light;--page:#f7f8f9;--rail:#f1f3f5;--surface:#fff;--surface-2:#f5f7f8;--ink:#17202a;--muted:#53616e;--faint:#71808d;--line:#d8dee4;--accent:#086e7d;--accent-ink:#fff;--accent-soft:#e2f2f4;--ok:#17764b;--warn:#8b5a08;--risk:#a43338;--code:#11161b;--code-ink:#e7edf1;--focus:#086e7d;--shadow:0 12px 30px rgba(24,39,52,.1)}}
:root[data-theme="light"]{color-scheme:light;--page:#f7f8f9;--rail:#f1f3f5;--surface:#fff;--surface-2:#f5f7f8;--ink:#17202a;--muted:#53616e;--faint:#71808d;--line:#d8dee4;--accent:#086e7d;--accent-ink:#fff;--accent-soft:#e2f2f4;--ok:#17764b;--warn:#8b5a08;--risk:#a43338;--code:#11161b;--code-ink:#e7edf1;--focus:#086e7d;--shadow:0 12px 30px rgba(24,39,52,.1)}
:root[data-theme="dark"]{color-scheme:dark}
*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--page)}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.68 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body.has-reader-overlay{overflow:hidden}button,a,summary{font:inherit}button{color:inherit}a{color:var(--accent)}button:focus-visible,a:focus-visible,summary:focus-visible,[tabindex="0"]:focus-visible{outline:2px solid var(--focus);outline-offset:3px}button:disabled{cursor:not-allowed;opacity:.45}
.skip-link{position:fixed;z-index:100;left:1rem;top:-5rem;padding:.65rem .85rem;border-radius:.5rem;background:var(--accent);color:var(--accent-ink);font-weight:760;text-decoration:none}.skip-link:focus{top:1rem}
.reader-topbar{position:sticky;z-index:40;top:0;display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:3.5rem;padding:.65rem clamp(1rem,3vw,2rem);border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--page) 92%,transparent);backdrop-filter:blur(14px)}.reader-identity,.reader-actions{display:flex;align-items:center;gap:.65rem;min-width:0}.reader-mark{display:grid;place-items:center;width:1.75rem;height:1.75rem;border-radius:.48rem;background:var(--accent);color:var(--accent-ink);font-size:.68rem;font-weight:850;letter-spacing:.04em}.reader-identity strong,.reader-identity span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reader-identity>span:last-child{color:var(--muted)}.authority-state{display:inline-flex;align-items:center;gap:.45rem;color:var(--muted);font-size:.78rem}.authority-state::before{content:"";width:.46rem;height:.46rem;border-radius:50%;background:var(--warn)}.icon-button{min-width:2rem;min-height:2rem;border:1px solid var(--line);border-radius:.5rem;background:var(--surface);cursor:pointer}.reader-layout{display:grid;grid-template-columns:minmax(12rem,1fr) minmax(0,56rem) minmax(11rem,1fr);align-items:start;max-width:96rem;margin:0 auto}.document-column{grid-column:2;min-width:0;padding:clamp(2.75rem,6vw,5.5rem) clamp(1.5rem,5vw,4rem) 7rem}.artifacts-rail{grid-column:1;grid-row:1}.toc-rail{grid-column:3;grid-row:1}.artifacts-rail,.toc-rail{position:sticky;top:3.5rem;max-height:calc(100vh - 3.5rem);overflow:auto;padding:2rem clamp(1rem,2.3vw,2rem);color:var(--muted)}.artifacts-rail{border-right:1px solid var(--line);background:var(--rail)}.toc-rail{border-left:1px solid var(--line)}.rail-label{display:flex;justify-content:space-between;gap:.5rem;margin:0 0 .8rem;color:var(--faint);font-size:.68rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.artifact-list,.toc-list{list-style:none;margin:0;padding:0}.artifact-link{display:grid;grid-template-columns:1.65rem minmax(0,1fr);gap:.58rem;align-items:center;margin:.15rem 0;padding:.52rem .45rem;border-radius:.55rem;color:var(--muted);text-decoration:none}.artifact-link:hover{background:var(--surface-2);color:var(--ink)}.artifact-link strong,.artifact-link small{display:block}.artifact-link strong{color:inherit;font-size:.8rem}.artifact-link small{margin-top:.12rem;color:var(--faint);font-size:.68rem;overflow-wrap:anywhere}.artifact-marker{display:grid;place-items:center;width:1.65rem;height:1.65rem;border:1px solid var(--line);border-radius:.5rem;font-size:.64rem;font-weight:800}.artifact-link.is-complete .artifact-marker{color:var(--ok)}.artifact-link.is-active{background:var(--accent-soft);color:var(--ink)}.artifact-link.is-active .artifact-marker{border-color:var(--accent);background:var(--accent);color:var(--accent-ink)}.artifact-link.is-pending{opacity:.67}.rail-action,.gate-card{margin-top:1.35rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.76rem}.rail-action strong,.gate-card strong,.rail-action span,.gate-card span{display:block}.rail-action strong,.gate-card strong{margin:.25rem 0;color:var(--ink)}.toc-link{display:block;margin:.12rem 0;padding:.36rem .55rem;border-left:1px solid transparent;color:var(--muted);font-size:.76rem;text-decoration:none}.toc-link.level-3{padding-left:1.1rem;font-size:.71rem}.toc-link:hover,.toc-link.is-active{color:var(--ink);border-left-color:var(--accent);background:var(--accent-soft)}
.document-header{padding-bottom:2.25rem;border-bottom:1px solid var(--line)}.document-kicker{display:flex;align-items:center;flex-wrap:wrap;gap:.48rem;color:var(--muted);font-size:.72rem;font-weight:720}.status-chip,.priority-chip{display:inline-flex;align-items:center;min-height:1.55rem;padding:.2rem .55rem;border-radius:999px}.status-chip{background:var(--accent-soft);color:var(--accent)}.priority-chip{border:1px solid var(--line)}h1{max-width:17ch;margin:.85rem 0 .8rem;font-size:clamp(2.25rem,5vw,4.2rem);line-height:1.02;letter-spacing:-.035em;text-wrap:balance}.document-summary{max-width:68ch;margin:0;color:var(--muted);font-size:1.06rem;line-height:1.62}.document-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr));gap:1rem;margin:1.65rem 0 0}.document-meta div{min-width:0}.document-meta dt{color:var(--faint);font-size:.64rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.document-meta dd{margin:.28rem 0 0;font-size:.76rem;overflow-wrap:anywhere}.document-body{padding-top:2.25rem}.document-body>p,.document-body>ul,.document-body>ol,.document-body>blockquote{max-width:72ch}.document-body h2,.document-body h3,.document-body h4{scroll-margin-top:5.4rem;text-wrap:balance}.document-body h2{margin:3.5rem 0 .75rem;font-size:1.55rem;line-height:1.2;letter-spacing:-.02em}.document-body h3{margin:2.5rem 0 .65rem;font-size:1.14rem;line-height:1.3}.document-body h4{margin:2rem 0 .5rem;font-size:.96rem}.document-body p{margin:.65rem 0 1rem}.document-body li{margin:.35rem 0}.document-body code:not(.code-block code){padding:.1em .32em;border-radius:.3rem;background:var(--surface-2);font:500 .88em/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.document-body blockquote{margin:1.5rem 0;padding:.2rem 0 .2rem 1rem;border-left:1px solid var(--accent);color:var(--muted)}.document-body hr{margin:3rem 0;border:0;border-top:1px solid var(--line)}
.visual-block,.code-block,.table-scroll{width:100%;margin:1.75rem 0 2rem;transform:none;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface)}.visual-block figcaption,.code-block figcaption{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.62rem .8rem;color:var(--muted);font-size:.72rem}.visual-block figcaption>div,.code-block figcaption>div{display:flex;align-items:center;gap:.55rem;min-width:0}.visual-block figcaption strong,.code-block figcaption strong{color:var(--ink);overflow-wrap:anywhere}.visual-actions{display:flex;flex-wrap:wrap;justify-content:flex-end}.visual-actions button,.code-block button{min-height:1.8rem;padding:.2rem .5rem;border:1px solid var(--line);background:transparent;cursor:pointer}.visual-actions button+button{border-left:0}.diagram-viewport,.chart-viewport{overflow:auto;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--page)}.diagram-viewport{padding:1rem;overscroll-behavior:contain;touch-action:pan-x pan-y}.diagram-canvas{position:relative;width:100%;min-width:0;margin:0 auto;transition:width .22s cubic-bezier(.16,1,.3,1),height .22s cubic-bezier(.16,1,.3,1)}.diagram-canvas svg{display:block;width:100%;height:100%}.diagram-edge line{stroke:var(--muted);stroke-width:1.6}.diagram-edge.dashed line{stroke-dasharray:7 6}.diagram-edge path{fill:var(--muted)}.diagram-edge text,.diagram-node text,.chart-grid text,.chart-label{fill:var(--muted);font:600 12px ui-sans-serif,-apple-system,sans-serif}.diagram-node rect,.diagram-node polygon{fill:var(--surface);stroke:var(--accent);stroke-width:1.8}.diagram-node text{fill:var(--ink);font-size:13px}.diagram-source,.diagram-fallback{padding:.5rem .8rem;color:var(--muted);font-size:.74rem}.diagram-source+ .diagram-fallback{border-top:1px solid var(--line)}.diagram-source pre{overflow:auto;padding:.75rem;background:var(--code);color:var(--code-ink)}.diagram-fallback ul{margin:.65rem 0}.mermaid-block.is-expanded{position:fixed;z-index:80;inset:clamp(.75rem,2vw,1.5rem);width:auto;height:auto;margin:0;transform:none;border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow);overflow:auto}.mermaid-block.is-expanded .diagram-viewport{height:min(72vh,48rem)}.mermaid-block:fullscreen,.mermaid-block.is-fullscreen-fallback{position:fixed;z-index:90;inset:0;width:100%;height:100%;margin:0;transform:none;border:0;background:var(--surface);overflow:auto}.mermaid-block:fullscreen .diagram-viewport,.mermaid-block.is-fullscreen-fallback .diagram-viewport{height:calc(100vh - 9rem)}.chart-viewport{padding:.8rem}.chart-viewport svg{display:block;width:100%;height:auto}.chart-grid line{stroke:var(--line)}.chart-bar{fill:var(--accent)}.chart-line{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.chart-dot{fill:var(--surface);stroke:var(--accent);stroke-width:3}.chart-data-table,.data-table{width:100%;border-collapse:collapse;font-size:.78rem}.chart-data-table caption{padding:.6rem .8rem;color:var(--muted);text-align:left}.chart-data-table th,.chart-data-table td,.data-table th,.data-table td{padding:.55rem .7rem;border-top:1px solid var(--line);text-align:left}.chart-data-table th,.data-table th{color:var(--muted);font-weight:700}.chart-data-table tbody th{color:var(--ink)}.table-scroll{overflow:auto}.data-table{min-width:34rem}.data-table thead{position:sticky;top:0;background:var(--surface)}
.code-block{overflow:hidden;background:var(--code);color:var(--code-ink)}.code-block figcaption{border-bottom:1px solid #29323a;background:#11171c}.code-block pre{margin:0;padding:.8rem 0;overflow:auto;tab-size:2}.code-block code{display:block;min-width:max-content;font:500 .79rem/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}.code-line{display:grid;grid-template-columns:3.4rem minmax(max-content,1fr);min-height:1.7em}.line-number{padding-right:.9rem;color:#7f8b95;text-align:right;user-select:none}.line-source{padding-right:1.2rem;white-space:pre}.code-line.is-highlighted{background:#17333b}.code-line.diff-added{background:#173528}.code-line.diff-removed{background:#3b2024}.code-wrap code{min-width:0}.code-wrap .line-source{white-space:pre-wrap;overflow-wrap:anywhere}.copy-status{display:block;min-height:1.25rem;padding:.2rem .8rem;color:var(--muted);font-size:.68rem}.callout{max-width:72ch;margin:1.5rem 0;padding:.85rem 1rem;border:1px solid var(--line);border-radius:.65rem;background:var(--surface-2)}.callout strong{color:var(--muted);font-size:.66rem;letter-spacing:.08em;text-transform:uppercase}.callout p{margin:.3rem 0 0}.callout-warning,.callout-important{border-color:color-mix(in srgb,var(--warn) 55%,var(--line))}.callout-risk{border-color:color-mix(in srgb,var(--risk) 55%,var(--line))}.callout-decision{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}.render-error{margin:1.5rem 0;padding:1rem;border:1px solid var(--warn);border-radius:.65rem;background:var(--surface-2)}.render-error p{margin:.3rem 0}
.mobile-reader-tools{display:none}.mobile-context{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line)}.empty-document{padding:1.25rem;border:1px dashed var(--line);color:var(--muted)}
@media(max-width:70rem){body{padding-bottom:4rem}.reader-topbar{position:static}.authority-state{display:none}.reader-layout{display:block}.document-column{padding:2.5rem clamp(1rem,6vw,3rem) 5rem}.artifacts-rail,.toc-rail{display:none}.mobile-reader-tools{position:fixed;z-index:60;right:0;bottom:0;left:0;display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);background:var(--rail)}.mobile-reader-tools details{position:relative}.mobile-reader-tools summary{display:flex;align-items:center;justify-content:center;min-height:3.5rem;padding:.5rem;color:var(--muted);cursor:pointer;list-style:none}.mobile-reader-tools summary::-webkit-details-marker{display:none}.mobile-reader-tools details[open] summary{color:var(--accent);background:var(--accent-soft)}.mobile-panel{position:fixed;right:.75rem;bottom:4.15rem;left:.75rem;max-height:min(70vh,34rem);overflow:auto;padding:1rem;border:1px solid var(--line);border-radius:.75rem;background:var(--surface);box-shadow:var(--shadow)}.mobile-panel .artifact-link{grid-template-columns:1.65rem 1fr}.mobile-panel .toc-link{padding:.55rem}.reader-actions>.source-button{display:none}.document-meta{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:36rem){.reader-topbar{padding:.55rem .75rem}.reader-identity>span:last-child{display:none}.document-column{padding-top:1.8rem}h1{font-size:clamp(2.1rem,12vw,3.15rem)}.document-summary{font-size:.98rem}.document-meta{gap:.75rem}.visual-block figcaption,.code-block figcaption{align-items:flex-start;flex-direction:column}.visual-actions{justify-content:flex-start}.visual-actions button{font-size:.68rem}.chart-data-table th,.chart-data-table td,.data-table th,.data-table td{padding:.48rem .55rem}.mermaid-block.is-expanded{inset:.5rem}.mermaid-block.is-expanded .diagram-viewport{height:calc(100vh - 12rem)}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.diagram-canvas{transition:none}}
@media print{.reader-topbar,.artifacts-rail,.toc-rail,.mobile-reader-tools,.visual-actions,.code-block button{display:none!important}.reader-layout{display:block}.document-column{max-width:56rem;margin:0 auto;padding:0}.visual-block,.code-block,.table-scroll{width:100%;margin:1.5rem 0;transform:none;break-inside:avoid}body{background:#fff;color:#000}}
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
  const controllerHash = createHash("sha256").update(controller).digest("base64");
  const copiedLabel = labels.copied;
  const authorizationLabel = workflow.implementationAuthorized === true ? labels.authorized : labels.authority;
  const mobileContext = `<div class="mobile-context" data-mobile-context>${workflow.action ? `<div class="rail-action"><span>${escapeHtml(labels.nextAction)}</span><strong>${escapeHtml(workflow.action)}</strong></div>` : ""}<div class="gate-card"><span>${escapeHtml(labels.gate)}</span><strong>${escapeHtml(document.type)}</strong><span>${escapeHtml(authorizationLabel)}</span></div></div>`;
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src data:; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'sha256-${controllerHash}'; style-src 'unsafe-inline'; worker-src 'none'">
  <title>${escapeHtml(document.title)} · ${escapeHtml(model.productName)}</title>
  <style>${readerCss}</style>
</head>
<body>
  <a class="skip-link" href="#document">Skip to document</a>
  <header class="reader-topbar">
    <div class="reader-identity"><span class="reader-mark">WB</span><strong>${escapeHtml(model.productName)}</strong><span>${escapeHtml(document.type)}</span></div>
    <div class="reader-actions"><span class="authority-state" title="${escapeHtml(authorizationLabel)}">${escapeHtml(authorizationLabel)}</span>${sourceButton}<button class="icon-button" type="button" data-theme-toggle aria-label="Toggle light and dark theme" aria-pressed="false">◐</button></div>
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
    <aside class="toc-rail" aria-label="${escapeHtml(labels.onThisPage)}"><p class="rail-label">${escapeHtml(labels.onThisPage)}</p><ol class="toc-list">${tocItems || '<li class="toc-link">No sections yet</li>'}</ol><div class="gate-card"><span>${escapeHtml(labels.gate)}</span><strong>${escapeHtml(document.type)}</strong><span>${escapeHtml(authorizationLabel)}</span></div></aside>
  </main>
  <nav class="mobile-reader-tools" aria-label="Reader navigation" data-mobile-reader><details name="reader-navigation" data-mobile-details><summary>${escapeHtml(labels.artifacts)}</summary><div class="mobile-panel"><ol class="artifact-list">${artifactItems || '<li class="artifact-link">No artifacts yet</li>'}</ol>${mobileContext}</div></details><details name="reader-navigation" data-mobile-details><summary>${escapeHtml(labels.onThisPage)}</summary><div class="mobile-panel"><ol class="toc-list">${tocItems || '<li class="toc-link">No sections yet</li>'}</ol>${mobileContext}</div></details></nav>
  <script>${controller}</script>
</body>
</html>`;
}
