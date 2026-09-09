// @ts-check
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const version = '1.11.1';
const catalogVersion = '0.32.1';
for (const path of [`artifacts/${version}`, `manifests/${version}.json`, `catalog/${catalogVersion}.json`]) {
  let published = true;
  try { execFileSync('git', ['cat-file', '-e', `origin/main:${path}`], { cwd: root, stdio: 'pipe' }); } catch { published = false; }
  if (published) throw new Error(`Refusing to rewrite published ${path}`);
}
/** @param {string} path */
const read = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const catalog = await read('catalog/0.32.0.json');
catalog.catalogVersion = catalogVersion;
for (const skill of catalog.skills) {
  if (skill.logicalName !== 'impeccable' && !skill.source.path?.includes('/skills/shortcuts/')) continue;
  const canonical = skill.variants[0];
  for (const legacyRoot of ['.codex', '.factory']) skill.variants.push({
    ...canonical, id: `${skill.logicalName}.${legacyRoot.slice(1)}-compat`,
    destination: `${legacyRoot}/skills/${skill.logicalName}`, expectedMirrorOf: canonical.id,
  });
}
await writeFile(resolve(root, `catalog/${catalogVersion}.json`), JSON.stringify(catalog, null, 2) + '\n');
await mkdir(resolve(root, `artifacts/${version}`), { recursive: true });
const contract = (await readFile(resolve(root, 'artifacts/1.11.0/contract.md'), 'utf8')).replace('Contract 1.11.0', 'Contract 1.11.1');
await writeFile(resolve(root, `artifacts/${version}/contract.md`), contract);
const manifest = await read('manifests/1.11.0.json');
manifest.contractVersion = version;
for (const artifact of manifest.artifacts) {
  if (artifact.logicalName === 'development-contract') artifact.sourcePath = `artifacts/${version}/contract.md`;
  if (artifact.logicalName === 'skill-catalog') artifact.sourcePath = `catalog/${catalogVersion}.json`;
  artifact.sha256 = createHash('sha256').update(await readFile(resolve(root, artifact.sourcePath))).digest('hex');
}
await writeFile(resolve(root, `manifests/${version}.json`), JSON.stringify(manifest, null, 2) + '\n');
