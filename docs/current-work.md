# Current work

## 2.9.0 — review brake, stopping rules and cleanup (in progress)

- Branch `feat/ds-290-review-brake`, base 703fa47 (develop, after the 2.8.1 production release).
- Objective:
  - A. A real review brake per branch lineage, with approvals bound to one round and verified ledger records.
  - B. Fix-diff rounds, follow-ups for findings the diff did not cause, a redesign trigger, and coverage of later commits without closing and reopening a PR.
  - C. Settle finished children, check `runtimeMode` before the first `delegate_task`, a parent rotation handoff, pruning of old scripts and docs, and current docs with a drift check.
- Plans: `~/.development-system/private/plans/ds-290/`.
- Status: implementation in progress.

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
