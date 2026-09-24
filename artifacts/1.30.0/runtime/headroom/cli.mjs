#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { nativeBrowserOverrides } from '../native-browser/overrides.mjs';

const FLAGS = [
  '--workers', '1', '--mode', 'cache', '--lossless',
  '--disable-kompress', '--disable-kompress-openai', '--disable-kompress-fallback',
  '--no-code-aware', '--no-read-lifecycle', '--no-ccr', '--no-ccr-proactive-expansion',
  '--no-cache', '--no-rate-limit', '--no-learn', '--no-memory-tools', '--no-memory-context',
  '--no-subscription-tracking', '--no-embedding-server', '--no-telemetry',
  '--compressor', 'smart_crusher,search,log,tabular,config,html',
];
const ALLOWED_MODELS = new Set(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
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

/** @param {string} workspace @param {string} codexHome */
function proxyEnvironment(workspace, codexHome) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HEADROOM_') || /(^|_)API_KEY$/.test(key)) {
      delete env[key];
    }
  }
  return {
    ...env, CODEX_HOME: codexHome, HEADROOM_WORKSPACE_DIR: workspace, HEADROOM_OUTPUT_SHAPER: '0',
    HEADROOM_KOMPRESS_WARMUP: '0', HEADROOM_UPDATE_CHECK: 'off',
    HEADROOM_TOIN_BACKEND: 'none', HEADROOM_LOG_MESSAGES: '0',
    HEADROOM_CODEX_WIRE_DEBUG: '0', HEADROOM_BEACON: 'off', DO_NOT_TRACK: '1',
    LITELLM_LOCAL_MODEL_COST_MAP: 'True',
  };
}

/** @param {number} port @param {string} endpoint @param {number} [timeout] @returns {Promise<unknown>} */
function getJson(port, endpoint, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: `/${endpoint}`, timeout }, response => {
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
  const port = address.port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

/** @typedef {{ code: number | null, signal: NodeJS.Signals | null }} ChildExit */
/** @param {import('node:child_process').ChildProcess} child @returns {Promise<ChildExit>} */
function completion(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

/** @param {unknown} error */
function isEsrch(error) {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH';
}

/** @param {import('node:child_process').ChildProcess | undefined} child @param {NodeJS.Signals} [signal] */
function stopGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (!isEsrch(error)) throw error; }
}

/** @param {import('node:child_process').ChildProcess | undefined} child */
function groupAlive(child) {
  if (!child?.pid) return false;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { if (isEsrch(error)) return false; throw error; }
}

