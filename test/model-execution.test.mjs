import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { equivalentCost, runModel, startFlashServer, stopFlashServer, summarizeCodexAccounting, summarizeCodexUsage, summarizeFlashUsage } from "../src/model-execution.mjs";

const astra = { adapter: "codex", model: "gpt-6-astra", effort: "xhigh" };
const flash = { adapter: "opencode", model: "opencode-go/deepseek-v4.1-flash", effort: "high" };

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "model-execution-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "workspace"));
  const command = join(root, "fake-cli.mjs");
  return { root, command, cwd: join(root, "workspace") };
}

async function codexFixture(t, mode = "pass") {
  const f = await fixture(t);
  const sessions = join(f.root, "sessions");
  await writeFile(f.command, `#!${process.execPath}
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2),mode=${JSON.stringify(mode)},root=${JSON.stringify(f.root)};
const flag=(key)=>args[args.indexOf(key)+1];
const emit=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');
const id='00000000-0000-0000-0000-000000000001';
const dir=join(root,'sessions',new Date().toISOString().slice(0,10).replaceAll('-','/'));
mkdirSync(dir,{recursive:true});
const path=join(dir,'rollout-'+id+'.jsonl');
const native=(v)=>appendFileSync(path,JSON.stringify(v)+'\\n');
writeFileSync(join(root,'pid.txt'),String(process.pid));
writeFileSync(join(root,'args.json'),JSON.stringify(args));
emit({type:'thread.started',thread_id:id});
if(mode!=='unknown') native({type:'turn_context',payload:{model:mode==='drift'?'gpt-5.6-sol':flag('--model'),effort:JSON.parse(args.find(x=>x.startsWith('model_reasoning_effort=')).split('=')[1]),turn_id:'one'}});
native({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,cached_input_tokens:40,output_tokens:20,reasoning_output_tokens:5,total_tokens:120}}}});
if(['drift','cancel','timeout'].includes(mode)){
 process.on('SIGTERM',()=>writeFileSync(join(root,'terminated.txt'),'SIGTERM'));
 setInterval(()=>{},1000);
}else{
 emit({type:'item.completed',item:{type:'error',message:'PRIVATE_PROVIDER_TEXT'}});
 if(!['stopped','no-final'].includes(mode)) writeFileSync(flag('--output-last-message'),mode==='blank-final'?' \\n\\t':'FIXTURE_OK');
 if(!['stopped','no-terminal'].includes(mode)) emit({type:'turn.completed',usage:{input_tokens:100,output_tokens:20}});
 process.exit(mode==='failed'?7:0);
}
`, { mode: 0o700 });
  return { ...f, runtime: { command: f.command, sessionDirectory: sessions } };
}

test("Codex packets pin exact identity and effort while preserving project guidance", async (t) => {
  const f = await codexFixture(t);
  const result = await runModel({ ...f, profile: astra, prompt: "one exact packet", evidenceDirectory: join(f.root, "evidence") });
  assert.equal(result.ok, true);
  assert.equal(result.identityAttested, true);
  assert.equal(result.modelObserved, astra.model);
  assert.equal(result.effortObserved, astra.effort);
  assert.equal(result.finalText, "FIXTURE_OK");
  assert.equal(result.usage.total, 120);
  const args = JSON.parse(await readFile(join(f.root, "args.json"), "utf8"));
  assert.equal(args[args.indexOf("--model") + 1], astra.model);
  assert.ok(args.includes('model_reasoning_effort="xhigh"'));
  assert.ok(args.includes("features.multi_agent=false"));
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(!args.includes("--ignore-rules"));
  assert.ok(!args.some((value) => value.startsWith("project_doc_max_bytes=")));
  const saved = await readFile(result.receiptPath, "utf8");
  assert.doesNotMatch(saved, /PRIVATE_PROVIDER_TEXT|FIXTURE_OK/);
  assert.equal((await stat(result.receiptPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.root, "evidence/prompt.txt"))).mode & 0o777, 0o600);
});

test("disallowed model/effort pairs fail before any process or evidence directory", async (t) => {
  const f = await fixture(t);
  for (const profile of [{ ...astra, effort: "high" }, { ...astra, model: "unapproved-model" }, { ...flash, effort: "low" }]) {
    await assert.rejects(runModel({ ...f, profile, prompt: "packet", evidenceDirectory: join(f.root, "unused") }), /unsupported_model_profile/);
  }
  await assert.rejects(stat(join(f.root, "unused")), /ENOENT/);
});

