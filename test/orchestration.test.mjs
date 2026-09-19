import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run as runCli } from "../src/cli.mjs";
import {
  AtomScheduler,
  classifyAtomWithJev,
  dispatchAtom,
  recordRouteDecision,
  evaluateSpawnHook,
  summarizeOpenCodeJsonl,
  validateAtomPlan,
} from "../src/orchestration.mjs";

const baseSha = "a".repeat(40);

function plan(atoms) {
  return {
    schemaVersion: 1,
    runId: "fixture-run",
    root: "/tmp/fixture-repository",
    baseSha,
    atoms,
  };
}

function atom(id, writeSet, dependsOn = []) {
  return {
    id,
    objective: `Implement ${id}`,
    readSet: [],
    writeSet,
    dependsOn,
    acceptanceIds: [`accept-${id}`],
  };
}

test("atom plan rejects missing dependencies, cycles, and paths outside the root", () => {
  const errors = validateAtomPlan(plan([
    { ...atom("a", ["../outside.ts"], ["b"]) },
    { ...atom("b", ["inside.ts"], ["a", "missing"]) },
  ]));
  assert.ok(errors.some((error) => error.includes("escapes")));
  assert.ok(errors.some((error) => error.includes("missing atom")));
  assert.ok(errors.some((error) => error.includes("cycle")));
});

test("scheduler serializes ancestor and read/write conflicts until verified acceptance", () => {
  const scheduler = new AtomScheduler(plan([
    atom("contract", ["src"]),
    {...atom("reader", []), readSet:["src/shared.ts"]},
    atom("dependent", ["lib/consumer.ts"], ["contract"]),
  ]));
  const started = scheduler.claim("contract");
  assert.deepEqual(scheduler.ready(), []);
  const receipt = {...started, ok:true, changedPaths:["src/shared.ts"]};
  scheduler.complete("contract", receipt);
  assert.deepEqual(scheduler.ready(), []);
  assert.throws(() => scheduler.verify("contract", {...receipt, type:"acceptance-receipt", verifier:"parent", acceptanceIds:[]}), /acceptance receipt/);
  scheduler.verify("contract", {...receipt, type:"acceptance-receipt", verifier:"parent", acceptanceIds:["accept-contract"]});
  assert.deepEqual(scheduler.ready().map(a=>a.id), ["reader", "dependent"]);
});

test("malformed dependency arrays and unsafe identifiers and aliases fail without throwing", () => {
  for (const patch of [{dependsOn: {}}, {dependsOn:[null]}, {id:"../escape"}, {writeSet:["."]}, {writeSet:["src/../lib"]}, {readSet:["src//x"]}]) {
    assert.ok(validateAtomPlan(plan([{...atom("safe", []), ...patch}])).length);
  }
});

test("read-only attempts reject forged identity and incomplete completion receipts", () => {
  const scheduler = new AtomScheduler(plan([atom("reader", [])]));
  const started = scheduler.claim("reader");
  for (const key of ["runId", "atomId", "attemptId", "contractHash", "baseSha"]) {
    assert.throws(()=>scheduler.complete("reader", {...started, [key]:"forged", ok:true, changedPaths:[]}), /does not match/);
  }
  assert.throws(()=>scheduler.complete("reader", {...started, ok:true}), /changedPaths/);
  assert.throws(()=>scheduler.complete("reader", {...started, ok:true, changedPaths:["outside"]}), /unowned/);
});

function validAnswer() {
  return {model:"jev-1.13.0", answers:{
    route:{type:"choice", choice:"deepseek_exact", confidence:0.1, probabilities:{deepseek_exact:1, astra_xhigh_decision:0, read_only_mapper:0, browser_executor:0, specialist_review:0, root_direct:0, blocked_dependency:0}},
    ...Object.fromEntries(["has_open_decision", "context_sufficient", "needs_browser", "semantic_overlap"].map(key=>[key,{type:"noul",noul:0.9}]))
  },usage:{input_tokens:10,output_tokens:5}};
}
function classify(payload, overrides={}) {
  return classifyAtomWithJev({atom:atom("writer",["src/a"]),run:{runId:"test", baseSha},apiKey:"synthetic-key",fetchImpl:async()=>new Response(JSON.stringify(payload)),...overrides});
}

test("advisory proposals never escalate or apply a route from uncalibrated scores", async () => {
  const receipt = await classify(validAnswer());
  assert.equal(receipt.proposedRoute,"deepseek_exact");
  assert.equal(receipt.appliedRoute,null);
  assert.equal(receipt.actionable,false);
  assert.equal(receipt.semanticOverlap,0.9);
  assert.equal(receipt.requestedModel,"jev-1.13.0");
  assert.ok(receipt.latencyMs>=0);
  assert.ok(receipt.requestBytes>0);
  const blocked=await classify(validAnswer(),{atom:atom("blocked",[],["upstream"])});
  assert.deepEqual(blocked.deterministicBlockers,["upstream"]);
});

