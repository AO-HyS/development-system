// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { renderEvidence, evidenceController } from "./report-evidence.mjs";

const css = readFileSync(new URL("../assets/visual-document.css", import.meta.url), "utf8") + readFileSync(new URL("../assets/report-evidence.css", import.meta.url), "utf8");
const string = (/** @type {unknown} */ value) => typeof value === "string" ? value : "";
const esc = (/** @type {unknown} */ value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

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
  return `<figure class="document-map" data-map><figcaption><strong>${esc(title)}</strong><div class="map-actions"><button type="button" data-map-expand aria-expanded="false">${label}</button>${image.hasMotion ? `<button type="button" data-map-motion aria-pressed="false">${language === "es" ? "Animar recorrido" : "Animate flow"}</button>` : ""}</div></figcaption><p class="map-scroll-hint">${language === "es" ? "Desliza horizontalmente para recorrer el mapa." : "Scroll horizontally to explore the map."}</p><div class="map-scroll" tabindex="0" role="region" aria-label="${esc(description)}"><img class="map-image" src="${image.still}" data-still="${image.still}"${image.hasMotion ? ` data-animated="${image.animated}"` : ""} width="${image.width}" height="${image.height}" alt="${esc(description)}"></div>${visual.caption ? `<p class="map-caption">${esc(visual.caption)}</p>` : ""}<details class="map-description"><summary>${language === "es" ? "Leer el recorrido" : "Read the flow"}</summary><p>${esc(description)}</p></details></figure>`;
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

const controller = evidenceController + `(()=>{const root=document.documentElement;const reduced=matchMedia('(prefers-reduced-motion: reduce)');let expanded=null;const collapse=()=>{if(!expanded)return;expanded.classList.remove('is-expanded');expanded.querySelector('[data-map-expand]').setAttribute('aria-expanded','false');expanded.querySelector('[data-map-expand]').textContent=root.lang==='es'?'Ampliar mapa':'Expand map';expanded.querySelector('[data-map-expand]').focus();expanded=null;document.body.classList.remove('map-open')};document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-theme-toggle')){const dark=root.dataset.theme==='dark';root.dataset.theme=dark?'light':'dark';button.setAttribute('aria-pressed',String(!dark));return}if(button.hasAttribute('data-print')){window.print();return}const map=button.closest('[data-map]');if(!map)return;if(button.hasAttribute('data-map-expand')){if(expanded===map){collapse();return}collapse();expanded=map;map.classList.add('is-expanded');button.setAttribute('aria-expanded','true');button.textContent=root.lang==='es'?'Cerrar mapa':'Close map';document.body.classList.add('map-open');return}if(button.hasAttribute('data-map-motion')){const image=map.querySelector('img'),playing=button.getAttribute('aria-pressed')!=='true';image.src=playing?image.dataset.animated:image.dataset.still;button.setAttribute('aria-pressed',String(playing));button.textContent=playing?(root.lang==='es'?'Pausar recorrido':'Pause flow'):(root.lang==='es'?'Animar recorrido':'Animate flow')}});document.addEventListener('keydown',event=>{if(event.key==='Escape')collapse();if(event.key==='Tab'&&expanded){const controls=[...expanded.querySelectorAll('button,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}});reduced.addEventListener('change',()=>{if(reduced.matches)document.querySelectorAll('[data-map-motion][aria-pressed="true"]').forEach(button=>button.click())});document.querySelectorAll('.document-nav a').forEach(link=>link.addEventListener('click',()=>document.querySelector('.document-nav').open=false));const navLinks=[...document.querySelectorAll('.document-sidebar nav a')];const headings=[...document.querySelectorAll('.brief-section h2')];let requested=null;navLinks.forEach(link=>link.addEventListener('click',()=>{requested=link.hash;mark()}));const releaseRequested=()=>{requested=null};document.addEventListener('wheel',releaseRequested,{passive:true});document.addEventListener('touchmove',releaseRequested,{passive:true});document.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))releaseRequested()});const mark=()=>{let active=headings[0];for(const heading of headings){if(heading.getBoundingClientRect().top<180)active=heading}if(requested)active=headings.find(heading=>'#'+heading.id===requested)||active;navLinks.forEach(link=>{if(active&&link.hash==='#'+active.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current')})};let pending=false;document.addEventListener('scroll',()=>{if(!pending){pending=true;requestAnimationFrame(()=>{mark();pending=false})}},{passive:true});mark();})();`;

/** Shared report, completion, review and explanation presentation.
 * @param {Record<string, any>} model
 * @param {{renderBlock:(block:Record<string, any>)=>string,inlineMarkdown:(text:string)=>string}} helpers
 */
export function renderVisualDocument(model, helpers) {
  const language = model.language === "en" ? "en" : "es";
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
  const render = (/** @type {Record<string, any>} */ block) => {
    if (block.language === "pr-lens") return graph(block, model, language);
    if (block.type === "chart") return bars(block, language) ?? helpers.renderBlock(block);
    if (block.type === "mermaid") return `<details class="document-source legacy-diagram" open><summary>${esc(block.filename || "Mermaid")} · ${language === "es" ? "fuente del diagrama" : "diagram source"}</summary><p>${language === "es" ? "Este documento conserva la fuente. Para mostrar un mapa portátil, adjunta la vista SVG de PR Lens." : "The source is preserved. Attach a PR Lens SVG view to show a portable map."}</p><pre>${esc(block.source)}</pre></details>`;
    return helpers.renderBlock(block);
  };
  const content = sections.map(section => {
    const intro = section.heading && section.blocks[0]?.type === "paragraph" ? section.blocks[0] : null;
    return `<section class="brief-section"${section.heading ? ` aria-labelledby="${esc(section.heading.anchorId)}"` : ""}>${section.heading ? `<div class="section-heading">${render(section.heading)}${intro ? `<div class="section-intro">${render(intro)}</div>` : ""}</div>` : ""}<div class="section-content">${section.blocks.filter(block => block !== intro).map(render).join("\n")}</div></section>`;
  }).join("\n");
  const evidence = renderEvidence(model, language);
  const links = (evidence ? `<a href="#delivery-evidence">${language === "es" ? "El resultado, a la vista" : "See the result"}</a>` : "") + model.outline.filter((/** @type {Record<string, any>} */ entry) => entry.level === 2).map((/** @type {Record<string, any>} */ entry) => `<a href="#${esc(entry.id)}">${esc(entry.label)}</a>`).join("");
  const hash = createHash("sha256").update(controller).digest("base64");
  return `<!doctype html><html lang="${language}" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="development-system-technical-reader"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; frame-src 'none'; img-src data:; media-src data:; object-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; worker-src 'none'"><title>${esc(doc.title)} · ${esc(model.productName)}</title><style>${css}</style></head><body class="reader-report"><a class="skip-link" href="#document">${language === "es" ? "Ir al documento" : "Skip to document"}</a><header class="brief-topbar"><a class="document-brand" href="#document"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 3h11l5 5v13H4zM15 3v6h5M8 12h8M8 16h6"/></svg><span class="brand-project">${esc(model.productName)}</span><span class="brand-task">${esc(doc.title)}</span></a><details class="document-nav"><summary>${language === "es" ? "Índice" : "Contents"}</summary><nav aria-label="${language === "es" ? "Contenido del documento" : "Document contents"}">${links}</nav></details><button type="button" class="theme-control" data-theme-toggle aria-label="${language === "es" ? "Cambiar tema" : "Change theme"}" aria-pressed="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7Z"/></svg></button></header><div class="document-layout"><aside class="document-sidebar"><p>${language === "es" ? "En este documento" : "In this document"}</p><nav aria-label="${language === "es" ? "Secciones" : "Sections"}">${links}</nav><div class="sidebar-note">${esc(doc.type)}<span>${doc.readTimeMinutes || 1} min ${language === "es" ? "de lectura" : "read"}</span></div></aside><main id="document" class="brief"><header class="brief-header"><div><h1>${esc(doc.title)}</h1>${doc.summary ? `<p class="brief-summary">${helpers.inlineMarkdown(doc.summary)}</p>` : ""}</div><div class="document-facts"><strong>${esc(doc.type)}</strong><p>${esc(doc.status)}</p>${doc.updatedAt ? `<p>${esc(doc.updatedAt)}</p>` : ""}${doc.readTimeMinutes ? `<p>${doc.readTimeMinutes} min ${language === "es" ? "de lectura" : "read"}</p>` : ""}</div></header><div class="document-body">${evidence}${content}</div><footer class="brief-footer"><details class="document-source"><summary>${language === "es" ? "Fuente de este documento" : "Document source"}</summary><pre>${esc(doc.markdown || "")}</pre></details><p>${language === "es" ? "Documento local · conserva la evidencia y el alcance de la entrega." : "Local document · preserves delivery evidence and scope."}</p><button type="button" data-print>${language === "es" ? "Imprimir / guardar PDF" : "Print / save PDF"}</button></footer></main></div><script>${controller}</script></body></html>`;
}
