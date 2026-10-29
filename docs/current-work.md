# Current work — Terra 6.1 fast vs Sol 6.1 High benchmark (2026-10-29)

Branch `feat/ds-280-terra-benchmark` from develop 60ff36e, thread 48c433b5.
Accepted plan (cross-review with Sol, 4 rounds, SIN BLOQUEANTES):
`~/.development-system/private/cross-review/terra-benchmark-20261029/plan-v4.md` (sha256 f7497969…1541).
Owner approved execution on 2026-10-29 («si ya se pusieron de acuerdo, adelante»): budget 24 sessions
(ceiling 30, 20 min each), direct-browser route for NutriPlan testing, synthetic writes with functional cleanup,
Planeta Aula for computer use. Fast tier is requested as T3 `serviceTier: priority`.
Private evidence: `~/.development-system/private/terra-benchmark-20261029/`.
Deliverable: `docs/model-screen-2026-10-29.md` + document report. Owner approved 2.8.0 and asked to fix the recorder and test video again («Adelante, corrige lo que tienes que corregir y luego vuelve a testear»).
Progress:
- [x] Packets and private oracles frozen (`packets-oracles.sha256`; video packet refrozen before any counted run; exploration order in `exploration-order.json`)
- [x] Terra smokes (web, simulator, recording) OK at 17:21Z, requested tier priority, child-observed tier unknown
- [x] Blockers fixed by the parent (owner: «debes ser capaz de correr sin mi intervención»), 2 earlier preparation failures do not count:
  - browser route changed to the headless `agent-browser` CLI (T3 preview snapshots time out while hidden); Chromium installed with `agent-browser install`; packets rewritten (old ones in `packets/superseded/`), hashes refrozen; recording is fixed at 1280×720 by agent-browser (deviation from 1440×900);
  - stale device session closed; Planeta `apps/mobile/.env.local` swapped to preview (backup `prep/planeta-mobile.env.local.backup`, sha 2981887e…; **restore at the end**); bundle verified preview-only and MOBILE1 login shows the preview note;
  - parent helpers: `prep/materialize.sh <run> <type>`, `prep/pa-login.sh`, `prep/pa-logout.sh`, `prep/np-login.sh <session> NUTRI|ASSISTANT`, probes `prep/np-probe.sh`, `prep/pa-probe.py`.
- [x] Exploration (9 runs, all pass; finalists video low, testing high, CU low) and confirmation S-T-T-S (12 runs); results in `runs/log.jsonl`
- [x] Blind video critiques (2 Opus sessions, `critique/`)
- [x] Cleanup: 7 NutriPlan patients soft-deleted (0 live); 7 Planeta notes retained as synthetic residue; Planeta `.env.local` restored (sha matches); Metro and dashboard stopped
- [x] Deliverable `docs/model-screen-2026-10-29.md`: testing → Terra high, CU → Terra low, video → keep Sol
- [x] Owner approval for 2.8.0
- [x] Recorder fixed: agent-browser upgraded 0.15.1 → 0.41.0 (records the active tab at the viewport, keeps the page after stop, contact sheet); `prep/np-login.sh` moved to label/role locators with a hydration wait; video packet v3 (sha f8b54e20…; v2 in `packets/superseded/`)
- [x] Video rerun: exploration low 86 s, high 97 s, medium 67 s, all pass (critique `critique/exploration-r2/`), finalist medium; confirmation S 168 s, T 70 s, T 102 s (T3 restart cut the logout), S 230 s, all pass (critique `critique/confirmation-r2/`); video → Terra medium fast. Dashboard stopped, no open agent-browser sessions
- [x] 2.8.0 source: roster (computer-use route, Codex browser-qa/computer-use-runner, `primaryComputerUse`, `policy.review.computerUse`, host texts), `config/global-instructions.md`, `codex-review.mjs` (computer-use profile + `service_tier`), `rosterModel` carries a priority tier, `scripts/build-release-280.mjs`, artifacts/2.8.0, manifest 2.8.0; release:prepare, roster:check, roles:check, typecheck, check-no-tests pass
- [ ] Isolated-HOME install of 2.8.0 (needs a clean commit), PR to develop, Codex review, evidence record

