// @ts-check
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRolePolicyOutputs, checkRolePolicyOutputs } from '../src/role-policy.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || !['--write', '--check'].includes(args[0])) {
  process.stderr.write('Usage: node scripts/build-role-policy.mjs --write|--check\n');
  process.exit(2);
}
const root = fileURLToPath(new URL('../', import.meta.url));
if (args[0] === '--write') {
  for (const [relative, content] of Object.entries(renderRolePolicyOutputs())) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
const receipt = checkRolePolicyOutputs(root);
if (!receipt.valid) {
  process.stderr.write(`${receipt.errors.join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write('Generated role policy is coherent and current.\n');
