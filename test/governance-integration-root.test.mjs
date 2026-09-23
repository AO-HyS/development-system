import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as current from '../runtime/jev-governance/core.mjs';
import * as legacy from '../artifacts/1.26.1/governance-runtime/core.mjs';
import * as legacyStore from '../artifacts/1.26.1/governance-runtime/store.mjs';
import { readRegistry, readSnapshot, registryPath } from '../runtime/jev-governance/store.mjs';
import { handleHook } from '../runtime/jev-governance/hook.mjs';
import { codexArguments } from '../runtime/jev-governance/codex.mjs';

// Jev answers and host/provider model identities below are synthetic test inputs.
// Git worktrees, PIDs, process exits, filesystem failures and value checks are real.
// These regressions do not certify an installed host or live-provider acceptance.
const exec = promisify(execFile);
const coreUrl = new URL('../runtime/jev-governance/core.mjs', import.meta.url).href;
const executorUrl = new URL('../runtime/jev-governance/executor.mjs', import.meta.url).href;
const cli = fileURLToPath(new URL('../runtime/jev-governance/cli.mjs', import.meta.url));
const env = { TYPESAFE_API_KEY: 'fixture-only-not-a-secret' };
const review = { kind: 'review', verdict: 'pass', findings: [], criterionIds: ['C1'] };
const plan = { kind: 'plan', summary: 'Change the integration value and run its exact assertion.', criterionIds: ['C1'], packets: [{ id: 'P1', readSet: ['spec.md'], writeSet: ['src/value.mjs'], dependsOn: [] }] };
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

async function transport({ body }) {
  const request = JSON.parse(body), answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    const choice = id === 'route' ? request.state.boundary.route.role : id === 'tool' ? 'compliant' : id === 'priority' ? 'execute_now' : 'satisfied';
    answers[id] = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
  }
  return { model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 1 }, answers };
}

function route(role) {
  if (role === 'writer') return { role, provider: 'opencode-go', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'high', capabilities: [] };
  if (role === 'verifier') return { role, provider: 'local', model: 'deterministic-check', reasoning: null, capabilities: ['exact-check'] };
  return { role, provider: 'codex', model: role === 'coordinator' ? 'gpt-5.6-sol' : role === 'researcher' ? 'gpt-5.6-luna' : 'gpt-6-astra', reasoning: ['coordinator', 'researcher'].includes(role) ? 'high' : 'xhigh', capabilities: [] };
}

