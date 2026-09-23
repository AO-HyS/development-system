# Current work — 2026-09-23

## Objective and boundaries

Prepare exactly three user-launched orchestrator runs: Astra XHigh, Sol XHigh,
Sol Max. One run each, 600 seconds for the whole task. No trial has started.
Do not launch, poll, recreate environments, add variants or create worktrees.
The user will notify completion before analysis.

Preserve active branches, product files and processes in AOHYS, Opportunity OS
and NutriPlan. Only their Development System configuration may change. Ten
other canonical product repos are clean on local develop; Clinic Scribe and
Codex Usage Widget source are preserved in local Git. Credentials stay private.

## Development System

Canonical root: /Users/corrortiz/Documents/AO/development-system.
Task branch: fix/workspace-readiness-1.29.1; final handoff is clean develop.
The reviewed and released patch fixes repository generation so normalization
cannot restore obsolete governed/Flash/permit instructions. It preserves custom
lifecycle extensions, catalog 0.48.0 and the customized HTML reports. Published
immutable versions are unchanged.

Release 1.29.1 is published from 72d64aa1469d3e9b53a0c5ee2271468291705765;
PR #104 merged. Its exact package is globally installed and pinned in all seven
product/benchmark consumers. Audit is healthy; Jev hooks are disabled. The
advisory component remains the unchanged 1.29.0 recipe inside package 1.29.1.
Full verify passed 887 tests under Node 22; scenario passed installation, drift,
failed validation, reinstall, rollback and preservation. Earlier Node 25 broad
run timeouts were retained; no timeout/assertion was weakened. Selected model,
unrelated global guards and customized report bytes remain unchanged.

## Cleanup

- All 51 historical linked Development System worktrees were retired through
  normal Git removal after ownership checks and recoverable archival. Only its
  canonical checkout remains; local branches and evidence are preserved.
- Old canonical tracked work is on archive/canonical-pre129-20260923 at 5a7ce5b.
  Its 215 untracked files are in the private recovery archive.
- The obsolete local Jev hook was archived and is absent from this checkout.
  The global destructive-command guard remains. Jev has no per-tool/Stop gate
  or automatic controller.
- Ten inactive canonical products are clean on local develop with 1.29.1
  metadata/adapters. Casa Roca, Eteria and Barber pin the published package;
  frozen installs and normal hooks passed. Product remotes were not changed.
  The active three retain current branches and work; only DS guidance and the
  old AOHYS DS dependency/lock entry changed. Private archives preserve 602
  inactive-repo untracked files.
- Historical Barber and NutriPlan base worktrees still have live servers and
  are retained; they are separate from the three prepared trial worktrees.

## Benchmark handoff

Private preparation root:
~/.development-system/private/benchmarks/orchestrator-manual-129-20260923/.
Read readiness.json, preparation.json, contract.md and each saved prompt.
Roots under AO/.worktrees/nutri-orch-{variant}-129 are clean at the identical
prepared commit bb569b823a9b7ccf7d69902725da323251247cb6, based on product
revision 48dd5266d928feb457648ec78e29bc5201be21c8. Each has its own env, backend,
synthetic accounts, ports, Chrome host/window and photo inputs. Keep them alive.
Browser login/reload and simultaneous tab-scoped recording preflight passed;
this is infrastructure evidence, not acceptance of the unimplemented card.

Task: an inspiration-card form and new Convex entity in NutriPlan. Only the
orchestrator model/effort changes. Fresh exclusive agents per variant; Luna
High priority research/exact work, Astra XHigh plan and independent reviews,
Sol Medium normal general writing as routed. No shared agents or candidate code.
Tokens are extracted after completion from exact root/descendant thread IDs.
Headroom stays outside this baseline.

## Evidence and next action

Private audit root:
~/.development-system/private/workspace-audits/20260923/.
Recovery receipts, env hashes, reviews and verification outcomes stay there.
Earlier continuity is preserved in current-work-before-final-summary.md.
Final report uses the existing notebook helper/tunnel; keep it concise,
preserve comments and omit tunnel lifetime prose.

Final preparation records are version-aligned; HTTP health and synthetic login
passed again after the dependency update. Readiness is authoritative in the
private receipt. Deliver the three prompts inline and wait for the user.
PR #102 was closed as superseded by #103; its 27 report files are preserved.
