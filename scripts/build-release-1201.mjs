// Runtime-only patch. Published artifacts and catalog 0.41.0 stay unchanged.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const previous = read('manifests/1.20.0.json');
const current = read('manifests/1.20.1.json');
if (JSON.stringify({ ...current, contractVersion: '1.20.0' }) !== JSON.stringify(previous)) {
  throw new Error('Runtime patch must preserve every published artifact and destination');
}
const pkg = read('package.json');
if (pkg.version !== '1.20.1' || pkg.contractVersion !== '1.20.1') {
  throw new Error('Expected runtime and contract version 1.20.1');
}
console.log('1.20.1 reuses the unchanged 1.20.0 artifacts and catalog 0.41.0');
