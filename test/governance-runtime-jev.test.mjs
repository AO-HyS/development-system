import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildBody, buildQuestions, classifyWithJev, validateJevResponse } from "../runtime/jev-governance/jev.mjs";
import { JEV_ENDPOINT, JEV_MAX_CHANGED_CONTEXT_BYTES, JEV_MAX_REQUEST_BYTES, JEV_MAX_SOURCE_BYTES, JEV_MODEL } from "../runtime/jev-governance/policy.mjs";
import { sha256Hex } from "../runtime/jev-governance/schemas.mjs";

const exec = promisify(execFile);
const applicability = { priority: true, tool: true };

function simulatedResponse(request) {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    const choice = key === "route" ? request.state.boundary.route.role : key === "tool" ? "compliant" : key === "priority" ? "execute_now" : "satisfied";
    return [key, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(label => [label, Number(label === choice)])) }];
  }));
  return { model: JEV_MODEL, usage: { input_tokens: 1, output_tokens: 1 }, answers };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "governance-jev-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "spec.md"), "C1 requires the verified value. Local acceptance is authorized.\n");
  const coordinator = { provider: "codex", model: "gpt-5.6-sol", reasoning: "high" };
  const run = { runId: "fixture", root, baseSha: "fixture-base", phase: "intake", endpoint: "local accepted", authorization: "Implement C1 and accept locally.", coordinator, sources: [{ id: "spec", path: "spec.md", kind: "spec" }], criteria: [{ id: "C1", ticketId: "T1", requirement: "A verified value", evidenceRequired: "Actual assertion exit" }], attempts: [] };
  const proposal = { id: "boundary", phase: "intake", action: "intake-review", actorId: "root-fixture", attemptId: null, objective: "Enter research for C1.", route: { role: "coordinator", ...coordinator }, toolName: "governance", toolInput: {}, requirementIds: ["C1"], sourceIds: ["spec"], readSet: ["spec.md"], writeSet: [], dependsOn: [], observations: [], evidenceRefs: [] };
  return { run, proposal, home: root, env: { TYPESAFE_API_KEY: "fixture-only-no-live-credential" }, completed: {}, obligations: ["scope", "route", "tool", "context"], candidates: ["coordinator"] };
}

test("obligation answers cannot collide with route and tool decisions", () => {
  const questions = buildQuestions(["scope", "route", "tool"], ["coordinator"], applicability);
  assert.deepEqual(Object.keys(questions), ["obligation:scope", "obligation:route", "obligation:tool", "route", "tool", "priority"]);
  const response = simulatedResponse({ questions, state: { boundary: { route: { role: "coordinator" } } } });
  const result = validateJevResponse(response, ["scope", "route", "tool"], ["coordinator"], applicability);
  assert.deepEqual(result.obligations.map(item => item.outcome), ["satisfied", "satisfied", "satisfied"]);
  assert.equal(result.route.choice, "coordinator");
  assert.equal(result.tool.choice, "compliant");
});

test("Jev validation rejects incomplete, unrequested, unpinned and invalid probability answers", () => {
  const questions = buildQuestions(["scope"], ["coordinator"], applicability);
  const response = simulatedResponse({ questions, state: { boundary: { route: { role: "coordinator" } } } });
  const cases = [
    payload => { delete payload.answers["obligation:scope"]; },
    payload => { payload.answers.unrequested = payload.answers.tool; },
    payload => { payload.model = "unapproved-model"; },
    payload => { payload.answers["obligation:scope"].choice = "pass"; },
    payload => { payload.answers["obligation:scope"].probabilities.satisfied = 0.2; },
    payload => { payload.answers["obligation:scope"].confidence = 2; },
    payload => { payload.usage.input_tokens = -1; },
  ];
  for (const mutate of cases) {
    const payload = structuredClone(response);
    mutate(payload);
    assert.throws(() => validateJevResponse(payload, ["scope"], ["coordinator"], applicability), { code: "malformed" });
  }
});

test("control context retains observed identity and actual artifacts without demanding a dispatched model", async (t) => {
  const input = await fixture(t);
  const completed = { plans: [{ id: "plan", kind: "plan", summary: "Change value and run its assertion." }], activeOwnership: [{ id: "writer", writeSet: ["src/value.mjs"] }], dependencies: [{ id: "prior", status: "completed" }] };
  const request = JSON.parse(buildBody(input.run, input.proposal, input.obligations, input.candidates, [], [], completed, applicability));
  assert.deepEqual(request.state.run.observedCoordinator, input.run.coordinator);
  assert.equal(request.state.run.endpoint, "local accepted");
  assert.equal(request.state.policy.executionRequested, false);
  assert.equal(request.state.policy.routeValidation.ok, true);
  assert.deepEqual(request.state.boundary.toolInput, {});
  assert.deepEqual(request.state.completed, { ...completed, returnedArtifactRefs: [], requiredDependencyIds: [] });
  assert.match(request.questions.tool.instructions, /inapplicable/);
  assert.match(request.questions["obligation:context"].instructions, /not required at intake/);
});

