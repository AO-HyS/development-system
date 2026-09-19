import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runWorkflow, validateAcceptance, validateDriverPlan } from '../scripts/run-jev-workflow.mjs';

const coordinator = { adapter: 'codex', model: 'gpt-5.6-sol', effort: 'high' };
const ids = ['1', '2', '3', '4', '5', '6', '7'];
const approved = { approved: true, findings: [], observations: ['Observed the required behavior'] };
const rejection = { approved: false, findings: [{ severity: 'high', description: 'Preserve the draft but correct its result', paths: ['src/main.mjs'] }], observations: [] };
const packet = (id, paths, acceptanceIds = ids) => ({ id, objective: `Implement ${id}`, readSet: [], writeSet: paths, dependsOn: [], instructions: `EXACT ${id}: preserve the existing result and make the required change.`, checks: ['node --check src/main.mjs'], acceptanceIds });
const plan = packets => ({ summary: 'Bounded fixture task', packets, integrationChecks: ['node --check src/main.mjs'] });
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

async function fixture(packets = [packet('writer', ['src'])]) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'jev-driver-')));
  const root = join(base, 'product');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.mjs'), 'export const value = "baseline";\n');
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture']);
  const config = { arm: 'fixture-flow', ticket: 'FIXTURE-1', jevMode: 'flow', coordinator, acceptanceIds: ids, requiresVisualReview: true,
    root, baseSha: git(root, ['rev-parse', 'HEAD']).trim(), evidenceDirectory: join(base, 'evidence'), workerRoots: join(base, 'workers'), dependencyLinks: [],
    preflightPath: join(base, 'preflight.json'), qaRecipePath: join(base, 'qa.md'), credentialFile: join(base, 'credential.env'), taskFile: join(base, 'task.md') };
  await writeFile(config.preflightPath, JSON.stringify({ ready: true }));
  await writeFile(config.qaRecipePath, 'Observe all configured criteria with isolated synthetic fixtures.');
  await writeFile(config.credentialFile, 'TYPESAFE_API_KEY=synthetic-fixture-key\n');
  await writeFile(config.taskFile, 'Implement the isolated fixture task.');
  const phases = [], requests = [];
  let stopped = false;
  const runtime = {
    startFlashServer: async () => ({ fixture: true }),
    stopFlashServer: async server => { stopped = true; server.stopped = true; },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      const routes = Object.keys(request.questions.route.criteria);
      const answers = Object.fromEntries(Object.keys(request.questions).filter(key => key !== 'route').map(key => [key, { type: 'noul', noul: key === 'context_sufficient' ? 0.9 : 0.1 }]));
      answers.route = { type: 'choice', choice: 'deepseek_exact', confidence: 1, probabilities: Object.fromEntries(routes.map(route => [route, route === 'deepseek_exact' ? 1 : 0])) };
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 10, output_tokens: 5 } }));
    },
  };
  const reply = async (options, value, patches = {}) => {
    phases.push(options.phase);
    await mkdir(options.evidenceDirectory, { recursive: true });
    const receiptPath = join(options.evidenceDirectory, 'receipt.json');
    const receipt = { ok: true, identityAttested: true, cancellationConfirmed: true, execution: options.profile, threadId: options.phase,
      receiptPath, finalText: typeof value === 'string' ? value : JSON.stringify(value), ...patches };
    await writeFile(receiptPath, JSON.stringify(receipt));
    return receipt;
  };
  const qa = async (options, accepted = true) => {
    const directory = options.prompt.match(/runtime evidence inside ([^,\n]+),/)[1];
    await mkdir(directory, { recursive: true });
    const screenshot = join(directory, 'desktop.png');
    await writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
    const observations = join(directory, 'runtime.json');
    await writeFile(observations, JSON.stringify({ observed: true, fixture: true }));
    return { accepted, criteria: ids.map(id => ({ id, passed: accepted || id !== '2', evidence: [id === '7' ? screenshot : observations], observation: `Observed criterion ${id}` })), findings: accepted ? [] : ['Criterion 2 needs correction'] };
  };
  return { base, config, phases, requests, runtime, reply, qa, plan: plan(packets), isStopped: () => stopped };
}

