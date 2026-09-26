// Codex review wrapper (operator-level, private).
// Runs one independent review on Astra XHigh through `codex exec` in a read-only sandbox.
// The coordinator launches it with Bash run_in_background: true and is woken when it exits.
// Usage: node codex-review.mjs [--computer-use] --packet <file> [--root <dir>] [--out <dir>] [--image <file>]...
// --computer-use runs the packet as a Codex Computer Use operator instead of a reviewer: no
// round tracking, and at most policy.review.maxComputerUse live runs (one screen).
// Refuses (exit 2, before any launch) a packet without an Objective line, a fourth or later
// round of the same objective without a "Round rationale:" line, and more than
// policy.review.maxParallel reviews at once. Prints one JSON receipt line: requested model
// and effort, and the observed ones read from the Codex session log ("unknown" if absent).
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
const COMPUTER_USE_PREAMBLE = (outDir) => `You are the computer-use operator. Use Codex Computer Use on this Mac to carry out the task below and observe the real result. Take only the actions the packet authorizes; stop and report before any destructive, production, payment or customer-facing action the packet does not explicitly authorize. Do not edit repository files. Save screenshots under ${outDir}. Report what you did, what you observed, and for each acceptance line: passed, failed or not reached.`;
const PREAMBLE = 'You are an independent reviewer. Do not edit files. Review the change described below against its requirements. Return findings ordered by severity (Critical, High, Medium, Low), each with file:line, the problem and the smallest fix. End with one line: `Verdict: merge` or `Verdict: do not merge`.';

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

// Rounds (review mode only): from roundsWithoutRationale earlier rounds on, a round needs a rationale.
fs.mkdirSync(pendingDir, { recursive: true });
const roundsFile = path.join(stateDir, 'rounds.jsonl');
const objectiveKey = objective.trim().toLowerCase().slice(0, 120);
let round = null;
if (mode === 'review') {
  const earlier = readJsonLines(roundsFile).filter((row) => row?.objectiveKey === objectiveKey && row?.root === root).length;
  round = earlier + 1;
  const roundRationale = /^\s*Round rationale:\s*\S/m.test(packet);
  if (earlier >= (REVIEW.roundsWithoutRationale ?? 3) && !roundRationale) {
    refuse(`Round ${round} of this objective: add \`Round rationale: <open critical or high finding>\`, or record the remaining findings as documented gaps or next-version work.`);
  }
}

// Caps: live pending markers by kind (a marker without a kind is a review); dead ones are removed.
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
  if (running['computer-use'] >= maxComputerUse) refuse(`a computer-use run is already active (cap ${maxComputerUse}). Launch this one after it exits.`);
} else {
  const maxParallel = REVIEW.maxParallel ?? 5;
  if (running.review >= maxParallel) refuse(`${running.review} reviews are already running (parallel cap ${maxParallel}). Launch this one after one of them exits.`);
}

const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
const outDir = path.resolve(args.out ?? path.join(stateDir, 'runs', runId));
fs.mkdirSync(outDir, { recursive: true });
const files = Object.fromEntries(['packet.md', 'findings.md', 'events.jsonl', 'stderr.log', 'receipt.json'].map((name) => [name, path.join(outDir, name)]));
fs.writeFileSync(files['packet.md'], packet);
const preamble = mode === 'computer-use' ? COMPUTER_USE_PREAMBLE(outDir) : PREAMBLE;

const requested = { model: REVIEW.model ?? 'gpt-6-astra', effort: REVIEW.effort ?? 'xhigh' };
const marker = path.join(pendingDir, `${runId}.json`);
const removeMarker = () => { try { fs.rmSync(marker, { force: true }); } catch { /* best effort */ } };
fs.writeFileSync(marker, `${JSON.stringify({ pid: process.pid, kind, objective: objective.slice(0, 300), root, startedAt: new Date().toISOString() })}\n`);

const started = Date.now();
let child = null;
let childExited = false;
let finalized = false;
// The child leads its own process group, so a signal reaches everything Codex started.
const signalChild = (signal) => { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } } };
const childAlive = () => child && !childExited && child.exitCode === null && child.signalCode === null;

// One finalizer for every ending: terminate a live child, write the receipt, remove the marker.
function finalize(exitCode, reason = null) {
  if (finalized) return;
  finalized = true;
  if (child?.pid) signalChild('SIGKILL');
  let observed = { model: 'unknown', effort: 'unknown' };
  try { observed = observedIdentity(threadId(files['events.jsonl'])); } catch { /* best effort */ }
  const receipt = {
    status: exitCode === 0 && !reason ? 'succeeded' : 'failed',
    ...(reason ? { reason } : {}),
    exitCode,
    mode,
    requested,
    observed,
    findings: files['findings.md'],
    round,
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
    child.on('spawn', guard(() => {
      // A review round counts only when Codex actually launched.
      if (mode === 'review') fs.appendFileSync(roundsFile, `${JSON.stringify({ objectiveKey, root, at: new Date().toISOString() })}\n`);
    }));
    child.on('error', guard((error) => {
      resolve(127);
      fs.appendFileSync(files['stderr.log'], `codex-review: could not run codex: ${error.message}\n`);
    }));
    child.on('exit', () => { childExited = true; });
    child.on('close', guard((code, signal) => resolve(code ?? (signal ? 1 : 0))));
    child.stdin.on('error', () => { /* codex exited before reading the prompt */ });
    child.stdin.end(`${preamble}\n\n${packet}`);
  });
  try { fs.closeSync(events); fs.closeSync(stderr); } catch { /* best effort */ }
} catch (error) {
  failure = String(error?.message ?? error).slice(0, 200);
  exitCode = exitCode === 0 ? 1 : exitCode;
} finally {
  if (!cancelling) finalize(exitCode, failure);
}
if (!cancelling) process.exitCode = exitCode;
