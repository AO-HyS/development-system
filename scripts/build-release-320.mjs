// @ts-check
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkillCatalog } from '../src/skills.mjs';
import { checkRolePolicyOutputs, renderHostInstructions } from '../src/role-policy.mjs';
import { checkActiveToolingDocs } from './check-active-tooling-docs.mjs';
import { openUpstreamClones } from '../src/skills-upstream.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '3.2.0', previous = '3.1.0', catalogVersion = '0.84.0', previousCatalog = '0.83.0', prefix = `artifacts/${version}`;
// 3.2.0: a clean and current catalog. The owner (2026-11-17): «vamos a hacer la limpieza, vamos a corregir, vamos a poner
// todas al día y vamos a hacer una manera … para que todas estuvieran al día». 43 skills leave the catalog, the
// reviewed copies (~/.development-system/private/skills-archivo/20261118-revision/candidatas) replace the installed
// ones, and `development-system skills-upstream` lists the skills of other authors that fell behind their source.
/** Skills that leave the catalog; their installed destinations join `cleanup`. */
const retired = [
  'adapt', 'animate', 'animation-vocabulary', 'ask-matt', 'audit', 'bolder', 'break', 'clarify', 'claude-handoff', 'code-review',
  'colorize', 'critique', 'delight', 'distill', 'emil-prototype', 'explain-interface', 'find-animation-opportunities', 'find-skills',
  'firecrawl', 'git-guardrails-claude-code', 'grill-me', 'implement', 'install-anti-slop', 'layout', 'loop-me',
  'make-interfaces-feel-better', 'optimize', 'orchestrate-work', 'orchestration-pilot', 'overdrive', 'parallel-work', 'polish',
  'pr-lens', 'quieter', 'research', 'scaffold-exercises', 'shape', 'teach', 'typeset', 'write-swift', 'writing-beats',
  'writing-fragments', 'writing-shape',
];
// find-skills was never in the catalog (an older cleanup already lists .codex/skills/find-skills); its other installed
// copies leave the same way.
const unmanagedRetired = { 'find-skills': ['.agents/skills/find-skills', '.claude/skills/find-skills'] };
/**
 * Skills whose installed bytes move to `${prefix}/skills/<kind>/<name>`; the kind is the one the previous catalog
 * already gives them. The reviewed candidates, plus wayfinder and good-css, whose only change is a pointer away from a
 * retired skill, and the skills `skills-upstream` found behind their authors after the review.
 * @type {string[]}
 */
const updatedSkills = [
  'agent-browser', 'animate-expo', 'animation-performance', 'apple-design', 'architect', 'ask-sonner', 'behavioral-evidence',
  'better-interface', 'break-ui', 'codebase-design', 'coding-orchestration', 'convex-guardian', 'cross-review', 'design-quality',
  'development-steward', 'diagnosing-bugs', 'drive-development-flow', 'emil-animate', 'emil-design-eng', 'evidence-capture',
  'flow-code-review', 'flow-implement', 'good-css', 'grill-with-docs', 'impeccable', 'implement-spec', 'improve-animations',
  'improve-codebase-architecture', 'interface-review', 'linear-hygiene', 'mobile-native', 'pick-ui-library', 'posthog-observability',
  'primitives-gardener', 'prototype', 'release-train', 'review-animations', 'review-thread', 'setup-matt-pocock-skills', 'shadcn',
  'to-tickets', 'variant', 'wait-what', 'wayfinder', 'working-backwards',
  // Behind their authors' current commits per `skills-upstream`; brought up to date after the review.
  'benchmark-checklist', 'better-accessibility', 'better-colors', 'better-layout', 'better-typography', 'better-ui',
  'better-writing', 'correct', 'grilling', 'handoff', 'wizard',
];
/**
 * New upstream pins (commit and path in the author's repository) of the skills that were brought up to date. Their
 * capabilityTreeSha256 and licenseSha256 are computed from those exact upstream bytes (`upstreamHashes`).
 * @type {Record<string, [string, string]>}
 */
