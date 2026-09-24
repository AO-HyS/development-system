#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Same lossless, cache-conservative proxy profile as the Codex launcher (cli.mjs).
const FLAGS = [
  '--workers', '1', '--mode', 'cache', '--lossless',
  '--disable-kompress', '--disable-kompress-openai', '--disable-kompress-fallback',
  '--no-code-aware', '--no-read-lifecycle', '--no-ccr', '--no-ccr-proactive-expansion',
  '--no-cache', '--no-rate-limit', '--no-learn', '--no-memory-tools', '--no-memory-context',
  '--no-subscription-tracking', '--no-embedding-server', '--no-telemetry',
  '--compressor', 'smart_crusher,search,log,tabular,config,html',
];
const PASSTHROUGH = new Set(['--version', '-v', '-V', '--help', '-h']);
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const stamp = () => new Date().toISOString();

/** @param {Record<string, unknown>} config @param {string} key */
function requireAbsolute(config, key) {
  if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) {
    throw new Error(`${key} must be an absolute path`);
  }
  return config[key];
}

/** @param {string} file @param {unknown} value */
async function writePrivate(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/** The proxy receives no API keys; Claude Code sends its own account credentials per request. */
/** @param {string} workspace */
function proxyEnvironment(workspace) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HEADROOM_') || key.startsWith('ANTHROPIC_') || key.startsWith('CLAUDE_CODE_')
      || /(^|_)API_KEY$/.test(key)) delete env[key];
  }
  return {
    ...env, HEADROOM_WORKSPACE_DIR: workspace, HEADROOM_OUTPUT_SHAPER: '0',
    HEADROOM_KOMPRESS_WARMUP: '0', HEADROOM_UPDATE_CHECK: 'off',
    HEADROOM_TOIN_BACKEND: 'none', HEADROOM_LOG_MESSAGES: '0',
    HEADROOM_BEACON: 'off', DO_NOT_TRACK: '1', LITELLM_LOCAL_MODEL_COST_MAP: 'True',
  };
}

/** @param {number} port @param {string} endpoint @returns {Promise<unknown>} */
function getJson(port, endpoint) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: `/${endpoint}`, timeout: 1500 }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`${endpoint}: HTTP ${response.statusCode}`)); return; }
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 1_000_000) response.destroy(new Error('response too large')); });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on('timeout', () => request.destroy(new Error(`${endpoint}: timeout`)));
    request.on('error', reject);
  });
}

/** @param {unknown} value @param {number} [depth] @returns {Record<string, unknown>} */
function numericStats(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return {};
  /** @type {Record<string, unknown>} */
  const stats = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/token|request|cache|cost|saved|hit|miss|count|total|error|latency/i.test(key)) continue;
    if (typeof item === 'number' && Number.isFinite(item)) stats[key] = item;
    else if (item && typeof item === 'object' && !Array.isArray(item)) stats[key] = numericStats(item, depth + 1);
  }
  return stats;
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback listener has no port');
  await new Promise(resolve => server.close(resolve));
  return address.port;
}