test("Jev rejects prototype route names, malformed probabilities and missing judgments", async () => {
  for (const change of [p=>p.answers.route.choice="toString",p=>delete p.answers.needs_browser,p=>p.answers.route.confidence=2,p=>p.answers.route.probabilities.deepseek_exact=-1,p=>p.answers.semantic_overlap.noul="0.9"]) {
    const payload=validAnswer();change(payload);
    await assert.rejects(classify(payload),/invalid/);
  }
  let called=false;
  await assert.rejects(classify(validAnswer(),{atom:{...atom("large",[]),exactContext:"x".repeat(40000)},fetchImpl:async()=>{called=true;return new Response("{}");}}),/byte cap/);
  assert.equal(called,false);
});

test("dispatch is quarantined before provider calls or filesystem writes", async () => {
  let called=false;
  for(const routeReceipt of [{route:"deepseek_exact",atomId:"writer"},{mode:"shadow",proposedRoute:"deepseek_exact",actionable:false}]) {
    await assert.rejects(dispatchAtom({root:"/tmp/no-write",atom:atom("writer",[]),routeReceipt,evidenceDirectory:"/tmp/no-write",spawnImpl:()=>{called=true;}}),/quarantined/);
  }
  assert.equal(called,false);
});

test("OpenCode telemetry summary ignores non-JSON output and accumulates completed steps", () => {
  const summary = summarizeOpenCodeJsonl([
    "diagnostic text",
    JSON.stringify({ type: "step_finish", part: { tokens: { total: 10, input: 2, output: 1, reasoning: 1, cache: { read: 6, write: 0 } }, cost: 0.002 } }),
    JSON.stringify({ type: "step_finish", part: { tokens: { total: 20, input: 3, output: 2, reasoning: 1, cache: { read: 14, write: 0 } }, cost: 0.003 } }),
  ].join("\n"));
  assert.equal(summary.steps, 2);
  assert.equal(summary.inputTokens, 5);
  assert.equal(summary.outputTokens, 3);
  assert.equal(summary.cacheReadTokens, 20);
  assert.equal(summary.reportedTotalTokens, 30);
  assert.equal(summary.reportedCostUsd, 0.005);
});

test("spawn hook denies every shadow and legacy receipt even with explicit model overrides", () => {
  for(const receipt of [null,{route:"astra_xhigh_decision",atomId:"other"},{schemaVersion:2,mode:"shadow",proposedRoute:"browser_executor",actionable:false}]) {
    for(const tool_name of ["spawn_agent","Agent","multi_agent_v1__spawn_agent"]) {
      const result=evaluateSpawnHook({hook_event_name:"PreToolUse",tool_name,tool_input:{task_name:"writer",agent_type:"reviewer",model:"gpt-6-astra",reasoning_effort:"xhigh",fork_turns:"none"}},receipt);
      assert.equal(result.hookSpecificOutput.permissionDecision,"deny");
      assert.match(result.hookSpecificOutput.permissionDecisionReason,/quarantined/);
    }
  }
});

test("CLI validates an atom plan without changing the repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "development-system-plan-"));
  const path = join(directory, "plan.json");
  await writeFile(path, JSON.stringify(plan([atom("backend", ["src/appointments.mjs"])])));
  const execution = await runCli(["validate-atom-plan", "--plan", path, "--json"]);
  assert.equal(execution.result.ok, true);
  assert.equal(execution.result.status, "valid");
  assert.deepEqual(execution.result.errors, []);
});

test("hook executable reads route receipts and emits observation-only stop events", async () => {
  const runDirectory = await mkdtemp(join(tmpdir(), "development-system-hook-"));
  await mkdir(join(runDirectory, "routes"));
  await writeFile(join(runDirectory, "routes", "backend.json"), JSON.stringify({
    atomId: "backend",
    route: "deepseek_exact",
  }));
  await writeFile(join(runDirectory, "run-context.json"), JSON.stringify({
    runId: "hook-fixture",
    root: "/tmp/fixture-repository",
  }));
  const hook = new URL("../scripts/orchestration-hook.mjs", import.meta.url).pathname;
  const inactive = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "spawn_agent",
      tool_input: { task_name: "ordinary_task", message: "packet" },
    }),
    encoding: "utf8",
    env: { ...process.env, DEVELOPMENT_SYSTEM_ORCHESTRATION_RUN_DIR: "" },
  });
  assert.equal(inactive.status, 0);
  assert.deepEqual(JSON.parse(inactive.stdout), {});

  const pre = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "spawn_agent",
      tool_input: { task_name: "backend", message: "packet" },
    }),
    encoding: "utf8",
    env: { ...process.env, DEVELOPMENT_SYSTEM_ORCHESTRATION_RUN_DIR: runDirectory },
  });
  assert.equal(pre.status, 0);
  assert.equal(JSON.parse(pre.stdout).hookSpecificOutput.permissionDecision, "deny");

  const legacyPre = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "multi_agent_v1__spawn_agent",
      tool_input: { message: "Atom: backend\nSynthetic packet." },
    }),
    encoding: "utf8",
    env: { ...process.env, DEVELOPMENT_SYSTEM_ORCHESTRATION_RUN_DIR: runDirectory },
  });
  assert.equal(legacyPre.status, 0);
  assert.equal(JSON.parse(legacyPre.stdout).hookSpecificOutput.permissionDecision, "deny");

  const start = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: "SubagentStart", agent_id: "agent-1", agent_type: "reviewer" }),
    encoding: "utf8",
    env: { ...process.env, DEVELOPMENT_SYSTEM_ORCHESTRATION_RUN_DIR: runDirectory },
  });
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /hook-fixture/);

  const stop = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: "SubagentStop", agent_id: "agent-1", agent_type: "reviewer" }),
    encoding: "utf8",
    env: { ...process.env, DEVELOPMENT_SYSTEM_ORCHESTRATION_RUN_DIR: runDirectory },
  });
  assert.equal(stop.status, 0);
  const events = await readdir(join(runDirectory, "events"));
  assert.equal(events.length, 1);
  const event = JSON.parse(await readFile(join(runDirectory, "events", events[0]), "utf8"));
  assert.equal(event.type, "subagent-stop");
  assert.equal(event.observationOnly,true);
  assert.equal(event.acceptance,false);
  assert.equal(event.atomId,null);
  assert.equal(event.runId, "hook-fixture");
  assert.equal(event.agentId, "agent-1");
});