test("observable model drift terminates the process before accepting and keeps failed usage", async (t) => {
  const f = await codexFixture(t, "drift");
  const result = await runModel({ ...f, profile: astra, prompt: "packet", evidenceDirectory: join(f.root, "evidence"), timeoutMs: 15000 });
  assert.equal(result.ok, false);
  assert.equal(result.failure, "observed_identity_mismatch");
  assert.equal(result.identityAttested, false);
  assert.equal(result.usage.total, 120);
  assert.ok(result.elapsedSeconds < 8);
  assert.equal(await readFile(join(f.root, "terminated.txt"), "utf8"), "SIGTERM");
  const pid = Number(await readFile(join(f.root, "pid.txt"), "utf8"));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.equal(result.apiEquivalentCostUsd, null);
  assert.equal(result.apiCostComplete, false);
});

test("abort waits for termination and records the whole failed attempt", async (t) => {
  const f = await codexFixture(t, "cancel");
  const controller = new AbortController();
  const pending = runModel({ ...f, profile: astra, prompt: "packet", evidenceDirectory: join(f.root, "evidence"), signal: controller.signal });
  for (let i = 0; i < 50; i++) {
    try { await stat(join(f.root, "pid.txt")); break; } catch { await delay(20); }
  }
  controller.abort();
  const result = await pending;
  const pid = Number(await readFile(join(f.root, "pid.txt"), "utf8"));
  assert.equal(result.ok, false);
  assert.equal(result.failure, "cancelled");
  assert.equal(result.cancellationConfirmed, true);
  assert.ok(result.elapsedSeconds >= 2);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("unknown identity and nonzero exit remain failures despite a usable final answer", async (t) => {
  for (const mode of ["unknown", "failed"]) {
    const f = await codexFixture(t, mode);
    const result = await runModel({ ...f, profile: astra, prompt: "packet", evidenceDirectory: join(f.root, "evidence") });
    assert.equal(result.ok, false);
    assert.equal(result.finalText, "FIXTURE_OK");
    assert.equal(result.failure, mode === "unknown" ? "observed_identity_unknown" : "process_exit_nonzero");
    assert.equal(result.usage.input, 100);
  }
});

test("zero-exit Codex turns require terminal completion and a meaningful final response", async (t) => {
  for (const mode of ["stopped", "no-terminal", "no-final", "blank-final"]) {
    await t.test(mode, async (t) => {
      const f = await codexFixture(t, mode);
      const result = await runModel({ ...f, profile: astra, prompt: "packet", evidenceDirectory: join(f.root, "evidence") });
      assert.equal(result.exitCode, 0);
      assert.equal(result.ok, false);
      assert.equal(result.failure, "provider_turn_incomplete");
      assert.equal(result.identityAttested, true);
      assert.equal(result.cancellationConfirmed, true);
      assert.equal(result.usage.input, 100);
      assert.equal(result.usage.cachedInput, 40);
      assert.equal(result.usage.output, 20);
      assert.equal(result.finalText, mode === "no-terminal" ? "FIXTURE_OK" : "");
      if (["stopped", "no-terminal"].includes(mode)) {
        assert.equal(result.usageComplete, false);
        assert.equal(result.apiCostComplete, false);
        assert.equal(result.apiEquivalentCostUsd, null);
      }
      const saved = JSON.parse(await readFile(result.receiptPath, "utf8"));
      assert.equal(saved.ok, false);
      assert.equal(saved.failure, "provider_turn_incomplete");
      assert.deepEqual(saved.usage, result.usage);
    });
  }
});

test("native accounting deduplicates counters and counts reset segments without cache/reasoning overlap", () => {
  const usage = (input, cached, output, reasoning) => ({ type: "event_msg", payload: { type: "token_count", info: {
    total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output, cache_write_input_tokens: 0 },
  } } });
  const total = summarizeCodexUsage([usage(100, 40, 20, 5), usage(100, 40, 20, 5), usage(180, 60, 35, 8), usage(20, 5, 7, 2)]);
  assert.deepEqual(total, { input: 200, cachedInput: 65, output: 42, reasoningOutput: 10, total: 242, cacheWriteInput: 0 });
  assert.equal(equivalentCost("gpt-6-astra", total), (135 * 10 + 65 * 1 + 42 * 50) / 1e6);
  assert.equal(summarizeCodexUsage([]), null);
});

test("Flash accounting includes cache and reasoning once, deduplicates messages, and retains failed usage", () => {
  const message = { info: { id: "one", role: "assistant", finish: "stop", cost: 0.004,
    tokens: { input: 80, output: 10, reasoning: 5, cache: { read: 20, write: 3 } } } };
  const failed = { info: { id: "two", role: "assistant", finish: "error", error: { name: "APIError" }, cost: 0.001,
    tokens: { input: 8, output: 1, reasoning: 2, cache: { read: 0, write: 0 } } } };
  const result = summarizeFlashUsage([message, structuredClone(message), failed]);
  assert.deepEqual(result.usage, { input: 111, cachedInput: 20, output: 18, reasoningOutput: 7, total: 129, cacheWriteInput: 3 });
  assert.equal(result.reportedCostUsd, 0.005);
});

test("an aborted Flash request with default zero counters has unknown usage and cost", () => {
  const result = summarizeFlashUsage([{ info: { id: "aborted", role: "assistant", error: { name: "MessageAbortedError" },
    time: { created: 1, completed: 2 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
  parts: [{ id: "started", type: "step-start" }, { id: "tool", type: "tool" }] }]);
  assert.equal(result.usage, null);
  assert.equal(result.usageComplete, false);
  assert.equal(result.reportedCostUsd, null);
  assert.equal(result.reportedKnownCostUsd, null);
  assert.equal(result.reportedCostComplete, false);
});

test("missing optional native counters never reset the input/output counters", () => {
  const event = (total_token_usage) => ({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage } } });
  const result = summarizeCodexAccounting([
    event({ input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 50 }),
    event({ input_tokens: 1100, output_tokens: 120 }),
  ]);
  assert.equal(result.usage.input, 1100);
  assert.equal(result.usage.output, 120);
  assert.equal(result.usage.cachedInput, null);
  assert.equal(result.usage.reasoningOutput, null);
  assert.equal(result.usageComplete, false);
  assert.equal(result.requestsComplete, false);
});

test("long context prices apply to each request rather than a summed session", () => {
  const small = { input: 200000, cachedInput: 0, output: 1000, cacheWriteInput: 0 };
  const large = { input: 300000, cachedInput: 100000, output: 1000, cacheWriteInput: 0 };
  assert.equal(equivalentCost("gpt-6-astra", small), 2.05);
  assert.equal(equivalentCost("gpt-6-astra", large), 4.275);
  const events = [1, 2].map((index) => ({ type: "event_msg", payload: { type: "token_count", info: {
    total_token_usage: { input_tokens: 200000 * index, cached_input_tokens: 0, output_tokens: 1000 * index, reasoning_output_tokens: 0, cache_write_input_tokens: 0 },
    last_token_usage: { input_tokens: 200000, cached_input_tokens: 0, output_tokens: 1000, reasoning_output_tokens: 0, cache_write_input_tokens: 0 },
  } } }));
  const accounting = summarizeCodexAccounting([...events, events[1]]);
  assert.equal(accounting.requests.length, 2);
  assert.equal(accounting.requestsComplete, true);
  assert.equal(accounting.requests.reduce((sum, request) => sum + equivalentCost("gpt-6-astra", request), 0), 4.1);
});

test("partial Flash cost is explicitly incomplete and step records preserve multiple requests", () => {
  const tokens = { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 0 } };
  const result = summarizeFlashUsage([
    { info: { id: "one", role: "assistant", tokens, cost: 99 }, parts: [
      { id: "step-1", type: "step-finish", tokens, cost: 0.001 },
      { id: "step-2", type: "step-finish", tokens },
    ] },
    { info: { id: "failed", role: "assistant", error: { name: "APIError" } } },
  ]);
  assert.equal(result.usage.input, 26);
  assert.equal(result.usage.output, 6);
  assert.equal(result.usageComplete, false);
  assert.equal(result.reportedKnownCostUsd, 0.001);
  assert.equal(result.reportedCostUsd, null);
  assert.equal(result.reportedCostComplete, false);
});

