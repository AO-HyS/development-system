# Current work

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