const upstreamPins = {
  'agent-browser': ['b06e2533ba9b3823b8a96c859d455cb55f4d7893', 'skills/agent-browser'],
  'animate-expo': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/animate-expo'],
  'animation-performance': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/animation-performance'],
  'apple-design': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/apple-design'],
  'architect': ['93b916d4a1e806507e22f4716b352fa91f2b227e', 'pstack/skills/architect'],
  'ask-sonner': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/ask-sonner'],
  'better-interface': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/better-interface'],
  'break-ui': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/break-ui'],
  'codebase-design': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/engineering/codebase-design'],
  'diagnosing-bugs': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/engineering/diagnosing-bugs'],
  'emil-animate': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/animate'],
  'emil-design-eng': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/emil-design-eng'],
  // The universal.zip distribution is gone upstream; the skill is the repository's generated .agents/skills/impeccable.
  'impeccable': ['d41d9860b0094dcb68030657da63461212835aaa', '.agents/skills/impeccable'],
  'improve-animations': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/improve-animations'],
  'improve-codebase-architecture': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/engineering/improve-codebase-architecture'],
  'interface-review': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/interface-review'],
  'mobile-native': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/mobile-native'],
  'pick-ui-library': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/pick-ui-library'],
  'review-animations': ['64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'skills/review-animations'],
  'setup-matt-pocock-skills': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/engineering/setup-matt-pocock-skills'],
  'shadcn': ['968d8cb9dc42ae5d52e8fd356cf84596ec832a26', 'skills/shadcn'],
  'to-tickets': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/engineering/to-tickets'],
  'variant': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/variant'],
  'benchmark-checklist': ['93b916d4a1e806507e22f4716b352fa91f2b227e', 'pstack/skills/benchmark-checklist'],
  'better-accessibility': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/better-accessibility'],
  'better-colors': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/better-colors'],
  'better-layout': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/better-layout'],
  'better-typography': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/better-typography'],
  'better-ui': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/better-ui'],
  'better-writing': ['2136b60ecf0078f1556623f8b6d26a1563c03512', 'skills/better-writing'],
  'correct': ['93b916d4a1e806507e22f4716b352fa91f2b227e', 'pstack/skills/correct'],
  'grilling': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/productivity/grilling'],
  'handoff': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/productivity/handoff'],
  'wayfinder': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/engineering/wayfinder'],
  'wizard': ['5863806dd4e15c63174bee4e7515a4256792ecfa', 'skills/engineering/wizard'],
};
// Codex role profiles whose model routing changes in this version (hand-written under the prefix).
/** @type {string[]} */
const updatedCodexAgents = [];
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--write', '--check'].includes(mode)) throw new Error('Use --write or --check');
/** @param {string|Buffer} value */
const hash = value => createHash('sha256').update(value).digest('hex');
/** @param {string} path */
const bytes = path => readFile(resolve(root, path));
/** @param {string} path @param {string|Buffer} value */
async function output(path, value) {
  // develop counts as published: the operator installs from it before main or a tag exist.
  // Both modes compare, so the release:prepare gate also refuses rewritten published bytes.
  for (const ref of ['refs/remotes/origin/develop', 'refs/remotes/origin/main', `refs/tags/v${version}`]) {
    let published;
    try { published = execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); } catch { continue; }
    if (!published.equals(Buffer.from(value))) throw new Error(`Published ${path} is immutable; create a new version`);
  }
  if (mode === '--check') {
    if (!(await bytes(path)).equals(Buffer.from(value))) throw new Error(`Generated bytes drift: ${path}`);
    return;
  }
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), value);
}
/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
  const result = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Nonregular skill source: ${path}`);
  }
  return result.sort();
}
/** @param {string} directory */
async function folderHash(directory) {
  const digest = createHash('sha256');
  for (const path of await files(directory)) digest.update(relative(directory, path)).update('\0').update(await bytes(path)).update('\0');
  return digest.digest('hex');
}
/** Shared global instructions: canonical body plus the generated host sections. */
async function globalInstructions() {
  const body = (await bytes('config/global-instructions.md')).toString();
  for (const marker of ['{{shared-host-rules}}', '{{codex-host}}', '{{claude-host}}', '{{visual-delivery}}']) if (!body.includes(marker)) throw new Error(`Missing ${marker}`);
  return body.replace('{{visual-delivery}}', (await bytes('config/visual-delivery.md')).toString().trimEnd()).replace('{{shared-host-rules}}', renderHostInstructions('shared').trimEnd())
    .replace('{{codex-host}}', renderHostInstructions('codex').trimEnd())
    .replace('{{claude-host}}', renderHostInstructions('claude').trimEnd());
}
const hostProfiles = () => ['shared', 'codex', 'claude'].map(host => renderHostInstructions(/** @type {'shared'|'codex'|'claude'} */ (host)).trimEnd()).join('\n\n');

const releaseNote = `## ${version}: a clean and current skill catalog

