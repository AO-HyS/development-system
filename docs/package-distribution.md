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
back; a reinstall of the current version retains that version. Skill sync has
its own transactional recovery. Failed setup is reported as failure.

Starting with contract 1.25.0, setup also merges the Jev governance hooks into
the chosen HOME, preserving unrelated handlers. `governance-hooks-audit`
checks their installed definitions. Codex must separately trust the exact hook
definitions and demonstrate their execution; installation alone does not prove
that agent actions are governed. A bound run uses the installed governance CLI
and the capability limits documented in its recipe. The historical automatic
controller remains disabled.

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

`rollback` restores the hook configuration before removing its governed
runtime. It refuses to overwrite later operator changes and restores the
installed hooks if contract rollback fails. `governance-hooks-rollback` is the
explicit hook-only recovery command. Preserve the exact previous package and
its catalog when recovering the complete installation.

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
