# AOHYS Development System

The canonical, versioned source for Alejandro Ortiz Corro's global development contract. Version `1.5.15` keeps ordinary development direct, automatically routes exact authorized multi-ticket initiatives, adds deterministic engineering bundles, and retains opt-in product verification. Skill catalog `0.22.0` supports Codex and T3 Code, preserves Matt Pocock's current 37-skill snapshot while installing an authorization-safe `implement-spec` adapter, and includes a bounded PStack-inspired tactics adapter without installing `poteto-mode`.

This repository owns generated development-system state. Product repositories continue to own their domain, design, stack, commands, branch policy, previews, and release train.

## Requirements

- Node.js 22 or newer
- pnpm 11
- A Git checkout when `--source-commit` is omitted

## Interface

Run commands from a checkout of this repository:

```sh
pnpm install --frozen-lockfile
./bin/development-system install --version 1.5.15
./bin/development-system sync-skills --version 0.22.0
./bin/development-system guardrails-enable
pnpm run skills:probe
./bin/development-system audit-skills --version 0.22.0 --evidence "$HOME/.development-system/private/reports/skills-live-latest.json"
./bin/development-system guardrails-audit
./bin/development-system audit
./bin/development-system validate
./bin/development-system guardrails-rollback
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

Adapter normalization prepares a repository for the Development System; it does not refactor that product's architecture. Separate Working Backwards entry prompts for the five primary product convergence initiatives live in [`docs/product-convergence/`](docs/product-convergence/README.md).

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

For the progressive T3 Code experience, invoke `$working-backwards` (or write `work backwards`) followed by a normal feature idea. The skill drafts one concise canonical Markdown artifact at a time under private Development System HOME, asks one high-leverage question only when needed, and advances on clear replies such as `Apruebo, sigue` or `Se ve bien, continúa`. Feedback edits the active document. A reusable offline Reader derives a plain JSON view model from Markdown plus workflow state and continuously generates a human-named `<initiative-slug>.html`: compact artifact navigation, a continuous technical document, active page outline, restrained metadata, first-class Mermaid controls, explicit-data charts, semantic tables/callouts, and filename-aware code/diff blocks. The metadata-only library alone retains `index.html`. The private terminal handoff never authorizes implementation.

These commands prepare intent, private handoff, freshness, unverified supplied HumanLayer snapshots, and evaluation evidence without a default tracker or network runtime. Gate approvals persist private workflow-specific receipts bound to normalized repository identity/revision and exact artifact evidence. Publication binds the approved map and intent; resume requires injected authority validation of an opaque consumed-intent receipt and tracker reconciliation by idempotency key. The initial HumanLayer adapter rejects remote, synchronized, auto-advancing, worktree-creating, Slack, Linear, and external modes. Ticket 06 evidence remains incomplete because independently verifiable source packets are unavailable, so it recommends no pilot and ticket 07 stays blocked. Definition, evaluation, publication, and handoff keep implementation unauthorized until Implement Preview.

After `Implement Preview` is authorized, execute a private structured plan with:

```sh
./bin/development-system implement-preview \
  --workflow AOH-145 \
  --plan /private/path/implement-preview.json
```

The command runs one writer, independent intent/standards reviews, proportional TDD/QA, commit, push, PR, and preview commands. It creates a private Local Visual Plan and Recap and stops at `ready-for-human`; see `docs/implement-preview.md`. It rejects promotion operations.

When an authorized task contract names at least two exact work-item IDs and a
complete matching work graph, `orchestration-plan` automatically selects
dependency-aware parallel mode; the operator does not need to remember a
skill name. Ticket count alone never activates it. `$parallel-work` remains a
compatibility entry point and `$work-multiple` remains a deprecated alias.
Dependency completion controls readiness; capacity and overlapping surfaces
control the executable frontier. Focused checks run per lane and integration
checks run once on one candidate. Publication remains separately authorized.

Install the private weekly Development Steward on macOS after installing the
1.5.12 contract. It runs Monday at 09:00 local time for the five allowlisted
primary repositories and publishes one concise Check-in input without writing
to repositories or providers:

```sh
./bin/development-system development-steward-schedule-enable \
  --home "$HOME" \
  --projects-root /absolute/path/to/projects \
  --codex-path /absolute/path/to/codex \
  --node-path /absolute/path/to/node \
  --json
./bin/development-system development-steward-schedule-audit --home "$HOME" --json
./bin/development-system development-steward-schedule-disable --home "$HOME" --json
```

The validated, machine-consumable report is
`~/.development-system/steward/reports/latest.json`; it contains both the
normalized Steward review, its Check-in result, and derived readable Markdown.
Disabling the scheduler unloads it but preserves completed reports.

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
└── .codex/development-system/contract.md
```

