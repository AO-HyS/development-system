# AOHYS Development System

The canonical, versioned source for Alejandro Ortiz Corro's global development contract. Version `1.2.0` adds the portable Working Backwards definition workflow while retaining every `1.1.2` guarantee. Skill catalog `0.6.0` installs 27 logical skills across Codex and Factory, with T3 Code inheriting Codex adapters.

This repository owns generated development-system state. Product repositories continue to own their domain, design, stack, commands, branch policy, previews, and release train.

## Requirements

- Node.js 22 or newer
- pnpm 11
- A Git checkout when `--source-commit` is omitted

## Interface

Run commands from a checkout of this repository:

```sh
pnpm install --frozen-lockfile
./bin/development-system install --version 1.2.0
./bin/development-system sync-skills --version 0.6.0
./bin/development-system guardrails-enable
./bin/development-system audit-skills --version 0.6.0
./bin/development-system guardrails-audit
./bin/development-system audit
./bin/development-system validate
./bin/development-system rollback-skills
./bin/development-system rollback
pnpm run rollout:validate
```

`rollout:validate` returns either `ready-for-human` or a structured list of remaining pilot gates. It verifies SHA-256-bound live evidence and pilot attestations, private recap existence, review/QA disposition, PR/preview readiness, rollback, and the prohibition on merge, release, production, paid activation, canonical HOME synchronization, and Escuela 360 work. Git owns repository history; the validator does not reproduce it with commit comparisons.

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

Working Backwards operations consume explicit JSON files:

```sh
./bin/development-system working-backwards --input /private/path/definition.json --home /tmp/isolated-home --json
./bin/development-system working-backwards-publication-intent --input /private/path/ticket-map.json --json
./bin/development-system working-backwards-t3-handoff --input /private/path/handoff-input.json --json
./bin/development-system working-backwards-handoff-freshness --input /private/path/freshness-input.json --json
./bin/development-system working-backwards-humanlayer --input /private/path/observations.json --json
./bin/development-system working-backwards-evaluate --input evidence/working-backwards/ticket-06-evaluation.json --json
```

These commands prepare intent, private handoff, freshness, unverified supplied HumanLayer snapshots, and evaluation evidence without a default tracker or network runtime. Gate approvals persist private workflow-specific receipts bound to normalized repository identity/revision and exact artifact evidence. Publication binds the approved map and intent; resume requires injected authority validation of an opaque consumed-intent receipt and tracker reconciliation by idempotency key. The initial HumanLayer adapter rejects remote, synchronized, auto-advancing, worktree-creating, Slack, Linear, and external modes. Ticket 06 evidence remains incomplete because independently verifiable source packets are unavailable, so it recommends no pilot and ticket 07 stays blocked. Definition, evaluation, publication, and handoff keep implementation unauthorized until Implement Preview.

After `Implement Preview` is authorized, execute a private structured plan with:

```sh
./bin/development-system implement-preview \
  --workflow AOH-145 \
  --plan /private/path/implement-preview.json
```

The command runs one writer, independent intent/standards reviews, proportional TDD/QA, commit, push, PR, and preview commands. It creates a private Local Visual Plan and Recap and stops at `ready-for-human`; see `docs/implement-preview.md`. It rejects promotion operations.

Invoke `$work-multiple` only when several authorized tickets should be worked
together. Merely supplying several tickets does not activate worktrees. Shared
surfaces and dependencies remain sequential; disjoint lanes may run in
parallel and integrate into one candidate. Publication remains a separate
authorization.

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

`sync-skills` manages 26 logical skills across 51 physical variants. Twenty-one established workflow skills retain their Codex/Factory contracts, including `work-multiple` and the current custom-agent-aware orchestration adapters. `measure-development-run` has one explicitly declared Codex variant because Factory does not expose the required Codex task ID and session JSONL. The four 1.1 capabilities are mirrored across Codex and Factory. Cleanup remains limited to the stale workspace and broken links declared by the catalog; every replaced entry is snapshotted for `rollback-skills`.

## Real development-run measurement