test("only declared current dependencies are presented as prerequisites and ordinary tools need no invented process exit", async (t) => {
  const input = await fixture(t);
  input.proposal.dependsOn = ["integration"];
  const completed = { dependencies: [
    { id: "old-planner", status: "failed", executionKind: "attached-process" },
    { id: "integration", status: "completed", executionKind: "ordinary-host-tool", invocationObserved: true, terminationObserved: null },
  ] };
  const request = JSON.parse(buildBody(input.run, input.proposal, input.obligations, input.candidates, [], [], completed, applicability));
  assert.deepEqual(request.state.completed.requiredDependencyIds, ["integration"]);
  assert.deepEqual(request.state.completed.dependencies, completed.dependencies);
  assert.equal(Object.hasOwn(request.state.completed, "requiredDependencies"), false);
  assert.match(request.questions.priority.instructions, /ordinary-host-tool completes through its matching observed PostToolUse/);
});

test("the classifier supplies complete sources larger than 4KiB and uses the pinned API endpoint", async (t) => {
  const input = await fixture(t);
  const source = `Current canonical rules.\n${"Rule remains applicable.\n".repeat(250)}END OF COMPLETE SOURCE\n`;
  await writeFile(join(input.run.root, "spec.md"), source);
  let calls = 0;
  const result = await classifyWithJev({ ...input, transport: async request => {
    calls++;
    assert.equal(request.endpoint, JEV_ENDPOINT);
    assert.notEqual(request.endpoint, input.run.endpoint);
    const parsed = JSON.parse(request.body);
    assert.equal(parsed.state.sources[0].excerpt, source);
    return simulatedResponse(parsed);
  } });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test("missing and oversized canonical sources stop before transport", async (t) => {
  const input = await fixture(t);
  let calls = 0;
  const transport = async () => { calls++; throw new Error("must not call"); };
  await rm(join(input.run.root, "spec.md"));
  assert.equal((await classifyWithJev({ ...input, transport })).ok, false);
  await writeFile(join(input.run.root, "spec.md"), "x".repeat(JEV_MAX_SOURCE_BYTES + 1));
  const oversized = await classifyWithJev({ ...input, transport });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.code, "context_unavailable");
  assert.equal(oversized.transportAttempted, false);
  assert.equal(calls, 0);
});

test("returned-code context includes complete changed hunks in a large file and rejects overflow", async (t) => {
  const input = await fixture(t);
  const root = input.run.root;
  await mkdir(join(root, "src"));
  const file = join(root, "src/large.mjs");
  const original = Array.from({ length: 10000 }, (_, index) => `export const value${index} = ${index};`).join("\n") + "\n";
  await writeFile(file, original);
  await exec("git", ["init", "-q", root]);
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "base"], { cwd: root });
  await writeFile(file, original.replace("export const value5000 = 5000;", "export const value5000 = 42;"));
  input.proposal = { ...input.proposal, action: "writer-return", readSet: ["src/large.mjs"], dependsOn: ["writer"] };
  input.run.attempts = [{ id: "writer", status: "completed", process: { candidateRoot: root }, changedPaths: ["src/large.mjs"] }];
  input.completed = { dependencies: [{ id: "writer", status: "completed" }] };
  input.obligations = ["changed_scope", "repo_patterns", "docs_consistency"];
  let calls = 0;
  const transport = async request => {
    calls++;
    const parsed = JSON.parse(request.body);
    const evidence = parsed.state.completed.changeEvidence;
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].provenance, "observed-attempt:writer");
    assert.match(evidence[0].diff, /-export const value5000 = 5000;/);
    assert.match(evidence[0].diff, /\+export const value5000 = 42;/);
    assert.equal(evidence[0].contents, null);
    assert.match(evidence[0].coverage, /full unchanged file not supplied/);
    assert.ok(Buffer.byteLength(request.body) < JEV_MAX_REQUEST_BYTES);
    return simulatedResponse(parsed);
  };
  assert.equal((await classifyWithJev({ ...input, transport })).ok, true);
  assert.equal(calls, 1);
  await writeFile(file, (await readFile(file, "utf8")) + "x".repeat(JEV_MAX_CHANGED_CONTEXT_BYTES + 1));
  assert.equal((await classifyWithJev({ ...input, transport })).ok, false);
  assert.equal(calls, 1, "oversized context must not be silently truncated and classified");
});

