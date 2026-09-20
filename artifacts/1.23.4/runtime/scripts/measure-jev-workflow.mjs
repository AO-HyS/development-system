#!/usr/bin/env node
// @ts-check
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/** @param {string} path */
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
/** @param {Array<{startedAt:string,endedAt:string}>} intervals */
export function unionMilliseconds(intervals) {
  const ranges = intervals.map(i => [Date.parse(i.startedAt), Date.parse(i.endedAt)]).sort((a,b) => a[0]-b[0]);
  let total=0, start=NaN, end=NaN;
  for (const [a,b] of ranges) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b<a) throw new Error('Invalid timing interval');
    if (!Number.isFinite(start)) { start=a; end=b; }
    else if(a<=end) end=Math.max(end,b);
    else { total+=end-start; start=a;end=b; }
  }
  return total+(Number.isFinite(start)?end-start:0);
}

/** @param {string} directory */
export async function measureWorkflow(directory) {
  const manifest=await readJson(resolve(directory,'manifest.json'));
  const events=(await readFile(resolve(directory,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
  const start=events.find(e=>e.type==='task-started');
  const terminal=[...events].reverse().find(e=>e.type==='task-accepted'||e.type==='task-failed');
  /** @type {any[]} */ const jobs=[];
  /** @type {import('node:fs').Dirent[]} */ let jobDirectories;
  try { jobDirectories=await readdir(resolve(directory,'jobs'),{withFileTypes:true}); }
  catch(error) { if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')jobDirectories=[]; else throw error; }
  for(const d of jobDirectories) {
    if(!d.isDirectory())continue;
    const path=resolve(directory,'jobs',d.name,'receipt.json');
    try { const r=await readJson(path);jobs.push({...r,receiptPath:path}); }
    catch(error) { if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error; }
  }
  const jev=events.filter(e=>e.type==='jev-completed');
  const pauses=events.filter(e=>e.type==='human-pause-completed');
  /** @type {Array<{startedAt:string,endedAt:string}>} */
  const intervals=[];
  /** @type {Record<string,any>} */ const byModel={};
  /** @type {Record<string,any>} */ const byPhase={};
  const startedJobs=events.filter(e=>e.type==='job-started');
  const missingReceipts=startedJobs.filter(e=>!jobs.some(j=>dirname(j.receiptPath).endsWith(`/${e.jobId}`))).map(e=>e.jobId);
  let knownCost=0,unknownCostJobs=missingReceipts.length;
  for(const j of jobs) {
    if(j.startedAt&&j.endedAt)intervals.push({startedAt:j.startedAt,endedAt:j.endedAt});
    const model=j.modelObserved??(j.identityAttested?j.execution?.model:undefined)??'unknown';
    const row=byModel[model]??={jobs:0,input:0,cachedInput:0,output:0,reasoningOutput:0,total:0,knownApiEquivalentUsd:0,unknownUsageJobs:0};
    row.jobs++;
    const validUsage=j.usage&&['input','cachedInput','output','total'].every(k=>Number.isFinite(j.usage[k])&&j.usage[k]>=0)&&j.usage.cachedInput<=j.usage.input;
    if(j.usage)for(const k of ['input','cachedInput','output','reasoningOutput','total'])if(Number.isFinite(j.usage[k])&&j.usage[k]>=0)row[k]+=j.usage[k];
    if(!validUsage||j.usageComplete!==true)row.unknownUsageJobs++;
    const validCost=typeof j.apiEquivalentCostUsd==='number'&&Number.isFinite(j.apiEquivalentCostUsd)&&j.apiEquivalentCostUsd>=0;
    const partialCost=typeof j.apiEquivalentKnownCostUsd==='number'&&Number.isFinite(j.apiEquivalentKnownCostUsd)&&j.apiEquivalentKnownCostUsd>=0?j.apiEquivalentKnownCostUsd:0;
    const knownJobCost=validCost?j.apiEquivalentCostUsd:partialCost;
    knownCost+=knownJobCost;row.knownApiEquivalentUsd+=knownJobCost;
    if(!validCost||!validUsage||j.usageComplete!==true||j.apiCostComplete!==true)unknownCostJobs++;
    const phase=byPhase[j.phase??'unknown']??={jobs:0,agentMilliseconds:0,knownApiEquivalentUsd:0};
    phase.jobs++;phase.agentMilliseconds+=j.startedAt&&j.endedAt?Date.parse(j.endedAt)-Date.parse(j.startedAt):0;phase.knownApiEquivalentUsd+=knownJobCost;
  }
  const jevRow={attempts:jev.length,validResponses:0,questions:0,unknownQuestionAttempts:0,input:0,output:0,unknownUsageAttempts:0,unknownCostAttempts:0,knownApiEquivalentUsd:0,coveredFiles:/** @type {string[]} */([])};
  for(const j of jev) {
    intervals.push({startedAt:j.startedAt,endedAt:j.endedAt});
    jevRow.validResponses+=Number(j.valid);jevRow.coveredFiles.push(...(j.coveredFiles??[]));
    if(Number.isInteger(j.questions)&&j.questions>=0)jevRow.questions+=j.questions;else jevRow.unknownQuestionAttempts++;
    if(j.usage&&Number.isSafeInteger(j.usage.input_tokens)&&j.usage.input_tokens>=0&&Number.isSafeInteger(j.usage.output_tokens)&&j.usage.output_tokens>=0) {
      jevRow.input+=j.usage.input_tokens;jevRow.output+=j.usage.output_tokens;
      if(j.model==='jev-1.13.0')jevRow.knownApiEquivalentUsd+=j.usage.input_tokens*.042/1e6;else jevRow.unknownCostAttempts++;
    } else {jevRow.unknownUsageAttempts++;jevRow.unknownCostAttempts++;}
  }
  jevRow.coveredFiles=[...new Set(jevRow.coveredFiles)];
  knownCost+=jevRow.knownApiEquivalentUsd;
  unknownCostJobs+=jevRow.unknownCostAttempts;
  const accepted=terminal?.type==='task-accepted';
  const elapsed=start&&terminal?Date.parse(terminal.at)-Date.parse(start.at):null;
  for(const pause of pauses) {
    const a=Date.parse(pause.startedAt),b=Date.parse(pause.endedAt);
    if(!start||!terminal||a<Date.parse(start.at)||b>Date.parse(terminal.at)||pause.verified!==true)throw new Error('Human pause must have verified boundaries inside this execution');
    if(intervals.some(i=>a<Date.parse(i.endedAt)&&b>Date.parse(i.startedAt)))throw new Error('Cannot exclude a human pause while task work continued');
  }
  const pauseMs=unionMilliseconds(pauses);
  const result={schemaVersion:1,arm:manifest.arm,ticket:manifest.ticket??'configured-task',controllerVersion:manifest.controllerVersion,generatedAt:new Date().toISOString(),status:accepted?'accepted-local':terminal?'failed':'incomplete',timing:{taskWorkMilliseconds:elapsed===null?null:elapsed-pauseMs,parallelJobUnionMilliseconds:unionMilliseconds(intervals),explicitHumanPauseMilliseconds:pauseMs,experimentSetupIncluded:false,definition:'From ticket research to accepted behavior, including planning, execution, tool/provider waits, reviews, QA and corrections. Excludes explicit human idle pauses and preflight. Parallel jobs are not added to elapsed time.'},cost:{currency:'USD',basis:'API Standard token-equivalent',knownApiEquivalentUsd:knownCost,complete:unknownCostJobs===0&&Boolean(terminal),unknownUsageJobs:unknownCostJobs,missingReceipts,priceSource:'config/1.23.0/api-prices.json'},byModel,byPhase,jev:jevRow,jobs:jobs.map(j=>({phase:j.phase,execution:j.execution,modelObserved:j.modelObserved,identityAttested:j.identityAttested,ok:j.ok,startedAt:j.startedAt,endedAt:j.endedAt,usage:j.usage,usageComplete:j.usageComplete,apiCostComplete:j.apiCostComplete,apiEquivalentCostUsd:j.apiEquivalentCostUsd,apiEquivalentKnownCostUsd:j.apiEquivalentKnownCostUsd,receiptPath:j.receiptPath})),candidateHash:terminal?.candidateHash??null};
  const output=resolve(directory,`measurement-${Date.now()}-${randomUUID()}.json`);
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  return {output,result};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const arg=process.argv[process.argv.indexOf('--directory')+1];
  if(!process.argv.includes('--directory')||!arg)throw new Error('Usage: measure-jev-workflow.mjs --directory <private arm execution directory>');
  const {output,result}=await measureWorkflow(resolve(arg));
  process.stdout.write(JSON.stringify({output,status:result.status,timing:result.timing,cost:result.cost})+'\n');
}