async function fixture(t, { split = true, api = current, hostCapture = false } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'integration-root-')));
  const home = join(base, 'home'), hostRoot = join(base, 'host');
  const children = new Set();
  const track = child => { children.add(child); child.once('close', () => children.delete(child)); return child; };
  t.after(async () => {
    await Promise.all([...children].map(async child => {
      const done = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGKILL'); await done;
    }));
    await rm(base, { recursive: true, force: true });
  });
  await mkdir(home); await mkdir(join(hostRoot, 'src'), { recursive: true }); await mkdir(join(hostRoot, 'checks'));
  const git = async (args, cwd = hostRoot) => (await exec('git', args, { cwd, env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trimEnd();
  const commit = (cwd, message) => git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message], cwd);
  const files = {
    'spec.md': 'C1: Export value 3 from src/value.mjs. Run checks/value.mjs. Endpoint local accepted.\n',
    'src/value.mjs': 'export const value = 1;\n',
    'src/other.mjs': 'export const other = 1;\n',
    'checks/value.mjs': 'import assert from "node:assert/strict"; import { value } from "../src/value.mjs"; assert.equal(value, 3);\n',
    'staged.txt': 'base staged\n', 'unstaged.txt': 'base unstaged\n', 'deleted.txt': 'keep deletion\n',
  };
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(hostRoot, path), bytes);
  await git(['init', '-q']); await git(['add', '.']); await commit(hostRoot, 'base');
  const baseSha = await git(['rev-parse', 'HEAD']);
  const worktree = async name => {
    const path = join(base, name); await git(['worktree', 'add', '--detach', path, baseSha]); return realpath(path);
  };
  const root = split ? await worktree('integration') : hostRoot;
  if (split) {
    await writeFile(join(hostRoot, 'spec.md'), 'Historical host requirements deliberately differ from integration.\n');
    await writeFile(join(hostRoot, 'src/value.mjs'), 'export const value = 999;\n');
    await git(['add', 'spec.md', 'src/value.mjs']); await commit(hostRoot, 'divergent host');
    await writeFile(join(hostRoot, 'staged.txt'), 'staged edit\n'); await git(['add', 'staged.txt']);
    await writeFile(join(hostRoot, 'staged.txt'), 'staged plus unstaged edit\n');
    await writeFile(join(hostRoot, 'unstaged.txt'), 'unstaged edit\n');
    await unlink(join(hostRoot, 'deleted.txt')); await writeFile(join(hostRoot, 'untracked.txt'), 'untracked bytes\n');
  }
  const provider = join(base, 'fixture-provider');
  await writeFile(provider, '#!/usr/bin/env node\nimport fs from "node:fs"; if(process.env.FIXTURE_WRITE) fs.writeFileSync(process.env.FIXTURE_WRITE,process.env.FIXTURE_CONTENT); process.stdout.write(process.env.FIXTURE_OUTPUT ?? "Observed isolated process.");\n');
  await chmod(provider, 0o700);
  let sequence = 0;
  const session = 'host-session';
  const contract = { id: 'integration-run', root, ...(split ? { hostRoot } : {}), baseSha, endpoint: 'local accepted', authorization: 'Implement and verify this isolated fixture locally.', requiredCapabilities: ['shell', ...(hostCapture ? ['computer-use'] : [])], sources: [{ id: 'spec', path: 'spec.md', kind: 'spec' }], tickets: [{ id: 'T1', dependsOn: [] }], criteria: [{ id: 'C1', ticketId: 'T1', requirement: 'Export value 3 from the integration root', evidenceRequired: 'Independent review and real checks/value.mjs exit zero' }], capacity: { total: 4, providers: { codex: 3, 'opencode-go': 2, local: 1 } } };
  const runDirectory = join(home, '.development-system/governance/runs', contract.id);
  const selectedCli = api === legacy ? fileURLToPath(new URL('../artifacts/1.26.1/governance-runtime/cli.mjs', import.meta.url)) : cli;
  async function observe(id = session, cwd = hostRoot, selected = api) {
    await selected.registerHostSession({ home, event: { kind: 'session', sessionId: id, model: 'gpt-5.6-sol', reasoning: 'high', cwd, transcriptPath: join(base, `${id}-synthetic.jsonl`) } });
    const event = { session_id: id, turn_id: `passive-${++sequence}`, tool_use_id: `passive-${sequence}`, model: 'gpt-5.6-sol', reasoning: 'high', cwd, tool_name: 'Bash', tool_input: { command: 'pwd' } };
    await selected.recordPassiveToolObservation({ home, event: { ...event, hook_event_name: 'PreToolUse' } });
    await selected.recordPassiveToolObservation({ home, event: { ...event, hook_event_name: 'PostToolUse', tool_response: `${cwd}\n` } });
    if (hostCapture) {
      const capture = { ...event, turn_id: `passive-${++sequence}`, tool_use_id: `passive-${sequence}`, tool_name: 'mcp__cua_repl__js', tool_input: { code: 'await cua.getState();' } };
      const syntheticImage = { content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=' }] };
      await selected.recordPassiveToolObservation({ home, event: { ...capture, hook_event_name: 'PreToolUse' } });
      await selected.recordPassiveToolObservation({ home, event: { ...capture, hook_event_name: 'PostToolUse', tool_response: syntheticImage } });
    }
  }
  await observe();
  const begin = () => api.createRun({ home, contract, activation: { sessionId: session } });
  const state = () => api.getRun({ runDirectory });
  async function proposal(action, role = 'coordinator', fields = {}) {
    return { id: `boundary-${++sequence}`, phase: (await state()).phase, action, actorId: session, attemptId: null, objective: `Perform ${action} for C1 and local accepted.`, requirementIds: ['C1'], sourceIds: ['spec'], readSet: ['spec.md', 'src/value.mjs'], writeSet: [], dependsOn: [], route: route(role), toolName: 'governance', toolInput: {}, evidenceRefs: [], observations: ['C1 and the retained local accepted endpoint are covered.'], ...fields };
  }
  const classify = p => api.classifyBoundary({ runDirectory, proposal: p, transport, env });
  async function classified(action, role, fields) {
    const p = await proposal(action, role, fields), result = await classify(p);
    assert.equal(result.verdict, 'pass', `${action}: ${result.reason}`); return p;
  }
  const prepare = p => api.prepareAction({ runDirectory, boundaryId: p.id, action: { actorId: session, attemptId: p.attemptId, toolName: p.toolName, toolInput: p.toolInput } });
  const pre = p => ({ session_id: session, turn_id: `turn-${++sequence}`, tool_use_id: `use-${sequence}`, model: 'gpt-5.6-sol', reasoning: 'high', cwd: hostRoot, hook_event_name: 'PreToolUse', tool_name: p.toolName, tool_input: p.toolInput });
  const authorize = event => api.authorizeAction({ home, preToolEvent: event });
  const post = (event, output = 'Actual isolated tool completion.') => api.recordHostEvent({ home, event: { kind: 'hook', ...event, hook_event_name: 'PostToolUse', tool_response: output } });
  async function permit(p) {
    await prepare(p); const event = pre(p); assert.equal((await authorize(event)).decision, 'allow'); return event;
  }
  async function advance(action, to, dependsOn = []) {
    const p = await classified(action, 'coordinator', { dependsOn });
    if (to) await api.advancePhase({ runDirectory, transition: { to, reason: 'Current isolated role return.', boundaryId: p.id } });
    return p;
  }
  async function dispatch(action, role, fields = {}) {
    const { candidateRoot = root, writeSet = [], readSet = ['spec.md', 'src/value.mjs'], dependsOn = [], consume = true } = fields;
    const attemptId = `process-${++sequence}`;
    const launch = { attemptId, candidateRoot, ...(role === 'verifier' ? { check: { executable: process.execPath, argv: ['checks/value.mjs'] } } : {}) };
    const p = await classified(action, role, { attemptId, readSet: role === 'verifier' ? [...readSet, 'checks/value.mjs'] : readSet, writeSet, dependsOn, toolName: 'Bash', toolInput: { command: `node ${quote(selectedCli)} execute --home ${quote(home)} --input-json ${quote(JSON.stringify(launch))}` } });
    await prepare(p); const event = pre(p);
    if (consume) assert.equal((await authorize(event)).decision, 'allow');
    const command = launch.check ?? { executable: provider, argv: role === 'writer'
      ? ['run', '--model', p.route.model, '--variant', p.route.reasoning, '--pure']
      : ['exec', '--model', p.route.model, '--sandbox', 'read-only', '-c', `model_reasoning_effort="${p.route.reasoning}"`] };
    return { id: attemptId, p, event, candidateRoot, launch, command };
  }
  const bind = packet => api.bindProcessCandidate({ runDirectory, attemptId: packet.id, candidateRoot: packet.candidateRoot, command: packet.command });
  async function start(packet, output = 'Observed isolated process.', { write, content, bound = false } = {}) {
    if (!bound) await bind(packet);
    const child = track(spawn(packet.command.executable, packet.command.argv, { cwd: packet.candidateRoot, env: { PATH: process.env.PATH, HOME: home, FIXTURE_OUTPUT: typeof output === 'string' ? output : JSON.stringify(output), ...(write ? { FIXTURE_WRITE: join(packet.candidateRoot, write), FIXTURE_CONTENT: content } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] }));
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr })); });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const common = { attemptId: packet.id, processId: String(child.pid), candidateRoot: packet.candidateRoot, command: packet.command };
    assert.equal((await api.recordHostEvent({ home, event: { kind: 'process-start', ...common, provider: 'unknown', model: 'unknown', reasoning: 'unknown' } })).status, 'identity-pending');
    return { common, done, write };
  }
  async function finish(packet, running, { expectedOk = true, expectedExit = 0, beforeReturn } = {}) {
    const actual = await running.done; assert.equal(actual.code, expectedExit, actual.stderr);
    if (beforeReturn) await beforeReturn();
    const event = { ...running.common, kind: 'process-exit', provider: packet.p.route.provider, model: packet.p.route.model, reasoning: packet.p.route.reasoning, processSessionId: `fresh-session-${packet.id}`, exitCode: actual.code, terminated: true, output: actual.stdout, changedPaths: running.write ? [running.write] : [] };
    const result = await api.recordHostEvent({ home, event });
    assert.equal(result.ok, expectedOk, result.reason); await post(packet.event);
    return { result, event };
  }
  async function processOutput(action, role, output, options = {}) {
    const packet = await dispatch(action, role, options); await finish(packet, await start(packet, output, options)); return packet;
  }
  async function implementation() {
    await advance('intake-review', 'research');
    const researcher = await processOutput('research-dispatch', 'researcher', 'C1 is implemented by src/value.mjs in the integration worktree.');
    await advance('research-return', 'plan', [researcher.id]);
    const planner = await processOutput('plan-author', 'planner', plan);
    await advance('plan-return', 'plan-review', [planner.id]);
    const reviewer = await processOutput('plan-review', 'plan-reviewer', review);
    await advance('plan-review-return', 'implementation', [reviewer.id]);
    return { researcher, planner, reviewer };
  }
  async function hostSnapshot() {
    return { head: await git(['rev-parse', 'HEAD']), status: await git(['status', '--porcelain=v1', '-z']), index: (await readFile(join(hostRoot, '.git/index'))).toString('base64'), staged: await git(['diff', '--cached', '--binary']), unstaged: await git(['diff', '--binary']), untracked: split ? await readFile(join(hostRoot, 'untracked.txt'), 'utf8') : null };
  }
  return { base, home, hostRoot, root, baseSha, contract, session, runDirectory, api, git, commit, worktree, observe, begin, state, proposal, classify, classified, prepare, pre, authorize, post, permit, advance, dispatch, bind, start, finish, processOutput, implementation, hostSnapshot, track };
}

function patch(path, move) {
  return `*** Begin Patch\n*** Update File: ${path}\n${move ? `*** Move to: ${move}\n` : ''}@@\n-export const value = 1;\n+export const value = 3;\n*** End Patch`;
}

async function patchProposal(f, patchText, writeSet = ['src/value.mjs'], fields = {}) {
  return f.proposal('correct', 'coordinator', { attemptId: `patch-${(await f.state()).boundaries.length}`, readSet: ['spec.md'], writeSet, toolName: 'apply_patch', toolInput: { patch: patchText }, ...fields });
}

async function deniedBeforeInvocation(f, p) {
  const judgment = await f.classify(p);
  if (judgment.verdict !== 'pass') {
    assert.equal(judgment.transportAttempted, false, 'Path and root rejections must be deterministic.');
    assert.match(judgment.code, /^(scope|tool|candidate|binding|base|invalid)$/u, judgment.reason);
    if (judgment.code === 'invalid') assert.match(judgment.reason, /root|workspace|path|worktree|patch|absolute|symlink|protected/i);
    return;
  }
  try { await f.prepare(p); }
  catch (error) { assert.match(error.message, /root|path|scope|symlink|worktree|patch|absolute|protected|reserved|ownership/i); return; }
  const result = await f.authorize(f.pre(p));
  assert.equal(result.decision, 'deny');
  assert.equal((await f.state()).attempts.some(attempt => attempt.id === p.attemptId), false);
}

