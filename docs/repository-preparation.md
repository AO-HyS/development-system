# Repository audit and preparation

Version `0.6.0` hardens the read-only audit introduced in `0.5.0`; the two explicit preparation transitions remain unchanged in scope.

## Audit without mutation

```sh
./bin/development-system audit-repository \
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

Fingerprint evidence also reports deterministic exclusions for Git metadata, dependency/build caches, generated outputs, and temporary outputs. Ordinary files are read with a 1 MiB cap; larger source files use sixteen evenly distributed 64 KiB samples plus exact size, so a multi-gigabyte file cannot cause an unbounded read while central changes remain observable. Preservation-only Impeccable references are reported under `allowedReferences`; inherited product rules remain under `residue`.

Without operational evidence, `loaded` and `influenced` remain false. Supply schema 2 evidence using `--evidence`. The document must bind `repositoryRoot`, `repositoryFingerprint`, and a fresh `generatedAt`; every observation must include its harness/path, monotonic states, executable, runtime version, activation and catalog commands, exit code, final response, and `pathSha256`. Stale, fabricated, cross-repository, or file-divergent evidence is rejected. A not-ready audit still exits successfully because findings are the requested result and no repair was attempted.

## Initialize a new repository

```sh
./bin/development-system initialize-repository \
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
./bin/development-system normalize-repository \
  --repository /absolute/path/to/product \
  --confirm normalize \
  --json
```

Normalization refreshes only the managed files above. It does not delete foreign instructions, rewrite `package.json`, replace product design, change branch/release policy, or activate preview hosting. Findings outside the managed namespace remain explicit owner actions. This preserves the boundary between a reversible system adapter and product-owned decisions.

`improve-codebase-architecture` remains manual and proposal-only in both generated adapters. A proposal must precede any separately authorized refactor.