Contract ${version} (catalog ${catalogVersion}). Owner decision of 2026-11-17: «vamos a hacer la limpieza, vamos a corregir, vamos a poner todas al día y vamos a hacer una manera … para que todas estuvieran al día».

- ${retired.length} skills leave the catalog and their installed copies are cleaned up: ${retired.join(', ')}. \`code-review\` only forwarded to \`flow-code-review\`, which keeps its name; \`research\` and \`install-anti-slop\` no longer carry operational evidence contracts.
- ${updatedSkills.length} skills install reviewed copies: corrected against the current way of working (no automated tests, \`development-system listo\`, the five stops), brought up to their authors' current commits keeping the local adaptations, and pointed away from the retired skills. Impeccable moves to 4.9.2 (engine 0.1.25).
- \`development-system skills-upstream [--json]\` compares the pinned commit of every catalogued skill of another author with the last commit that touched its path upstream and lists it as up to date, behind (pinned → new commit, date) or gone upstream. It reads public repositories through temporary blobless clones and changes nothing. The weekly Development Steward report carries the same list.

Rollback: reinstall ${previous}.

Everything else is ${previous}.
`;

const roleCheck = checkRolePolicyOutputs(root);
if (!roleCheck.valid) throw new Error(roleCheck.errors.join('; '));
const manifest = JSON.parse((await bytes(`manifests/${previous}.json`)).toString());
for (const artifact of manifest.artifacts) {
  if (hash(await bytes(artifact.sourcePath)) !== artifact.sha256) throw new Error(`Previous artifact drift: ${artifact.sourcePath}`);
}
const catalog = JSON.parse((await bytes(`catalog/${previousCatalog}.json`)).toString());
// The local previous manifest and catalog are not their own authority: every published copy
// (develop, main, the previous tag) must match them and every source they declare.
const previousPaths = [...new Set([
  `manifests/${previous}.json`, `catalog/${previousCatalog}.json`,
  ...manifest.artifacts.map((/** @type {{sourcePath:string}} */ artifact) => artifact.sourcePath),
  ...catalog.skills.flatMap((/** @type {{variants:{sourceDirectory:string}[]}} */ skill) => skill.variants.map(variant => variant.sourceDirectory)),
])];
for (const ref of ['refs/remotes/origin/develop', 'refs/remotes/origin/main', `refs/tags/v${previous}`]) {
  try { execFileSync('git', ['cat-file', '-e', `${ref}:manifests/${previous}.json`], { cwd: root, stdio: 'ignore' }); } catch { continue; }
  try { execFileSync('git', ['diff', '--quiet', ref, '--', ...previousPaths], { cwd: root, stdio: 'ignore' }); }
  catch { throw new Error(`Published ${previous} sources differ from ${ref}; create a new version instead`); }
}
// The previous catalog's skill folders are published too: validate them before any entry is replaced.
const previousErrors = await validateSkillCatalog(structuredClone(catalog), root);
if (previousErrors.length) throw new Error(`Previous catalog ${previousCatalog} drift: ${previousErrors.join('; ')}`);
catalog.catalogVersion = catalogVersion;

