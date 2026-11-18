// @ts-check
const esc = (/** @type {unknown} */ value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const string = (/** @type {unknown} */ value) => typeof value === "string" ? value : "";
const mark = {
  verified: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="currentColor"/></svg>',
  pending: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

/** The CLI normalizes local files. Direct renderer callers may only embed media.
 * @param {Record<string, any>} asset @param {"image"|"video"} type */
function uri(asset, type) {
  const pattern = type === "image" ? /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u : /^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/]+=*$/u;
  if (!pattern.test(asset?.dataUrl ?? "")) throw new Error("Report evidence requires normalized embedded media");
  return asset.dataUrl;
}

/** @param {Record<string, any>} asset @param {string} label */
function shot(asset, label) {
  return `<figure class="evidence-shot" data-shot="${label === "Antes" || label === "Before" ? "before" : "after"}"><figcaption><strong>${label}</strong><span>${esc(asset.revision)}${asset.capturedAt ? ` · ${esc(asset.capturedAt)}` : ""}</span></figcaption><button class="shot-expand" type="button" data-shot-expand aria-label="${label}: ${esc(asset.alt)}"><img src="${uri(asset, "image")}" alt="${esc(asset.alt)}" loading="lazy"><span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 5h10v10M19 5 6 18"/></svg></span></button></figure>`;
}

/** True when the result section would list only pending items: no image and no recording exists.
 * @param {Record<string, any>|undefined} evidence */
function allPending(evidence) {
  if (!evidence || evidence.impact === "nonvisual" || !(evidence.gaps ?? []).length) return false;
  return !(evidence.recordings ?? []).length && !(evidence.comparisons ?? []).some((/** @type {Record<string, any>} */ entry) => entry.before || entry.after);
}

/** One quiet line, counted by kind, for a result that has no evidence yet.
 * @param {Record<string, any>} model @param {string} language */
export function pendingEvidenceLine(model, language) {
  if (!allPending(model.evidence)) return "";
  const es = language === "es";
  const gaps = model.evidence.gaps ?? [];
  const captures = gaps.filter((/** @type {Record<string, any>} */ gap) => gap.kind === "before" || gap.kind === "after").length;
  const recordings = gaps.filter((/** @type {Record<string, any>} */ gap) => gap.kind === "recording").length;
  const parts = [
    captures ? `${captures} ${es ? (captures === 1 ? "captura" : "capturas") : (captures === 1 ? "screenshot" : "screenshots")}` : "",
    recordings ? `${recordings} ${es ? (recordings === 1 ? "grabación" : "grabaciones") : (recordings === 1 ? "recording" : "recordings")}` : "",
  ].filter(Boolean);
  if (!parts.length) return "";
  return `<p class="evidence-pending-line" data-q="evidence-pending">${mark.pending}<span><strong>${es ? "Evidencia pendiente" : "Evidence pending"}:</strong> ${parts.join(", ")}</span></p>`;
}

/** @param {Record<string, any>} model @param {string} language */
export function renderEvidence(model, language) {
  const es = language === "es";
  const evidence = model.evidence;
  if (!evidence && !model.completion) return "";
  if (allPending(evidence) && pendingEvidenceLine(model, language)) return "";
  const title = es ? "El resultado, a la vista" : "See the result";
  if (!evidence) return `<section class="brief-section evidence-section" aria-labelledby="delivery-evidence"><div class="section-heading"><h2 id="delivery-evidence" tabindex="-1">${title}</h2></div><ul class="evidence-list"><li class="evidence-item status-pending">${mark.pending}<span><strong>${es ? "Sin evidencia visual" : "No visual evidence"}</strong> · ${es ? "el documento por sí solo no demuestra el resultado." : "this document alone does not demonstrate the result."}</span></li></ul></section>`;
  const comparisons = (evidence.comparisons ?? []).map((/** @type {Record<string, any>} */ item) => `<article class="evidence-comparison" data-comparison><div class="evidence-heading"><h3>${esc(item.title)}</h3>${item.before && item.after ? `<div class="comparison-controls" role="group" aria-label="${es ? "Vista de la comparación" : "Comparison view"}"><button type="button" data-view="before" aria-pressed="false">${es ? "Antes" : "Before"}</button><button type="button" data-view="after" aria-pressed="true">${es ? "Después" : "After"}</button><button type="button" data-view="both" aria-pressed="false">${es ? "Lado a lado" : "Side by side"}</button></div>` : ""}</div>${item.description ? `<p class="evidence-description">${esc(item.description)}</p>` : ""}<div class="evidence-pair">${item.before ? shot(item.before, es ? "Antes" : "Before") : ""}${item.after ? shot(item.after, es ? "Después" : "After") : ""}</div></article>`).join("");
  const recordings = (evidence.recordings ?? []).map((/** @type {Record<string, any>} */ item) => `<figure class="evidence-recording"><figcaption><span class="recording-symbol" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg></span><div><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></div></figcaption><video controls playsinline preload="metadata" aria-label="${esc(item.title)}"${item.poster ? ` poster="${uri(item.poster, "image")}"` : ""}><source src="${uri(item.asset, "video")}" type="${esc(item.asset.mimeType)}">${es ? "Tu navegador no puede reproducir este video." : "Your browser cannot play this video."}</video><p class="recording-note">${es ? "Grabación del recorrido" : "Recorded walkthrough"} · ${esc(item.asset.revision)}</p>${item.transcript ? `<details class="recording-transcript"><summary>${es ? "Leer el recorrido del video" : "Read the video walkthrough"}</summary><p>${esc(item.transcript)}</p></details>` : ""}</figure>`).join("");
  // A short status-marked list says what was captured and what is missing before the media.
  const item = (/** @type {"verified"|"pending"} */ status, /** @type {string} */ label, /** @type {string} */ detail) => `<li class="evidence-item status-${status}">${mark[status]}<span><span class="visually-hidden">${label === (es ? "Pendiente" : "Missing") ? "" : status === "verified" ? (es ? "Adjunta: " : "Attached: ") : (es ? "Pendiente: " : "Missing: ")}</span><strong>${esc(label)}</strong>${detail ? ` · ${esc(detail)}` : ""}</span></li>`;
  const listed = [
    ...(evidence.comparisons ?? []).map((/** @type {Record<string, any>} */ entry) => item(entry.before && entry.after ? "verified" : "pending", entry.title, entry.before && entry.after ? (es ? "antes y después" : "before and after") : (es ? "comparación incompleta" : "incomplete comparison"))),
    ...(evidence.recordings ?? []).map((/** @type {Record<string, any>} */ entry) => item("verified", entry.title, es ? "grabación" : "recording")),
    ...(evidence.gaps ?? []).map((/** @type {Record<string, any>} */ gap) => item("pending", es ? "Pendiente" : "Missing", string(gap.reason))),
  ].join("");
  return `<section class="brief-section evidence-section" aria-labelledby="delivery-evidence"><div class="section-heading"><h2 id="delivery-evidence" tabindex="-1">${title}</h2></div>${evidence.impact === "nonvisual" ? `<p class="evidence-description">${esc(evidence.reason)}</p>` : ""}${listed ? `<ul class="evidence-list">${listed}</ul>` : ""}${comparisons}${recordings}</section>`;
}

// Progressive enhancement: images remain readable without JavaScript. Native
// dialog provides focus containment, Escape dismissal and top-layer placement.
export const evidenceController = `
document.querySelectorAll('[data-comparison]').forEach(group=>{
 const controls=group.querySelector('.comparison-controls');if(!controls)return;
 group.dataset.view='after';group.classList.add('is-interactive');
 controls.addEventListener('click',event=>{const button=event.target.closest('[data-view]');if(!button)return;group.dataset.view=button.dataset.view;controls.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)))});
});
const lightbox=document.createElement('dialog');lightbox.className='evidence-lightbox';
const close=document.createElement('button');close.type='button';close.textContent=document.documentElement.lang==='es'?'Cerrar captura':'Close capture';
const full=document.createElement('img');lightbox.append(close,full);document.body.append(lightbox);
let origin=null;close.addEventListener('click',()=>lightbox.close());lightbox.addEventListener('close',()=>{document.body.classList.remove('image-open');if(origin)origin.focus()});
document.querySelectorAll('[data-shot-expand]').forEach(button=>button.addEventListener('click',()=>{origin=button;const image=button.querySelector('img');full.src=image.src;full.alt=image.alt;lightbox.showModal();document.body.classList.add('image-open')}));
document.querySelectorAll('video').forEach(video=>video.addEventListener('play',()=>{document.querySelectorAll('video').forEach(other=>{if(other!==video)other.pause()})}));
`;
