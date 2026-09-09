import assert from 'node:assert/strict';
import test from 'node:test';
import { rosterChain, rosterRoute } from '../src/agent-roster.mjs';

test('media preparation can use Luna without moving live Computer Use or critique off Astra', () => {
  assert.equal(rosterRoute('evidence-preparation').role, 'evidence_preparer');
  assert.deepEqual(rosterChain('evidence-preparation').map(c => [c.harness, c.model]), [['codex', 'gpt-5.6-luna']]);
  for (const route of ['computer-use', 'visual-review']) {
    assert.equal(rosterChain(route)[0].model, 'gpt-6-astra');
  }
  assert.equal(rosterChain('fast-execution')[0].model, 'opencode-go/muse-spark-1.3-contributor');
  assert.equal(rosterRoute('evidence-preparation').candidates[0].mappingStatus, 'provisional');
});