Invoke `$measure-development-run` anywhere in a Codex task. It uses the first real user prompt through the invocation prompt as the evidence boundary, but its headline duration is active parent-turn time plus only proven, non-overlapping external waits. Idle gaps while a task remains open are excluded. Thread span remains visible as context. Reports are private, append-only JSON and Markdown under `~/.development-system/measurements/`.

The deterministic collector records timestamps, token counters, turns, tools, observed failures, models, subagents, concurrency, and repository provenance without persisting transcript text, reasoning, tool inputs, or tool output. The evidence-backed assessment records scope completion, functional proof, code/architecture/security quality, intervention, rework, cost availability, limitations, and concrete improvements. It deliberately produces no composite score.

## Operational skill evidence

The audit reports six distinct states: `exists`, `discovered`, `catalogued`, `loadable`, `loaded`, and `influenced`. A copied file proves only existence. Full loading and behavioral influence require runtime evidence from the real harness. `pnpm run skills:audit` always runs the structural audit and reports live evidence as missing until a probe file is supplied; it does not point at a date-stamped file that may not exist.

```sh
pnpm run skills:probe -- --output evidence/skills-live-$(date +%F).json
./bin/development-system audit-skills \
  --evidence evidence/skills-live-$(date +%F).json \
  --json
```

The probe uses read-only, ephemeral Codex execution and read-only Factory Droid execution. Structural evidence covers the established cross-harness catalog; the current behavioral probe covers only the critical `research` capability in Codex and Factory. `measure-development-run` requires a separate real-task invocation because its contract depends on the current Codex task. Evidence includes executable path, version, command, explicit activation/read signal, a skill-derived behavior signature, scanner errors, and catalog warnings.

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

The latest controlled ordinary-gate measurements and their reproduction
contract are recorded in
[`docs/changed-validation-benchmark-2026-07-28.md`](docs/changed-validation-benchmark-2026-07-28.md).

To prove the dual interface through the installed Codex and Factory runtimes without mutating a product repository:

```sh
pnpm run operator:probe -- --output evidence/lifecycle-interface-live-2026-07-21.json
```

This live probe activates the automatic router and all six explicit phase skills in read-only sandboxes, verifies their authorization-boundary responses, and records per-harness evidence separately from structural repository readiness.

## Natural-language recovery

No secret phrase is required. Requests such as these map to the same explicit operations:

- “Instala la versión 1.2.0 del sistema de desarrollo” → `install --version 1.2.0`, `sync-skills --version 0.6.0`, then `guardrails-enable`
- “Mide cómo funcionó esta implementación” → invoke `$measure-development-run`
- “Audita mi instalación sin cambiar nada” → `audit`
- “Comprueba que sigo usando la versión canónica” → `validate`
- “Vuelve a la versión anterior del contrato” → `rollback`

Before executing, the caller should identify the target HOME and requested operation. Recovery uses the installed manifest and recorded snapshots, never a conversation transcript.

Installing or recovering this contract does **not** authorize merge, release, production, destructive operations, paid activation, or extraordinary paid usage. Those operations require separate, explicit authorization each time.

## Repository validation

Every prepared repository exposes two distinct quality interfaces:

- changed validation for ordinary implementation and pre-push feedback;
- full certification once for the integrated change.

Repository adapters also record risk-selected QA, one shared branch preview
from `develop`, and provider readiness before preview when auth, data,
migrations, seeds, roles, or environment contracts changed. Product
repositories still own the concrete commands and provider implementation.

```sh
pnpm run verify
```

The gate typechecks the dependency-free Node implementation, runs the CLI acceptance tests, and verifies every committed manifest, artifact hash, supported harness, destination, and mirror relationship.

## Versioning

Contract versions use semantic versioning. `0.0.0` is the bootstrap rollback target; `0.1.0`–`1.1.2` retain their published contracts; `1.2.0` adds Working Backwards definition, risk evidence, optional HumanLayer observations, explicit publication intent, and private T3 handoff freshness. Published manifests and artifacts are immutable.

## Release boundary

Installing this contract never grants promotion authority. Each commit, push, pull request, merge, release, deployment, paid activation, or production synchronization still follows the user's exact request and the target repository's release policy.
