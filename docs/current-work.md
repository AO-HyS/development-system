# Current work

## 2.12.0 — agent autonomy: four stops, spend guard, Browse pilot, OpenCode benchmark (branch `feat/ds-2120-agent-autonomy`)

- Owner request 2026-11-08 (thread 63235c05): stop approving and pushing agents; full control with his accounts; compare OpenCode Browse. Plan v4 accepted by Sol 6.1 High cross review (thread `mcp:launch:bc946dc8…`, 4 rounds), `~/.development-system/private/cross-review/agent-autonomy-20261108/plan-v4.md` sha256 `87573042a0992e83d122445185fa796bc77a3f70feb4d1887f89140170e29c33`.
- Owner approval, verbatim: «Adelante, adelante, implementa todo esto. Y aparte necesitamos medir al agente de pen code. Instálalo y ve en cuál salen mejor las cosas.» It approves the four stops as proposed, improvements A–E, and the first promotion of this version (merge to main, release, global install), per plan step 2. It adds an OpenCode agent benchmark against Claude Code and Codex.
- Base: origin/develop 4b9dfe9 (same tree as main after the 2.11.0 release).
- Inventory (criterion 1): ~/.development-system/private/permission-audit/2026-11-08-inventory.md. Hypothesis confirmed: DS guards/rules ~867 of 1,061 denials and 17 of 35 sampled nudges vs 28 host classifier denials; agents stopping early is the second cause.
- Built: config/global-instructions.md four stops + common rule (main/releases/installs proceed through gates; budgets never ask, never promote); guard policy 2.5.0 in artifacts/2.12.0/skills/internal/global-agent-guardrails (MCP spend guard scripts/mcp-guard.mjs + references/mcp-policy.json, mentioned commands are data, incremental-spend CLI rule); src/guardrails.mjs matchers add mcp__.* (catalog 0.76.0, setup 2.12.0) and MCP audit probes; review gate text no longer asks the owner; scripts/build-release-2120.mjs.
- Dry run (criterion 3): ~/.development-system/private/scratch/agent-autonomy/dryrun.py -> 35/35 on the candidate guard (2.10.0 guard: 25/35).
- PR #195: Sol round 2 (fix-diff 758050f, slot 2) blocking: DS195-07 custom argv0 and split argv (fixed: argv reconstruction from every file candidate), DS195-02a expect/playwright Node code (now scanned as node -e), DS195-02b comments to teammates (message stops), DS195-08 spend regex option values (fixed). Sol budget spent (2/2). Dry run 65/65.
- PR #195 (head c130f31): Sol round 1 blocking (reservation c203e077): DS195-01 interpreter mention relaxation reverted; DS195-02 no exempt MCP servers, exact lists for T3, Linear, Notion, docs/search/design servers, unobserved servers stop; DS195-03 Vercel toolbar replies are message stops, secret-returning reads are security stops; DS195-04 PostHog exact read targets with the full `call` parsed, TikTok tool_execute and Linear merge_diff stopped; DS195-05 `vercel [global options] domains buy` stopped; DS195-06 test grants become an owner action in the closing. Also closed a gap present since 2.10.0: argv with the file repeated as argv[0] (`posix_spawnp('gh', ['gh','pr','merge'])`). Dry run 55/55 (`dryrun-r2.json`). Next: Sol round 2 fix-diff (slot 2), Codex request 2, gate, merge develop, then main, release v2.12.0, global install.
- Browse pilot (synthetic, ~/.development-system/private/scratch/browse-pilot/report.md): criterion 6 passed (two concurrent sessions isolated, allowlist denies cross-origin goto, recovery after relay restart, owner HOME untouched); criterion 7 not reached (every free OpenCode model returned 429, the agent never ran). Free-model rerun scheduled once for 2026-11-09 01:30 local; no paid model.
- Pending: AGENTS.md authorization boundary needs the owner docs grant for this repo; T3 defaultRuntimeMode full-access is an owner setting; OpenCode ChatGPT login refused by the Claude classifier (benchmark runs free models only).

## 2.11.0 — `/in-your-own-words` says when the work is done (branch `feat/ds-2110-own-words-done`)

- Owner request 2026-11-07, after the task-eval month run (top failure: stopping before the end or re-asking granted permission; 84 objectives "done" without evidence). The owner rejected a lock and chose to put the definition of done in the plan.
- `artifacts/2.11.0/skills/external/in-your-own-words`: the proposal now has five parts: what it understood, how to improve it, the plan, when it is done (numbered `action or command -> observation` at the authorized endpoint) and how it will be proven (real verification per item, what cannot be proven, real effects). After approval the list is the goal: check every item before saying done, keep working while authorized, stop only for a named concrete blocker, never loosen the list, report each item passed/failed/not reached. Idea from pstack poteto-mode `autonomous-run`; provenance in `UPSTREAM.md`.
- Release builder `scripts/build-release-2110.mjs`, catalog 0.75.0; only `in-your-own-words` changes.
- Pending: PR to develop, Codex review, isolated HOME install, then main/release/global install wait for the owner.