test('direct single-packet planning skips discovery and preserves every review, correction and QA gate through real Git integration', async () => {
  const f = await fixture();
  f.config.planningMode = 'direct';
  f.config.packetization = 'single';
  const partitioned = plan([packet('first', ['src/main.mjs'], ids.slice(0, 3)), packet('second', ['src/new.mjs'], ids.slice(3))]);
  let writes = 0, packetReviews = 0, qaRuns = 0;
  const runtime = { ...f.runtime, runModel: async options => {
    if (options.phase === 'review-writer' || options.phase === 'integrated-code-review') {
      assert.equal(options.sandbox, 'danger-full-access');
      assert.match(options.prompt, /concrete product defect or validation blocker/);
      const temporaryFile = join(options.cwd, '.review-check.tmp');
      await writeFile(temporaryFile, 'Temporary check output');
      try { execFileSync(process.execPath, ['--check', 'src/main.mjs'], { cwd: options.cwd }); }
      finally { await rm(temporaryFile); }
    }
    if (options.phase === 'plan-review' || options.phase === 'visual-critique') assert.equal(options.sandbox, 'read-only');
    if (options.phase === 'plan') {
      assert.deepEqual(options.profile, { adapter: 'codex', model: 'gpt-6-astra', effort: 'xhigh' });
      assert.equal(options.sandbox, 'read-only');
      assert.match(options.prompt, /Inspect the actual relevant source/);
      assert.match(options.prompt, /exactly one coherent implementation packet/);
      return f.reply(options, partitioned);
    }
    if (options.phase === 'plan-correction') {
      assert.match(options.prompt, /Single packetization requires exactly one/);
      return f.reply(options, f.plan);
    }
    if (options.phase === 'plan-review') return f.reply(options, approved);
    if (options.phase === 'write-writer') {
      assert.ok(options.prompt.includes(f.plan.packets[0].instructions));
      writes += 1;
      if (writes === 1) {
        await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "draft";\n');
        await writeFile(join(options.cwd, 'src/new.mjs'), 'export const preserved = true;\n');
      } else {
        assert.match(await readFile(join(options.cwd, 'src/main.mjs'), 'utf8'), /draft/);
        assert.match(await readFile(join(options.cwd, 'src/new.mjs'), 'utf8'), /preserved/);
        await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "corrected";\n');
      }
      return f.reply(options, 'Completed the bounded fixture change');
    }
    if (options.phase === 'review-writer') {
      assert.deepEqual(options.outputSchema.properties.findings.items.properties.severity.enum, ['blocker', 'high', 'medium', 'low']);
      return f.reply(options, ++packetReviews === 1 ? { ...rejection, findings: rejection.findings.map(finding => ({ ...finding, severity: 'P1', description: `${finding.description} at ${options.cwd}/src/main.mjs` })) } : approved);
    }
    if (options.phase === 'integrated-code-review' || options.phase === 'visual-critique') return f.reply(options, approved);
    if (options.phase === 'acceptance') {
      assert.equal(options.timeoutMs, 30 * 60 * 1000);
      return f.reply(options, await f.qa(options, ++qaRuns > 1));
    }
    if (options.phase === 'acceptance-correction') await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "qa-corrected";\n');
    return f.reply(options, 'Observed fixture completion');
  } };
  const result = await runWorkflow(f.config, runtime);
  assert.equal(result.status, 'accepted-local');
  assert.deepEqual(f.phases, ['plan', 'plan-correction', 'plan-review', 'write-writer', 'review-writer', 'write-writer', 'review-writer',
    'integration', 'integrated-code-review', 'acceptance', 'acceptance-correction', 'integrated-code-review', 'acceptance', 'visual-critique']);
  const manifest = JSON.parse(await readFile(join(f.config.evidenceDirectory, 'manifest.json'), 'utf8'));
  const packageVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(manifest.controllerVersion, packageVersion);
  assert.equal(manifest.planningMode, 'direct');
  assert.equal(manifest.packetization, 'single');
  const acceptedPlan = JSON.parse(await readFile(join(f.config.evidenceDirectory, 'approved-plan.json'), 'utf8'));
  assert.equal(acceptedPlan.packets.length, 1);
  assert.deepEqual(acceptedPlan.packets[0].acceptanceIds, ids);
  assert.equal(writes, 2);
  assert.equal(qaRuns, 2);
  assert.equal(f.phases.filter(phase => phase === 'integrated-code-review').length, 2);
  assert.ok(f.phases.indexOf('visual-critique') > f.phases.lastIndexOf('acceptance'));
  assert.match(await readFile(join(f.config.root, 'src/new.mjs'), 'utf8'), /preserved/);
  assert.match(await readFile(join(f.config.root, 'src/main.mjs'), 'utf8'), /qa-corrected/);
  const flows = f.requests.filter(request => request.state.flow);
  assert.deepEqual([...new Set(flows.flatMap(request => request.state.flow.fileSummaries.map(file => file.path)))].sort(), ['src/main.mjs', 'src/new.mjs']);
  assert.ok(flows.some(request => request.state.flow.fileSummaries.some(file => file.summary.includes('+export const'))));
  const events = (await readFile(join(f.config.evidenceDirectory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.some(event => event.phase === 'discovery'), false);
  assert.equal(events.filter(event => event.type === 'job-completed' && event.phase === 'acceptance').length, 2);
  assert.equal(events.filter(event => event.type === 'job-started').length, events.filter(event => event.type === 'job-completed').length);
  assert.equal(f.isStopped(), true);
});

test('invalid planning or packetization modes reject before starting any provider', async () => {
  const f = await fixture();
  const runtime = { ...f.runtime, startFlashServer: async () => { assert.fail('Invalid configuration must not start a provider'); } };
  for (const planningMode of ['unknown', null]) await assert.rejects(runWorkflow({ ...f.config, planningMode }, runtime), /Unknown planning mode/);
  for (const packetization of ['unknown', null]) await assert.rejects(runWorkflow({ ...f.config, packetization }, runtime), /Unknown packetization mode/);
  await assert.rejects(readFile(join(f.config.evidenceDirectory, 'events.jsonl'), 'utf8'), { code: 'ENOENT' });
});

test('unowned new file fails before integration and a late approved sibling review cannot apply after cancellation', async () => {
  const f = await fixture([packet('first', ['src/main.mjs'], ids.slice(0, 3)), packet('second', ['src/second.mjs'], ids.slice(3))]);
  let lateReviewCompleted = false;
  const runtime = { ...f.runtime, runModel: async options => {
    if (options.phase === 'plan') return f.reply(options, f.plan);
    if (options.phase === 'plan-review') return f.reply(options, approved);
    if (options.phase === 'write-first') {
      await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "must-not-apply";\n');
      return f.reply(options, 'Wrote first candidate');
    }
    if (options.phase === 'review-first') {
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      lateReviewCompleted = true;
      return f.reply(options, approved);
    }
    if (options.phase === 'write-second') {
      await writeFile(join(options.cwd, 'unowned.mjs'), 'export const forbidden = true;\n');
      return f.reply(options, 'Created an unowned file');
    }
    return f.reply(options, 'Discovery completed');
  } };
  await assert.rejects(runWorkflow(f.config, runtime), /Unowned candidate change: unowned.mjs/);
  assert.equal(lateReviewCompleted, true);
  assert.match(await readFile(join(f.config.root, 'src/main.mjs'), 'utf8'), /baseline/);
  assert.equal(git(f.config.root, ['status', '--porcelain']).trim(), '');
  const failed = JSON.parse(await readFile(join(f.config.evidenceDirectory, 'workflow-failed.json'), 'utf8'));
  assert.ok(failed.atoms.every(atom => atom.state !== 'verified'));
  assert.deepEqual(failed.activeAttempts, {});
  assert.equal(f.isStopped(), true);
});

test('independent writers and reviewers overlap within configured capacities while each receives its own candidate tree', async () => {
  const f = await fixture([packet('first', ['src/main.mjs'], ids.slice(0, 3)), packet('second', ['src/second.mjs'], ids.slice(3))]);
  f.config.concurrency = { writers: 2, reviewers: 2 };
  await mkdir(join(f.config.root, 'packages/shared'), { recursive: true });
  await mkdir(join(f.config.root, 'apps/dashboard/node_modules/@fixture'), { recursive: true });
  await writeFile(join(f.config.root, '.gitignore'), 'node_modules/\n');
  await writeFile(join(f.config.root, 'packages/shared/package.json'), JSON.stringify({ name: '@fixture/shared' }));
  await writeFile(join(f.config.root, 'apps/dashboard/package.json'), JSON.stringify({ name: '@fixture/dashboard' }));
  await symlink(join(f.config.root, 'packages/shared'), join(f.config.root, 'apps/dashboard/node_modules/@fixture/shared'));
  git(f.config.root, ['add', '.']);
  git(f.config.root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'workspace fixture']);
  f.config.baseSha = git(f.config.root, ['rev-parse', 'HEAD']).trim();
  f.config.dependencyLinks = ['apps/dashboard/node_modules'];
  const writerRoots = new Set(), reviewerRoots = new Set();
  let writers = 0, reviewers = 0, writerPeak = 0, reviewerPeak = 0;
  let releaseWriters, releaseReviews;
  const writerBarrier = new Promise(resolve => { releaseWriters = resolve; });
  const reviewBarrier = new Promise(resolve => { releaseReviews = resolve; });
  const runtime = { ...f.runtime, runModel: async options => {
    if (options.phase === 'plan') return f.reply(options, f.plan);
    if (options.phase === 'plan-review' || options.phase === 'integrated-code-review' || options.phase === 'visual-critique') return f.reply(options, approved);
    if (options.phase.startsWith('write-')) {
      assert.equal(await realpath(join(options.cwd, 'apps/dashboard/node_modules/@fixture/shared')), join(options.cwd, 'packages/shared'));
      writerRoots.add(options.cwd);
      writerPeak = Math.max(writerPeak, ++writers);
      if (writerRoots.size === 2) releaseWriters();
      await writerBarrier;
      const path = options.phase === 'write-first' ? 'src/main.mjs' : 'src/second.mjs';
      await writeFile(join(options.cwd, path), `export const value = ${JSON.stringify(options.phase)};\n`);
      writers -= 1;
      return f.reply(options, 'Independent work completed');
    }
    if (options.phase.startsWith('review-')) {
      assert.equal(await realpath(join(options.cwd, 'apps/dashboard/node_modules/@fixture/shared')), join(options.cwd, 'packages/shared'));
      reviewerRoots.add(options.cwd);
      reviewerPeak = Math.max(reviewerPeak, ++reviewers);
      if (reviewerRoots.size === 2) releaseReviews();
      await reviewBarrier;
      reviewers -= 1;
      return f.reply(options, approved);
    }
    if (options.phase === 'acceptance') return f.reply(options, await f.qa(options));
    return f.reply(options, 'Observed completion');
  } };
  const result = await runWorkflow(f.config, runtime);
  assert.equal(result.status, 'accepted-local');
  assert.deepEqual(f.phases.slice(0, 3), ['discovery', 'plan', 'plan-review']);
  assert.equal(writerPeak, 2);
  assert.equal(reviewerPeak, 2);
  assert.equal(writerRoots.size, 2);
  assert.deepEqual(reviewerRoots, writerRoots);
  assert.match(await readFile(join(f.config.root, 'src/main.mjs'), 'utf8'), /write-first/);
  assert.match(await readFile(join(f.config.root, 'src/second.mjs'), 'utf8'), /write-second/);
});

test('failed billed Jev answer retains known usage and stops before any writer dispatch', async () => {
  const f = await fixture();
  const runtime = { ...f.runtime,
    fetchImpl: async (...args) => {
      const response = await f.runtime.fetchImpl(...args);
      const payload = await response.json();
      payload.model = 'jev-unpinned';
      return new Response(JSON.stringify(payload));
    },
    runModel: async options => f.reply(options, options.phase === 'plan' ? f.plan : options.phase === 'plan-review' ? approved : 'Discovery'),
  };
  await assert.rejects(runWorkflow(f.config, runtime), /unpinned model/);
  assert.equal(f.phases.some(phase => phase.startsWith('write-')), false);
  const events = (await readFile(join(f.config.evidenceDirectory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const failure = events.find(event => event.type === 'jev-completed');
  assert.equal(failure.valid, false);
  assert.deepEqual(failure.usage, { input_tokens: 10, output_tokens: 5 });
  assert.equal(failure.usageComplete, true);
  assert.equal(failure.questions, 5);
  assert.ok(failure.latencyMs >= 0);
  assert.equal(failure.model, 'jev-unpinned');
  assert.equal(JSON.stringify(failure).includes('synthetic-fixture-key'), false);
});

test('invalid review verifier fails receipt validation before any candidate patch is applied', async () => {
  const f = await fixture();
  const runtime = { ...f.runtime, runModel: async options => {
    if (options.phase === 'plan') return f.reply(options, f.plan);
    if (options.phase === 'plan-review') return f.reply(options, approved);
    if (options.phase === 'write-writer') {
      await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "unverified";\n');
      return f.reply(options, 'Completed');
    }
    if (options.phase === 'review-writer') return f.reply(options, approved, { threadId: '' });
    return f.reply(options, 'Discovery');
  } };
  await assert.rejects(runWorkflow(f.config, runtime), /matching acceptance receipt required/);
  assert.match(await readFile(join(f.config.root, 'src/main.mjs'), 'utf8'), /baseline/);
  assert.equal(git(f.config.root, ['status', '--porcelain']).trim(), '');
});

test('check-capable code reviewers cannot approve changed product content, HEAD or branch, or return empty rejections', async () => {
  for (const scenario of [
    { phase: 'review-writer', mutation: 'product', error: /Candidate changed after its immutable review snapshot/ },
    { phase: 'review-writer', mutation: 'head', error: /Worker changed its pinned base revision or detached branch/ },
    { phase: 'review-writer', mutation: 'branch', error: /Worker changed its pinned base revision or detached branch/ },
    { phase: 'integrated-code-review', mutation: 'product', error: /Independent review changed the integrated candidate/ },
    { phase: 'integrated-code-review', mutation: 'head', error: /Integrated candidate changed its pinned base revision or branch/ },
    { phase: 'integrated-code-review', mutation: 'branch', error: /Integrated candidate changed its pinned base revision or branch/ },
    { phase: 'review-writer', mutation: null, error: /Rejected review requires concrete findings/ },
  ]) {
    const f = await fixture();
    const runtime = { ...f.runtime, runModel: async options => {
      if (options.phase === 'plan') return f.reply(options, f.plan);
      if (options.phase === 'plan-review') return f.reply(options, approved);
      if (options.phase === 'write-writer') {
        await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "writer-candidate";\n');
        return f.reply(options, 'Completed the candidate');
      }
      if (options.phase === scenario.phase) {
        assert.equal(options.sandbox, 'danger-full-access');
        if (scenario.mutation === 'product') await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "reviewer-mutated";\n');
        if (scenario.mutation === 'head' || scenario.mutation === 'branch') {
          const beforeTree = git(options.cwd, ['write-tree']).trim();
          if (scenario.mutation === 'head') git(options.cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'Unauthorized reviewer commit']);
          else git(options.cwd, ['switch', '-c', 'unauthorized-review-branch']);
          assert.equal(git(options.cwd, ['write-tree']).trim(), beforeTree);
        }
        return f.reply(options, scenario.mutation ? approved : { approved: false, findings: [], observations: ['Existing check could not run'] });
      }
      if (options.phase === 'review-writer' || options.phase === 'integrated-code-review') return f.reply(options, approved);
      return f.reply(options, 'Observed completion');
    } };
    await assert.rejects(runWorkflow(f.config, runtime), scenario.error);
    assert.equal(f.phases.includes('acceptance'), false);
    await assert.rejects(readFile(join(f.config.evidenceDirectory, 'acceptance.json'), 'utf8'), { code: 'ENOENT' });
    if (scenario.phase === 'review-writer') {
      assert.match(await readFile(join(f.config.root, 'src/main.mjs'), 'utf8'), /baseline/);
      const failed = JSON.parse(await readFile(join(f.config.evidenceDirectory, 'workflow-failed.json'), 'utf8'));
      assert.ok(failed.atoms.every(atom => atom.state !== 'verified'));
    }
  }
});

test('original-root plans are corrected and every dispatched packet is bound to its private detached worktree', async () => {
  const f = await fixture();
  await writeFile(f.config.taskFile, `Repository: ${f.config.root}\nBranch: main\nImplement this fixture task.`);
  const invalid = plan([{ ...packet('writer', ['src']), instructions: `Work from ${f.config.root} on branch main and edit ${f.config.root}/src/main.mjs.` }]);
  const portable = plan([{ ...packet('writer', ['src']), instructions: 'Edit {{WORKTREE_ROOT}}/src/main.mjs at {{BASE_SHA}}, branch {{BRANCH}}.', checks: ['node --check {{WORKTREE_ROOT}}/src/main.mjs'] }]);
  const runtime = { ...f.runtime, runModel: async options => {
    if (options.phase === 'plan') return f.reply(options, invalid);
    if (options.phase === 'plan-correction') return f.reply(options, portable);
    if (options.phase === 'plan-review' || options.phase === 'integrated-code-review' || options.phase === 'visual-critique') return f.reply(options, approved);
    if (options.phase === 'write-writer' || options.phase === 'review-writer') {
      assert.equal(options.prompt.includes(f.config.root), false);
      assert.equal(options.prompt.includes('{{WORKTREE_ROOT}}'), false);
      assert.equal(options.prompt.includes('branch main'), false);
      assert.ok(options.prompt.includes(`Edit ${options.cwd}/src/main.mjs at ${f.config.baseSha}, branch HEAD.`));
      assert.ok(options.prompt.includes(`node --check ${options.cwd}/src/main.mjs`));
      assert.equal(git(options.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'HEAD');
      if (options.phase === 'write-writer') {
        await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "bound-worker";\n');
        return f.reply(options, 'Edited the bound candidate');
      }
      return f.reply(options, approved);
    }
    if (options.phase === 'acceptance') return f.reply(options, await f.qa(options));
    return f.reply(options, 'Observed completion');
  } };
  assert.equal((await runWorkflow(f.config, runtime)).status, 'accepted-local');
  assert.equal(f.phases.filter(phase => phase === 'plan-correction').length, 1);
  assert.match(await readFile(join(f.config.root, 'src/main.mjs'), 'utf8'), /bound-worker/);
});

test('unexpected source-root mutation and empty implementation both fail before candidate acceptance', async () => {
  for (const mutateSource of [true, false]) {
    const f = await fixture();
    const runtime = { ...f.runtime, runModel: async options => {
      if (options.phase === 'plan') return f.reply(options, f.plan);
      if (options.phase === 'plan-review') return f.reply(options, approved);
      if (options.phase === 'write-writer') {
        if (mutateSource) await writeFile(join(f.config.root, 'src/main.mjs'), 'export const value = "unauthorized-source-edit";\n');
        return f.reply(options, 'Claimed completion with an empty private candidate');
      }
      return f.reply(options, 'Discovery');
    } };
    await assert.rejects(runWorkflow(f.config, runtime), mutateSource ? /Source root changed outside controller-approved integration/ : /Empty implementation candidate/);
    assert.equal(f.phases.some(phase => phase.startsWith('review-writer') || phase === 'acceptance'), false);
    const events = (await readFile(join(f.config.evidenceDirectory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(events.some(event => event.type === 'task-accepted'), false);
    assert.equal(events.some(event => event.type === 'source-root-violation'), mutateSource);
    const failed = JSON.parse(await readFile(join(f.config.evidenceDirectory, 'workflow-failed.json'), 'utf8'));
    assert.equal(failed.atoms[0].state, 'failed');
    assert.equal(failed.atoms[0].completionReceipt, undefined);
  }
});

test('unconfirmed or missing adapter termination retains leases and controller ownership after cleanup', async () => {
  for (const missingReceipt of [false, true]) {
    const f = await fixture();
    const runtime = { ...f.runtime,
      stopFlashServer: async server => { server.stopped = !missingReceipt; },
      runModel: async options => {
        if (options.phase === 'plan') return f.reply(options, f.plan);
        if (options.phase === 'plan-review') return f.reply(options, approved);
        if (options.phase === 'write-writer') {
          if (missingReceipt) throw new Error('Adapter rejected without termination proof');
          return f.reply(options, 'Termination unknown', { ok: false, cancellationConfirmed: false });
        }
        return f.reply(options, 'Discovery');
      },
    };
    await assert.rejects(runWorkflow(f.config, runtime), missingReceipt ? /without termination proof/ : /Model execution failed/);
    const failed = JSON.parse(await readFile(join(f.config.evidenceDirectory, 'workflow-failed.json'), 'utf8'));
    assert.equal(failed.atoms[0].state, 'cancelling');
    assert.ok(failed.activeAttempts.writer);
    assert.ok(failed.leases.src);
    assert.ok(await readFile(join(f.config.evidenceDirectory, 'workflow/controller.lock'), 'utf8'));
    assert.equal(failed.events.some(event => event.type === 'atom-stopped'), false);
    const events = (await readFile(join(f.config.evidenceDirectory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(event => event.type === 'cleanup-unconfirmed' && event.scope === 'atom' && event.ownershipRetained));
    if (missingReceipt) assert.ok(events.some(event => event.type === 'cleanup-unconfirmed' && event.scope === 'flash-server'));
  }
});

test('duplicate criteria and atom IDs cannot authorize dispatch or acceptance, and inherited evidence is rejected', async () => {
  const f = await fixture();
  const context = { runId: f.config.arm, root: f.config.root, baseSha: f.config.baseSha, coordinator };
  assert.throws(() => validateDriverPlan(plan([{ ...packet('writer', ['src']), acceptanceIds: ['1', '1', '2', '3', '4', '5', '6', '7'] }]), context), /unique canonical acceptance/);
  assert.throws(() => validateDriverPlan(plan([packet('same', ['src/a']), packet('same', ['src/b'])]), context), /duplicate atom id/);
  const oldDirectory = join(f.base, 'old-qa');
  await mkdir(oldDirectory);
  const oldEvidence = join(oldDirectory, 'observations.json');
  await writeFile(oldEvidence, '{"old":true}');
  const qa = { accepted: true, criteria: ids.map(id => ({ id, passed: true, evidence: [oldEvidence], observation: 'Old observation' })), findings: [] };
  await assert.rejects(validateAcceptance({ ...qa, criteria: qa.criteria.map(item => ({ ...item, id: '1' })) }, oldDirectory), /unique configured criteria/);
  const currentDirectory = join(f.base, 'current-qa');
  await mkdir(currentDirectory);
  await assert.rejects(validateAcceptance(qa, currentDirectory), /escapes dispatch root/);
  await assert.rejects(validateAcceptance(qa, oldDirectory), /visual runtime evidence/);
});

test('an unchanged rejected candidate stops instead of launching an unlimited correction loop', async () => {
  const f = await fixture();
  let writers = 0;
  const runtime = { ...f.runtime, runModel: async options => {
    if (options.phase === 'plan') return f.reply(options, f.plan);
    if (options.phase === 'plan-review') return f.reply(options, approved);
    if (options.phase === 'write-writer') {
      writers += 1;
      await writeFile(join(options.cwd, 'src/main.mjs'), 'export const value = "same-defect";\n');
      return f.reply(options, 'No improvement');
    }
    if (options.phase === 'review-writer') return f.reply(options, rejection);
    return f.reply(options, 'Discovery');
  } };
  await assert.rejects(runWorkflow(f.config, runtime), /repeats the same failed candidate and findings/);
  assert.equal(writers, 2);
  assert.match(await readFile(join(f.config.root, 'src/main.mjs'), 'utf8'), /baseline/);
  assert.equal((await readdir(f.config.workerRoots)).length, 2);
});
