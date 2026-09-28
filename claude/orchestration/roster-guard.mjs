// Claude Code orchestration guard (operator-level, private).
// PreToolUse Agent: only roster roles at their fixed model; writer packets carry owned
// paths (one path token per entry) and a finish line and never share a path with an
// active writer; Jev classifies writer/planner packets (with the active write sets) and
// picks the model tier (Sonnet, Opus low/medium/high, Fable) for implement, plan and
// review work, using the operator's memory of how similar packets went. With jev.mode
// "advisory" (1.35.0) its route and tier are advice recorded against its receipt and
// shown to the coordinator; only "gate" refuses. With policy.review.engine "codex",
// reviews go to codex-review (Astra XHigh): retired reviewers are refused and Claude
// reviewers and browser-qa need a "Codex fallback:" line (then skip Jev); computer use
// goes to codex-review --computer-use.
// PreToolUse Read/screenshot: per-agent image budget, with the coordinator nearly
// image-free. PostToolUse Agent and SubagentStop: ledger with the observed model and
// release of the writer's paths; an expired hold is logged as writer-hold-expired.
// Every read-modify-write of active-writers.json runs under one session lock directory.
// CLI mode `mapper-bash` (code-mapper frontmatter hook): PreToolUse Bash limited to
// read-only git commands, typechecks and jevgrep (`jg "<question>" <relative root>`).
// CLI mode `writer-bash` (writer frontmatter hook): PreToolUse Bash denies git commands
// that change the index, refs or worktree; the coordinator owns staging and commits.
// Internal failures allow the call and are logged: the guard never breaks the host.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// Policy paths starting with ~/ resolve against the HOME the guard runs under.
const home = (p) => (String(p).startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
const POLICY = JSON.parse(fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
POLICY.stateDir = home(POLICY.stateDir);
POLICY.jev.cli = home(POLICY.jev.cli);
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const SCREENSHOT_TOOL = /screenshot/i;

// Emergency switch: CLAUDE_ROSTER_GUARD=off in ~/.claude/settings.json env disables it.
if (process.env.CLAUDE_ROSTER_GUARD === 'off') process.exit(0);
const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const session = String(input.session_id ?? 'unknown').replace(/[^\w-]/g, '').slice(0, 64) || 'unknown';
const sessionDir = path.join(POLICY.stateDir, session);

function ledger(entry) {
  fs.mkdirSync(POLICY.stateDir, { recursive: true });
  fs.appendFileSync(path.join(POLICY.stateDir, 'ledger.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), session, ...entry })}\n`);
}
function deny(reason, entry) {
  ledger({ decision: 'deny', ...entry, reason });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}
function allow(context, entry) {
  if (entry) ledger({ decision: 'allow', ...entry });
  if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', additionalContext: context } }));
  process.exit(0);
}

const rosterList = Object.entries(POLICY.roster).filter(([, r]) => !r.retired).map(([name, r]) => `${name} (${r.model})`).join(', ');
const agentsForRoute = (route) => Object.entries(POLICY.roster).filter(([, r]) => r.route === route).map(([n]) => n);

// Packet lists: entries on the label line separated by commas and/or following "- "
// lines; the list ends at a blank line or the next "Header:" line. Each entry is one path
// token (optional backticks) with `*` inside a segment and a trailing `/**` as the only
// globs; prose is rejected, never guessed at. Absolute paths inside cwd become relative;
// outside it they stay absolute (held, but not sent to Jev, which takes repo paths only).
// "none" is an empty list except for Owned paths.
const LIST_HEADER = /^[A-Z][\w /-]*:/;
const OWNED_FORMAT = 'Owned paths must be one path per entry: `Owned paths: src/a.ts, src/b/**` or one `- path` line each.';
function listPath(token, cwd) {
  if (!token || /[\s`[\]?{}\\]/.test(token)) return null;
  let p = token.replace(/\/\*\*$/, '');
  if (p.includes('**')) return null;
  p = p.replace(/\/+$/, '').replace(/^(\.\/)+/, '');
  if (p.split('/').slice(path.isAbsolute(p) ? 1 : 0).some((part) => !part || part === '.' || part === '..')) return null;
  if (!path.isAbsolute(p)) return p;
  const rel = path.relative(cwd, p);
  return rel === '..' || rel.startsWith('../') || path.isAbsolute(rel) ? p : rel;
}
function packetList(prompt, label, cwd) {
  const lines = String(prompt).replace(/\r\n?/g, '\n').split('\n');
  const head = new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${label}:(?:\\*\\*)?`);
  let at = lines.findIndex((line) => head.test(line));
  let first = at >= 0 ? lines[at].replace(head, '') : null;
  if (at < 0) {
    at = lines.findIndex((line) => line.includes(`${label}:`));
    if (at < 0) return { paths: [], rejected: [] };
    first = lines[at].slice(lines[at].indexOf(`${label}:`) + label.length + 1);
  }
  const entries = first.split(',');
  const rejected = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || LIST_HEADER.test(line)) break;
    if (/^\s*- /.test(line)) entries.push(...line.replace(/^\s*- /, '').split(','));
    else rejected.push(line.trim());
  }
  const paths = [];
  for (const entry of entries.map((e) => e.trim()).filter(Boolean)) {
    const token = entry.replace(/^`([^`]*)`$/, '$1');
    if (token === 'none') { if (label === 'Owned paths') rejected.push(entry); continue; }
    const p = listPath(token, cwd);
    if (p === null) rejected.push(entry); else if (p) paths.push(p);
  }
  return { paths: [...new Set(paths)].slice(0, 40), rejected };
}
const ownedPaths = (prompt, cwd) => packetList(prompt, 'Owned paths', cwd).paths;
const repoPaths = (paths) => paths.filter((p) => !path.isAbsolute(p));

// Active writers of this session, so parallel packets never share a path and Jev can
// judge semantic overlap. Entries end on the Agent result or on SubagentStop. A lost
// release (interrupted turn, crashed agent) must not hold a path: a foreground entry
// that never got an agent id is stale after a few minutes (the coordinator cannot
// dispatch while its foreground agents run), and a background one is stale once its
// transcript stops moving. A background dispatch (run_in_background) that never got an
// agent id has no transcript to watch: it holds until maxHours or an explicit release.
const ACTIVE = path.join(sessionDir, 'active-writers.json');
const STALE = POLICY.staleWriter ?? { foregroundMinutes: 5, idleMinutes: 30, maxHours: 2 };
function transcriptMtime(agentId) {
  if (!agentId || !input.transcript_path) return null;
  const file = path.join(path.dirname(input.transcript_path), session, 'subagents', `agent-${agentId}.jsonl`);
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}
// Null while the hold is alive, else why it expired.
function staleReason(w) {
  const now = Date.now();
  if (w.at < now - STALE.maxHours * 3600e3) return 'maxHours';
  if (!w.agentId) {
    if (w.background === true) return null;
    return w.at > now - STALE.foregroundMinutes * 60e3 ? null : 'foreground';
  }
  const moved = transcriptMtime(w.agentId) ?? w.at;
  return moved > now - STALE.idleMinutes * 60e3 ? null : 'idle';
}
// An expired hold is logged once and dropped from the saved map. Call under the lock:
// only the process that actually removes the entry logs it.
function prunedActive() {
  const all = fs.existsSync(ACTIVE) ? JSON.parse(fs.readFileSync(ACTIVE, 'utf8')) : {};
  const kept = {};
  let expired = false;
  for (const [key, w] of Object.entries(all)) {
    const reason = staleReason(w);
    if (!reason) { kept[key] = w; continue; }
    ledger({ event: 'writer-hold-expired', toolUseId: key, id: w.id ?? null, type: w.type ?? null, writeSet: w.writeSet ?? null, reason });
    expired = true;
  }
  if (expired) saveActive(kept);
  return kept;
}
// Without the lock, a reader sees the saved holds but prunes and saves nothing.
const activeWriters = () => withActiveLock(prunedActive, () => (fs.existsSync(ACTIVE) ? JSON.parse(fs.readFileSync(ACTIVE, 'utf8')) : {}));

// Session lock for active-writers.json: a directory with owner.json {pid, token}. A dead
// owner (or a missing owner.json older than 5 s) is reclaimed by rename then removal.
// After 2 s the call proceeds unlocked and logs active-lock-timeout: never stall a hook.
const LOCK = `${ACTIVE}.lock`;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function lockIsStale() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner.json'), 'utf8'));
    try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
  } catch {
    try { return fs.statSync(LOCK).mtimeMs < Date.now() - 5000; } catch { return false; }
  }
}
// fn runs only while this process owns the lock; on timeout onTimeout runs instead
// (default: skip the update), so a delayed process never overwrites newer state.
function withActiveLock(fn, onTimeout = () => undefined) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + 2000;
  let held = false;
  fs.mkdirSync(sessionDir, { recursive: true });
  while (!held) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
      held = true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (lockIsStale()) {
        const stale = `${LOCK}.stale-${token}`;
        try { fs.renameSync(LOCK, stale); fs.rmSync(stale, { recursive: true, force: true }); } catch { /* another process reclaimed it */ }
        continue;
      }
      if (Date.now() >= deadline) break;
      pause(20);
    }
  }
  if (!held) { ledger({ event: 'active-lock-timeout' }); return onTimeout(); }
  try { return fn(); } finally {
    if (held) {
      try {
        const owner = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner.json'), 'utf8'));
        if (owner.token === token) fs.rmSync(LOCK, { recursive: true, force: true });
      } catch { /* lock already gone */ }
    }
  }
}

// Jev may refuse, but it must never stall the work: the same packet is refused at most
// once, and after maxRefusalsPerSession refusals Jev only advises for the rest of the
// session. mode "advisory" never refuses; "off" skips Jev entirely.
const REFUSALS = path.join(sessionDir, 'jev-refusals.json');
const refusals = () => (fs.existsSync(REFUSALS) ? JSON.parse(fs.readFileSync(REFUSALS, 'utf8')) : { count: 0, keys: [] });
function recordRefusal(key) {
  const r = refusals();
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(REFUSALS, JSON.stringify({ count: r.count + 1, keys: [...r.keys, key].slice(-50) }));
}
function saveActive(all) { fs.mkdirSync(sessionDir, { recursive: true }); fs.writeFileSync(ACTIVE, JSON.stringify(all)); }
const clashes = (active, owned) => [...new Set(Object.values(active).flatMap((w) => w.writeSet.flatMap((a) => owned.filter((b) => pathsOverlap(a, b)).map((b) => `${b} (held by ${w.type} "${w.id}")`))))];
const pathsOverlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  || (/[*]/.test(a) && b.startsWith(a.split('*')[0])) || (/[*]/.test(b) && a.startsWith(b.split('*')[0]));

const RISK = [['authorization', /\b(auth|rbac|permission|capabilit|role|access)/i], ['clinical-data', /\b(patient|paciente|clinical|medical)/i],
  ['destructive', /\b(delete|eliminar|archive|revoke|drop|migration)/i], ['backend-contract', /packages\/convex|mutation|validator/i],
  ['shared-surface', /components\/(shared|ui)\//i]];

// Both Jev calls together stay inside the hook timeout in settings.json, so a slow
// provider degrades to "Jev failed; roster route kept" instead of a killed hook.
function jevCli(args, timeout = POLICY.jev.timeoutMs) {
  execFileSync('node', [POLICY.jev.cli, ...args, '--json'], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Jev accepts only safe ids, for the atom and for every active atom.
const safeId = (text) => String(text).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'dispatch';

async function classify(type, input, active) {
  const { prompt = '', description = '' } = input.tool_input;
  const cwd = input.cwd ?? process.cwd();
  let baseSha;
  try { baseSha = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 2000 }).trim(); }
  catch { return { status: 'skipped', why: 'cwd is not a git checkout' }; }
  const id = safeId(description || type);
  const owned = ownedPaths(prompt, cwd);
  const readSet = repoPaths([...new Set([...packetList(prompt, 'Read', cwd).paths, ...packetList(prompt, 'Context files', cwd).paths, ...owned])]).slice(0, 60);
  const objective = (prompt.match(/Objective:\s*(.+)/)?.[1] ?? description ?? type).slice(0, 600);
  const atom = { id, objective, readSet, writeSet: POLICY.roster[type].writer ? repoPaths(owned) : [], dependsOn: [], acceptanceIds: [`${id}-done`],
    riskSignals: RISK.filter(([, re]) => re.test(prompt)).map(([name]) => name),
    exactContext: prompt.slice(0, 12000) };
  const run = { runId: `claude-${session.slice(0, 40)}`, baseSha, rootModel: POLICY.jev.rootModel, phase: 'execution', verifiedAtomIds: [] };
  const dir = path.join(sessionDir, 'jev');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${id.slice(0, 40)}`;
  const files = Object.fromEntries(['atom', 'run', 'active', 'receipt', 'decision'].map((k) => [k, path.join(dir, `${stamp}-${k}.json`)]));
  fs.writeFileSync(files.atom, JSON.stringify(atom));
  fs.writeFileSync(files.run, JSON.stringify(run));
  fs.writeFileSync(files.active, JSON.stringify(Object.values(active).map((w) => ({ id: safeId(w.id), writeSet: repoPaths(w.writeSet ?? []) }))
    .filter((w, i, all) => all.findIndex((o) => o.id === w.id) === i)));
  try { await promisify(execFile)('node', [POLICY.jev.cli, 'classify-atom', '--atom', files.atom, '--run-context', files.run, '--active-atoms', files.active,
    '--receipt', files.receipt, '--json'], { encoding: 'utf8', timeout: POLICY.jev.timeoutMs }); }
  catch { /* the receipt records a failed classification when the CLI produced one */ }
  if (!fs.existsSync(files.receipt)) return { status: 'failed', why: 'no receipt', id, owned };
  const receipt = JSON.parse(fs.readFileSync(files.receipt, 'utf8'));
  // The parent's selection is recorded against this receipt once the guard decides.
  const record = (chosenRoute, rationale) => {
    try { jevCli(['record-route-decision', '--atom', files.atom, '--run-context', files.run, '--route-receipt', files.receipt,
      '--chosen-route', chosenRoute, '--rationale', rationale, '--receipt', files.decision], POLICY.jev.recordTimeoutMs); return files.decision; }
    catch (error) { return `record failed: ${String(error.stderr ?? error).slice(0, 120)}`; }
  };
  if (receipt.classificationStatus !== 'succeeded') return { status: 'failed', why: receipt.failureCode ?? receipt.classificationStatus, receiptFile: files.receipt, record, id, owned };
  const j = receipt.judgments ?? {};
  return { status: 'succeeded', proposed: receipt.proposedRoute, confidence: receipt.confidence, probabilities: receipt.probabilities,
    signals: { openDecision: j.has_open_decision?.noul, contextSufficient: j.context_sufficient?.noul, needsBrowser: j.needs_browser?.noul, overlap: j.semantic_overlap?.noul },
    receiptFile: files.receipt, record, id, owned };
}

// Model tier. The runtime's questions are fixed, so the guard asks Jev this one directly.
// Roles of one family (implement, plan, review) form a ladder of tiers; Jev picks the
// cheapest tier that does the packet well and the guard points to the role at that tier.
// Memory: every allowed tiered dispatch is appended to tier-memory.jsonl. One that is
// dispatched again later in the session at a higher tier (a similar objective, same
// family) counts as escalated, and Jev sees those outcomes for similar packets.
const TIERS = ['sonnet', 'opus_low', 'opus_medium', 'opus_high', 'fable'];
// Memory rows written before 1.33.0 name the cheapest step haiku.
const LEGACY_TIER = { haiku: 'sonnet' };
const rank = (tier) => TIERS.indexOf(tier);
const MEMORY = path.join(POLICY.stateDir, 'tier-memory.jsonl');
const words = (text) => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []);
function similarity(x, y) {
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both || 1);
}
function tierLadder(family) {
  const roles = Object.entries(POLICY.roster).filter(([, r]) => family && r.family === family && !r.retired);
  return [...new Set(roles.map(([, r]) => rank(r.tier)))].sort((a, b) => a - b)
    .map((t) => ({ tier: TIERS[t], roles: roles.filter(([, r]) => rank(r.tier) === t).map(([n]) => n) }));
}
function roleAt(family, tier) {
  const ladder = tierLadder(family);
  return ladder.find((step) => rank(step.tier) >= rank(tier)) ?? ladder.at(-1);
}
// Similar packets come from the same repository only, so one repository's objectives are
// never sent to Jev while dispatching in another; the per-tier counts span all of them.
function memory(family, objective, repo) {
  if (!fs.existsSync(MEMORY)) return { stats: {}, similar: [] };
  const rows = fs.readFileSync(MEMORY, 'utf8').trim().split('\n').slice(-(POLICY.tier.memoryRows ?? 2000))
    .flatMap((line) => { try { const r = JSON.parse(line); return [{ ...r, tier: LEGACY_TIER[r.tier] ?? r.tier, jevTier: LEGACY_TIER[r.jevTier] ?? r.jevTier, w: words(r.objective) }]; } catch { return []; } });
  rows.forEach((r, i) => {
    r.outcome = rows.slice(i + 1).some((s) => s.session === r.session && s.family === r.family && rank(s.tier) > rank(r.tier)
      && similarity(s.w, r.w) >= 0.5) ? 'escalated' : 'not escalated';
  });
  const stats = {};
  for (const r of rows.filter((row) => row.family === family)) {
    const s = (stats[r.tier] ??= { dispatches: 0, escalated: 0 });
    s.dispatches += 1;
    if (r.outcome === 'escalated') s.escalated += 1;
  }
  const mine = words(objective);
  const similar = rows.filter((r) => r.repo === repo).map((r) => ({ r, sim: similarity(mine, r.w) })).filter((x) => x.sim >= 0.2).sort((a, b) => b.sim - a.sim).slice(0, 6)
    .map(({ r, sim }) => ({ objective: r.objective, family: r.family, tier: r.tier, jevTier: r.jevTier, outcome: r.outcome, similarity: Number(sim.toFixed(2)) }));
  return { stats, similar };
}
function remember(role, type, tier, cwd) {
  if (!tier) return;
  fs.mkdirSync(POLICY.stateDir, { recursive: true });
  fs.appendFileSync(MEMORY, `${JSON.stringify({ at: new Date().toISOString(), session, repo: path.basename(cwd), family: role.family, role: type,
    tier: role.tier, jevTier: tier.tier ?? null, jevConfidence: tier.confidence ?? null, objective: tier.objective })}\n`);
}
// Same credential rules as the advisory CLI; the key is never logged.
function typesafeKey() {
  if (process.env.TYPESAFE_API_KEY?.trim()) return process.env.TYPESAFE_API_KEY.trim();
  const file = home(POLICY.tier.credentialFile);
  if (!fs.existsSync(file)) return null;
  let key = fs.readFileSync(file, 'utf8').match(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*([^\r\n]*)$/m)?.[1]?.trim() ?? '';
  if (/^(["']).*\1$/.test(key)) key = key.slice(1, -1).trim();
  return key || null;
}
async function askTier(role, type, prompt, description, cwd) {
  const objective = (prompt.match(/Objective:\s*(.+)/)?.[1] ?? description ?? type).slice(0, 600);
  const key = typesafeKey();
  if (!key) return { status: 'failed', why: 'no credential', objective };
  const state = { packet: { function: role.family, role: type, objective, riskSignals: RISK.filter(([, re]) => re.test(prompt)).map(([name]) => name),
    text: prompt.slice(0, 12000) }, memory: memory(role.family, objective, path.basename(cwd)) };
  const started = Date.now();
  const response = await fetch(POLICY.tier.endpoint, { method: 'POST', signal: AbortSignal.timeout(POLICY.tier.timeoutMs),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, model: POLICY.tier.model, questions: { tier: POLICY.tier.question } }) });
  if (!response.ok) return { status: 'failed', why: `http ${response.status}`, objective };
  const answer = (await response.json()).answers?.tier;
  if (!TIERS.includes(answer?.choice)) return { status: 'failed', why: 'no tier answer', objective };
  return { status: 'succeeded', tier: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities, objective,
    ms: Date.now() - started, memory: { stats: state.memory.stats, similar: state.memory.similar.length } };
}

async function agentCall() {
  const ti = input.tool_input ?? {};
  const type = ti.subagent_type ?? 'general-purpose';
  const entry = { tool: 'Agent', type, requestedModel: ti.model ?? null, description: ti.description ?? null };
  if (input.agent_id) deny('Subagents do not start agents. Return a concrete blocker or proposal to the parent instead.', entry);
  if (ti.model === 'haiku') deny(`Haiku is not used. Use a roster role (${rosterList}); a plugin agent takes model: "opus", or "sonnet" for read-only work.`, entry);
  const role = POLICY.roster[type];
  if (!role) {
    if (POLICY.builtinsAllowed.includes(type)) allow(null, entry);
    if (type.includes(':')) {
      // Sonnet runs read-only plugin work only: a packet with an Owned paths line is a writer.
      const readOnlyModel = (POLICY.readOnlyModels ?? []).includes(ti.model);
      const writerPacket = String(ti.prompt ?? '').includes('Owned paths:');
      if (readOnlyModel && writerPacket) deny(`Plugin agent ${type} got an "Owned paths:" writer packet on Sonnet, which runs read-only work only. Pass model: "opus" or use a roster writer: ${rosterList}.`, entry);
      if (POLICY.otherAgentsRequireModel.includes(ti.model)) allow(null, entry);
      deny(`Plugin agent ${type} has no pinned model. Pass model: "opus" (or "sonnet" for read-only work) or use a roster role: ${rosterList}.`, entry);
    }
    deny(`"${type}" is not a roster role; it would run on the coordinator's model and effort. Use one of: ${rosterList}. Mapping/search -> code-mapper, docs/web research -> docs-researcher, fully specified edits -> mechanical-worker or exact-implementer, general code -> implementer, one UI screen -> ui-implementer, cross-cutting code -> senior-implementer, decisions/plans -> planner, diff, plan, security or image review -> codex-review on Astra XHigh (node ~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs --packet <file> --root <repo> [--image <file>]..., Bash run_in_background: true); computer use (dashboards, tools, the real app) -> codex-review.mjs --computer-use --packet <file> --root <repo> (Bash run_in_background: true); reviewer, visual-reviewer or browser-qa only as a declared "Codex fallback: <reason>".`, entry);
  }
  if (ti.model && ti.model !== role.model) {
    deny(`${type} runs on ${role.model}; do not override it with "${ti.model}". For more capability dispatch senior-implementer or planner (Opus high); for less, mechanical-worker or code-mapper (Sonnet, low effort).`, entry);
  }
  const prompt = String(ti.prompt ?? '');
  // 1.34.0: reviews run on Astra XHigh through codex-review. Claude reviewers are a declared
  // fallback; these denials are not Jev refusals.
  if (POLICY.review?.engine === 'codex') {
    const launch = 'Write the review packet to a file and run node ~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs --packet <file> --root <repo> [--image <mock> --image <capture>] with Bash run_in_background: true. Claude Code wakes you when it exits: do not poll or sleep. Use a Claude reviewer only when Codex fails or has no quota, with a "Codex fallback: <reason>" line.';
    if (role.retired) deny(`${type} is retired in 1.34.0: reviews run on Astra XHigh through codex-review. ${launch}`, { ...entry, blockedBy: 'retired' });
    const fallbackLine = /^\s*Codex fallback:\s*\S/m.test(prompt);
    const fallbackReason = prompt.match(/^\s*Codex fallback:\s*(\S.*)$/m)?.[1]?.slice(0, 300) ?? null;
    if (role.family === 'browser' && !fallbackLine) deny(`${type} is a fallback: computer use (changing dashboards or tools, testing the real app) runs on Astra XHigh through node ~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs --computer-use --packet <file> --root <repo>, with Bash run_in_background: true. Claude Code wakes you when it exits: do not poll or sleep. Use browser-qa only when Codex fails or has no quota, with a "Codex fallback: <reason>" line.`, { ...entry, blockedBy: 'codex-computer-use' });
    if (['review', 'visual'].includes(role.family) && !fallbackLine) deny(`${type} is a fallback: reviews run on Astra XHigh through codex-review. ${launch}`, { ...entry, blockedBy: 'codex-review' });
    // An accepted fallback skips the Jev tier and route gate: the parent already declared why.
    if (['review', 'visual', 'browser'].includes(role.family)) {
      allow(null, { ...entry, codexFallback: fallbackReason, jev: 'skipped', tier: null, why: 'accepted Codex fallback' });
    }
  }
  // Fable is kept for very large or ultra-hard specs: Jev has to pick it, or the parent
  // says why in a "Fable scope:" line.
  const fableLine = new RegExp(`^\\s*${POLICY.fableMarker}\\s*\\S`, 'm').test(prompt);
  const denyFable = (why, logged = entry) => deny(`${type} runs on Fable 5.1, reserved for very large or ultra-hard specs that touch many surfaces. ${why}If this really is that scale, add a "${POLICY.fableMarker} ..." line naming the surfaces and why Opus high is not enough.`, logged);
  if (role.writer) {
    const missing = POLICY.writerMarkers.filter((m) => !prompt.includes(m));
    if (missing.length) deny(`Writer packets need ${missing.join(' and ')} lines. Template:\nObjective: ...\nOwned paths: a/b.tsx, c/d.ts\nSettled decisions: ...\nChecks: exact commands\nStop when: ...\nDone when: observable finish line\nReport: Blocked on me / Changed / Found / Unverified`, entry);
  }
  const cwd = input.cwd ?? process.cwd();
  const active = role.writer || role.jev ? activeWriters() : {};
  const list = role.writer ? packetList(prompt, 'Owned paths', cwd) : { paths: [], rejected: [] };
  const owned = list.paths;
  if (role.writer) {
    if (list.rejected.length || !owned.length) deny(`${OWNED_FORMAT} Rejected: ${list.rejected.length ? list.rejected.slice(0, 3).join('; ') : 'an empty list'}`, { ...entry, blockedBy: 'owned-paths', rejected: list.rejected.slice(0, 3) });
    const clash = clashes(active, owned);
    if (clash.length) deny(`One writer per surface: ${clash.slice(0, 6).join('; ')}. Wait for that writer to finish, or re-scope the owned paths. (A hold whose writer stopped without a release expires once its transcript is idle ${STALE.idleMinutes} min; a background dispatch without an agent id is held until the ${STALE.maxHours} h maxHours limit or an explicit release.)`, { ...entry, clash: clash.slice(0, 6) });
  }
  // Re-read and re-check the clash under the lock, so a concurrent add is never lost.
  const register = () => {
    if (!role.writer || !input.tool_use_id) return;
    const clash = withActiveLock(() => {
      const all = prunedActive();
      const found = clashes(all, owned);
      if (found.length) return found;
      all[input.tool_use_id] = { id: (ti.description || type).slice(0, 80), type, writeSet: owned, at: Date.now(), agentId: null, background: ti.run_in_background === true };
      saveActive(all);
      return [];
    }, () => null);
    if (clash === null) deny('The guard could not lock the active-writer list within 2 s; dispatch the same packet again.', { ...entry, lock: 'timeout' });
    if (clash.length) deny(`One writer per surface: ${clash.slice(0, 6).join('; ')}. A concurrent dispatch took that path first; wait for it to finish, or re-scope the owned paths.`, { ...entry, clash: clash.slice(0, 6) });
  };
  const mode = POLICY.jev.mode ?? 'gate';
  const tiered = mode !== 'off' && tierLadder(role.family).length > 1;
  if ((!role.jev && !tiered) || mode === 'off') {
    if (role.tier === 'fable' && !fableLine) denyFable('');
    register(); allow(null, entry);
  }
  const started = Date.now();
  const failed = (error) => ({ status: 'failed', why: String(error).slice(0, 200) });
  const [advice, tier] = await Promise.all([
    role.jev ? classify(type, input, active).catch(failed) : { status: 'skipped', why: 'no route classification for this role' },
    tiered ? askTier(role, type, prompt, ti.description, cwd).catch(failed) : null,
  ]);
  const target = tier?.status === 'succeeded' ? roleAt(role.family, tier.tier) : null;
  const jevEntry = { ...entry, jev: advice.status, jevMs: Date.now() - started, proposed: advice.proposed ?? null, chosen: role.route,
    confidence: advice.confidence ?? null, signals: advice.signals ?? null, receipt: advice.receiptFile ?? null, why: advice.why ?? null,
    tier: tier && { status: tier.status, jevTier: tier.tier ?? null, confidence: tier.confidence ?? null, probabilities: tier.probabilities ?? null,
      used: role.tier, target: target?.roles ?? null, memory: tier.memory ?? null, ms: tier.ms ?? null, why: tier.why ?? null } };
  // A re-dispatch usually keeps the objective even when the description changes.
  const objectiveKey = (prompt.match(/Objective:\s*(.+)/)?.[1] || ti.description || '').trim().toLowerCase().slice(0, 120);
  const packetKey = `packet:${objectiveKey}`;
  const past = refusals();
  // Route refusals apply to writer packets only; tier refusals to any tiered role. A packet
  // (by objective) is refused once for any reason, whichever role it is sent to next.
  const refuse = (reason, extra = {}) => {
    if (mode !== 'gate' || past.count >= (POLICY.jev.maxRefusalsPerSession ?? 3) || past.keys.includes(packetKey)) return;
    recordRefusal(packetKey);
    deny(`${reason} (Jev refuses a packet only once: dispatching it again as is proceeds.)`, { ...jevEntry, ...extra });
  };
  const retried = past.keys.includes(packetKey) ? 'dispatched again after a Jev refusal' : null;
  const tierNote = target && target.tier !== role.tier ? `Jev tier: ${tier.tier} (confidence ${tier.confidence}); ${type} runs ${role.tier}.` : null;
  const accept = (context, rationale) => {
    const decision = advice.record ? advice.record(role.route, rationale) : null;
    remember(role, type, tier, cwd);
    register();
    allow([tierNote, context].filter(Boolean).join(' ') || null, { ...jevEntry, jevDecision: decision, rationale });
  };
  const rationale = prompt.match(new RegExp(`^\\s*${POLICY.overrideMarker}\\s*(.+)`, 'm'))?.[1]?.slice(0, 300);
  // The parent already asked for Fable, so a substantial Fable probability is enough.
  const fableProbability = tier?.probabilities?.fable ?? 0;
  if (role.tier === 'fable' && tier?.tier !== 'fable' && fableProbability < POLICY.tier.fableAllowAbove && !fableLine) {
    denyFable(target ? `Jev picks ${tier.tier} for this packet (p fable ${fableProbability}): dispatch ${target.roles.join(' or ')}. ` : `Jev gave no tier (${tier?.why}). `, jevEntry);
  }
  if (target && target.tier !== role.tier && role.tier !== 'fable' && tier.confidence >= POLICY.tier.minConfidence && !rationale) {
    refuse(`Jev picks ${tier.tier} for this packet (confidence ${tier.confidence}); ${type} runs ${role.tier}. Dispatch ${target.roles.join(' or ')}, or keep ${type} by adding a "${POLICY.overrideMarker} ..." line.`, { blockedBy: 'tier' });
  }
  if (!role.jev) accept(null, tier?.status === 'succeeded' ? `tier ${role.tier}, Jev tier ${tier.tier}` : `Jev tier ${tier?.status}`);
  const s = advice.signals ?? {};
  const notes = [
    role.writer && s.contextSufficient !== undefined && s.contextSufficient < 0.3 ? `Jev judges the packet's context thin (${s.contextSufficient}): if the writer reports rediscovery, add settled decisions and file:line facts.` : null,
    role.writer && s.openDecision > 0.6 ? `Jev sees an open decision (${s.openDecision}): settle it with planner before more writers.` : null,
    s.overlap > 0.5 ? `Jev sees possible semantic overlap with an active writer (${s.overlap}).` : null,
  ].filter(Boolean).join(' ') || null;
  if (advice.status !== 'succeeded') accept(null, `Jev ${advice.status} (${advice.why}); roster route kept`);
  if (role.writer && role.route !== 'astra_xhigh_decision' && s.openDecision > POLICY.jev.denyOpenDecisionAbove && !rationale) {
    refuse(`Jev judges this packet still holds an open decision (${s.openDecision}); ${type} executes settled work. Settle it with planner (or give it to senior-implementer), then dispatch with the decision under "Settled decisions:", or add a "${POLICY.overrideMarker} ..." line.`, { blockedBy: 'open-decision' });
  }
  if (advice.proposed === role.route) accept(notes, 'accepted Jev proposal');
  const chosenProbability = advice.probabilities?.[role.route] ?? 0;
  const hint = `Jev (advisory) proposes ${advice.proposed} (confidence ${advice.confidence}); ${type} is ${role.route} (p=${chosenProbability}).`;
  if (rationale) accept(notes, `parent override: ${rationale}`);
  if (chosenProbability >= POLICY.jev.acceptChosenRouteProbability) accept(`${hint} Kept: the chosen route is plausible. ${notes ?? ''}`.trim(), `kept ${role.route}: plausible at p=${chosenProbability}`);
  const alternatives = advice.proposed === 'root_direct' ? 'do it directly in the coordinator'
    : advice.proposed === 'blocked_dependency' ? 'resolve the blocking dependency first'
    : `dispatch ${agentsForRoute(advice.proposed).join(' or ')}`;
  if (role.writer) refuse(`${hint} Either ${alternatives}, or keep ${type} by adding a "${POLICY.overrideMarker} ..." line to the prompt.`);
  accept(`${hint} ${notes ?? ''}`.trim(), `kept ${role.route}: ${retried ?? (!role.writer ? 'Jev advises non-writer dispatches' : mode === 'gate' ? 'Jev refusal limit reached for this session' : `Jev ${mode}`)}`);
}

function imageCall() {
  const owner = input.agent_id ? String(input.agent_id).replace(/[^\w-]/g, '') : 'main';
  const kind = input.agent_id ? (input.agent_type ?? 'default') : 'main';
  const budget = POLICY.imageBudget[kind] ?? POLICY.imageBudget.default;
  const file = path.join(sessionDir, `images-${owner}.json`);
  const used = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).used : 0;
  const entry = { tool: input.tool_name, owner: kind, used, budget, target: input.tool_input?.file_path ?? null };
  if (used >= budget) {
    deny(kind === 'main'
      ? `Image budget reached for the coordinator (${budget}). Every image stays in context and is paid again on every later turn. Dispatch visual-reviewer with the image paths and act on its text findings.`
      : `Image budget reached for ${kind} (${budget}). Work from what you already saw, or report "needs visual review" so the parent dispatches a fresh visual-reviewer.`, entry);
  }
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ used: used + 1 }));
  allow(null, entry);
}

