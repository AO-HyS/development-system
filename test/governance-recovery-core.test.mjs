import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { advancePhase, authorizeAction, bindProcessCandidate, buildObservationAssessmentInput, classifyBoundary, closeRun, createRun, getRun, persistObservedToolOutput, preflightRun, prepareAction, recordHostEvent, recordPassiveToolObservation, recoverUnstartedRun, registerHostSession, resolveRunDirectory } from '../runtime/jev-governance/core.mjs';
import { readRegistry, saveRun, writeRegistry } from '../runtime/jev-governance/store.mjs';
import { handleHook } from '../runtime/jev-governance/hook.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../runtime/jev-governance/cli.mjs', import.meta.url));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=';
const imageOutput = { content: [{ type: 'text', text: 'Observed product still displays the failing state.' }, { type: 'image', mimeType: 'image/png', data: png }] };
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
    const { requirementIds = contract.criteria.map(c => c.id), ...descriptor } = extra;
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
    assert.equal(result.ok, true, result.reason); return attemptId;
  }
  async function advance(action, to, dependsOn = []) {
    const p = await classified(action, 'coordinator', { dependsOn });
    return advancePhase({ runDirectory, transition: { to, boundaryId: p.id, reason: 'Current independent role output' } });
  }
  async function reachEvidence() {
    const criterionIds = contract.criteria.map(c => c.id);
    await advance('intake-review', 'research');
    const research = await processOutput('research-dispatch', 'researcher', 'C1 uses candidate.txt and exact observed assets. No hidden context.');
    await advance('research-return', 'plan', [research]);
    const plan = await processOutput('plan-author', 'planner', { kind: 'plan', summary: 'Audit every criterion with current assets and independent review', criterionIds, packets: [{ id: 'audit', readSet: ['candidate.txt'], writeSet: [], dependsOn: [] }] });
    await advance('plan-return', 'plan-review', [plan]);
    const review = await processOutput('plan-review', 'plan-reviewer', { kind: 'review', verdict: 'pass', findings: [], criterionIds });
    await advance('plan-review-return', 'final-review', [review]);
    const final = await processOutput('final-review', 'reviewer', { kind: 'review', verdict: 'pass', findings: [], criterionIds });
    await advance('final-review-return', 'evidence', [final]);
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
  const dependency = request.state.completed.requiredDependencies[0], artifact = request.state.completed.returnedArtifacts[0];
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