/** @typedef {{ code: number | null, signal: NodeJS.Signals | null }} ChildExit */
/** @param {import('node:child_process').ChildProcess} child @returns {Promise<ChildExit>} */
function completion(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

/** @param {import('node:child_process').ChildProcess | undefined} child @param {NodeJS.Signals | 0} signal */
function signalGroup(child, signal) {
  if (!child?.pid) return false;
  try { process.kill(-child.pid, signal); return true; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false; throw error; }
}

/** @param {Promise<ChildExit>} done @param {number} milliseconds */
async function closedWithin(done, milliseconds) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      done.then(() => true, () => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {import('node:child_process').ChildProcess | undefined} child @param {Promise<ChildExit> | undefined} done */
async function stopOwned(child, done) {
  if (!child || !done) return true;
  signalGroup(child, 'SIGTERM');
  await closedWithin(done, 1000);
  if (signalGroup(child, 0)) signalGroup(child, 'SIGKILL');
  const closed = await closedWithin(done, 500);
  if (!closed) child.unref();
  return closed;
}

/** @param {string[]} args */
function requestedModel(args) {
  let model;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--model') model = args[++index];
    else if (args[index].startsWith('--model=')) model = args[index].slice(8);
  }
  return model;
}

async function main() {
  const separator = process.argv.indexOf('--');
  const options = process.argv.slice(2, separator < 0 ? undefined : separator);
  if (separator < 0 || options.length !== 2 || options[0] !== '--config') {
    throw new Error('usage: node runtime/headroom/claude.mjs --config /private/config.json -- <claude arguments>');
  }
  const args = process.argv.slice(separator + 1);
  const config = JSON.parse(await readFile(path.resolve(options[1]), 'utf8'));
  const claude = requireAbsolute(config, 'claudeBinary');
  await access(claude, constants.X_OK);
  const passthrough = args.length === 1 && PASSTHROUGH.has(args[0]);

  /** @type {import('node:child_process').ChildProcess | undefined} */
  let proxy;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let claudeChild;
  /** @type {Promise<ChildExit> | undefined} */
  let proxyDone;
  /** @type {Promise<ChildExit> | undefined} */
  let claudeDone;
  /** @type {string | undefined} */
  let receipt, proxyFailure;
  /** @type {number | undefined} */
  let port;
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let log;
  /** @type {NodeJS.Signals | undefined} */
  let interrupted;
  let closing = false;
  /** @type {Promise<boolean[]> | undefined} */
  let shutdownTask;
  /** @type {() => void} */
  let resolveShutdown = () => {};
  const shutdownFinished = new Promise(resolve => { resolveShutdown = () => resolve(undefined); });
  const beginShutdown = () => {
    shutdownTask ??= Promise.all([stopOwned(claudeChild, claudeDone), stopOwned(proxy, proxyDone)]);
    shutdownTask.then(resolveShutdown, resolveShutdown);
    return shutdownTask;
  };
  /** @param {NodeJS.Signals} signal */
  const onSignal = signal => { interrupted ??= signal; beginShutdown().catch(() => {}); };
  for (const signal of SIGNALS) process.on(signal, onSignal);
  try {
    /** @type {NodeJS.ProcessEnv} */
    const childEnv = { ...process.env };
    if (!passthrough) {
      const headroom = requireAbsolute(config, 'headroomBinary');
      const runRoot = requireAbsolute(config, 'runRoot');
      const privateBase = path.join(os.homedir(), '.development-system', 'private');
      if (!path.resolve(runRoot).startsWith(`${privateBase}${path.sep}`)) {
        throw new Error('runRoot must be within ~/.development-system/private');
      }
      await access(headroom, constants.X_OK);
      await mkdir(runRoot, { recursive: true, mode: 0o700 });
      receipt = await mkdtemp(path.join(runRoot, 'headroom-claude-'));
      await mkdir(path.join(receipt, 'state'), { mode: 0o700 });
      port = await availablePort();
      const logPath = path.join(receipt, 'proxy.log');
      log = await open(logPath, 'wx', 0o600);
      proxy = spawn(headroom, ['proxy', '--host', '127.0.0.1', '--port', String(port), ...FLAGS], {
        cwd: receipt, env: proxyEnvironment(path.join(receipt, 'state')), detached: true,
        stdio: ['ignore', log.fd, log.fd],
      });
      proxyDone = completion(proxy);
      proxyDone.catch(() => {});
      proxyDone.then(
        () => { if (!closing && !interrupted) { proxyFailure = 'Headroom proxy exited unexpectedly'; beginShutdown().catch(() => {}); } },
        () => { if (!closing && !interrupted) { proxyFailure = 'Headroom proxy failed unexpectedly'; beginShutdown().catch(() => {}); } },
      );
      const deadline = Date.now() + 180_000;
      let ready = false;
      while (Date.now() < deadline && proxy.exitCode === null && proxy.signalCode === null
        && !proxyFailure && !closing && !shutdownTask && !interrupted) {
        try { await getJson(port, 'health'); ready = true; break; } catch { /* startup only */ }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!ready) throw new Error(`Headroom health unavailable; private log: ${logPath}`);
      try { await writePrivate(path.join(receipt, 'proxy-before.json'), numericStats(await getJson(port, 'stats'))); }
      catch { await writePrivate(path.join(receipt, 'proxy-before.json'), { unavailable: true }); }
      // Claude Code appends /v1 itself. Tool search stays on behind a non-Anthropic base URL.
      childEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
      childEnv.ENABLE_TOOL_SEARCH ??= 'true';
      await writePrivate(path.join(receipt, 'launch.json'), {
        startedAt: stamp(), cwd: process.cwd(), port, claudeBinary: claude, headroomBinary: headroom,
        requestedModel: requestedModel(args) ?? 'caller-selected', observedModel: 'unknown',
        nativeTokenUsage: 'not collected by wrapper',
      });
    }
    if (interrupted || proxyFailure) throw new Error(proxyFailure ?? `interrupted by ${interrupted}`);
    claudeChild = spawn(claude, args, { env: childEnv, detached: true, stdio: 'inherit' });
    claudeDone = completion(claudeChild);
    claudeDone.catch(() => {});
    const result = await Promise.race([
      claudeDone,
      shutdownFinished.then(() => ({ code: null, signal: interrupted })),
    ]);
    if (receipt) await writePrivate(path.join(receipt, 'exit.json'), { closedAt: stamp(), exitCode: result.code, signal: result.signal });
    process.exitCode = proxyFailure ? 1 : interrupted ? 128 + (os.constants.signals[interrupted] ?? 1)
      : result.code ?? (result.signal ? 128 + (os.constants.signals[result.signal] ?? 1) : 1);
  } finally {
    closing = true;
    if (receipt && port) {
      const alive = proxy?.exitCode === null && !interrupted && !proxyFailure;
      let after = /** @type {unknown} */ ({ unavailable: true });
      if (alive) { try { after = numericStats(await getJson(port, 'stats')); } catch { /* recorded as unavailable */ } }
      await writePrivate(path.join(receipt, 'proxy-after.json'), after);
    }
    await stopOwned(claudeChild, claudeDone);
    await stopOwned(proxy, proxyDone);
    if (log) await log.close();
    for (const signal of SIGNALS) process.off(signal, onSignal);
  }
}

main().catch(error => { console.error(`headroom claude launcher: ${error.message}`); process.exitCode = 1; });
