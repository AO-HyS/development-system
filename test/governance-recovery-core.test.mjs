import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { advancePhase, authorizeAction, bindProcessCandidate, buildObservationAssessmentInput, classifyBoundary, closeRun, createRun, getRun, persistObservedToolOutput, preflightRun, prepareAction, recordHostEvent, recordPassiveToolObservation, recoverHostAttempt, recoverUnstartedRun, registerHostSession, resolveRunDirectory, safeAttemptDiagnostic, stableHash } from '../runtime/jev-governance/core.mjs';
import { readRegistry, saveRun, writeRegistry } from '../runtime/jev-governance/store.mjs';
import { runGovernance } from '../runtime/jev-governance/cli.mjs';
import { handleHook } from '../runtime/jev-governance/hook.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../runtime/jev-governance/cli.mjs', import.meta.url));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=';
const imageOutput = { content: [{ type: 'text', text: 'Observed product still displays the failing state.' }, { type: 'image', mimeType: 'image/png', data: png }] };
// Only signature handling is under test; real image usability is independently
// assessed in the operational browser probe, never inferred from this fixture.
const jpegSignature = Buffer.from([255, 216, 255, 217]);
const env = { TYPESAFE_API_KEY: 'fixture-only-not-a-secret' };
async function transport({ body }) {
  const request = JSON.parse(body), answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    const choice = id === 'route' ? request.state.boundary.route.role : id === 'tool' ? 'compliant' : id === 'priority' ? 'execute_now' : 'satisfied';
    answers[id] = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) };
  }
  return { model: 'jev-1.13.0', usage: { input_tokens: 1 }, answers };
}

