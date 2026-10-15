# Current work — in-your-own-words review pause (2.4.2 installed)

Root: /Users/corrortiz/Documents/AO/development-system (canonical).
Branch: fix/in-your-own-words-review-pause, from develop
3e1e8a9981c51dd101c6f1e1d9c6008bb21a3060.
Untracked .impeccable/, output/ and private/ remain untouched.

User request 2026-10-15: explain goal/problem AND the concrete proposed approach
in more detail, then end the turn for review; unify the English/Spanish naming.
One logical skill was found: the Spanish picker label differed from the English
identifier, and Claude uses a symlink mirror. No duplicate skill was deleted.

2.4.2/catalog 0.69.2 candidate adapts the external skill, aligns its picker name,
and decouples routine autonomous restatement from the explicit review pause in
the global instructions and flow-implement. Published 2.4.1 bytes stay immutable.
Opus 5.5 authored the read-only plan; fresh Sol 6.1 High approved it. The parent
is the sole writer; no protected native Haiku writer route was observed.

Passed: typecheck, release:prepare, roster:check, check-no-tests, rules check
(69 kept / 0 missing), diff check, isolated install/sync-skills/validate healthy
and installed byte/symlink inspection. Fresh independent Sol 6.1 High final
source review: no actionable findings on candidate snapshot
25b269b8d9a7523967ae90de7ab8187130911404.
Generic skill quick_validate rejected the preserved Claude frontmatter flag;
recorded friction skill-validator-claude-frontmatter. Catalog validation passed.
Evidence: ~/.development-system/private/research/in-your-own-words-20261015/.
Operator explicitly authorized global installation (Instalar globalmente).
Installed package/contract 2.4.2, catalog 0.69.2 from reviewed source
596df102187e2746a47db792f7819c95ca803e7d using the same verified package that
passed full shared setup in an isolated HOME. Global doctor ok, zero problems;
guardrails, Claude orchestration and report gate healthy. Installed skill bytes,
both host instructions and the Claude symlink match the reviewed candidate.
One logical catalog entry remains. Product repositories were not written.
Receipt: ~/.development-system/private/research/in-your-own-words-20261015/global-installation.json.
Pending: fresh-session skill discovery and actual stop/wait behavior on the
next real invocation. This session received the updated global instructions;
that alone does not demonstrate skill behavior. No release, merge or remote
publication performed. No processes started.

---

# Earlier — Development System 2.4.1 browser budget

Root: /Users/corrortiz/Documents/AO/development-system (canonical).
Branch: chore/ds-241-browser-budget from develop b7c7937 (merge of PR #168).
Untracked .impeccable/, output/ and private/ remain untouched.

## This branch: 2.4.1 (catalog 0.69.1)

2.4.0 shipped (main ba0cd4f, release v2.4.0) and is installed. A check of the
new primitives threads on 2026-10-14 found them within the review budget and
under ~270K context, but AOHyS ran six Sol browser sessions across three PRs in
an hour. 2.4.1 adds the browser budget (global rules, `flow-implement`,
`primitives-gardener`, `behavioral-evidence`): one browser session per PR on
its ready head, a second only to check the fix of a real defect, one visual
critique for UI changes, no third without the operator. Operator authorized
2026-10-14: change and install.

# Earlier: Development System 2.4.0 review budget (PR #168, merged b7c7937)

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
