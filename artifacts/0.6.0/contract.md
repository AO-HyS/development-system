# AOHYS Development System contract

Contract version: `0.6.0`

## Pre-rollout hardening

Repository audit fingerprints source deterministically while excluding source-control metadata, dependency caches, build caches, generated outputs, and temporary outputs. It never reads an arbitrarily large file into memory: ordinary files are capped at 1 MiB and larger source files use sixteen evenly distributed bounded samples plus their exact size. The report exposes the exclusion and bounded-read policy used for its fingerprint. Operational observations must also bind the repository root, a fresh timestamp, runtime command/version/response, successful exit, and the exact hash of the observed file; booleans alone never establish load or influence.

Foreign-residue detection distinguishes the repository's own identity, explicitly permitted references, and inherited product rules. Preservation-only references to the separate Impeccable visual/mobile system are allowed and reported as such; instructions that adopt it as a global template, or import another product's domain/release policy, remain residue.

The operational validator covers AO root, a simple repository, NutriPlan, The Barber Central, and AOHYS nested CWDs across Codex, Factory, and the T3Code client surface. Equivalent no-state wording is normalized deterministically. A resumed run keeps first-failure and recovery evidence instead of rewriting history.

The installed global validator consumes `.development-system/skills-lock.json` as the single mirror/adapter contract. Manifest-declared physical mirrors are valid when byte-identical; symlinks are not required. Divergent adapters remain valid only when separately declared by the catalog.

Benchmark records use four explicit evidence states: `validated`, `provisional`, `timeout`, and `permission-blocked`. Only validated records can appear in capability rankings. The capability roster separates mapping status from the evidence status that supports it, so incomplete challengers never become winners.

Skill evidence distinguishes structural catalog coverage from the narrow live influence probe. The current live probe proves the critical `research` capability in Codex and Factory; it is not exhaustive evidence for all 20 logical skills.

The `bin/development-system` preflight selects `AOHYS_NODE`, `node`, or `nodejs`, requires Node.js 22+, and returns an actionable diagnostic before invoking the Node CLI when no supported runtime is available.

## Scope and retained guarantees

Versions `0.1.0` through `0.5.0` remain byte-immutable. The `0.5.0` audit/preparation contract, `0.4.0` adapters/benchmark/delivery contract, `0.3.0` lifecycle gates, `0.2.0` skill catalog, and `0.1.0` reversible installation guarantees remain in force.

This hardening release does not initialize, normalize, or declare any product repository ready. It does not authorize rollout, merge, release, production, canonical HOME synchronization, paid activation, or destructive cleanup. Those remain separate, exact human gates.
