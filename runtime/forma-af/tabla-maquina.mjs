#!/usr/bin/env node
// tabla-maquina.mjs <machine-file.ts>: for every state of every XState machine the file exports, the events it
// handles (own or inherited with ↑), the ones it IGNORES, and its invokes.
// It imports product code: run it only on modules the packet names, from the app folder so 'xstate' resolves.
// Limits: it reads the machine definition; it does not prove guards, actions, wildcard handlers or the screen.
// A transition with neither target nor actions is shown as «(nada)», apart from a real handling.
// Exit 1 when the file cannot be imported or exports no machine.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

if (process.argv.length !== 3) {
  console.error('Usage: node tabla-maquina.mjs <machine-file.ts>');
  process.exit(2);
}
const file = path.resolve(process.argv[2]);
/** @type {Record<string, any>} */
let mod;
try {
  mod = await import(pathToFileURL(file).href);
} catch (error) {
  console.error(`Cannot import ${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
let machines = 0;
for (const [name, m] of Object.entries(mod)) {
  if (!m || typeof m !== 'object' || !m.root || !m.config) continue;
  machines += 1;
  /** @type {any[]} */
  const nodes = [];
  /** @param {any} n */
  const walk = (n) => { nodes.push(n); for (const c of Object.values(n.states ?? {})) walk(c); };
  walk(m.root);
  const events = new Set();
  for (const n of nodes) for (const k of Object.keys(n.config.on ?? {})) if (!k.startsWith('xstate.') && k !== '*') events.add(k);
  console.log(`## ${name}  events: ${[...events].join(', ')}`);
  for (const n of nodes) {
    if (n === m.root || Object.keys(n.states ?? {}).length) continue;
    /** @type {Map<string, string>} */
    const handled = new Map();
    for (let p = n; p; p = p.parent) for (const [k, v] of Object.entries(p.config.on ?? {})) if (!handled.has(k)) {
      const targets = [v].flat().map((t) => (typeof t === 'string' ? t : t?.target ? [t.target].flat().join('|') : t?.actions ? '(acción)' : '(nada)'));
      handled.set(k, (p === n ? '' : '↑') + targets.join(' / '));
    }
    const invokes = [n.config.invoke].flat().filter(Boolean).map((i) => `invoca ${i.src}${i.onDone ? ' →done ' + [i.onDone.target ?? i.onDone].flat().join('|') : ''}${i.onError ? ' →error ' + [i.onError.target ?? i.onError].flat().join('|') : ''}`);
    const ignored = [...events].filter((e) => !handled.has(e));
    console.log(`- ${n.path.join('.')}${n.type === 'final' ? ' (final)' : ''}: ${[...handled].map(([k, v]) => `${k}→${v}`).join('; ') || 'sin eventos'}${invokes.length ? ' | ' + invokes.join('; ') : ''}${n.config.after ? ' | after' : ''}${n.config.always ? ' | always' : ''}\n    IGNORA: ${ignored.join(', ') || '—'}`);
  }
}
if (machines === 0) {
  console.error(`No XState machine exported by ${file}`);
  process.exit(1);
}
