# AOHYS Development System

The canonical, versioned source for Alejandro Ortiz Corro's multi-harness development contract. Version `0.3.0` adds an observable lifecycle state machine with persisted human gates and operation-specific authorization. The pinned `0.2.0` skill catalog remains the current skill source; T3Code consumes the Codex surface.

This repository owns generated development-system state. Product repositories continue to own their domain, design, stack, commands, branch policy, previews, and release train.

## Requirements

- Node.js 22 or newer
- pnpm 11
- A Git checkout when `--source-commit` is omitted

## Interface

Run commands from a checkout of this repository:

```sh
pnpm install --frozen-lockfile
node ./bin/development-system.mjs install --version 0.3.0
node ./bin/development-system.mjs sync-skills --version 0.2.0
node ./bin/development-system.mjs audit-skills --version 0.2.0 --evidence evidence/skills-live-2026-07-20.json
node ./bin/development-system.mjs audit
node ./bin/development-system.mjs validate
node ./bin/development-system.mjs rollback-skills
node ./bin/development-system.mjs rollback
```

Lifecycle requests use natural language but persist canonical operation names:

```sh
node ./bin/development-system.mjs lifecycle-request --workflow AOH-142 --mode transition --request "Inicia grill-with-docs"
node ./bin/development-system.mjs lifecycle-request --workflow AOH-142 --mode transition --request "Apruebo los requisitos"
node ./bin/development-system.mjs lifecycle-status --workflow AOH-142
node ./bin/development-system.mjs lifecycle-execute --workflow AOH-142 --operation validate
```

Pass `--terminal-slice "..."` with the Implement Preview request. Use `--mode recommend` for a read-only recommendation; it never persists a transition or grants authority. Use `--json` to inspect the exact transition, authorization source, evidence, stage, and reported external side effects.

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

The installed manifests record contract/catalog version, source repository, exact source commit, file/folder SHA-256 hashes, logical name, harness, destination, expected mirror, and explicit adapter contract. Direct edits under HOME are drift, not a new source of truth.

`sync-skills` manages 20 logical workflow skills across 40 physical Codex/Factory variants. Nineteen Factory copies are declared mirrors and do not count as separate logical skills. `coding-orchestration` is the sole divergent pair: two harness adapters with the same bounded-orchestration behavior contract. Cleanup is limited to the stale workspace and broken links named in `catalog/0.2.0.json`; every replaced entry is snapshotted for `rollback-skills`.

## Operational skill evidence

The audit reports six distinct states: `exists`, `discovered`, `catalogued`, `loadable`, `loaded`, and `influenced`. A copied file proves only existence. Full loading and behavioral influence require runtime evidence from the real harness.

```sh
pnpm run skills:probe -- --output evidence/skills-live-$(date +%F).json
node ./bin/development-system.mjs audit-skills \
  --evidence evidence/skills-live-$(date +%F).json \
  --json
```

The probe uses read-only, ephemeral Codex execution and read-only Factory Droid execution. Evidence includes executable path, version, command, explicit activation/read signal, a three-part behavior signature taken only from the loaded skill, scanner errors, and catalog warnings. The expected answer is not supplied in the prompt. Description shortening is reported separately from actual skill omission. `audit-skills` intentionally fails without operational evidence for catalog-critical skills.

## Reproducible acceptance scenario

```sh
pnpm run scenario
```

The scenarios create isolated temporary HOMEs. They prove install/drift/reinstall/rollback, skill synchronization and rollback, inert lifecycle recommendations, ordered human gates, terminal-slice delivery authorization, denial before the final gate, and one-shot merge authorization. They never touch the real HOME.

## Natural-language recovery

No secret phrase is required. Requests such as these map to the same explicit operations:

- “Instala la versión 0.3.0 del sistema de desarrollo” → `install --version 0.3.0` plus `sync-skills --version 0.2.0`
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

Contract versions use semantic versioning. `0.0.0` is the bootstrap rollback target, `0.1.0` is the first canonical contract, `0.2.0` is the skill-catalog contract, and `0.3.0` is the lifecycle-gates contract. Published manifests and artifacts are immutable. The installed manifest resolves `$INSTALL_COMMIT` to the exact commit used for installation; upstream skills pin the exact authoritative commit directly.

## Current boundary

This slice proves skill provenance plus an executable, persisted lifecycle authorization core. Harness execution adapters, model benchmarks, the adversarial delivery-review loop, repository normalization, and product pilots remain later modules.