// Retire: out of the catalog, out of the operational evidence contracts, every installed destination into cleanup.
const cleanup = new Set(catalog.cleanup ?? []);
for (const name of retired) {
  const index = catalog.skills.findIndex((/** @type {{logicalName:string}} */ row) => row.logicalName === name);
  if (index < 0) {
    const paths = /** @type {Record<string, string[]>} */ (unmanagedRetired)[name];
    if (!paths) throw new Error(`${name} missing from catalog`);
    for (const path of paths) cleanup.add(path);
    continue;
  }
  const [skill] = catalog.skills.splice(index, 1);
  for (const variant of skill.variants) cleanup.add(variant.destination);
  catalog.operationalEvidenceSkills = (catalog.operationalEvidenceSkills ?? []).filter((/** @type {string} */ evidence) => evidence !== name);
  if (catalog.operationalEvidenceContracts) delete catalog.operationalEvidenceContracts[name];
}
catalog.cleanup = [...cleanup];

/** @param {[string, Buffer][]} entries relative path and bytes, the same digest as folderHash */
function treeHash(entries) {
  const digest = createHash('sha256');
  for (const [path, value] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) digest.update(path).update('\0').update(value).update('\0');
  return digest.digest('hex');
}
/** @type {Awaited<ReturnType<typeof openUpstreamClones>> | undefined} */
let clones;
/**
 * capabilityTreeSha256 (folderHash of the pristine upstream tree) and licenseSha256 (the repository's root LICENSE) at
 * a pin. --write reads them from the public repository; --check reuses the values this script wrote into the catalog
 * for the same commit and path, so release:prepare needs no network.
 * @param {string} name @param {string} repository @param {string} commit @param {string} path
 */
async function upstreamHashes(name, repository, commit, path) {
  if (mode === '--check') {
    const written = JSON.parse((await bytes(`catalog/${catalogVersion}.json`)).toString()).skills
      .find((/** @type {{logicalName:string}} */ row) => row.logicalName === name)?.source?.upstreamReference;
    if (!written || written.commit !== commit || written.path !== path) throw new Error(`${name}: run --write to compute its upstream hashes`);
    return { capabilityTreeSha256: written.capabilityTreeSha256, licenseSha256: written.licenseSha256 };
  }
  clones ??= await openUpstreamClones();
  const directory = await clones.clone(repository);
  const show = (/** @type {string} */ file) => clones?.git(directory, 'show', `${commit}:${file}`) ?? Promise.reject(new Error('closed'));
  const listed = (await clones.git(directory, 'ls-tree', '-r', '--name-only', commit, '--', path)).toString().split('\n').filter(Boolean);
  if (listed.length === 0) throw new Error(`${name}: ${path} does not exist at ${commit}`);
  const entries = /** @type {[string, Buffer][]} */ (await Promise.all(listed.map(async file => [file.slice(path.length + 1), await show(file)])));
  const license = (await clones.git(directory, 'ls-tree', '--name-only', commit)).toString().split('\n').find(file => /^LICEN[CS]E(\.md|\.txt)?$/i.test(file));
  return { capabilityTreeSha256: treeHash(entries), licenseSha256: license ? hash(await show(license)) : undefined };
}

