#!/usr/bin/env node
// @ts-check
/** The controller executes a fixed, reviewed plan. Models supply bounded work. */
import { readFile, writeFile, mkdir, symlink, lstat, appendFile, realpath, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WorkflowStore, workflowPolicy } from '../src/orchestration-store.mjs';
import { assertExecutionProfile, assertInsideRoot, classifyAtomWithJev, JevClassificationError, validateWorkflowPlan } from '../src/orchestration.mjs';
import { runModel, startFlashServer, stopFlashServer } from '../src/model-execution.mjs';

const astra = { adapter: 'codex', model: 'gpt-6-astra', effort: 'xhigh' };
const flash = { adapter: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', effort: 'high' };
/** @param {unknown} value */
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
/** @param {string} path */
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
/** @param {string} path @param {unknown} value */
async function json(path, value) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); }
/** @param {string} root @param {string[]} args @param {string=} input */
const git = (root, args, input) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input, maxBuffer: 20 * 1024 * 1024 });
/** @param {string} text */
function structured(text) { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); }
/** @param {Record<string, any>} properties */
function objectSchema(properties) { return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }; }
const strings = { type: 'array', items: { type: 'string' } };
const packetSchema = objectSchema({ id: { type: 'string' }, objective: { type: 'string' }, readSet: strings, writeSet: strings, dependsOn: strings, instructions: { type: 'string' }, checks: strings, acceptanceIds: strings });
const planSchema = objectSchema({ summary: { type: 'string' }, packets: { type: 'array', items: packetSchema }, integrationChecks: strings });
const reviewSchema = objectSchema({ approved: { type: 'boolean' }, findings: { type: 'array', items: objectSchema({ severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] }, description: { type: 'string' }, paths: strings }) }, observations: strings });
const qaSchema = objectSchema({ accepted: { type: 'boolean' }, criteria: { type: 'array', items: objectSchema({ id: { type: 'string' }, passed: { type: 'boolean' }, evidence: strings, observation: { type: 'string' } }) }, findings: strings });

const criterionIds = ['1', '2', '3', '4', '5', '6', '7'];
/** @param {any} value */
const stringList = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim());
/** @param {string} path @param {string[]} owners */
const owned = (path, owners) => owners.some(owner => path === owner || path.startsWith(`${owner}/`));
/** @param {string} value */
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** @param {string} root */
const rootReference = root => new RegExp(escapePattern(root) + '(?=$|[\\s/"\'`:,;\\)\\]\\}])', 'g');
/** @param {string} root @param {string[]} args @param {Record<string, string>} env */
const indexedGit = (root, args, env) => execFileSync('git', ['-C', root, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

/** Reject symlink traversal before accessing source or accepting a changed path.
 * @param {string} root @param {string} path */
async function safeProductPath(root, path) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) throw new Error(`Noncanonical product path: ${path}`);
  let current = root;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink product path is not accepted: ${path}`); }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  return assertInsideRoot(root, current);
}

/** Reuse external dependencies while every workspace import resolves inside this worker.
 * @param {string} root @param {string} cwd @param {string[]} links */
async function linkWorkerDependencies(root, cwd, links) {
  /** @type {Map<string, string>} */ const workspaces = new Map();
  /** @type {Map<string, string>} */ const workspaceBins = new Map();
  for (const file of git(cwd, ['ls-files', '-z', '--', '**/package.json']).split('\0').filter(Boolean)) {
    const manifest = await readJson(await safeProductPath(cwd, file));
    if (typeof manifest.name !== 'string') continue;
    const localDirectory = dirname(resolve(cwd, file));
    if (workspaces.has(manifest.name)) throw new Error(`Duplicate workspace package: ${manifest.name}`);
    workspaces.set(manifest.name, localDirectory);
    const bins = typeof manifest.bin === 'string' ? { [manifest.name.split('/').at(-1)]: manifest.bin } : manifest.bin ?? {};
    for (const [name, entry] of Object.entries(bins)) {
      if (typeof entry === 'string') workspaceBins.set(name, assertInsideRoot(localDirectory, resolve(localDirectory, entry)));
    }
  }
  /** @param {string} source @param {string} destination @param {string} [name] */
  async function link(source, destination, name) {
    const target = name ? workspaces.get(name) : undefined;
    await symlink(target ?? await realpath(source), destination);
  }
  for (const path of links) {
    if (typeof path !== 'string' || !/(^|\/)node_modules$/.test(path)) throw new Error('Only explicit dependency directories may be linked');
    const source = assertInsideRoot(root, resolve(root, path)), destination = await safeProductPath(cwd, path);
    let entries;
    try { entries = await readdir(source); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue; throw error; }
    await mkdir(destination, { recursive: true });
    for (const name of entries) {
      if (name.startsWith('@') || name === '.bin') {
        await mkdir(resolve(destination, name));
        for (const child of await readdir(resolve(source, name))) {
          const target = resolve(destination, name, child), original = resolve(source, name, child);
          if (name === '.bin' && workspaceBins.has(child)) await symlink(/** @type {string} */ (workspaceBins.get(child)), target);
          else await link(original, target, name === '.bin' ? undefined : `${name}/${child}`);
        }
      } else await link(resolve(source, name), resolve(destination, name), name);
    }
  }
}

/** Captures tracked changes and nonignored new files without mutating the real index.
 * @param {string} root @param {string} directory */
async function captureTree(root, directory) {
  const index = resolve(directory, `index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    indexedGit(root, ['read-tree', 'HEAD'], env);
    indexedGit(root, ['add', '-A', '--', '.'], env);
    return indexedGit(root, ['write-tree'], env).trim();
  } finally { await rm(index, { force: true }); }
}

/** @param {string} root @param {string} before @param {string} after */
function treeChange(root, before, after) {
  return { patch: git(root, ['diff', '--binary', '--no-renames', before, after]),
    changedPaths: git(root, ['diff', '--name-only', '--no-renames', '-z', before, after]).split('\0').filter(Boolean) };
}