test('split-root lifecycle accepts actual integration content and preserves every dirty divergent host layer', { timeout: 60000 }, async t => {
  const f = await fixture(t), before = await f.hostSnapshot();
  assert.notEqual(before.head, f.baseSha); assert.match(before.status, /MM staged\.txt/); assert.match(before.status, /\?\? untracked\.txt/); assert.match(before.status, / D deleted\.txt/);
  const created = await f.begin(); assert.equal(created.schemaVersion, 2); assert.equal(created.hostRoot, f.hostRoot); assert.equal(created.root, f.root);
  assert.equal((await readSnapshot(join(f.runDirectory, 'run.json'))).schemaVersion, 2);
  assert.equal((await readRegistry(f.home)).schemaVersion, 2);
  const roles = await f.implementation();
  const writer = await f.processOutput('writer-dispatch', 'writer', 'Changed only src/value.mjs.', { candidateRoot: await f.worktree('writer'), readSet: ['spec.md'], writeSet: ['src/value.mjs'], write: 'src/value.mjs', content: 'export const value = 3;\n' });
  await f.advance('writer-return', 'integration', [writer.id]);
  const p = await patchProposal(f, patch(join(f.root, 'src/value.mjs')), ['src/value.mjs'], { action: 'integrate', dependsOn: [writer.id] });
  assert.equal((await f.classify(p)).verdict, 'pass'); const event = await f.permit(p);
  await writeFile(join(f.root, 'src/value.mjs'), await readFile(join(writer.candidateRoot, 'src/value.mjs')));
  assert.equal((await f.post(event)).status, 'completed');
  await f.advance('integration-return', 'final-review', [p.attemptId]);
  const final = await f.processOutput('final-review', 'reviewer', review);
  await f.advance('final-review-return', 'evidence', [final.id]);
  const verification = await f.processOutput('verify', 'verifier', 'Actual assertion exit controls verification.');
  await f.advance('verify-return', undefined, [verification.id]);
  const closure = await f.classified('close', 'coordinator', { dependsOn: [final.id, verification.id] });
  const closed = await current.closeRun({ runDirectory: f.runDirectory, outcome: { status: 'accepted', reason: 'Independent review and actual integration check passed.', boundaryId: closure.id } });
  assert.equal(closed.outcome.status, 'accepted'); assert.equal(closed.tickets[0].status, 'accepted');
  const attempt = id => closed.attempts.find(value => value.id === id);
  assert.notEqual(attempt(roles.planner.id).sessionId, attempt(roles.reviewer.id).sessionId);
  for (const packet of [roles.researcher, roles.planner, roles.reviewer, final, verification]) assert.equal(attempt(packet.id).process.candidateRoot, f.root);
  assert.equal(attempt(writer.id).process.candidateRoot, writer.candidateRoot);
  assert.equal(attempt(verification.id).process.exitCode, 0); assert.equal(closed.evidence.at(-1).outcome, 'pass');
  assert.equal(await readFile(join(f.root, 'src/value.mjs'), 'utf8'), 'export const value = 3;\n');
  assert.deepEqual(await f.hostSnapshot(), before);
  t.diagnostic('Synthetic Jev and provider identities; real Git, host preservation, process execution and assertion evidence only.');
});

test('activation rejects foreign, copied, symlinked, nested, unregistered and replaced roots', { timeout: 60000 }, async t => {
  for (const kind of ['foreign-clone', 'copied', 'symlink-integration', 'symlink-host', 'nested', 'unregistered', 'replaced-integration', 'replaced-host']) await t.test(kind, async child => {
    const f = await fixture(child); let contract = { ...f.contract };
    if (kind === 'foreign-clone') { const foreign = join(f.base, 'foreign'); await f.git(['clone', '-q', f.root, foreign]); contract.root = foreign; }
    if (kind === 'copied') { const copied = join(f.base, 'copied'); await cp(f.root, copied, { recursive: true }); contract.root = copied; }
    if (kind === 'symlink-integration') { const alias = join(f.base, 'alias'); await symlink(f.root, alias); contract.root = alias; }
    if (kind === 'symlink-host') { const alias = join(f.base, 'alias'); await symlink(f.hostRoot, alias); contract.hostRoot = alias; }
    if (kind === 'nested') { contract.root = join(f.hostRoot, 'nested'); await f.git(['worktree', 'add', '--detach', contract.root, f.baseSha]); }
    if (kind === 'unregistered') { const metadata = (await readFile(join(f.root, '.git'), 'utf8')).trim().slice(8); await rename(metadata, `${metadata}-retained`); }
    if (kind.startsWith('replaced-')) {
      await f.begin(); const target = kind.endsWith('host') ? f.hostRoot : f.root;
      await rename(target, `${target}-retained`); await cp(`${target}-retained`, target, { recursive: true });
      const p = await f.proposal('inspect', 'coordinator', { toolName: 'Bash', toolInput: { command: 'pwd', cwd: f.root } });
      await deniedBeforeInvocation(f, p); return;
    }
    await assert.rejects(current.createRun({ home: f.home, contract, activation: { sessionId: f.session } }), /root|worktree|Git|registered|canonical|symlink|same repository/i);
    assert.equal(await current.resolveRunDirectory(f.home, f.session), null);
  });
});

test('inspection requires explicit integration cwd and exact one-use host attribution', async t => {
  const f = await fixture(t); await f.begin();
  for (const toolInput of [{ command: 'pwd' }, { command: 'pwd', cwd: f.hostRoot }]) {
    await deniedBeforeInvocation(f, await f.proposal('inspect', 'coordinator', { toolName: 'Bash', toolInput }));
  }
  const p = await f.classified('inspect', 'coordinator', { toolName: 'Bash', toolInput: { command: 'cat src/value.mjs', cwd: f.root } });
  await f.prepare(p); const event = f.pre(p);
  assert.equal((await f.authorize({ ...event, cwd: f.root })).decision, 'deny', 'Tool workdir cannot replace the observed host identity.');
  assert.equal((await f.authorize(event)).decision, 'allow');
  const actual = await exec('cat', ['src/value.mjs'], { cwd: f.root, env: { PATH: process.env.PATH, HOME: f.home } });
  assert.equal(actual.stdout, 'export const value = 1;\n'); await f.post(event, actual.stdout);
  assert.equal((await f.authorize(event)).decision, 'deny', 'Consumed invocation cannot replay.');
  await assert.rejects(f.post({ ...event, tool_use_id: 'wrong-use' }, actual.stdout), /exact consumed/);
});

