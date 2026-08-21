# Repository audit and preparation

Contract `1.5.10` prepares a repository for the Codex-compatible Development System without importing another product's architecture or duplicating global capabilities. It preserves automatic lifecycle routing and explicit commands, emits the product architecture baseline used by new initiatives, and keeps agent guardrails, anti-slop policy, and Release Train ownership in the Development System.

## Audit without mutation

```sh
./bin/development-system audit-repository \
  --repository /absolute/path/to/product \
  --json
```

The report includes repository instructions and precedence, detected stack and real commands, residue, deterministic fingerprint evidence, Codex/T3 Code readiness, and a manual proposal-only architecture diagnostic. Structural readiness does not prove that a skill was loaded or influenced behavior; those claims require current fingerprint-bound live evidence.

## Initialize a new repository

```sh
./bin/development-system initialize-repository \
  --repository /absolute/path/to/product \
  --confirm initialize \
  --json
```

Initialization reads the repository's current package scripts, stack, design, and release policy, then manages only:

```text
.development-system/repository.json
.codex/development-system/repository.md
```

Any legacy `.factory/development-system/repository.md` adapter is retired because the active harnesses are Codex and T3 Code. The generated contract records:

- the repository's real review, changed-validation, certification, QA, preview, and conditional provider-readiness commands;
- the product architecture dimensions that future convergence work must cover;
- component boundaries based on cohesion, responsibility, state ownership, composition, and public Interfaces rather than arbitrary line counts;
- strict backend/type expectations, including current Convex authorization, validation, indexing, bounded-read, storage, and migration boundaries when Convex is detected;
- the installed architecture reference pack at `~/.codex/development-system/architecture-reference-pack.md`;
- the explicit boundary that agent guardrails, global anti-slop policy, and Release Train design remain Development System-owned.

This baseline guides future work. Initialization itself never refactors product code, changes branch policy, installs a Release Train, configures hosting, activates paid services, or deploys.

## Normalize an existing repository

```sh
./bin/development-system normalize-repository \
  --repository /absolute/path/to/product \
  --confirm normalize \
  --json
```

Normalization refreshes only the two managed files and removes only the retired Factory adapter. It preserves foreign instructions, `package.json`, product design, product code, provider configuration, data, and release policy. Findings outside the managed namespace remain explicit owner actions.

The returned `prepared` state is scoped to the repository adapter and declared commands. Before relying on the interface, synchronize global skill catalog `0.17.0` and verify discovery in the active Codex/T3 Code harness. Commit, push, PR, preview, deploy, merge, release, and production remain governed by request authority and repository policy.

`improve-codebase-architecture` remains manual and proposal-only. A Working Backwards Product Grill and Technical Grill must define an actual product convergence before any separately authorized refactor.