---

# Current work — weekly learning controls (2.6.1 installed globally)

2026-10-25, develop f1c8ae1 (no branch yet), thread f051c9c7: audit of 2.6.2 plus a
review of 15 X posts. Handoff at a safe point; nothing in the repo changed except this note.
Done: the audit was cross-reviewed with Sol 6.1 High (thread
mcp:85e0667d-b99b-43dc-955c-25bb6c01e5d2) and agreed in 3 rounds; the accepted version is
~/.development-system/private/cross-review/audit-ds-262-20261025/audit-v3.md (sha256
fea81b3d…7a80). The earlier HTML report
(~/.development-system/private/documents/auditor-a-del-development-system-2-6-2-y-760a4ff90b68ccf4.html)
has the pre-review numbers; v3 supersedes it. Three frictions were recorded.
Owner decisions:
- Update everything: pstack 0.15.0 to 0.15.32 and impeccable 4.3.1 to 4.7.0 («sí quiero actualizar todo», «si adelante»).
- Agents must not edit AGENTS.md, CLAUDE.md or lint config without explicit permission, including in this repo. README, ADRs, current-work and other docs stay free, because the owner does not want frequent prompts.
- The CI rule-floor proposal is dropped in favour of that guard block.
- «Investigación condicionada» is dropped.
- The secret id `nutriplan-test-credential-in-thread` was a mistake on my part; the real pattern is `delegate-secret-echo` and related output-leak ids.
Plan v1, waiting for the owner's corrections:
- Phase 0, read-only, now: reconcile the 13 Steward recommendations and build a per-cause control matrix; decide whether to simplify the mistake and friction log.
- Phase 1, DS, one PR each:
  - (1) pstack and impeccable update (authorized), with impeccable capped at 2 passes.
  - (2) pr-review-status fixes: Codex receipts, budget, the wrong `run --request` message, a stuck-review state, Sol rounds in `mergeReady`. Limits are in audit-v3.
  - (3) Guard block on AGENTS.md, CLAUDE.md and lint config, with a per-task terminal grant `allow-docs`.
  - (4) Durable grill that saves answers.
  - (5) `--help` on every subcommand, plus guard precision.
  - (6) Reducer guidance in `architect` for flows of 3 or more steps.
- Phase 2, products: (7) a Convex preview deployment per Barber branch (no extra cost; verify the plan, seed and env first); (8) a Casa Roca dashboard animation experiment, then prune the 9 animation skills.
- Later: (9) secrets out of agent reach (1Password for Agents).
- The formal plan goes through plan review (Sol authors, Opus reviews) and is presented visually.
Retained authorization for a continuation:
- Read-only work (phase 0, research).
- The pstack/impeccable update on a branch from updated develop, up to a PR to develop, with the usual evidence and review budget.
- No merge without the gate, no release, no main, no product PRs until the plan is approved.

2026-10-23, branch `fix/cross-review-sol-reviewer`: cross reviews sometimes ran on
Astra because the `cross-review` skill (2.4.0) named `gpt-6-astra` xhigh for a Claude
author while the review rule says Sol 6.1 High, and `~/.codex/config.toml` defaulted
to `gpt-6-astra` xhigh. Owner chose: reviewer Sol 6.1 High and Codex default Sol 6.1
High; no new check («No creo que sea necesaria una verificación»). 2.6.2 / catalog
0.71.2 republishes only `cross-review`. The Codex default is a local HOME edit.

