import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('HTML grill preserves submissions, rejects conflicts and isolates rounds', () => {
  execFileSync('python3', ['-B', fileURLToPath(new URL('./grill_questionnaire.py', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 30000,
  });
});