test("provider contract rejects missing probability coverage, nonmaximal choice, model drift and invalid usage", async () => {
  for(const change of [p=>delete p.answers.route.probabilities.root_direct,p=>p.answers.route.probabilities.root_direct=1,p=>p.model="jev-latest",p=>p.usage.input_tokens=-1,p=>delete p.usage]) {
    const payload=validAnswer(); change(payload); await assert.rejects(classify(payload));
  }
});

test("telemetry distinguishes missing cost evidence from provider-reported zero", () => {
  const missing=summarizeOpenCodeJsonl('{"type":"error","error":"failed"}');
  assert.equal(missing.reportedCostUsd,null); assert.equal(missing.costAvailable,false); assert.equal(missing.errorEvents,1);
  const zero=summarizeOpenCodeJsonl('{"type":"step_finish","part":{"tokens":{},"cost":0}}');
  assert.equal(zero.reportedCostUsd,0); assert.equal(zero.costAvailable,true);
});

test("classification times out even when injected transport ignores abort", async () => {
  await assert.rejects(classify(validAnswer(),{fetchImpl:()=>new Promise(()=>{})}),/timed out/);
});

test("parent records an overruling advisory decision without authorizing or claiming execution", async () => {
  const receipt=await classify(validAnswer());
  const input={classificationReceipt:receipt,atom:atom("writer",["src/a"]),run:{runId:"test",baseSha},chosenRoute:"root_direct",rationale:"Parent can complete this bounded action directly"};
  const decision=recordRouteDecision(input);
  assert.equal(decision.proposedRoute,"deepseek_exact"); assert.equal(decision.chosenRoute,"root_direct");
  assert.equal(decision.appliedRoute,null); assert.equal(decision.authorizationGranted,false); assert.equal(decision.executionObserved,false);
  for(const patch of [{atom:atom("writer",["different"])},{run:{runId:"other",baseSha}},{run:{runId:"test",baseSha:"b".repeat(40)}},{chosenRoute:"toString"},{rationale:" "},{classificationReceipt:{...receipt,policyVersion:"old"}}]) {
    assert.throws(()=>recordRouteDecision({...input,...patch}));
  }
});

test("compact flow judgments cover files, changes and review without forwarding whole repository context", async () => {
  const payload = validAnswer();
  for (const key of ["file_scope_complete", "change_matches_objective", "review_coverage_sufficient"]) payload.answers[key] = { type: "noul", noul: 0.8 };
  let request;
  const overrides = { contextMode: "flow", atom: { ...atom("writer", ["src/a"]), exactContext: "private repository dump" },
    flowContext: { fileSummaries: [{ path: "src/a", summary: "Shared behavior" }], changeSummary: "Handles the required state", reviewCoverage: [{ acceptanceId: "accept-writer", evidenceSummary: "Independent check pending" }], wholeRepository: "must never leave the process" },
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return new Response(JSON.stringify(payload)); } };
  const receipt = await classify(payload, overrides);
  assert.equal(receipt.contextMode, "flow");
  assert.equal(receipt.actionable, false);
  assert.equal(request.state.atom.exactContext, null);
  assert.equal(request.state.flow.wholeRepository, undefined);
  assert.ok(request.questions.review_coverage_sufficient);
  delete payload.answers.review_coverage_sufficient;
  await assert.rejects(classify(payload, overrides), /invalid review_coverage_sufficient/);
  await assert.rejects(classify(payload, { ...overrides, flowContext: { ...overrides.flowContext, changeSummary: "x".repeat(2001) } }), /at most 2000/);
});