## 2.10.1 — settings drift, owner approvals, review waiver (merged to main 2026-11-03)

- PR #188 (`fix/ds-2101-settings-drift`) merged to develop as 3793d44; release PR #189 merged to main as 5c91a41. It includes 2.10.0, which never got its own GitHub release.
- Settings drift: an allowlist of owner keys, a hash of the managed hooks and the execution env, and stricter field checks on managed hooks. Settings the owner changes no longer block installs.
- Approvals: `review approve --quote` takes the owner's words as said, with no PR or round numbers to repeat. An owner-approved Sol round may follow a clean round only with a matching approval and live reservation (151103a).
- `review waive --pr --head --quote` (150bea9): the owner's stop words end review rounds for that head. The gate counts it as Sol and Codex review while the PR description quotes the words verbatim. Open threads still block. The global instructions say: record the waiver and merge, never ask for another round.
- #188 used Sol rounds 1–6 and both Codex requests. It merged under the owner's waiver «Ya estoy harto de las revisiones. Ya no quiero que hagas más revisiones. Ya solo quiero que lleves esta nueva versión a la producción.»
- Pending owner actions:
  - GitHub release v2.10.1. The auto-mode classifier blocked `gh release create`. The tarball is at `~/.development-system/private/releases/2.10.1/aohys-development-system-2.10.1.tgz` (sha256 `77267724…`).
  - Global reinstall. The live install is from 7d44143 and lacks `review waive`.

## 2.10.0 — shared checks (shipped inside 2.10.1)

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
  - `/in-your-own-words` (`artifacts/2.10.0/skills/external/in-your-own-words`) answers in three ordered parts: what it understood (the request restated unchanged), how to improve it (the four pstack `sharpen` questions, improvements marked as suggestions) and the plan built on both, then waits (owner correction 2026-11-02: understand first, never rewrite the request before explaining it). pstack stays installed and frozen (owner 2026-11-02: keep it if it does not get in the way; 57 of 58 skills are model-invocation disabled).
  - Verification investigation (2026-11-02): receipts accept self-declared pass flows, free-text environments and missing captures (`src/evidence.mjs:57-75,175-186`); only 4 receipts name QuickE2E; incidents in Barber threads 39726ee8, d8e03671, 9ca82504. Mistake `evidence-gate-accepts-unrun-flows`. Proposed for 2.10.0: harden the gate and add a one-command QuickE2E wrapper.
  - Owner decisions 2026-11-02: shadcn lint in Barber, Casa Roca, NutriPlan and Planeta Aula (needs a docs grant per repo for lint config); QuickE2E is the standard web verification, Computer Use only where QuickE2E cannot reach; TesterArmy dropped.
  - XState pilot (plan v5 1.4, owner go 2026-11-02, the two-week wait dropped because the gate had no real use to measure): `src/review-gate-machine.mjs` routes siguiente; `pr-review-status --diagram` prints Mermaid; XState 5.33.3 vendored byte for byte in `src/vendor/xstate/` with `VENDOR.json` hashes. Verified: the old if/else routing and the machine agree on all 41,472 fact combinations (0 mismatches; mergeReady equals reaching runGate/merge) and on 5 real PRs (#182, #183, #184, nutri-plan #678, #679) against the installed 2.9.0. The Steward measures it weekly (`review-gate-machine`).
  - QuickE2E (owner 2026-11-02: already compared, make sure it is installed and used): `development-system quicke2e install|status|check|run` (`src/quicke2e.mjs`). Installed live: QuickE2E 0.5.0 + Playwright 1.64.1 in `~/.development-system/tools/quicke2e-runtime` (the old checkout had Playwright 1.63.0, below the sandbox fix). Jev via the 2.3.0 TypeSafe preload and jevgrep credentials. Live on a scratch app: 2/2 flows DONE_VERIFIED in 1.6 s, a wrong expectation fails MODEL_BLOCKED, `--emit` and a flow inside a repo are refused.
  - Evidence gate: `evidence record` needs `--tool quicke2e|computer-use|simulator` and an http(s) environment; a QuickE2E receipt verifies its hashed `run.json` (edited, failed flow, other checkout -> failed; missing -> incomplete); Computer Use needs `--reason`; captures must exist. 14 cases checked in an isolated HOME. `behavioral-evidence` skill 2.10.0 documents the one command.
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