// mapper-bash: an optional `cd <path> &&` prefix, then git show/log/diff/blame/status/
// rev-parse/ls-files/grep, a typecheck, or jevgrep (`jg --version`, or `jg "<question>"
// [relative root] [--max-source-bytes N] [--concurrency N] [--no-cache]`), optionally
// piped into head/tail/wc/sort/uniq/cut/rg/grep. jg subcommands (auth, doctor, skill,
// cache) and help/version words are denied even when quoted, a double-quoted question may
// not hold $, ` or \, and a cd before jg must be a plain relative path (no quotes, -, ..).
// Filter-disabling flags, substitutions, file redirects and command lists are denied too.
const MAPPER_HELP = 'code-mapper Bash runs only git show/log/diff/blame/status/rev-parse/ls-files/grep, a typecheck (pnpm typecheck, pnpm exec tsc --noEmit, npx tsc --noEmit) or jevgrep (jg --version, or jg "<question>" [relative root] with only --max-source-bytes N, --concurrency N, --no-cache; no subcommands, and $ ` \\ only inside a single-quoted question), optionally piped into head/tail/wc/sort/uniq/cut/rg/grep. Use Grep, Glob and Read for everything else.';
// jevgrep for the mapper: null when allowed, else why not. Works on raw shell words
// (quotes kept) so the question must be one quoted word and the root stays a plain
// relative path inside the working directory.
const JG_OPTIONS = new Set(['--max-source-bytes', '--concurrency', '--no-cache']);
// From `jg --help`; jevgrep sees the unquoted word, so a quoted "auth" still dispatches.
const JG_RESERVED = new Set(['auth', 'doctor', 'skill', 'cache', 'help', 'version', '--help', '-h', '--version']);
function jgRefusal(step) {
  const words = step.match(/(?:'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"])+/g) ?? [];
  if (words.length === 2 && words[1] === '--version') return null;
  const question = words[1] ?? '';
  if (!/^("(?:\\.|[^"\\])*"|'[^']*')$/.test(question)) return `\`jg ${question}\`: jg takes one quoted question (jg "<question>" [root]); subcommands and other flags are not allowed.`;
  const text = question.slice(1, -1);
  if (question.startsWith('"') && /[$`\\]/.test(text)) return 'A double-quoted jg question must not contain $, ` or \\; use single quotes for literal text.';
  if (JG_RESERVED.has(text.trim().toLowerCase())) return `\`jg ${question}\` names a jg subcommand or help word; ask a question instead.`;
  if (!text.trim() || text.startsWith('-')) return 'The jg question must be non-empty and must not start with `-`.';
  let i = 2;
  if (words[i] !== undefined && !words[i].startsWith('-')) {
    const root = words[i];
    if (!/^[\w@%+=:,.\/-]+$/.test(root) || root.startsWith('/') || root.split('/').includes('..')) return `The jg root \`${root}\` must be a plain relative path inside the working directory (no leading / or -, no .. segment, no quotes, ~, $ or globs).`;
    i += 1;
  }
  for (; i < words.length; i += 1) {
    const word = words[i];
    if (!JG_OPTIONS.has(word)) return `\`jg ${word}\` is not allowed: only --max-source-bytes N, --concurrency N and --no-cache, after the question and optional root.`;
    if (word !== '--no-cache') {
      i += 1;
      if (!/^\d+$/.test(words[i] ?? '')) return `\`jg ${word}\` takes a number.`;
    }
  }
  return null;
}
// Splits on unquoted | and &&; null for any other unquoted list, subshell, input redirect
// or background job.
function splitShell(command) {
  const segments = [];
  const separators = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      current += c;
      if (c === '\\' && quote === '"') { current += command[i + 1] ?? ''; i += 1; } else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '\\') { current += c + (command[i + 1] ?? ''); i += 1; continue; }
    if (c === '|') {
      if (command[i + 1] === '|') return null;
      segments.push(current); separators.push('|'); current = '';
      continue;
    }
    if (c === '&') {
      if (command[i + 1] === '&') { segments.push(current); separators.push('&&'); current = ''; i += 1; continue; }
      if (current.endsWith('>')) { current += c; continue; }
      return null;
    }
    if (';\n\r<()'.includes(c)) return null;
    current += c;
  }
  if (quote) return null;
  segments.push(current);
  return { segments: segments.map((s) => s.trim()), separators };
}
const shellWords = (segment) => (segment.match(/'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"]+/g) ?? []).map((w) => w.replace(/^(['"])([\s\S]*)\1$/, '$2'));
function mapperBash() {
  if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
  const command = String(input.tool_input?.command ?? '').trim();
  const entry = { tool: 'Bash', mode: 'mapper-bash', type: input.agent_type ?? null, command: command.slice(0, 200) };
  const refuse = (why) => deny(`${why} ${MAPPER_HELP}`, entry);
  if (!command) refuse('Empty command.');
  if (/\$\(|\$\{|`/.test(command)) refuse('Command substitution is not allowed.');
  const parsed = splitShell(command);
  if (!parsed) refuse('Command lists, subshells, input redirects and background jobs are not allowed.');
  let { segments, separators } = parsed;
  const cdMatch = separators[0] === '&&' ? segments[0].match(/^cd\s+("[^"]+"|'[^']+'|[^\s"']+)$/) : null;
  if (cdMatch) {
    // jg reads a whole tree, so its cd prefix must stay inside the working directory.
    const next = shellWords(segments[1] ?? '');
    const cdPath = cdMatch[1];
    if (next[0] === 'jg' && !(next.length === 2 && next[1] === '--version')
      && (!/^[\w@%+=:,.\/-]+$/.test(cdPath) || /^[-\/~$]/.test(cdPath) || cdPath.split('/').includes('..'))) {
      refuse(`\`cd ${cdPath}\` before jg must be a plain relative path inside the working directory (no quotes, backslashes, leading -, /, ~ or $, no .. segment).`);
    }
    segments = segments.slice(1);
    separators = separators.slice(1);
  }
  if (separators.includes('&&')) refuse('Only one leading `cd <path> &&` is allowed.');
  if (segments.some((s) => !s)) refuse('Empty pipeline step.');
  // Output may go to /dev/null or another descriptor, never into a file.
  const steps = segments.map((s) => s.replace(/(^|\s)\d*>>?\s*(&\d|\/dev\/null)(?=\s|$)/g, ' '));
  if (steps.some((s) => s.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '').includes('>'))) refuse('Redirecting output into a file is not allowed.');
  const [first, ...rest] = steps.map(shellWords);
  let ok = false;
  if (first[0] === 'jg') {
    const why = jgRefusal(steps[0]);
    if (why) refuse(why);
    ok = true;
  } else if (first[0] === 'git') {
    let i = 1;
    while (first[i] === '--no-pager' || first[i] === '-C') i += first[i] === '-C' ? 2 : 1;
    ok = ['show', 'log', 'diff', 'blame', 'status', 'rev-parse', 'ls-files', 'grep'].includes(first[i])
      && !first.some((w) => /^(--output|--ext-diff|--textconv|--open-files-in-pager|-O)/.test(w));
  } else {
    const joined = first.join(' ');
    ok = /^pnpm (run )?typecheck$/.test(joined) || /^(pnpm exec|npx) tsc --noEmit( (-p|--project) \S+)?( --pretty( false)?)?$/.test(joined);
  }
  if (!ok) refuse(`\`${first.slice(0, 3).join(' ')}\` is not an allowed mapper command.`);
  for (const step of rest) {
    if (!['head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'rg', 'grep'].includes(step[0])) refuse(`Piping into \`${step[0]}\` is not allowed.`);
    if (step.some((w) => /^--pre/.test(w) || (step[0] === 'sort' && /^(-[A-Za-z]*o|--output|--compress-program)/.test(w)))) refuse(`\`${step[0]}\` with that flag is not allowed.`);
    if (step[0] === 'uniq') {
      // `uniq INPUT OUTPUT` writes OUTPUT; -f, -s and -w take a separate numeric argument.
      const operands = [];
      for (let i = 1; i < step.length; i += 1) {
        if (step[i] === '--') { operands.push(...step.slice(i + 1)); break; }
        if (/^-[fsw]$/.test(step[i])) { i += 1; continue; }
        if (!step[i].startsWith('-') || step[i] === '-') operands.push(step[i]);
      }
      if (operands.length >= 2) refuse('`uniq` with an output file operand is not allowed.');
    }
  }
  allow(null, null);
}

// writer-bash: every command runs except a git invocation whose subcommand can change the
// index, refs, config or worktree. Not a security boundary (`sh -c`, aliases and scripts
// get around it); it stops the habit of a writer staging or committing what the
// coordinator owns.
const WRITER_GIT_HELP = 'The coordinator owns the Git index and commits: report the files you changed and the coordinator stages them.';
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'ls-files', 'grep', 'shortlog', 'describe', 'cat-file', 'ls-tree', 'merge-base']);
const GIT_BRANCH_READ = new Set(['--show-current', '--list', '-a', '-r', '-v', '-vv']);
const GIT_CONFIG_READ = new Set(['--get', '--get-all', '--list', '-l']);
const GIT_CONFIG_FLAGS = new Set([...GIT_CONFIG_READ, '--global', '--local', '--system', '--show-origin', '--show-scope', '--name-only', '-z', '--null']);
const COMMAND_WRAPPERS = new Set(['command', 'exec', 'env', 'time', 'nohup', 'xargs']);
const SHELL_KEYWORDS = new Set(['{', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until']);
// Splits on every unquoted command boundary (newlines, ; && || | & ( )) and at both ends
// of each $( ) and backtick substitution, also inside double quotes.
function commandPieces(command) {
  const pieces = [];
  const frames = [];
  let current = '';
  let quote = null;
  const cut = () => { pieces.push(current.trim()); current = ''; };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    const next = command[i + 1];
    if (quote === "'") { current += c; if (c === "'") quote = null; continue; }
    if (c === '\\') { if (next !== '\n') current += c + (next ?? ''); i += 1; continue; }
    if (c === '$' && next === '(') { frames.push({ quote, close: ')' }); quote = null; cut(); i += 1; continue; }
    if (c === '`') {
      if (quote === null && frames.at(-1)?.close === '`') { cut(); quote = frames.pop().quote; } else { frames.push({ quote, close: '`' }); quote = null; cut(); }
      continue;
    }
    if (quote === '"') { current += c; if (c === '"') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === ')') { cut(); if (frames.at(-1)?.close === ')') quote = frames.pop().quote; continue; }
    if ('(;\n\r'.includes(c)) { cut(); continue; }
    if (c === '|') { cut(); if (next === '|' || next === '&') i += 1; continue; }
    if (c === '&') {
      if (next === '&') { cut(); i += 1; continue; }
      if (/[<>]$/.test(current) || next === '>') { current += c; continue; }
      cut(); continue;
    }
    current += c;
  }
  cut();
  return pieces.filter(Boolean);
}
function gitPieceAllowed(piece) {
  // Redirections are not arguments: `2>/dev/null`, or `>` followed by its target.
  const words = [];
  const raw = shellWords(piece);
  for (let i = 0; i < raw.length; i += 1) {
    if (/^(\d+|&)?(>>?|<)&?$/.test(raw[i])) { i += 1; continue; }
    if (!/^(\d+|&)?(>>?|<)/.test(raw[i])) words.push(raw[i]);
  }
  let i = 0;
  while (i < words.length) {
    if (/^[A-Za-z_]\w*=/.test(words[i]) || SHELL_KEYWORDS.has(words[i])) { i += 1; continue; }
    if (!COMMAND_WRAPPERS.has(words[i])) break;
    i += 1;
    while (words[i]?.startsWith('-')) i += 1;
  }
  if (path.basename(words[i] ?? '') !== 'git') return true;
  i += 1;
  while (i < words.length) {
    if (['-C', '-c', '--git-dir', '--work-tree'].includes(words[i])) i += 2;
    else if (['--no-pager', '--paginate', '-p', '--bare', '--literal-pathspecs'].includes(words[i]) || /^--(git-dir|work-tree)=/.test(words[i])) i += 1;
    else break;
  }
  const [sub, ...args] = words.slice(i);
  if (sub === undefined || GIT_READ.has(sub)) return true;
  if (sub === 'branch') return args.every((a) => GIT_BRANCH_READ.has(a));
  if (sub === 'remote') return !args.length || (args.length === 1 && args[0] === '-v');
  if (sub === 'config') return args.some((a) => GIT_CONFIG_READ.has(a)) && args.every((a) => !a.startsWith('-') || GIT_CONFIG_FLAGS.has(a));
  if (sub === 'stash') return ['list', 'show'].includes(args[0]);
  return false;
}
function writerBash() {
  if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
  const command = String(input.tool_input?.command ?? '');
  const entry = { tool: 'Bash', mode: 'writer-bash', type: input.agent_type ?? null, command: command.slice(0, 200) };
  const denied = commandPieces(command).find((piece) => !gitPieceAllowed(piece));
  if (denied) deny(`${WRITER_GIT_HELP} Denied: \`${denied.slice(0, 200)}\``, entry);
  allow(null, null);
}

try {
  if (process.argv[2] === 'mapper-bash') mapperBash();
  if (process.argv[2] === 'writer-bash') writerBash();
  if (input.hook_event_name === 'PostToolUse' && input.tool_name === 'Agent') {
    const r = input.tool_response ?? {};
    ledger({ event: 'agent-result', type: input.tool_input?.subagent_type ?? null, status: r.status ?? null,
      resolvedModel: r.resolvedModel ?? null, modelsUsed: r.modelsUsed ?? null, durationMs: r.totalDurationMs ?? null,
      toolUses: r.totalToolUseCount ?? null, agentId: r.agentId ?? null });
    withActiveLock(() => {
      const all = prunedActive();
      if (input.tool_use_id && all[input.tool_use_id]) {
        if (/launch|running|async/i.test(String(r.status))) all[input.tool_use_id].agentId = r.agentId ?? null;
        else delete all[input.tool_use_id];
        saveActive(all);
      }
    });
    process.exit(0);
  }
  if (input.hook_event_name === 'SubagentStop') {
    withActiveLock(() => {
      const all = prunedActive();
      const kept = Object.fromEntries(Object.entries(all).filter(([, w]) => !w.agentId || w.agentId !== input.agent_id));
      if (Object.keys(kept).length !== Object.keys(all).length) saveActive(kept);
    });
    process.exit(0);
  }
  if (input.tool_name === 'Agent') await agentCall();
  if ((input.tool_name === 'Read' && IMAGE.test(String(input.tool_input?.file_path ?? ''))) || SCREENSHOT_TOOL.test(String(input.tool_name ?? ''))) imageCall();
  process.exit(0);
} catch (error) {
  try { ledger({ decision: 'guard-error', tool: input.tool_name ?? null, error: String(error).slice(0, 300) }); } catch { /* ignore */ }
  process.exit(0);
}