test("wire references preserve every canonical artifact, full history and declared dependency order without mutating context", async (t) => {
  const input = await fixture(t);
  const plan = { id: "plan", kind: "plan", attemptId: "planner", actorId: "author", sessionId: "author-session", boundaryId: "authored", candidateHash: "candidate-hash", source: "process-output", current: true, stamp: { sources: [{ id: "spec", sha256: "source-hash" }] }, summary: "Full plan ends with PLAN TAIL", criterionIds: ["C1"], packets: [{ id: "first", readSet: ["spec.md"], writeSet: [], dependsOn: [] }, { id: "last", readSet: ["tail.txt"], writeSet: ["result.txt"], dependsOn: ["first"] }] };
  const review = { id: "review", kind: "plan-review", verdict: "pass", findings: ["F1"], planId: "plan", criterionIds: ["C1"] };
  const verification = { id: "verification", kind: "verification", results: [{ criterionId: "C1", outcome: "pass", observation: "VERIFICATION TAIL" }] };
  const completed = { plans: [plan], reviews: [review], verifications: [verification], returnedArtifacts: structuredClone([verification, plan, review]), dependencies: [
    { id: "history", status: "failed", returnedObservation: "HISTORICAL OBSERVATION TAIL" },
    { id: "planner", acceptanceId: "plan" }, { id: "reviewer", acceptanceId: "review" }, { id: "verifier", acceptanceId: "verification" },
  ], findings: [{ id: "F1", resolved: true, message: "FINDING TAIL" }], actors: [{ id: "author" }] };
  input.proposal.dependsOn = ["verifier", "planner", "reviewer"];
  const original = structuredClone(completed);
  const criteria = [{ id: "C1", requirement: "CRITERION TAIL" }], sources = [{ id: "rules", excerpt: "RULES TAIL" }];
  const request = JSON.parse(buildBody(input.run, { ...input.proposal, action: "plan-return" }, ["context", "completed_coverage"], input.candidates, sources, criteria, completed, applicability));
  const packed = request.state.completed;
  assert.deepEqual(packed.returnedArtifactRefs, [{ id: "verification", kind: "verification" }, { id: "plan", kind: "plan" }, { id: "review", kind: "plan-review" }]);
  assert.deepEqual(packed.requiredDependencyIds, ["verifier", "planner", "reviewer"]);
  assert.equal(Object.hasOwn(packed, "returnedArtifacts"), false);
  assert.equal(Object.hasOwn(packed, "requiredDependencies"), false);
  for (const key of ["plans", "reviews", "verifications", "dependencies", "findings", "actors"]) assert.deepEqual(packed[key], completed[key], key);
  assert.deepEqual(packed.returnedArtifactRefs.map(ref => [...packed.plans, ...packed.reviews, ...packed.verifications].find(artifact => artifact.id === ref.id && artifact.kind === ref.kind)), completed.returnedArtifacts);
  assert.deepEqual(request.state.criteria, criteria); assert.deepEqual(request.state.sources, sources);
  assert.deepEqual(completed, original);
  assert.match(request.questions["obligation:context"].instructions, /returnedArtifactRefs/);
  assert.match(request.questions["obligation:completed_coverage"].instructions, /matching both id and kind/);
});