test('absolute patch checks both move endpoints and rejects host, relative, protected and symlink paths', async t => {
  const f = await fixture(t), before = await f.hostSnapshot(); await f.begin(); await f.advance('intake-review', 'research');
  const value = join(f.root, 'src/value.mjs'), moved = join(f.root, 'src/moved.mjs');
  await symlink(f.hostRoot, join(f.root, 'host-link'));
  const cases = [
    ['relative update', patch('src/value.mjs'), ['src/value.mjs']],
    ['host update', patch(join(f.hostRoot, 'src/value.mjs')), ['src/value.mjs']],
    ['relative move target', patch(value, 'src/moved.mjs'), ['src/value.mjs', 'src/moved.mjs']],
    ['host move target', patch(value, join(f.hostRoot, 'src/moved.mjs')), ['src/value.mjs', 'src/moved.mjs']],
    ['host move source', patch(join(f.hostRoot, 'src/value.mjs'), moved), ['src/value.mjs', 'src/moved.mjs']],
    ['undeclared move target', patch(value, moved), ['src/value.mjs']],
    ['protected runtime', patch(join(f.root, 'runtime/jev-governance/core.mjs')), ['runtime/jev-governance/core.mjs']],
    ['protected receipts', patch(join(f.root, '.development-system/state.json')), ['.development-system/state.json']],
    ['symlink ancestor', patch(join(f.root, 'host-link/src/value.mjs')), ['host-link/src/value.mjs']],
  ];
  for (const [name, text, scope] of cases) {
    await t.test(name, async () => {
      const proposal = await patchProposal(f, text, scope);
      if (name.startsWith('protected')) {
        await assert.rejects(f.classify(proposal), error => error.code === 'invalid' && error.message.includes(`targets a managed path: ${scope[0]}`));
      } else await deniedBeforeInvocation(f, proposal);
    });
  }
  const valid = await patchProposal(f, patch(value, moved), ['src/value.mjs', 'src/moved.mjs']);
  assert.equal((await f.classify(valid)).verdict, 'pass'); const event = await f.permit(valid);
  await rename(value, moved); await writeFile(moved, 'export const value = 3;\n');
  assert.equal((await f.post(event)).status, 'completed');
  assert.deepEqual((await f.state()).attempts.at(-1).changedPaths, ['src/moved.mjs', 'src/value.mjs']);
  assert.deepEqual(await f.hostSnapshot(), before);
});

test('synthetic transcript-backed hook ingress preserves the host identity for integration inspect and patch', async t => {
  const f = await fixture(t), before = await f.hostSnapshot(); await f.begin();
  const transcript = join(f.base, `${f.session}-synthetic.jsonl`);
  async function hookEvent(proposal) {
    const { reasoning, ...event } = f.pre(proposal);
    await writeFile(transcript, [
      { type: 'session_meta', payload: { id: f.session } },
      { type: 'turn_context', payload: { turn_id: event.turn_id, model: event.model, cwd: f.hostRoot, effort: reasoning } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    return { ...event, transcript_path: transcript };
  }
  const inspect = await f.classified('inspect', 'coordinator', { toolName: 'Bash', toolInput: { command: 'cat src/value.mjs', cwd: f.root } });
  await f.prepare(inspect); const readEvent = await hookEvent(inspect);
  assert.equal((await handleHook({ ...readEvent, cwd: f.root }, { home: f.home })).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(await handleHook(readEvent, { home: f.home }), {});
  const actual = await exec('cat', ['src/value.mjs'], { cwd: f.root, env: { PATH: process.env.PATH, HOME: f.home } });
  assert.equal(actual.stdout, 'export const value = 1;\n');
  assert.deepEqual(await handleHook({ ...readEvent, hook_event_name: 'PostToolUse', tool_response: actual.stdout }, { home: f.home }), {});
  const observedRead = (await f.state()).attempts.find(attempt => attempt.boundaryId === inspect.id);
  assert.equal(observedRead.status, 'completed'); assert.equal(observedRead.invocation.cwd, f.hostRoot); assert.equal(observedRead.invocationObserved, true);
  await f.advance('intake-review', 'research');
  const update = await patchProposal(f, patch(join(f.root, 'src/value.mjs')));
  assert.equal((await f.classify(update)).verdict, 'pass'); await f.prepare(update);
  const patchEvent = await hookEvent(update);
  assert.deepEqual(await handleHook(patchEvent, { home: f.home }), {});
  await writeFile(join(f.root, 'src/value.mjs'), 'export const value = 3;\n');
  assert.deepEqual(await handleHook({ ...patchEvent, hook_event_name: 'PostToolUse', tool_response: 'Fixture patch applied.' }, { home: f.home }), {});
  const observedPatch = (await f.state()).attempts.find(attempt => attempt.id === update.attemptId);
  assert.equal(observedPatch.status, 'completed'); assert.equal(observedPatch.invocationObserved, true); assert.deepEqual(observedPatch.changedPaths, ['src/value.mjs']);
  assert.equal((await handleHook(patchEvent, { home: f.home })).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(await f.hostSnapshot(), before);
  t.diagnostic('Synthetic transcript identity exercises the actual hook adapter; this does not certify a live installed host.');
});

async function drift(f, kind, candidateRoot = f.root) {
  if (kind === 'source') await writeFile(join(f.root, 'spec.md'), 'Changed authorized source after permission.\n');
  if (kind === 'head') await f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'head drift'], candidateRoot);
  if (kind === 'git-identity') {
    const gitFile = join(candidateRoot, '.git'), bytes = await readFile(gitFile);
    await rename(gitFile, `${gitFile}-retained`); await writeFile(gitFile, bytes);
  }
}

test('source, HEAD and Git identity drift invalidate consumption and pre-spawn binding', { timeout: 60000 }, async t => {
  for (const phase of ['consume', 'bind']) for (const kind of ['source', 'head', 'git-identity']) await t.test(`${phase}: ${kind}`, async child => {
    const f = await fixture(child); await f.begin(); await f.advance('intake-review', 'research');
    const packet = await f.dispatch('research-dispatch', 'researcher', { consume: phase !== 'consume' });
    await drift(f, kind);
    if (phase === 'consume') {
      assert.equal((await f.authorize(packet.event)).decision, 'deny');
      assert.equal((await f.state()).attempts.length, 0);
    } else {
      await assert.rejects(f.bind(packet), /changed|revision|HEAD|identity|source|judgment|worktree/i);
      assert.equal((await f.state()).attempts[0].processBinding ?? null, null);
      assert.equal((await f.state()).attempts[0].process ?? null, null);
    }
  });
});

test('authentic process termination survives return drift without producing acceptance', { timeout: 60000 }, async t => {
  for (const kind of ['source', 'head', 'git-identity']) await t.test(kind, async child => {
    const f = await fixture(child); await f.begin(); await f.advance('intake-review', 'research');
    const research = await f.processOutput('research-dispatch', 'researcher', 'Inspect integration value.');
    await f.advance('research-return', 'plan', [research.id]);
    const packet = await f.dispatch('plan-author', 'planner');
    await f.finish(packet, await f.start(packet, plan), { expectedOk: false, beforeReturn: () => drift(f, kind) });
    const state = await f.state(), attempt = state.attempts.find(value => value.id === packet.id);
    assert.equal(attempt.process.terminated, true); assert.equal(attempt.process.exitCode, 0); assert.equal(attempt.status, 'failed');
    assert.equal(state.plans.length, 0); assert.equal(state.reviews.length, 0); assert.equal(state.evidence.length, 0);
    await assert.rejects(current.closeRun({ runDirectory: f.runDirectory, outcome: { status: 'accepted', reason: 'Drift cannot be accepted.', boundaryId: packet.p.id } }));
  });
});

test('writers require a third registered worktree and retain its reservation until actual termination', { timeout: 60000 }, async t => {
  const f = await fixture(t); await f.begin(); await f.implementation();
  for (const candidateRoot of [f.root, f.hostRoot]) {
    const id = `invalid-writer-${(await f.state()).boundaries.length}`;
    const p = await f.proposal('writer-dispatch', 'writer', { attemptId: id, readSet: ['spec.md'], writeSet: ['src/value.mjs'], toolName: 'Bash', toolInput: { command: `node ${quote(cli)} execute --home ${quote(f.home)} --input-json ${quote(JSON.stringify({ attemptId: id, candidateRoot }))}` } });
    await deniedBeforeInvocation(f, p);
  }
  const writerRoot = await f.worktree('writer');
  const writer = await f.dispatch('writer-dispatch', 'writer', { candidateRoot: writerRoot, readSet: ['spec.md'], writeSet: ['src/value.mjs'] });
  const sameRoot = await f.proposal('writer-dispatch', 'writer', { attemptId: 'same-root-disjoint', readSet: ['spec.md'], writeSet: ['src/other.mjs'], toolName: 'Bash', toolInput: { command: `node ${quote(cli)} execute --home ${quote(f.home)} --input-json ${quote(JSON.stringify({ attemptId: 'same-root-disjoint', candidateRoot: writerRoot }))}` } });
  await deniedBeforeInvocation(f, sameRoot);
  const rivalIntegration = await f.worktree('rival-integration');
  await f.observe('rival', writerRoot);
  const rival = { ...f.contract, id: 'rival', hostRoot: writerRoot, root: rivalIntegration };
  await assert.rejects(current.createRun({ home: f.home, contract: rival, activation: { sessionId: 'rival' } }), /reserved|ownership|unfinished/i);
  await f.observe('rival-integration-owner', rivalIntegration);
  await assert.rejects(current.createRun({ home: f.home, contract: { ...rival, id: 'rival-integration-owner', hostRoot: rivalIntegration, root: writerRoot }, activation: { sessionId: 'rival-integration-owner' } }), /reserved|ownership|unfinished/i);
  const running = await f.start(writer);
  await current.recordHostEvent({ home: f.home, event: { kind: 'interruption', attemptId: writer.id, reason: 'Fixture interrupted after process start.' } });
  await current.closeRun({ runDirectory: f.runDirectory, outcome: { status: 'blocked', reason: 'Actual process exit remains required.', boundaryId: writer.p.id } });
  await assert.rejects(current.createRun({ home: f.home, contract: rival, activation: { sessionId: 'rival' } }), /reserved|ownership|unfinished/i);
  await f.finish(writer, running, { expectedOk: false });
  const state = await f.state(); assert.equal(state.attempts.at(-1).process.terminated, true); assert.equal(state.evidence.length, 0);
});

test('independent concurrent createRun processes cannot reserve the same integration root', { timeout: 20000 }, async t => {
  const f = await fixture(t), secondHost = await f.worktree('second-host'); await f.observe('second-host', secondHost);
  const program = `const { createRun } = await import(${JSON.stringify(coreUrl)}); process.stdout.write('READY\\n'); for await (const chunk of process.stdin) break; try { const run = await createRun(JSON.parse(process.argv[1])); process.stdout.write(JSON.stringify({ ok: true, id: run.runId })); } catch(error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code, reason: error.message })); }`;
  const contenders = ['first', 'second'].map((id, index) => {
    const input = { home: f.home, contract: { ...f.contract, id, hostRoot: index ? secondHost : f.hostRoot }, activation: { sessionId: index ? 'second-host' : f.session } };
    const child = f.track(spawn(process.execPath, ['--input-type=module', '-e', program, JSON.stringify(input)], { env: { ...process.env, HOME: f.home }, stdio: ['pipe', 'pipe', 'pipe'] }));
    let stdout = '', stderr = ''; let readyResolve;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; child.once('error', reject); child.once('close', () => { if (!stdout.startsWith('READY\n')) reject(new Error(`Contender exited before readiness: ${stderr}`)); }); });
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.startsWith('READY\n')) readyResolve(); });
    child.stderr.on('data', bytes => { stderr += bytes; });
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => {
      if (code !== 0) { reject(new Error(`Contender exited ${code}: ${stderr}`)); return; }
      try { resolve(JSON.parse(stdout.slice('READY\n'.length))); } catch (error) { reject(error); }
    }); });
    return { child, ready, done };
  });
  await Promise.all(contenders.map(value => value.ready));
  for (const value of contenders) value.child.stdin.end('GO\n');
  const results = await Promise.all(contenders.map(value => value.done));
  assert.equal(results.filter(value => value.ok).length, 1, JSON.stringify(results));
  assert.match(results.find(value => !value.ok).reason, /reserved|unfinished|ownership/i);
  assert.equal(Object.keys((await readRegistry(f.home)).runs).length, 1);
  const winningHost = results.find(value => value.ok).id === 'first' ? f.hostRoot : secondHost;
  await f.observe('host-collision', winningHost);
  await assert.rejects(current.createRun({ home: f.home, contract: { ...f.contract, id: 'host-collision', hostRoot: winningHost, root: await f.worktree('third-integration') }, activation: { sessionId: 'host-collision' } }), /reserved|unfinished|ownership/i);
});