try {
  for (const name of updatedSkills) {
    const skill = catalog.skills.find((/** @type {{logicalName:string}} */ row) => row.logicalName === name);
    if (!skill) throw new Error(`${name} missing from catalog`);
    const kind = /^artifacts\/[^/]+\/skills\/(internal|upstream|external)\//.exec(skill.variants[0].sourceDirectory)?.[1];
    if (!kind) throw new Error(`${name}: unknown skill kind`);
    const directory = `${prefix}/skills/${kind}/${name}`;
    // A skill installed straight from its author's repository becomes a Development System copy with that pin as its upstream reference.
    if (skill.source.repository !== 'https://github.com/AO-HyS/development-system') {
      const { repository, commit, path, ...provenance } = skill.source;
      skill.source = { repository: 'https://github.com/AO-HyS/development-system', commit: '$INSTALL_COMMIT', path: directory, upstreamReference: { repository, commit, path, ...provenance } };
    }
    skill.source.path = directory;
    const pin = upstreamPins[name];
    if (pin) {
      const reference = skill.source.upstreamReference;
      if (!reference) throw new Error(`${name} has no upstream reference to update`);
      [reference.commit, reference.path] = pin;
      const computed = await upstreamHashes(name, reference.repository, reference.commit, reference.path);
      if (name === 'impeccable') {
        // Version, engine and checksums come from the copied skill itself; the zip digest has no source any more.
        const engineVersion = (await bytes(`${directory}/scripts/VERSION`)).toString().trim();
        const checksum = (await bytes(`${directory}/scripts/engine-checksums.txt`)).toString().split('\n')
          .map(line => line.trim().split(/\s+/)).find(([version, asset]) => version === engineVersion && asset === 'impeccable-darwin-arm64');
        if (!checksum) throw new Error(`impeccable: no darwin-arm64 checksum for engine ${engineVersion}`);
        const skillVersion = /^\s*version:\s*"?([\d.]+)"?\s*$/m.exec((await bytes(`${directory}/SKILL.md`)).toString())?.[1];
        if (!skillVersion) throw new Error('impeccable: SKILL.md has no version');
        reference.version = skillVersion;
        reference.engine = { version: engineVersion, sha256: checksum[2], url: `https://github.com/pbakaus/impeccable/releases/download/engine-v${engineVersion}/impeccable-darwin-arm64` };
        delete reference.distributionSha256;
        reference.capabilityTreeSha256 = computed.capabilityTreeSha256;
      } else {
        reference.capabilityTreeSha256 = computed.capabilityTreeSha256;
        if ('licenseSha256' in reference) {
          if (!computed.licenseSha256) throw new Error(`${name}: no LICENSE upstream at ${reference.commit}`);
          reference.licenseSha256 = computed.licenseSha256;
        }
      }
    }
    for (const variant of skill.variants) { variant.sourceDirectory = directory; variant.folderSha256 = await folderHash(directory); }
  }
} finally {
  await clones?.close();
}

const errors = await validateSkillCatalog(catalog, root);
if (errors.length) throw new Error(errors.join('; '));
if (String(catalogVersion) !== String(previousCatalog)) await output(`catalog/${catalogVersion}.json`, JSON.stringify(catalog, null, 2) + '\n');