async function flashFixture(t) {
  const f = await fixture(t);
  const authPath = join(f.root, "auth.json");
  const catalogPath = join(f.root, "models.json");
  await writeFile(authPath, JSON.stringify({ "opencode-go": { type: "api", key: "FIXTURE_NOT_A_CREDENTIAL" } }), { mode: 0o600 });
  await writeFile(catalogPath, "{}", { mode: 0o600 });
  await writeFile(f.command, `#!${process.execPath}
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2),root=${JSON.stringify(f.root)};
const flag=(key)=>args[args.indexOf(key)+1];
const authorization='Basic '+Buffer.from('opencode:'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
if(args[0]==='serve'){
 const sessions=new Map();let seq=0;
 const server=createServer(async(req,res)=>{
  if(req.headers.authorization!==authorization){res.writeHead(401);res.end('{}');return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  req.url=new URL(req.url,'http://localhost').pathname;
  const send=(value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(req.url==='/global/health')return send({healthy:true});
  if(req.url==='/config/providers')return send({providers:[{id:'opencode-go',models:{'deepseek-v4.1-flash':{id:'deepseek-v4.1-flash',variants:{high:{reasoningEffort:'high'}},cost:{input:0.15,output:0.6,cache:{read:0.003,write:0}}}}}]});
  if(req.url==='/session'&&req.method==='POST'){const id='ses_fixture'+(++seq);sessions.set(id,{messages:[],status:'idle',cwd:decodeURIComponent(req.headers['x-opencode-directory'])});return send({id});}
  if(req.url==='/session/status')return send(Object.fromEntries([...sessions].map(([id,s])=>[id,{type:s.status}])));
  const match=req.url.match(/^\\/session\\/(ses_[a-zA-Z0-9]+)\\/(message|abort|fixture)$/);
  if(!match){res.writeHead(404);return send({});}
  const s=sessions.get(match[1]);
  if(match[2]==='abort'){s.status='idle';writeFileSync(root+'/abort.txt',match[1]);return send(true);}
  if(match[2]==='message')return send(s.messages);
  s.status='busy';const start=Date.now();const id=match[1];
  const info={id:'msg_'+id,role:'assistant',providerID:'opencode-go',modelID:'deepseek-v4.1-flash',variant:'high',path:{cwd:s.cwd},time:{created:start},tokens:{input:100,output:10,reasoning:5,cache:{read:20,write:0}},cost:0.001};
  s.messages=[{info:{...info,id:'initial_'+id,finish:'tool-calls',time:{created:start,completed:start},cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}}},parts:[{type:'text',text:'INTERMEDIATE_COMMENTARY'}]},{info,parts:[{type:'text',text:'FLASH_FIXTURE_OK'}]}];
  setTimeout(()=>{info.time.completed=Date.now();info.finish='stop';s.status='idle';send(true)},350);
 });server.listen(0,'127.0.0.1',()=>process.stdout.write('opencode server listening on http://127.0.0.1:'+server.address().port+'\\n'));
}else{
 if(args.indexOf('--file')!==args.length-2){process.stderr.write('File not found: positional prompt consumed by variadic --file');process.exit(1);}
 const session=flag('--session');
 await fetch(flag('--attach')+'/session/'+session+'/fixture',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({packet:readFileSync(flag('--file'),'utf8')})});
 process.stdout.write(JSON.stringify({type:'step_start',sessionID:session})+'\\n');
}
`, { mode: 0o700 });
  return { ...f, runtime: { command: f.command, authPath, catalogPath } };
}

