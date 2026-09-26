// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { renderEvidence, pendingEvidenceLine, evidenceController } from "./report-evidence.mjs";

const asset = (/** @type {string} */ name) => new URL(`../assets/${name}`, import.meta.url);
const font = (/** @type {string} */ name) => readFileSync(asset(name)).toString("base64");
const fonts = `@font-face{font-family:"Bricolage Grotesque";src:url(data:font/woff2;base64,${font("bricolage-grotesque-latin.woff2")}) format("woff2");font-style:normal;font-weight:200 800;font-stretch:75% 100%;font-display:swap}
@font-face{font-family:"Atkinson Hyperlegible Next";src:url(data:font/woff2;base64,${font("atkinson-hyperlegible-next-latin.woff2")}) format("woff2");font-style:normal;font-weight:200 800;font-display:swap}
@font-face{font-family:"Monaspace Neon";src:url(data:font/woff2;base64,${font("monaspace-neon-latin-400.woff2")}) format("woff2");font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:"Monaspace Neon";src:url(data:font/woff2;base64,${font("monaspace-neon-latin-600.woff2")}) format("woff2");font-style:normal;font-weight:600;font-display:swap}
`;
const css = fonts + readFileSync(asset("visual-document.css"), "utf8") + readFileSync(asset("report-evidence.css"), "utf8");
const notebookController = readFileSync(asset("report-notebook.js"), "utf8");
const string = (/** @type {unknown} */ value) => typeof value === "string" ? value : "";
const esc = (/** @type {unknown} */ value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const two = (/** @type {number} */ value) => String(value).padStart(2, "0");
const FOLD_ROWS = 8;
const FOLD_COLUMNS = 4;
const FOLD_CELLS = 30;

/** SVG is embedded as an image, never inserted as active document markup. @param {unknown} svg */
export function visualImage(svg) {
  if (typeof svg !== "string" || svg.length > 2_000_000 || !/^\s*<svg[\s>]/u.test(svg) || !/<\/svg>\s*$/u.test(svg)) throw new Error("Visual requires a complete SVG image smaller than 2 MB");
  if (/<(?:script|foreignObject|iframe|object|embed)\b|<!DOCTYPE|<!ENTITY|\son[a-z]+\s*=/iu.test(svg)) throw new Error("Visual contains active content");
  if (/\b(?:href|src)\s*=\s*["'](?!#)/iu.test(svg) || [...svg.matchAll(/url\(([^)]*)\)/giu)].some(match => !/^["']?#[\w:.-]+["']?$/u.test(match[1].trim())) || /@import/iu.test(svg)) throw new Error("Visual must not load external resources");
  const box = /viewBox\s*=\s*["']\s*(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/u.exec(svg);
  if (!box || !Number.isFinite(Number(box[3])) || !Number.isFinite(Number(box[4])) || Number(box[3]) <= 0 || Number(box[4]) <= 0) throw new Error("Visual requires a finite, positive viewBox");
  // PR Lens supplies geometry; the shared presentation supplies reading size.
  const readable = svg.replace("</svg>", '<style>.ntitle{font-size:17px;fill:#eef1f5}.nsub{font-size:13px;font-family:system-ui,sans-serif;fill:#bfc6d0}.lanelabel{font-size:10px;fill:#c4cbd5}.ltext{fill:#d5dbe3}</style></svg>');
  const still = readable.replace(/<circle\b[^>]*>\s*<animateMotion\b[\s\S]*?<\/circle>/gu, "").replace(/<animate(?:Motion|Transform)?\b[^>]*\/>/gu, "");
  const uri = (/** @type {string} */ value) => `data:image/svg+xml;base64,${Buffer.from(value).toString("base64")}`;
  return { animated: uri(readable), still: uri(still), width: Number(box[3]), height: Number(box[4]), hasMotion: readable !== still };
}

/** @param {Record<string, any>} block @param {Record<string, any>} model @param {string} language */
function graph(block, model, language) {
  let reference;
  try { reference = JSON.parse(block.source); } catch { throw new Error("pr-lens fence must contain an object with an id"); }
  const visual = (model.visuals ?? []).find((/** @type {Record<string, any>} */ item) => item.id === reference?.id);
  if (!visual) throw new Error(`Missing PR Lens visual: ${string(reference?.id)}`);
  const image = visualImage(visual.svg);
  const title = string(visual.title) || string(block.filename) || "PR Lens";
  const description = string(visual.description) || title;
  const label = language === "es" ? "Ampliar mapa" : "Expand map";
  return `<figure class="document-map" data-map><figcaption><strong>${esc(title)}</strong><div class="map-actions"><button type="button" data-map-expand aria-expanded="false">${label}</button>${image.hasMotion ? `<button type="button" data-map-motion aria-pressed="false">${language === "es" ? "Animar recorrido" : "Animate flow"}</button>` : ""}</div></figcaption><p class="map-scroll-hint">${language === "es" ? "Desliza horizontalmente para recorrer el mapa." : "Scroll horizontally to explore the map."}</p><div class="map-scroll" tabindex="0" role="region" aria-label="${esc(description)}"><img class="map-image" src="${image.still}" data-still="${image.still}"${image.hasMotion ? ` data-animated="${image.animated}"` : ""} width="${image.width}" height="${image.height}" style="--map-w:${Math.round(image.width)}" alt="${esc(description)}"></div>${visual.caption ? `<p class="map-caption">${esc(visual.caption)}</p>` : ""}<details class="map-description"><summary>${language === "es" ? "Leer el recorrido" : "Read the flow"}</summary><p>${esc(description)}</p></details></figure>`;
}

/** @param {Record<string, any>} block @param {string} language */
function bars(block, language) {
  /** @type {{type?:string,labels:string[],values:number[],title?:string,unit?:string,precision?:number,annotations?:string[],note?:string}} */
  const data = JSON.parse(block.source);
  if (data.type && data.type !== "bar") return null;
  if (!Array.isArray(data.labels) || !Array.isArray(data.values) || !data.labels.length || data.labels.length > 40 || data.labels.length !== data.values.length || data.values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Chart labels and finite numeric values must have equal lengths (1–40)");
  const min = Math.min(0, ...data.values), max = Math.max(0, ...data.values), span = max - min || 1;
  const zero = -min / span * 100;
  const precision = Number.isInteger(data.precision) ? Math.min(6, Math.max(0, data.precision ?? 1)) : 1;
  const number = new Intl.NumberFormat(language === "es" ? "es-MX" : "en-US", { maximumFractionDigits: precision });
  const title = string(data.title) || (language === "es" ? "Comparación" : "Comparison");
  return `<figure class="document-chart"><figcaption><strong>${esc(title)}</strong>${data.unit ? `<span>${esc(data.unit)}</span>` : ""}</figcaption><ol class="bar-list">${data.labels.map((label, index) => { const value = data.values[index], left = value < 0 ? zero + value / span * 100 : zero; return `<li><div class="bar-heading"><span>${esc(label)}</span><strong>${number.format(value)}${data.unit ? ` <small>${esc(data.unit)}</small>` : ""}</strong></div><div class="bar-track" aria-hidden="true"><span class="bar-fill${index === 0 ? " is-primary" : ""}" style="left:${left}%;width:${Math.abs(value) / span * 100}%"></span>${min < 0 ? `<i class="bar-zero" style="left:${zero}%"></i>` : ""}</div>${Array.isArray(data.annotations) && data.annotations[index] ? `<p class="bar-note">${esc(data.annotations[index])}</p>` : ""}</li>`; }).join("")}</ol>${data.note ? `<p class="chart-note">${esc(data.note)}</p>` : ""}</figure>`;
}

/** A bold opening sentence is the author's verdict; long summaries stay prose.
 * @param {Record<string, any>} doc */
function verdictOf(doc) {
  const summary = string(doc.summary).trim();
  if (string(doc.verdict)) return { verdict: string(doc.verdict), lede: summary === string(doc.verdict) ? "" : summary };
  const lead = /^\*\*([^*]+?)\*\*\s*([\s\S]*)$/u.exec(summary);
  if (lead && lead[1].length <= 170) return { verdict: lead[1], lede: lead[2] };
  if (summary.length <= 150) return { verdict: summary, lede: "" };
  return { verdict: "", lede: summary };
}

const calloutLabel = /** @type {Record<string, Record<string, string>>} */ ({
  es: { note: "Nota", warning: "Advertencia", important: "Importante", decision: "Decisión", risk: "Riesgo" },
  en: { note: "Note", warning: "Warning", important: "Important", decision: "Decision", risk: "Risk" },
});

const statusMark = {
  verified: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="currentColor"/></svg>',
  estimated: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor"/></svg>',
  pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

/** Shared report presentation: a field-notebook page with margin questions.
 * @param {Record<string, any>} model
 * @param {{renderBlock:(block:Record<string, any>)=>string,inlineMarkdown:(text:string)=>string}} helpers
 */
export function renderVisualDocument(model, helpers) {
  const language = model.language === "en" ? "en" : "es";
  const es = language === "es";
  const doc = model.document;
  const sections = [];
  /** @type {{heading: Record<string, any>|null, blocks: Record<string, any>[]}} */
  let current = { heading: null, blocks: [] };
  for (const block of model.blocks) {
    if (block.headerOnly) continue;
    if (block.type === "heading" && block.level === 2) { if (current.heading || current.blocks.length) sections.push(current); current = { heading: block, blocks: [] }; }
    else current.blocks.push(block);
  }
  if (current.heading || current.blocks.length) sections.push(current);

  // Stable block ids let saved questions find their paragraph after a rebuild.
  const askable = (/** @type {string} */ html, /** @type {string} */ id) => {
    if (/^<li>/u.test(html)) return html;
    if (/^<(?:ul|ol)>/u.test(html)) { let index = 0; return html.replace(/<li>/gu, () => `<li data-q="${esc(id)}-${++index}">`); }
    return html.replace(/^<(p|blockquote|aside|div class="table-scroll"|figure class="(?:document-chart|code-block)[^"]*")/u, (tag) => `${tag} data-q="${esc(id)}"`);
  };
  // Long or wide tables fold behind a one-line summary, except when the table
  // opens its section: then it is the content the reader came for.
  const table = (/** @type {Record<string, any>} */ block, /** @type {boolean} */ first) => {
    const html = askable(helpers.renderBlock(block), block.id);
    const rows = Array.isArray(block.rows) ? block.rows.length : 0;
    const columns = Array.isArray(block.columns) ? block.columns.map((/** @type {unknown} */ column) => String(column).replace(/[*_`~]/gu, "").replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1").trim()).filter(Boolean) : [];
    if (first || (rows <= FOLD_ROWS && columns.length <= FOLD_COLUMNS && rows * Math.max(columns.length, 1) <= FOLD_CELLS)) return html;
    const heads = columns.join(" · ");
    return `<details class="table-fold"><summary><span class="fold-label"><strong>${es ? "Tabla" : "Table"}: ${rows} ${es ? (rows === 1 ? "fila" : "filas") : (rows === 1 ? "row" : "rows")}</strong>${heads ? `<span class="fold-heads">${esc(heads.length > 90 ? `${heads.slice(0, 89)}…` : heads)}</span>` : ""}</span><span class="fold-action" aria-hidden="true"><span class="fold-open">${es ? "Abrir tabla" : "Open table"}</span><span class="fold-close">${es ? "Cerrar tabla" : "Close table"}</span></span></summary>${html}</details>`;
  };
  const render = (/** @type {Record<string, any>} */ block, /** @type {number} */ index = -1) => {
    if (block.language === "pr-lens") return graph(block, model, language);
    if (block.type === "table") return table(block, index === 0);
    if (block.type === "chart") { const chart = bars(block, language); return chart ? askable(chart, block.id) : helpers.renderBlock(block); }
    if (block.type === "mermaid") return `<details class="document-source legacy-diagram" open><summary>${esc(block.filename || "Mermaid")} · ${es ? "fuente del diagrama" : "diagram source"}</summary><p>${es ? "Este documento conserva la fuente. Para mostrar un mapa portátil, adjunta la vista SVG de PR Lens." : "The source is preserved. Attach a PR Lens SVG view to show a portable map."}</p><pre>${esc(block.source)}</pre></details>`;
    if (block.type === "heading") return helpers.renderBlock(block);
    if (block.type === "callout") return askable(helpers.renderBlock(block).replace(/<strong>([a-z]+)<\/strong>/u, (tag, tone) => `<strong>${esc(calloutLabel[language][tone] ?? tone)}</strong>`), block.id);
    return askable(helpers.renderBlock(block), block.id);
  };

  const evidence = renderEvidence(model, language);
  // When nothing was captured yet, one line after "what changed" replaces the evidence section.
  const pendingLine = pendingEvidenceLine(model, language);
  const changedPattern = es ? /^qu[ée] cambi[óo]/iu : /^what changed/iu;
  const pendingAt = pendingLine ? Math.max(0, sections.findIndex(section => changedPattern.test(string(section.heading?.text).trim()))) : -1;
  let number = 0;
  const numeral = () => `<span class="section-num" aria-hidden="true">${two(++number)}</span>`;
  // Every section offers a visible way to ask; it opens the margin-question composer.
  const askIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z"/><path d="M10.2 9.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1"/><path d="M12 13.6h.01"/></svg>';
  const askButton = (/** @type {string} */ id, /** @type {string} */ title) => `\n<button type="button" class="section-ask" data-section-ask="${esc(id)}" aria-label="${esc(es ? `Preguntar sobre «${title}»` : `Ask about “${title}”`)}">${askIcon}<span>${es ? "Preguntar" : "Ask"}</span></button>`;
  const labelOf = (/** @type {string} */ id) => string(model.outline.find((/** @type {Record<string, any>} */ entry) => entry.id === id)?.label);
  const evidenceTitle = es ? "El resultado, a la vista" : "See the result";
  const evidenceHtml = evidence ? evidence
    .replace(/(<h2 id="delivery-evidence"[^>]*>)/u, (tag) => `${tag}${numeral()}`)
    .replace(/<div class="section-heading">(<h2 id="delivery-evidence"[\s\S]*?<\/h2>)/u, (_match, h2) => `<div class="section-heading" data-q="section-delivery-evidence" data-section-title="${esc(evidenceTitle)}"><div class="section-title">${h2}${askButton("delivery-evidence", evidenceTitle)}</div>`) : "";
  const content = sections.map((section, sectionIndex) => {
    const intro = section.heading && section.blocks[0]?.type === "paragraph" ? section.blocks[0] : null;
    const heading = section.heading ? render(section.heading).replace(/^(<h2[^>]*>)/u, (tag) => `${tag}${numeral()}`) : "";
    const id = section.heading ? string(section.heading.anchorId) : "";
    const title = labelOf(id) || string(section.heading?.text);
    return `<section class="brief-section"${section.heading ? ` aria-labelledby="${esc(id)}"` : ""}>${section.heading ? `<div class="section-heading" data-q="section-${esc(id)}" data-section-title="${esc(title)}"><div class="section-title">${heading}${askButton(id, title)}</div>${intro ? `<div class="section-intro">${render(intro)}</div>` : ""}</div>` : ""}<div class="section-content">${section.blocks.filter(block => block !== intro).map(block => render(block, section.blocks.indexOf(block))).join("\n")}${sectionIndex === pendingAt ? `\n${pendingLine}` : ""}</div></section>`;
  }).join("\n");

  const entries = [
    ...(evidence ? [{ id: "delivery-evidence", label: es ? "El resultado, a la vista" : "See the result" }] : []),
    ...model.outline.filter((/** @type {Record<string, any>} */ entry) => entry.level === 2),
  ];
  const links = entries.map((entry, index) => `<a href="#${esc(entry.id)}"><span class="toc-num">${two(index + 1)}</span><span class="toc-label">${esc(entry.label)}</span></a>`).join("");

  const { verdict, lede } = verdictOf(doc);
  const stamp = [es ? "Informe" : "Report", string(doc.updatedAt), string(doc.reference)].filter(Boolean).map(esc).join('<span aria-hidden="true"> · </span>');
  const signals = doc.signals?.length
    ? doc.signals.map((/** @type {Record<string, any>} */ signal) => `<li class="signal tone-${esc(signal.tone)}"><i aria-hidden="true"></i>${signal.label ? `<strong>${esc(signal.label)}:</strong> ` : ""}<span>${esc(signal.text)}</span></li>`).join("")
    : `<li class="signal tone-plain"><i aria-hidden="true"></i><strong>${es ? "Estado" : "Status"}:</strong> <span>${esc(doc.status)}</span></li>`;
  const statusLabel = /** @type {Record<string,string>} */ (es ? { verified: "verificado", estimated: "estimado", pending: "pendiente" } : { verified: "verified", estimated: "estimated", pending: "pending" });
  const findings = doc.findings?.length ? `<section class="findings" aria-labelledby="findings-title" data-q="section-findings" data-section-title="${es ? "Hallazgos" : "Findings"}"><div class="section-title"><h2 id="findings-title" class="notebook-label">${es ? "Hallazgos" : "Findings"}</h2>${askButton("findings", es ? "Hallazgos" : "Findings")}</div><ol>${doc.findings.map((/** @type {Record<string, any>} */ finding, /** @type {number} */ index) => `<li class="finding" data-q="finding-${index + 1}"><span class="finding-num" aria-hidden="true">${index + 1}</span><p><strong>${esc(finding.title)}.</strong> ${helpers.inlineMarkdown(string(finding.detail))}</p>${finding.status ? `<span class="finding-status status-${esc(finding.status)}">${statusMark[/** @type {"verified"} */ (finding.status)]}${statusLabel[finding.status]}</span>` : "<span></span>"}</li>`).join("")}</ol></section>` : "";
  const documentId = createHash("sha256").update(`${string(doc.title)}\n${string(doc.markdown)}`).digest("hex").slice(0, 16);

  const controller = evidenceController + notebookController;
  const hash = createHash("sha256").update(controller).digest("base64");
  const moon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7Z"/></svg>';
  const themeButton = (/** @type {string} */ extra) => `<button type="button" class="theme-control${extra}" data-theme-toggle aria-pressed="false">${moon}<span>${es ? "Libreta nocturna" : "Night notebook"}</span></button>`;
  const readTime = `${doc.readTimeMinutes || 1} min ${es ? "de lectura" : "read"}`;
  return `<!doctype html><html lang="${language}" data-theme="light" data-document="${documentId}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="development-system-technical-reader"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'self'; font-src data:; form-action 'none'; frame-src 'none'; img-src data: blob:; media-src data:; object-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; worker-src 'none'"><title>${esc(doc.title)} · ${esc(model.productName)}</title><style>${css}</style></head><body class="reader-report"><a class="skip-link" href="#document">${es ? "Ir al documento" : "Skip to document"}</a>`
    + `<header class="brief-topbar"><a class="document-brand" href="#document"><span class="brand-project">${esc(model.productName)}</span><span class="brand-task">${esc(doc.title)}</span></a><details class="document-nav"><summary>${es ? "Índice" : "Contents"}</summary><nav aria-label="${es ? "Contenido del documento" : "Document contents"}">${links}</nav></details>${themeButton(" is-compact")}</header>`
    + `<div class="document-layout"><aside class="document-sidebar"><p class="notebook-label">${es ? "Contenido" : "Contents"}</p><nav aria-label="${es ? "Secciones" : "Sections"}">${links}</nav><div class="sidebar-note"><strong>${esc(doc.type)}</strong><span>${esc(model.productName)}</span><span>${readTime}</span>${themeButton("")}</div></aside>`
    + `<main id="document" class="brief"><header class="brief-header"><p class="doc-stamp">${stamp}</p><h1>${esc(doc.title)}</h1>${verdict ? `<p class="verdict" data-q="verdict">${helpers.inlineMarkdown(verdict)}</p>` : ""}${lede ? `<p class="brief-summary" data-q="summary">${helpers.inlineMarkdown(lede)}</p>` : ""}<ul class="signals" aria-label="${es ? "Estado del informe" : "Report status"}">${signals}</ul>${findings}</header>`
    + `<div class="document-body">${evidenceHtml}\n${content}</div><footer class="brief-footer"><details class="document-source"><summary>${es ? "Fuente de este documento" : "Document source"}</summary><pre>${esc(doc.markdown || "")}</pre></details><p>${es ? "Documento local · conserva la evidencia y el alcance de la entrega." : "Local document · preserves delivery evidence and scope."} ${esc(doc.type)} · ${esc(doc.status)}${doc.updatedAt ? ` · ${esc(doc.updatedAt)}` : ""} · ${readTime}</p><button type="button" data-print>${es ? "Imprimir / guardar PDF" : "Print / save PDF"}</button></footer></main>`
    + `<aside class="margin-notes" aria-label="${es ? "Preguntas en el margen" : "Margin questions"}" data-margin><ol class="margin-list" data-notes></ol></aside></div>`
    + `<script>${controller}</script></body></html>`;
}
