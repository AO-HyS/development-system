// @ts-check
const esc = (/** @type {unknown} */ value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** The CLI normalizes local files. Direct renderer callers may only embed media.
 * @param {Record<string, any>} asset @param {"image"|"video"} type */
function uri(asset, type) {
  const pattern = type === "image" ? /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u : /^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/]+=*$/u;
  if (!pattern.test(asset?.dataUrl ?? "")) throw new Error("Report evidence requires normalized embedded media");
  return asset.dataUrl;
}

/** @param {Record<string, any>} asset @param {string} label */
function shot(asset, label) {
  return `<figure class="evidence-shot" data-shot="${label === "Antes" || label === "Before" ? "before" : "after"}"><figcaption><strong>${label}</strong><span>${esc(asset.revision)}${asset.capturedAt ? ` · ${esc(asset.capturedAt)}` : ""}</span></figcaption><button class="shot-expand" type="button" data-shot-expand aria-label="${label}: ${esc(asset.alt)}"><img src="${uri(asset, "image")}" alt="${esc(asset.alt)}" loading="lazy"><span aria-hidden="true">↗</span></button></figure>`;
}

/** @param {Record<string, any>} model @param {string} language */
export function renderEvidence(model, language) {
  const es = language === "es";
  const evidence = model.evidence;
  if (!evidence && !model.completion) return "";
  const title = es ? "El resultado, a la vista" : "See the result";
  if (!evidence) return `<section class="brief-section evidence-section" aria-labelledby="delivery-evidence"><h2 id="delivery-evidence">${title}</h2><p class="evidence-gap">${es ? "Esta entrega no adjunta evidencia visual. El documento por sí solo no demuestra el resultado." : "No visual evidence is attached. This document alone does not demonstrate the result."}</p></section>`;
  const comparisons = (evidence.comparisons ?? []).map((/** @type {Record<string, any>} */ item) => `<article class="evidence-comparison" data-comparison><div class="evidence-heading"><h3>${esc(item.title)}</h3>${item.before && item.after ? `<div class="comparison-controls" role="group" aria-label="${es ? "Vista de la comparación" : "Comparison view"}"><button type="button" data-view="before" aria-pressed="false">${es ? "Antes" : "Before"}</button><button type="button" data-view="after" aria-pressed="true">${es ? "Después" : "After"}</button><button type="button" data-view="both" aria-pressed="false">${es ? "Lado a lado" : "Side by side"}</button></div>` : ""}</div>${item.description ? `<p class="evidence-description">${esc(item.description)}</p>` : ""}<div class="evidence-pair">${item.before ? shot(item.before, es ? "Antes" : "Before") : ""}${item.after ? shot(item.after, es ? "Después" : "After") : ""}</div></article>`).join("");
  const recordings = (evidence.recordings ?? []).map((/** @type {Record<string, any>} */ item) => `<figure class="evidence-recording"><figcaption><span class="recording-symbol" aria-hidden="true">▶</span><div><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></div></figcaption><video controls playsinline preload="metadata" aria-label="${esc(item.title)}"${item.poster ? ` poster="${uri(item.poster, "image")}"` : ""}><source src="${uri(item.asset, "video")}" type="${esc(item.asset.mimeType)}">${es ? "Tu navegador no puede reproducir este video." : "Your browser cannot play this video."}</video><p class="recording-note">${es ? "Grabación del recorrido" : "Recorded walkthrough"} · ${esc(item.asset.revision)}</p>${item.transcript ? `<details class="recording-transcript"><summary>${es ? "Leer el recorrido del video" : "Read the video walkthrough"}</summary><p>${esc(item.transcript)}</p></details>` : ""}</figure>`).join("");
  const gaps = (evidence.gaps ?? []).map((/** @type {Record<string, any>} */ gap) => `<li>${esc(gap.reason)}</li>`).join("");
  return `<section class="brief-section evidence-section" aria-labelledby="delivery-evidence"><div class="section-heading"><h2 id="delivery-evidence" tabindex="-1">${title}</h2><p class="evidence-description">${es ? "Compara las capturas y recorre la demostración. Cada pieza conserva su contexto." : "Compare the captures and watch the demonstration. Each piece preserves its context."}</p></div>${evidence.impact === "nonvisual" ? `<p>${esc(evidence.reason)}</p>` : ""}${comparisons}${recordings}${gaps ? `<aside class="evidence-gap"><strong>${es ? "Evidencia pendiente" : "Evidence missing"}</strong><ul>${gaps}</ul></aside>` : ""}</section>`;
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
