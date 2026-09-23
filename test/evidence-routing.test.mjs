import assert from 'node:assert/strict';
import test from 'node:test';
import { rosterChain, rosterRoute } from '../src/agent-roster.mjs';

test('native media preparation, Computer Use and critique request Astra XHigh', () => {
  assert.equal(rosterRoute('evidence-preparation').role, 'evidence_preparer');
  for (const route of ['evidence-preparation', 'computer-use', 'visual-review']) {
    assert.deepEqual(rosterChain(route).map(c => [c.harness, c.model, c.reasoning]), [['codex', 'gpt-6-astra', 'xhigh']]);
  }
  assert.equal(rosterChain('fast-execution')[0].model, 'gpt-6-luna');
  assert.equal(rosterChain('fast-execution')[0].reasoning, 'high');
  assert.equal(rosterChain('fast-execution')[0].serviceTier.tier, 'priority');
  assert.equal(rosterRoute('evidence-preparation').candidates[0].mappingStatus, 'runtime-required');
});
