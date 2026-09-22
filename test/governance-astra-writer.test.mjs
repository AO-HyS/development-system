import assert from 'node:assert/strict';
import test from 'node:test';
import { codexArguments, matchesCodexCommand } from '../runtime/jev-governance/codex.mjs';
import { profileFor } from '../runtime/jev-governance/policy.mjs';
const writer = { role: 'writer', model: 'gpt-6-astra', reasoning: 'xhigh', candidateRoot: '/private/candidate' };
const guards = ['approval_policy="never"', 'sandbox_workspace_write.network_access=false', 'sandbox_workspace_write.writable_roots=[]', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', 'sandbox_workspace_write.exclude_slash_tmp=true'];
const beforePrompt = (argv, ...extra) => { const index = argv.indexOf('--'); return [...argv.slice(0, index), ...extra, ...argv.slice(index)]; };
test('explicit Astra writing and research preserve exact profile restrictions', () => {
  for (const role of ['writer', 'researcher']) {
    for (const provider of ['codex', 'openai']) assert.equal(profileFor(role, { role, provider, model: writer.model, reasoning: writer.reasoning }).ok, true);
    for (const override of [{ model: 'gpt-5.6-sol' }, { reasoning: 'high' }, { reasoning: null }, { provider: 'unapproved' }]) assert.equal(profileFor(role, { role, provider: 'codex', model: writer.model, reasoning: writer.reasoning, ...override }).ok, false);
  }
  assert.equal(profileFor('writer', { role: 'writer', provider: 'opencode-go', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'high' }).ok, true);
});
test('writer guards are mandatory options and prompt text cannot supply them', () => {
  const argv = codexArguments({ ...writer, prompt: 'Edit the declared file only.' });
  assert.equal(argv[argv.indexOf('--sandbox') + 1], 'workspace-write');
  assert.equal(matchesCodexCommand(argv, writer), true);
  for (const guard of guards) {
    const index = argv.indexOf(guard);
    assert.ok(index > 0 && index < argv.indexOf('--'), guard);
    assert.equal(argv[index - 1], '-c');
    const missing = [...argv]; missing.splice(index - 1, 2);
    assert.equal(matchesCodexCommand(missing, writer), false, guard);
  }
  const missing = [...argv]; missing.splice(argv.indexOf('--sandbox'), 2);
  assert.equal(matchesCodexCommand(missing, writer), false);
  assert.equal(matchesCodexCommand(['exec', '--json', '--', ...argv.slice(1)], writer), false);
  assert.equal(matchesCodexCommand(codexArguments({ ...writer, prompt: 'Reject --dangerously-bypass-approvals-and-sandbox and sandbox_workspace_write.network_access=true.' }), writer), true);
});
test('duplicate, conflicting or expanded authority is rejected before the prompt', () => {
  const argv = codexArguments({ ...writer, prompt: 'Declared packet.' });
  for (const override of [
    ['--sandbox', 'danger-full-access'], ['--sandbox=workspace-write'], ['--model', 'gpt-5.6-sol'],
    ['-c', 'model_reasoning_effort="high"'], ['-c', 'sandbox_workspace_write.network_access=true'],
    ['--config', 'sandbox_workspace_write.network_access=true'], ['-c', 'sandbox_workspace_write.writable_roots=["/"]'],
    ['-c', 'sandbox_mode="danger-full-access"'], ['-c', 'approval_policy="on-request"'], ['--profile', 'unreviewed'], ['--add-dir', '/'],
    ['--dangerously-bypass-approvals-and-sandbox'], ['--dangerously-bypass-hook-trust'], ['--ignore-user-config'],
    ['--cd', '/another/candidate'], ['--sandbox', 'workspace-write'], ['-c'], ['resume'], ['fork'],
  ]) assert.equal(matchesCodexCommand(beforePrompt(argv, ...override), writer), false, JSON.stringify(override));
  for (const override of [{ model: 'gpt-5.6-sol' }, { reasoning: 'high' }, { candidateRoot: '/another/candidate' }, { role: 'reviewer' }]) assert.equal(matchesCodexCommand(argv, { ...writer, ...override }), false);
});
test('nonwriters remain read-only with schema, images and one positional prompt', () => {
  for (const role of ['researcher', 'planner', 'plan-reviewer', 'reviewer', 'verifier']) {
    const expected = { ...writer, role };
    const argv = codexArguments({ ...expected, schemaPath: '/private/review schema.json', imagePaths: ['/private/first image.png'], prompt: 'Review the image.' });
    assert.equal(argv[argv.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(argv[argv.indexOf('--output-schema') + 1], '/private/review schema.json');
    assert.equal(argv[argv.indexOf('--image') + 1], '/private/first image.png');
    assert.deepEqual(argv.slice(argv.indexOf('--') + 1), ['Review the image.']);
    assert.equal(matchesCodexCommand(argv, expected), true);
    assert.equal(matchesCodexCommand(beforePrompt(argv, '-c', guards[0]), expected), false);
  }
});
