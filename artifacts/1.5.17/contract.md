# Development System Contract 1.5.17

Version 1.5.17 preserves the immutable 1.5.15 and 1.5.16 contracts, the
fast-model-first route, and the independent Fable/Sol reviewer route, and
makes the anti-slop practices executable lane contracts for every
non-trivial write plan produced by the pure `orchestration-plan` operation.
Codex and T3 Code remain the canonical lifecycle surfaces. The ordinary
implementation route, the ordered runtime attempt chain, the pure
`model-route` resolver, and Computer Use boundaries are unchanged from
1.5.16.

## Executable anti-slop lane contract

One canonical phase schema (src/anti-slop.mjs) drives both planner lanes and
repository preparation output, so the two surfaces cannot drift. Every
non-trivial write plan — sequential, specialist, and parallel — assigns all
six phases to concrete lanes with explicit ordered dependencies and phase
completion requirements, and an internal consistency validator fails the
plan closed on a missing, duplicated, invalid, or inconsistently assigned
phase or a broken dependency chain:

1. Pre-implementation simplification (writable writer): establish the
   smallest design that satisfies the accepted behavior before code is
   written, and record what was deliberately not built.
2. Behavior-first evidence design (writable writer): derive tests and
   evidence from the objective and the public interface. Tests are
   subordinate evidence; they never override the objective or observable
   product behavior.
3. Implementation (writable writer): implement only the accepted design;
   readability, domain boundaries, and security outrank size.
4. Test-value review (independent, read-only): audit every changed or new
   test for behavioral value and refuse green-only acceptance. Weakened
   assertions, updated snapshots, or new coupling to private structure
   require an observable-behavior justification. A useless test is
   recommended for deletion only when its behavior is proven covered or the
   behavior was intentionally removed.
5. Deletion pass (writable fast-writer correction lane): a writable lane
   follows the review, applies safe deletions and corrections across
   production code and test code, reports what was deleted, kept, and why,
   and reruns the focused checks after every edit. The deletion pass is
   never owned by a read-only reviewer.
6. Independent objective-derived verification (independent, read-only): the
   reviewer derives its oracle from the accepted objective and the public
   interface with context isolated from the implementation's conclusions,
   runs only after the correction lane, and rejects tests or snapshots
   weakened merely to get green. The implementation writer's own tests are
   never the only evidence.

Parallel plans keep the single-writer default per ticket with disjoint
ownership; each ticket writer performs the writer-owned phases on its own
surfaces, and integration, review, correction, and final review are strictly
ordered after the writers. Trivial direct work, verification-only runs, and
non-trivial read-only research, audit, and analysis work stay on their
existing paths and never receive writer-owned anti-slop phases.
Simplification remains bounded: never remove trust-boundary validation,
authorization, loss-prevention error handling, required tests, or telemetry.

Independent anti-slop review lanes (test-value review and objective-derived
verification) route through the existing evidence-bound adversarial fallback:
Factory Fable 5.1 `xhigh`, then Devin Fable 5.1 `xhigh`, then Codex
GPT-5.6 Sol `xhigh`. The resolved model stays null until a matching runtime
receipt exists. Specialist routing is unchanged.

Factory writers do not require installed skills. Every lane contract embeds
the complete anti-slop requirements in model-independent prompt fields, so
Factory execution never depends on Codex skill discovery; this is a
deliberate coverage choice recorded in every plan (`factoryCoverage`) and in
the repository contract. The fastest writer chain is unchanged.

## Excluded metrics

Raw lines of code, file counts, test-to-runtime line ratios, identifier
length, and minified or compressed formatting are excluded as quality goals
and gates. They can never fail a run. Cyclomatic and Halstead complexity
signals stay diagnostic evidence only and never outweigh readability,
domain boundaries, security, or behavior.

## Skill catalog 0.24.0

Catalog `0.24.0` vendors Dillon Mulroy's upstream `dmmulroy/anti-slop`
install skill and plugin assets at exact upstream commit
`e8c4880471b23ab7f216fba7b27d173a6ef07d4c` with MIT provenance. The pristine
upstream bytes stay untouched under `artifacts/1.5.17/skills/upstream` as
provenance only, bound to the literal pinned expected directory SHA-256
`c309c21257eea4c681cb2388e1939c6f03d98af17885ff14e3b38efaf01f6a55` recorded in
the catalog `upstreamReference` under the repository's canonical folder-hash
algorithm. The installed user-facing surface is a Development System safe
adapter whose single conventional entrypoint, `scripts/install.mjs`, is itself
contained: it refuses absolute targets, empty, dot, or parent path segments
(including nested traversal), backslash targets, any symlink ancestor, any
symlink target escape, and any symbolic link already nested inside an existing
destination, even with `--force`. The adapter contains no other executable, so
containment cannot be bypassed. The upstream `--force` semantics are preserved
and never authorize writing through a symlink. The distinction between the
pristine vendor source and the installed contained adapter is recorded in the
catalog via `upstreamReference`, and no npm dependency is added.

Catalog `0.24.0` also adds the internal `behavioral-evidence` skill for the
test-value review and anti-self-grading verification rules, and ships a new
immutable 1.5.17 `simplify-code` copy carrying the mandatory deletion pass.
`research`, `behavioral-evidence`, `simplify-code`, and `install-anti-slop`
are operational-evidence skills: the live skill probe must prove each one
catalogued, loaded, and influential on the Codex-compatible surface with
exact behavior signatures and installed folder hashes, and `audit-skills`
fails closed without that evidence. Live evidence is generated by
`skills:probe` after global installation; file presence alone never proves
loading or influence. Factory is not claimed to be live-probed; Factory
writers are covered by the lane-embedded requirements above. Codex
discovers the capabilities through normal catalog installation into
`.agents/skills`, and T3 Code inherits the Codex-compatible surface.
Published 1.5.16 bytes and catalog 0.23.0 remain untouched
rollback targets.

## Repository preparation

Repository initialization and normalization record Development System 1.5.17,
skill catalog `0.24.0`, and the same executable anti-slop lane contract
schema (phase owners, writability, and ordered dependencies), the installer
safety contract, and the Factory coverage choice. The protocol is one shared
contract surface, never a product-specific copy. 1.5.16 remains the rollback
target. See `docs/model-routing.md` and ADR 0018 for routing policy.
