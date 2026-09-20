import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {measureWorkflow,unionMilliseconds} from '../scripts/measure-jev-workflow.mjs';

test('concurrent implementation and review count once in elapsed time',()=>{
  const timestamp=s=>`2026-09-19T10:00:${String(s).padStart(2,'0')}.000Z`;
  assert.equal(unionMilliseconds([{startedAt:timestamp(0),endedAt:timestamp(20)},{startedAt:timestamp(10),endedAt:timestamp(30)},{startedAt:timestamp(35),endedAt:timestamp(40)}]),35000);
});

test('failed work and QA stay in per-arm cost; absent receipts remain unknown',async()=>{
  const root=await mkdtemp(join(tmpdir(),'jev-measure-'));
  const save=async(path,value)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),JSON.stringify(value));};
  try{
    await save('manifest.json',{arm:'sol-flow',ticket:'BARBER-205',controllerVersion:'1.23.0'});
    const events=[
      {type:'task-started',at:'2026-09-19T10:00:00.000Z'},
      {type:'job-started',jobId:'001-write'},
      {type:'job-started',jobId:'002-qa'},
      {type:'job-started',jobId:'003-missing'},
      {type:'jev-completed',model:'jev-1.13.0',startedAt:'2026-09-19T10:00:01.000Z',endedAt:'2026-09-19T10:00:02.000Z',valid:false,questions:2,coveredFiles:['a.ts'],usage:{input_tokens:1000,output_tokens:20}},
      {type:'task-failed',at:'2026-09-19T10:01:00.000Z'}
    ];
    await writeFile(join(root,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'));
    for(const [name,cost,phase,ok] of [['001-write',1,'implementation',false],['002-qa',2,'qa',true]])await save(`jobs/${name}/receipt.json`,{phase,ok,execution:{model:'gpt-6-astra'},modelObserved:'gpt-6-astra',identityAttested:true,startedAt:'2026-09-19T10:00:10.000Z',endedAt:'2026-09-19T10:00:30.000Z',apiEquivalentCostUsd:cost,usageComplete:true,apiCostComplete:true,usage:{input:100,cachedInput:80,output:10,reasoningOutput:5,total:110}});
    const {result}=await measureWorkflow(root);
    assert.equal(result.timing.taskWorkMilliseconds,60000);
    assert.equal(result.timing.parallelJobUnionMilliseconds,21000);
    assert.equal(result.cost.knownApiEquivalentUsd,3.000042);
    assert.equal(result.cost.complete,false);
    assert.equal(result.cost.unknownUsageJobs,1);
    assert.deepEqual(result.cost.missingReceipts,['003-missing']);
    assert.equal(result.byModel['gpt-6-astra'].total,220);
    assert.equal(result.byPhase.qa.knownApiEquivalentUsd,2);
    assert.equal(result.jev.validResponses,0);
    assert.equal(result.jev.input,1000);
    assert.equal(result.ticket,'BARBER-205');

    // A partial receipt contributes each known field and dollar exactly once,
    // while preserving that the final total remains unknown.
    await save('jobs/003-missing/receipt.json',{phase:'correction',ok:false,modelObserved:'gpt-6-astra',identityAttested:true,
      startedAt:'2026-09-19T10:00:30.000Z',endedAt:'2026-09-19T10:00:40.000Z',
      apiEquivalentCostUsd:null,apiEquivalentKnownCostUsd:0.5,usageComplete:false,apiCostComplete:false,
      usage:{input:50,cachedInput:null,output:5,total:55}});
    const partial=(await measureWorkflow(root)).result;
    assert.equal(partial.cost.knownApiEquivalentUsd,3.500042);
    assert.equal(partial.cost.complete,false);
    assert.equal(partial.cost.unknownUsageJobs,1);
    assert.deepEqual(partial.cost.missingReceipts,[]);
    assert.equal(partial.byModel['gpt-6-astra'].input,250);
    assert.equal(partial.byModel['gpt-6-astra'].cachedInput,160);
    assert.equal(partial.byModel['gpt-6-astra'].unknownUsageJobs,1);

    // Valid numeric counters can still describe only a partial provider turn.
    await save('jobs/003-missing/receipt.json',{phase:'correction',ok:false,modelObserved:'gpt-6-astra',identityAttested:true,
      startedAt:'2026-09-19T10:00:30.000Z',endedAt:'2026-09-19T10:00:40.000Z',
      apiEquivalentCostUsd:null,apiEquivalentKnownCostUsd:0.5,usageComplete:false,apiCostComplete:false,
      usage:{input:50,cachedInput:30,output:5,total:55}});
    const numericPartial=(await measureWorkflow(root)).result;
    assert.equal(numericPartial.byModel['gpt-6-astra'].unknownUsageJobs,1);
    assert.equal(numericPartial.byModel['gpt-6-astra'].input,250);
    assert.equal(numericPartial.byModel['gpt-6-astra'].cachedInput,190);
    assert.equal(numericPartial.cost.knownApiEquivalentUsd,3.500042);
    assert.equal(numericPartial.cost.unknownUsageJobs,1);
    assert.equal(numericPartial.cost.complete,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
