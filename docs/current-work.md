# Current work

## 2.10.0 — shared checks (in progress, session of 2026-11-02)

- Branch `feat/ds-2100-shared-checks`, base 9b2d268 (develop after the 2.9.0 release). Every change of this session goes here; the release builder (`build-release-2100.mjs`) is cut when the scope closes.
- Origin: the X bookmarks review of 2026-11-02 (bookmark 54, Matt Pocock; summary in `~/.development-system/private/scratch/x-bookmarks-review/resumen-bookmarks-x.md`).
- Done (not committed):
  - `development-system check-file-size [--root] [--base <ref>] [--json]` in `src/file-size.mjs`. Staged index vs HEAD by default; `--base` compares the working tree plus untracked files with the merge-base. A file may not end over 5000 tokens (bytes/4); a file already over may grow at most 1000 bytes per change. Generated, vendored and build files are excluded. Optional `.file-size-budget.json` (`budgetTokens`, `growthBytes`, `include`, `exclude`; unknown keys fail).
  - This repo's `.file-size-budget.json` scopes it to `bin/`, `src/`, `scripts/`, `runtime/`.
  - Live check: a new 30 KB file fails, a `.gen.ts` passes, `src/cli.mjs` +2000 B fails, +400 B passes, a bad config fails. It also caught its own first wiring growing `src/cli.mjs` by 1044 B, which moved into the module.
  - Guard policy 2.4.0 (`artifacts/2.10.0/skills/internal/global-agent-guardrails`, catalog 0.74.0): GNU `parallel` is unwrapped like `xargs`. Before: `parallel touch ::: src/foo.test.ts` was allowed; now `test-file-write`. Readers pass; shell-text and command-less `parallel` are `shell-dynamic-command`; `::::` files behave like `xargs` stdin.
  - `development-system clean-cache <entry> [--dry-run]` (`src/clean-cache.mjs`): moves one direct entry of an allowlisted cache root to `~/.Trash` and appends `~/.development-system/private/cache-cleanup.jsonl`. Live: moved `~/Library/Caches/ms-playwright/chromium_headless_shell-1243` (195 MB, recoverable from the Trash); the owner had already deleted `chromium-1243`. Roots, links and other paths refused.
  - Release builder `scripts/build-release-2100.mjs`; `src/guardrails.mjs` audits catalog 0.74.0. Isolated HOME install of the committed package: doctor healthy, installed guard blocks the `parallel` test write.
  - Codex threads of #182 (codex:4434873930 P1 reservation reuse, codex:4434873933 P2 post-merge lineage) were fixed by 6408ce27 before Codex posted on the older commit 727d44a. P1 reproduced live in an isolated HOME on #184: same key after a recorded round is refused. P2 verified by code (`lineageState` filters reservations to lineage members); not reproduced live. Both threads answered and resolved on GitHub on 2026-11-02 (discussion_r4450382297, discussion_r4450382622).
  - Review brake live state: since the 2.9.0 install the ledger has only exemptions (#183, #184, nutri-plan #678, #679); no Sol slot reserved yet.
  - Steward (catalog skill in `artifacts/2.10.0/skills/internal/development-steward`, `reviewedAreas` + `emil`): weekly Emil upstream diff and a PostHog-driven proposal of at most two screens per allowlisted product repository; read-only.
  - `/in-your-own-words` (`artifacts/2.10.0/skills/external/in-your-own-words`) runs the four pstack `sharpen` questions first and lists suggested improvements apart from the owner's request (owner request 2026-11-02). pstack stays installed and frozen (owner 2026-11-02: keep it if it does not get in the way; 57 of 58 skills are model-invocation disabled).
  - Verification investigation (2026-11-02): receipts accept self-declared pass flows, free-text environments and missing captures (`src/evidence.mjs:57-75,175-186`); only 4 receipts name QuickE2E; incidents in Barber threads 39726ee8, d8e03671, 9ca82504. Mistake `evidence-gate-accepts-unrun-flows`. Proposed for 2.10.0: harden the gate and add a one-command QuickE2E wrapper.
  - Owner decisions 2026-11-02: shadcn lint in Barber, Casa Roca, NutriPlan and Planeta Aula (needs a docs grant per repo for lint config); QuickE2E is the standard web verification, Computer Use only where QuickE2E cannot reach; TesterArmy dropped.
- Next: wire it into Barber, NutriPlan and Casa Roca pre-commit and CI after the release and their pin bumps; drop Barber's local branch `chore/staged-file-size-budget` (cfa403dc8, never pushed) once the shared check replaces it.

## 2.9.0 — review brake, stopping rules and cleanup (released)

- Merged to develop in #182 (7bf71ee) and promoted to main in #183 (7656f27, same tree). Published as GitHub release v2.9.0 on 2026-11-02, tarball sha256 `d9c57c46…`.
- Objective:
  - A. A real review brake per branch lineage, with approvals bound to one round and verified ledger records.
  - B. Fix-diff rounds, follow-ups for findings the diff did not cause, a redesign trigger, and coverage of later commits without closing and reopening a PR.
  - C. Settle finished children, check `runtimeMode` before the first `delegate_task`, a parent rotation handoff, pruning of old scripts and docs, and current docs with a drift check.
- Installed globally from the verified package of 7bf71ee. Doctor is ok, and the brake blocked a malformed review `delegate_task` live. `update --version 2.9.0` from the release was checked in an isolated HOME.
- Not yet observed: a real PR review reserving slots 1 and 2 and refusing a third, and the Codex-side brake.
- Open from #182: Codex threads codex:4434873930 and codex:4434873933 are still unresolved on the merged head (Steward recommendation `ds-182-codex-threads-unresolved-at-merge`).
- Plans: `~/.development-system/private/plans/ds-290/`.

## Owner decisions still binding

- Agents must not edit AGENTS.md, CLAUDE.md or lint config without explicit permission, including in this repo. README, ADRs, current-work and other docs stay free, because the owner does not want frequent prompts.
- Update everything: pstack 0.15.0 to 0.15.32 and impeccable 4.3.1 to 4.7.0 («sí quiero actualizar todo», «si adelante»).
- The CI rule-floor proposal is dropped in favour of the guard block. «Investigación condicionada» is dropped.
- Terra 6.1 fast routing (model screen of 2026-10-29, released as 2.8.1): computer use and simulator QA Low, browser app testing High, video Medium. Live adoption is observed only on the next real delegation of those kinds.
- Reviews: one Sol 6.1 High round per ready PR, a second only for a blocking finding, no third without the owner's approval bound to that round. Browser: one session per PR.
- Mobile PRs need iOS and Android in the receipt; develop merges follow `development-system pr-review-status <pr> --gate`; main, releases and production wait for the owner.

## Still open from earlier records

- Owner decisions: home-expenses Electron renderer imports removed client auth (needs a server-login decision); escuela-360 Cloudflare Preview fails "Not logged in" (needs a new token); casa-roca-dashboard has no Vercel Git connection.
- Test accounts for authenticated previews: NutriPlan has them (Diana Prueba `TEST_*` in `apps/dashboard/.env.local`); the other repositories still need them confirmed.
- A product CI step for check-agents-rules/check-lint-floor needs an authorized release and product pin bumps.
- First weekly Steward run under the A5 and 2.3.0 duties not yet observed; live skill selection by a host not observed.
- Known guard gap: `parallel cmd ::: a` test writes are not inspected.
- nutri-plan production waits for its redesign.

## History

Earlier records were removed from this file. The full previous version is at
https://github.com/AO-HyS/development-system/blob/703fa478eda5f0cfe9667d6e2099e9f226119f37/docs/current-work.md
