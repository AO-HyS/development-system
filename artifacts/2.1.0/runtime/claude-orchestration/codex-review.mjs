// Codex review wrapper (operator-level, private).
// Runs one independent review with sequential local-profile availability recovery on Sol 6.1 High through `codex exec` in a read-only sandbox.
// The coordinator launches it with Bash run_in_background: true and is woken when it exits.
// Usage: node codex-review.mjs --accounts | [--computer-use] --packet <file> [--root <dir>] [--out <dir>] [--image <file>]...
// A review packet needs an Objective line and a `Task-Id: <slug>` line; rounds are keyed on
// (Task-Id, root), so rewording the objective does not reset them. A round counts only when it
// completes: Codex exits 0 and findings.md ends with `Verdict: merge` or `Verdict: do not merge`
// (rounds.jsonl). Any other ending is an attempt (attempts.jsonl) and does not count. From
// policy.review.roundsWithoutRationale complete rounds on, a review needs a "Round rationale:"
// line. A later round gets the latest complete round's findings (hash-checked) in its prompt
// and in previous-findings.md. --computer-use runs the packet as a Codex Computer Use operator:
// Task-Id optional, no rounds, at most policy.review.maxComputerUse live runs (one screen).
// The live-run caps (maxParallel reviews) are checked and reserved under an ownership-aware
// lock (pending/.lock), so simultaneous launches cannot both pass. --out (or the default
// runs/<runId>) is claimed atomically: it must be new or empty, and an exclusive .claim file
// refuses a second launch; a refusal after the claim leaves the directory burned. Refusals exit 2 before any launch. Prints one JSON receipt line: requested
// model and effort, the observed ones from the Codex session log ("unknown" if absent), and
// the outcome ("review" = complete round, "attempt" = not counted).
import { discoverAccounts, classifyAttempt } from './codex-accounts.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserPool } from '../../runtime/native-browser/pool.mjs';

