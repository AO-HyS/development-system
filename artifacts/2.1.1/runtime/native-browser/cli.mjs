// @ts-check
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { browserPool } from './pool.mjs';

/** @param {string[]} argv */
export function runBrowserPool(argv) {
  const [operation,...flags]=argv;
  let home=homedir(), input, json=false;
  for(let i=0;i<flags.length;i++) {
    const flag=flags[i];
    if(flag==='--json') {json=true;continue;}
    const value=flags[++i];
    if(!value||value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if(flag==='--home') home=resolve(value);
    else if(flag==='--input') input=JSON.parse(readFileSync(resolve(value),'utf8'));
    else throw new Error(`Unknown browser-pool option: ${flag}`);
  }
  const result=browserPool({home,operation,input});
  return {result,output:JSON.stringify(result,json?undefined:null,json?undefined:2),json,code:'status' in result && result.status==='capacity-needed'?75:0};
}
