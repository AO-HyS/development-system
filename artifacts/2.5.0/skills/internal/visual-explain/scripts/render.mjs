#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const directory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') {
  throw new Error('Use --input packet.json --output visual.html');
}
const input = resolve(args[1]), output = resolve(args[3]);
if (input === output) throw new Error('Input and output must differ');
const source = await readFile(input, 'utf8');
if (Buffer.byteLength(source) > 64 * 1024) throw new Error('Packet exceeds 64 KiB');
const packet = JSON.parse(source);
const text = (value, field, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${field} (1–${max} characters)`);
  return value.trim();
};
if (!packet || Array.isArray(packet) || typeof packet !== 'object') throw new Error('Packet must be an object');
if (!['plan', 'delivery'].includes(packet.mode)) throw new Error('mode must be plan or delivery');
const language = packet.language ?? 'es';
if (!['es', 'en'].includes(language)) throw new Error('language must be es or en');
const title = text(packet.title, 'title', 120);
const intro = text(packet.intro, 'intro', 360);
const closing = text(packet.closing, 'closing', 640);
if (!Array.isArray(packet.steps) || packet.steps.length < 2 || packet.steps.length > 8) throw new Error('Use 2–8 steps');
const steps = packet.steps.map((step, i) => {
  if (!step || typeof step !== 'object') throw new Error(`Invalid step ${i}`);
  const id = text(step.id, 'step.id', 40);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Step ids must be lowercase slugs');
  if (!['done', 'active', 'pending', 'blocked'].includes(step.state)) throw new Error(`Invalid state for ${id}`);
  return { id, label: text(step.label, 'step.label', 30), state: step.state,
    include: text(step.include, 'step.include', 480), exclude: text(step.exclude, 'step.exclude', 480) };
});
if (new Set(steps.map(s => s.id)).size !== steps.length) throw new Error('Step ids must be unique');
if (steps.filter(s => s.state === 'active').length > 1) throw new Error('At most one active stage');
const selected = steps.findIndex(step => step.id === packet.selected);
if (selected < 0) throw new Error('selected must name a step');
if (packet.gates !== undefined && !Array.isArray(packet.gates)) throw new Error('gates must be an array');
const gates = (packet.gates ?? []).map(gate => {
  if (!gate || typeof gate !== 'object') throw new Error('Invalid gate');
  const before = steps.findIndex(step => step.id === gate.before);
  if (before < 1) throw new Error('Gate must precede an existing nonfirst step');
  return { before, label: text(gate.label, 'gate.label', 50) };
});
if (new Set(gates.map(g => g.before)).size !== gates.length) throw new Error('One gate per boundary');
const words = language === 'es'
  ? { done: 'Hecho', active: 'En curso', pending: 'Pendiente', blocked: 'Bloqueado', stages: 'Etapas del trabajo',
      include: packet.mode === 'plan' ? 'Incluye' : 'Comprobado', exclude: packet.mode === 'plan' ? 'Deja fuera' : 'Sin comprobar',
      hint: 'Elige una etapa para entender su alcance.', static: 'Vista estática de la etapa seleccionada.' }
  : { done: 'Done', active: 'In progress', pending: 'Pending', blocked: 'Blocked', stages: 'Work stages',
      include: packet.mode === 'plan' ? 'Includes' : 'Verified', exclude: packet.mode === 'plan' ? 'Leaves out' : 'Not verified',
      hint: 'Choose a stage to understand its scope.', static: 'Static view of the selected stage.' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = await readFile(resolve(directory, '../assets/line-window.css'), 'utf8');
const js = await readFile(resolve(directory, '../assets/line-window.js'), 'utf8');
const state = { steps, selected };
const json = JSON.stringify(state).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const html = `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head>
<body><main><h1>${escape(title)}</h1><p class="intro">${escape(intro)}</p>
<figure aria-label="${escape(words.stages)}"><p class="hint">${escape(words.hint)}</p>
<div class="drawing" style="--count:${steps.length}"><ol class="rail">${steps.map((step, i) => `<li class="step ${step.state}" data-index="${i}">${gates.filter(g => g.before === i).map(g => `<span class="gate"><span>${escape(g.label)}</span><svg viewBox="0 0 10 18" aria-hidden="true"><path d="M3 1v16M7 1v16"/></svg></span>`).join('')}<button type="button" disabled aria-pressed="${i === selected}" aria-controls="annotations"><span class="point" aria-hidden="true"></span><span class="label">${escape(step.label)}</span><span class="state">${escape(words[step.state])}</span></button></li>`).join('')}</ol>
<div class="focus-window" style="left:${(selected + 0.5) * 100 / steps.length}%;transform:translateX(-50%)" aria-hidden="true"></div></div>
<svg class="connections" height="40" aria-hidden="true"><path/><path/></svg>
<div id="annotations" class="annotations" role="region" aria-live="polite" aria-atomic="true" aria-label="${escape(steps[selected].label)}">
<section><h2>${escape(words.include)}</h2><p id="include">${escape(steps[selected].include)}</p></section>
<section><h2>${escape(words.exclude)}</h2><p id="exclude">${escape(steps[selected].exclude)}</p></section></div>
<noscript><p class="hint">${escape(words.static)}</p></noscript></figure>
<p class="closing">${escape(closing)}</p></main>
<script id="visual-data" type="application/json">${json}</script><script>${js}</script></body></html>\n`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);
console.log(JSON.stringify({ htmlPath: output, sha256: createHash('sha256').update(html).digest('hex'), mode: packet.mode, stages: steps.length }));
