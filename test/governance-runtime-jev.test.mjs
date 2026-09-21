import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildBody, buildQuestions, classifyWithJev, validateJevResponse } from "../runtime/jev-governance/jev.mjs";
import { JEV_ENDPOINT, JEV_MAX_REQUEST_BYTES, JEV_MODEL } from "../runtime/jev-governance/policy.mjs";

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
  const completed = { plans: [{ summary: "Change value and run its assertion." }], activeOwnership: [{ id: "writer", writeSet: ["src/value.mjs"] }], dependencies: [{ id: "prior", status: "completed" }] };
  const request = JSON.parse(buildBody(input.run, input.proposal, input.obligations, input.candidates, [], [], completed, applicability));
  assert.deepEqual(request.state.run.observedCoordinator, input.run.coordinator);
  assert.equal(request.state.run.endpoint, "local accepted");
  assert.equal(request.state.policy.executionRequested, false);
  assert.equal(request.state.policy.routeValidation.ok, true);
  assert.deepEqual(request.state.boundary.toolInput, {});
  assert.deepEqual(request.state.completed, { ...completed, requiredDependencies: [] });
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
  assert.deepEqual(request.state.completed.requiredDependencies, [completed.dependencies[1]]);
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
  await writeFile(join(input.run.root, "spec.md"), "x".repeat(JEV_MAX_REQUEST_BYTES + 1));
  assert.equal((await classifyWithJev({ ...input, transport })).ok, false);
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
  await writeFile(file, (await readFile(file, "utf8")) + "x".repeat(JEV_MAX_REQUEST_BYTES + 1));
  assert.equal((await classifyWithJev({ ...input, transport })).ok, false);
  assert.equal(calls, 1, "oversized context must not be silently truncated and classified");
});

test("an unavailable classifier remains unavailable without interpreting provider text as success", async (t) => {
  const input = await fixture(t);
  const result = await classifyWithJev({ ...input, transport: async () => { throw new Error("provider internals must not become evidence"); } });
  assert.deepEqual(result, { ok: false, reason: "Jev transport failed" });
});
