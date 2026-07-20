# AOHYS Development System

The canonical, versioned source for Alejandro Ortiz Corro's global multi-harness development contract. Version `0.6.0` hardens repository fingerprinting, residue policy, operational validation, physical mirrors, benchmark evidence, skill-evidence claims, and runtime preflight before product rollout. The pinned `0.2.0` skill catalog remains the current skill source.

This repository owns generated development-system state. Product repositories continue to own their domain, design, stack, commands, branch policy, previews, and release train.

## Requirements

- Node.js 22 or newer
- pnpm 11
- A Git checkout when `--source-commit` is omitted

## Interface

Run commands from a checkout of this repository:

```sh
pnpm install --frozen-lockfile
./bin/development-system install --version 0.6.0
./bin/development-system sync-skills --version 0.2.0
./bin/development-system audit-skills --version 0.2.0 --evidence evidence/skills-live-2026-07-20.json
./bin/development-system audit
./bin/development-system validate
./bin/development-system rollback-skills
./bin/development-system rollback
```

Audit and prepare a product repository with distinct operations:

```sh
./bin/development-system audit-repository --repository /absolute/path/to/product --json
./bin/development-system initialize-repository --repository /absolute/path/to/product --confirm initialize --json
./bin/development-system normalize-repository --repository /absolute/path/to/product --confirm normalize --json
```

Audit never writes. Initialization and normalization manage only the Development System namespace, preserve product-owned files, and never activate paid services; see `docs/repository-preparation.md`.

Lifecycle requests use natural language but persist canonical operation names:

```sh
./bin/development-system lifecycle-request --workflow AOH-142 --mode transition --request "Inicia grill-with-docs"
./bin/development-system lifecycle-request --workflow AOH-142 --mode transition --request "Apruebo los requisitos"
./bin/development-system lifecycle-status --workflow AOH-142
./bin/development-system lifecycle-execute --workflow AOH-142 --operation validate
```

Pass `--terminal-slice "..."` with the Implement Preview request. Use `--mode recommend` for a read-only recommendation; it never persists a transition or grants authority. Use `--json` to inspect the exact transition, authorization source, evidence, stage, and reported external side effects.

After `Implement Preview` is authorized, execute a private structured plan with:

```sh
./bin/development-system implement-preview \
  --workflow AOH-145 \
  --plan /private/path/implement-preview.json
```

The command runs one writer, independent intent/standards reviews, proportional TDD/QA, commit, push, PR, and preview commands. It creates a private Local Visual Plan and Recap and stops at `ready-for-human`; see `docs/implement-preview.md`. It rejects promotion operations.

Use `--home /path/to/isolated-home` to operate on a fixture or clean environment. `install` resolves the checkout's current commit automatically; automation and fixtures may pin it explicitly with `--source-commit <40-hex-commit>`. Add `--json` for machine-readable evidence.

The generated state is:

```text
HOME/
├── .development-system/
│   ├── installed-manifest.json
│   ├── state.json
│   ├── lifecycles/
│   ├── private/
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
./bin/development-system audit-skills \
  --evidence evidence/skills-live-$(date +%F).json \
  --json
```

The probe uses read-only, ephemeral Codex execution and read-only Factory Droid execution. Structural evidence covers the 20 logical catalog entries; the current live behavioral probe covers only the critical `research` capability in Codex and Factory. It does not claim exhaustive influence for all 20 skills. Evidence includes executable path, version, command, explicit activation/read signal, a three-part behavior signature taken only from the loaded skill, scanner errors, and catalog warnings. The expected answer is not supplied in the prompt.

## Operational harness parity

```sh
pnpm run harnesses:validate -- \
  --projects-root /path/to/projects \
  --timeout-ms 60000 \
  --output evidence/harnesses-live-$(date +%F).json
```

After a failed run, add `--resume evidence/harnesses-live-YYYY-MM-DD.json` to re-run only failed surfaces. The merged report retains the first failure under `recoveredFailures` and records each attempt; recovery never rewrites the initial evidence.

The validator launches installed Codex and Factory executables against AO root, the Development System, NutriPlan, The Barber Central, and AOHYS nested CWDs. T3Code is exercised through the Codex adapter and must preserve the same state namespace and observable behavior. Commands are read-only and do not initialize, normalize, or declare any product ready.

## Capability benchmark and roster

```sh
pnpm run benchmark -- --concurrency 3 --timeout-ms 60000
```

The suite compares identical fixtures for orchestration, implementation, review, architecture, browser QA, and visual judgment. Each record is explicitly `validated`, `provisional`, `timeout`, or `permission-blocked`; only validated records enter rankings. `config/0.6.0/capability-roster.json` separates a mapping's validated/provisional status from its supporting evidence status. No incomplete result is declared a winner.

Use `--provisional-only` to rerun only mappings the versioned roster still marks provisional while validating the complete suite definition first.

## Reproducible acceptance scenario

```sh
pnpm run scenario
```

The scenarios create isolated temporary HOMEs and repositories. They prove install/drift/reinstall/rollback, skill synchronization and rollback, inert lifecycle recommendations, ordered human gates, adapter parity and diagnostics, capability benchmark evidence, terminal-slice delivery, confrontational review convergence, private visual surfaces, read-only repository audit, idempotent initialization/normalization, product-file preservation, denial before the final gate, and one-shot merge authorization. They never touch the real HOME or contact live harnesses; `harnesses:validate` is the separate live operational gate.

## Natural-language recovery

No secret phrase is required. Requests such as these map to the same explicit operations:

- “Instala la versión 0.6.0 del sistema de desarrollo” → `install --version 0.6.0` plus `sync-skills --version 0.2.0`
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

Contract versions use semantic versioning. `0.0.0` is the bootstrap rollback target; `0.1.0`–`0.5.0` retain their published contracts; `0.6.0` is the pre-rollout hardening contract. Published manifests and artifacts are immutable.

## Current boundary

This slice hardens the Development System before rollout. The three product pilots remain AOH-147: this version audits them read-only, but does not modify, normalize, initialize, or declare any product repository ready.
