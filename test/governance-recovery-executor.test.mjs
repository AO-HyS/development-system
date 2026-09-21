import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReviewContext, codexArguments, rejectedReviewContext } from '../runtime/jev-governance/executor.mjs';

// Parser fixture for the observed CLI contract: --image consumes one or more
// consecutive values; -- ends options. This never invokes a model or certifies
// the installed provider, but reproduces the prompt-as-image launch failure.
function parseCodexArguments(argv) {
  assert.equal(argv[0], 'exec');
  const options = {}, images = [], positional = [];
  const scalarOptions = new Set(['--sandbox', '--model', '-c', '--cd', '--output-schema']);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') { positional.push(...argv.slice(index + 1)); break; }
    if (token === '--image') {
      const start = images.length;
      while (index + 1 < argv.length && !argv[index + 1].startsWith('-')) images.push(argv[++index]);
      assert.ok(images.length > start, '--image requires at least one value');
    } else if (token === '--json') options[token] = true;
    else if (scalarOptions.has(token)) {
      assert.ok(index + 1 < argv.length, `${token} requires a value`);
      options[token] = argv[++index];
    } else if (token.startsWith('-')) assert.fail(`Unknown option: ${token}`);
    else positional.push(token);
  }
  assert.equal(positional.length, 1, 'Exactly one positional prompt must reach the process');
  return { options, images, prompt: positional[0] };
}

test('native Codex image arguments preserve the assessment prompt across variadic image parsing', async t => {
  const prompt = 'Assess the exact supplied images.\nRuntime bundle: {"manifestHash":"retained-hash"}';
  for (const imagePaths of [['/private/observations/0.jpg'], ['/private/observations/0.jpg', '/private/observations/second capture.png']]) {
    await t.test(`${imagePaths.length} attached image(s)`, () => {
      const argv = codexArguments({ model: 'gpt-6-astra', reasoning: 'xhigh', candidateRoot: '/private/candidate', imagePaths, prompt });
      const parsed = parseCodexArguments(argv);
      assert.deepEqual(parsed.images, imagePaths);
      assert.equal(parsed.prompt, prompt);
      assert.deepEqual(parsed.options, { '--json': true, '--sandbox': 'read-only', '--model': 'gpt-6-astra', '-c': 'model_reasoning_effort="xhigh"', '--cd': '/private/candidate' });
      // Demonstrate the actual regression: without the option terminator, the
      // same parser consumes the prompt as another image and loses the prompt.
      assert.throws(() => parseCodexArguments(argv.filter(arg => arg !== '--')), /Exactly one positional prompt/);
    });
  }
});

test('native Codex research and review arguments retain text-only prompts and the review schema', () => {
  const research = parseCodexArguments(codexArguments({ model: 'gpt-5.6-luna', reasoning: 'high', candidateRoot: '/private/candidate', prompt: 'Read the declared sources and return factual findings.' }));
  assert.deepEqual(research.images, []);
  assert.equal(research.prompt, 'Read the declared sources and return factual findings.');
  assert.deepEqual(research.options, { '--json': true, '--sandbox': 'read-only', '--model': 'gpt-5.6-luna', '-c': 'model_reasoning_effort="high"', '--cd': '/private/candidate' });
  const review = parseCodexArguments(codexArguments({ model: 'gpt-6-astra', reasoning: 'xhigh', candidateRoot: '/private/candidate', schemaPath: '/private/run/review schema.json', prompt: 'Review the authored plan and return the exact schema.' }));
  assert.deepEqual(review.images, []);
  assert.equal(review.prompt, 'Review the authored plan and return the exact schema.');
  assert.deepEqual(review.options, { '--json': true, '--sandbox': 'read-only', '--model': 'gpt-6-astra', '-c': 'model_reasoning_effort="xhigh"', '--cd': '/private/candidate', '--output-schema': '/private/run/review schema.json' });
});

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
