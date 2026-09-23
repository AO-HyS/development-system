import assert from 'node:assert/strict';
import test from 'node:test';
import { codexArguments, matchesCodexCommand, requiredCodexServiceTier, matchesCodexWriterPermissions } from '../runtime/jev-governance/codex.mjs';
import { codexTierObservation } from '../runtime/jev-governance/executor.mjs';
import { profileFor } from '../runtime/jev-governance/policy.mjs';

const root = '/private/candidate';
const route = (role, model, reasoning, provider = 'codex') => ({ role, provider, model, reasoning });
const command = (role, model, reasoning) => codexArguments({ role, model, reasoning, candidateRoot: root, prompt: 'Exact packet.' });
const expected = (role, model, reasoning) => ({ role, model, reasoning, candidateRoot: root });
const beforePrompt = (argv, ...args) => [...argv.slice(0, argv.indexOf('--')), ...args, ...argv.slice(argv.indexOf('--'))];

test('new exact routes and historical explicit routes remain available', () => {
  for (const [role, model, effort] of [
    ['writer', 'gpt-6-sol', 'low'], ['writer', 'gpt-6-sol', 'medium'],
    ['writer', 'gpt-6-luna', 'high'], ['writer', 'gpt-6-luna', 'max'],
    ['researcher', 'gpt-6-luna', 'high'],
    ['writer', 'gpt-6-astra', 'xhigh'], ['researcher', 'gpt-5.6-luna', 'high'],
    ['writer', 'opencode-go/deepseek-v4.1-flash', 'high'],
  ]) {
    const provider = model.startsWith('opencode-') ? 'opencode-go' : 'codex';
    assert.equal(profileFor(role, route(role, model, effort, provider)).ok, true, `${role}/${model}/${effort}`);
  }
  for (const role of ['planner', 'plan-reviewer', 'reviewer']) assert.equal(profileFor(role, route(role, 'gpt-6-astra', 'xhigh')).ok, true);
  for (const [role, model, effort, provider] of [
    ['writer', 'gpt-6-sol', 'none'], ['writer', 'gpt-6-sol', 'high'], ['writer', 'gpt-6-luna', 'low'],
    ['researcher', 'gpt-6-luna', 'max'], ['planner', 'gpt-6-sol', 'medium'], ['reviewer', 'gpt-6-luna', 'max'],
    ['writer', 'gpt-6-sol', 'medium', 'opencode-go'], ['writer', 'gpt-6-luna', 'max', 'unknown'],
  ]) assert.equal(profileFor(role, route(role, model, effort, provider)).ok, false, `${role}/${model}/${effort}/${provider}`);
});

test('Luna 6 priority is pinned exactly without broadening the writer sandbox', () => {
  assert.equal(requiredCodexServiceTier('gpt-6-luna'), 'priority');
  assert.equal(requiredCodexServiceTier('gpt-6-sol'), null);
  for (const [role, effort] of [['writer', 'high'], ['writer', 'max'], ['researcher', 'high']]) {
    const argv = command(role, 'gpt-6-luna', effort);
    const target = expected(role, 'gpt-6-luna', effort);
    assert.equal(matchesCodexCommand(argv, target), true);
    assert.equal(argv.filter((arg) => arg === 'service_tier="priority"').length, 1);
    const noTier = [...argv]; noTier.splice(noTier.indexOf('service_tier="priority"') - 1, 2);
    assert.equal(matchesCodexCommand(noTier, target), false);
    for (const change of [
      ['-c', 'service_tier="default"'], ['-c', 'service_tier="priority"'],
      ['-c', 'model_reasoning_effort="none"'], ['--sandbox', 'danger-full-access'],
      ['-c', 'sandbox_workspace_write.network_access=true'], ['--add-dir', '/'],
    ]) assert.equal(matchesCodexCommand(beforePrompt(argv, ...change), target), false, change.join(' '));
    assert.equal(matchesCodexCommand(argv, { ...target, model: 'gpt-6-sol' }), false);
    assert.equal(matchesCodexCommand(argv, { ...target, reasoning: 'low' }), false);
  }
  const sol = command('writer', 'gpt-6-sol', 'medium');
  assert.equal(matchesCodexCommand(sol, expected('writer', 'gpt-6-sol', 'medium')), true);
  assert.equal(matchesCodexCommand(beforePrompt(sol, '-c', 'service_tier="priority"'), expected('writer', 'gpt-6-sol', 'medium')), false);
  assert.equal(sol.includes('approval_policy="never"'), true);
  assert.equal(sol.includes('sandbox_workspace_write.network_access=false'), true);
  assert.equal(matchesCodexWriterPermissions({ approval_policy: 'never', sandbox_policy: { type: 'workspace-write', network_access: true, exclude_tmpdir_env_var: true, exclude_slash_tmp: true }, permission_profile: { type: 'managed', network: 'restricted', file_system: { type: 'restricted', entries: [] } } }, root), false);
});

test('requested, host observed and provider observed tier remain separate', () => {
  assert.deepEqual(codexTierObservation('priority', []), { requested: 'priority', hostObserved: 'unknown', providerObserved: 'unknown' });
  assert.deepEqual(codexTierObservation('priority', [{ type: 'event_msg', payload: { type: 'thread_settings_applied', serviceTier: 'priority' } }]), { requested: 'priority', hostObserved: 'priority', providerObserved: 'unknown' });
  assert.deepEqual(codexTierObservation(null, [{ type: 'turn_context', payload: { service_tier: 'default' } }]), { requested: 'unspecified', hostObserved: 'default', providerObserved: 'unknown' });
  assert.deepEqual(codexTierObservation('priority', [{ type: 'event_msg', payload: { type: 'thread_settings_applied' } }]), { requested: 'priority', hostObserved: 'unknown', providerObserved: 'unknown' });
  assert.throws(() => codexTierObservation('priority', [{ type: 'event_msg', payload: { type: 'thread_settings_applied', serviceTier: 'default' } }]));
});
