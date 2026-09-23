import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { authorizeAction, createRun, preflightRun, recordPassiveToolObservation, registerHostSession, stableHash } from '../runtime/jev-governance/core.mjs';
import { readRegistry, registryPath } from '../runtime/jev-governance/store.mjs';

const exec = promisify(execFile);

async function fixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'passive-contention-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home'), root = join(base, 'repo');
  await mkdir(home); await mkdir(root);
  await writeFile(join(root, 'spec.md'), 'Inspect the current root.');
  await exec('git', ['init', '-q', root]);
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base'], { cwd: root });
  const baseSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const session = (sessionId = 'operator', overrides = {}) => ({ kind: 'session', sessionId, cwd: root, model: 'gpt-5.6-sol', reasoning: 'high', transcriptPath: join(base, `${sessionId}.jsonl`), ...overrides });
  const event = (toolUseId, command = 'pwd') => ({ session_id: 'operator', turn_id: `turn-${toolUseId}`, tool_use_id: `use-${toolUseId}`, cwd: root, model: 'gpt-5.6-sol', reasoning: 'high', tool_name: 'Bash', tool_input: { command } });
  const contract = { id: 'passive-check', taskKind: 'audit', requiredCapabilities: ['shell'], root, baseSha, endpoint: 'local accepted', authorization: 'Inspect the isolated fixture', sources: [{ id: 'spec', path: 'spec.md', kind: 'spec' }], tickets: [{ id: 'T1', dependsOn: [] }], criteria: [{ id: 'C1', ticketId: 'T1', requirement: 'Inspect root', evidenceRequired: 'Observed exact pwd' }], capacity: { total: 2, providers: { codex: 2 } } };
  return { home, root, session, event, contract };
}

test('ordinary concurrent hook pairs leave registry unchanged while exact pwd remains a preflight capability', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const first = await registerHostSession({ home: f.home, event: f.session() });
  const revision = (await readRegistry(f.home)).revision;
  const pairs = Array.from({ length: 24 }, (_, i) => f.event(i, 'git status --short'));
  const results = await Promise.all(pairs.map(async event => {
    const observed = await registerHostSession({ home: f.home, event: f.session() });
    const pre = await recordPassiveToolObservation({ home: f.home, event: { ...event, hook_event_name: 'PreToolUse' } });
    const post = await recordPassiveToolObservation({ home: f.home, event: { ...event, hook_event_name: 'PostToolUse', tool_response: { exit_code: 0, stdout: f.root } } });
    return { observed, pre, post };
  }));
  for (const result of results) {
    assert.equal(result.observed.observedAt, first.observedAt);
    assert.equal(result.pre.status, 'unsupported');
    assert.equal(result.post.status, 'unsupported');
  }
  assert.equal((await readRegistry(f.home)).revision, revision);
  assert.equal((await preflightRun({ home: f.home, contract: f.contract, activation: { sessionId: 'operator' } })).ready, false);

  const pwd = f.event('pwd', '  pwd  ');
  assert.equal((await recordPassiveToolObservation({ home: f.home, event: { ...pwd, hook_event_name: 'PreToolUse' } })).status, 'pending');
  assert.equal((await recordPassiveToolObservation({ home: f.home, event: { ...pwd, hook_event_name: 'PostToolUse', tool_response: { exit_code: 0, stdout: f.root } } })).status, 'success');
  assert.equal((await preflightRun({ home: f.home, contract: f.contract, activation: { sessionId: 'operator' } })).ready, true);
  await createRun({ home: f.home, contract: f.contract, activation: { sessionId: 'operator' } });
  const denied = await authorizeAction({ home: f.home, preToolEvent: { ...f.event('protected', 'pwd'), hook_event_name: 'PreToolUse' } });
  assert.equal(denied.decision, 'deny');
  assert.match(denied.reason, /permit/);
});

test('distinct sessions and changed identity survive concurrent registration; unchanged identity keeps stored time', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const sessions = Array.from({ length: 12 }, (_, i) => f.session(`operator-${i}`));
  await Promise.all(sessions.map(event => registerHostSession({ home: f.home, event })));
  const before = await readRegistry(f.home);
  assert.equal(Object.keys(before.sessions).length, sessions.length);
  const changed = f.session('operator-0', { model: 'gpt-6-sol', observedAt: '2026-09-23T12:00:00.000Z' });
  const added = f.session('operator-new');
  await Promise.all([registerHostSession({ home: f.home, event: changed }), registerHostSession({ home: f.home, event: added })]);
  const after = await readRegistry(f.home);
  assert.equal(after.sessions['operator-0'].model, 'gpt-6-sol');
  assert.equal(after.sessions['operator-0'].observedAt, changed.observedAt);
  assert.ok(after.sessions['operator-new']);
  assert.equal(Object.keys(after.sessions).length, sessions.length + 1);
  const same = await registerHostSession({ home: f.home, event: f.session('operator-0', { model: 'gpt-6-sol', observedAt: '2099-01-01T00:00:00.000Z' }) });
  assert.equal(same.observedAt, changed.observedAt);
  assert.equal((await readRegistry(f.home)).revision, after.revision);
});

test('the no-op path still rejects a corrupt checksum and unsupported registry shape', async t => {
  const f = await fixture(t);
  await registerHostSession({ home: f.home, event: f.session() });
  const path = registryPath(f.home);
  const valid = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...valid, checksum: '0'.repeat(64) }));
  await assert.rejects(registerHostSession({ home: f.home, event: f.session() }), { code: 'corrupt' });
  const malformed = { schemaVersion: 2, revision: 1, sessions: [], runs: {} };
  await writeFile(path, JSON.stringify({ ...malformed, checksum: stableHash(malformed) }));
  await assert.rejects(registerHostSession({ home: f.home, event: f.session() }), { code: 'corrupt' });
});

test('arbitrary shell output and unknown pwd output cannot establish shell availability', async t => {
  const f = await fixture(t);
  await registerHostSession({ home: f.home, event: f.session() });
  const shell = f.event('arbitrary', 'printf pwd');
  assert.equal((await recordPassiveToolObservation({ home: f.home, event: { ...shell, hook_event_name: 'PreToolUse' } })).status, 'unsupported');
  assert.equal((await recordPassiveToolObservation({ home: f.home, event: { ...shell, hook_event_name: 'PostToolUse', tool_response: { exit_code: 0, stdout: f.root } } })).status, 'unsupported');
  const pwd = f.event('unknown');
  await recordPassiveToolObservation({ home: f.home, event: { ...pwd, hook_event_name: 'PreToolUse' } });
  assert.notEqual((await recordPassiveToolObservation({ home: f.home, event: { ...pwd, hook_event_name: 'PostToolUse', tool_response: { stdout: f.root } } })).status, 'success');
  assert.equal((await preflightRun({ home: f.home, contract: f.contract, activation: { sessionId: 'operator' } })).ready, false);
});
