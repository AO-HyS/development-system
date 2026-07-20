# Repository audit and preparation

Version `0.5.0` adds one read-only audit and two explicit preparation transitions for product repositories.

## Audit without mutation

```sh
node ./bin/development-system.mjs audit-repository \
  --repository /absolute/path/to/product \
  --json
```

The report includes:

- root and nested instructions with precedence and scope;
- skills, Codex agents, Factory droids, and repository hooks;
- `exists`, `discovered`, `catalogued`, `loadable`, `loaded`, and `influenced` independently;
- detected React/Convex capabilities and the product's existing review, validation, QA, and preview commands;
- foreign-product residue in governing files;
- readiness and concrete gaps for Codex, T3Code, and Factory;
- the manual, proposal-only architecture diagnostic.

Without operational evidence, `loaded` and `influenced` remain false. Supply an evidence JSON file with `repositoryFingerprint` and `observations` using `--evidence`; stale evidence is rejected. A not-ready audit still exits successfully because findings are the requested result and no repair was attempted.

## Initialize a new repository

```sh
node ./bin/development-system.mjs initialize-repository \
  --repository /absolute/path/to/product \
  --confirm initialize \
  --json
```

Initialization reads the product's current package scripts and stack, then writes only:

```text
.development-system/repository.json
.codex/development-system/repository.md
.factory/development-system/repository.md
```

The generated contract selects existing review, validation, QA, and preview commands. It records React and Convex rules when detected, preserves design/release files, and configures Factory documentation as a behavioral equivalent when a Codex-native capability is unavailable. Repeating the same initialization returns `unchanged`.

## Normalize an existing repository

```sh
node ./bin/development-system.mjs normalize-repository \
  --repository /absolute/path/to/product \
  --confirm normalize \
  --json
```

Normalization refreshes only the managed files above. It does not delete foreign instructions, rewrite `package.json`, replace product design, change branch/release policy, or activate preview hosting. Findings outside the managed namespace remain explicit owner actions. This preserves the boundary between a reversible system adapter and product-owned decisions.

`improve-codebase-architecture` remains manual and proposal-only in both generated adapters. A proposal must precede any separately authorized refactor.
