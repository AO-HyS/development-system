import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReviewContext, rejectedReviewContext } from '../runtime/jev-governance/executor.mjs';

test('final review receives the same authored plan and its matching independent review without author conversation', () => {
  const plan = { id: 'current-plan', summary: 'C1 verification sequence', criterionIds: ['C1'], packets: [{ id: 'P1', readSet: ['fixture.html'], writeSet: [], dependsOn: [] }], privateAuthorConversation: 'must never reach fresh reviewer' };
  const run = { plans: [plan], reviews: [{ id: 'stale-review', planId: 'older-plan', kind: 'plan-review', verdict: 'pass' }, { id: 'current-review', planId: plan.id, kind: 'plan-review', verdict: 'pass', criterionIds: ['C1'] }], findings: [{ id: 'R1', message: 'Actual unresolved defect', resolved: false }, { id: 'R0', resolved: true }], verifications: [] };
  const first = buildReviewContext(run, 'plan-reviewer');
  const final = buildReviewContext(run, 'reviewer');
  assert.deepEqual(final.authoredPlan, first.authoredPlan);
  assert.equal(final.authoredPlan.id, plan.id);
  assert.equal(final.planReview.id, 'current-review');
  assert.equal(first.planReview, null);
  assert.deepEqual(final.unresolvedFindings.map(f => f.id), ['R1']);
  assert.equal(JSON.stringify(final).includes('must never reach'), false);
  assert.equal(buildReviewContext(run, 'researcher'), null);
});

test('correction retains actual rejected review defects and rejects tampered output before handing it to another reviewer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'review-correction-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'rejected-outputs'), { mode: 0o700 });
  const output = JSON.stringify({ kind: 'review', verdict: 'revise', criterionIds: ['C1'], findings: [{ id: 'R1', severity: 'medium', criterionIds: ['C1'], message: 'Required reviewed plan was missing.' }, { id: 'R2', severity: 'info', criterionIds: ['C1'], message: 'Positive observation in an invalid field.' }] });
  const sha256 = createHash('sha256').update(output).digest('hex');
  const relativePath = `rejected-outputs/${sha256}.txt`;
  await writeFile(join(directory, relativePath), output, { mode: 0o600 });
  const run = { attempts: [{ id: 'failed-review', role: 'reviewer', status: 'failed', failure: 'review finding is malformed', candidateHash: 'candidate', rejectedOutput: { relativePath, sha256, size: Buffer.byteLength(output) } }] };
  const context = await rejectedReviewContext(run, 'reviewer', directory);
  assert.equal(JSON.parse(context.output).findings[0].message, 'Required reviewed plan was missing.');
  assert.equal(context.attemptId, 'failed-review');
  assert.equal(await rejectedReviewContext(run, 'plan-reviewer', directory), null);
  await writeFile(join(directory, relativePath), output.replace('missing', 'present'));
  await assert.rejects(rejectedReviewContext(run, 'reviewer', directory), /changed/);
});
