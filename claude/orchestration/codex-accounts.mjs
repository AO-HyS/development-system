// Local profile discovery reads settings and filesystem metadata, never auth contents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const expand = (value) => path.resolve(String(value).startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
export function discoverAccounts(review = {}) {
  const candidates = [];
  const add = (value, source) => { if (typeof value === 'string' && value.trim()) candidates.push({ home: expand(value), source }); };
  if (Array.isArray(review.accountHomes)) {
    for (const value of review.accountHomes) add(value, 'policy.review.accountHomes');
  } else {
    add(process.env.CODEX_HOME, 'CODEX_HOME');
    add(path.join(os.homedir(), '.codex'), 'default');
    add(path.join(os.homedir(), '.codex_extra'), 'secondary');
    for (const file of ['settings.json', 'desktop-settings.json', 'client-settings.json']) {
      try {
        const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.t3/userdata', file), 'utf8'));
        for (const instance of Object.values(settings.providerInstances ?? {})) {
          if (instance?.driver === 'codex') add(instance.config?.shadowHomePath || instance.config?.homePath, `T3:${file}`);
        }
      } catch { /* optional settings are not an authentication requirement */ }
    }
  }
  const seen = new Set();
  const accounts = [];
  const skipped = [];
  for (const candidate of candidates) {
    try {
      const authPath = fs.realpathSync(path.join(candidate.home, 'auth.json'));
      if (!fs.statSync(authPath).isFile()) throw new Error('not a file');
      if (seen.has(authPath)) continue;
      seen.add(authPath);
      accounts.push({ ...candidate, home: fs.realpathSync(candidate.home), authPath, identity: 'unknown' });
    } catch { skipped.push({ ...candidate, reason: 'missing auth file' }); }
  }
  return { accounts, skipped, identityNote: 'Distinct local auth paths are profiles, not proven account identities.' };
}

// Only terminal provider messages and narrow CLI startup diagnostics are evidence.
export function classifyAttempt({ eventsFile, stderrFile, exitCode, spawnError, signal, mode, verdict }) {
  if (signal) return { classification: 'cancelled', retryEligible: false, reason: 'cancelled' };
  if (spawnError === 'ENOENT') return { classification: 'unavailable', retryEligible: true, reason: 'Codex binary missing' };
  if (spawnError) return { classification: 'local_failure', retryEligible: false, reason: 'local_failure' };
  const raw = fs.readFileSync(eventsFile, 'utf8');
  const rows = [];
  let complete = !raw || raw.endsWith('\n');
  for (const line of raw.split('\n').filter((line) => line.trim())) {
    try { const row = JSON.parse(line); if (!row || typeof row.type !== 'string') complete = false; rows.push(row); }
    catch { complete = false; }
  }
  const terminal = rows.at(-1);
  let message = '';
  if (terminal?.type === 'turn.failed' && typeof terminal.error?.message === 'string') message = terminal.error.message;
  else if (terminal?.type === 'error' && typeof terminal.message === 'string') message = terminal.message;
  if (!message && !rows.length && complete) {
    const stderr = fs.readFileSync(stderrFile, 'utf8').trim();
    // Anchored startup lines: never scan arbitrary stderr or tool output for keywords.
    if (/^(?:error: )?(?:Not logged in|Authentication required|Please (?:log|sign) in|Failed to (?:load|refresh) (?:authentication|access token)|No authentication credentials)(?:[.: ].*)?$/i.test(stderr)) message = stderr;
  }
  if (/(?:cancelled|canceled|interrupted|safety refusal|not approved|permission denied|request refused)/i.test(message)) return { classification: 'refused_or_cancelled', retryEligible: false, reason: 'refused_or_cancelled' };
  const category = /(?:usage limit|quota (?:exceeded|exhausted)|rate limit|too many requests|\b429\b)/i.test(message) ? 'quota'
    : /(?:unauthorized|authentication|not logged in|sign in|log in|token (?:expired|invalid)|\b401\b)/i.test(message) ? 'auth'
    : /(?:connection (?:refused|reset|failed)|network (?:unavailable|error)|transport error|timed out|service unavailable|\b503\b)/i.test(message) ? 'connectivity' : null;
  if (mode === 'computer-use') {
    const known = new Set(['thread.started', 'turn.started', 'error', 'turn.failed']);
    if (!complete || rows.some((row) => !known.has(row?.type))) {
      if (exitCode === 0 && complete && terminal?.type === 'turn.completed') return { classification: 'succeeded', retryEligible: false, reason: null };
      return { classification: 'reconcile_required', retryEligible: false, reason: 'Trace may contain activity; reconcile effects before any replay' };
    }
    if (rows.length && rows[0]?.type !== 'thread.started') return { classification: 'reconcile_required', retryEligible: false, reason: 'Missing pre-turn trace start; reconcile before replay' };
    if (exitCode !== 0 && (category === 'quota' || category === 'auth')) return { classification: category, retryEligible: true, reason: category };
    return { classification: category ?? 'unknown_failure', retryEligible: false, reason: category ?? 'unknown_failure' };
  }
  if (exitCode === 0 && verdict) return { classification: 'succeeded', retryEligible: false, reason: null };
  if (exitCode !== 0 && complete && category) return { classification: category, retryEligible: true, reason: category };
  return { classification: exitCode === 0 ? 'malformed_verdict' : 'unknown_failure', retryEligible: false, reason: exitCode === 0 ? 'malformed_verdict' : 'unknown_failure' };
}
