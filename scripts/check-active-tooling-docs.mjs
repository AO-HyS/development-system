// @ts-check
// Static release gate for current instructions. Immutable release history stays
// outside this explicit surface; retirement explanations are not commands.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const activeToolingDocs = [
  'README.md', 'docs/package-distribution.md', 'docs/repository-preparation.md',
  'docs/current-work.md', 'docs/model-routing.md', 'docs/system-flow.md',
];
// Docs that describe current routing: a stale version or a wrong computer-use owner is drift.
const routingDocs = new Set(['docs/model-routing.md', 'docs/system-flow.md']);
const historical = /\b(?:historical|histórico|anterior|previous)\b/iu;
const computerUseByOpenAi = /\b(?:Sol|Astra)\b[^.\n]*\b(?:computer use|uso de computadora)\b/iu;
const retired = /\b(?:initialize-repository|normalize-repository|development-steward-schedule-enable|sync-skills|rollback-skills|guardrails-enable|claude-orchestration-enable|report-gate-enable)\b|\bpnpm\s+(?:exec\s+)?(?:ds|aohys-development-system)\s+(?:setup|document|sync-skills|advisory-status)\b|--version\s+1\.\d+\.\d+\b/u;

/** @param {string} text @param {string} file */
export function activeToolingDocFindings(text, file) {
  const findings = [];
  let fence = null;
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line);
    if (delimiter) { fence = fence === null ? delimiter[1][0] : fence === delimiter[1][0] ? null : fence; continue; }
    const command = fence !== null ? line.trim() : (line.includes('`') || /(?:^|\s)(?:pnpm|development-system|aohys-development-system)\s|\b(?:run|use|execute|invoke|ejecuta|usa)\b/i.test(line)) ? line : '';
    if (!command || command.startsWith('#')) continue;
    if (fence === null && /\b(?:retired|never|do not|no longer|fail before|retirad[oa]|no ejecutes)\b/i.test(command)) continue;
    if (retired.test(command)) findings.push(`${file}:${index + 1}: retired shared-tooling command in current instructions`);
  }
  return findings;
}

/** @param {string} text @param {string} file @param {string} version */
export function staleClaimFindings(text, file, version) {
  const findings = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (historical.test(line)) continue;
    const stale = (line.match(/\b[12]\.\d+\.\d+\b/gu) ?? []).find((v) => v !== version);
    if (stale) findings.push(`${file}:${index + 1}: stale version ${stale} (current ${version})`);
    if (computerUseByOpenAi.test(line)) findings.push(`${file}:${index + 1}: Sol or Astra does not do computer use (Terra does)`);
  }
  return findings;
}

/** @param {string} [version] defaults to the package.json version */
export async function checkActiveToolingDocs(version) {
  version ??= JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  const findings = [];
  for (const file of activeToolingDocs) {
    let text;
    try { text = await readFile(resolve(root, file), 'utf8'); }
    catch (error) { if (file === 'docs/current-work.md' && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') continue; throw error; }
    findings.push(...activeToolingDocFindings(text, file));
    if (routingDocs.has(file)) findings.push(...staleClaimFindings(text, file, /** @type {string} */ (version)));
  }
  if (findings.length) throw new Error(findings.join('\n'));
  return { checked: activeToolingDocs, valid: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkActiveToolingDocs()));
}