test("isolated Flash server supports two overlapping pinned sessions and retrieves missing streamed finals", async (t) => {
  const f = await flashFixture(t);
  const server = await startFlashServer({ ...f, evidenceDirectory: join(f.root, "server") });
  try {
    assert.doesNotMatch(JSON.stringify(server), /OPENCODE_SERVER_PASSWORD|authorization|FIXTURE_NOT_A_CREDENTIAL/);
    const results = await Promise.all([1, 2].map((index) => runModel({ ...f, profile: flash, server,
      prompt: "exact packet " + index, evidenceDirectory: join(f.root, "run-" + index) })));
    assert.ok(results.every((result) => result.ok));
    assert.notEqual(results[0].sessionId, results[1].sessionId);
    assert.ok(results.every((result) => result.finalText === "FLASH_FIXTURE_OK"));
    for (const result of results) {
      assert.equal(result.modelObserved, flash.model);
      assert.equal(result.effortObserved, "high");
      assert.ok(result.observedContexts.every((context) => context.cwd === f.cwd));
      assert.equal(result.usage.input, 120);
      assert.equal(result.usage.output, 15);
      assert.ok(result.argv.includes("--variant"));
      assert.ok(result.argv.includes("--model"));
      assert.doesNotMatch(await readFile(result.receiptPath, "utf8"), /OPENCODE_SERVER_PASSWORD|authorization|FIXTURE_NOT_A_CREDENTIAL/);
    }
    assert.ok(Date.parse(results[0].endedAt) > Date.parse(results[1].startedAt));
  } finally { await stopFlashServer(server); }
  assert.equal(server.stopped, true);
  assert.throws(() => process.kill(server.pid, 0), /ESRCH/);
});