test('registry persistence failure after run creation retains orphan ownership and blocks a second reservation', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const input = { home: f.home, contract: f.contract, activation: { sessionId: f.session } };
  const target = registryPath(f.home);
  const program = `import fs from 'node:fs/promises'; import { syncBuiltinESMExports } from 'node:module'; const rename = fs.rename; let reached = false; fs.rename = async (...args) => { if (args[1] === ${JSON.stringify(target)}) { reached = true; throw Object.assign(new Error('Injected registry publication failure'), { code: 'EIO' }); } return rename(...args); }; syncBuiltinESMExports(); const { createRun } = await import(${JSON.stringify(coreUrl)}); try { await createRun(${JSON.stringify(input)}); process.exitCode = 2; } catch(error) { process.stdout.write(JSON.stringify({ reached, code: error.code })); }`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env, HOME: f.home }, timeout: 15000 });
  assert.equal(JSON.parse(result.stdout).reached, true, 'Injection must hit the actual registry rename.');
  assert.equal((await current.getRun({ runDirectory: f.runDirectory })).root, f.root);
  assert.equal(Object.keys((await readRegistry(f.home)).runs).length, 0);
  await assert.rejects(current.createRun({ home: f.home, contract: { ...f.contract, id: 'after-failed-persistence' }, activation: { sessionId: f.session } }), /orphan|ownership|reconcil/i);
  assert.equal((await current.getRun({ runDirectory: f.runDirectory })).root, f.root);
});

test('unstarted recovery requires the original host and cannot turn replay into execution authority', async t => {
  const f = await fixture(t); await f.begin();
  await f.observe('wrong-root-operator', f.root);
  await assert.rejects(current.recoverUnstartedRun({ home: f.home, runId: f.contract.id, sessionId: 'wrong-root-operator', reason: 'Wrong-root recovery must fail.' }), /host|same root|activation|observed/i);
  const p = await f.classified('inspect', 'coordinator', { toolName: 'Bash', toolInput: { command: 'pwd', cwd: f.root } });
  await f.prepare(p); const event = f.pre(p);
  await f.observe('correct-host-operator', f.hostRoot);
  const recovered = await current.recoverUnstartedRun({ home: f.home, runId: f.contract.id, sessionId: 'correct-host-operator', reason: 'Recover only this unstarted isolated run.' });
  assert.equal(recovered.outcome.status, 'blocked'); assert.equal(recovered.rootSessionId, f.session); assert.equal(recovered.root, f.root); assert.equal(recovered.hostRoot, f.hostRoot);
  const replay = await f.authorize(event);
  assert.equal(replay.permitId, null, 'A released session cannot replay the old governed permit.');
  assert.equal((await f.state()).attempts.length, 0); assert.equal((await f.state()).evidence.length, 0);
});