2026-10-19: 2.6.1 / catalog 0.71.1 is installed globally from develop 27b28e8 (PR #171
and #172). `development-system doctor --json` reports verified-package, sourceCommit
27b28e8408f0af4f981aced9d55e2edf86b1ddb9, no problems. 2.6.0 itself never reached
HOME; the installer went from 2.5.0 to 2.6.1. Threads already open keep their older
instructions until resumed. Main and a release wait for the owner.
Next: the Monday 09:00 Steward run on 2026-10-26 prunes what did not help (plan-r3).

2026-10-19 Steward weekly retro (thread ead4698f), handoff. Done: 22 threads read,
95 merged PRs checked with pr-review-status, ledger has 16 sessions and 13 pending
recommendations (~/.development-system/steward/retro-state.json). Mistakes and
frictions are recorded. Report:
~/.development-system/private/documents/retro-semanal-del-steward-2026-10-19-a6cf1693c0c821cd.html.
PR #173 (docs) merged to develop with the owner's go-ahead («Sí, puedes meriar»).
The owner dropped the Barber #487 Stripe key item («no te preocupes por ella»).
Pending owner: Barber #536 Facebook email P1 (product decision). Retained
authorization for a continuation: read-only Steward checks only. No merge,
release or product PR.

2026-10-19: owner asked for the review, all fixes, then the global install. Sol 6.1 High
review of 2.6.0 (round 1, observed gpt-6.1-sol high): 9 findings, 4 blocking, all in the
merge gate; Codex on PR #171: no findings. All 9 fixed in 2.6.1 / catalog 0.71.1 on
branch fix/ds-261-review-findings; guard probe 30/30, tmp probe 13/13. A second Sol
round reviewed only the fix diff (blocking findings were security).


2026-10-18, branch `feat/weekly-learning-controls`. Owner: «No hay nada que
comprobar. Ya llévalo. No hace falta ninguna revisión. Ya ultra llévalo.» -> PR to
develop merged without Sol/Codex review by owner waiver. Plan: weekly review action plan, cross-reviewed with
Astra and accepted at plan-r3 (~/.development-system/private/cross-review/
dsplan-20261018/plan-r3.md). Owner rule: mandatory evidence unless he says
«pásatela» (quoted verbatim in the PR). The owner wants to be told when 2.6.0 is
ready, before any PR, merge or install, to say what else was worked on.

Done (see ADR 0073): B1 mistake causes (fdee264), B5 evidence receipts and merge
gate (8cb40b1), B2 handoff prompt (5a342ce), B3 install stop during active T3
runs (e823a8c), B4 guard on temporary directories (715d9a8), B6 Codex weekly
quota in doctor (97d71e3), release scaffolding 2.6.0 / catalog 0.71.0 (37476ef),
guard pin 0.71.0 (7f29fe1), B7 closing uses granted access first (b1de0b1).
B8 broad reading goes to Explore (see below). Owner notification, the develop PR
and the global install are done (see the 2.6.1 entry above).

Evidence so far: typecheck, release:prepare, roster:check, check-no-tests,
check-agents-rules (0 missing), additions-only artifacts/manifests/catalog diff
against 8f995a2, isolated install + sync-skills + guardrails healthy
(scratch/ds260-install-c); live skill influence not reached. Probes in
~/.development-system/private/scratch/ds260-edits/.

---

# Previous: visual plans and completion delivery (2.5.0 installed)

2026-10-15: the owner approved Opus 5.5's R3 direction, “La línea y la
ventana”: “Eso está perfecto. Lo que Opus propone está muy bien.” Implementation
and the subsequently authorized global installation are complete.
Substantive plans and nontrivial deliveries get this visual; ordinary replies
stay text. No tabs or tables. Grill HTML questionnaires and the durable report
renderer remain unchanged.

Owner follow-up: every plan and delivery must explicitly say what is needed
from the user and what happens next. Canonical host guidance, skill instructions,
packet reference and examples now require both statements in the existing
always-visible closing. Say when nothing is needed or the authorized work is
complete; never reopen retained authorization or invent a dependency. This is
a content/instruction refinement; renderer, CSS, interactions and grill are
unchanged. Source: b5c7abd. Focused checks, isolated setup/doctor and installed
example rendering passed. Report: ~/.development-system/private/documents/
cierres-expl-citos-qu-necesito-de-ti-y-q-c95a1f154e8c3521.html.
The owner subsequently authorized global installation: "Adelante, haz la
instalación global." Installed 2.5.0 / catalog 0.70.0 from
8fc7d824e3b4986547af5053cf0631610483842a. Active doctor: ok, no problems.
Guardrails and report gate remain healthy; recovery snapshot exists.
Actual installed renderer generated the delivery summary. A fresh Claude child
reported the new handoff rule in its supplied context; exhaustive automatic
skill activation is not proved. Full audit-skills remains partial: old Factory
mirrors plus stale or unauthenticated receipts for other existing skills.
Those unrelated paths were preserved and the friction recorded. Final report:
~/.development-system/private/documents/visual-explain-instalado-globalmente-2fb48a5cf58025b0.html
No additional browser session or publication was performed.

Parent-owned candidate: artifacts/2.5.0/skills/internal/visual-explain contains
the skill, packet renderer, responsive interaction assets and examples.
config/visual-delivery.md supplies the shared trigger, embedded in Codex global
instructions and a declared Claude rule. Catalog 0.70.0 declares one Codex copy
and a Claude symlink mirror. New manifest/builder/package 2.5.0 preserve published
artifacts. Browser-verified source baseline: 5bcfdead54fe0e3dfb1537e7d84b768ad399be31.
Passed: typecheck, release:prepare, roster/roles, no-tests, rule preservation,
skill validation, primitives and isolated setup/doctor. Installed Codex/Claude
renderers produced byte-identical HTML. Independent source review found no
actionable findings on 0c909aa (requested Sol 6.1 High; observed metadata
unavailable). Subsequent visual corrections passed focused checks and the
authorized browser pass; the final isolated installation matches both HTML files.
audit-skills is incomplete (exit 1): structural health is clean, but a fresh
HOME lacks authenticated live host receipts. Do not claim discovery or adoption.
Global installation is now complete. PR, publication, merge and release remain
outside this task's authorization.

The additional R3 browser pass explicitly authorized by "Sí, verifica y muestra
el candidato" is complete. Click, keyboard, drag, mobile reflow and light/dark
checks passed. One independent Opus 5.5 critique produced five bounded findings;
the parent corrected them and checked final captures with browser measurements.
Native touch, JS-off and reduced-motion emulation remain not reached because
the T3 controls were unavailable. No additional browser session is authorized.
Final plan and delivery HTML were previewed and rendered in the owning thread;
a 32.3-second walkthrough and captures are retained privately. The owned server
PID 51922 was stopped. At that browser-pass checkpoint no global installation
had occurred; the later authorized installation is recorded above. No product
effects occurred.
Exact HTML, setup/doctor/audit results and review receipts are in private
r3/implementation/. Final report: ~/.development-system/private/documents/
visual-explain-implementaci-n-y-verifica-0a0f0cebd03d3844.html.
Canonical root and branch remain /Users/corrortiz/Documents/AO/development-system,
feat/visual-explain-t3, based on ad2da69b5f814c42d4893670e70532bc5ec56ae2.
Private continuation: ~/.development-system/private/visual-explain-20261015/.
Preserve existing untracked .impeccable/, output/ and private/.

## Historical design rounds — superseded by the approval above

Latest owner correction, 2026-10-15: rejects all three R2 proposals entirely
and explicitly hates tables. Both prior rounds are discarded, including tabs;
do not polish or preserve their composition. Owner requests Exa reference
research and/or Opus 5.5 to design a new direction. Exa research and a fresh
read-only Opus design delegation are complete; no new browser session started.
R3 references: Appleton drawinginvisibles1, Ciechanowski Moon, Case Explorable
Explanations. Opus authored "La línea y la ventana" with exact composition,
interaction and plan/partial-close copy; private r3/opus-direction.md. It is
textual design, not a rendered or approved candidate. All prior layouts remain
rejected. No tables, including tables disguised as cards; grill stays intact.
Wants the new presentation for plans and end-of-work deliveries, while
preserving the HTML questionnaire workflow used in grill sessions. Owner
explicitly clarified this; it is not a requirement to copy report block geometry.
The broad conversational trigger and previous composition are superseded, not
approved. Scope clarification is complete; replacement composition remains open.
Current decision is recorded at the top of the existing private
visual-explain-20261015/brief.md; earlier plan/evidence remain historical.

Root: /Users/corrortiz/Documents/AO/development-system (canonical).
Branch: feat/visual-explain-t3. Updated develop at 3e1e8a9, then preserved
the two 2.4.2 dependency commits by fast-forward cherry-pick; current base
ad2da69b5f814c42d4893670e70532bc5ec56ae2. Previous task branch and untracked
.impeccable/, output/ and private/ remain intact.

User approved implementation on 2026-10-15 after cross-review of the plan.
The previous sequence required owner approval of private examples before
fixing their direction in the new visual-explain skill. Provisional integration:
new immutable 2.5.0/catalog 0.70.0; both hosts; existing report renderer preserved.
No skill, catalog, release or global installation changed yet.

Prototype: flow, comparison and staged plan in one self-contained T3 HTML.
First Sol browser pass observed all three views at 390/728, light/dark and
keyboard controls. It found unreadable selected tabs; parent corrected CSS
specificity. Opus critique also found misleading highlights, now neutralized.
Its image-budget hook limited critique to two captures; remaining views were
not independently critiqued. No guard bypass or silent model replacement.

Private plan, captures, review receipts and live process status:
~/.development-system/private/visual-explain-20261015/continuation.json.
Accepted plan: ~/.development-system/private/cross-review/
visuals-t3-20261015-df68c7eb/plan-r1.md.
Second and final correction pass passed: selected tabs 13.86:1 light / 12.33:1
dark, no horizontal overflow at both widths, corrected semantic highlights.
Exact HTML 8534801e3a98f27f8619c1b546ccd4031226aa9b0212bfd686b2a811f177d7ae
was previewed and rendered in the owning thread. Twelve corrected captures
and one real walkthrough are private; native touch, actual JS-off and reduced
motion emulation remain not reached. Owned server PID 71308 was stopped.
R2 preparation: Opus authored scope-plan-opus-r0.md; parent corrected authority,
historical status and preview requirements in scope-plan-r2.md. Fresh independent
Sol text review approved preparation (not UI). Questionnaire preservation is
explicit; no shared renderer/skill modifications. Three composition candidates
and decision-r2-payload.json were prepared privately before the authorized pass.
No composition is approved. Two prior browser passes remain consumed; another
requires the operator under the existing budget, not a reset for a new artifact.
Owner explicitly authorized the additional bounded browser pass: "Sí, verifica
y muestra las propuestas". Session 3 is complete on the private r2 decision
surface. It presents three native HTML compositions with plan and partial-close
examples, no tabs; preference marking is local and confirmed in chat. The same
three prepared option IDs are preserved. Parent adapted the decision surface
for durable T3 delivery with no POST/server dependency; no generated raster comps.
Early observation found CSS overriding hidden on the reset control; parent
corrected it and the same pending batch confirmed the initial/marked/reset
states. Current HTML hash afcd81b86a23a093be80e58c6dafcb5390fdf17b02010711d5af04b631b3e8e8.
Passed: A/B/C at 390/728 light/dark, disclosures and nested evidence, keyboard,
focus, local marking/reset, no horizontal overflow or POST/external requests.
Exact preview height 2538; shown inline at capped 2000 with vertical scrolling.
Independent Opus critique of two natural light captures requests corrections:
connectors, mobile arrow wrapping, C alignment and clearer local-mark wording.
Parent retained these for the selected direction and rejected outer margins
because T3 requires chat alignment. Expanded closes explicitly show pending
integration; they were browser-checked but not independently critiqued.
These are shown as open proposals, not final visual acceptance. Disposition,
receipt, 17 current captures and a 46-second recording remain private in r2/.
Durable report: ~/.development-system/private/documents/
tres-propuestas-para-planes-y-entregas-f2685ec962e915b4.html.
R2 is now rejected by the owner; no choice remains pending among A/B/C.
Next: reference-grounded design by Opus, then a new visual candidate before
integration and isolated validation. Parent-owned server PID85965 and
Impeccable PID78789 are stopped.
The third browser pass is consumed; no budget reset or new session was started.
Global install,
merge, release and publication remain separate authorization boundaries.

---

# Earlier — in-your-own-words review pause (2.4.2 installed)

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
