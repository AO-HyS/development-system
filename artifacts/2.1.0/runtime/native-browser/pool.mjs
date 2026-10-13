// @ts-check
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/** @typedef {{id:string, appPath:string, bundleId:string, enabled:boolean, accounts:string[], observedAt:number, evidence:string, lastUsed:number}} Resource */
/** @typedef {{leaseId:string, ownerId:string, generation:number, resourceId:string, purpose:'allocation'|'computer-use', status:'active'|'quarantined', pid:number, processStart:string, expiresAt:number}} Lease */
const BROWSERS = new Set(['com.google.Chrome', 'com.google.Chrome.beta', 'com.google.Chrome.canary', 'com.apple.Safari', 'com.brave.Browser', 'com.brave.Browser.beta', 'com.brave.Browser.nightly', 'com.microsoft.edgemac', 'com.microsoft.edgemac.Beta', 'com.microsoft.edgemac.Dev', 'com.microsoft.edgemac.Canary', 'com.vivaldi.Vivaldi', 'org.mozilla.firefox', 'org.mozilla.firefoxdeveloperedition', 'net.imput.helium']);
const MAX_OBSERVATION_AGE = 24 * 60 * 60 * 1000;

/** @param {unknown} input @param {string[]} allowed @returns {Record<string,any>} */
function record(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a request object');
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`Unknown browser-pool field: ${key}`);
  return /** @type {Record<string,any>} */ (input);
}
/** @param {unknown} value @param {string} name */
function text(value, name) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}
/** @param {unknown} value */
function accounts(value) {
  if (!Array.isArray(value) || value.some(v => !['google', 'github', 'facebook'].includes(v))) throw new Error('accounts must contain only google, github or facebook');
  return [...new Set(/** @type {string[]} */ (value))];
}
/** @param {number} pid */
function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('A live local ownerPid is required');
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim(); }
  catch { return ''; }
}
/** @param {string} appPath */
function identifyApp(appPath) {
  const canonical = realpathSync(appPath);
  if (!canonical.endsWith('.app') || !lstatSync(canonical).isDirectory()) throw new Error('appPath must name an installed app bundle');
  const info = join(canonical, 'Contents', 'Info.plist');
  const bundleId = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', info], { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim();
  if (!BROWSERS.has(bundleId)) {
    // Future browsers/channels need no fixed roster or capacity increase.
    const metadata = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', info], { encoding:'utf8', stdio:['ignore','pipe','ignore'], maxBuffer:2*1024*1024 }));
    const schemes = new Set((metadata.CFBundleURLTypes ?? []).flatMap((/** @type {{CFBundleURLSchemes?:string[]}} */ type) => type.CFBundleURLSchemes ?? []));
    if (!schemes.has('http') || !schemes.has('https')) throw new Error(`App is not a registered HTTP/HTTPS browser: ${bundleId}`);
  }
  text(bundleId, 'bundleId');
  return { appPath:canonical, bundleId };
}

/** Read application metadata only; no browser launches or user-profile reads. */
export function browserInventory() {
  const resources = [];
  for (const directory of ['/Applications', '/System/Applications', join(homedir(), 'Applications')]) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter(n => n.endsWith('.app'))) {
      try { const app = identifyApp(join(directory, name)); resources.push({ ...app, id:app.bundleId, name:name.slice(0,-4), readiness:'unobserved', personalChrome:app.bundleId === 'com.google.Chrome' }); } catch { /* unrelated app */ }
    }
  }
  return { operation:'browser-pool-inventory', resources, effects:'application-metadata-read-only' };
}