test('administrative recovery after HEAD drift preserves old authority and permits a fresh run at the new revision', { timeout: 20000 }, async t => {
  for (const kind of ['unstarted', 'host-attempt']) await t.test(kind, async child => {
    const f = await fixture(child, { hostCapture: kind === 'host-attempt' }); await f.begin();
    let attemptId;
    if (kind === 'host-attempt') {
      const capture = await f.classified('host-tool', 'coordinator', { toolName: 'mcp__cua_repl__js', toolInput: { code: 'await cua.getState(); /* synthetic failed capture */' } });
      const event = await f.permit(capture);
      assert.equal((await f.post(event, { content: [{ type: 'image', mimeType: 'image/png', data: 'bm90LWFuLWltYWdl' }] })).status, 'recovery-required');
      attemptId = (await f.state()).attempts.at(-1).id;
      await current.closeRun({ runDirectory: f.runDirectory, outcome: { status: 'blocked', reason: 'Retain the failed capture for administrative cleanup.', boundaryId: capture.id } });
    } else await f.classified('intake-review', 'coordinator');
    const prior = await f.state(); await drift(f, 'head');
    const head = await f.git(['rev-parse', 'HEAD'], f.root); assert.notEqual(head, f.baseSha);
    await f.observe('wrong-recovery-root', f.root);
    const recover = kind === 'unstarted' ? current.recoverUnstartedRun : current.recoverHostAttempt;
    const input = { home: f.home, runId: f.contract.id, reason: 'Administrative recovery after HEAD drift; no old acceptance.', ...(attemptId ? { attemptId } : {}) };
    await assert.rejects(recover({ ...input, sessionId: 'wrong-recovery-root' }), /root|host|observed/i);
    await f.observe('recovery-operator', f.hostRoot);
    const recovered = await recover({ ...input, sessionId: 'recovery-operator' });
    assert.equal(recovered.outcome?.status ?? (await f.state()).outcome.status, 'blocked');
    const retained = await f.state();
    assert.equal(retained.baseSha, f.baseSha); assert.deepEqual(retained.rootIdentity, prior.rootIdentity);
    assert.deepEqual(retained.boundaries, prior.boundaries); assert.deepEqual(retained.judgments, prior.judgments);
    assert.equal(retained.evidence.length, 0); assert.equal(retained.reviews.length, 0);
    const successor = await current.createRun({ home: f.home, contract: { ...f.contract, id: 'successor', baseSha: head }, activation: { sessionId: 'recovery-operator' } });
    assert.equal(successor.baseSha, head); assert.equal(successor.phase, 'intake'); assert.equal(successor.attempts.length, 0); assert.equal(successor.outcome, null);
  });
});

test('administrative recovery still rejects replaced or unregistered trees after HEAD drift', async t => {
  for (const kind of ['replaced', 'unregistered']) await t.test(kind, async child => {
    const f = await fixture(child); await f.begin(); await drift(f, 'head'); await f.observe('operator', f.hostRoot);
    if (kind === 'replaced') await drift(f, 'git-identity');
    else { const metadata = (await readFile(join(f.root, '.git'), 'utf8')).trim().slice(8); await rename(metadata, `${metadata}-retained`); }
    const before = await readFile(join(f.runDirectory, 'run.json'));
    await assert.rejects(current.recoverUnstartedRun({ home: f.home, runId: f.contract.id, sessionId: 'operator', reason: 'Changed worktree identity must remain blocked.' }), /identity|worktree|root|registered/i);
    assert.deepEqual(await readFile(join(f.runDirectory, 'run.json')), before);
  });
});

test('executor persists a real killed PID when integration HEAD changes at process-start', { timeout: 20000 }, async t => {
  const f = await fixture(t); await f.begin(); await f.advance('intake-review', 'research');
  const packet = await f.dispatch('research-dispatch', 'researcher');
  const bin = join(f.base, 'bin'), provider = join(bin, 'codex'); await mkdir(bin);
  await writeFile(provider, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n'); await chmod(provider, 0o700);
  // Fault-inject only the delivery timing of this real child's spawn event.
  // The public executor binds first; a real Git commit then invalidates HEAD
  // before its start callback. The OS PID, process-group kill and exit are real.
  const program = `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module'; const original = cp.spawn; let injected = false;
    cp.spawn = (...args) => { const child = original(...args); if (args[0] === ${JSON.stringify(provider)}) { const emit = child.emit; child.emit = function(event, ...values) { if (event === 'spawn') { cp.execFileSync('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','post-bind HEAD drift'], { cwd: ${JSON.stringify(f.root)}, env: process.env }); injected = true; } return emit.call(this, event, ...values); }; } return child; };
    syncBuiltinESMExports(); const { launchGovernedProcess } = await import(${JSON.stringify(executorUrl)});
    try { const result = await launchGovernedProcess(${JSON.stringify({ home: f.home, runDirectory: f.runDirectory, sessionId: f.session, launch: packet.launch })}); process.stdout.write(JSON.stringify({ injected, result })); } catch (error) { process.stdout.write(JSON.stringify({ injected, error: error.message })); }`;
  const child = await exec(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env, HOME: f.home, PATH: `${bin}:${process.env.PATH}` }, timeout: 15000 });
  const result = JSON.parse(child.stdout); assert.equal(result.injected, true, child.stdout); assert.equal(result.error, undefined, child.stdout); assert.equal(result.result.ok, false);
  assert.equal(result.result.exitCode, null); assert.equal(result.result.exitSignal, 'SIGTERM'); assert.equal(result.result.registrationFailed, true);
  const state = await f.state(), attempt = state.attempts.find(value => value.id === packet.id);
  assert.equal(attempt.process.terminated, true); assert.equal(attempt.status, 'failed');
  assert.equal(attempt.process.exitCode, null); assert.equal(attempt.process.exitSignal, 'SIGTERM'); assert.equal(attempt.process.reconciliationFailed, true);
  assert.throws(() => process.kill(Number(attempt.process.processId), 0), { code: 'ESRCH' });
  assert.equal(state.plans.length, 0); assert.equal(state.reviews.length, 0); assert.equal(state.evidence.length, 0);
  await f.post(packet.event);
  assert.equal((await f.state()).attempts.at(-1).status, 'failed');
});

test('public executor preserves a real exit zero separately from post-exit reconciliation failure', { timeout: 30000 }, async t => {
  const f = await fixture(t); f.contract.taskKind = 'audit';
  await writeFile(join(f.root, 'src/value.mjs'), 'export const value = 3;\n'); await f.begin();
  await f.advance('intake-review', 'research');
  const research = await f.processOutput('research-dispatch', 'researcher', 'Check the current integration value with the approved assertion.');
  await f.advance('research-return', 'plan', [research.id]);
  const authored = await f.processOutput('plan-author', 'planner', { ...plan, packets: [{ id: 'P1', readSet: ['src/value.mjs'], writeSet: [], dependsOn: [] }] });
  await f.advance('plan-return', 'plan-review', [authored.id]);
  const reviewed = await f.processOutput('plan-review', 'plan-reviewer', review);
  await f.advance('plan-review-return', 'final-review', [reviewed.id]);
  const final = await f.processOutput('final-review', 'reviewer', review);
  await f.advance('final-review-return', 'evidence', [final.id]);
  const packet = await f.dispatch('verify', 'verifier');
  // Delay only this real child's close delivery until its successful start is
  // durably observed. Then commit HEAD after the OS exit but before the public
  // executor reconciles it. No process result or receipt is synthesized.
  const program = `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module'; const original = cp.spawn; let injected = false, observedExit = null;
    const { getRun } = await import(${JSON.stringify(coreUrl)});
    cp.spawn = (...args) => { const child = original(...args); if (args[0] === ${JSON.stringify(process.execPath)} && args[1][0] === 'checks/value.mjs') { const emit = child.emit; child.emit = function(event, ...values) { if (event !== 'close') return emit.call(this, event, ...values);
      const deliver = async () => { observedExit = { code: values[0], signal: values[1] }; let registered = false;
        for (let index = 0; index < 300; index++) { const run = await getRun({ runDirectory: ${JSON.stringify(f.runDirectory)} }); const attempt = run.attempts.find(value => value.id === ${JSON.stringify(packet.id)}); if (attempt?.process?.processId === String(child.pid) && attempt.status === 'running') { registered = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
        if (!registered) throw new Error('Real process start was not durably observed before close injection');
        cp.execFileSync('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','post-exit HEAD drift'], { cwd: ${JSON.stringify(f.root)}, env: process.env }); injected = true; emit.call(child, event, ...values); };
      deliver().catch(error => { process.stderr.write(error.message); process.exitCode = 1; emit.call(child, event, ...values); }); return true; }; } return child; };
    syncBuiltinESMExports(); const { launchGovernedProcess } = await import(${JSON.stringify(executorUrl)});
    try { const result = await launchGovernedProcess(${JSON.stringify({ home: f.home, runDirectory: f.runDirectory, sessionId: f.session, launch: packet.launch })}); process.stdout.write(JSON.stringify({ injected, observedExit, result })); } catch (error) { process.stdout.write(JSON.stringify({ injected, observedExit, error: error.message })); }`;
  const child = await exec(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env, HOME: f.home }, timeout: 15000 });
  const result = JSON.parse(child.stdout); assert.equal(result.injected, true, child.stdout); assert.equal(result.error, undefined, child.stdout);
  assert.deepEqual(result.observedExit, { code: 0, signal: null });
  assert.equal(result.result.exitCode, 0); assert.equal(result.result.exitSignal, null); assert.equal(result.result.reconciliationFailed, true);
  assert.equal(result.result.cancelled, false); assert.equal(result.result.identityObserved, true); assert.equal(result.result.ok, false);
  const state = await f.state(), attempt = state.attempts.find(value => value.id === packet.id);
  assert.equal(attempt.process.exitCode, 0); assert.equal(attempt.process.exitSignal, null); assert.equal(attempt.process.reconciliationFailed, true);
  assert.equal(attempt.process.terminated, true); assert.equal(attempt.status, 'failed'); assert.equal(state.evidence.length, 0); assert.equal(state.verifications.length, 0);
  await f.post(packet.event); assert.equal((await f.state()).attempts.at(-1).status, 'failed');
});

