# AOHYS Development System

One shared installation supplies agent skills, instructions, roles, guards,
reports and tools on this computer. A product repository owns its domain,
architecture, commands, verification and release policy.

Current source candidate: **2.1.3**. Public package and contract: **2.0.2**.
Shared skill catalog: **0.62.0**. Browser resource preparation is described in
[the browser pool guide](docs/browser-pool/README.md); native concurrency and
the prepared T3 profile patch still require operational acceptance.

## New and existing repositories

Open the repository and work normally. No Development System adapter, local
package, replacement index or registration is needed for agent tooling. Read its
AGENTS.md, README and only the documents relevant to the task. If AGENTS.md is
absent, discover the context from the existing documentation and source.

Existing repositories may retain exact local package pins for specific CI checks.
Those pins do not choose the shared tools used by agents. Remove stale adapter
links and generic local tooling aliases in a reviewed migration, preserving
unique product knowledge and unrelated work. See [repository discovery](docs/repository-preparation.md).

## Install once per computer

Requirements: the supported Node.js version declared in package.json, pnpm 11,
and a clean committed canonical checkout or verified release package. Setup is a
computer operation; ordinary product dependency installation never changes HOME.

From the canonical Development System checkout:

```sh
pnpm install --frozen-lockfile
./bin/development-system setup --home /absolute/home --json
```

Verify with an isolated HOME before authorized installation into the operator's
HOME. Ensure ~/.local/bin is on PATH. After first adoption, update once:

```sh
development-system update --version 2.0.2 --json
development-system doctor --json
```

New tasks use the active shared installation. Existing threads retain their
loaded context and selected parent model. An update does not hot-switch a thread.
See [distribution and recovery](docs/package-distribution.md).

## Update, recovery and evidence

Setup/update serializes the complete package, contract, catalog, managed files,
hooks and launchers. Failed validation restores the previous complete tuple.
Recovery and rollback preserve unrelated files and refuse unreconciled managed
drift. Historical published versions remain immutable.

```sh
development-system doctor --json
development-system rollback --json
development-system recover-shared --json
```

Doctor identifies the executing and active package, contract, catalog and drift.
Installed bytes do not prove host loading or behavioral influence. Observe actual
CLI and skill consumption in fresh relevant tasks; report unavailable capability
or runtime metadata as unknown. Generated writer profiles alone do not establish
exclusive ownership or Git protections.

Reports use the active global CLI and approved shared presentation:

```sh
development-system document --input /absolute/private/packet.json --json
```

Receipts include package/source and renderer path/hash. Package 2.0.2 deliberately
retains the approved renderer from artifact 1.40.0. Completion reports reject a
package that differs from the active installation; explicit historical reports
mark that exception. A report is editorial evidence, not product acceptance.

## Haiku 5.5 role selection

Haiku 5.5 Medium is the operator-selected preference for bounded research and
exact/mechanical writing. Protected native Claude roles pin claude-haiku-5-5;
Sonnet retains general implementation. Planning crosses families: an OpenAI
parent uses an Opus 5.5 plan and fresh Sol 6.1 High review; an Anthropic parent
uses a Sol 6.1 High plan and fresh Opus 5.5 review. Sol retains technical review
and computer use. Existing threads reread at the next safe turn before delegation;
see [model routing](docs/model-routing.md). T3 readers may use
Haiku; T3 source writers remain unadmitted. Update the complete shared package
once per computer; product deployments are not required. Existing Codex-only
profiles are explicit alternatives, never automatic fallback. See
[the decision](docs/adr/0070-haiku55-bounded-roles.md).

## Orchestration and maintenance

Preserve the selected parent. Use native supported same-provider agents and
independent review. T3 owns child tasks, history, browser and scheduling. Source
writing children require observed ownership admission and Git restrictions;
otherwise the authorized parent edits sequentially with read-only children.
Cross-provider writing remains gated. run-worker is optional external process
recovery, never the route for T3-owned child tasks.

Weekly Steward uses the existing T3 schedule. Its allowlist bounds unattended
maintenance, not which repositories may use the shared tools. Launchd activation
and repository adapter generators are retired; no second scheduler is needed.
Steward keeps collection separate from recommendation completion, deduplicates
repository plus stable changeId and preserves unpublished recommendations.

No automated tests or evals. Use focused source checks and real behavior evidence.
No automatic product merge, release, deployment, data mutation, charges or customer
messages are authorized by installation or a maintenance schedule.

## Maintaining this source

Use the [branch-first workflow](docs/workflow/branch-first.md) and repository
AGENTS.md. Required focused checks are typecheck, release:prepare, roster:check,
check-no-tests, isolated installation and relevant real observations. Do not run a
full scenario/verification suite without the user's explicit request. The release
preparation gate rejects retired commands in current tooling instructions.

[ADR 0069](docs/adr/0069-one-shared-agent-installation.md) records the shared
installation decision. Previous release narratives and interfaces remain in
[immutable Git history](https://github.com/AO-HyS/development-system/blob/7bdd14a80231eede98fbe999b3a9ba2085864fc0/README.md);
they are not current installation instructions.

The no-tests CLI also checks native Kotlin test directories, literal native
runner/configuration declarations and k6 workflows. Deleted tracked files are
ignored. Native checker coverage is separate from the unchanged published
write-guard policy; it does not prove native hook prevention. Dynamically
constructed commands remain outside this bounded detector.
