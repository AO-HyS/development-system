import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { bindProcessCandidate, createRun, classifyBoundary, prepareAction, authorizeAction, recordHostEvent, advancePhase, closeRun, getRun, registerHostSession } from '../runtime/jev-governance/core.mjs';
const exec = promisify(execFile);
test('observed lifecycle accepts a corrected candidate and rejects stale, replayed, and unattributed work', { timeout: 60000 }, async (t) => {
  const children = new Set();
  const base = await realpath(await mkdtemp(join(tmpdir(), 'governance-lifecycle-')));
  t.after(async () => {
    await Promise.all([...children].map(async child => {
      const exited = once(child, 'close');
      child.kill('SIGKILL');
      await exited;
    }));
    await rm(base, { recursive: true, force: true });
  });
  const home = join(base, 'home'), root = join(base, 'repo');
  await mkdir(join(root, 'src'), { recursive: true }); await mkdir(home);
  await mkdir(join(root, 'checks'));
  await writeFile(join(root, 'checks/value.mjs'), 'import assert from "node:assert/strict"; import { value } from "../src/value.mjs"; assert.equal(value, process.argv.includes("--expect-wrong-value") ? 999 : 3);\n');
  await writeFile(join(root, 'spec.md'), 'C1: Export the corrected value 3. Run checks/value.mjs and observe exit zero. Local accepted is the authorized endpoint.\n');
  await writeFile(join(root, 'src/value.mjs'), 'export const value = 1;\n');
  await writeFile(join(root, 'src/other.mjs'), 'export const other = 1;\n');
  await exec('git', ['init', '-q', root]);
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base'], { cwd: root });
  const sha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const provider = join(base, 'fixture-provider');
  await writeFile(provider, '#!/usr/bin/env node\nimport fs from "node:fs"; for(const [path,content] of Object.entries(JSON.parse(process.env.FIXTURE_EXPECT ?? "{}"))) if(fs.readFileSync(path,"utf8")!==content) throw Error("Missing dependency content"); if(process.env.FIXTURE_WRITE) fs.writeFileSync(process.env.FIXTURE_WRITE,process.env.FIXTURE_CONTENT); process.stdout.write(process.env.FIXTURE_OUTPUT ?? "Observed fixture return.");\n'); await chmod(provider, 0o700);
  const cli = fileURLToPath(new URL('../runtime/jev-governance/cli.mjs', import.meta.url));
  const session = 'root-fixture';
  await registerHostSession({ home, event: { kind: 'session', sessionId: session, model: 'gpt-5.6-sol', reasoning: 'high', cwd: root, transcriptPath: join(base, 'synthetic-transcript.jsonl') } });
  const contract = { id: 'full-lifecycle', root, baseSha: sha, endpoint: 'local accepted', authorization: 'Implement and verify the isolated lifecycle fixture locally.', sources: [{ id: 'spec', path: 'spec.md', kind: 'spec' }], tickets: [{ id: 'T1', dependsOn: [] }], criteria: [{ id: 'C1', ticketId: 'T1', requirement: 'Export the corrected value 3', evidenceRequired: 'Approved value assertion process exit zero' }], capacity: { total: 4, providers: { codex: 2, 'opencode-go': 2, local: 1 } } };
  await createRun({ home, contract, activation: { sessionId: session } });
  const runDirectory = join(home, '.development-system/governance/runs/full-lifecycle');
  const route = (role) => role === 'coordinator' ? { role, provider: 'codex', model: 'gpt-5.6-sol', reasoning: 'high', capabilities: [] }
    : role === 'writer' ? { role, provider: 'opencode-go', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'high', capabilities: [] }
    : role === 'verifier' ? { role, provider: 'local', model: 'deterministic-check', reasoning: null, capabilities: ['exact-check'] }
    : { role, provider: 'codex', model: role === 'researcher' ? 'gpt-5.6-luna' : 'gpt-6-astra', reasoning: role === 'researcher' ? 'high' : 'xhigh', capabilities: [] };
  const transport = async ({ body }) => {
    const request = JSON.parse(body); const answers = {};
    for (const [key, question] of Object.entries(request.questions)) {
      const labels = Object.keys(question.criteria); const choice = key === 'route' ? request.state.boundary.route.role : key === 'tool' ? 'compliant' : key === 'priority' ? 'execute_now' : 'satisfied';
      answers[key] = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(labels.map(label => [label, label === choice ? 1 : 0])) };
    }
    return { model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 1 }, answers };
  };
  let number = 0;
  async function classify(id, action, role = 'coordinator', options = {}) {
    const run = await getRun({ runDirectory });
    const proposal = { id, phase: run.phase, action, actorId: session, attemptId: null, objective: `Perform ${action} covering C1 and local accepted.`, requirementIds: ['C1'], sourceIds: ['spec'], readSet: ['spec.md', 'src/value.mjs'], writeSet: [], dependsOn: [], route: route(role), toolName: 'governance', toolInput: {}, evidenceRefs: [], observations: ['The retained endpoint is local accepted. All criteria and exact required checks are covered.'], ...options };
    const result = await classifyBoundary({ runDirectory, proposal, transport, env: { TYPESAFE_API_KEY: 'fixture-only-not-a-secret' } });
    assert.equal(result.verdict, 'pass', `${id}: ${result.reason}`); return proposal;
  }
  async function prepare(proposal) { return prepareAction({ runDirectory, boundaryId: proposal.id, action: { actorId: session, attemptId: proposal.attemptId, toolName: proposal.toolName, toolInput: proposal.toolInput } }); }
  function pre(proposal) { number++; return { session_id: session, turn_id: `turn-${number}`, tool_use_id: `use-${number}`, hook_event_name: 'PreToolUse', model: 'gpt-5.6-sol', cwd: root, tool_name: proposal.toolName, tool_input: proposal.toolInput }; }
  async function post(event) { return recordHostEvent({ home, event: { kind: 'hook', ...event, hook_event_name: 'PostToolUse', tool_response: 'Actual fixture tool completion.' } }); }
  async function dispatch(id, action, role, options = {}) {
    const candidateRoot = options.candidateRoot ?? root;
    const launch = { attemptId: id, ...(role === 'writer' ? { candidateRoot } : {}), ...(role === 'verifier' ? { check: options.check ?? { executable: process.execPath, argv: ['checks/value.mjs'] } } : {}) };
    const proposal = await classify(`boundary-${id}`, action, role, { attemptId: id, dependsOn: options.dependsOn ?? [], readSet: options.readSet ?? ['spec.md', 'src/value.mjs', ...(role === 'verifier' ? ['checks/value.mjs'] : [])], writeSet: options.writeSet ?? [], toolName: 'Bash', toolInput: { command: `node '${cli}' execute --home '${home}' --input-json '${JSON.stringify(launch)}'` } });
    await prepare(proposal); const event = pre(proposal);
    assert.equal((await authorizeAction({ home, preToolEvent: event })).decision, 'allow');
    return { id, proposal, event, candidateRoot, launch };
  }
  async function finish(packet, output, options = {}) {
    const profile = packet.proposal.route;
    const command = profile.provider === 'local' ? packet.launch.check : { executable: provider, argv: profile.role === 'writer'
      ? ['run', '--model', profile.model, '--variant', profile.reasoning, '--pure']
      : ['exec', '--model', profile.model, '--sandbox', 'read-only', '-c', `model_reasoning_effort="${profile.reasoning}"`] };
    await bindProcessCandidate({ runDirectory, attemptId: packet.id, candidateRoot: packet.candidateRoot, command });
    const child = spawn(command.executable, command.argv, { cwd: packet.candidateRoot, env: { PATH: process.env.PATH, FIXTURE_EXPECT: JSON.stringify(options.expected ?? {}), FIXTURE_OUTPUT: typeof output === 'string' ? output : JSON.stringify(output), ...(options.write ? { FIXTURE_WRITE: join(packet.candidateRoot, options.write), FIXTURE_CONTENT: options.content } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.once('close', () => children.delete(child));
    child.stderr.resume();
    let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; });
    const completed = new Promise((done, reject) => { child.on('error', reject); child.on('close', code => done(code)); });
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    const common = { attemptId: packet.id, processId: String(child.pid), candidateRoot: packet.candidateRoot, command };
    assert.equal((await recordHostEvent({ home, event: { kind: 'process-start', ...common, provider: 'unknown', model: 'unknown', reasoning: 'unknown' } })).status, 'identity-pending');
    const exitCode = await completed;
    assert.equal(exitCode, options.expectedExit ?? 0, `Actual OS exit for ${packet.id}`);
    const exit = { kind: 'process-exit', ...common, provider: profile.provider, model: options.unknown ? 'unknown' : profile.model, reasoning: profile.reasoning, processSessionId: `process-session-${packet.id}`, exitCode, terminated: true, output: stdout, changedPaths: options.write ? [options.write] : [] };
    if (options.wrongPid) await assert.rejects(recordHostEvent({ home, event: { ...exit, processId: 'wrong-pid' } }), /PID/);
    const result = await recordHostEvent({ home, event: exit });
    await post(packet.event);
    return result;
  }
  async function returned(id, action, dependencies, to) { const proposal = await classify(id, action, 'coordinator', { dependsOn: dependencies }); if (to) await advancePhase({ runDirectory, transition: { to, reason: `Observed ${action}`, boundaryId: proposal.id } }); return proposal; }
  async function candidate(name) { const directory = join(base, name); await exec('git', ['clone', '-q', root, directory]); return realpath(directory); }
  async function integrate(id, writer, next = 'final-review') {
    const proposal = await classify(id, 'integrate', 'coordinator', { attemptId: id, dependsOn: [writer.id], writeSet: ['src/value.mjs'], toolName: 'apply_patch', toolInput: { patch: '*** Begin Patch\n*** Update File: src/value.mjs\n@@\n-old\n+new\n*** End Patch' } });
    await prepare(proposal); const event = pre(proposal); assert.equal((await authorizeAction({ home, preToolEvent: event })).decision, 'allow');
    await writeFile(join(root, 'src/value.mjs'), await readFile(join(writer.candidateRoot, 'src/value.mjs')));
    assert.equal((await post(event)).status, 'completed');
    await returned(`returned-${id}`, 'integration-return', [id], next);
  }

  // No state files are edited. Only exported governance APIs and real OS process
  // starts/exits are used. Model identity is an explicit fixture simulation; this
  // example makes no live-provider certification claim.
  const intake = await classify('intake', 'intake-review');
  await advancePhase({ runDirectory, transition: { to: 'research', reason: 'Intake passed', boundaryId: intake.id } });
  const research = await dispatch('research', 'research-dispatch', 'researcher');
  assert.equal((await authorizeAction({ home, preToolEvent: research.event })).decision, 'deny');
  await assert.rejects(recordHostEvent({ home, event: { kind: 'hook', ...research.event, hook_event_name: 'PostToolUse', tool_use_id: 'wrong' } }), /exact consumed/);
  const researchObservation = { kind: 'research', criterionIds: ['C1'], findings: ['The existing export is defined in src/value.mjs.'] };
  await finish(research, researchObservation, { wrongPid: true });
  const researched = await getRun({ runDirectory });
  assert.equal(researched.attempts.find(attempt => attempt.id === 'research').returnedObservation, JSON.stringify(researchObservation));
  assert.equal(researched.plans.length, 0);
  assert.equal(researched.reviews.length, 0);
  assert.equal(researched.verifications.length, 0);
  await returned('research-return', 'research-return', ['research'], 'plan');
  const planner = await dispatch('planner', 'plan-author', 'planner');
  await finish(planner, { kind: 'plan', summary: 'Change value and run the actual value assertion.', criterionIds: ['C1'], packets: [{ id: 'P1', readSet: ['spec.md'], writeSet: ['src/value.mjs'], dependsOn: [] }] });
  await returned('plan-return', 'plan-return', ['planner'], 'plan-review');
  const planReview = await dispatch('plan-reviewer', 'plan-review', 'plan-reviewer');
  await finish(planReview, { kind: 'review', verdict: 'pass', findings: [], criterionIds: ['C1'] });
  await returned('plan-review-return', 'plan-review-return', ['plan-reviewer'], 'implementation');

  // Registered unsupported descendants never become accidentally ungoverned.
  await recordHostEvent({ home, event: { kind: 'hook', session_id: session, hook_event_name: 'SubagentStart', agent_id: 'child', parent_session_id: session } });
  assert.equal((await authorizeAction({ home, preToolEvent: { ...research.event, session_id: 'child' } })).decision, 'deny');
  const unknown = await dispatch('unknown-writer', 'writer-dispatch', 'writer', { candidateRoot: await candidate('unknown-candidate'), readSet: ['spec.md'], writeSet: ['src/value.mjs'] });
  assert.equal((await finish(unknown, 'No attributable model metadata.', { unknown: true })).ok, false);
  const writer = await dispatch('writer', 'writer-dispatch', 'writer', { candidateRoot: await candidate('candidate1'), readSet: ['spec.md'], writeSet: ['src/value.mjs'] });
  await assert.rejects(prepare(writer.proposal), /already reserved/);
  const disjoint = await dispatch('writer-disjoint', 'writer-dispatch', 'writer', { candidateRoot: await candidate('candidate-disjoint'), readSet: ['spec.md'], writeSet: ['src/other.mjs'] });
  const overlap = await classify('overlap', 'writer-dispatch', 'writer', { attemptId: 'overlap', readSet: ['spec.md'], writeSet: ['src/value.mjs'], toolName: 'Bash', toolInput: { command: `node '${cli}' execute --home '${home}' --input-json '${JSON.stringify({ attemptId: 'overlap', candidateRoot: await candidate('candidate-overlap') })}'` } });
  await assert.rejects(prepare(overlap), /overlap/);
  await finish(disjoint, 'Disjoint candidate left unchanged.');
  const beforeWriter = await getRun({ runDirectory });
  const writerObservation = { kind: 'review', verdict: 'pass', criterionIds: ['C1'], findings: [], summary: 'A writer cannot grant review acceptance.' };
  await finish(writer, writerObservation, { write: 'src/value.mjs', content: 'export const value = 2;\n' });
  const afterWriter = await getRun({ runDirectory });
  assert.equal(afterWriter.attempts.find(attempt => attempt.id === 'writer').returnedObservation, JSON.stringify(writerObservation));
  assert.equal(afterWriter.plans.length, beforeWriter.plans.length);
  assert.equal(afterWriter.reviews.length, beforeWriter.reviews.length);
  assert.equal(afterWriter.verifications.length, beforeWriter.verifications.length);
  await returned('writer-return', 'writer-return', ['writer', 'writer-disjoint'], 'integration');
  await integrate('integrate1', writer);
  const review1 = await dispatch('review1', 'final-review', 'reviewer');
  await finish(review1, { kind: 'review', verdict: 'revise', findings: [{ id: 'F1', criterionIds: ['C1'], severity: 'high', message: 'Expected corrected value is 3.' }], criterionIds: ['C1'] });
  const correction = await classify('correction', 'correct');
  await advancePhase({ runDirectory, transition: { to: 'implementation', reason: 'Resolve observed finding F1', boundaryId: correction.id } });
  assert.equal((await getRun({ runDirectory })).findings[0].resolved, false);
  await writeFile(join(root, 'src/other.mjs'), 'export const other = 7;\n');
  const secondCandidate = await candidate('candidate2');
  await writeFile(join(secondCandidate, 'src/value.mjs'), await readFile(join(root, 'src/value.mjs')));
  await writeFile(join(secondCandidate, 'src/other.mjs'), await readFile(join(root, 'src/other.mjs')));
  const writer2 = await dispatch('writer2', 'writer-dispatch', 'writer', { candidateRoot: secondCandidate, dependsOn: ['integrate1'], readSet: ['spec.md', 'src/other.mjs'], writeSet: ['src/value.mjs'] });
  await finish(writer2, 'Corrected writer observed prior integrated value and sibling input.', { write: 'src/value.mjs', content: 'export const value = 3;\n', expected: { [join(secondCandidate, 'src/value.mjs')]: 'export const value = 2;\n', [join(secondCandidate, 'src/other.mjs')]: 'export const other = 7;\n' } });
  assert.deepEqual((await getRun({ runDirectory })).attempts.find(attempt => attempt.id === 'writer2').changedPaths, ['src/value.mjs']);
  await returned('writer2-return', 'writer-return', ['writer2'], 'integration');
  await integrate('integrate2', writer2);
  const review2 = await dispatch('review2', 'final-review', 'reviewer');
  await finish(review2, { kind: 'review', verdict: 'pass', findings: [], resolvedFindingIds: ['F1'], criterionIds: ['C1'] });
  await returned('final-return', 'final-review-return', ['review2'], 'evidence');
  const failedVerification = await dispatch('verification-failed', 'verify', 'verifier', { check: { executable: process.execPath, argv: ['checks/value.mjs', '--expect-wrong-value'] } });
  assert.equal((await finish(failedVerification, 'Claimed success is not evidence.', { expectedExit: 1 })).ok, false);
  const afterFailure = await getRun({ runDirectory });
  assert.equal(afterFailure.attempts.find(attempt => attempt.id === 'verification-failed').status, 'failed', 'PostToolUse cannot overwrite the actual failed exit');
  assert.equal(afterFailure.evidence.at(-1).outcome, 'fail');
  const verification = await dispatch('verification', 'verify', 'verifier');
  await finish(verification, 'Printed success is ignored; actual node exit is the evidence.');
  await returned('verify-return', 'verify-return', ['verification']);
  const closure = await classify('closure', 'close', 'coordinator', { dependsOn: ['verification', 'review2'] });
  await writeFile(join(root, 'src/value.mjs'), 'export const value = 999;\n');
  await assert.rejects(closeRun({ runDirectory, outcome: { status: 'accepted', reason: 'Must reject stale evidence', boundaryId: closure.id } }), /current passing judgment/);
  await writeFile(join(root, 'src/value.mjs'), 'export const value = 3;\n');
  const closed = await closeRun({ runDirectory, outcome: { status: 'accepted', reason: 'All current criteria and independent reviews support local accepted', boundaryId: closure.id } });
  assert.equal(closed.outcome.status, 'accepted');
  assert.equal(closed.tickets[0].status, 'accepted');
  assert.notEqual(closed.plans[0].actorId, closed.reviews[0].actorId);
  assert.notEqual(closed.plans[0].sessionId, closed.reviews[0].sessionId);

  // A separate unfinished run checks stale permits and interrupted ownership.
  const cancelRoot = await candidate('cancel-root'), cancelSession = 'cancel-session';
  await registerHostSession({ home, event: { kind: 'session', sessionId: cancelSession, model: 'gpt-5.6-sol', reasoning: 'high', cwd: cancelRoot, transcriptPath: join(base, 'cancel-transcript.jsonl') } });
  const cancelContract = { ...contract, id: 'cancel-run', root: cancelRoot };
  await createRun({ home, contract: cancelContract, activation: { sessionId: cancelSession } });
  const cancelDirectory = join(home, '.development-system/governance/runs/cancel-run');
  const baseProposal = { id: 'cancel-intake', phase: 'intake', action: 'intake-review', actorId: cancelSession, attemptId: null, objective: 'Check interrupted ownership without losing recovery.', requirementIds: ['C1'], sourceIds: ['spec'], readSet: ['spec.md'], writeSet: [], dependsOn: [], route: route('coordinator'), toolName: 'governance', toolInput: {}, evidenceRefs: [], observations: ['local accepted remains the retained endpoint'] };
  const cancelClassify = proposal => classifyBoundary({ runDirectory: cancelDirectory, proposal, transport, env: { TYPESAFE_API_KEY: 'fixture-only-not-a-secret' } });
  assert.equal((await cancelClassify(baseProposal)).verdict, 'pass');
  await advancePhase({ runDirectory: cancelDirectory, transition: { to: 'research', reason: 'Observed intake', boundaryId: baseProposal.id } });
  const stale = { ...baseProposal, id: 'stale', phase: 'research', action: 'correct', attemptId: 'stale-attempt', writeSet: ['src/value.mjs'], toolName: 'apply_patch', toolInput: { patch: '*** Begin Patch\n*** Update File: src/value.mjs\n@@\n-old\n+new\n*** End Patch' } };
  await cancelClassify(stale);
  const cancelAction = p => ({ actorId: cancelSession, attemptId: p.attemptId, toolName: p.toolName, toolInput: p.toolInput });
  await prepareAction({ runDirectory: cancelDirectory, boundaryId: stale.id, action: cancelAction(stale) });
  await writeFile(join(cancelRoot, 'src/value.mjs'), 'export const changed = 4;\n');
  const cancelPre = { session_id: cancelSession, turn_id: 'cancel-turn', tool_use_id: 'stale-use', model: 'gpt-5.6-sol', hook_event_name: 'PreToolUse', tool_name: stale.toolName, tool_input: stale.toolInput };
  assert.equal((await authorizeAction({ home, preToolEvent: cancelPre })).decision, 'deny');
  await writeFile(join(cancelRoot, 'src/value.mjs'), 'export const value = 1;\n');
  const interrupted = { ...stale, id: 'interrupted', attemptId: 'interrupted-attempt' };
  await cancelClassify(interrupted);
  await prepareAction({ runDirectory: cancelDirectory, boundaryId: interrupted.id, action: cancelAction(interrupted) });
  assert.equal((await authorizeAction({ home, preToolEvent: { ...cancelPre, tool_use_id: 'interrupt-use' } })).decision, 'allow');
  await recordHostEvent({ home, event: { kind: 'interruption', sessionId: cancelSession, reason: 'Actual fixture cancellation before tool completion' } });
  const cancelled = await closeRun({ runDirectory: cancelDirectory, outcome: { status: 'blocked', reason: 'Interrupted completion remains unobserved', boundaryId: 'stop' } });
  assert.equal(cancelled.leasePreserved, true);
  assert.equal(cancelled.leases['src/value.mjs'], 'interrupted-attempt');
  await assert.rejects(createRun({ home, contract: { ...cancelContract, id: 'replacement' }, activation: { sessionId: cancelSession } }), /unfinished/);
  assert.equal(closed.phase, 'closed');
  assert.equal(closed.correctionCount, 1);
  assert.equal(closed.findings.find(finding => finding.id === 'F1').resolved, true);
  assert.equal(closed.evidence.at(-1).outcome, 'pass');
  assert.equal(closed.attempts.find(attempt => attempt.id === 'verification').process.exitCode, 0);
  assert.equal(await readFile(join(root, 'src/value.mjs'), 'utf8'), 'export const value = 3;\n');
  assert.equal(await readFile(join(root, 'src/other.mjs'), 'utf8'), 'export const other = 7;\n');
  t.diagnostic('Provider identities are explicitly simulated; OS PIDs, command execution, exits, files, and check assertions are real.');
  });
