// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPackageSource, verifyPackageFile } from './package-source.mjs';

const execute = promisify(execFile);
/** Run one explicit release adoption, never a product dependency update.
 * @param {{home:string, version?:string, sourceRoot?:string, checkoutRoot?:string}} options
 */
export async function updateSharedInstallation(options) {
  const home = await realpath(resolve(options.home));
  let sourceRoot = options.sourceRoot ? await realpath(resolve(options.sourceRoot)) : null;
  if (!sourceRoot) {
    // Staging contains release bytes only; it is not a checkout or worktree.
    const stage = await mkdtemp(resolve(tmpdir(), 'development-system-release-'));
    const archive = resolve(stage, 'release.tgz');
    if (options.checkoutRoot) {
      const { buildDistribution } = await import('../scripts/pack-distribution.mjs');
      const receipt = buildDistribution({ output: stage, root: options.checkoutRoot });
      await execute('tar', ['-xzf', receipt.path, '-C', stage]);
    } else {
      if (!options.version || !/^\d+\.\d+\.\d+$/.test(options.version)) throw new Error('update requires an exact --version or verified --source-root');
      await execute('gh', ['release', 'download', `v${options.version}`, '--repo', 'AO-HyS/development-system', '--pattern', `aohys-development-system-${options.version}.tgz`, '--output', archive], { maxBuffer: 1024 * 1024 });
      const stat = await lstat(archive);
      if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error('Unexpected release archive');
      const inventory = await execute('tar', ['-tzf', archive], { maxBuffer: 16 * 1024 * 1024 });
      if (inventory.stdout.split('\n').filter(Boolean).some(file => !file.startsWith('package/') || file.split('/').some(part => part === '..' || part === '.'))) throw new Error('Release archive contains an unsafe path');
      const modes = await execute('tar', ['-tvzf', archive], { maxBuffer: 32 * 1024 * 1024 });
      if (modes.stdout.split('\n').filter(Boolean).some(line => !['-', 'd'].includes(line[0]))) throw new Error('Release archive contains a link or nonregular entry');
      await execute('tar', ['-xzf', archive, '-C', stage]);
      sourceRoot = resolve(stage, 'package');
      const source = loadPackageSource(sourceRoot);
      if (!source || source.packageVersion !== options.version) throw new Error('Release package version mismatch');
      const tag = JSON.parse((await execute('gh', ['api', `repos/AO-HyS/development-system/git/ref/tags/v${options.version}`])).stdout);
      const commit = tag.object.type === 'tag'
        ? JSON.parse((await execute('gh', ['api', `repos/AO-HyS/development-system/git/tags/${tag.object.sha}`])).stdout).object.sha
        : tag.object.sha;
      if (commit !== source.commit) throw new Error('Release tag and package source commit differ');
    }
    sourceRoot ??= resolve(stage, 'package');
  }
  const source = loadPackageSource(sourceRoot);
  if (!source || (options.version && source.packageVersion !== options.version)) throw new Error('Update requires the exact verified package');
  for (const [file, metadata] of source.files) verifyPackageFile(source, file, metadata.sha256);
  const metadata = JSON.parse(await readFile(resolve(sourceRoot, 'package.json'), 'utf8'));
  const result = await execute(process.execPath, [resolve(sourceRoot, 'bin/development-system.mjs'), 'setup', '--home', home, '--version', metadata.contractVersion ?? metadata.version, '--json'], { maxBuffer: 32 * 1024 * 1024 });
  return { ...JSON.parse(result.stdout), operation: 'update', productRepositoriesWritten: false };
}