test("missing, duplicate and contradictory wire identities fail before transport", async (t) => {
  const input = await fixture(t);
  const plan = { id: "plan", kind: "plan", summary: "Original complete plan", packets: [] };
  const completed = { plans: [plan], reviews: [], verifications: [], returnedArtifacts: structuredClone([plan]), dependencies: [{ id: "planner", acceptanceId: "plan" }] };
  input.proposal.dependsOn = ["planner"];
  const cases = [
    ["missing canonical", value => { value.completed.plans = []; }],
    ["duplicate canonical", value => { value.completed.plans.push(structuredClone(plan)); }],
    ["cross-kind duplicate canonical ID", value => { value.completed.reviews.push({ id: "plan", kind: "plan-review", verdict: "pass" }); }],
    ["wrong canonical kind", value => { value.completed.plans[0].kind = "verification"; }],
    ["missing returned", value => { value.completed.returnedArtifacts = []; }],
    ["duplicate returned", value => { value.completed.returnedArtifacts.push(structuredClone(plan)); }],
    ["contradictory returned kind", value => { value.completed.returnedArtifacts[0].kind = "plan-review"; }],
    ["contradictory returned content", value => { value.completed.returnedArtifacts[0].summary += " OMITTED DECISION"; }],
    ["unbound returned", value => { value.completed.dependencies[0].acceptanceId = null; }],
    ["missing required dependency", value => { value.completed.dependencies = []; }],
    ["duplicate dependency", value => { value.completed.dependencies.push({ id: "planner", acceptanceId: null }); }],
    ["duplicate required dependency", value => { value.proposal.dependsOn.push("planner"); }],
    ["missing canonical identity", value => { delete value.completed.plans[0].id; }],
  ];
  let calls = 0;
  for (const [label, mutate] of cases) {
    const value = { ...input, completed: structuredClone(completed), proposal: structuredClone(input.proposal) };
    mutate(value);
    const result = await classifyWithJev({ ...value, transport: async () => { calls++; throw Error("ambiguous context reached transport"); } });
    assert.equal(result.ok, false, label); assert.equal(result.code, "context_unavailable", label); assert.equal(result.transportAttempted, false, label);
  }
  assert.equal(calls, 0);
});

test("complete deduplicated requests between 64 and 96 KiB reach transport; larger envelopes and 201 criteria do not", async (t) => {
  const input = await fixture(t);
  const source = "r".repeat(15 * 1024) + "RULES TAIL";
  await writeFile(join(input.run.root, "spec.md"), source);
  const plan = { id: "large-plan", kind: "plan", summary: "p".repeat(60 * 1024) + "PLAN TAIL", criterionIds: ["C1"], packets: [{ id: "last-packet", readSet: ["spec.md"], writeSet: [], dependsOn: [] }] };
  input.completed = { plans: [plan], returnedArtifacts: structuredClone([plan]), dependencies: [{ id: "planner", acceptanceId: plan.id, returnedObservation: "OBSERVATION TAIL" }] };
  input.proposal = { ...input.proposal, action: "plan-return", dependsOn: ["planner"] };
  let calls = 0;
  const transport = async request => {
    calls++;
    const parsed = JSON.parse(request.body);
    assert.ok(Buffer.byteLength(request.body) > 65536);
    assert.ok(Buffer.byteLength(request.body) <= 98304);
    assert.equal(parsed.state.sources[0].excerpt, source);
    assert.deepEqual(parsed.state.completed.plans[0], plan);
    assert.deepEqual(parsed.state.completed.returnedArtifactRefs, [{ id: plan.id, kind: plan.kind }]);
    assert.deepEqual(parsed.state.completed.dependencies, input.completed.dependencies);
    assert.equal(request.body.split("PLAN TAIL").length - 1, 1);
    assert.equal(request.body.split("OBSERVATION TAIL").length - 1, 1);
    return simulatedResponse(parsed);
  };
  const accepted = await classifyWithJev({ ...input, transport });
  assert.equal(accepted.ok, true); assert.equal(accepted.transportAttempted, true);
  const larger = structuredClone(input.completed);
  larger.plans[0].summary += "x".repeat(32 * 1024);
  larger.returnedArtifacts[0] = structuredClone(larger.plans[0]);
  const oversized = await classifyWithJev({ ...input, completed: larger, transport });
  assert.equal(oversized.ok, false); assert.equal(oversized.code, "context_unavailable"); assert.equal(oversized.transportAttempted, false);
  assert.match(oversized.reason, /request exceeds/);
  input.run.criteria = Array.from({ length: 201 }, (_, index) => ({ ...input.run.criteria[0], id: `C${index}` }));
  const excessCriteria = await classifyWithJev({ ...input, transport });
  assert.equal(excessCriteria.ok, false); assert.equal(excessCriteria.code, "context_unavailable"); assert.equal(excessCriteria.transportAttempted, false);
  assert.match(excessCriteria.reason, /criteria exceed/); assert.equal(calls, 1);
});