/** @param {string} home */
function database(home) {
  const root = realpathSync(resolve(home));
  let directory = root;
  for (const part of ['.development-system','private','browser-pool']) {
    directory = join(directory, part);
    if (existsSync(directory)) { const stat=lstatSync(directory); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe browser-pool state directory'); }
    else mkdirSync(directory, { mode:0o700 });
  }
  const file = join(directory, 'pool.sqlite');
  if (existsSync(file)) { const stat=lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe browser-pool database'); }
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  try {
    db.exec('PRAGMA busy_timeout=250; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL); INSERT OR IGNORE INTO state VALUES (1, 0, \'{"resources":[],"leases":[]}\');');
  } catch (error) { db.close(); throw new Error('Browser allocator is busy; retry this short allocation, without opening an unreserved browser', { cause:error }); }
  return db;
}

/**
 * Native computer-use holds the whole desktop until an application-confined
 * adapter is actually verified. Allocation leases are preparation only.
 * Expiry and owner death quarantine; neither authorizes stealing a browser.
 * @param {{home?:string, operation:string, input?:unknown}} options
 */
export function browserPool(options) {
  if (options.operation === 'inventory') return browserInventory();
  const db = database(options.home ?? homedir());
  try {
    const row = /** @type {{revision:number,body:string}} */ (db.prepare('SELECT revision, body FROM state WHERE id=1').get());
    const state = /** @type {{resources:Resource[],leases:Lease[]}} */ (JSON.parse(row.body));
    const now = Date.now();
    for (const lease of state.leases) if (lease.status === 'active' && (lease.expiresAt <= now || processStart(lease.pid) !== lease.processStart)) lease.status='quarantined';
    let result;
    if (options.operation === 'status') {
      result={ operation:'browser-pool-status', resources:state.resources, leases:state.leases, revision:row.revision, enforcement:'participating-launches-only', nativeComputerUse:'desktop-exclusive' };
    } else if (options.operation === 'register') {
      const input=record(options.input,['appPath','enabled','accounts','observedAt','evidence','dedicated']);
      if (typeof input.appPath !== 'string') throw new Error('appPath is required');
      const app=identifyApp(input.appPath);
      if (typeof input.enabled !== 'boolean') throw new Error('enabled must be explicit');
      if (input.enabled && input.dedicated !== true) throw new Error('Enabling requires an explicitly dedicated agent browser');
      const names=accounts(input.accounts ?? []);
      if (input.enabled && (!Number.isSafeInteger(input.observedAt) || input.observedAt > now || input.observedAt < now-MAX_OBSERVATION_AGE || typeof input.evidence !== 'string' || !input.evidence.startsWith(sep) || !lstatSync(input.evidence).isFile())) throw new Error('Enabling requires recent account/control observation and a local evidence file');
      if (state.leases.some(l=>l.resourceId===app.bundleId)) throw new Error('Cannot change a reserved or quarantined browser');
      const old=state.resources.find(r=>r.id===app.bundleId);
      const resource={ id:app.bundleId, ...app, enabled:input.enabled, accounts:names, observedAt:input.enabled?input.observedAt:0, evidence:input.enabled?input.evidence:'', lastUsed:old?.lastUsed??0 };
      state.resources=state.resources.filter(r=>r.id!==resource.id); state.resources.push(resource);
      result={ operation:'browser-pool-register', resource, accountVerification:'recorded-observation-only' };
    } else if (options.operation === 'acquire') {
      const input=record(options.input,['ownerId','ownerPid','purpose','accounts','resourceId','ttlSeconds']);
      const ownerId=text(input.ownerId,'ownerId');
      const start=processStart(input.ownerPid);
      if (!start) throw new Error('ownerPid must be a currently live local process');
      if (!['allocation','computer-use'].includes(input.purpose)) throw new Error('purpose must be allocation or computer-use');
      const required=accounts(input.accounts??[]);
      const resourceId=input.resourceId===undefined?undefined:text(input.resourceId,'resourceId');
      const ttl=input.ttlSeconds??3600;
      if (!Number.isSafeInteger(ttl)||ttl<30||ttl>14400) throw new Error('ttlSeconds must be 30..14400');
      const occupied=new Set(state.leases.map(l=>l.resourceId));
      const desktopBusy=state.leases.some(l=>l.purpose==='computer-use');
      const eligible=state.resources.filter(r=>r.enabled && r.observedAt>=now-MAX_OBSERVATION_AGE && required.every(a=>r.accounts.includes(a)) && !occupied.has(r.id) && (resourceId===undefined || r.id===resourceId)).sort((a,b)=>a.lastUsed-b.lastUsed||a.id.localeCompare(b.id));
      const resource=(!desktopBusy && (input.purpose!=='computer-use'||state.leases.length===0)) ? eligible.find(r=>{try{return identifyApp(r.appPath).bundleId===r.bundleId;}catch{return false;}}) : undefined;
      if (!resource) result={ operation:'browser-pool-acquire', status:'capacity-needed', reason:desktopBusy||input.purpose==='computer-use'&&state.leases.length>0?'desktop-reserved':'no-eligible-browser', queued:false };
      else {
        const lease=/** @type {Lease} */ ({ leaseId:randomUUID(), ownerId, generation:row.revision+1, resourceId:resource.id, purpose:input.purpose, status:'active', pid:input.ownerPid, processStart:start, expiresAt:now+ttl*1000 });
        resource.lastUsed=now; state.leases.push(lease);
        result={ operation:'browser-pool-acquire', status:'acquired', lease, resource, nativeConcurrencyVerified:false };
      }
    } else if (['release','quarantine','reconcile'].includes(options.operation)) {
      const input=record(options.input,['leaseId','ownerId','generation','operatorStopped','effectsReconciled']);
      const lease=state.leases.find(l=>l.leaseId===input.leaseId&&l.ownerId===input.ownerId&&l.generation===input.generation);
      if (!lease) throw new Error('Lease fencing mismatch; no resource changed');
      if (options.operation==='quarantine') lease.status='quarantined';
      else {
        if (input.operatorStopped!==true || input.effectsReconciled!==true) throw new Error('Release requires observed operator termination and reconciled effects');
        if (options.operation==='release' && lease.status!=='active') throw new Error('Quarantined resource requires explicit reconcile');
        state.leases=state.leases.filter(l=>l!==lease);
      }
      result={ operation:`browser-pool-${options.operation}`, resourceId:lease.resourceId, status:options.operation==='quarantine'?'quarantined':'released' };
    } else throw new Error(`Unknown browser-pool operation: ${options.operation}`);
    db.prepare('UPDATE state SET revision=?, body=? WHERE id=1').run(row.revision+1,JSON.stringify(state));
    db.exec('COMMIT');
    return result;
  } finally { db.close(); }
}
