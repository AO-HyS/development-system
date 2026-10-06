# Repository context and read-only audit

Development System 2.0 does not generate repository adapters. An agent reads the
product AGENTS.md and README, then discovers only documentation relevant to the
task. Shared skills, roles, guards and report tooling come from the active global
installation. A product needs no replacement repository index or JSON manifest.

```sh
development-system doctor --json
development-system audit-repository --repository /absolute/product --json
```

Audit remains read-only. It reports actual commands, instructions, precedence,
stack, product residue, deterministic fingerprints and structural gaps. Existing
QA, preview and certification criteria are preserved. Adapter absence or version
is no longer a readiness gap. Structural observations do not prove host loading.

`initialize-repository` and `normalize-repository` are retired errors before any
writes. For a reviewed migration, retain unique release/design/command knowledge
in existing product docs and remove only `.development-system/repository.json`,
`.codex/development-system/repository.md` and a known legacy Factory equivalent.
Preserve other content in these directories and active work. Remove adapter
links and generic `pnpm ds` instructions. Specific pinned local CI checks remain.

This is not a product refactor or release-train installation. Product provider
adapters, authorization controls and release surface classifications remain
product-owned; they are distinct from the retired Development System repository
adapter. See [shared distribution](package-distribution.md) and ADR 0069.