test('v1 single-root authority stays v1 and published 1.26.1 rejects v2 run and registry envelopes', async t => {
  const old = await fixture(t, { split: false, api: legacy }); await old.begin();
  const original = await readFile(join(old.runDirectory, 'run.json'));
  const loaded = await current.getRun({ runDirectory: old.runDirectory });
  assert.equal(loaded.schemaVersion, 1); assert.equal(loaded.hostRoot, undefined);
  assert.deepEqual(await readFile(join(old.runDirectory, 'run.json')), original);
  const p = await old.proposal('inspect', 'coordinator', { toolName: 'Bash', toolInput: { command: 'pwd' } });
  const judgment = await current.classifyBoundary({ runDirectory: old.runDirectory, proposal: p, transport, env });
  assert.notEqual(judgment.verdict, 'pass', 'Old runtime-bound observations cannot silently authorize new execution.');
  assert.equal(judgment.code, 'host_tool_mapping');
  const retained = await readSnapshot(join(old.runDirectory, 'run.json'));
  assert.equal(retained.schemaVersion, 1); assert.equal(retained.run.schemaVersion, 1); assert.equal(retained.run.hostRoot, undefined);
  assert.equal((await legacy.getRun({ runDirectory: old.runDirectory })).schemaVersion, 1);
  const modern = await fixture(t); await modern.begin();
  await assert.rejects(legacy.getRun({ runDirectory: modern.runDirectory }), /unsupported|shape|schema/i);
  await assert.rejects(legacyStore.readRegistry(modern.home), /unsupported|shape|schema/i);
  const single = await fixture(t, { split: false });
  assert.equal((await single.begin()).hostRoot, single.root);
  const inspect = await single.classified('inspect', 'coordinator', { toolName: 'Bash', toolInput: { command: 'pwd' } });
  const event = await single.permit(inspect);
  const actual = await exec('pwd', [], { cwd: single.root, env: { PATH: process.env.PATH, HOME: single.home } });
  assert.equal((await single.post(event, actual.stdout)).status, 'completed');
});

async function prepareAstraWriter(f, candidateRoot) {
  const id = 'astra-writer', launch = { attemptId: id, candidateRoot };
  const p = await f.classified('writer-dispatch', 'writer', {
    attemptId: id, readSet: ['spec.md'], writeSet: ['src/value.mjs'],
    route: { role: 'writer', provider: 'codex', model: 'gpt-6-astra', reasoning: 'xhigh', capabilities: [] },
    toolName: 'Bash', toolInput: { command: `node ${quote(cli)} execute --home ${quote(f.home)} --input-json ${quote(JSON.stringify(launch))}` },
  });
  return { id, p, launch, candidateRoot, event: await f.permit(p) };
}

