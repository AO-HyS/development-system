# Repository audit and preparation

Version `0.8.0` extends the hardened repository contract beyond the first three pilots. It preserves contextual residue classification, nested Convex detection, local preview aliases, and supported skill-mirror grouping while adding an explicit lifecycle interface beside automatic routing. Automatic routing still infers and runs the fitting stage as far as the request authorizes; recommendation-only requests remain read-only, and human gates plus promotion cannot be crossed implicitly.

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

Without live operational verification, `loaded` and `influenced` remain false. Schema 2 JSON supplied with `--evidence` is diagnostic and cannot elevate those states on its own. Library callers must inject a live observation verifier; its independently observed result must bind the current path hash and harness to a structured read-only command, runtime version, successful exit, empty side effects, and behavioral signature. Stale, fabricated, cross-repository, file-divergent, failed, timed-out, side-effecting, or unsigned observations remain false. A not-ready audit still exits successfully because findings are the requested result and no repair was attempted.

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

The returned `prepared` state is deliberately scoped to the repository adapter and declared commands. It is not an operational claim that lifecycle skills are loaded. Before using the explicit interface, synchronize global skill catalog `0.2.0` and verify that the active harness discovers `drive-development-flow` plus all six phase skills. The autonomous part of `flow-implement` is the bounded implementation-review-correction loop; commit, push, PR, preview, deploy, merge, release, and production remain governed by the request and repository policy.

## Normalize an existing repository

```sh
./bin/development-system normalize-repository \
  --repository /absolute/path/to/product \
  --confirm normalize \
  --json
```

Normalization refreshes only the managed files above. It does not delete foreign instructions, rewrite `package.json`, replace product design, change branch/release policy, or activate preview hosting. Findings outside the managed namespace remain explicit owner actions. This preserves the boundary between a reversible system adapter and product-owned decisions.

`improve-codebase-architecture` remains manual and proposal-only in both generated adapters. A proposal must precede any separately authorized refactor.
