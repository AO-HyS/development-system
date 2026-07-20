# AOHYS Development System

The canonical, versioned source for Alejandro Ortiz Corro's multi-harness development contract. Version `0.1.0` installs deterministic, auditable mirrors for Codex and Factory; T3Code consumes the Codex surface.

This repository owns generated development-system state. Product repositories continue to own their domain, design, stack, commands, branch policy, previews, and release train.

## Requirements

- Node.js 22 or newer
- pnpm 11
- A Git checkout when `--source-commit` is omitted

## Interface

Run commands from a checkout of this repository:

```sh
pnpm install --frozen-lockfile
node ./bin/development-system.mjs install --version 0.1.0
node ./bin/development-system.mjs audit
node ./bin/development-system.mjs validate
node ./bin/development-system.mjs rollback
```

Use `--home /path/to/isolated-home` to operate on a fixture or clean environment. `install` resolves the checkout's current commit automatically; automation and fixtures may pin it explicitly with `--source-commit <40-hex-commit>`. Add `--json` for machine-readable evidence.

The generated state is:

```text
HOME/
├── .development-system/
│   ├── installed-manifest.json
│   ├── state.json
│   └── snapshots/
├── .codex/development-system/contract.md
└── .factory/development-system/contract.md
```

The installed manifest records contract version, source repository, source commit, SHA-256 hashes, harness, destination, and expected mirror. Direct edits under HOME are drift, not a new source of truth.

## Reproducible acceptance scenario

```sh
pnpm run scenario
```

The scenario creates an isolated temporary HOME, installs `0.0.0`, updates to `0.1.0`, introduces drift in the Codex mirror, proves validation fails, reinstalls `0.1.0`, rolls back to `0.0.0`, and verifies unrelated user files remain unchanged. It never touches the real HOME.

## Natural-language recovery

No secret phrase is required. Requests such as these map to the same explicit operations:

- “Instala la versión 0.1.0 del sistema de desarrollo” → `install --version 0.1.0`
- “Audita mi instalación sin cambiar nada” → `audit`
- “Comprueba que sigo usando la versión canónica” → `validate`
- “Vuelve a la versión anterior del contrato” → `rollback`

Before executing, the caller should identify the target HOME and requested operation. Recovery uses the installed manifest and recorded snapshots, never a conversation transcript.

Installing or recovering this contract does **not** authorize merge, release, production, destructive operations, paid activation, or extraordinary paid usage. Those operations require separate, explicit authorization each time.

## Repository validation

```sh
pnpm run verify
```

The gate typechecks the dependency-free Node implementation, runs the CLI acceptance tests, and verifies every committed manifest, artifact hash, supported harness, destination, and mirror relationship.

## Versioning

Contract versions use semantic versioning. `0.0.0` is the bootstrap rollback target; `0.1.0` is the first canonical contract. A version manifest is immutable once published. The installed manifest resolves `$INSTALL_COMMIT` to the exact commit used for installation.

## Current boundary

This first slice proves canonical installation and reversibility. Operational harness discovery/loading, skill provenance cleanup, lifecycle gates, model benchmarks, delivery review, repository normalization, and product pilots are tracked as later modules and are intentionally not claimed here.