test("UTF-8 envelopes accept exactly 98304 bytes and reject one additional byte before transport", async (t) => {
  const input = await fixture(t);
  const excerpt = await readFile(join(input.run.root, "spec.md"), "utf8");
  const sources = [{ ...input.run.sources[0], sha256: sha256Hex(excerpt), excerpt }];
  const criteria = input.run.criteria.map(criterion => ({ ...criterion, evidenceKind: "check", requiredCapabilities: [] }));
  const initial = buildBody(input.run, input.proposal, input.obligations, input.candidates, sources, criteria, { changeEvidence: [] }, applicability);
  const remaining = 98304 - Buffer.byteLength(initial);
  input.run.authorization += "界".repeat(Math.floor(remaining / 3)) + "x".repeat(remaining % 3);
  let calls = 0;
  const transport = async request => {
    calls++;
    assert.equal(Buffer.byteLength(request.body), 98304);
    assert.ok(request.body.length < Buffer.byteLength(request.body), "the envelope contains multibyte UTF-8");
    assert.equal(JSON.parse(request.body).state.run.authorization, input.run.authorization);
    return simulatedResponse(JSON.parse(request.body));
  };
  assert.equal((await classifyWithJev({ ...input, transport })).ok, true);
  input.run.authorization += "x";
  const oversized = await classifyWithJev({ ...input, transport });
  assert.equal(oversized.ok, false); assert.equal(oversized.code, "context_unavailable"); assert.equal(oversized.transportAttempted, false);
  assert.match(oversized.reason, /request exceeds/); assert.equal(calls, 1);
});

test("complete UTF-8 sources accept 65536 bytes and reject one additional byte without changing the envelope cap", async (t) => {
  const input = await fixture(t);
  const source = "é".repeat(32767) + "ab";
  assert.equal(Buffer.byteLength(source), 65536);
  await writeFile(join(input.run.root, "spec.md"), source);
  let calls = 0;
  const transport = async request => {
    calls++;
    assert.equal(JSON.parse(request.body).state.sources[0].excerpt, source);
    assert.ok(Buffer.byteLength(request.body) < 98304);
    return simulatedResponse(JSON.parse(request.body));
  };
  assert.equal((await classifyWithJev({ ...input, transport })).ok, true);
  await writeFile(join(input.run.root, "spec.md"), source + "c");
  const oversized = await classifyWithJev({ ...input, transport });
  assert.equal(oversized.ok, false); assert.equal(oversized.code, "context_unavailable"); assert.equal(oversized.transportAttempted, false);
  assert.match(oversized.reason, /complete-source byte cap/); assert.equal(calls, 1);
});

test("200 complete criteria reach transport and a 201st criterion rejects the request", async (t) => {
  const input = await fixture(t);
  input.run.criteria = Array.from({ length: 200 }, (_, index) => ({ ...input.run.criteria[0], id: `C${index + 1}`, requirement: `Complete requirement ${index + 1}` }));
  let calls = 0;
  const transport = async request => {
    calls++;
    const criteria = JSON.parse(request.body).state.criteria;
    assert.equal(criteria.length, 200);
    assert.deepEqual(criteria.map(criterion => criterion.requirement), input.run.criteria.map(criterion => criterion.requirement));
    return simulatedResponse(JSON.parse(request.body));
  };
  assert.equal((await classifyWithJev({ ...input, transport })).ok, true);
  input.run.criteria.push({ ...input.run.criteria[0], id: "C201" });
  const oversized = await classifyWithJev({ ...input, transport });
  assert.equal(oversized.ok, false); assert.equal(oversized.code, "context_unavailable"); assert.equal(oversized.transportAttempted, false);
  assert.match(oversized.reason, /criteria exceed/); assert.equal(calls, 1);
});

test("cumulative changed hunks retain a 64 KiB cap even when each file fits and the request limit is larger", async (t) => {
  const input = await fixture(t), root = input.run.root;
  for (const file of ["first.txt", "last.txt"]) await writeFile(join(root, file), "original\n");
  await exec("git", ["init", "-q", root]); await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "base"], { cwd: root });
  for (const file of ["first.txt", "last.txt"]) await writeFile(join(root, file), "x".repeat(34 * 1024) + `\n${file} TAIL\n`);
  input.proposal.readSet = ["first.txt", "last.txt"];
  input.obligations = ["changed_scope"];
  let calls = 0;
  const result = await classifyWithJev({ ...input, transport: async () => { calls++; throw Error("oversized cumulative context reached transport"); } });
  assert.equal(result.ok, false); assert.equal(result.code, "context_unavailable"); assert.equal(result.transportAttempted, false);
  assert.match(result.reason, /complete-context cap/); assert.equal(calls, 0);
});

test("an unavailable classifier remains unavailable without interpreting provider text as success", async (t) => {
  const input = await fixture(t);
  const result = await classifyWithJev({ ...input, transport: async () => { throw new Error("provider internals must not become evidence"); } });
  assert.deepEqual(result, { ok: false, reason: "Jev transport failed", code: "provider_unavailable", transportAttempted: true });
});
