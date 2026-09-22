import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowsCodexWriterRequirements, matchesCodexWriterPermissions } from '../runtime/jev-governance/codex.mjs';
import { preflightCodexWriterPermissions } from '../runtime/jev-governance/executor.mjs';

test('Codex writer requirements fail closed on managed profiles and incompatible restrictions', () => {
  const unrestricted = { allowedPermissionProfiles: null, defaultPermissions: null };
  for (const requirements of [null, unrestricted, { ...unrestricted, allowedApprovalPolicies: ['never'], allowedSandboxModes: ['workspace-write'] }]) assert.equal(allowsCodexWriterRequirements({ requirements }), true);
  for (const requirements of [undefined, {}, [], { allowedPermissionProfiles: null }, { defaultPermissions: null },
    { ...unrestricted, allowedPermissionProfiles: {} }, { ...unrestricted, allowedPermissionProfiles: [] },
    { ...unrestricted, defaultPermissions: ':workspace' }, { ...unrestricted, allowedApprovalPolicies: [] },
    { ...unrestricted, allowedApprovalPolicies: ['on-request'] }, { ...unrestricted, allowedSandboxModes: ['danger-full-access'] },
    { ...unrestricted, allowedSandboxModes: 'workspace-write' },
  ]) assert.equal(allowsCodexWriterRequirements({ requirements }), false);
  for (const response of [null, [], {}, { requirements: null, unrecognized: true }]) assert.equal(allowsCodexWriterRequirements(response), false);
});

test('observed writer permissions require effective confinement and never approvals', () => {
  const candidate = '/private/candidate';
  const metadata = () => ({
    approval_policy: 'never', sandbox_policy: { type: 'workspace-write', network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true },
    permission_profile: { type: 'managed', network: 'restricted', file_system: { type: 'restricted', entries: [
      { path: { type: 'special', value: { kind: 'root' } }, access: 'read' },
      { path: { type: 'path', path: candidate }, access: 'write' },
      { path: { type: 'path', path: candidate + '/.git' }, access: 'read', missing_path_behavior: 'skip' },
    ] } },
  });
  assert.equal(matchesCodexWriterPermissions(metadata(), candidate), true);
  for (const change of [
    value => { delete value.permission_profile; },
    value => { delete value.sandbox_policy; },
    value => { value.approval_policy = 'on-request'; },
    value => { value.sandbox_policy.network_access = true; },
    value => { value.sandbox_policy.exclude_slash_tmp = false; },
    value => { value.sandbox_policy.exclude_tmpdir_env_var = false; },
    value => { value.sandbox_policy.writable_roots = ['/private/other']; },
    value => { value.permission_profile.network = 'enabled'; },
    value => { value.permission_profile.file_system.type = 'unrestricted'; },
    value => { value.permission_profile.file_system.entries[0].access = 'write'; },
    value => { value.permission_profile.file_system.entries[1].path.path = candidate + '/../other'; },
    value => { value.permission_profile.file_system.entries[1].path.path = candidate + '-sibling'; },
  ]) { const value = metadata(); change(value); assert.equal(matchesCodexWriterPermissions(value, candidate), false); }
});

// Only these JSON-RPC responses are synthetic. The app-server subprocess,
// bounded protocol, PID, process-group termination and isolated HOME are real.
test('Codex writer preflight accepts only supported actual RPC responses and terminates each process', { timeout: 45000 }, async t => {
  for (const mode of ['null', 'fields-null', 'managed', 'missing-fields', 'error', 'malformed', 'server-request', 'premature-exit', 'timeout']) await t.test(mode, async child => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'codex-permission-preflight-')));
    child.after(() => rm(base, { recursive: true, force: true }));
    const home = join(base, 'home'), candidateRoot = join(base, 'candidate'), executable = join(base, 'codex');
    const invocation = join(base, 'invocation.json');
    await mkdir(home); await mkdir(candidateRoot);
    const provider = `#!/usr/bin/env node
const fs = require('node:fs');
const mode = ${JSON.stringify(mode)};
fs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), cwd: process.cwd() }));
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
let initialized = false;
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (message.id !== 1 || message.params.clientInfo.name !== 'development-system-permission-preflight' || message.params.capabilities.experimentalApi !== true) process.exit(91);
    if (mode === 'timeout') return;
    if (mode === 'premature-exit') process.exit(0);
    send({ id: 1, result: { userAgent: 'synthetic-test-provider' } }); return;
  }
  if (message.method === 'initialized') { initialized = true; return; }
  if (message.method !== 'configRequirements/read' || message.id !== 2 || Object.hasOwn(message, 'params') || !initialized) process.exit(92);
  if (mode === 'error') send({ id: 2, error: { code: -32601, message: 'PRIVATE_PROVIDER_PAYLOAD' } });
  else if (mode === 'malformed') process.stdout.write('PRIVATE_PROVIDER_PAYLOAD\\n');
  else if (mode === 'server-request') send({ id: 3, method: 'requestApproval', params: { private: 'PRIVATE_PROVIDER_PAYLOAD' } });
  else send({ id: 2, result: { requirements: mode === 'null' ? null : mode === 'fields-null' ? { allowedPermissionProfiles: null, defaultPermissions: null } : mode === 'managed' ? { allowedPermissionProfiles: {}, defaultPermissions: null } : {} } });
});
`;
    await writeFile(executable, provider); await chmod(executable, 0o700);
    const input = { executable, candidateRoot, env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex') } };
    if (['null', 'fields-null'].includes(mode)) {
      const result = await preflightCodexWriterPermissions(input);
      assert.equal(result.terminated, true); assert.match(result.requirementsHash, /^[a-f0-9]{64}$/u);
      assert.equal(result.processId, String(JSON.parse(await readFile(invocation, 'utf8')).pid));
    } else await assert.rejects(preflightCodexWriterPermissions(input), error => {
      assert.match(error.message, /Codex writer permission/); assert.equal(error.message.includes('PRIVATE_PROVIDER_PAYLOAD'), false); return true;
    });
    const actual = JSON.parse(await readFile(invocation, 'utf8'));
    assert.deepEqual(actual.argv, ['app-server', '--listen', 'stdio://']); assert.equal(actual.cwd, candidateRoot);
    assert.throws(() => process.kill(actual.pid, 0), { code: 'ESRCH' });
  });
});
