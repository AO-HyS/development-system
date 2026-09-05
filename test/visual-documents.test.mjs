import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildTechnicalReaderModel, renderTechnicalReaderHtml } from '../artifacts/1.8.1/skills/internal/working-backwards/scripts/t3-reader.mjs';
import { visualImage } from '../artifacts/1.8.1/skills/internal/working-backwards/scripts/visual-document.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><text x="10" y="40">A to B</text></svg>';
const render = (markdown, visuals=[]) => renderTechnicalReaderHtml(buildTechnicalReaderModel({presentation:'report',document:{title:'Evidence',markdown},visuals}));

test('map, numbers and source arrive drawn and readable before scripts execute', () => {
  const html = render('## Flow\n\nThe changed behavior.\n\n```pr-lens\n{"id":"flow"}\n```\n\n```chart\n{"labels":["Before","After","No change"],"values":[-5,10,0],"unit":"ms"}\n```', [{id:'flow',svg,title:'Flow',description:'A sends a value to B.'}]);
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script>'));
  assert.match(body, /class="map-image" src="data:image\/svg\+xml;base64,/);
  assert.match(body, /A sends a value to B/);
  assert.match(body, /-5 <small>ms/);
  assert.match(body, /width:33\.33333333333333%/);
  assert.match(body, /bar-zero/);
  assert.match(body, /width:0%/);
  assert.match(body, /Fuente de este documento/);
  assert.doesNotMatch(body, /data-mermaid|diagram-canvas|authority-state/);
  const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.equal(createHash('sha256').update(script).digest('base64'),html.match(/script-src 'sha256-([^']+)'/)[1]);
});

test('missing visuals and invalid measurements fail instead of making an empty success', () => {
  assert.throws(()=>render('```pr-lens\n{"id":"missing"}\n```'), /Missing PR Lens visual/);
  for (const values of ['["10"]','[null]','[1,2]']) assert.throws(()=>render('```chart\n{"labels":["A"],"values":'+values+'}\n```'), /numeric values/);
  assert.throws(()=>visualImage('<svg viewBox="0 0 0 0"></svg>'), /viewBox/);
});

test('SVG image boundary rejects active content and external loads, while source is escaped', () => {
  for (const payload of ['<script>alert(1)</script>','<foreignObject/>','<image href="https://example.test/tracker"/>','<rect onclick="alert(1)"/>','<style>@import "https://example.test/style";</style>']) {
    assert.throws(()=>visualImage(svg.replace('</svg>',payload+'</svg>')), /active content|external resources/);
  }
  assert.doesNotThrow(()=>visualImage(svg.replace('</svg>', '<rect fill="url(\'#local\')"/></svg>')));
  const body=render('<script>alert(1)</script>').split('<script>')[0];
  assert.match(body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(body, /<script>alert/);
});
