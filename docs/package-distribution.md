# One dependency, explicit setup

Development System is distributed as an npm-format tarball attached to
the canonical GitHub release. The source repository is public; this does not
require a new npm registry, account, token or recurring subscription.

In a product repo, add the exact release URL as the
`@aohys/development-system` devDependency and commit the package-manager lockfile.
Expose `"ds": "aohys-development-system"` in package scripts.

```sh
pnpm ds setup
pnpm ds audit
pnpm ds audit-skills
```

`setup` explicitly synchronizes the release contract and its paired catalog
to the selected HOME. Use `--home /absolute/isolated-home` to test it first.
There is no postinstall hook and ordinary product deployment never runs setup.
A contract upgrade followed by failed skill synchronization rolls the contract
back, including its hook transition. A reinstall of the current version retains
contract and advisory hook repairs even if later skill synchronization fails;
it still reports setup failure and keeps the original version rollback boundary.
Skill sync has
its own transactional recovery. Failed setup is reported as failure.

Contract 1.29.0 explicitly selects advisory-parent-execution. Both setup and
install remove only marker-owned Jev handlers, preserving unrelated guards,
settings and historical recovery records. The snapshot records actual hook
bytes for rollback; reinstall retains the original rollback boundary.
`governance-hooks-audit` expects Jev hooks to be disabled, and explicit
`governance-hooks-enable` refuses under this profile. Historical 1.25–1.28
contracts retain their original governed behavior; they are not the default.
The automatic controller remains disabled. Installation is not proof of host
discovery, actual model identity or accepted product behavior.

The tarball contains committed runtime files, historical manifests/artifacts
needed for recovery, and a provenance marker with source commit, version, file
hashes and executable modes. It excludes Git data, credentials, private reports,
node_modules and tests. npm integrity and the consumer lockfile pin the bytes.
The marker is an integrity inventory, not a cryptographic publisher signature.
Git installations continue to verify Git objects; package installations do not
accidentally treat the consumer repository as their canonical Git source.

Update the dependency once when adopting a new release, then run setup. Product
adapters retain their domain and release rules. Normalize managed adapter files
with `pnpm ds normalize-repository --repository <root> --confirm normalize`
when the adapter contract changes; do not copy policy into product components.

Recovery uses `rollback` for the prior contract, then the preserved previous
package CLI `sync-skills --version <previous-catalog>` for its exact skills.
`rollback-skills` restores the original baseline, not necessarily the immediately
previous catalog. Preserve the previous
dependency/checkout when auditing an installation originally made from that
source commit. Rollback restores only managed paths and retains unrelated HOME
files. Skills becoming present is not proof they influenced a model; runtime
receipts and relevant visible acceptance remain distinct.

`rollback` preflights all contract backups and advisory hook drift before
changing destinations, then restores the actual pre-install configuration.
It never synthesizes enforcement merely because an older contract supported it.
`governance-hooks-rollback` retains its strict historical hook-only semantics.
Preserve the exact previous package and catalog for complete recovery.

Maintainers prepare new immutable versions, commit reviewed changes, then run
`pnpm release:pack --output <private-directory>`. The builder refuses dirty
runtime source, stages Git HEAD, validates a real npm tarball extraction and
reports its SHA-256 and SHA-512 integrity. Upload that exact archive to the
release tag for its canonical commit; never replace a published asset in place.

## Runtime patch releases

The package version identifies CLI/runtime code. The explicit `contractVersion`
package field selects the immutable default contract for `setup`; `--version`
continues to select an explicitly requested contract. A runtime-only patch can
therefore ship without copying unchanged artifacts or catalogs. Provenance still
binds the package archive to its own new source commit.
