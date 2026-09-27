// Codex review wrapper (operator-level, private).
// Runs one independent review on Astra XHigh through `codex exec` in a read-only sandbox.
// The coordinator launches it with Bash run_in_background: true and is woken when it exits.
// Usage: node codex-review.mjs [--computer-use] --packet <file> [--root <dir>] [--out <dir>] [--image <file>]...
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
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    if (flag === '--computer-use') { args.computerUse = true; continue; }
    const value = argv[i + 1];
    if (!['--packet', '--root', '--out', '--image'].includes(flag)) refuse(`unknown argument ${flag}. Usage: node codex-review.mjs [--computer-use] --packet <file> [--root <dir>] [--out <dir>] [--image <file>]...`);
    if (value === undefined || value.startsWith('--')) refuse(`${flag} needs a value`);
    if (flag === '--image') args.images.push(path.resolve(value));
    else args[flag.slice(2)] = value;
    i += 1;
  }
  if (!args.packet) refuse('--packet <file> is required');
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
function observedIdentity(id) {
  const unknown = { model: 'unknown', effort: 'unknown' };
  if (!id) return unknown;
  try {
    const sessions = path.join(process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex'), 'sessions');
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
const packetFile = path.resolve(args.packet);
if (!fs.existsSync(packetFile)) refuse(`packet ${packetFile} does not exist`);
const packet = fs.readFileSync(packetFile, 'utf8');
const objective = packet.match(/^\s*Objective:\s*(\S.*)$/m)?.[1];
if (!objective) refuse('the packet needs an "Objective: ..." line');
for (const image of args.images) if (!fs.existsSync(image)) refuse(`image ${image} does not exist`);
const root = path.resolve(args.root ?? process.cwd());
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
const requested = { model: REVIEW.model ?? 'gpt-6-astra', effort: REVIEW.effort ?? 'xhigh' };
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

const files = Object.fromEntries(['packet.md', 'findings.md', 'events.jsonl', 'stderr.log', 'receipt.json', 'previous-findings.md'].map((name) => [name, path.join(outDir, name)]));
fs.writeFileSync(files['packet.md'], packet);
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
let childExited = false;
let finalized = false;
// The child leads its own process group, so a signal reaches everything Codex started.
const signalChild = (signal) => { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } } };
const childAlive = () => child && !childExited && child.exitCode === null && child.signalCode === null;

// One finalizer for every ending: terminate a live child, record the round or attempt, write
// the receipt, remove the marker.
function finalize(exitCode, reason = null) {
  if (finalized) return;
  finalized = true;
  if (child?.pid) signalChild('SIGKILL');
  let observed = { model: 'unknown', effort: 'unknown' };
  try { observed = observedIdentity(threadId(files['events.jsonl'])); } catch { /* best effort */ }
  const verdict = readVerdict(files['findings.md']);
  let outcome = null;
  let recordError = null;
  if (mode === 'review') {
    const at = new Date().toISOString();
    outcome = exitCode === 0 && !reason && verdict ? 'review' : 'attempt';
    try {
      if (outcome === 'review') {
        const findingsSha256 = sha256(fs.readFileSync(files['findings.md']));
        fs.appendFileSync(roundsFile, `${JSON.stringify({ taskId, root, runId, verdict, findingsPath: files['findings.md'], findingsSha256, at })}\n`);
      } else {
        const why = reason ?? (exitCode !== 0 ? `exit ${exitCode}` : 'no verdict');
        fs.appendFileSync(attemptsFile, `${JSON.stringify({ taskId, root, runId, exitCode, reason: why, at })}\n`);
      }
    } catch (error) { recordError = String(error?.message ?? error).slice(0, 200); }
  }
  const receipt = {
    status: exitCode === 0 && !reason ? 'succeeded' : 'failed',
    ...(reason ? { reason } : {}),
    exitCode,
    mode,
    taskId,
    outcome,
    verdict,
    requested,
    observed,
    findings: files['findings.md'],
    round,
    ...(recordError ? { recordError } : {}),
    seconds: Math.round((Date.now() - started) / 1000),
    runId,
  };
  try { fs.writeFileSync(files['receipt.json'], `${JSON.stringify(receipt, null, 2)}\n`); } catch { /* best effort */ }
  removeMarker();
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

// On a signal: pass it to the child, wait up to 10 s for its exit (then SIGKILL), write a
// cancelled receipt, remove the marker, then exit.
let cancelling = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    if (cancelling) return;
    cancelling = true;
    const done = () => { finalize(code, 'cancelled'); process.exit(code); };
    if (!childAlive()) { done(); return; }
    const timer = setTimeout(() => { signalChild('SIGKILL'); done(); }, 10000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    signalChild(signal);
  });
}

let exitCode = 1;
let failure = null;
try {
  const events = fs.openSync(files['events.jsonl'], 'w');
  const stderr = fs.openSync(files['stderr.log'], 'w');
  const codexArgs = ['exec', '-m', requested.model, '-c', `model_reasoning_effort="${requested.effort}"`, '-s', 'read-only', '-C', root,
    '--skip-git-repo-check', '--json', '-o', files['findings.md'], ...args.images.flatMap((image) => ['-i', image]), '-'];
  exitCode = await new Promise((resolve) => {
    // Callback work is guarded: any failure resolves through the one finalizer.
    const guard = (fn) => (...a) => { try { fn(...a); } catch (error) { failure = `callback: ${String(error?.message ?? error).slice(0, 200)}`; resolve(1); } };
    child = spawn('codex', codexArgs, { cwd: root, stdio: ['pipe', events, stderr], detached: true });
    child.on('error', guard((error) => {
      resolve(127);
      fs.appendFileSync(files['stderr.log'], `codex-review: could not run codex: ${error.message}\n`);
    }));
    child.on('exit', () => { childExited = true; });
    child.on('close', guard((code, signal) => resolve(code ?? (signal ? 1 : 0))));
    child.stdin.on('error', () => { /* codex exited before reading the prompt */ });
    child.stdin.end(`${preamble}\n\n${packet}${previousSection}`);
  });
  try { fs.closeSync(events); fs.closeSync(stderr); } catch { /* best effort */ }
} catch (error) {
  failure = String(error?.message ?? error).slice(0, 200);
  exitCode = exitCode === 0 ? 1 : exitCode;
} finally {
  if (!cancelling) finalize(exitCode, failure);
}
if (!cancelling) process.exitCode = exitCode;