/** @param {import('node:child_process').ChildProcess | undefined} child @param {Promise<ChildExit> | undefined} done */
async function stopOwned(child, done) {
  if (!child || !done) return true;
  stopGroup(child);
  await closedWithin(done, 1000);
  if (groupAlive(child)) stopGroup(child, 'SIGKILL');
  const closed = await closedWithin(done, 500);
  if (!closed) child.unref();
  return closed;
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

/** @param {string[]} args */
function requestedModels(args) {
  const models = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-m' || arg === '--model') models.push(args[++index]);
    else if (arg.startsWith('--model=')) models.push(arg.slice(8));
    else if (arg === '-c' && /^model=/.test(args[index + 1] ?? '')) models.push(args[++index].slice(6).replace(/^['"]|['"]$/g, ''));
  }
  return models;
}

/** @param {string[]} args */
function rejectTransportOverrides(args) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (/^--(?:oss|local-provider|remote)(?:=|$)/.test(arg)) {
      throw new Error('caller cannot select a transport outside the Headroom provider');
    }
    const value = arg === '-c' || arg === '--config' ? args[++index]
      : arg.startsWith('--config=') ? arg.slice(9)
      : arg.startsWith('-c') && arg !== '-c' ? arg.slice(2) : '';
    const key = (value ?? '').split('=', 1)[0].trim().split('.')
      .map(segment => segment.trim().replace(/^['"]|['"]$/g, '')).join('.');
    if (key === 'model_provider' || key === 'model_providers' || key.startsWith('model_providers.')) {
      throw new Error('caller cannot override the per-invocation Headroom provider');
    }
  }
}

async function main() {
  const separator = process.argv.indexOf('--');
  const options = process.argv.slice(2, separator < 0 ? undefined : separator);
  if (separator < 0 || options.length !== 2 || options[0] !== '--config' || !process.argv[separator + 1]) {
    throw new Error('usage: node runtime/headroom/cli.mjs --config /private/config.json -- <codex arguments>');
  }
  const args = process.argv.slice(separator + 1);
  const configFile = path.resolve(options[1]);
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const codex = requireAbsolute(config, 'codexBinary');
  const root = requireAbsolute(config, 'root');
  const codexHome = requireAbsolute(config, 'codexHome');
  const passthrough = ['--version', '-V', '--help', '-h', 'help'].includes(args[0])
    || (args.length === 2 && ['--version', '-V', '--help', '-h'].includes(args[1]));
  await access(codex, constants.X_OK);
  await access(root, constants.R_OK);
  await access(codexHome, constants.R_OK);
  for (const model of requestedModels(args)) {
    if (!ALLOWED_MODELS.has(model)) throw new Error(`unsupported configured model: ${model}`);
  }
  if (config.model !== undefined && !ALLOWED_MODELS.has(config.model)) throw new Error(`unsupported configured model: ${config.model}`);
  if (!passthrough) rejectTransportOverrides(args);

  /** @type {import('node:child_process').ChildProcess | undefined} */
  let proxy;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let codexChild;
  /** @type {Promise<ChildExit> | undefined} */
  let proxyDone;
  /** @type {Promise<ChildExit> | undefined} */
  let codexDone;
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
    shutdownTask ??= Promise.all([stopOwned(codexChild, codexDone), stopOwned(proxy, proxyDone)]);
    shutdownTask.then(resolveShutdown, resolveShutdown);
    return shutdownTask;
  };
  /** @param {NodeJS.Signals} signal */
  const onSignal = signal => {
    interrupted ??= signal;
    beginShutdown().catch(() => {});
  };
  for (const signal of SIGNALS) process.on(signal, onSignal);
  try {
    if (!passthrough) {
      const headroom = requireAbsolute(config, 'headroomBinary');
      const runRoot = requireAbsolute(config, 'runRoot');
      const privateBase = path.join(os.homedir(), '.development-system', 'private');
      if (!path.resolve(runRoot).startsWith(`${privateBase}${path.sep}`)) {
        throw new Error('runRoot must be within ~/.development-system/private');
      }
      await access(headroom, constants.X_OK);
      await mkdir(runRoot, { recursive: true, mode: 0o700 });
      receipt = await mkdtemp(path.join(runRoot, 'headroom-'));
      await mkdir(path.join(receipt, 'state'), { mode: 0o700 });
      port = await availablePort();
      const logPath = path.join(receipt, 'proxy.log');
      log = await open(logPath, 'wx', 0o600);
      proxy = spawn(headroom, ['proxy', '--host', '127.0.0.1', '--port', String(port), ...FLAGS], {
        cwd: root, env: proxyEnvironment(path.join(receipt, 'state'), codexHome), detached: true,
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
    }
    const overrides = passthrough ? [] : [
      '--no-daemon', '-C', root,
      '-c', 'model_provider="headroom_local"',
      '-c', `model_providers.headroom_local={name="Headroom local",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=true,supports_websockets=true}`,
      ...(config.nativeBrowser ? await nativeBrowserOverrides(config.nativeBrowser === true ? undefined : config.nativeBrowser) : []),
    ];
    if (receipt) await writePrivate(path.join(receipt, 'launch.json'), {
      startedAt: stamp(), root, port, codexBinary: codex, headroomBinary: config.headroomBinary,
      requestedModel: requestedModels(args).at(-1) ?? config.model ?? 'caller-selected',
      observedModel: 'unknown', nativeTokenUsage: 'not collected by wrapper',
      browserReadiness: 'not observed',
    });
    if (interrupted || proxyFailure) throw new Error(proxyFailure ?? `interrupted by ${interrupted}`);
    codexChild = spawn(codex, [...overrides, ...args], {
      cwd: root, env: { ...process.env, CODEX_HOME: codexHome }, detached: true,
      stdio: 'inherit',
    });
    codexDone = completion(codexChild);
    codexDone.catch(() => {});
    const result = await Promise.race([
      codexDone,
      shutdownFinished.then(() => ({ code: null, signal: interrupted, stopped: true })),
    ]);
    if (receipt) await writePrivate(path.join(receipt, 'exit.json'), { closedAt: stamp(), exitCode: result.code, signal: result.signal });
    process.exitCode = proxyFailure ? 1 : interrupted ? 128 + (os.constants.signals[interrupted] ?? 1)
      : result.code ?? (result.signal ? 128 + (os.constants.signals[result.signal] ?? 1) : 1);
  } finally {
    closing = true;
    if (receipt && port && proxy?.exitCode === null && !interrupted && !proxyFailure) {
      try { await writePrivate(path.join(receipt, 'proxy-after.json'), numericStats(await getJson(port, 'stats'))); }
      catch { await writePrivate(path.join(receipt, 'proxy-after.json'), { unavailable: true }); }
    } else if (receipt && port) {
      await writePrivate(path.join(receipt, 'proxy-after.json'), { unavailable: true });
    }
    await stopOwned(codexChild, codexDone);
    await stopOwned(proxy, proxyDone);
    if (log) await log.close();
    for (const signal of SIGNALS) process.off(signal, onSignal);
  }
}

main().catch(error => { console.error(`headroom launcher: ${error.message}`); process.exitCode = 1; });