The installed manifests record contract/catalog version, source repository, exact source commit, file/folder SHA-256 hashes, logical name, harness, destination, expected mirror, and explicit adapter contract. Direct edits under HOME are drift, not a new source of truth.

`sync-skills` manages 58 logical skills across 58 physical Codex variants. T3 Code consumes the same Codex-compatible installation. Factory paths from previously installed catalogs are retired managed outputs: synchronization removes them and snapshots every replaced entry for `rollback-skills`. Historical immutable manifests still describe the harnesses supported by those old releases; they do not expand the current 1.5.x runtime surface.

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

The probe uses read-only, ephemeral Codex execution. T3 Code consumes this same Codex-compatible skill installation, so it does not require or claim a second harness probe. The current behavioral probe covers only the critical `research` capability. `measure-development-run` requires a separate real-task invocation because its contract depends on the current Codex task. Evidence includes executable path, version, command, explicit activation/read signal, a skill-derived behavior signature, scanner errors, and catalog warnings.

## Operational T3 Code evidence

```sh
pnpm run t3code:probe
```

The T3 Code probe exercises the installed application through its Codex-compatible surface and verifies that repository and authorization state remain bound to the same contract. It consumes the canonical private `skills-live-latest.json` written by the immediately preceding `skills:probe`; pass `--skill-evidence /absolute/path.json` only to use another exact evidence packet. It is separate from the Codex skill probe because a shared installation is not proof that the T3 client actually consumes it. Both probes are read-only and do not initialize, normalize, or declare any product ready.

## Reproducible acceptance scenario

```sh
pnpm run scenario
```

The scenarios create isolated temporary HOMEs and repositories. They prove install/drift/reinstall/rollback, skill synchronization and rollback, inert lifecycle recommendations, ordered human gates, adapter parity and diagnostics, capability benchmark evidence, terminal-slice delivery, confrontational review convergence, private visual surfaces, read-only repository audit, idempotent initialization/normalization, product-file preservation, denial before the final gate, and one-shot merge authorization. They never touch the real HOME or contact live harnesses; `skills:probe` and `t3code:probe` are the separate live operational gates.

Older Factory benchmark and parity scripts remain versioned under explicitly `legacy:*` package commands only to reproduce historical evidence. They are not part of the 1.5.15 install, certification, scheduler, guardrails, repository adapters, or normal operator path.

The latest controlled ordinary-gate measurements and their reproduction
contract are recorded in
[`docs/changed-validation-benchmark-2026-07-28.md`](docs/changed-validation-benchmark-2026-07-28.md).

## Natural-language recovery

No secret phrase is required. Requests such as these map to the same explicit operations:

- “Instala la versión actual del sistema de desarrollo” → `install --version 1.5.15`, `sync-skills --version 0.22.0`, then `guardrails-enable`
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
pnpm run reader:browser
pnpm run verify
```

The focused Reader gate opens a generated report directly from `file://` in Chrome or Chromium and proves five Mermaid families, SVG rendering, zoom, wheel, drag, pinch, expand, fullscreen, responsive rails, 19 px body text, zero HTTP(S) requests, and no browser exceptions. The full gate typechecks the dependency-free Node implementation, runs the CLI acceptance tests, and verifies every committed manifest, artifact hash, supported harness, destination, and mirror relationship.

## Versioning

Contract versions use semantic versioning. `0.0.0` is the bootstrap rollback target; `0.1.0`–`1.5.0` retain their published contracts. `1.5.0` adds Development System Next and removes Factory from newly generated contracts, catalogs, and repository adapters while T3 Code consumes the Codex-compatible surface. `1.5.6` keeps wide diagrams readable; `1.5.7` adds Topic questions and measurable orchestration; `1.5.8` adds prompt-scoped architecture references and natural no-change approvals. `1.5.9` renders the complete Working Backwards history and bounded live review. `1.5.10` makes the full Reader usable across phones, tablets, and desktop. `1.5.11` pins Matt Pocock `v1.2.3`, restores whole-frontier grilling with recommendations, removes retired upstream skills reversibly, and makes the Steward check React Doctor, both Impeccable release lines, and Matt skills explicitly. `1.5.12` makes ordinary implementation direct, definition ceremonies opt-in, and non-trivial orchestration fast-model-first. `1.5.13` adds deterministic hybrid orchestration, observed Code Mode selection, and optional simplify-code review. `1.5.14` adds opt-in product verification with a neutral Luna Computer Use runner, deterministic before/after probes, and Sol-owned semantic judgment. `1.5.15` adds exact authorized-initiative routing, dependency-ready capacity-bounded lanes, multiple specialist risks, deterministic stack bundles, Matt's current 37-skill snapshot, and one bounded PStack-inspired engineering adapter. Published manifests and artifacts are immutable.

## Release boundary

Installing this contract never grants promotion authority. Each commit, push, pull request, merge, release, deployment, paid activation, or production synchronization still follows the user's exact request and the target repository's release policy.