test('public executor reconciles an isolated Astra writer, scope violations and unobserved model identity', { timeout: 120000 }, async t => {
  for (const mode of ['good', 'outside-scope', 'wrong-model', 'missing-context']) await t.test(mode, async child => {
    const f = await fixture(child), before = await f.hostSnapshot();
    await f.begin(); await f.implementation();
    const candidateRoot = await f.worktree('astra-writer');
    const packet = await prepareAstraWriter(f, candidateRoot);
    assert.notEqual(candidateRoot, f.root); assert.notEqual(candidateRoot, f.hostRoot);
    const bin = join(f.base, 'bin'), provider = join(bin, 'codex'), invocationPath = join(f.base, 'synthetic-codex-invocation.json');
    await mkdir(bin);
    // Only the provider identity and its transcript are synthetic. The public
    // executor launches this actual process and reconciles its real file writes,
    // OS PID and exit; this fixture makes no live-provider or sandbox claim.
    const providerProgram = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] === 'app-server') {
  require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: { userAgent: 'synthetic-permissions-fixture' } }) + '\\n');
    else if (request.method === 'configRequirements/read') process.stdout.write(JSON.stringify({ id: request.id, result: { requirements: null } }) + '\\n');
  });
} else {
const mode = ${JSON.stringify(mode)}, sessionId = 'synthetic-astra-' + mode;
fs.writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({ pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2) }));
fs.writeFileSync(path.join(process.cwd(), 'src/value.mjs'), 'export const value = 3;\\n');
if (mode === 'outside-scope') fs.writeFileSync(path.join(process.cwd(), 'src/other.mjs'), 'export const other = 3;\\n');
const directory = path.join(process.env.CODEX_HOME, 'sessions');
fs.mkdirSync(directory, { recursive: true });
const records = [{ type: 'session_meta', payload: { id: sessionId, source: 'exec', model_provider: 'openai', cwd: process.cwd() } }];
if (mode !== 'missing-context') records.push({ type: 'turn_context', payload: {
  model: mode === 'wrong-model' ? 'gpt-5.6-sol' : 'gpt-6-astra', effort: 'xhigh', cwd: process.cwd(), approval_policy: 'never',
  sandbox_policy: { type: 'workspace-write', network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true },
  permission_profile: { type: 'managed', network: 'restricted', file_system: { type: 'restricted', entries: [
    { path: { type: 'special', value: { kind: 'root' } }, access: 'read' },
    { path: { type: 'path', path: process.cwd() }, access: 'write' },
  ] } },
} });
fs.writeFileSync(path.join(directory, 'rollout-' + sessionId + '.jsonl'), records.map(record => JSON.stringify(record)).join('\\n') + '\\n');
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: sessionId }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Synthetic Codex identity fixture wrote src/value.mjs in the isolated candidate.' } }) + '\\n');
}
`;
    await writeFile(provider, providerProgram); await chmod(provider, 0o700);
    const program = `const { launchGovernedProcess } = await import(${JSON.stringify(executorUrl)}); const result = await launchGovernedProcess(${JSON.stringify({ home: f.home, runDirectory: f.runDirectory, sessionId: f.session, launch: packet.launch })}); process.stdout.write(JSON.stringify(result));`;
    const actual = await exec(process.execPath, ['--input-type=module', '-e', program], {
      env: { ...process.env, HOME: f.home, CODEX_HOME: join(f.home, '.codex'), PATH: `${bin}:${process.env.PATH}` }, timeout: 20000,
    });
    const result = JSON.parse(actual.stdout), invoked = JSON.parse(await readFile(invocationPath, 'utf8'));
    assert.equal(result.exitCode, 0, actual.stderr); assert.equal(result.exitSignal, null);
    assert.equal(result.cancelled, false); assert.equal(result.ok, mode === 'good');
    assert.equal(result.identityObserved, ['good', 'outside-scope'].includes(mode));
    assert.equal(result.permissionPreflight.terminated, true);
    assert.throws(() => process.kill(Number(result.permissionPreflight.processId), 0), { code: 'ESRCH' });
    if (['good', 'outside-scope'].includes(mode)) assert.deepEqual(result.permissionObservation, {
      approvalPolicy: 'never', sandboxType: 'workspace-write', networkAccess: false, excludeTmpdirEnvVar: true,
      excludeSlashTmp: true, extraWritableRoots: [], candidateRoot, profileConfined: true,
    });
    else assert.equal(result.permissionObservation, null);
    assert.equal(result.integrated, false);
    assert.equal(invoked.cwd, candidateRoot);
    assert.equal(invoked.argv[invoked.argv.indexOf('--sandbox') + 1], 'workspace-write');
    assert.equal(await readFile(join(candidateRoot, 'src/value.mjs'), 'utf8'), 'export const value = 3;\n');
    assert.equal(await readFile(join(f.root, 'src/value.mjs'), 'utf8'), 'export const value = 1;\n');
    const pending = await f.state(), attempt = pending.attempts.find(value => value.id === packet.id);
    assert.equal(pending.phase, 'implementation');
    assert.equal(pending.boundaries.some(value => value.action === 'integrate'), false);
    assert.equal(attempt.process.candidateRoot, candidateRoot); assert.equal(attempt.process.command.executable, provider);
    assert.equal(attempt.process.processId, String(invoked.pid)); assert.equal(attempt.process.terminated, true);
    assert.equal(attempt.process.exitCode, 0); assert.equal(attempt.status, mode === 'good' ? 'awaiting-post' : 'failed');
    assert.throws(() => process.kill(invoked.pid, 0), { code: 'ESRCH' });
    assert.deepEqual(await f.hostSnapshot(), before);
    assert.equal((await f.post(packet.event, actual.stdout)).status, mode === 'good' ? 'completed' : 'failed');
    if (mode === 'outside-scope') {
      assert.deepEqual(result.changedPaths, ['src/other.mjs', 'src/value.mjs']);
      assert.deepEqual(result.outsideScope, ['src/other.mjs']);
      assert.equal(result.integration, 'rejected-outside-scope');
      assert.equal(await readFile(join(f.root, 'src/other.mjs'), 'utf8'), 'export const other = 1;\n');
    }
    if (mode === 'good') {
      assert.deepEqual(result.changedPaths, ['src/value.mjs']); assert.deepEqual(result.outsideScope, []);
      assert.deepEqual(attempt.changedPaths, ['src/value.mjs']);
      assert.equal(attempt.observed.model, 'gpt-6-astra'); assert.equal(attempt.observed.reasoning, 'xhigh');
      assert.equal(result.integration, 'parent-review-required');
      await f.advance('writer-return', 'integration', [packet.id]);
      const p = await patchProposal(f, patch(join(f.root, 'src/value.mjs')), ['src/value.mjs'], { action: 'integrate', dependsOn: [packet.id] });
      assert.equal((await f.classify(p)).verdict, 'pass');
      const integrationPermit = await f.permit(p);
      assert.equal(await readFile(join(f.root, 'src/value.mjs'), 'utf8'), 'export const value = 1;\n');
      await writeFile(join(f.root, 'src/value.mjs'), await readFile(join(candidateRoot, 'src/value.mjs')));
      assert.equal((await f.post(integrationPermit)).status, 'completed');
      assert.equal(await readFile(join(f.root, 'src/value.mjs'), 'utf8'), 'export const value = 3;\n');
    }
    assert.deepEqual(await f.hostSnapshot(), before);
  });
});

test('Astra writer binding rejects malformed commands without persisting authority or spawning a process', { timeout: 60000 }, async t => {
  const f = await fixture(t); await f.begin(); await f.implementation();
  const candidateRoot = await f.worktree('astra-writer'), packet = await prepareAstraWriter(f, candidateRoot);
  const provider = join(f.base, 'must-not-run-codex'), marker = join(f.base, 'unexpected-spawn');
  await writeFile(provider, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected process');\n`);
  await chmod(provider, 0o700);
  const argv = codexArguments({ role: 'writer', model: 'gpt-6-astra', reasoning: 'xhigh', candidateRoot, prompt: 'Change only src/value.mjs.' });
  const before = await readFile(join(f.runDirectory, 'run.json'));
  const beforePrompt = (...args) => [...argv.slice(0, -2), ...args, ...argv.slice(-2)];
  const wrongRoot = [...argv]; wrongRoot[wrongRoot.indexOf('--cd') + 1] = f.hostRoot;
  const missingRestriction = argv.filter((value, index) => value !== 'sandbox_workspace_write.network_access=false' && !(value === '-c' && argv[index + 1] === 'sandbox_workspace_write.network_access=false'));
  for (const malformed of [
    beforePrompt('--sandbox', 'danger-full-access'),
    beforePrompt('--add-dir', f.hostRoot),
    beforePrompt('-c', 'sandbox_workspace_write.network_access=true'),
    beforePrompt('-c', 'model_reasoning_effort="high"'),
    beforePrompt('--ignore-user-config'),
    wrongRoot, missingRestriction,
  ]) {
    await assert.rejects(current.bindProcessCandidate({ runDirectory: f.runDirectory, attemptId: packet.id, candidateRoot, command: { executable: provider, argv: malformed } }), /does not pin the designated profile/);
    assert.deepEqual(await readFile(join(f.runDirectory, 'run.json')), before);
    const attempt = (await f.state()).attempts.find(value => value.id === packet.id);
    assert.equal(attempt.processBinding, undefined); assert.equal(attempt.process, null);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  }
});

test('legacy unresolved launch and process bindings conservatively reserve writer roots', { timeout: 60000 }, async t => {
  for (const binding of ['launch', 'processBinding', 'process']) await t.test(binding, async child => {
    const f = await fixture(child, { split: false, api: legacy }); await f.begin(); await f.implementation();
    const writerRoot = await f.worktree('writer');
    const writer = await f.dispatch('writer-dispatch', 'writer', { candidateRoot: writerRoot, readSet: ['spec.md'], writeSet: ['src/value.mjs'] });
    if (binding !== 'launch') await f.bind(writer);
    if (binding === 'process') {
      const running = await f.start(writer, 'Actual legacy process.', { bound: true });
      await running.done;
      // Its exit has occurred but has not been observed by governance.
    }
    if (binding !== 'launch') {
      // Synthetic negative compatibility fixture: isolate each historical root
      // carrier; this edits only an isolated v1 envelope, never acceptance data.
      const state = await f.state(), attempt = state.attempts.at(-1);
      delete attempt.launch;
      if (binding === 'process') delete attempt.processBinding;
      await legacyStore.saveRun(f.runDirectory, state);
    }
    await f.observe('legacy-rival', writerRoot, current);
    const rival = { ...f.contract, id: 'legacy-rival-run', hostRoot: writerRoot, root: await f.worktree('rival-integration') };
    await assert.rejects(current.createRun({ home: f.home, contract: rival, activation: { sessionId: 'legacy-rival' } }), /reserved|unfinished|ownership/i);
    const retained = await current.getRun({ runDirectory: f.runDirectory });
    assert.equal(retained.schemaVersion, 1); assert.equal(retained.attempts.at(-1)[binding].candidateRoot, writerRoot);
  });
});