async function fixture(t, visual = false) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'recovery-core-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo'), home = join(base, 'home'), session = 'observed-root';
  await mkdir(root); await mkdir(home);
  await writeFile(join(root, 'spec.md'), 'C1: Inspect the product and preserve evidence. Endpoint local accepted.');
  await writeFile(join(root, 'candidate.txt'), 'current candidate');
  await exec('git', ['init', '-q', root]); await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base'], { cwd: root });
  const baseSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const sessionEvent = { kind: 'session', sessionId: session, model: 'gpt-5.6-sol', reasoning: 'high', cwd: root, transcriptPath: join(base, 'synthetic.jsonl') };
  await registerHostSession({ home, event: sessionEvent });
  const contract = { id: 'recovery', taskKind: 'audit', requiredCapabilities: visual ? ['shell', 'computer-use'] : ['shell'], root, baseSha, endpoint: 'local accepted', authorization: 'Audit this isolated fixture', sources: [{ id: 'spec', path: 'spec.md', kind: 'spec' }], tickets: [{ id: 'T1', dependsOn: [] }], criteria: [{ id: 'C1', ticketId: 'T1', requirement: 'Product meets the specified state', evidenceRequired: visual ? 'Actual observed screenshot assessed independently' : 'Exact process check', evidenceKind: visual ? 'visual' : 'check' }], capacity: { total: 3, providers: { codex: 3, local: 1 } } };
  const runDirectory = join(home, '.development-system/governance/runs/recovery');
  const requests = [];
  let sequence = 0;
  const event = (toolName = 'Bash', toolInput = { command: 'pwd' }) => ({ session_id: session, turn_id: `turn-${++sequence}`, tool_use_id: `use-${sequence}`, cwd: root, model: sessionEvent.model, reasoning: sessionEvent.reasoning, tool_name: toolName, tool_input: toolInput });
  async function passive(toolName = 'Bash', toolInput = { command: 'pwd' }, output = `${root}\n`) {
    const observed = event(toolName, toolInput);
    await recordPassiveToolObservation({ home, event: { ...observed, hook_event_name: 'PreToolUse' } });
    return recordPassiveToolObservation({ home, event: { ...observed, hook_event_name: 'PostToolUse', tool_response: output } });
  }
  async function begin() {
    await passive();
    if (visual) await passive('mcp__cua_repl__js', { code: 'await cua.getState();' }, imageOutput);
    return createRun({ home, contract, activation: { sessionId: session } });
  }
  const route = role => ({ role, provider: 'codex', model: role === 'coordinator' ? sessionEvent.model : role === 'researcher' ? 'gpt-5.6-luna' : 'gpt-6-astra', reasoning: role === 'coordinator' || role === 'researcher' ? 'high' : 'xhigh', capabilities: [] });
  async function proposal(action, role = 'coordinator', fields = {}) {
    return { id: `boundary-${++sequence}`, phase: (await getRun({ runDirectory })).phase, action, actorId: session, attemptId: null, objective: `Perform ${action} for all criteria using exact evidence`, requirementIds: contract.criteria.map(c => c.id), sourceIds: ['spec'], readSet: ['spec.md', 'candidate.txt'], writeSet: [], dependsOn: [], route: route(role), toolName: 'governance', toolInput: {}, observations: ['Authorized endpoint local accepted'], evidenceRefs: [], ...fields };
  }
  async function classified(action, role, fields) {
    const p = await proposal(action, role, fields), result = await classifyBoundary({ runDirectory, proposal: p, transport: async request => { requests.push(JSON.parse(request.body)); return transport(request); }, env });
    assert.equal(result.verdict, 'pass', result.reason); return p;
  }
  async function permit(p) {
    await prepareAction({ runDirectory, boundaryId: p.id, action: { actorId: session, attemptId: p.attemptId, toolName: p.toolName, toolInput: p.toolInput } });
    const actual = event(p.toolName, p.toolInput);
    assert.equal((await authorizeAction({ home, preToolEvent: { ...actual, hook_event_name: 'PreToolUse' } })).decision, 'allow');
    return actual;
  }
  const post = (actual, output) => recordHostEvent({ home, event: { kind: 'hook', ...actual, hook_event_name: 'PostToolUse', tool_response: output } });
  async function capture(output = imageOutput) {
    const p = await classified('host-tool', 'coordinator', { toolName: 'mcp__cua_repl__js', toolInput: { code: `await page.screenshot(); /* fixture ${sequence} */` } });
    const actual = await permit(p), result = await post(actual, output);
    return { p, actual, result };
  }
  const provider = join(base, 'fixture-provider');
  await writeFile(provider, '#!/usr/bin/env node\nimport fs from "node:fs"; const args=process.argv.slice(2); for(let i=0;i<args.length;i++) if(args[i]==="--image") fs.readFileSync(args[++i]); process.stdout.write(process.env.FIXTURE_OUTPUT);\n');
  await chmod(provider, 0o700);
  async function processOutput(action, role, output, extra = {}) {
    const { requirementIds = contract.criteria.map(c => c.id), expectedOk = true, ...descriptor } = extra;
    const attemptId = `process-${++sequence}`, launch = { attemptId, ...descriptor };
    const fields = descriptor.check ? { route: { role: 'verifier', provider: 'local', model: 'deterministic-check', reasoning: null, capabilities: [] }, readSet: ['spec.md', 'candidate.txt', 'check.mjs'] } : {};
    const p = await classified(action, role, { ...fields, requirementIds, attemptId, toolName: 'Bash', toolInput: { command: `node '${cli}' execute --home '${home}' --input-json '${JSON.stringify(launch)}'` } });
    const actual = await permit(p);
    const bundle = extra.assessment ? await buildObservationAssessmentInput({ runDirectory, ...extra.assessment }) : null;
    const command = descriptor.check ?? { executable: provider, argv: ['exec', '--model', p.route.model, '--sandbox', 'read-only', '-c', `model_reasoning_effort="${p.route.reasoning}"`, ...(bundle?.imagePaths.flatMap(path => ['--image', path]) ?? []), bundle ? JSON.stringify(bundle) : 'Bounded fixture packet'] };
    await bindProcessCandidate({ runDirectory, attemptId, candidateRoot: root, command });
    const child = spawn(command.executable, command.argv, { cwd: root, env: { PATH: process.env.PATH, FIXTURE_OUTPUT: typeof output === 'function' ? JSON.stringify(output(bundle)) : typeof output === 'string' ? output : JSON.stringify(output) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.resume();
    const completed = new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    const common = { attemptId, processId: String(child.pid), candidateRoot: root, command };
    await recordHostEvent({ home, event: { ...common, kind: 'process-start', provider: 'unknown', model: 'unknown', reasoning: 'unknown' } });
    const exitCode = await completed;
    const result = await recordHostEvent({ home, event: { ...common, kind: 'process-exit', provider: p.route.provider, model: p.route.model, reasoning: p.route.reasoning, processSessionId: `fresh-${attemptId}`, exitCode, terminated: true, output: stdout } });
    await post(actual, 'Actual attached process returned.');
    assert.equal(result.ok, expectedOk, result.reason); return attemptId;
  }
  async function advance(action, to, dependsOn = []) {
    const p = await classified(action, 'coordinator', { dependsOn });
    return advancePhase({ runDirectory, transition: { to, boundaryId: p.id, reason: 'Current independent role output' } });
  }
  async function reachEvidence({ finalOutput, expectedFinalOk = true } = {}) {
    const criterionIds = contract.criteria.map(c => c.id);
    await advance('intake-review', 'research');
    const research = await processOutput('research-dispatch', 'researcher', 'C1 uses candidate.txt and exact observed assets. No hidden context.');
    await advance('research-return', 'plan', [research]);
    const plan = await processOutput('plan-author', 'planner', { kind: 'plan', summary: 'Audit every criterion with current assets and independent review', criterionIds, packets: [{ id: 'audit', readSet: ['candidate.txt'], writeSet: [], dependsOn: [] }] });
    await advance('plan-return', 'plan-review', [plan]);
    const review = await processOutput('plan-review', 'plan-reviewer', { kind: 'review', verdict: 'pass', findings: [], criterionIds });
    await advance('plan-review-return', 'final-review', [review]);
    const final = await processOutput('final-review', 'reviewer', finalOutput ?? { kind: 'review', verdict: 'pass', findings: [], criterionIds }, { expectedOk: expectedFinalOk });
    if (expectedFinalOk) await advance('final-review-return', 'evidence', [final]);
    return final;
  }
  return { home, root, session, sessionEvent, contract, runDirectory, requests, event, passive, begin, proposal, classified, permit, post, capture, processOutput, reachEvidence };
}

test('preflight rejects undeclared/unobserved capabilities before binding and completed runs permit same-session recovery', async t => {
  const f = await fixture(t);
  await assert.rejects(createRun({ home: f.home, contract: { ...f.contract, requiredCapabilities: undefined }, activation: { sessionId: f.session } }), error => error.code === 'declaration_missing');
  assert.equal((await preflightRun({ home: f.home, contract: f.contract, activation: { sessionId: f.session } })).ready, false);
  await assert.rejects(createRun({ home: f.home, contract: f.contract, activation: { sessionId: f.session } }), error => error.code === 'capability_missing');
  assert.equal(await resolveRunDirectory(f.home, f.session), null);
  assert.equal((await f.passive('Bash', { command: 'false' }, '')).ok, false);
  await f.begin();
  const invalid = await f.proposal('inspect', 'coordinator', { toolName: 'Bash', toolInput: { command: 'rm candidate.txt' } });
  let calls = 0;
  const judgment = await classifyBoundary({ runDirectory: f.runDirectory, proposal: invalid, transport: async () => { calls++; throw Error('not reached'); }, env });
  assert.equal(calls, 0); assert.equal(judgment.transport, 'not_evaluated'); assert.equal(judgment.transportAttempted, false);
  const valid = await f.proposal('intake-review', 'coordinator');
  const missingCredential = await classifyBoundary({ runDirectory: f.runDirectory, proposal: valid, home: f.home, env: {} });
  assert.equal(missingCredential.transportAttempted, false); assert.equal(missingCredential.transport, 'not_evaluated'); assert.equal(missingCredential.code, 'credential_missing');
  const outage = await classifyBoundary({ runDirectory: f.runDirectory, proposal: { ...valid, id: 'provider-failure' }, transport: async () => { throw Error('private provider response'); }, env });
  assert.equal(outage.transportAttempted, true); assert.equal(outage.transport, 'injected'); assert.equal(outage.code, 'provider_unavailable'); assert.equal(outage.reason, 'Jev transport failed');
  await closeRun({ runDirectory: f.runDirectory, outcome: { status: 'blocked', reason: 'Missing capability', boundaryId: invalid.id } });
  assert.equal(await resolveRunDirectory(f.home, f.session), null);
  assert.equal(await resolveRunDirectory(f.home, f.session, { includeFinished: true }), f.runDirectory);
  await registerHostSession({ home: f.home, event: f.sessionEvent });
  await f.passive();
  assert.equal((await preflightRun({ home: f.home, contract: f.contract, activation: { sessionId: f.session } })).ready, true);
  const next = await createRun({ home: f.home, contract: { ...f.contract, id: 'recovered' }, activation: { sessionId: f.session } });
  assert.equal(next.phase, 'intake');
  assert.equal((await getRun({ runDirectory: f.runDirectory })).judgments[0].id, judgment.id);
});

test('passive observations require exact pairs and cross-session recovery preserves original receipts and ownership', async t => {
  const f = await fixture(t);
  const e = f.event();
  await assert.rejects(recordPassiveToolObservation({ home: f.home, event: { ...e, hook_event_name: 'PostToolUse', tool_response: `${f.root}\n` } }), /PreToolUse/);
  await recordPassiveToolObservation({ home: f.home, event: { ...e, hook_event_name: 'PreToolUse' } });
  await assert.rejects(recordPassiveToolObservation({ home: f.home, event: { ...e, reasoning: 'xhigh', hook_event_name: 'PostToolUse', tool_response: `${f.root}\n` } }), /reasoning/);
  await f.begin();
  const p = await f.classified('intake-review', 'coordinator');
  await registerHostSession({ home: f.home, event: { ...f.sessionEvent, sessionId: 'observed-operator' } });
  const recovered = await recoverUnstartedRun({ home: f.home, runId: f.contract.id, sessionId: 'observed-operator', reason: 'Recover an unstarted blocked run' });
  assert.equal(recovered.rootSessionId, f.session); assert.equal(recovered.judgments.length, 1); assert.equal(recovered.boundaries[0].id, p.id);
  assert.equal(recovered.recoveryReceipts[0].operatorSessionId, 'observed-operator');
  assert.equal(recovered.outcome.status, 'blocked');
});

test('actual image bytes control persisted MIME without changing returned bytes or granting acceptance', async t => {
  const f = await fixture(t, true); await f.begin();
  const output = { content: [{ type: 'text', text: 'Pending' }, { type: 'image', mimeType: 'image/png', data: jpegSignature.toString('base64') }] };
  const capture = await f.capture(output);
  assert.equal(capture.result.ok, true);
  assert.equal(capture.result.productAcceptance, false);
  const state = await getRun({ runDirectory: f.runDirectory });
  const observation = state.observations[0], artifact = observation.artifacts.find(a => a.type === 'image');
  assert.equal(observation.outputHash, stableHash(output));
  assert.equal(artifact.mimeType, 'image/jpeg');
  assert.equal(artifact.declaredMimeType, 'image/png');
  assert.match(artifact.name, /\.jpg$/);
  assert.deepEqual(await readFile(join(f.runDirectory, 'observations', observation.id, artifact.name)), jpegSignature);
  assert.equal(state.evidence.length, 0);
  assert.equal((await f.post(capture.actual, output)).status, 'idempotent');
  await assert.rejects(f.post(capture.actual, { ...output, isError: true }), error => error.code === 'duplicate');
  assert.equal((await getRun({ runDirectory: f.runDirectory })).observations.length, 1);

  const correct = await f.capture({ content: [{ type: 'image', mimeType: 'image/jpeg', data: jpegSignature.toString('base64') }] });
  assert.equal(correct.result.ok, true);
  assert.equal((await getRun({ runDirectory: f.runDirectory })).observations.at(-1).artifacts[0].declaredMimeType, undefined);
});

test('invalid image carriers retain a safe diagnosis and unresolved ownership', async t => {
  const cases = [
    ['unknown declared MIME', { type: 'image', mimeType: 'image/svg+xml', data: jpegSignature.toString('base64') }],
    ['invalid bytes', { type: 'image', mimeType: 'image/png', data: Buffer.from('fixture-private-provider-message').toString('base64') }],
    ['invalid base64', { type: 'image', mimeType: 'image/png', data: 'fixture-private-provider-message!' }],
    ['external URL', { type: 'input_image', image_url: 'https://example.invalid/fixture-private-provider-message.png' }],
    ['oversized image', { type: 'image', mimeType: 'image/png', data: 'A'.repeat(12 * 1024 * 1024 + 1) }],
  ];
  for (const [name, image] of cases) await t.test(name, async child => {
    const f = await fixture(child, true); await f.begin();
    const capture = await f.capture({ content: [image] });
    assert.equal(capture.result.status, 'recovery-required');
    const state = await getRun({ runDirectory: f.runDirectory }), attempt = state.attempts.at(-1);
    assert.equal(attempt.invocationObserved, true);
    assert.equal(state.observations.length, 0); assert.equal(state.evidence.length, 0);
    const diagnostic = safeAttemptDiagnostic(attempt);
    assert.equal(diagnostic.code, 'observation_invalid');
    assert.match(diagnostic.message, /host|observ|captur/i);
    assert.equal(JSON.stringify(diagnostic).includes('fixture-private-provider-message'), false);
    assert.equal(JSON.stringify({ failure: attempt.failure, failureDiagnostic: attempt.failureDiagnostic }).includes('fixture-private-provider-message'), false);
    assert.equal(await resolveRunDirectory(f.home, f.session), f.runDirectory);
  });
});

async function failedHostCapture(t, reviewed = false) {
  const f = await fixture(t, true); await f.begin();
  if (reviewed) await f.reachEvidence();
  const capture = await f.capture({ content: [{ type: 'image', mimeType: 'image/png', data: 'bm90LWFuLWltYWdl' }] });
  assert.equal(capture.result.status, 'recovery-required');
  await closeRun({ runDirectory: f.runDirectory, outcome: { status: 'blocked', reason: 'Capture persistence failed; preserve completed invocation', boundaryId: capture.p.id } });
  await registerHostSession({ home: f.home, event: { ...f.sessionEvent, sessionId: 'recovery-operator' } });
  const state = await getRun({ runDirectory: f.runDirectory });
  return { ...f, capture, attemptId: state.attempts.at(-1).id,
    recoveryInput: { home: f.home, runId: f.contract.id, sessionId: 'recovery-operator', attemptId: state.attempts.at(-1).id, reason: 'Close failed capture administratively; new run must capture fresh evidence' } };
}

test('explicit host recovery preserves blocked history, fails only the capture and enables a fresh successor', async t => {
  const f = await failedHostCapture(t, true);
  let before = await getRun({ runDirectory: f.runDirectory });
  // Simulate the legacy omission and obsolete runtime policy. Recovery must not
  // invent a historic failure cause or make an old permission current.
  delete before.attempts.at(-1).failure; delete before.attempts.at(-1).failureDiagnostic;
  before.policyHash = 'a'.repeat(64);
  for (const attempt of before.attempts) if (attempt.invocation) attempt.invocation.policyHash = before.policyHash;
  for (const permit of before.permits) if (permit.invocation) permit.invocation.policyHash = before.policyHash;
  await saveRun(f.runDirectory, before);
  before = await getRun({ runDirectory: f.runDirectory });
  assert.equal(before.plans.length, 1); assert.equal(before.reviews.length, 2);
  assert.equal(before.attempts.filter(a => a.expectedProcess && a.process.terminated && a.status === 'completed').length, 4);
  assert.equal(await resolveRunDirectory(f.home, f.session), f.runDirectory);
  const previousSession = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = 'recovery-operator';
  try {
    const receipt = await runGovernance(['recover-host-attempt', '--home', f.home, '--run', f.contract.id, '--input-json', JSON.stringify({ attemptId: f.attemptId, reason: f.recoveryInput.reason }), '--json']);
    assert.equal(receipt.code, 0, receipt.output);
    assert.equal(receipt.result.outcome.status, 'blocked');
  } finally {
    if (previousSession === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previousSession;
  }
  const after = await getRun({ runDirectory: f.runDirectory });
  for (const key of ['rootSessionId', 'coordinator', 'outcome', 'phase', 'reviews', 'plans', 'permits', 'eventKeys', 'observations', 'evidence', 'policyHash']) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.attempts.slice(0, -1), before.attempts.slice(0, -1));
  assert.equal(after.attempts.at(-1).status, 'failed');
  assert.equal(after.attempts.at(-1).failureDiagnostic, undefined);
  assert.equal(after.recoveryReceipts.length, 1);
  assert.equal(after.recoveryReceipts[0].originalSessionId, f.session);
  assert.equal(after.recoveryReceipts[0].operatorSessionId, 'recovery-operator');
  assert.equal(after.recoveryReceipts[0].attemptId, f.attemptId);
  assert.equal(after.recoveryReceipts[0].originalPolicyHash, before.policyHash);
  assert.match(after.recoveryReceipts[0].recoveryPolicyHash, /^[a-f0-9]{64}$/);
  assert.notEqual(after.recoveryReceipts[0].recoveryPolicyHash, before.policyHash);
  assert.equal(after.leasePreserved, false);
  assert.equal(await resolveRunDirectory(f.home, f.session), null);
  assert.equal((await readRegistry(f.home)).runs.recovery.finished, true);
  await assert.rejects(recoverHostAttempt(f.recoveryInput), error => error.code === 'duplicate');
  assert.equal((await getRun({ runDirectory: f.runDirectory })).recoveryReceipts.length, 1);
  await f.passive(); await f.passive('mcp__cua_repl__js', { code: 'await cua.getState();' }, imageOutput);
  const successor = await createRun({ home: f.home, contract: { ...f.contract, id: 'successor' }, activation: { sessionId: f.session } });
  assert.equal(successor.phase, 'intake'); assert.equal(successor.evidence.length, 0); assert.equal(successor.reviews.length, 0);
  assert.equal((await getRun({ runDirectory: f.runDirectory })).outcome.status, 'blocked');
});

test('host recovery refuses ambiguous invocation, ownership or acceptance without mutating retained state', async t => {
  const cases = [
    ['active run', s => { s.phase = 'evidence'; s.outcome = null; }],
    ['accepted run', s => { s.outcome.status = 'accepted'; }],
    ['process attempt', s => { s.attempts.at(-1).expectedProcess = true; }],
    ['process ownership', s => { s.attempts.at(-1).process = { terminated: false }; }],
    ['process binding', s => { s.attempts.at(-1).processBinding = {}; }],
    ['process launch', s => { s.attempts.at(-1).launch = {}; }],
    ['declared write', s => { s.attempts.at(-1).writeSet = ['candidate.txt']; }],
    ['declared lease path', s => { s.attempts.at(-1).leasePaths = ['candidate.txt']; }],
    ['changed path', s => { s.attempts.at(-1).changedPaths = ['candidate.txt']; }],
    ['live lease', s => { s.leases['candidate.txt'] = s.attempts.at(-1).id; }],
    ['other owner', s => { s.attempts.unshift({ id: 'other-owner', status: 'running', invocationObserved: true }); }],
    ['missing observed Post', s => { s.attempts.at(-1).invocationObserved = false; }],
    ['missing event receipt', s => { s.eventKeys = {}; }],
    ['invalid event hash', s => { const key = Object.keys(s.eventKeys).find(k => k.includes(':PostToolUse:')); s.eventKeys[key] = 'invalid'; }],
    ['uncompleted permit', s => { s.permits.at(-1).status = 'consumed'; }],
    ['duplicate permit', s => { s.permits.push(structuredClone(s.permits.at(-1))); }],
    ['mismatched invocation', s => { s.permits.at(-1).invocation.toolUseId = 'unrelated'; }],
    ['incoherent historical policy', s => { s.policyHash = 'a'.repeat(64); }],
    ['mismatched input', s => { s.permits.at(-1).toolInput = { code: 'unrelated' }; }],
    ['unreconciled scope', s => { s.attempts.at(-1).snapshotHash = 'b'.repeat(64); }],
    ['observation exists', s => { s.attempts.at(-1).observationId = 'existing-observation'; }],
    ['produced observation', s => { s.observations.push({ id: 'existing', attemptId: s.attempts.at(-1).id }); }],
    ['acceptance exists', s => { s.attempts.at(-1).acceptanceId = 'existing-acceptance'; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async child => {
    const f = await failedHostCapture(child), state = await getRun({ runDirectory: f.runDirectory });
    mutate(state); await saveRun(f.runDirectory, state);
    const before = await readFile(join(f.runDirectory, 'run.json'));
    await assert.rejects(recoverHostAttempt(f.recoveryInput));
    assert.deepEqual(await readFile(join(f.runDirectory, 'run.json')), before);
  });
  await t.test('different observed root', async child => {
    const f = await failedHostCapture(child);
    await registerHostSession({ home: f.home, event: { ...f.sessionEvent, sessionId: 'different-root', cwd: f.home } });
    await assert.rejects(recoverHostAttempt({ ...f.recoveryInput, sessionId: 'different-root' }), error => error.code === 'binding');
  });
});

test('audit keeps independent reviews and actual visual assessment; successful host calls and imported pass JSON do not pass criteria', async t => {
  const f = await fixture(t, true); await f.begin(); await f.reachEvidence();
  const textOnly = await f.capture({ content: [{ type: 'text', text: 'Browser call succeeded without an image.' }] });
  await assert.rejects(buildObservationAssessmentInput({ runDirectory: f.runDirectory, observationIds: [textOnly.result.observationId], criterionIds: ['C1'], requireImages: true }), error => error.code === 'observation_missing');
  const capture = await f.capture(); assert.equal(capture.result.ok, true); assert.equal(capture.result.productAcceptance, false);
  assert.equal((await getRun({ runDirectory: f.runDirectory })).evidence.length, 0);
  await assert.rejects(persistObservedToolOutput({ runDirectory: f.runDirectory, event: { kind: 'hook', ...capture.actual, tool_use_id: 'parent-import', hook_event_name: 'PostToolUse', tool_response: { kind: 'observation-assessment', results: [{ criterionId: 'C1', outcome: 'pass' }] } } }), error => error.code === 'observation_invalid');
  const assessment = { observationIds: [capture.result.observationId], criterionIds: ['C1'], requireImages: true };
  const bundle = await buildObservationAssessmentInput({ runDirectory: f.runDirectory, ...assessment });
  assert.equal((await stat(bundle.imagePaths[0])).mode & 0o777, 0o600);
  const assess = outcome => b => ({ kind: 'observation-assessment', manifestHash: b.manifestHash, candidateHash: b.candidateHash, observationRefs: b.observationRefs, results: [{ criterionId: 'C1', outcome, observationIds: assessment.observationIds, reason: outcome === 'fail' ? 'The observed failing product state does not meet C1.' : 'The independent fixture observation meets C1.' }] });
  await f.processOutput('verify', 'verifier', assess('fail'), { assessment });
  const dispatchRequest = f.requests.find(request => request.state.boundary.action === 'verify');
  assert.equal(dispatchRequest.state.run.taskKind, 'audit');
  assert.equal(dispatchRequest.state.criteria[0].evidenceKind, 'visual');
  assert.equal(dispatchRequest.state.completed.verificationDispatch.kind, 'observation-assessment');
  assert.equal(dispatchRequest.state.completed.verificationDispatch.bundle.manifestHash, bundle.manifestHash);
  assert.deepEqual(dispatchRequest.state.completed.verificationDispatch.bundle.imagePaths, bundle.imagePaths);
  assert.match(dispatchRequest.questions['obligation:approved_check_identity'].instructions, /independent observation assessment/);
  let state = await getRun({ runDirectory: f.runDirectory });
  assert.equal(state.evidence.at(-1).outcome, 'fail');
  assert.equal(state.attempts.some(a => a.role === 'writer'), false); assert.equal(state.reviews.length, 2);
  let close = await f.classified('close', 'coordinator');
  await assert.rejects(closeRun({ runDirectory: f.runDirectory, outcome: { status: 'accepted', reason: 'Attempt closure', boundaryId: close.id } }), /criterion:C1/);
  await f.processOutput('verify', 'verifier', assess('pass'), { assessment });
  const imageBytes = await readFile(bundle.imagePaths[0]); await writeFile(bundle.imagePaths[0], 'tampered');
  await assert.rejects(buildObservationAssessmentInput({ runDirectory: f.runDirectory, ...assessment }), error => error.code === 'observation_invalid');
  close = await f.classified('close', 'coordinator');
  await assert.rejects(closeRun({ runDirectory: f.runDirectory, outcome: { status: 'accepted', reason: 'Reject missing authentic assets', boundaryId: close.id } }), /criterion:C1/);
  await writeFile(bundle.imagePaths[0], imageBytes);
  close = await f.classified('close', 'coordinator');
  state = await closeRun({ runDirectory: f.runDirectory, outcome: { status: 'accepted', reason: 'Independent fixture assessment complete', boundaryId: close.id } });
  assert.equal(state.outcome.status, 'accepted');
  t.diagnostic('Model identity is explicitly simulated. Process PIDs/exits, image arguments, artifact bytes and criterion acceptance transitions are exercised locally. This is not host certification.');
});

test('unfinished host ownership remains active even if finished registry metadata is stale', async t => {
  const f = await fixture(t, true); await f.begin();
  const p = await f.classified('host-tool', 'coordinator', { toolName: 'mcp__cua_repl__js', toolInput: { code: 'await cua.getState();' } });
  await f.permit(p);
  await closeRun({ runDirectory: f.runDirectory, outcome: { status: 'interrupted', reason: 'Host still unresolved', boundaryId: p.id } });
  const registry = await readRegistry(f.home); registry.runs.recovery.finished = true; await writeRegistry(f.home, registry);
  assert.equal(await resolveRunDirectory(f.home, f.session), f.runDirectory);
  await assert.rejects(recoverUnstartedRun({ home: f.home, runId: 'recovery', sessionId: f.session, reason: 'Cannot discard ownership' }), error => error.code === 'recovery_ownership');
  await assert.rejects(createRun({ home: f.home, contract: { ...f.contract, id: 'unsafe-new' }, activation: { sessionId: f.session } }), error => error.code === 'binding');
});

test('mixed check and visual criteria require separate actual producers and aggregate only at closure', async t => {
  const f = await fixture(t, true);
  f.contract.criteria.push({ id: 'C2', ticketId: 'T1', requirement: 'Candidate exact content is current', evidenceRequired: 'Approved assertion check', evidenceKind: 'check' });
  await writeFile(join(f.root, 'check.mjs'), 'import assert from "node:assert/strict"; import fs from "node:fs"; assert.equal(fs.readFileSync("candidate.txt", "utf8"), "current candidate");\n');
  await f.begin(); await f.reachEvidence();
  const capture = await f.capture();
  await assert.rejects(buildObservationAssessmentInput({ runDirectory: f.runDirectory, observationIds: [capture.result.observationId], criterionIds: ['C2'], requireImages: false }), /cannot substitute/);
  const assessment = { observationIds: [capture.result.observationId], criterionIds: ['C1'], requireImages: true };
  await f.processOutput('verify', 'verifier', b => ({ kind: 'observation-assessment', manifestHash: b.manifestHash, candidateHash: b.candidateHash, observationRefs: b.observationRefs, results: [{ criterionId: 'C1', outcome: 'pass', observationIds: assessment.observationIds, reason: 'Independent fixture assessment of C1 image' }] }), { requirementIds: ['C1'], assessment });
  let close = await f.classified('close', 'coordinator');
  await assert.rejects(closeRun({ runDirectory: f.runDirectory, outcome: { status: 'accepted', reason: 'Check still required', boundaryId: close.id } }), /criterion:C2/);
  await f.processOutput('verify', 'verifier', '', { requirementIds: ['C2'], check: { executable: process.execPath, argv: ['check.mjs'] } });
  close = await f.classified('close', 'coordinator');
  const accepted = await closeRun({ runDirectory: f.runDirectory, outcome: { status: 'accepted', reason: 'Both actual producers supplied current evidence', boundaryId: close.id } });
  assert.equal(accepted.tickets[0].status, 'accepted');
  assert.deepEqual(accepted.evidence.map(e => [e.criterionId, e.kind]), [['C1', 'observation-assessment'], ['C2', 'verification']]);
});

test('observed Bash mapping rejects unobserved native wrappers and concurrent read processes remain permitted while CU is exclusive', async t => {
  const f = await fixture(t, true); await f.begin();
  const mismatch = await f.proposal('inspect', 'coordinator', { toolName: 'exec_command', toolInput: { cmd: 'pwd' } });
  const rejected = await classifyBoundary({ runDirectory: f.runDirectory, proposal: mismatch, transport, env });
  assert.equal(rejected.code, 'host_tool_mapping'); assert.equal(rejected.transportAttempted, false);
  const intake = await f.classified('intake-review', 'coordinator');
  await advancePhase({ runDirectory: f.runDirectory, transition: { to: 'research', reason: 'Ready', boundaryId: intake.id } });
  async function dispatch(id) {
    const p = await f.classified('research-dispatch', 'researcher', { attemptId: id, toolName: 'Bash', toolInput: { command: `node '${cli}' execute --home '${f.home}' --input-json '{"attemptId":"${id}"}'` } });
    await f.permit(p);
  }
  await dispatch('parallel-one'); await dispatch('parallel-two');
  assert.equal((await getRun({ runDirectory: f.runDirectory })).attempts.filter(a => a.status === 'running').length, 2);
  const cu = await f.classified('host-tool', 'coordinator', { toolName: 'mcp__cua_repl__js', toolInput: { code: 'await cua.getState();' } });
  await assert.rejects(prepareAction({ runDirectory: f.runDirectory, boundaryId: cu.id, action: { actorId: f.session, attemptId: null, toolName: cu.toolName, toolInput: cu.toolInput } }), error => error.code === 'overlap');
});

test('runtime-byte changes invalidate passive observations without modifying operator or repository runtime', async t => {
  const f = await fixture(t); await f.passive();
  const runtimeCopy = join(f.home, 'isolated-runtime');
  await cp(fileURLToPath(new URL('../runtime/jev-governance', import.meta.url)), runtimeCopy, { recursive: true });
  const changed = join(runtimeCopy, 'policy.mjs');
  await writeFile(changed, `${await readFile(changed, 'utf8')}\n// isolated updated policy bytes\n`);
  const script = join(f.home, 'preflight-probe.mjs');
  await writeFile(script, `import { preflightRun } from ${JSON.stringify(new URL(`file://${join(runtimeCopy, 'core.mjs')}`).href)};\nconst result = await preflightRun(${JSON.stringify({ home: f.home, contract: f.contract, activation: { sessionId: f.session } })}); process.stdout.write(JSON.stringify(result));\n`);
  const result = JSON.parse((await exec(process.execPath, [script])).stdout);
  assert.equal(result.ready, false); assert.deepEqual(result.missingCapabilities, ['shell']);
});

test('plan returns expose the actual dependency-bound artifact and reject wrong, unbound or stale producer evidence before Jev', async t => {
  const f = await fixture(t, true); await f.begin();
  const intake = await f.classified('intake-review', 'coordinator');
  await advancePhase({ runDirectory: f.runDirectory, transition: { to: 'research', reason: 'Start research', boundaryId: intake.id } });
  const research = await f.processOutput('research-dispatch', 'researcher', 'C1 is visual; independently assess actual negative and positive images.');
  const returnedResearch = await f.classified('research-return', 'coordinator', { dependsOn: [research] });
  await advancePhase({ runDirectory: f.runDirectory, transition: { to: 'plan', reason: 'Research complete', boundaryId: returnedResearch.id } });
  const planner = await f.processOutput('plan-author', 'planner', { kind: 'plan', summary: 'C1: obtain independent plan and final reviews, capture actual Pending and Verified states, independently assess each exact image and close only with current passing evidence. No images or product acceptance exist yet.', criterionIds: ['C1'], packets: [{ id: 'review-and-observe', readSet: ['candidate.txt'], writeSet: [], dependsOn: [] }] });
  const proposal = await f.proposal('plan-return', 'coordinator', { dependsOn: [planner] });
  let request;
  const result = await classifyBoundary({ runDirectory: f.runDirectory, proposal, env, transport: async value => { request = JSON.parse(value.body); return transport(value); } });
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(request.state.completed.requiredDependencyIds, [planner]);
  const dependency = request.state.completed.dependencies.find(item => item.id === planner);
  const reference = request.state.completed.returnedArtifactRefs[0];
  const artifact = request.state.completed.plans.find(item => item.id === reference.id && item.kind === reference.kind);
  assert.equal(request.state.completed.returnedArtifactRefs.length, 1);
  assert.equal(Object.hasOwn(request.state.completed, 'returnedArtifacts'), false);
  assert.equal(Object.hasOwn(request.state.completed, 'requiredDependencies'), false);
  assert.equal(dependency.role, 'planner'); assert.equal(dependency.acceptanceId, artifact.id);
  assert.equal(artifact.attemptId, planner); assert.equal(artifact.role, 'planner'); assert.equal(artifact.source, 'process-output'); assert.equal(artifact.current, true);
  assert.equal(artifact.actorId, dependency.actorId); assert.equal(artifact.sessionId, dependency.sessionId); assert.equal(artifact.boundaryId, dependency.boundaryId);
  assert.deepEqual(artifact.criterionIds, ['C1']); assert.deepEqual(request.state.completed.verifications, []);
  assert.equal(request.state.run.taskKind, 'audit'); assert.equal(request.state.criteria[0].evidenceKind, 'visual');
  const original = await getRun({ runDirectory: f.runDirectory });
  let calls = 0;
  const shouldNotCall = async () => { calls++; throw Error('Invalid returned provenance reached classifier'); };
  for (const [label, mutate] of [
    ['wrong-producer', run => { run.plans[0].attemptId = 'different-planner'; }],
    ['unbound-artifact', run => { run.attempts.find(a => a.id === planner).acceptanceId = 'unbound-plan'; }],
    ['wrong-kind', run => { run.plans[0].kind = 'verification'; }],
    ['stale-artifact', run => { run.plans[0].stamp.sources[0].sha256 = '0'.repeat(64); }],
  ]) {
    const candidate = structuredClone(original); mutate(candidate); await saveRun(f.runDirectory, candidate);
    const rejected = await classifyBoundary({ runDirectory: f.runDirectory, proposal: { ...proposal, id: label }, env, transport: shouldNotCall });
    assert.equal(rejected.verdict, 'insufficient', label); assert.equal(rejected.transportAttempted, false, label);
  }
  assert.equal(calls, 0);
  await saveRun(f.runDirectory, original);
  await assert.rejects(classifyBoundary({ runDirectory: f.runDirectory, proposal: { ...proposal, id: 'concurrent-artifact-change' }, env, transport: async value => {
    const changed = await getRun({ runDirectory: f.runDirectory }); changed.plans[0].summary = 'Different plan after request'; await saveRun(f.runDirectory, changed);
    return transport(value);
  } }), error => error.code === 'stale');
});

test('approved control boundaries remain usable dependencies while unresolved or stale judgment bindings stop before transport', async t => {
  const f = await fixture(t); await f.begin();
  const prerequisite = await f.classified('intake-review', 'coordinator');
  const original = await getRun({ runDirectory: f.runDirectory });
  const boundary = original.boundaries.find(entry => entry.id === prerequisite.id);
  const judgment = original.judgments.find(entry => entry.id === boundary.judgmentId);
  const proposal = await f.proposal('intake-review', 'coordinator', { dependsOn: [prerequisite.id] });
  let calls = 0;
  for (const [label, mutate] of [
    ['missing-boundary', run => { run.boundaries = []; }],
    ['ambiguous-boundary', run => { run.boundaries.push(structuredClone(boundary)); }],
    ['missing-judgment', run => { run.judgments = []; }],
    ['ambiguous-judgment', run => { run.judgments.push(structuredClone(judgment)); }],
    ['unapproved-judgment', run => { run.judgments[0].verdict = 'insufficient'; }],
    ['wrong-boundary-binding', run => { run.judgments[0].boundaryId = 'other-boundary'; }],
    ['wrong-run-binding', run => { run.judgments[0].runId = 'other-run'; }],
    ['stale-input-binding', run => { run.judgments[0].inputHash = '0'.repeat(64); }],
  ]) {
    const candidate = structuredClone(original); mutate(candidate); await saveRun(f.runDirectory, candidate);
    const rejected = await classifyBoundary({ runDirectory: f.runDirectory, proposal: { ...proposal, id: label }, env, transport: async () => { calls++; throw Error('Unresolved boundary reached transport'); } });
    assert.equal(rejected.verdict, 'insufficient', label);
    assert.equal(rejected.code, 'context_unavailable', label); assert.equal(rejected.transportAttempted, false, label);
  }
  assert.equal(calls, 0);
  await saveRun(f.runDirectory, original);
  let request;
  const approved = await classifyBoundary({ runDirectory: f.runDirectory, proposal, env, transport: async value => { request = JSON.parse(value.body); return transport(value); } });
  assert.equal(approved.verdict, 'pass');
  assert.deepEqual(request.state.completed.requiredDependencyIds, [prerequisite.id]);
  assert.deepEqual(request.state.completed.dependencies, [{ id: prerequisite.id, kind: 'boundary', boundary, judgment }]);
  assert.deepEqual(request.state.completed.returnedArtifactRefs, []);
  const advanced = await advancePhase({ runDirectory: f.runDirectory, transition: { to: 'research', reason: 'Approved exact boundary dependency retained', boundaryId: proposal.id } });
  assert.equal(advanced.phase, 'research');
  assert.deepEqual(advanced.boundaries.find(entry => entry.id === prerequisite.id), boundary);
  assert.deepEqual(advanced.judgments.find(entry => entry.id === judgment.id), judgment);
});

test('historical status exposes complete ordered plan packets and producer references without mutating closed blocked state', async t => {
  const f = await fixture(t); await f.begin();
  const intake = await f.classified('intake-review', 'coordinator');
  await advancePhase({ runDirectory: f.runDirectory, transition: { to: 'research', reason: 'Start exact fixture research', boundaryId: intake.id } });
  const research = await f.processOutput('research-dispatch', 'researcher', 'C1 requires exact candidate.txt inspection and a subsequent independent review.');
  const returned = await f.classified('research-return', 'coordinator', { dependsOn: [research] });
  await advancePhase({ runDirectory: f.runDirectory, transition: { to: 'plan', reason: 'Research retained', boundaryId: returned.id } });
  const packets = [
    { id: 'inspect', readSet: ['spec.md', 'candidate.txt'], writeSet: [], dependsOn: [] },
    { id: 'review', readSet: ['candidate.txt'], writeSet: ['review-notes.md'], dependsOn: ['inspect'] },
  ];
  const planner = await f.processOutput('plan-author', 'planner', { kind: 'plan', summary: 'Inspect C1 and independently review all recorded evidence. COMPLETE PLAN TAIL', criterionIds: ['C1'], packets });
  await closeRun({ runDirectory: f.runDirectory, outcome: { status: 'blocked', reason: 'Independent review remains pending', boundaryId: 'retained-status-fixture' } });
  const before = await getRun({ runDirectory: f.runDirectory });
  const runPath = join(f.runDirectory, 'run.json'), registryPath = join(f.home, '.development-system/governance/registry.json');
  const runBytes = await readFile(runPath), registryBytes = await readFile(registryPath);
  const receipt = await runGovernance(['status', '--home', f.home, '--run', f.contract.id, '--json']);
  assert.equal(receipt.code, 0, receipt.output);
  const status = JSON.parse(receipt.output), storedPlan = before.plans[0];
  assert.deepEqual(Object.keys(status.coordinator).sort(), ['actorId', 'model', 'provider', 'reasoning', 'role', 'sessionId']);
  assert.equal(status.phase, 'closed'); assert.equal(status.outcome.status, 'blocked');
  assert.equal(status.revision, before.revision); assert.equal(status.plans.length, 1);
  assert.equal(status.plans[0].attemptId, planner);
  assert.deepEqual(status.plans[0], {
    id: storedPlan.id, actorId: storedPlan.actorId, attemptId: storedPlan.attemptId, boundaryId: storedPlan.boundaryId,
    candidateHash: storedPlan.candidateHash, source: storedPlan.source, summary: storedPlan.summary,
    criterionIds: ['C1'], invalidated: false, packets,
  });
  for (const packet of status.plans[0].packets) assert.deepEqual(Object.keys(packet).sort(), ['dependsOn', 'id', 'readSet', 'writeSet']);
  assert.equal(storedPlan.command.executable.endsWith('fixture-provider'), true, 'the retained artifact contains private process details');
  assert.equal(receipt.output.includes(storedPlan.command.executable), false);
  assert.equal(receipt.output.includes(f.sessionEvent.transcriptPath), false);
  assert.deepEqual(await readFile(runPath), runBytes);
  assert.deepEqual(await readFile(registryPath), registryBytes);
  assert.deepEqual(await getRun({ runDirectory: f.runDirectory }), before);
});

test('malformed review preserves exact rejected findings and safe field diagnostics; correction context separates terminated failure from acceptance', async t => {
  const f = await fixture(t, true); await f.begin();
  const rejected = { kind: 'review', verdict: 'revise', criterionIds: ['C1'], findings: [
    { id: 'R1', criterionIds: ['C1'], severity: 'medium', message: 'The required reviewed plan was not supplied; retain this missing-context finding.' },
    { id: 'R2', criterionIds: ['C1'], severity: 'info', message: 'Static notes are not visual acceptance. PRIVATE_PROVIDER_NOTE' },
  ] };
  const attemptId = await f.reachEvidence({ finalOutput: rejected, expectedFinalOk: false });
  const run = await getRun({ runDirectory: f.runDirectory }), failed = run.attempts.find(a => a.id === attemptId);
  assert.equal(failed.status, 'failed'); assert.equal(failed.acceptanceId, undefined);
  assert.equal(failed.failureDiagnostic.field, 'review.findings[1].severity');
  const outputPath = join(f.runDirectory, failed.rejectedOutput.relativePath);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), rejected);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.equal(run.reviews.some(r => r.kind === 'final-review'), false); assert.equal(run.findings.length, 0);
  const status = await runGovernance(['status', '--home', f.home, '--run', f.contract.id, '--json']);
  assert.equal(status.code, 0);
  const diagnostic = status.result.attempts.find(a => a.id === attemptId).failureDiagnostic;
  assert.equal(diagnostic.field, 'review.findings[1].severity');
  assert.deepEqual(diagnostic.expectedValues, ['blocking', 'blocker', 'high', 'medium', 'low']);
  assert.equal(status.output.includes('PRIVATE_PROVIDER_NOTE'), false);
  const correction = await f.proposal('correct', 'coordinator', { objective: 'Supply the missing reviewed plan and exact severity grammar to a fresh independent reviewer, retaining every actual finding.' });
  let request;
  const classified = await classifyBoundary({ runDirectory: f.runDirectory, proposal: correction, env, transport: async value => { request = JSON.parse(value.body); return transport(value); } });
  assert.equal(classified.verdict, 'pass');
  const recovery = request.state.completed.correctionState;
  assert.equal(recovery.phase, 'final-review'); assert.equal(recovery.correctionAllowed, true);
  assert.ok(recovery.allowedActions.includes('final-review'));
  assert.deepEqual(recovery.activeAttemptIds, []); assert.deepEqual(recovery.leaseOwners, []);
  assert.deepEqual(recovery.retryEligibleAttemptIds, [attemptId]);
  assert.equal(recovery.prerequisites[0].kind, 'plan-review-pass'); assert.equal(recovery.prerequisites[0].satisfied, true);
  assert.equal(recovery.failedAttempts[0].failureDiagnostic.field, 'review.findings[1].severity');
  assert.equal(recovery.executionPermissionGranted, false); assert.equal(recovery.acceptanceImported, false);
  assert.equal((await getRun({ runDirectory: f.runDirectory })).attempts.find(a => a.id === attemptId).status, 'failed');
  await assert.rejects(classifyBoundary({ runDirectory: f.runDirectory, proposal: { ...correction, id: 'ownership-changed' }, env, transport: async value => {
    const concurrent = await getRun({ runDirectory: f.runDirectory }); concurrent.leases['candidate.txt'] = 'another-owner'; await saveRun(f.runDirectory, concurrent);
    return transport(value);
  } }), error => error.code === 'stale');
});

test('an exact existing-issue update traverses the actual hook adapter and cannot be replayed', async t => {
  const f = await fixture(t);
  const toolName = 'mcp__linear__save_issue', toolInput = { id: 'FIXTURE-1', state: 'Backlog' };
  const response = { content: [{ type: 'text', text: '{"id":"FIXTURE-1","status":"Backlog"}' }] };
  f.contract.requiredCapabilities.push('linear-write');
  await f.passive(toolName, toolInput, response);
  await f.begin();
  const p = await f.classified('host-tool', 'coordinator', { toolName, toolInput });
  await prepareAction({ runDirectory: f.runDirectory, boundaryId: p.id, action: { actorId: f.session, attemptId: null, toolName, toolInput } });
  const event = f.event(toolName, toolInput);
  const transcript = f.sessionEvent.transcriptPath;
  await writeFile(transcript, [
    JSON.stringify({ type: 'session_meta', payload: { id: f.session } }),
    JSON.stringify({ type: 'turn_context', payload: { turn_id: event.turn_id, model: event.model, effort: event.reasoning, cwd: f.root } }),
  ].join('\n') + '\n');
  const actual = { ...event, transcript_path: transcript };
  assert.deepEqual(await handleHook({ ...actual, hook_event_name: 'PreToolUse' }, { home: f.home }), {});
  assert.deepEqual(await handleHook({ ...actual, hook_event_name: 'PostToolUse', tool_response: response }, { home: f.home }), {});
  const run = await getRun({ runDirectory: f.runDirectory });
  assert.equal(run.attempts.at(-1).status, 'completed');
  assert.equal(run.observations.at(-1).adapter.capability, 'linear-write');
  assert.equal(run.evidence.length, 0, 'Transport completion is not product acceptance');
  assert.equal((await handleHook({ ...actual, hook_event_name: 'PreToolUse' }, { home: f.home })).hookSpecificOutput.permissionDecision, 'deny');
});