manifest.contractVersion = version;
for (const artifact of manifest.artifacts) {
  const name = artifact.logicalName;
  if (name === 'skill-catalog') artifact.sourcePath = `catalog/${catalogVersion}.json`;
  if (name.startsWith('codex-agent-') && updatedCodexAgents.includes(name.slice('codex-agent-'.length))) artifact.sourcePath = `${prefix}/agents/codex/${name.slice('codex-agent-'.length)}.toml`;
  if (name === 'claude-orchestration-policy-json') {
    artifact.sourcePath = `${prefix}/runtime/claude-orchestration/policy.json`;
    await output(artifact.sourcePath, await bytes('claude/orchestration/policy.json'));
  }
  if (name === 'claude-orchestration-codex-review-mjs') {
    artifact.sourcePath = `${prefix}/runtime/claude-orchestration/codex-review.mjs`;
    await output(artifact.sourcePath, await bytes('claude/orchestration/codex-review.mjs'));
  }
  if (name === 'claude-orchestration-roster-guard-mjs') {
    artifact.sourcePath = `${prefix}/runtime/claude-orchestration/roster-guard.mjs`;
    await output(artifact.sourcePath, await bytes('claude/orchestration/roster-guard.mjs'));
  }

  // Claude agent templates and the orchestration rule are generated from the roster: ship the generated bytes whenever
  // they differ from the published snapshot the manifest still names, so an install never keeps an old role model.
  const generated = /^\.claude\/(agents|rules)\/([\w.-]+\.md)$/.exec(artifact.destination ?? '');
  if (generated && (name.startsWith('claude-agent-') || name === 'claude-rule-orchestration-md')) {
    const current = await bytes(`claude/${generated[1]}/${generated[2]}`);
    if (!current.equals(await bytes(artifact.sourcePath))) {
      artifact.sourcePath = `${prefix}/claude/${generated[1]}/${generated[2]}`;
      await output(artifact.sourcePath, current);
    }
  }

  if (name === 'visual-delivery-rule') {
    artifact.sourcePath = `${prefix}/claude/rules/visual-delivery.md`;
    // The closing format is part of the one-page global instructions; the rule file only points at it.
    await output(artifact.sourcePath, '# Closing format\n\nThe closing format lives in ~/.claude/CLAUDE.md under "How to close"; this file adds nothing to it.\n');
  }

  if (name === 'agent-roster') {
    artifact.sourcePath = `config/${version}/agent-roster.json`;
    await output(artifact.sourcePath, await bytes('config/agent-roster.json'));
  }

  if (name === 'personal-codex-instructions') {
    artifact.sourcePath = `${prefix}/global-codex-instructions.md`;
    await output(artifact.sourcePath, await globalInstructions());
  }
  if (['development-contract', 'orchestration-contract', 'model-routing'].includes(name)) {
    const original = (await bytes(artifact.sourcePath)).toString();
    const hostStart = original.indexOf('\n## Generated host role profiles');
    const browserStart = original.indexOf('\n## Browser resource preparation');
    if (hostStart < 0) throw new Error(`Missing generated host guidance: ${name}`);
    const suffix = browserStart > hostStart ? original.slice(browserStart) : '';
    let current = original.slice(0, hostStart);
    // The 3.0.0 note (the one that replaces the earlier process these documents describe) and the 3.1.0 note stay verbatim.
    const previousNote = current.indexOf('\n## 3.0.0: ');
    if (previousNote < 0 || current.indexOf(`\n## ${previous}: `) < previousNote) throw new Error(`Missing the 3.0.0 or ${previous} note: ${name}`);
    const kept = current.slice(previousNote).trimEnd();
    current = current.slice(0, previousNote).replaceAll(previous, version).replaceAll(previousCatalog, catalogVersion);
    current = current.trimEnd() + '\n' + kept + '\n\n' + releaseNote;
    const filename = name === 'development-contract' ? 'contract' : name;
    artifact.sourcePath = `${prefix}/${filename}.md`;
    await output(artifact.sourcePath, (current.trimEnd() + '\n\n## Generated host role profiles\n\n' + hostProfiles() + '\n' + suffix).trimEnd() + '\n');
  }
  artifact.sha256 = hash(await bytes(artifact.sourcePath));
}
await output(`manifests/${version}.json`, JSON.stringify(manifest, null, 2) + '\n');
const pkg = JSON.parse((await bytes('package.json')).toString());
if (pkg.version !== version || pkg.contractVersion !== version) throw new Error('Package version mismatch');
if (!String(pkg.scripts?.['skills:audit']).includes(`--version ${catalogVersion}`)) throw new Error(`package.json skills:audit must audit catalog ${catalogVersion}`);
await checkActiveToolingDocs();
console.log(JSON.stringify({ version, previous, catalogVersion, skills: catalog.skills.length, retired: retired.length, updatedSkills: updatedSkills.length, upstreamPins: Object.keys(upstreamPins).length, updatedCodexAgents, operation: mode }));