/** @param {any} plan @param {any} context @param {string[]} [acceptanceIds] @param {string} [packetization] */
export function validateDriverPlan(plan, context, acceptanceIds = criterionIds, packetization = 'partitioned') {
  if (!['partitioned', 'single'].includes(packetization)) throw new Error('Unknown packetization mode');
  if (!plan || typeof plan.summary !== 'string' || !Array.isArray(plan.packets) || !plan.packets.length
    || !stringList(plan.integrationChecks) || !plan.integrationChecks.length) throw new Error('Malformed execution plan');
  if (packetization === 'single' && plan.packets.length !== 1) throw new Error('Single packetization requires exactly one coherent implementation packet');
  for (const packet of plan.packets) {
    if (!packet || typeof packet.instructions !== 'string' || !packet.instructions.trim() || !stringList(packet.checks)
      || !stringList(packet.acceptanceIds) || new Set(packet.acceptanceIds).size !== packet.acceptanceIds.length
      || packet.acceptanceIds.some((/** @type {string} */ id) => !acceptanceIds.includes(id))) throw new Error('Packet requires exact instructions and unique canonical acceptance IDs');
    for (const text of [packet.instructions, ...packet.checks]) {
      if (rootReference(context.root).test(text)) throw new Error('Packet instructions/checks must use relative paths or {{WORKTREE_ROOT}}, never the original source root');
      if (/\bgit\s+(?:checkout|switch|reset|worktree)\b|\bbranch\s*:?\s*[`"']?(?:master|main|develop)\b/i.test(text)) throw new Error('Packet must preserve the assigned detached branch; use {{BRANCH}} and do not switch branches');
      if (/\{\{(?!WORKTREE_ROOT\}\}|BASE_SHA\}\}|BRANCH\}\})[A-Z_]+\}\}/.test(text)) throw new Error('Packet contains an unsupported runtime placeholder');
    }
  }
  const covered = new Set(plan.packets.flatMap((/** @type {any} */ packet) => packet.acceptanceIds));
  if (acceptanceIds.some(id => !covered.has(id))) throw new Error('Plan must cover every configured acceptance criterion');
  const workflow = { schemaVersion: 1, policyVersion: '1.23.0', ...context,
    atoms: plan.packets.map((/** @type {any} */ packet) => ({ ...packet, kind: 'executor', execution: flash, review: astra })) };
  const errors = validateWorkflowPlan(workflow);
  if (errors.length) throw new Error(`Invalid execution plan: ${errors.join('; ')}`);
  return workflow;
}

/** @param {any} review */
function validateReview(review) {
  const aliases = /** @type {Record<string, string>} */ ({ P0: 'blocker', P1: 'high', P2: 'medium', P3: 'low' });
  if (Array.isArray(review?.findings)) review = { ...review, findings: review.findings.map((/** @type {any} */ finding) => finding && typeof finding === 'object'
    ? { ...finding, severity: aliases[finding.severity] ?? finding.severity } : finding) };
  if (!review || typeof review.approved !== 'boolean' || !Array.isArray(review.findings) || !stringList(review.observations)
    || review.findings.some((/** @type {any} */ finding) => !finding || !['blocker', 'high', 'medium', 'low'].includes(finding.severity)
      || typeof finding.description !== 'string' || !finding.description.trim() || !stringList(finding.paths))) throw new Error('Malformed independent review');
  if (review.approved && review.findings.some((/** @type {any} */ finding) => ['blocker', 'high'].includes(finding.severity))) throw new Error('Approval contradicts unresolved blocker/high findings');
  if (!review.approved && !review.findings.length) throw new Error('Rejected review requires concrete findings');
  return review;
}

/** Validate real, private evidence rather than accepting a count or source-code references.
 * @param {any} qa @param {string} evidenceDirectory @param {string[]} [acceptanceIds] @param {boolean} [requireMedia] */
export async function validateAcceptance(qa, evidenceDirectory, acceptanceIds = criterionIds, requireMedia = true) {
  if (!qa || typeof qa.accepted !== 'boolean' || !Array.isArray(qa.criteria) || !stringList(qa.findings)) throw new Error('Malformed QA receipt');
  const ids = qa.criteria.map((/** @type {any} */ item) => item?.id);
  if (ids.length !== acceptanceIds.length || new Set(ids).size !== acceptanceIds.length || acceptanceIds.some(id => !ids.includes(id))) throw new Error('QA requires exactly the unique configured criteria');
  let hasMedia = false;
  for (const item of qa.criteria) {
    if (typeof item.passed !== 'boolean' || typeof item.observation !== 'string' || !item.observation.trim() || !stringList(item.evidence)) throw new Error('Malformed QA criterion');
    if (item.passed && !item.evidence.length) throw new Error(`Criterion ${item.id} has no runtime evidence`);
    for (const path of item.evidence) {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('QA evidence paths must be absolute');
      const canonical = await realpath(path);
      assertInsideRoot(evidenceDirectory, canonical);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || !info.size || !['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.json', '.har', '.txt'].includes(extname(path).toLowerCase())) throw new Error('QA evidence must be an existing nonempty runtime artifact');
      if (['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm'].includes(extname(path).toLowerCase())) hasMedia = true;
    }
  }
  if (qa.accepted && (qa.criteria.some((/** @type {any} */ item) => !item.passed) || (requireMedia && !hasMedia))) throw new Error('QA acceptance requires all criteria and visual runtime evidence');
  return qa;
}

/** The runtime injection is the process/transport seam used by isolated driver tests.
 * @param {any} config @param {{runModel?: typeof runModel, startFlashServer?: typeof startFlashServer, stopFlashServer?: typeof stopFlashServer, fetchImpl?: typeof fetch}} [runtime] */
export async function runWorkflow(config, runtime = {}) {
  const root = await realpath(resolve(config.root)), directory = resolve(config.evidenceDirectory);
  if (typeof config.arm !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(config.arm)) throw new Error('Invalid run/arm identifier');
  const coordinator = workflowPolicy.coordinators.find((/** @type {any} */ profile) => profile.adapter === config.coordinator?.adapter && profile.model === config.coordinator?.model && profile.effort === config.coordinator?.effort);
  if (!coordinator) throw new Error('Coordinator must match a pinned Sol high or Astra xhigh profile');
  if (!['compact', 'flow'].includes(config.jevMode)) throw new Error('Unknown Jev mode');
  const planningMode = config.planningMode === undefined ? 'two-stage' : config.planningMode;
  if (!['two-stage', 'direct'].includes(planningMode)) throw new Error('Unknown planning mode');
  const packetization = config.packetization === undefined ? 'partitioned' : config.packetization;
  if (!['partitioned', 'single'].includes(packetization)) throw new Error('Unknown packetization mode');
  const acceptanceIds = config.acceptanceIds ?? criterionIds;
  if (!stringList(acceptanceIds) || !acceptanceIds.length || new Set(acceptanceIds).size !== acceptanceIds.length) throw new Error('Configuration requires unique acceptance IDs');
  const requiresVisualReview = config.requiresVisualReview !== false;
  const ticket = config.ticket ?? 'configured-task';
  const capacity = config.concurrency ?? { writers: 2, reviewers: 2 };
  if (![capacity.writers, capacity.reviewers].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 8)) throw new Error('Writer and reviewer capacities must be integers from 1 through 8');
  const acceptanceTimeoutMs = config.acceptanceTimeoutMs ?? 30 * 60 * 1000;
  if (!Number.isSafeInteger(acceptanceTimeoutMs) || acceptanceTimeoutMs <= 0) throw new Error('Acceptance timeout must be a positive integer');
  if (git(root, ['rev-parse', 'HEAD']).trim() !== config.baseSha) throw new Error('Base revision mismatch');
  const sourceBranch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  let expectedRootTree = git(root, ['rev-parse', `${config.baseSha}^{tree}`]).trim();
  if (git(root, ['status', '--porcelain', '--untracked-files=all']).trim()) throw new Error('Initial candidate must be clean');
  if ((await readJson(config.preflightPath)).ready !== true) throw new Error('Verified environment/browser preflight required');
  await readFile(config.qaRecipePath, 'utf8');
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  if (await realpath(dirname(directory)) !== dirname(directory)) throw new Error('Evidence directory cannot traverse aliases');
  if (!relative(root, directory).startsWith('..')) throw new Error('Evidence must remain outside product');
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const ledgerPath = resolve(directory, 'events.jsonl');
  /** @param {string} type @param {any} data */
  const event = async (type, data) => appendFile(ledgerPath, JSON.stringify({ type, arm: config.arm, at: new Date().toISOString(), ...data }) + '\n', { mode: 0o600 });
  const cancellation = new AbortController();
  /** @type {Set<Promise<any>>} */ const inFlight = new Set();
  /** @type {Map<string, Promise<any>>} */ const active = new Map();
  /** @type {Map<string, any>} */ const candidates = new Map();
  /** @type {Set<string>} */ const knownWorkerRoots = new Set();
  /** @type {Map<string, string>} */ const findings = new Map();
  /** @type {Map<string, number>} */ const attempts = new Map();
  /** @type {Map<string, any>} */ const priorities = new Map();
  /** @type {Map<string, {confirmed: boolean, receiptPath: string | null, error?: string}>} */ const terminations = new Map();
  /** @type {Set<string>} */ const failures = new Set();
  /** @type {WorkflowStore | undefined} */ let store;
  /** @type {any} */ let server;
  /** @type {Promise<boolean> | undefined} */ let shutdown;
  let cleanupUnconfirmed = false;
  let serial = 0;
  const task = await readFile(config.taskFile, 'utf8');
  const common = `Authorized local task ${ticket}. Follow this task and repository guidance. Product edits are confined to this phase's assigned writeSet and worktree. Authorized execution and QA evidence may be written inside ${directory}; configured synthetic fixture operations are allowed when assigned by the controller. No publication, external messages, or production-data operations. Do not delegate or change model. All execution/review is owned by this controller. Never read or print credentials. Existing product tests only; do not add test cases or files. Report failures honestly.\n${task}\nCURRENT RUN BINDING: arm ${config.arm}. This exact arm and its configured root/fixture override historical A/B/C/D labels in task text. Never operate another arm.\nPREPARED ENVIRONMENT: ${config.preflightPath} is already verified. Do not reinstall, bootstrap, deploy remote Convex code, create projects, or activate external services. Worker packets run existing static/local checks. Root integration and neutral QA use only the local backend/watchers, if any, assigned by this preflight and the configured QA recipe. Use the recipe's authorized synthetic operations and safe wrappers.`;
  const planningScope = `Plan implementation packets and existing integration checks only. The controller already owns independent packet and integrated-code reviews, neutral QA using ${config.qaRecipePath}, and any configured visual critique. Do not redefine that lifecycle, replace the QA recipe, or include a second QA plan. Map acceptance criteria to implementation responsibilities; packet and integration checks never establish final acceptance. Never embed the original source checkout's absolute path or fixed branch: workers use private detached worktrees. Instructions/checks must use relative product paths or {{WORKTREE_ROOT}}, {{BASE_SHA}}, {{BRANCH}}; never switch branches or commit.${packetization === 'single' ? ' Return exactly one coherent implementation packet covering every configured acceptance criterion. Its exact instructions must order shared-contract changes before their consumers, identify intermediate observations and existing checks, and keep all coupled product edits within its explicit writeSet. Independent plan review must verify that this ordered packet is complete and executable.' : ''}`;
  const codeReviewScope = 'Review code and run relevant existing checks in the prepared environment. Temporary files required by those checks are permitted; do not edit product files, change branches or commit. Runtime/browser QA is a later controller gate; future QA not yet performed is not alone a code-review defect. A rejected review must include a concrete product defect or validation blocker in findings; for a validation blocker, state the exact command and observed failure evidence. Never return a rejected review with empty findings.';
  /** @param {string} prompt @param {string} cwd */
  function bindWorkerPrompt(prompt, cwd) {
    const replacedRoots = new Set([root, resolve(config.root), ...[...knownWorkerRoots].filter(path => path !== cwd)]);
    for (const original of replacedRoots) prompt = prompt.replace(rootReference(original), cwd);
    for (const branch of new Set(['master', 'main', 'develop', sourceBranch])) {
      if (branch !== 'HEAD') prompt = prompt.replace(new RegExp('\\bbranch\\s*:?\\s*[`"\']?' + escapePattern(branch) + '[`"\']?\\b', 'gi'), 'branch HEAD (detached)');
    }
    prompt = prompt.replaceAll('{{WORKTREE_ROOT}}', cwd).replaceAll('{{BASE_SHA}}', config.baseSha).replaceAll('{{BRANCH}}', 'HEAD');
    if (/\{\{[A-Z_]+\}\}/.test(prompt)) throw new Error('Unresolved worker runtime placeholder');
    for (const original of replacedRoots) if (rootReference(original).test(prompt)) throw new Error('Unresolved original-root instruction in worker packet');
    return `${prompt}\nAUTHORITATIVE EXECUTION BINDING: work only in ${cwd}. All relative product paths and checks resolve there. Base revision ${config.baseSha}; branch HEAD (detached). Do not change branches, commit, or operate another checkout. This binding overrides copied repository/root/branch metadata in task, review and correction text. The controller captures and integrates your candidate.`;
  }
  /** @param {string} boundary */
  async function assertSourceRoot(boundary) {
    const observedTree = await captureTree(root, directory);
    const head = git(root, ['rev-parse', 'HEAD']).trim(), branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (observedTree !== expectedRootTree || head !== config.baseSha || branch !== sourceBranch) {
      const change = treeChange(root, expectedRootTree, observedTree);
      const receiptPath = resolve(directory, `source-root-violation-${randomUUID()}.json`);
      await json(receiptPath, { boundary, expectedTree: expectedRootTree, observedTree, expectedHead: config.baseSha, head, expectedBranch: sourceBranch, branch, changedPaths: change.changedPaths });
      await event('source-root-violation', { boundary, receiptPath, changedPaths: change.changedPaths });
      cancellation.abort();
      throw new Error(`Source root changed outside controller-approved integration at ${boundary}; evidence retained`);
    }
  }
  /** Compute the only permitted next source snapshot before applying a reviewed patch.
   * @param {string} patchPath */
  async function integrateReviewedPatch(patchPath) {
    await assertSourceRoot('before reviewed integration');
    const index = resolve(directory, `integration-index-${randomUUID()}`), env = { GIT_INDEX_FILE: index };
    let nextTree;
    try {
      indexedGit(root, ['read-tree', expectedRootTree], env);
      indexedGit(root, ['apply', '--cached', '--whitespace=nowarn', patchPath], env);
      nextTree = indexedGit(root, ['write-tree'], env).trim();
    } finally { await rm(index, { force: true }); }
    git(root, ['apply', '--index', '--check', patchPath]);
    git(root, ['apply', '--index', '--whitespace=nowarn', patchPath]);
    const observed = await captureTree(root, directory);
    if (observed !== nextTree) {
      await assertSourceRoot('during reviewed integration');
      throw new Error('Reviewed integration did not produce the expected source tree');
    }
    expectedRootTree = nextTree;
  }
  /** @param {string} phase @param {any} profile @param {string} prompt @param {any} [options] */
  async function stage(phase, profile, prompt, options = {}) {
    if (cancellation.signal.aborted) throw new Error('Workflow cancelled');
    const jobId = `${String(++serial).padStart(3, '0')}-${phase}`;
    const evidenceDirectory = resolve(directory, 'jobs', jobId);
    await event('job-started', { jobId, phase, profile });
    const cwd = options.cwd ?? root;
    const fullPrompt = `${common}\n\n${prompt}`;
    const pending = (runtime.runModel ?? runModel)({ ...options, profile, cwd, prompt: cwd === root ? fullPrompt : bindWorkerPrompt(fullPrompt, cwd), evidenceDirectory, phase, arm: config.arm, server, signal: cancellation.signal });
    inFlight.add(pending);
    let result;
    try { result = await pending.finally(() => inFlight.delete(pending)); }
    catch (error) {
      cleanupUnconfirmed = true;
      await event('cleanup-unconfirmed', { scope: 'job', jobId, phase, terminationObserved: false, reason: 'Adapter rejected without a termination receipt' });
      throw error;
    }
    if (result.cancellationConfirmed !== true) {
      cleanupUnconfirmed = true;
      await event('cleanup-unconfirmed', { scope: 'job', jobId, phase, terminationObserved: false, receiptPath: result.receiptPath ?? null });
    }
    await event('job-completed', { jobId, phase, receiptPath: result.receiptPath, ok: result.ok });
    return result;
  }
  /** @param {any} result @param {any} profile */
  function requireSuccess(result, profile) {
    if (!result?.ok || result.identityAttested !== true || result.cancellationConfirmed !== true) throw new Error(`Model execution failed; inspect ${result?.receiptPath ?? 'missing receipt'}`);
    assertExecutionProfile(result.execution, profile);
    return result.finalText;
  }
  /** @param {string} phase @param {any} profile @param {string} prompt @param {any} [options] */
  async function success(phase, profile, prompt, options = {}) { return requireSuccess(await stage(phase, profile, prompt, options), profile); }
  /** @param {Promise<any>} pending @param {any} details */
  function observeAttempt(pending, details) {
    const key = details.attempt.reviewAttemptId ?? details.attempt.attemptId;
    return pending.then(result => {
      terminations.set(key, { confirmed: result.cancellationConfirmed === true, receiptPath: result.receiptPath ?? null });
      return { ...details, result };
    }, error => {
      terminations.set(key, { confirmed: false, receiptPath: null, error: 'Adapter rejected without a termination receipt' });
      return { ...details, error };
    });
  }
  async function stopRuntime() {
    if (!server) return true;
    shutdown ??= (async () => {
      let failure = null;
      try { await (runtime.stopFlashServer ?? stopFlashServer)(server); }
      catch (error) { failure = error instanceof Error ? error.message : 'Flash server stop failed'; }
      const confirmed = server.stopped === true;
      if (!confirmed) {
        cleanupUnconfirmed = true;
        await event('cleanup-unconfirmed', { scope: 'flash-server', terminationObserved: false, failure });
      }
      return confirmed;
    })();
    return shutdown;
  }
  /** @param {string} phase @param {string} candidate @param {any} problem */
  function requireProgress(phase, candidate, problem) {
    const key = digest({ phase, candidate, problem });
    if (failures.has(key)) throw new Error(`${phase} repeats the same failed candidate and findings; evidence retained`);
    failures.add(key);
  }
  /** @returns {Promise<string>} */
  async function jevKey() {
    const lines = (await readFile(config.credentialFile, 'utf8')).split('\n');
    const line = lines.find(value => /^(?:export\s+)?TYPESAFE_API_KEY\s*=/.test(value.trim()));
    const key = line?.trim().replace(/^(?:export\s+)?TYPESAFE_API_KEY\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, '');
    if (!key) throw new Error('Jev credential unavailable');
    return key;
  }
  /** One compact packet-boundary call, then bounded per-file diff coverage before review.
   * @param {any} atom @param {string} boundary @param {any} [candidate] */
  async function judge(atom, boundary, candidate) {
    const apiKey = await jevKey();
    /** @type {any[]} */ const packets = [];
    if (config.jevMode === 'flow' && candidate?.changedPaths.length) {
      for (const path of candidate.changedPaths) {
        const diff = git(candidate.cwd, ['diff', '--no-ext-diff', '--no-renames', '--unified=5', candidate.initialTree, candidate.tree, '--', path]);
        const chunks = diff.match(/[\s\S]{1,1500}/g) ?? ['No textual diff; inspect the binary or mode change directly.'];
        for (let offset = 0; offset < chunks.length; offset += 8) {
          packets.push({ path, flowContext: { fileSummaries: chunks.slice(offset, offset + 8).map((summary, index) => ({ path, summary: `Diff chunk ${offset + index + 1}/${chunks.length}:\n${summary}` })),
            changeSummary: `Packet ${atom.id}: ${atom.objective}`.slice(0, 2000), reviewCoverage: atom.acceptanceIds.map((/** @type {string} */ id) => ({ acceptanceId: id, evidenceSummary: `Pending independent review of ${path}; writer completion is not acceptance.` })) } });
        }
      }
    } else packets.push({ path: null });
    const receipts = [];
    for (const packet of packets) {
      const startedAt = new Date().toISOString();
      let receipt;
      try {
        receipt = await classifyAtomWithJev({ atom: { ...atom, exactContext: undefined, observedFacts: { boundary, candidateHash: candidate?.hash ?? null } },
          run: { runId: config.arm, rootModel: coordinator.model, phase: boundary, baseSha: config.baseSha,
            verifiedAtomIds: store?.snapshot().atoms.filter((entry) => entry.state === 'verified').map((entry) => entry.id) ?? [] },
          contextMode: packet.flowContext ? 'flow' : 'compact', flowContext: packet.flowContext, apiKey, fetchImpl: runtime.fetchImpl });
      } catch (error) {
        const failure = { atomId: atom.id, boundary, startedAt, endedAt: new Date().toISOString(), valid: false, model: null, usage: null, usageComplete: false,
          coveredFiles: packet.path ? [packet.path] : [], questions: packet.flowContext ? 8 : 5,
          ...(error instanceof JevClassificationError ? error.telemetry : {}), error: error instanceof Error ? error.message : 'Jev failure' };
        const receiptPath = resolve(directory, 'jev', `${atom.id}-${boundary}-${randomUUID()}.json`);
        await json(receiptPath, failure);
        await event('jev-completed', { ...failure, receiptPath });
        throw error;
      }
      const receiptPath = resolve(directory, 'jev', `${atom.id}-${boundary}-${randomUUID()}.json`);
      await json(receiptPath, { ...receipt, coveredFiles: packet.path ? [packet.path] : [], reviewCoverage: packet.flowContext?.reviewCoverage ?? [] });
      await event('jev-completed', { atomId: atom.id, boundary, startedAt, endedAt: new Date().toISOString(), valid: true, receiptPath,
        model: receipt.model, usage: receipt.usage, coveredFiles: packet.path ? [packet.path] : [], questions: Object.keys(receipt.judgments).length });
      receipts.push(receipt);
    }
    const priority = Math.max(...receipts.map(receipt => receipt.semanticOverlap + receipt.judgments.has_open_decision.noul + 1 - receipt.judgments.context_sufficient.noul));
    return { priority, focus: receipts.map(receipt => ({ contextSufficient: receipt.judgments.context_sufficient.noul, semanticOverlap: receipt.semanticOverlap,
      fileScopeComplete: receipt.judgments.file_scope_complete?.noul ?? null, changeMatchesObjective: receipt.judgments.change_matches_objective?.noul ?? null,
      reviewCoverageSufficient: receipt.judgments.review_coverage_sufficient?.noul ?? null })), coveredFiles: candidate?.changedPaths ?? [],
      instruction: 'Prioritize scrutiny of low coverage/context scores and semantic overlap. Every acceptance criterion and mandatory independent review still applies.' };
  }
  /** @param {any} atom @param {number} number */
  async function workerTree(atom, number) {
    const cwd = resolve(config.workerRoots, `${atom.id}-${number}`);
    if (!relative(root, cwd).startsWith('..')) throw new Error('Worker trees must remain outside the arm root');
    await mkdir(dirname(cwd), { recursive: true, mode: 0o700 });
    if (await realpath(dirname(cwd)) !== dirname(cwd)) throw new Error('Worker roots cannot traverse aliases');
    const initialTree = await captureTree(root, directory);
    git(root, ['worktree', 'add', '--detach', cwd, config.baseSha]);
    knownWorkerRoots.add(cwd);
    git(cwd, ['read-tree', '--reset', '-u', initialTree]);
    const previous = candidates.get(atom.id);
    if (previous?.patch) {
      git(cwd, ['apply', '--check', previous.patchPath]);
      git(cwd, ['apply', '--whitespace=nowarn', previous.patchPath]);
    }
    for (const path of [...atom.readSet, ...atom.writeSet]) await safeProductPath(cwd, path);
    await linkWorkerDependencies(root, cwd, config.dependencyLinks ?? ['node_modules', 'apps/dashboard/node_modules', 'packages/convex/node_modules']);
    return { cwd, initialTree, preservedCandidateHash: previous?.hash ?? null };
  }
  /** @param {any} candidate */
  async function assertCandidate(candidate) {
    if (await captureTree(candidate.cwd, directory) !== candidate.tree || digest(await readFile(candidate.patchPath, 'utf8')) !== candidate.hash) throw new Error('Candidate changed after its immutable review snapshot');
  }
  try {
    server = await (runtime.startFlashServer ?? startFlashServer)({ evidenceDirectory: resolve(directory, 'flash-server'), cwd: root, permission: { '*': 'allow' }, signal: cancellation.signal });
    await json(resolve(directory, 'manifest.json'), { ...config, ticket, acceptanceIds, requiresVisualReview, planningMode, packetization, concurrency: capacity, coordinator, startedAt: new Date().toISOString(), controllerVersion: '1.23.3' });
    await event('task-started', { ticket });
    const discovery = planningMode === 'two-stage' ? await success('discovery', coordinator, 'Inspect relevant code and give a concise handoff: canonical APIs/forms, dependencies, existing checks and open decisions. Read only; do not reproduce another benchmark solution.', { sandbox: 'read-only' }) : undefined;
    const planningInput = planningMode === 'direct'
      ? 'Inspect the actual relevant source in this checkout, its canonical APIs/forms, dependencies, existing checks and open decisions, and produce exact portable implementation packets in this same pass. No separate discovery handoff is provided. Do not reproduce another benchmark solution.'
      : 'Produce exact portable packets using this discovery and source.';
    let plan = structured(await success('plan', astra, `${planningInput} ${planningScope}${packetization === 'partitioned' ? ' Prefer 2–4 coherent packets; settle shared contracts before consumers.' : ''} Include exact instructions, owned relative paths, dependencies and existing focused checks. Use exactly these acceptance IDs in recipe order and cover every criterion: ${JSON.stringify(acceptanceIds)}. Do not include benchmark/setup artifacts in product ownership.${discovery === undefined ? '' : `\nDISCOVERY:\n${discovery}`}`, { outputSchema: planSchema, sandbox: 'read-only' }));
    const context = { runId: config.arm, root, baseSha: config.baseSha, coordinator };
    for (;;) {
      try { validateDriverPlan(plan, context, acceptanceIds, packetization); }
      catch (error) {
        const problem = error instanceof Error ? error.message : 'Invalid packet contract';
        requireProgress('plan-contract', digest(plan), problem);
        plan = structured(await success('plan-correction', astra, `Correct this deterministic packet contract failure: ${problem}. ${planningScope} Preserve task coverage and exact instructions.\nPLAN:${JSON.stringify(plan)}`, { outputSchema: planSchema, sandbox: 'read-only' }));
        continue;
      }
      const review = validateReview(structured(await success('plan-review', astra, `Independently review this plan against task and source: implementation coverage, shared contracts, ownership, dependencies, integration checks and open decisions. ${planningScope} Read only.\n${JSON.stringify(plan)}`, { outputSchema: reviewSchema, sandbox: 'read-only' })));
      if (review.approved) break;
      requireProgress('plan', digest(plan), review.findings);
      plan = structured(await success('plan-correction', astra, `Correct this exact plan using source and findings. ${planningScope}\nPLAN:${JSON.stringify(plan)}\nREVIEW:${JSON.stringify(review)}`, { outputSchema: planSchema, sandbox: 'read-only' }));
    }
    await json(resolve(directory, 'approved-plan.json'), plan);
    const workflowPlan = validateDriverPlan(plan, context, acceptanceIds, packetization);
    for (const atom of workflowPlan.atoms) for (const path of [...atom.readSet, ...atom.writeSet]) await safeProductPath(root, path);
    store = await WorkflowStore.create({ directory: resolve(directory, 'workflow'), plan: workflowPlan });
    for (;;) {
      for (const atom of store.awaitingVerification()) {
        if ([...active.keys()].filter(key => key.startsWith('review:')).length >= capacity.reviewers) break;
        const candidate = candidates.get(atom.id);
        await assertSourceRoot(`before review ${atom.id}`);
        await assertCandidate(candidate);
        const judgment = await judge(atom, 'review', candidate);
        const attempt = await store.startReview(atom.id);
        const prompt = `Independently inspect the immutable candidate diff and relevant code. ${codeReviewScope} Approve only correct observable behavior satisfying the exact packet and task.\nEXACT INSTRUCTIONS:\n${atom.instructions}\nPACKET:${JSON.stringify(atom)}\nJEV REVIEW FOCUS:${JSON.stringify(judgment)}\nPatch:${candidate.patchPath}\nBase tree:${candidate.initialTree}\nCandidate tree:${candidate.tree}\nSHA256:${candidate.hash}`;
        active.set(`review:${atom.id}`, observeAttempt(stage(`review-${atom.id}`, astra, prompt, { cwd: candidate.cwd, outputSchema: reviewSchema, sandbox: 'danger-full-access' }),
          { kind: 'review', atom, candidate, attempt }));
      }
      const ready = store.ready();
      for (const atom of ready) {
        const key = `${atom.id}:${atom.attempt}:${atom.correction ?? ''}`;
        if (!priorities.has(key)) priorities.set(key, await judge(atom, 'implementation'));
      }
      ready.sort((a, b) => priorities.get(`${b.id}:${b.attempt}:${b.correction ?? ''}`).priority - priorities.get(`${a.id}:${a.attempt}:${a.correction ?? ''}`).priority);
      for (const atom of ready) {
        if ([...active.keys()].filter(key => key.startsWith('write:')).length >= capacity.writers) break;
        // Earlier claims may have removed this atom from the conflict-free ready set.
        if (!store.ready().some(readyAtom => readyAtom.id === atom.id)) continue;
        await assertSourceRoot(`before writer ${atom.id}`);
        const number = (attempts.get(atom.id) ?? 0) + 1;
        attempts.set(atom.id, number);
        const candidate = await workerTree(atom, number);
        const attempt = await store.start(atom.id);
        const judgment = priorities.get(`${atom.id}:${atom.attempt}:${atom.correction ?? ''}`);
        const prompt = `Execute the exact packet in this worktree. You are not alone; do not change files outside writeSet or revert prior work. Report missing decisions without widening scope. Do not delegate or change model. Run the listed existing checks and report actual results and changed paths. No product report files.\nEXACT INSTRUCTIONS:\n${atom.instructions}\nPACKET:${JSON.stringify(atom)}\nJEV FOCUS:${JSON.stringify(judgment)}\nCORRECTION:${findings.get(atom.id) ?? 'Initial execution'}\nPreserved previous candidate:${candidate.preservedCandidateHash ?? 'none'}`;
        active.set(`write:${atom.id}`, observeAttempt(stage(`write-${atom.id}`, flash, prompt, { cwd: candidate.cwd, sandbox: 'danger-full-access' }),
          { kind: 'write', atom, candidate, attempt }));
      }
      if (!active.size) {
        await assertSourceRoot('packet workflow terminal');
        await json(resolve(directory, 'workflow-terminal.json'), store.snapshot());
        if (store.snapshot().atoms.some(atom => atom.state !== 'verified')) throw new Error('Workflow has unfinished work and no active attempt');
        break;
      }
      const finished = await Promise.race(active.values());
      active.delete(`${finished.kind}:${finished.atom.id}`);
      await assertSourceRoot(`after ${finished.kind} ${finished.atom.id}`);
      if (finished.error) throw finished.error;
      const { atom, attempt, result } = finished;
      requireSuccess(result, finished.kind === 'write' ? flash : astra);
      if (git(finished.candidate.cwd, ['rev-parse', 'HEAD']).trim() !== config.baseSha || git(finished.candidate.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== 'HEAD') throw new Error('Worker changed its pinned base revision or detached branch');
      if (finished.kind === 'write') {
        const tree = await captureTree(finished.candidate.cwd, directory);
        const change = treeChange(finished.candidate.cwd, finished.candidate.initialTree, tree);
        if (atom.writeSet.length && !change.changedPaths.length) throw new Error(`Empty implementation candidate for ${atom.id}; no writer completion accepted`);
        for (const path of change.changedPaths) {
          if (!owned(path, atom.writeSet)) throw new Error(`Unowned candidate change: ${path}`);
          await safeProductPath(finished.candidate.cwd, path);
        }
        const candidate = { ...finished.candidate, ...change, tree, hash: digest(change.patch), patchPath: resolve(directory, `candidate-${atom.id}-${attempt.attemptId}.patch`) };
        await writeFile(candidate.patchPath, candidate.patch, { mode: 0o600, flag: 'wx' });
        await json(`${candidate.patchPath}.json`, { tree, initialTree: candidate.initialTree, candidateHash: candidate.hash, changedPaths: candidate.changedPaths, cwd: candidate.cwd });
        candidates.set(atom.id, candidate);
        await store.complete(atom.id, { ...attempt, ok: true, changedPaths: candidate.changedPaths, candidateHash: candidate.hash, execution: result.execution, terminationObserved: true });
      } else {
        const review = validateReview(structured(result.finalText)), candidate = finished.candidate;
        await assertCandidate(candidate);
        const receipt = { ...attempt, type: 'acceptance-receipt', verifier: result.threadId ?? result.sessionId, acceptanceIds: atom.acceptanceIds,
          changedPaths: candidate.changedPaths, candidateHash: candidate.hash, execution: result.execution, ok: review.approved, terminationObserved: true };
        store.validateVerification(atom.id, receipt);
        if (review.approved && candidate.patch) {
          await integrateReviewedPatch(candidate.patchPath);
        }
        await store.verify(atom.id, receipt);
        if (!review.approved) {
          requireProgress(`packet-${atom.id}`, candidate.hash, review.findings);
          findings.set(atom.id, JSON.stringify(review));
          await store.retry(atom.id, JSON.stringify(review.findings));
        }
      }
    }
    const ownerPaths = [...new Set(workflowPlan.atoms.flatMap((/** @type {any} */ atom) => atom.writeSet))];
    /** @returns {Promise<string>} */
    async function integratedTree() {
      if (git(root, ['rev-parse', 'HEAD']).trim() !== config.baseSha || git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== sourceBranch) throw new Error('Integrated candidate changed its pinned base revision or branch');
      const tree = await captureTree(root, directory);
      for (const path of treeChange(root, config.baseSha, tree).changedPaths) {
        if (!owned(path, ownerPaths)) throw new Error(`Unowned integration change: ${path}`);
        await safeProductPath(root, path);
      }
      return tree;
    }
    await success('integration', coordinator, `Verify the integrated task and resolve integration defects. Preserve existing packet work and stay within these owned paths: ${JSON.stringify(ownerPaths)}. Run and report these existing checks: ${JSON.stringify(plan.integrationChecks)}. No new tests. This is not final acceptance.`, { sandbox: 'danger-full-access' });
    await event('integration-completed', { candidateTree: await integratedTree() });
    const qaDirectory = resolve(directory, 'qa');
    await mkdir(qaDirectory, { recursive: true, mode: 0o700 });
    const qaPrompt = (/** @type {string} */ roundDirectory) => `Execute the prepared neutral QA recipe at ${config.qaRecipePath}; use only the assigned local synthetic fixture${requiresVisualReview ? ' and authorized headed browser' : ''}. Read binding ${config.preflightPath}. Verify every configured criterion from the recipe; preserve its required runtime/device coverage. Do not modify product code. Capture actual nonempty runtime evidence inside ${roundDirectory}, ${requiresVisualReview ? 'including desktop/mobile images and API observations' : 'using the executable local recipe; browser and visual work are not required by this configuration'}. Return exactly one criterion each for these IDs in recipe order: ${JSON.stringify(acceptanceIds)}; normalize any recipe headings to these configured IDs with absolute existing artifact paths and concrete observations. Source/test completion cannot establish acceptance.`;
    for (;;) {
      const before = await integratedTree();
      const review = validateReview(structured(await success('integrated-code-review', astra, `Independently review the full integrated diff against every configured task criterion ${JSON.stringify(acceptanceIds)} and actual source. ${codeReviewScope} Inspect Git diff ${config.baseSha} to current candidate tree ${before}. Include coordinator integration/correction changes; packet approvals do not substitute for this review.`, { outputSchema: reviewSchema, sandbox: 'danger-full-access' })));
      if (await integratedTree() !== before) throw new Error('Independent review changed the integrated candidate');
      if (!review.approved) {
        requireProgress('integrated-review', before, review.findings);
        await success('integration-correction', coordinator, `Correct only these concrete integrated review findings within owned paths ${JSON.stringify(ownerPaths)}. Run affected existing checks.\n${JSON.stringify(review)}`, { sandbox: 'danger-full-access' });
        continue;
      }
      const roundDirectory = resolve(qaDirectory, `round-${serial + 1}`);
      await mkdir(roundDirectory, { mode: 0o700 });
      const qa = await validateAcceptance(structured(await success('acceptance', astra, qaPrompt(roundDirectory), { outputSchema: qaSchema, sandbox: 'danger-full-access', timeoutMs: acceptanceTimeoutMs })), roundDirectory, acceptanceIds, requiresVisualReview);
      if (await integratedTree() !== before) throw new Error('Neutral QA changed the integrated candidate');
      await json(resolve(directory, `qa-${serial}.json`), { ...qa, candidateTree: before });
      if (!qa.accepted) {
        requireProgress('acceptance', before, qa);
        await success('acceptance-correction', coordinator, `Correct only these runtime acceptance failures within owned paths ${JSON.stringify(ownerPaths)}; inspect evidence and run affected existing checks.\n${JSON.stringify(qa)}`, { sandbox: 'danger-full-access' });
        continue;
      }
      const visual = requiresVisualReview ? validateReview(structured(await success('visual-critique', astra, `Independently inspect actual desktop/mobile images and runtime media from this neutral QA. Judge design consistency, hierarchy, spacing, labels, focus, overflow and required visual behavior against task and existing product identity. Do not modify code. Do not infer visual quality from source or passing checks.\n${JSON.stringify(qa)}`, { outputSchema: reviewSchema, sandbox: 'read-only' }))) : { approved: true, findings: [], observations: ['Visual review not required by configured task'] };
      if (await integratedTree() !== before) throw new Error('Visual critique changed the integrated candidate');
      if (!visual.approved) {
        requireProgress('visual-critique', before, visual.findings);
        await success('visual-correction', coordinator, `Correct only the concrete visual findings within owned paths ${JSON.stringify(ownerPaths)}. Preserve accepted behavior and run affected checks.\n${JSON.stringify(visual)}`, { sandbox: 'danger-full-access' });
        continue;
      }
      const finalPatch = treeChange(root, config.baseSha, before).patch;
      if (!await stopRuntime()) throw new Error('Workflow cleanup is unconfirmed; controller ownership retained');
      await json(resolve(directory, 'acceptance.json'), { ...qa, integratedReview: review, visualReview: visual, status: 'accepted-local', candidateTree: before,
        candidateHash: digest(finalPatch), arm: config.arm, acceptedAt: new Date().toISOString() });
      await event('task-accepted', { candidateTree: before, candidateHash: digest(finalPatch) });
      return { status: 'accepted-local', candidateTree: before, candidateHash: digest(finalPatch) };
    }
  } catch (error) {
    cancellation.abort();
    await Promise.allSettled(inFlight);
    await Promise.allSettled(active.values());
    const serverStopped = await stopRuntime();
    if (store) {
      for (const atom of store.snapshot().atoms) {
        if (['running', 'reviewing', 'cancelling'].includes(atom.state)) {
          const attempt = atom.reviewAttempt ?? store.snapshot().activeAttempts[atom.id];
          const observed = terminations.get(attempt.reviewAttemptId ?? attempt.attemptId);
          if (observed?.confirmed === true && (attempt.execution.adapter !== 'opencode' || serverStopped)) {
            await store.stopped(atom.id, { ...attempt, terminationObserved: true, terminationReceiptPath: observed.receiptPath, reason: 'Controller failure after confirmed adapter termination' });
          } else {
            cleanupUnconfirmed = true;
            if (atom.state !== 'cancelling') await store.cancel(atom.id, 'Adapter termination remains unconfirmed');
            await event('cleanup-unconfirmed', { scope: 'atom', atomId: atom.id, attemptId: attempt.attemptId, reviewAttemptId: attempt.reviewAttemptId ?? null,
              terminationObserved: false, observed: observed ?? null, serverStopped, ownershipRetained: true });
          }
        }
      }
      await json(resolve(directory, 'workflow-failed.json'), store.snapshot());
    }
    await event('task-failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    cancellation.abort();
    await Promise.allSettled(inFlight);
    await stopRuntime();
    if (store && !cleanupUnconfirmed) await store.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = process.argv[process.argv.indexOf('--manifest') + 1];
  if (!process.argv.includes('--manifest') || !manifest) throw new Error('Usage: run-jev-workflow.mjs --manifest <private arm manifest>');
  await runWorkflow(await readJson(resolve(manifest)));
}
