# Current work — Development System 2.4.0 review budget

Root: /Users/corrortiz/Documents/AO/development-system (canonical).
Branch: chore/ds-240-review-budget from develop 15093d0 (merge of PR #167), PR #168.
Untracked .impeccable/, output/ and private/ remain untouched.

## This branch: 2.4.0 (catalog 0.69.0)

Why: on 2026-10-14 reviews per push across three gardener threads took one
Codex account from 1% to 100% of its weekly limit in ~28 hours and drew on paid
credits; Claude threads reread up to ~950K tokens per call. Audit scripts:
`/private/tmp/usage-audit/`. The operator paused all product threads.

- Review budget (global rules, `flow-implement`, `primitives-gardener`,
  `cross-review`): one Sol 6.1 High review of the finished PR, a second only
  for a blocking finding over the fix diff, none for docs-only or small
  low-risk PRs; Codex asked at most twice. `pr-review-status` reports
  `budget-spent` (ok) once both requests are used and every finding of the
  last reviewed head is answered.
- `cross-review` only on the operator's request; browser and computer use on
  Sol 6.1 High.
- Managed Claude settings add `CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000`.

Operator authorized 2026-10-14: merge, promote to main and install, then
start new primitives threads (Casa Roca, NutriPlan, AOHyS) under 2.4.0.

# Earlier: Development System 2.3.0 closeout (PR #167, merged 15093d0)

## Delivered: 2.3.0 (PR #166, merged to develop 2026-10-13)

- QuickE2E 0.5.0 on Jev as the standard web verification, live only: flow
  files stay in private evidence and no replay spec is emitted (operator
  decision 2026-10-13). Runtime preload `quicke2e/typesafe-jev.mjs` sends the
  OpenRouter request to TypeSafe.
- Primitives: `docs/architecture/primitives.json` schema v1,
  `development-system check-primitives`, skills `primitives-gardener` (fix and
  tend) and `system-recap`.
- `development-system friction add/list`; `development-system pr-review-status
  <pr> [--request]` gates develop merges on a clean Codex review of the exact
  head. Request markers count only from the authenticated account.
- `cross-review`: one visible T3 thread with the reviewer the operator chose.
- `in-your-own-words` (pstack) and updated verification skills.
- The Stop-hook server reminder was dropped; tracked as friction
  `server-ownership-needs-launch-receipt`.

Reviews: Sol 6.1 High rounds 1–9, round 9 APPROVE on 16d3b43. The merge
relied on `pr-review-status` reporting no-findings on 16d3b43, but that came
from an empty Codex review created by a thread reply; the real review, posted
after the merge, had one P2 (shared `/tmp/body.md` in `system-recap`). Both are
fixed on this branch (mistake `codex-gate-counted-empty-review`). Installed in
the operator HOME: package/contract 2.3.0, catalog 0.68.0, source 386ae74,
doctor ok, guardrails and report gate healthy. 2.3.0 bytes stay immutable.

The weekly Steward task (Mon 09:00) runs the 2.3.0 checks: primitives tend,
friction list and pr-review-status of merged PRs.

## This branch: 2.3.1 (catalog 0.68.1)

- `doctor` and shared `update` human output print version, catalog, commit and
  health instead of `Installation undefined.` (friction
  `doctor-human-summary-undefined`).
- `pr-review-status` counts only real Codex reviews (body with the Codex
  Review header), never the empty review a thread reply creates.
- `system-recap` sends the edited PR body through standard input,
  shipped as artifacts/2.3.1 so the installed 2.3.0 keeps its bytes.
- This record.

## Follow-up work in other threads

- Primitives gardener, mode fix, launched 2026-10-13 on canonical checkouts:
  Casa Roca, NutriPlan and AOHyS. The Barber Central prompt is for the
  operator to launch (`~/.development-system/private/research/primitives-20261013/prompts/the-barber-central.md`).
- NutriPlan dev Convex `elated-shark-671` answered function calls again on
  2026-10-13 (no longer paused); the NutriPlan thread was told.

Plan and inventories: `~/.development-system/private/research/primitives-20261013/`.

## Still open from earlier records

The full history before 2.3.0 is `git show 386ae74:docs/current-work.md`.
Carried forward, still unresolved:

- Owner decisions: home-expenses Electron renderer imports removed client auth
  (needs a server-login decision); escuela-360 Cloudflare Preview fails "Not
  logged in" (needs a new token); casa-roca-dashboard has no Vercel Git
  connection.
- Test accounts for authenticated previews: NutriPlan has them (Diana Prueba
  `TEST_*` in `apps/dashboard/.env.local`); the other repositories still need
  them confirmed (the primitives threads use each repo's env accounts).
- A product CI step for check-agents-rules/check-lint-floor needs an
  authorized release and product pin bumps.
- First weekly Steward run under the A5 and 2.3.0 duties not yet observed;
  live skill selection by a host not observed.
- Barber was not replayed for Line A (its checkout belonged to an active
  thread); casa-roca pre-migration ESLint config no longer loads (fails closed).
- Known guard gap: `parallel cmd ::: a` test writes are not inspected.
- nutri-plan production waits for its redesign; opportunity-os keeps 35
  uncommitted LinkedIn-workflow changes from 2026-10-06 untouched.