const home = (p) => (String(p).startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
const POLICY = JSON.parse(fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
const REVIEW = POLICY.review ?? {};
const stateDir = home(REVIEW.stateDir ?? '~/.development-system/private/runs/codex-review');
const pendingDir = path.join(stateDir, 'pending');
const lockDir = path.join(pendingDir, '.lock');
const roundsFile = path.join(stateDir, 'rounds.jsonl');
const attemptsFile = path.join(stateDir, 'attempts.jsonl');
const COMPUTER_USE_PREAMBLE = (outDir) => `You are the computer-use operator. Use Codex Computer Use on this Mac to carry out the task below and observe the real result. Take only the actions the packet authorizes; stop and report before any destructive, production, payment or customer-facing action the packet does not explicitly authorize. Do not edit repository files. Save screenshots under ${outDir}. Report what you did, what you observed, and for each acceptance line: passed, failed or not reached.`;
const PREAMBLE = 'You are an independent reviewer. Do not edit files. Review the change described below against its requirements. Return findings ordered by severity (Critical, High, Medium, Low), each with file:line, the problem and the smallest fix. End with one line: `Verdict: merge` or `Verdict: do not merge` (plain text, as the last line).';
const VERDICT = /^Verdict: (merge|do not merge)\s*$/;
const TASK_ID = /^\s*Task-Id:\s*([a-z0-9][a-z0-9._-]{2,79})\s*$/im;
const PREVIOUS_CAP = 40000;
const LOCK_WAIT_MS = 10000;
const OWNERLESS_STALE_MS = 5000;

function refuse(message) {
  process.stderr.write(`codex-review: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { images: [], computerUse: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--accounts') { args.accounts = true; continue; }
    if (flag === '--computer-use') { args.computerUse = true; continue; }
    const value = argv[i + 1];
    if (!['--packet', '--root', '--out', '--image', '--browser-request'].includes(flag)) refuse(`unknown argument ${flag}. Usage: node codex-review.mjs --accounts | [--computer-use] --packet <file> [--root <dir>] [--out <dir>] [--image <file>]... [--browser-request <file>]`);
    if (value === undefined || value.startsWith('--')) refuse(`${flag} needs a value`);
    if (flag === '--image') args.images.push(path.resolve(value));
    else args[flag.slice(2)] = value;
    i += 1;
  }
  if (!args.packet && !args.accounts) refuse('--packet <file> is required');
  if (args['browser-request'] && (!args.computerUse || args.accounts)) refuse('--browser-request requires --computer-use with a task packet');
  return args;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// The verdict of a findings file: its last non-empty line, or null when absent or malformed.
function readVerdict(file) {
  try {
    const last = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).at(-1) ?? '';
    return last.match(VERDICT)?.[1] ?? null;
  } catch { return null; }
}

// The thread id is the first thread_id, or the id of a thread/session started event.
function threadId(eventsFile) {
  for (const event of readJsonLines(eventsFile)) {
    if (typeof event?.thread_id === 'string' && event.thread_id) return event.thread_id;
    if (/(thread|session).*start/i.test(String(event?.type ?? ''))) {
      const id = event.session_id ?? event.id ?? event.payload?.id ?? event.msg?.session_id;
      if (typeof id === 'string' && id) return id;
    }
  }
  return null;
}

// The last turn_context of the matching rollout in the three newest date directories.
function observedIdentity(id, selectedHome) {
  const unknown = { model: 'unknown', effort: 'unknown' };
  if (!id) return unknown;
  try {
    const sessions = path.join(selectedHome, 'sessions');
    const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^\d+$/.test(name)).sort() : []);
    const days = list(sessions).flatMap((y) => list(path.join(sessions, y)).flatMap((m) => list(path.join(sessions, y, m)).map((d) => path.join(sessions, y, m, d))));
    for (const day of days.slice(-3).reverse()) {
      const file = fs.readdirSync(day).find((name) => name.startsWith('rollout-') && name.endsWith(`${id}.jsonl`));
      if (!file) continue;
      const context = readJsonLines(path.join(day, file)).filter((row) => row?.type === 'turn_context').at(-1)?.payload ?? {};
      const effort = context.effort ?? context.reasoning_effort ?? context.model_reasoning_effort;
      return { model: typeof context.model === 'string' ? context.model : 'unknown', effort: typeof effort === 'string' ? effort : 'unknown' };
    }
  } catch { /* observation is best effort */ }
  return unknown;
}

// Reservation lock: a directory (mkdir is atomic) holding owner.json {pid, token, at}.
// A lock is reclaimed only when its owner pid is dead, or when owner.json is missing or
// unreadable and the directory is older than OWNERLESS_STALE_MS; a live owner is never
// reclaimed by age. Only the holder of the token releases it.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function readOwner(dir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8'));
    return Number.isInteger(owner?.pid) && typeof owner?.token === 'string' ? owner : null;
  } catch { return null; }
}

// Move the lock aside, then delete it only if it is still the one judged stale. If another
// launch took a fresh lock in between, put that one back instead of deleting it.
function reclaim(seenToken) {
  const safe = /^[a-f0-9]{1,64}$/.test(String(seenToken)) ? seenToken : 'none';
  const staleDir = `${lockDir}.stale-${safe}-${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(lockDir, staleDir); } catch { return; }
  if ((readOwner(staleDir)?.token ?? null) !== seenToken) {
    try { fs.renameSync(staleDir, lockDir); return; } catch { /* a newer lock exists; its owner will not release ours */ }
  }
  fs.rmSync(staleDir, { recursive: true, force: true });
}

function acquireLock() {
  const token = crypto.randomBytes(8).toString('hex');
  const deadline = Date.now() + LOCK_WAIT_MS;
  let holder = 'unknown';
  for (let attempt = 0; ; attempt += 1) {
    if (attempt > 0 && Date.now() >= deadline) return { refusal: `another codex-review launch holds the reservation lock (pid ${holder}). Launch this one again in a moment.` };
    let created = false;
    try {
      fs.mkdirSync(lockDir);
      created = true;
      const tmp = path.join(lockDir, `owner.${token}.tmp`);
      fs.writeFileSync(tmp, `${JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() })}\n`);
      fs.renameSync(tmp, path.join(lockDir, 'owner.json'));
      return { token };
    } catch (error) {
      if (created) { fs.rmSync(lockDir, { recursive: true, force: true }); throw error; }
      if (error?.code !== 'EEXIST') throw error;
    }
    const owner = readOwner(lockDir);
    if (owner) {
      if (!alive(owner.pid)) { reclaim(owner.token); continue; }
      holder = owner.pid;
    } else {
      let mtime;
      try { mtime = fs.statSync(lockDir).mtimeMs; } catch { continue; }
      if (Date.now() - mtime > OWNERLESS_STALE_MS) { reclaim(null); continue; }
    }
    sleep(50);
  }
}

function releaseLock(token) {
  if (readOwner(lockDir)?.token === token) fs.rmSync(lockDir, { recursive: true, force: true });
}

const args = parseArgs(process.argv.slice(2));
const inventory = discoverAccounts(REVIEW);
if (args.accounts) { process.stdout.write(`${JSON.stringify(inventory)}\n`); process.exit(0); }
const accountLimit = REVIEW.maxAccountAttempts ?? 2;
if (!Number.isInteger(accountLimit) || accountLimit < 1 || accountLimit > 2) refuse('review.maxAccountAttempts must be 1 or 2');
inventory.skipped.push(...inventory.accounts.slice(accountLimit).map((account) => ({ ...account, reason: 'outside two-profile recovery budget' })));
inventory.accounts = inventory.accounts.slice(0, accountLimit);
const packetFile = path.resolve(args.packet);
if (!fs.existsSync(packetFile)) refuse(`packet ${packetFile} does not exist`);
let packetBytes = fs.readFileSync(packetFile);
let packet = packetBytes.toString('utf8');
const objective = packet.match(/^\s*Objective:\s*(\S.*)$/m)?.[1];
if (!objective) refuse('the packet needs an "Objective: ..." line');
for (const image of args.images) if (!fs.existsSync(image)) refuse(`image ${image} does not exist`);
const root = fs.realpathSync(path.resolve(args.root ?? process.cwd()));
if (!fs.existsSync(root)) refuse(`root ${root} does not exist`);

const mode = args.computerUse ? 'computer-use' : 'review';
const kind = mode;
const taskId = packet.match(TASK_ID)?.[1]?.toLowerCase() ?? null;
if (mode === 'review' && !taskId) refuse('the packet needs a `Task-Id: <slug>` line (lowercase letters, digits, . _ -, 3-80 chars); keep it across rewordings and rounds of the same task');

// Rounds (review mode only): complete rounds of (taskId, root); legacy rows without taskId are ignored.
let round = null;
let previous = null;
if (mode === 'review') {
  const complete = readJsonLines(roundsFile).filter((row) => row?.taskId === taskId && row?.root === root);
  round = complete.length + 1;
  previous = complete.at(-1) ?? null;
  const roundRationale = /^\s*Round rationale:\s*\S/m.test(packet);
  if (complete.length >= (REVIEW.roundsWithoutRationale ?? 3) && !roundRationale) {
    refuse(`Round ${round} of task ${taskId}: ${complete.length} complete rounds already ran. A complete round is not approval; it only means a review returned a verdict. Add \`Round rationale: <open critical or high finding>\`, or record the remaining findings as documented gaps or next-version work.`);
  }
}

const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;

// Claim the output directory atomically before anything is written: create it (parent
// recursive, the directory itself not), require it empty, then create .claim exclusively.
// Two launches with the same --out cannot both pass; .claim stays to mark the directory used.
const outDir = path.resolve(args.out ?? path.join(stateDir, 'runs', runId));
function claimOutDir() {
  try {
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    try { fs.mkdirSync(outDir); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const entries = fs.readdirSync(outDir);
    if (entries.includes('.claim')) return `--out ${outDir} is already claimed by another codex-review launch`;
    if (entries.length > 0) return `--out must be a new or empty directory (${outDir} has ${entries.length} entries)`;
    fs.writeFileSync(path.join(outDir, '.claim'), JSON.stringify({ pid: process.pid, runId, at: new Date().toISOString() }), { flag: 'wx' });
    return null;
  } catch (error) {
    if (error?.code === 'EEXIST') return `--out ${outDir} is already claimed by another codex-review launch`;
    return `--out ${outDir} is not a usable directory (${error?.code ?? error})`;
  }
}
const claimRefusal = claimOutDir();
if (claimRefusal) refuse(claimRefusal);
const requested = { model: REVIEW.model ?? 'gpt-6.1-sol', effort: REVIEW.effort ?? 'high' };
const marker = path.join(pendingDir, `${runId}.json`);
const removeMarker = () => { try { fs.rmSync(marker, { force: true }); } catch { /* best effort */ } };

// Caps, under the lock: count live pending markers by kind (a marker without a kind is a
// review), drop dead ones, check the cap, write ours. Returns a refusal message or null; the
// caller refuses only after the lock is released.
function reserve() {
  fs.mkdirSync(pendingDir, { recursive: true });
  const lock = acquireLock();
  if (lock.refusal) return lock.refusal;
  try {
    const running = { review: 0, 'computer-use': 0 };
    for (const name of fs.readdirSync(pendingDir).filter((n) => n.endsWith('.json'))) {
      const markerFile = path.join(pendingDir, name);
      let data = {};
      try { data = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch { /* unreadable marker */ }
      if (alive(Number(data?.pid))) running[data?.kind === 'computer-use' ? 'computer-use' : 'review'] += 1;
      else fs.rmSync(markerFile, { force: true });
    }
    if (mode === 'computer-use') {
      const maxComputerUse = REVIEW.maxComputerUse ?? 1;
      if (running['computer-use'] >= maxComputerUse) return `a computer-use run is already active (cap ${maxComputerUse}). Launch this one after it exits.`;
    } else {
      const maxParallel = REVIEW.maxParallel ?? 5;
      if (running.review >= maxParallel) return `${running.review} reviews are already running (parallel cap ${maxParallel}). Launch this one after one of them exits.`;
    }
    fs.writeFileSync(marker, `${JSON.stringify({ pid: process.pid, kind, taskId, objective: objective.slice(0, 300), root, startedAt: new Date().toISOString() })}\n`);
    return null;
  } finally {
    releaseLock(lock.token);
  }
}
const refusal = reserve();
if (refusal) refuse(refusal);

// Scoped pool launches remain desktop-exclusive: the native runtime still has
// a global computer surface. App allocation alone cannot remove that guard.
let browserAssignment = null;
if (args['browser-request']) {
  try {
    const input = JSON.parse(fs.readFileSync(path.resolve(args['browser-request']), 'utf8'));
    const allocated = browserPool({ operation:'acquire', input:{ ...input, ownerId:runId, ownerPid:process.pid, purpose:'computer-use' } });
    if (allocated.status !== 'acquired') { removeMarker(); refuse(`browser capacity needed: ${allocated.reason}; no browser was opened or queued`); }
    browserAssignment = allocated;
    const resource = allocated.resource;
    packet += `\nBrowser assignment: ${resource.bundleId}\nBrowser application: ${resource.appPath}\nBrowser recorded accounts: ${resource.accounts.join(', ') || 'none required'}\nBrowser scope: use only the assigned application. Verify the exact controllable account before effects; a registration receipt is not fresh account acceptance. Do not use the personal Chrome or another browser. End with 'Browser lease: quiescent' only after all browser actions, dialogs and downloads have stopped and all effects are reconciled; otherwise report reconciliation required.\n`;
    packetBytes = Buffer.from(packet);
  } catch (error) { removeMarker(); refuse(`browser reservation failed: ${error.message}`); }
}

const files = Object.fromEntries(['packet.md', 'findings.md', 'events.jsonl', 'stderr.log', 'receipt.json', 'previous-findings.md'].map((name) => [name, path.join(outDir, name)]));
fs.writeFileSync(files['packet.md'], packetBytes);
const preamble = mode === 'computer-use' ? COMPUTER_USE_PREAMBLE(outDir) : PREAMBLE;

// Previous findings: the latest complete round's findings, only if unchanged since it ended.
// Earlier run directories are only read, never modified.
let previousSection = '';
if (previous) {
  let text = null;
  try {
    const buffer = fs.readFileSync(String(previous.findingsPath));
    if (sha256(buffer) === previous.findingsSha256) text = buffer.toString('utf8');
  } catch { /* moved or unreadable */ }
  if (text === null) {
    previousSection = '\n\nPrevious round findings are unavailable (moved or changed).';
  } else {
    if (text.length > PREVIOUS_CAP) text = `${text.slice(0, PREVIOUS_CAP)}\n[truncated]`;
    fs.writeFileSync(files['previous-findings.md'], text);
    previousSection = `\n\n## Previous round findings (round ${round - 1}, run ${previous.runId})\n\n${text}\n\nFor each previous finding, state: fixed, still open, or dismissed with the reason. Then list new findings separately.`;
  }
}

const started = Date.now();
let child = null;
let cancelling = false;
let cancelCode = null;
const attempts = [];
const signalChild = (signal) => { if (!child?.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } } };
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    if (cancelling) return;
    cancelling = true;
    cancelCode = code;
    signalChild(signal);
    const timer = setTimeout(() => signalChild('SIGKILL'), 10000);
    timer.unref();
    child?.once('close', () => clearTimeout(timer));
  });
}
let exitCode = 1;
let reason = null;
let observed = { model: 'unknown', effort: 'unknown' };
let verdict = null;
let eligible = inventory.accounts.length === 0;
try {
  for (const [index, account] of inventory.accounts.entries()) {
    if (cancelling) break;
    const attemptDir = path.join(outDir, `attempt-${index + 1}`);
    fs.mkdirSync(attemptDir);
    const paths = Object.fromEntries(['events.jsonl', 'stderr.log', 'findings.md'].map((name) => [name, path.join(attemptDir, name)]));
    const events = fs.openSync(paths['events.jsonl'], 'w');
    const stderr = fs.openSync(paths['stderr.log'], 'w');
    let spawnError = null;
    let childSignal = null;
    const env = { ...process.env, CODEX_HOME: account.home };
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    const codexArgs = ['exec', '-m', requested.model, '-c', `model_reasoning_effort="${requested.effort}"`, '-s', 'read-only', '-C', root,
      '--skip-git-repo-check', '--json', '-o', paths['findings.md'], ...args.images.flatMap((image) => ['-i', image]), '-'];
    try {
      exitCode = await new Promise((resolve) => {
        child = spawn('codex', codexArgs, { cwd: root, env, stdio: ['pipe', events, stderr], detached: true });
        child.on('error', (error) => { spawnError = error.code ?? 'spawn failure'; });
        // close, including spawn failure, is the barrier before another account starts.
        child.once('close', (code, signal) => { childSignal = signal; signalChild('SIGKILL'); child = null; resolve(code ?? (spawnError ? 127 : signal ? 1 : 0)); });
        child.stdin.on('error', () => { /* exited before reading */ });
        child.stdin.end(`${preamble}\n\n${packet}${previousSection}`);
      });
    } finally { fs.closeSync(events); fs.closeSync(stderr); }
    observed = observedIdentity(threadId(paths['events.jsonl']), account.home);
    verdict = readVerdict(paths['findings.md']);
    const classified = cancelling ? { classification: 'cancelled', retryEligible: false, reason: 'cancelled' }
      : classifyAttempt({ eventsFile: paths['events.jsonl'], stderrFile: paths['stderr.log'], exitCode, spawnError, signal: childSignal, mode, verdict });
    attempts.push({ accountIndex: index + 1, home: account.home, authPath: account.authPath, exitCode, ...classified, observed,
      eventsPath: paths['events.jsonl'], stderrPath: paths['stderr.log'], findingsPath: paths['findings.md'] });
    reason = classified.reason;
    eligible = classified.retryEligible;
    if (classified.classification === 'succeeded') {
      if (fs.existsSync(paths['findings.md'])) fs.copyFileSync(paths['findings.md'], files['findings.md']);
      eligible = false;
      break;
    }
    if (!eligible || spawnError === 'ENOENT') break;
  }
} catch (error) {
  reason = 'local_failure'; eligible = false; exitCode = 1;
  if (child) {
    const closing = new Promise((resolve) => child.once('close', resolve));
    signalChild('SIGKILL');
    await closing;
  }
}
if (cancelling) { eligible = false; exitCode = cancelCode; reason = 'cancelled'; }
const succeeded = attempts.at(-1)?.classification === 'succeeded' && !cancelling;
let browserLeaseState = null;
if (browserAssignment) {
  // No receipt-bound native fallback transfer exists for assigned browsers.
  // Preserve uncertain ownership rather than dispatching outside the broker.
  const finalDeclaration = (fs.existsSync(files['findings.md']) ? fs.readFileSync(files['findings.md'], 'utf8') : '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  const reconciled = succeeded && finalDeclaration === 'Browser lease: quiescent';
  const lease = browserAssignment.lease;
  try {
    browserLeaseState = browserPool({ operation:reconciled?'release':'quarantine', input:{ leaseId:lease.leaseId, ownerId:lease.ownerId, generation:lease.generation, operatorStopped:true, effectsReconciled:reconciled } }).status;
  } catch { browserLeaseState = 'reconciliation-required'; }
  if (eligible) { eligible = false; reason = 'pooled_fallback_requires_ownership_transfer'; exitCode = 1; }
}
if (eligible) { exitCode = 75; reason = reason ?? 'No local authenticated Codex profiles discovered'; }
else if (!succeeded && exitCode === 0) exitCode = 1;
let outcome = mode === 'review' ? (succeeded && verdict ? 'review' : 'attempt') : null;
let recordError = null;
try {
  const at = new Date().toISOString();
  if (outcome === 'review') fs.appendFileSync(roundsFile, `${JSON.stringify({ taskId, root, runId, verdict, findingsPath: files['findings.md'], findingsSha256: sha256(fs.readFileSync(files['findings.md'])), at })}\n`);
  else if (outcome === 'attempt') fs.appendFileSync(attemptsFile, `${JSON.stringify({ taskId, root, runId, exitCode, reason, at })}\n`);
} catch (error) { recordError = 'round_record_failed'; }
const packetSha256 = sha256(packetBytes);
const receipt = {
  schemaVersion: 2, status: eligible ? 'fallback_required' : succeeded ? 'succeeded' : 'failed', reason, exitCode,
  root, packetPath: files['packet.md'], packetSha256, mode, taskId, outcome, verdict, requested, observed,
  accounts: inventory.accounts, skippedAccounts: inventory.skipped, attempts, findings: files['findings.md'], round,
  ...(recordError ? { recordError } : {}), seconds: Math.round((Date.now() - started) / 1000), runId,
  ...(browserAssignment ? { browserAssignment, browserLeaseState, browserEnforcement:'participating-launches-only; desktop-exclusive; no native confinement claim' } : {}),
  ...(eligible ? { fallback: { eligible: true, role: mode === 'computer-use' ? 'browser-qa' : args.images.length ? 'visual-reviewer' : 'reviewer',
    reason, receiptPath: files['receipt.json'], packetPath: files['packet.md'], packetSha256,
    prompt: `${packet}\nCodex fallback: ${reason}\nCodex fallback receipt: ${files['receipt.json']}\nCodex fallback packet: ${files['packet.md']}\n` } } : {}),
};
try { fs.writeFileSync(files['receipt.json'], `${JSON.stringify(receipt, null, 2)}\n`); }
finally { removeMarker(); }
process.stdout.write(`${JSON.stringify(receipt)}\n`);
process.exitCode = exitCode;
