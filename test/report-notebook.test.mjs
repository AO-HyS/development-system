import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildTechnicalReaderModel, renderTechnicalReaderHtml } from '../artifacts/1.28.0/skills/internal/working-backwards/scripts/t3-reader.mjs';
import { writeTechnicalReport } from '../artifacts/1.28.0/skills/internal/working-backwards/scripts/t3-report.mjs';
import { startReaderLive } from '../artifacts/1.28.0/skills/internal/working-backwards/scripts/reader-live.mjs';

const render = (document) => renderTechnicalReaderHtml(buildTechnicalReaderModel({ presentation: 'report', language: 'es', document }));
const markdown = '# Informe\n\n**La preparación está lista.** Aún no hay resultados.\n\n## Alcance\n\nPrimer párrafo.\n\n- Uno\n- Dos\n\n> [!WARNING]\n> Cuidado.\n\n## Siguiente\n\nOtro párrafo.\n';

test('notebook report leads with the verdict, status marks and numbered findings', () => {
  const html = render({
    title: 'Informe', markdown, updatedAt: '2026-09-22', reference: 'DS-0922',
    signals: [{ tone: 'ok', label: 'Resultado', text: 'lista' }, { tone: 'bogus', label: 'Riesgo', text: 'sin datos' }],
    findings: [{ title: 'Entorno listo', detail: 'Accesos verificados.', status: 'verified' }, { title: 'Sin resultados', status: 'unknown' }],
  });
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script>'));
  assert.match(html, /<meta name="generator" content="development-system-technical-reader">/);
  assert.match(html, /<body class="reader-report">/);
  assert.match(body, /<p class="doc-stamp">Informe<span aria-hidden="true"> · <\/span>2026-09-22<span aria-hidden="true"> · <\/span>DS-0922<\/p>/);
  assert.match(body, /<p class="verdict" data-q="verdict">La preparación está lista\.<\/p>/);
  assert.match(body, /<p class="brief-summary" data-q="summary">Aún no hay resultados\.<\/p>/);
  assert.match(body, /class="signal tone-ok"/);
  assert.match(body, /class="signal tone-ok"[\s\S]*class="signal tone-ok"/, 'unknown tones fall back to ok');
  assert.match(body, /data-q="finding-1"[\s\S]*status-verified/);
  assert.doesNotMatch(body, /status-unknown/);
  assert.match(body, /<span class="toc-num">01<\/span><span class="toc-label">Alcance<\/span>/);
  assert.match(body, /<h2 id="alcance" tabindex="-1"><span class="section-num" aria-hidden="true">01<\/span>Alcance<\/h2>/);
  assert.match(body, /<p data-q="block-\d+">Primer párrafo/);
  assert.match(body, /<li data-q="block-\d+-1">Uno<\/li><li data-q="block-\d+-2">Dos<\/li>/);
  assert.match(body, /<strong>Advertencia<\/strong>/);
  assert.match(html, /data-document="[0-9a-f]{16}"/);
  assert.match(html, /font-family:"Bricolage Grotesque";src:url\(data:font\/woff2;base64,/);
  assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /FIELD NOTES|BRAUN/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.equal(createHash('sha256').update(script).digest('base64'), html.match(/script-src 'sha256-([^']+)'/)[1]);
  assert.doesNotMatch(script, /<\/script/i);
});

test('long summaries stay prose and a report without signals shows its status', () => {
  const long = 'Una frase larga que describe el estado con bastante detalle para no caber en una línea de veredicto, porque explica muchas condiciones distintas al mismo tiempo.';
  const body = render({ title: 'Informe', status: 'En revisión', summary: long, markdown: '## Uno\n\nTexto.' });
  assert.doesNotMatch(body, /class="verdict"/);
  assert.match(body, /class="brief-summary" data-q="summary">Una frase larga/);
  assert.match(body, /tone-plain[\s\S]*Estado:<\/strong> <span>En revisión/);
  const explicit = render({ title: 'Informe', verdict: 'Listo.', summary: 'Listo.', markdown: '## Uno\n\nTexto.' });
  assert.match(explicit, /class="verdict" data-q="verdict">Listo\./);
  assert.doesNotMatch(explicit, /class="brief-summary"/);
});

test('managed report regeneration still recognizes the notebook output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notebook-report-'));
  try {
    const outputPath = join(dir, 'report.html');
    await writeTechnicalReport({ input: { document: { title: 'Informe', markdown } }, outputPath });
    const again = await writeTechnicalReport({ input: { document: { title: 'Informe', markdown: markdown + '\nMás.' } }, outputPath });
    assert.equal(again.presentation, 'report');
    assert.match(await readFile(outputPath, 'utf8'), /Más\./);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Reader server stores margin questions as revisioned batches and refuses unsafe writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-live-'));
  const workspaceDir = join(root, 'workspace');
  await mkdir(workspaceDir);
  await writeFile(join(workspaceDir, 'report.html'), render({ title: 'Informe', markdown }));
  const events = [];
  const live = await startReaderLive({ workspaceDir, readerFileName: 'report.html', ttlMs: 60_000, onQuestions: (event) => events.push(event) });
  try {
    const endpoint = live.localUrl.replace(/\.html$/, '.questions.json');
    const origin = new URL(live.localUrl).origin;
    const data = { documentId: 'abc', title: 'Informe', questions: [{ id: 'q1', blockId: 'block-3', excerpt: 'Primer párrafo.', question: '¿Por qué?' }] };
    const post = (body, headers = {}) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
    assert.deepEqual(await (await fetch(endpoint)).json(), { revision: 0, data: null });
    const first = await post({ expectedRevision: 0, data });
    assert.equal(first.status, 200);
    const receipt = await first.json();
    assert.equal(receipt.revision, 1);
    const responsesPath = join(workspaceDir, '.questions', 'report', 'responses.json');
    const saved = JSON.parse(await readFile(responsesPath, 'utf8'));
    assert.equal(saved.data.questions[0].question, '¿Por qué?');
    assert.equal(saved.reader, 'report.html');
    assert.equal((await stat(responsesPath)).mode & 0o777, 0o600);
    assert.ok((await stat(join(workspaceDir, '.questions', 'report', 'submissions', `${receipt.receipt}.json`))).isFile());
    assert.deepEqual(events.map((event) => [event.revision, event.count]), [[1, 1]]);
    assert.equal((await post({ expectedRevision: 0, data })).status, 409);
    assert.equal((await post({ expectedRevision: 1, data }, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await post({ expectedRevision: 1, data: { questions: [{ blockId: 'x', question: '' }] } })).status, 400);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(endpoint.replace('report.questions.json', 'missing.questions.json'))).status, 404);
    assert.equal((await fetch(live.localUrl, { method: 'POST' })).status, 405);
    assert.equal((await post({ expectedRevision: 1, data })).status, 200);
    await writeFile(join(workspaceDir, 'other.html'), '<p>x</p>');
    await mkdir(join(root, 'elsewhere'));
    await symlink(join(root, 'elsewhere'), join(workspaceDir, '.questions', 'other'));
    const linked = await fetch(endpoint.replace('report.questions.json', 'other.questions.json'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, data }) });
    assert.equal(linked.status, 404);
  } finally {
    await live.stop();
    await rm(root, { recursive: true, force: true });
  }
});
