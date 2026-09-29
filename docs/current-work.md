# Current work — external skills refresh (2026-09-29)

Root /Users/corrortiz/Documents/AO/development-system; canonical checkout,
branch chore/external-skills-refresh-20260929 from develop adb00fb. The previous
docs/report-template-brief branch, .impeccable/ and private/ were preserved.

User request: update installed external skills (Impeccable, Matt Pocock and all
others). Local tooling update only; application production deploy is unnecessary.
No publication, push, release or production action is authorized by this task.

Candidate 1.38.0 / catalog 0.56.0; immutable external artifact refresh, preserve
AO-owned workflows and local adapters. Sources staged at exact upstream commits,
Matt d81f3a, Impeccable skill 4.3.1 / CLI 4.1.0 already latest; native engine 0.1.7
release asset SHA verified and engine-probe observed. Upstream removed
resolving-merge-conflicts and convex-performance-audit: retained last available.
Plan review corrections applied: active installs after candidate review/snapshots,
audit-skills separate from contract audit. No tests/evals created/run/restored.

Evidence/staging: /tmp/external-skills-refresh-20260929 (source inventory, exact
refs, merge notes, two disjoint candidate writers, Jev advice and parent decision).
Completed: artifact/provenance integration, four local gates, isolated setup and
healthy contract audit; skill hashes/mirrors/scanner health passed separately from
missing operational receipts. A native Codex invocation loaded two updated skills;
Impeccable engine 0.1.7 returned real detector findings on a local fixture.
Independent review found two Understand issues, corrected before installation:
legacy runtime directory compatibility and removal of automatic archive deletion.
Pending: narrow correction review, updated candidate isolated setup/audit, local
installation with backups and readback, native plugin update checks, HTML report. Existing unrelated work remains owned
by its prior thread. No background product processes started.

---

# Current work — Development System 1.37.0 delivery

Canonical root /Users/corrortiz/Documents/AO/development-system.
User explicitly authorized new version publication, HOME install and tooling
rollout to all six active repos; no benchmarks, evals or model exercises.

Released 2026-09-29: #128 develop, #129 main dd16ae359907cb80068ad5bd82f86883e6037d7f,
GitHub release/tag v1.37.0, catalog0.55.0. Exact downloaded tarball SHA256:
de02b2bbee235822c537b994e4eeb469f937ec5dee155f5fcc8220239cbd2761.
HOME setup from that source commit; audit, guardrails, Claude orchestration and
report gate healthy. Isolated source and packaged setups/audits passed, as did
typecheck, rostercheck, releaseprepare and check-no-tests. Live guard denied a
synthetic destructive command (never executed) and invalid role; denial message
names Sol6.1High. No agent exercise or Jev network classification was launched.

Requested: new session/former Astra roles gpt-6.1-sol/high, general writers
6.1/medium, Luna unchanged; keep selected parent. Independent plan/integrated
review passed. Rollout review found four stale AOHYS skill mirrors; corrected in
a22c72f and re-review confirmed all7 full trees/56files byte-identical.
Mistake roots recorded privately for executable modes and mirror destinations.

Rollout feature PRs: AOHYS#203, Eteria#289, Barber#363, Casa#147,
Opportunity#77, Nutri#509, all merged. Promotions AOHYS#204/Eteria#290 merged;
Barber#364 merged to main0a8719c after the exact Preview and promotion gate passed.
Production run36618975120 completed SUCCESS (all static gates, deploy and Release). Opportunity goes to
main directly (its old develop is obsolete). Casa/Nutri remain develop only:
promoting develop would also include unrelated receipt/full-app changes with
their own acceptance gates.
AOHYS/Eteria/Opportunity/Casa canonical checkouts advanced by safe fast-forward;
package1.37.0 installed with frozen lockfile/ignore-scripts. Barber onboarding
branch retains its five product commits: published tooling commit8a219ee was
cherry-picked locally as7210c0b (five tooling paths only); all other tracked blobs
are unchanged fromda71b473. Frozen ignore-scripts install, no-tests(0findings)
and installed roster13/13 passed. Do not push or deploy this owner branch.
The prior product evidence remains bound toda71b473; it does not certify7210c0b.
Nutri AOH-168 already pins1.37.0 at live readback; four dirty product files are
owned elsewhere and untouched. Earlier report-template
commits remain on docs/report-template-brief at096dbf2; private/ retained.

Evidence /tmp/ds1370; report private/reports/ds1370/report.html, rendered by
the installed document helper and read in the T3 browser. Temporary tunnel
expires 2026-09-29T21:19:06.803Z (HTTP 200 confirmed):
https://strengths-ltd-invest-champion.trycloudflare.com/f05f052967ebf12e8a4150c9a1e527ba/ds1370/report.html

CLI global default readback is gpt-6.1-sol/high. Comparing with the operator
backup confirms only the two requested assignments changed. The agent never
executed the write script or bypassed guard-config-write. CLAUDE.md links the
updated global AGENTS; installed codex-review policy and fallback both6.1/high.
HOME and Claude orchestration audits healthy; advisory status1.37/1.4 requests
Sol6.1High (no network). Six active checkout entrypoint/adapter instructions
have no Astra route; historical versions and explicit compatibility retained.
Barber promotion run36617501008 initially failed because exact
Preview36617492780 was active; no failed static gate. Preview then succeeded;
only the failed promotion job was rerun and passed, and #364 was merged.
Main Release Train36618975120 succeeded; pipeline/deployment evidence does
not replace product acceptance for separately owned feature branches.
No application process or automatic continuation is owned by this task. Report
reader temporary tunnel is the only remaining task process, with bounded expiry.
Published sanitized HTML report; canonical checkout returns to develop.
Independent final correction review approved7210c0b with no blockers. Current
installed roster has13Sol6.1/Luna candidates; advisory and Claude review
policy/fallback requestSol6.1High. No automatic Astra route remains in those
active surfaces; explicit operator selection and immutable history remain.
Bounded source audit found no automatic Astra candidate in catalog0.55 or
current roster. Remaining source references support explicit supplied profiles,
pricing, migration descriptions or disabled historical execution. A stale planner
comment was corrected to describe current roster-driven routing. No new model
exercise or eval. Sanitized report refreshed and browser readback passed.
This final documentation receipt records the completed model-selection scope;
return to develop after publication. Casa/Nutri product production remains under
their separate owner acceptance gates. Published1.37.0 remains immutable; no new runtime release is needed
for the confirmed readbacks or the local tooling cherry-pick.
The manual script private/operator/set-codex-default.py stays preserved; its
operator result was verified from the backup, without an agent write.

## Previous continuity (historical snapshot; verify before resume)

# Current work — Development System 1.36.1 and the 1.36.0 product rollout

1.36.0 released 2026-09-27 (#124, #125; main d769494; tag v1.36.0; prerelease
asset sha256 287b732c…2fabd0 verified) and installed in the real HOME (healthy;
steward orphan repaired, backup under
~/.development-system/private/backups/ds-1360-steward-orphan).

Rollout (branch chore/development-system-1.36.0 in each product): pins on
eteria, aohys.com (plus mirror refresh and byte-identical mirrors in
.prettierignore), the-barber-central, casa-roca and opportunity-os committed;
nutri-plan branch created through the git data API (9638cd2). pnpm installed
1.36.0 with the frozen lockfile in the five local repositories. The inline lock
format (casa-roca, the-barber-central, opportunity-os) needed a second pass
for `version:`.

Blocker found live: the 1.36.0 check-no-tests document scan used the strict
gardener list and read skill trees: 44 findings in five products, most of them
descriptions; aohys and casa-roca pre-push failed. Fix 1.36.1 (branch
fix/development-system-1.36.1 from develop d769494): product documents use only
directive patterns, skill trees are skipped, catalog 0.54.0 reused
(scripts/build-release-1361.mjs). Remaining findings are real directives in
historical records (aohys and the-barber-central research, casa-roca dated plan,
opportunity-os plan): listed per repository in config/no-tests-allow.json.
nutri-plan keeps 14 live findings for its rescue thread (it does not run
check-no-tests). Pins move to 1.36.1 before merging.

Astra ds-1361-diff round 1 (do not merge: README phrase tripped the scan,
direct runner commands escaped, builder lacked the strict gardener scan) fixed
in 71d0d4f: runner command patterns, gardener scan over manifest artifacts and
catalog skill directories, reworded contract and README. Checks at 71d0d4f:
builder check, typecheck, roster check, check-no-tests (DS and five products: 0),
isolated HOME healthy. Round 2 (3 closed or partly; new: shell fences, descriptive
command lines, catalog validation) fixed in 9fba84f. Round 3 closed all five and
raised three Medium fence edge cases (non-shell fences, delimiters with trailing
text, `pnpm exec pytest` list items); fixed with builder probes in the next
commit. No fourth round: no open Critical or High finding (round rule); those
three fixes are coordinator-verified only.
Product branches are fast-forward over their remotes (no force push needed).
Next: merge #126, promote, tag v1.36.1, prerelease, real HOME setup, re-pin with
/tmp/ds1360/rollout/pin-1361.mjs, PRs, Astra rollout review, merges/promotions.

# Previous — Development System 1.36.0 (pruned instructions, mistake log, verification scope, jevgrep, cleanup)

Approved 2026-09-27: "vamos a hacer los cambios pertinentes y vamos a llevar
todo a producción en todos los repos hasta donde se pueda ... Hay que hacer
todo". Origin: research thread 4c1d09c0 (Backpass, Matt /retro, Kent, Opus 5.5
guide, jevgrep) and two cross-reviews that agreed on five points. Root
/Users/corrortiz/Documents/AO/development-system, branch
feat/development-system-1.36.0 from develop cd04df7.

Plan /tmp/ds1360/plan.md (R1-R7, D1-D12, writers W1-W4) under Astra review
(Task-Id ds-1360-plan). Decisions: adopt jevgrep 0.4.0 with the prepaid
TypeSafe Jev and no measurement gate (user: build, then prune); Augment removed
(REPO_NOT_FOUND for AO-HyS, unused).

Operator steps done: jg 0.4.0 installed globally, `jg auth --provider
typesafe --stdin` from the existing credential file, `jg doctor` verified, a
live search returned the right guard lines in 5 s; auggie removed from
~/.claude.json with `claude mcp remove auggie -s user` (backup in
~/.development-system/private/backups/ds-1360-mcp). The Codex entry in
~/.codex/config.toml is guarded against agent writes: the user runs
`codex mcp remove auggie`. Claude memory duplicates of the global rules were
archived to ~/.development-system/private/memory-archive-20260927.

Status: plan reviewed by Astra (round 1: 3 High, 4 Medium folded in as F1-F7).
Writers done and checked: W1 roster guard jg allowlist + background holds + pruned
rule (5,895 -> 5,455 bytes), W1b cd-before-jg refusal, W2a `mistake add|list` +
steward repeatedMistakes, W2b doc-directive scan + vendored skip + identical-mirror
residue skip + AggregateError rollback, W2c verification-scope line in completion
reports + delivery recap. Coordinator: config/no-tests-allow.json for historical
records (docs/releases/, docs/spec.md, the 2026-07-28 benchmark) and "clear seams"
in docs/architecture-reference-pack.md. W3a global instructions, W3b skill
copies, W4 builder/catalog 0.54.0/manifest/ADR 0063, W5 `thread-health` done;
candidate c3f38df installed healthy in an isolated HOME.

Astra diff round 1 (ds-1360-diff, do not merge: 4 High, 4 Medium, 1 Low) fixed
in 5ad700c: jg cd/quoted-subcommand/expansion bypasses, thread-health no longer
prints raw commands or error text (and masks quoted guard input), last usage row
per message, verdict from unresolved failures, steward installs mistakes.mjs
(pre-1.36.0 state upgrades), Markdown-aware negation, three-clause scope line,
working-backwards 1.36.0 copy. Round 2 (3 open + 1 new Medium) fixed in
5b96352: canonical jg containment (symlinks), denials from fixed fields only,
per-transcript fingerprinted loops. Round 3: every High closed; 2 Medium
(whitespace-normalized fingerprint, progress text counted as final answer) fixed
in b055464 and probed; no round 4 (no open Critical/High), so those two fixes
are unreviewed by Astra. Gap: guard denials without `blockedBy` show as "other".

Held by the user (2026-09-27): no release until they answer on 8 generic
thread-quality rules taken from the NutriPlan rescue prompt (per-surface
integration, change strategy after 3 failures, non-blocking checkpoints, what is
not acceptance, no silent scope widening, notes are not proof, stop/termination
conditions, ledger + thread-health at checkpoints).

Real HOME finding: the weekly steward is orphaned (plist and logs, no state or
runner; MODULE_NOT_FOUND each run). Rollout: disable/clean the orphan, then
`development-steward-schedule-enable` with 1.36.0.

## Previous — Development System 1.35.0 and 1.35.1 (stable review rounds, advisory Jev, report sections)

Approved 2026-09-27: "Sí tú arranca 1.35. Haces todo lo necesario para que
llegue a producción en todos lados donde puede llegar a producción." Root
/Users/corrortiz/Documents/AO/development-system, branch
feat/development-system-1.35.0 from develop 8baffcd. Origin: NutriPlan rescue
threads 3068f403 and 52154067 (reworded objectives reset review rounds, failed
Codex runs counted, writers ran `git add -A`, a writer restructured code to
dodge React Doctor, reports were table-heavy).

Plan /tmp/ds1350/plan.md (D1-D11) reviewed by Astra (do not merge; 2 High,
6 Medium/Low, all folded in as settled decisions; no second plan round, the
integrated diff review checks them). Writers: W1 codex-review.mjs, W2 roster
guard/policy/writer agents/rule, W3 technical-documents and delivery recap.
Coordinator: builder 1350, skills copies under artifacts/1.35.0, catalog
0.53.0, manifest 1.35.0, ADR 0062, README, guard pins.

Astra round 1 (do not merge; 1 High, 2 Medium: non-atomic `--out`, tables
without a leading pipe, expiry logged more than once and stale overwrites)
fixed in 73b0f86. Round 2 (2 Medium: the lock helper ran without ownership on
timeout, single-column tables) fixed in 8e3c438 and observed live. Round 3
closed both and raised one new Medium: when the PostToolUse update times out on
the active-writer lock, a background writer's hold keeps `agentId: null` and
expires after 5 minutes as a foreground hold. Round cap: no open Critical or
High, so no round 4; this is a documented known gap for 1.35.1 (record the
background intent at registration and exempt unresolved background holds from
the foreground expiry). It needs a 2 s lock contention to happen.

Published 2026-09-27: #119 -> develop (86f8658), #120 develop -> main
(1225621, develop fast-forwarded), tag v1.35.0 and prerelease with
aohys-development-system-1.35.0.tgz (sha256 4dbf4f98…572f50; downloaded asset
matches). HOME setup 1.35.0 from 1225621: audit, guardrails, Claude
orchestration and report gate healthy; installed runtime equals the source.
audit-skills stays "invalid" only for missing live evidence (ADR 0003).

Rollout review (Task-Id ds-1350-rollout, the first live run of the 1.35
codex-review: complete round 1, verdict recorded in the receipt) passed the six
pins and found one Medium: orchestrate-work (1.33.0 copy) still prescribed the
Veredicto sections that 1.35.0 rejects. Fixed in 1.35.1 (branch
fix/development-system-1.35.1): orchestrate-work and working-backwards 1.35.1 copies (known issues as a list, no mandatory table) and a
catalog-wide gardener check (probe with the old copy fails the build). The pin
PRs (eteria #285, aohys.com #199, the-barber-central #350, opportunity-os #74,
casa-roca #145, nutri-plan #498) move to 1.35.1 before merging. casa-roca goes
to develop only: its develop carries #144 (receipt balance) that another thread
releases. aohys also refreshes its Devin mirrors; its foreign-product residue
in .agents/skills predates this work.

1.35.1 published 2026-09-27: Astra ds-1351-diff round 1 (Medium: mandatory
Known issues table; Low: narrow gardener scan) fixed; round 2 left only the Low
for `.sh` files, closed in 230832b by scanning every non-binary file (probe
build confirmed). #121 -> develop (c06b076), #122 -> main (53076ca), tag
v1.35.1 and prerelease (sha256 9d303644…aeaf522; downloaded asset matches).
HOME setup 1.35.1 from 53076ca: healthy; no installed skill names a retired
section.

Rollout round 2 (ds-1350-rollout, 1.35.1 pins plus aohys mirrors): verdict
merge, no new findings. Merged: eteria #285, aohys.com #199,
the-barber-central #350, casa-roca #145 (develop only), nutri-plan #498
(develop only, squash, through the git data API), opportunity-os #74 (main;
Pages deploys manually and the pin only changes tooling, site 200). Promotions
to main: eteria #286 (bc575a95) and aohys.com #200 (a7e146d0), Release Train
success, sites 200; the-barber-central #351 (e7f5cc73), Release success,
selective deploy skipped (tooling-only). Its first Release check failed because
the develop preview train had not finished; a rerun passed.

Status: done. 1.35.1 is released, installed in HOME and in production wherever
production applies. casa-roca and nutri-plan stay on develop until their own
threads release them.

## Previous — Development System 1.34.1 (no automated tests in any repository)

Goal: remove every remaining DS-owned instruction that asks for automated tests,
so repositories and HOME carry one rule set: no automated tests; real
verification (computer use, browser, the repository's verification CLI); reviews
on Astra XHigh through codex-review. Root
/Users/corrortiz/Documents/AO/development-system, branch
feat/development-system-1.34.1 from develop 9fa37ab. Status: released and
rolled out to the used repositories (see "Product rollout").

Done on the branch: builder 1341 (manifest 1.34.1 from 1.34.0, catalog 0.52.0
from 0.51.0); global instructions sentence; behavioral-evidence,
setup-ts-deep-modules, flow-implement, simplify-code and codebase-design copies
under artifacts/1.34.1/skills; repository adapter template and command
selection; anti-slop lane texts; setup keeps the skill-sync error when the
rollback throws; contract paragraph; README; Devin blueprints; implement-preview
example.
Astra round 1 (do not merge; 2 High, 2 Medium) fixed in 5e8abc3: the Codex
implementer and fast-implementer prompts, stack-quality-profiles
(real-verification oracle) and six more skills (setup-pre-commit,
resolving-merge-conflicts, triage, to-spec, improve-codebase-architecture,
agent-browser) move to 1.34.1 copies; migrate-to-shoehorn retired with cleanup;
Convex guardian and orchestration bundles ask for real verification; the
adapter follows pnpm/npm/yarn/bun/turbo indirection to test scripts; the
builder fails on any installed instruction that asks for tests. Isolated HOME
1.34.1 audits healthy, and 1.34.0 -> 1.34.1 removes migrate-to-shoehorn.
Scope decision (two-way): used repos are development-system, nutri-plan,
the-barber-central, opportunity-os, aohys, casa-roca and eteria; the dormant
repos stay untouched. Product branches chore/development-system-1.34.1 carry
the docs alignment (reviewed by Astra) and get the 1.34.1 pin after the
release; nutri-plan goes to develop only through plumbing (its checkout
belongs to another thread).
Astra round 2 (1 High, 3 Medium) fixed: the 1.30.0 orchestration contract
("Preserve existing test files") is replaced by a 1.34.1 copy with the
no-tests rule; the gardener checks each directive clause (negation only within
its clause) and catches `pnpm run test` and similar; the adapter follows every
turbo task and npm pre/post lifecycle scripts.
Astra round 3 (4 Medium) plus a High found on the isolated HOME (the Codex
reviewer, test_runner, backend-specialist and code-mapper prompts still asked
for or returned tests) fixed in 64a4595 and the adapter commit: 1.34.1 agent
copies, coding-orchestration and vercel-react-best-practices move to 1.34.1
copies, the gardener negation must sit directly before the action, and the
adapter reads package-qualified turbo tasks and unwraps npx/pnpx/bunx and
exec/dlx/x executors.
Astra round 4 (1 High, 1 Medium: to-tickets asked for tests in every slice;
working-backwards and the architecture reference pack planned test locality)
fixed in 1a0d279 together with a full audit of the 151 installed lines that
mention tests (32 fixed, 119 kept: prohibitions, manual or browser testing,
code literals, compatibility keys).
Astra round 5 (3 Medium: the Codex qa-planner planned unit/integration checks,
measure-development-run inspected test evidence, the anti-slop module-mocking
rule described test implementations) fixed in a follow-up commit and verified
with the builder, the checks, isolated HOME home8 and a grep. Round-limit
decision (two-way): no sixth Astra round, because a sixth round needs an open
Critical or High and round 5 found only Medium.
Merged: PR #114 (develop) and #115 (main, d2ec15b); v1.34.1 prerelease.
HOME rollout found a release bug: src/guardrails.mjs pinned guard catalog
0.51.0 while catalog 0.52.0 moved global-agent-guardrails, so guardrails-audit
rejected the installed guard. Fixed (pin 0.52.0; the builder now asserts the
pin follows the release catalog); guardrails-audit healthy on HOME and the live
guard still blocks `rm -rf`. HOME setup needs `--source-commit` while the
untracked private/ directory keeps the checkout dirty.
Decision (two-way): the v1.34.1 prerelease asset is re-uploaded with the fix,
because no repository had pinned it yet. The fix merged as PR #116 (develop
ee82966) and #117 (main 26924d3); the v1.34.1 tag and prerelease were recreated
at 26924d3, and HOME was set up again from it.

Product rollout (2026-09-27, "Actualiza todos los repos con la nueva versión";
branch chore/development-system-1.34.1 in each repository, pin 1.34.1 with
recorded tarball integrity, adapter normalized, live docs aligned; each PR
reviewed by Astra XHigh until no blocking finding, and round-3 Medium
findings fixed and verified directly, without a fourth round):
- opportunity-os #73 -> main (4136dc25): `.venv-cv/` ignored so
  check-no-tests stops scanning vendored pip tests; Quality run success;
  production (Cloudflare Pages) 200.
- aohys.com #197 -> develop, #198 -> main (83eb4e9); production Release Train
  success; aohys.com and /es return 200.
- casa-roca #142 -> develop, #143 -> main (06b7d72); Production Path success.
  The Vercel Git integration created no deployment for #143 (nor for #141);
  the last production deploys are a 2026-09-24 CLI deploy (dashboard) and
  #121 (public). The promotion changes no runtime code, so production behavior
  is unchanged; production 200.
- eteria #283 -> develop (static-markup smoke suites removed; changed
  validation skips deleted files in the impeccable scan), #284 -> main
  (6cd0397d); production Release Train 36284414166 success (Deploy
  Cloudflare Pages, Smoke release URL); momentos-eteria.com 200. The www
  host has no DNS record (pre-existing).
- the-barber-central #348 -> develop, #349 -> main (f6d081f7); production
  Release Train 36284450742 success (Verify, Preflight attestation,
  Selective deploy, Release); landing, dashboard and admin workers 200.
- nutri-plan #497 -> develop only (squash 9f6c5dee; git data API, the
  checkout belongs to another thread): the removed
  `findTestPolicyViolations` consumers are dropped, and `verify:product` becomes the Feature Map check alone, so
  `quality:changed` and the Husky pre-push stop running tests; staged quality
  (pre-commit) no longer runs `test:unit:email`; the scorecard guide marks
  `quality:scorecard` unavailable; plan decisions D-0003 and D-0004 are
  superseded. Astra rounds 1-3 (1 High, 5 Medium) fixed; the round-3 Mediums
  were fixed and verified directly (head 510461e), without a fourth round.
  Main and production wait for the redesign.
  Unresolved policy violation: develop still holds 835 automated test files
  and the scripts that run them (`test:unit*`, `quality:certify*`,
  `verify:full:*`, `verify:ci`, the scorecard). The no-tests rule requires
  their removal. They were not deleted here because the redesign thread owns
  the checkout and its branch removes them; if that branch does not land,
  the cleanup still has to happen on develop.
Dormant repositories stay untouched.

Next-version candidates: check-no-tests flags live doc instructions that run
or require tests and static-markup "smoke" suites (reviews found stray test
instructions round after round); check-no-tests skips vendored site-packages;
normalize skips catalog-identical mirror files (aohys foreign-product-residue);
setup reports the original skill-sync error.

## Previous — Development System 1.34.0 (Astra reviews and computer use through codex-review)

Approved 2026-09-26: "hagamos la nueva versión: lleva lo de NutriPlan a
Developer System y a de Barber Central" plus Astra as the computer-use default.
Smoke tests only need launch, wait and wake. Root
/Users/corrortiz/Documents/AO/development-system, branch
feat/development-system-1.34.0 from develop 330c76f, PR #111.

Done: codex-review.mjs (codex exec gpt-6-astra/xhigh read-only, background
launch with no polling, receipts with observed model and effort from the Codex
session log, 5 parallel reviews, 1 computer-use run, `Round rationale:` from
round 4, `--computer-use`); Fable roles retired; reviewer, reviewer-medium,
visual-reviewer and browser-qa need `Codex fallback:` and skip Jev; the Stop
gate waits while a Codex run is pending; rule to split halted packets; builder
1340 (89 artifacts, catalog 0.51.0). Live: review 1 (168 s; 1 High, 4 Medium;
4 fixed in 99712ad, reservation race documented in ADR 0061), review 2 (184 s;
1 Medium, only ESRCH marks a finished run, fixed in cbcdbfc), computer-use
smoke (45 s, CUA initialized and woke the coordinator; no screenshot because
Computer Use refuses the Codex app itself). Checks: release:prepare,
typecheck, roster:check, check-no-tests.
Round 3 (50 s): no findings, merge.
Published 2026-09-26: #111 -> develop (bd611d4), #112 develop -> main
(1ffb3b3, develop fast-forwarded), tag v1.34.0, prerelease "v1.34.0 development
prerelease" with aohys-development-system-1.34.0.tgz (downloaded asset
sha512-OGV/Fx…maQ==, identical to the local pack). HOME: setup 1.34.0 needs
`--source-commit` while `private/` is untracked (otherwise skill sync fails and
the rollback error "Cannot rollback while a feature activation exists" hides
the cause); audit, guardrails, orchestration and report gate healthy;
installed codex-review.mjs equals the source. Products (Astra pin review, 31 s:
merge): the-barber-central #346 -> develop (2c94553c), #347 -> main (30a27e8e;
the PR Release job raced the develop Release Train and passed on rerun),
production Release Train 36262850381 success; nutri-plan #496 squash-merged to
develop (9201f7af, plumbing commit through the git data API, Release Train
success); main waits for the redesign.
Next: nutri-plan main with the redesign; a real Astra computer-use task on a
product dashboard; setup should report the original skill-sync error.
Unverified: a real computer-use UI action, SIGKILL escalation on a live Codex
run, the reservation race.

## Previous — Development System 1.33.0 (less friction, real verification, reports that launch)

Status 2026-09-26: v1.33.0 published (prerelease from main) and rolled out to
HOME; the-barber-central and nutri-plan pins follow (see "Published" below).
Approved 2026-09-25 ("hazlo de golpe … llévalo a producción" for
development-system, the-barber-central and nutri-plan; other repos optional).
Done (uncommitted, checks passed): P2 check-no-tests + 102 test files removed;
P4 roster Sonnet low/no Haiku + run-report $15.51; P5 contract text + AGENTS.md.
Interrupted by the session limit (2026-09-25 22:50) and resumed 2026-09-26.
Done 2026-09-26 (uncommitted): P1/P1b quote-aware guard 2.0.0 (replay 328
entries, 0 mismatches); P3 report gate (Codex + Claude Stop) + CLI entry
(`document` works from src/cli.mjs); P6 reader (table fold, Preguntar) +
questionnaire on the reader frame; P7 builder 1330 (`--check` ok, 88 artifacts,
catalog 0.51.0 with 103 skills, tdd removed); typecheck, validate-repository
and check-no-tests pass. Browser QA: mobile pr-lens maps too wide at 390px, one
h2 without ask button. V1: 7 Major reader findings, fix slice running.
P8 (/tmp/verify1330.py, isolated /tmp/ds1330): 43/46; the 3 failures were
rollback bugs, fixed in src/guardrails.mjs (Codex rollback removes only the
managed entry) and src/core.mjs (no-op advisory transition no longer blocks
`rollback`); rerun pending after the reader rebuild. Headless Claude needs the
real HOME (auth) and Codex is out of quota until 2026-09-29, so both move to the
live observation after the HOME rollout. Codex asks to re-trust changed hooks
(hooks.state trusted_hash in ~/.codex/config.toml). P8 rerun after the reader
fix: 45/46, the last one a harness artifact (1.32.0 CLI audit healthy).
R1 guard security review: 1 Critical, 8 High, 6 Medium, 2 Low (14 regressions
vs 1.31.0; findings in /tmp/r1-1330/findings.md). G1 fix slice running (all
fixed, hook ends with `|| exit 2`), then a fresh guard re-review. V2: all
V1 Majors fixed (Minors deferred to 1.34: mobile map label size, questionnaire
h1 rule width, fold button colors). R2: B1 pycache in catalog hash, M1-M4,
N1-N6; W2 fixed B1/M1-M3/N1-N6 (13 skills re-pointed, upstream implement,
diagnosing-bugs, ask-matt, codebase-design + implement-spec,
drive-development-flow, impeccable copies without test promises; stop gate
counts delegated `Owned paths:` writers; rollback refuses while report-gate or
claude-orchestration is active). M4 done (guardrails re-enable keeps prior
`before` only when current == prior installed, else current minus the managed
entry) and the managed hook ends with `|| exit 2`; observed in an isolated HOME
(/tmp/m4-observe.mjs: later hooks survive rollback, missing engine exits 2).
G1 stopped partway (safety classifier); split into G2a and G2b. G2a done: C1,
H1-H7, M6 (3 s clock, 64 KB, 512 stages, ruleId guard-timeout); 50/50 part-A
probes blocked through gated runners (/tmp/g2-1330), 18 twins allowed, replay 0
mismatches, typecheck ok. G2b halted (safety classifier on dense guard
packets), so the coordinator did the rest directly: M1 (rule
shell-arithmetic-injection), M3 (abbreviated git long options), M4 (git config
that makes commands destructive), M5 (guard-config-write writers, project
.claude/.codex settings, cd/pushd/popd tracking, unknown-directory tails), H8
(interpreter string literals scanned as shell), L1/L2, saved aliases and hash.
cw4 (array `cmd`) is inspected as argv; nested or mixed arrays fail closed.
Verdict-only checks in /tmp/g2-1330 (git-alias, arith, write, interp, array,
twins, extra) report 0 unexpected; gated runners: every probe blocked, no
effect; perf ~30 ms on 360 KB. Private corpus rebuilt from the recorded probes
(PROBE_RECORD): 631 entries, replay 0 mismatches. Builder --write/--check,
roster:check, check-no-tests and typecheck pass. Fresh guard security
re-review (reviewer, Opus high) found B1-B4, S1-S3 and M-a; all fixed by the
coordinator 2026-09-26: runner arguments scanned at command positions, chmod
on ancestors, glob targets (linear matcher, brace/extglob/zsh groups and
qualifiers, dotglob), cd tracking (conditional, background, branch, pipeline,
missing directory, CDPATH, env -C, sudo -D), interpreter programs from stdin
(`node -`, `awk -f -`, here-strings), code fragments and lone shell strings
with a process API, project .git/config protected, editors (ex/vim/ed) as
writers, and `$(cat <<'EOF' … EOF)` read as literal text (commit messages
pass). Accepted: .vscode/settings.json (M-b/M-c). Probe files (review p1-p3,
p3s, rounds 3-5, 194 probes): every attack blocked, every ordinary command
allowed. Corpus 816 entries (399 allow, 417 block), replay 0 mismatches;
perf ≤55 ms on 60 KB inputs; gated runners block everything with no effect;
builder --check, typecheck, roster:check, check-no-tests and
/tmp/verify1330.py 46/46 pass. PR #108 (develop) review found M1 (`[^x]`
glob bypass), M2 (words such as "enable" or "hash … cat" in commit heredoc
text made it dynamic) and M3 (quadratic bracket/brace scan, 17 s); fixed on
the branch: bracket expressions kept in the broad glob, `cat` redefinition
detected from parsed commands (function, alias, hash, enable, PATH), linear
bracket/brace/group precomputation (≤48 ms at 60,000 characters). Minors:
editors also write -w/-W logs and `:w`/`:sav` files from -c/--cmd/+cmd
scripts and `:!` runs as shell; no-tests config kinds come from
TEST_CONFIG_PATTERN_SOURCES; SKILL.md budget, cat and rollback wording; ADR
0060 notes the 2-space Codex rollback rewrite. Round 6 (28 probes) as
expected; corpus 844 (407 allow, 437 block), replay 0 mismatches; builder
--check, typecheck, roster:check, check-no-tests, verify1330.py 46/46 pass.
Re-review of 1530018 ("do not merge"): the `#` level loss after a group with
`/` and the new `cat` wrapper bypasses (`command -p hash`, `noglob`, `trap`,
zsh `function a cat`, `functions[cat]=`, `getopts o PATH`, `set -A path`)
were regressions; quoted glob closers, editor spellings (`-cw`, `w!~`,
`++enc`, `exe "w …"`, `%!`, `writefile()`, ed heredocs, piped input) and the
`export X="$(date)"`/`printf '%s' "$x"` false positive were open. Fixed on the
branch: repeated slash groups read as kept or absent (first four), quoted or
escaped pattern characters read broadly, `changesCat` skips precommands and
checks trap actions, name-taking builtins and zsh tables, editor scripts from
heredocs are read, explicit TEST_CONFIG_PATTERN_SOURCES. Round 7 (72 probes):
the committed engine allowed 50 attacks and blocked 3 ordinary commands; now
all as expected, earlier 222 review probes unchanged. Corpus 916 (428 allow,
488 block), replay 0 mismatches; ≤118 ms on 60 KB inputs; builder --check,
typecheck, roster:check, check-no-tests, verify1330.py 46/46 pass.
Third review of 0befc84 (do not merge): a fifth repeated slash group was
allowed (regression), editor writes after an address (`%w`, `1,$w`, `.w`, ed
`W`/`f`) and `BASH_CMDS`/nameref/option-cluster PATH changes passed, and
substitution or typed editor text and fully quoted `(…)` names were false
positives. Fixed on the branch: the fifth group onward reads as any path, an
editor scanner (addresses, `:g`, `:s` and typed text as data, all
abbreviations, `drop`/`args`/`redir`/`mksession`/`hardcopy`, `:cd`, `%`/`#`,
backticks, program options, `:source`/`:make`/`:grep`, visual-editor stdin
keys blocked), `autoload`/`functions -c`, `${PATH:=…}` and arithmetic PATH,
and an `opener` flag so quoted pattern characters stay broad while fully quoted
names are literal. Round 8 (117 probes) against 0befc84: 49 attacks now
blocked, 7 false positives now allowed, 61 unchanged; the 293 earlier probes
are unchanged. Corpus 916 with 0 mismatches; ≤78 ms on 60 KB editor inputs;
builder --check, typecheck, roster:check, check-no-tests, verify1330.py 46/46.
Fourth review of ddc8eaa (do not merge): typed text after `a`/`i`/`c` hid the
next lines inside `:g`, after an address the editor rejects, `nomodifiable` or
`:if 0` (observed with real vim 9.1 and macOS ed: vim runs them as commands, ed
exits at the first error except inside `g`). Also `+cmd` with escaped spaces,
`*`/`\/`/mid-line addresses, and `$[…]`/subscript/`[[` arithmetic PATH. Fixed:
typed text is data only in ed outside `g`/`G`; each `|` command gets its own
address; arithmetic checks assignment (so `${#path}` and `set inde=` allow).
Round 9 (51 probes) vs ddc8eaa: 27 attacks now blocked, 3 FPs now allowed;
earlier rounds unchanged except w6 (vim append text, now a documented FP).
Corpus 916 0 mismatches; ≤84 ms; builder, typecheck, roster, check-no-tests,
verify1330.py 46/46.
Fifth review of cd5282f (do not merge): the `+cmd` body was skipped (`e +w!\
FILE x`), assignment-only arithmetic missed quoted, `$(…)`, `${n:-PATH}`,
backtick, nested-subscript and continued names, `shcf`/`shq` and a cleared
`shellcmdflag` were allowed, marks `'(`/`'{` and a bare `e + FILE` hid files.
Fixed: `+cmd` bodies are read as editor commands; arithmetic counts when it
assigns and names PATH or holds `$`, a quote, backtick or backslash (numbers
from `${#x}`/`$#` excepted), also in variable values; `$[…]` is checked where
the parser reads it, so a commit message mentioning it passes; `${o:+--$o}`
passes (only subscripts and offsets are arithmetic); program options block even
when cleared. Round 10 (73 probes) vs cd5282f: 34 now blocked (33 attacks and
the conservative `(( n = $x ))`), 6 FPs now allowed; all earlier rounds unchanged. Corpus 916 0 mismatches; ≤131 ms
(linear) on 45–60 KB inputs; builder, typecheck, roster, check-no-tests,
verify1330.py 46/46.
Sixth review of 55a2867 (do not merge): a `+cmd` with no file after it was
never read (`e +w\ FILE`), a named value blocked on any PATH word
(`NODE_OPTIONS=--require=./path/x.js`), and escaped spaces started editor
matches (859 ms at 50 KB). Fixed: the last `+cmd` may end the command and the
file is optional; a variable value counts only when it assigns or steps a PATH
name; an escaped space does not start a command. `$` arithmetic next to a commit
heredoc (`for ((i=0; i<$n; i++))`) stays a documented false positive. Round 11
(56 probes) vs 55a2867: 9 attacks now blocked, 3 FPs now allowed; all earlier
rounds unchanged. Corpus 916 0 mismatches; ≤147 ms (linear) on 45–60 KB inputs;
builder, typecheck, roster, check-no-tests, verify1330.py 46/46.
Seventh review of 91f9ab7 (do not merge): the escaped-space rule hid commands
that vim unescapes (`exe "sil\ w FILE"`, `exe "…\|w FILE"`, `cpo+=b` maps), and
a literal array element was never read (`a=('PATH=5')`). Fixed: editorFiles also
reads the unescaped text; array elements get the named value check. Round 12 (42
probes) vs 91f9ab7: exactly those 8 now blocked; all earlier rounds unchanged.
Corpus 916 0 mismatches; ≤185 ms (linear); builder, typecheck, roster,
check-no-tests, verify1330.py 46/46.
Eighth review of 23dab52 (do not merge): both readings of a nested `+cmd`
recurse, so 13 levels took 5.7 s. Fixed: `+cmd` nesting is bounded by
maxSubstitutionDepth (`shell-nesting-depth`), a body is read once per line, and
editorScript checks the deadline per line. Nested shapes now block in ~31 ms.
Round 13 (33 probes) vs 23dab52: only nest5/nest8 changed (now blocked); all
earlier rounds unchanged. Corpus 916 0 mismatches; ≤119 ms; builder, typecheck,
roster, check-no-tests, verify1330.py 46/46.
Ninth review of 444166e: merge. PR #108 merged to develop (1acfd3a).
HOME rollout from develop (backup first): setup, guardrails, orchestration and
report gate audits healthy; installed engine = repository bytes, corpus replay
0 mismatches; 0 Haiku agents; installed run-report.py gives $15.51 on 4b29b8ea
(nutri-plan project). `audit-skills 0.51.0` stays "invalid" only for missing
live evidence (bound to the old catalog and commit; ADR 0003); structure is
healthy (139 identical mirrors, no broken links). The live probe
(scripts/probe-harness-skills.mjs) needs Codex, out of quota until 2026-09-29.
Codex will ask to re-trust the changed hooks (user action).
Published 2026-09-26: #109 develop -> main (52370ee, develop fast-forwarded),
tag v1.33.0, prerelease "v1.33.0 development prerelease" with
aohys-development-system-1.33.0.tgz (downloaded asset sha512-I7NHGyMh…BqBw==,
identical to the local pack).
Products (independent review: merge, 5 minors): the-barber-central #344 ->
develop (c2b4262f; pin, feature map in config, check-no-tests in
lint:architecture; the feature-map commit cba2a6f4 was made with --no-verify by
mistake, full-tree checks cover it) and #345 -> main (c1183234, also carries
#343 and #342 WhatsApp template provisioning); production Release Train
36246201994 success (Convex production functions, production workers, provider
and production URL smoke, final attestation). nutri-plan #495 squash-merged to
develop (bae3d3ff, Release Train success; branch created through the git data
API with the local plumbing tree d913e81, as for #494); develop still has 842
test files, which the redesign branch deletes; main waits for the redesign.
Barber follow-ups (minor): require the six core feature IDs again
(scripts/verification/lib.mjs), `qa` only lists selected features, stale
`.factory` mutationScope entry, lockfile tarball without integrity.
Next: eteria and casa-roca pins (optional), live skill probe when Codex quota
returns, 1.34.0.
Barber writer done: 24 features in config/product-verification-feature-map.json,
validate-skill/check-route-inventory/check-repo-rules pass, `plan --list` added. Next: guard re-review,
develop, HOME rollout, main + v1.33.0 prerelease, product rollout. Barber #343
and #342 are merged to develop (tests already removed there); barber branch
chore/development-system-1.33.0 (from 79242129) moves the Feature Map to
config/product-verification-feature-map.json and expands it (writer running),
pin 1.33.0 after the release. nutri-plan: the local redesign branch
codex/aoh-168-composite-attestation already deletes 845 test paths and the
vitest scripts, so no separate test-removal PR; develop only gets the 1.33.0
pin PR (like #494), built without touching that checkout.
Root /Users/corrortiz/Documents/AO/development-system, branch
feat/development-system-1.33.0 from develop 2192eb4. Plan document:
~/.development-system/private/documents/plan-1-33-0-repos-sin-tests-y-1-34-0-49aac13c26523d94.{md,html}.

This thread owns Development System releases; the nutri-plan thread only does
its private phase-0 prompt (finding A). Settled user decisions (2026-09-25): no
automated tests anywhere (delete and block them); real verification (computer
use, browser, verification CLI) is always part of the task; executable
`Done when:`; optional `Outcome:`; autonomous develop merges after real
verification plus review; no evals; no Haiku anywhere (Explore, code-mapper,
docs-researcher, mechanical-worker move to Sonnet without thinking, mechanical
work only); one-way/two-way stays a single S5 line (reversible: agent decides and
records; data, production, money, customers: stop and ask). Plan v2 document:
plan-1-33-0-repos-sin-tests-y-1-34-0-4bcf53d31d6f56a4.

Slices for 1.33.0 (disjoint owned paths):
- S1 Bash guard: quote-aware, allow harmless redirections/`$?`, block writing
  test files (reuse src/test-change-policy.mjs); security review required.
- S2 Roster: drop the Haiku tier, Sonnet (lowest effort, no thinking if a
  per-role setting exists) for the four mechanical roles, stricter code-mapper,
  Jev planner examples, ~/.claude/rules/orchestration.md.
- S3 run-report.py: last-chunk usage, session by project dir ($15.51 on 4b29b8ea).
- S4 Report launch: closing step in orchestrate-work/coding-orchestration plus
  a once-only Stop hook; concise packet with a gardener line.
- S5 Contract/global instructions (no tests, real verification, gardener ladder).
- S6 Delete this repo's automated tests; verify = roster:check + typecheck +
  validate:repository + builder --check; keep the isolated install scenario.

Next: product repos (eteria, casa-roca, the-barber-central with feature map and
verification CLI; nutri-plan after its redesign), then 1.34.0 (readable report
template: fewer tables, diagrams, visible Preguntar, same reader for grill).

Observed on the way: `node src/cli.mjs document` exits silently; use
bin/development-system. The Bash guard blocked `$?` and `2>/dev/null` reads in
this session (evidence for S1).

## Previous — Claude Code orchestration roster (Development System 1.32.0)

Status 2026-09-25: 1.32.0 is on main, released and installed; product repository
adoption and promotion are tracked in "Release 1.32.0" below; the sections
before it are history.

## Objective — 2026-09-24

Give Claude Code (Opus 5.5, including T3's Claude provider) parity with the
Codex setup using links, not second copies: same personal rules and skills,
destructive-command guard, optional Headroom transport, one-to-one plugins/MCP
servers, minimal added context. User direction: do not author, update or run
tests; deferred: Claude subagent roster and cross-CLI computer use via Codex.

## Root and branch

Canonical root /Users/corrortiz/Documents/AO/development-system, branch
feat/claude-code-parity-1.31.0, stacked on feat/headroom-observed-delivery-1.30.0
(v1.30.1 is installed and pushed but not in develop or main). No worktree/clone.

## Completed

- Release 1.31.0 / catalog 0.50.0 (ADR 0058), unpublished: Claude skill variants
  install as relative links to the canonical copies; the shared
  ~/.codex/AGENTS.md gains a short "Claude Code host" section; guard accepts
  `--harness claude` and guards Bash|Monitor from the canonical engine;
  runtime/headroom/claude.mjs sits next to cli.mjs. Independent review findings
  were corrected. Builder check and typecheck pass.
- Operator HOME: 1.31.0 installed and healthy (an earlier 1.31.0 layout was
  rolled back to 1.30.1 with its installing commit's code, then reinstalled).
  ~/.claude/CLAUDE.md -> ../.codex/AGENTS.md (Claude confirmed it loads).
  Guardrails healthy for Codex and Claude; the guard blocks real Claude calls.
  Codex config.toml, 18 role TOMLs and hooks.json unchanged; AGENTS.md changed
  only by the appended Claude section.
- Operator configuration: plugins github, vercel, sentry, cloudflare, stripe,
  expo, convex, linear, exa; MCPs mobbin, expect, posthog, mercadopago
  (Codex had those two as MCP only); instructionFiles =
  claude-md-and-agents-md; impeccable hook repaired; 14 non-catalog skills
  linked; dangling links and superseded files kept under private backup.
  Context: 281 skills, 21 MCP servers (was 449 skills with posthog plugin).
- Headroom: private T3 shim runs Claude through the installed launcher
  (stream-json, 2 proxied requests per call); management subcommands skip the
  proxy; another base URL is refused.
- Read-only audit of all product repositories' agent instructions (results
  reported to the user; no repository changed).

## Publication and rollout — 2026-09-24 (complete)

- Published development prerelease v1.31.0 (tag on e694986, asset sha256
  c8ae8448…7e9b). Operator HOME reinstalled from the downloaded package.
- Production (user-authorized): eteria #279 -> develop, #280 -> main, Release
  Train deployed production (6fe465a). the-barber-central #338 -> develop
  (includes the local typecheck fix: wrangler types ignore dotenv), #339 ->
  main, Release Train deployed production (e60a7011). casa-roca #138 ->
  develop, #139 -> main (6f6c089); the dashboard Vercel project has no Git link
  (Hobby plan cannot connect the private org repo), so production was deployed
  with the Vercel CLI from a clean export of 6f6c089; Ready and aliased,
  /sign-in 200. casa-roca-public was unaffected by this release.
- nutri-plan #493 squash-merged to develop (4e12c96a) from a user-authorized
  temporary worktree, now removed; the active T3 task's checkout is untouched.
  Not promoted to production. aohys left for later.
- normalize-repository was not used: its template regresses the 2026-09-23
  manual guidance alignment. casa-roca's VS Code auto-migration diff is kept
  privately (preserved/casa-roca-vscode-settings.patch).

## Claude cost diagnosis — 2026-09-25

The nutri-plan redesign thread (T3 49431ab0, Claude session 739beec0) read
~357M cached tokens: 377 full-size image Reads that stay in context, 21
Opus general-purpose agents (up to 17 concurrent, depth 2) and a main thread
that grew to ~490K without compaction. Jev, skills and Codex were not used.
User-authorized operator changes (originals kept in
private/releases/1.31.0-claude/preserved/20260925-claude-cost/):
- T3 `claudeAgent` binaryPath -> the private Headroom shim, for every project.
  Observed: a new Claude session has a loopback ANTHROPIC_BASE_URL and a live
  claude.mjs process. No savings claim.
- ~/.claude/settings.json env: CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4 (as
  Codex max_threads), CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1.
- Operator Claude roster (Codex-equivalent, not yet a release): 14 roles in
  ~/.claude/agents generated by private/claude-orchestration/make-roster.py.
  User mapping (2026-09-25), no Sonnet:
  - Haiku: Explore (override, since the built-in now inherits Opus),
    code-mapper, docs-researcher, mechanical-worker.
  - Opus, low effort: exact-implementer, implementer, browser-qa.
  - Opus, high effort: ui-implementer (user correction), planner,
    senior-implementer, reviewer, visual-reviewer.
  - Fable 5.1, high effort: plan-reviewer (overall plan and final result) and
    security-reviewer.
  - Coordinator: Opus 5.5 medium.

  Observed in a headless session: plan-reviewer resolved to claude-fable-5-1
  with effort high. That session had ui-implementer at Opus low; it is now
  high (policy 2026-09-25.4).
  ~/.claude/rules/orchestration.md holds the routing table.
- Guard hook private/claude-orchestration/roster-guard.mjs (PreToolUse
  Agent|Read|screenshot, PostToolUse Agent). It refuses non-roster or
  inherit-Opus agents and model overrides, and requires Owned paths/Done when
  in writer packets. Jev classifies writer/planner dispatches (a strong
  mismatch is refused once unless the packet has "Route rationale:"). Image
  budgets: coordinator 2, ui/senior-implementer 5, visual-reviewer 12. Plugin
  agents need model opus or haiku. Ledger with the
  model each agent ran on: private/runs/claude-orchestration/ledger.jsonl.
  Observed in a real headless session: general-purpose refused; code-mapper
  ran on claude-haiku-4-5-20251001.
- Jev integration fixed. Before, the guard sent Jev only the objective, so
  context_sufficient came back ~0.11 and confidence ~0.35. Now it sends
  exactContext, readSet/writeSet, riskSignals and the active writers, and it
  records the chosen route (record-route-decision). Confidence is now
  0.88-0.99. A writer packet with an open decision above 0.75 is refused.
  One writer per surface: a writer whose owned paths overlap an active writer
  is refused. SubagentStop is added to ~/.claude/settings.json and releases
  it (backup in preserved/). Observed in a live headless e2e (/tmp/guard-e2e):
  B was refused while A ran and allowed afterward; active-writers ended empty.
- private/claude-orchestration/run-report.py <session> prints tokens and
  estimated cost per agent, guard decisions and Jev lines. The costs are
  estimates, not billing.
- nutri-plan verification:
  - compare.mjs is retired (retired/).
  - ticket.mjs offers show/probe/shots/next/slices/mark/param over 146
    tickets, each with one mock. `slices` groups them into 77 slices of at
    most 4 tickets across 63 groups of shared files.
  - The continue-prompt has a phase 0 to get the app compiling again, then
    review-first slices, with Fable for the plan, security and final reviews.
  - Observed 2026-09-25 after the develop merge (2276b59b):
    `pnpm typecheck:focused` shows 195 errors in 69 files. Causes: the
    canonical RBAC (#474) removed PERMISSIONS and hasPermission;
    expectedUpdatedAt is now required; imports were lost in the merge.
  - Git identity fixed at the user's request: the local Test override was
    removed from nutri-plan, and the WIP and merge commits were re-authored
    with commit-tree as Alejandro Ortiz Corro, keeping dates and messages.
    HEAD is now 8ca2d5ad (WIP 0bf74cc4). The working tree was untouched: 52
    dirty entries. Test-authored commits on other nutri-plan branches (some
    pushed) were not rewritten; that is pending the user's decision.
  - phase0-prompt.md: phase 0 only, with checkpoint A (plan + Fable verdict
    + run-report + system notes) before any writer.

## Jev tier selection and release 1.32.0 — 2026-09-25

Branch feat/claude-orchestration-1.32.0 (from the 1.31.0 state). User direction:
Jev must never stall work, Fable only for very large specs (Codex/Astra
unavailable), and Jev, not hardcoding, decides model and effort per task, with
Opus low/medium/high, learning from outcomes.
- Anti-stall (private guard, policy 2026-09-25.8): a packet (by Objective line)
  is refused at most once for any reason; route refusals only for writers;
  3 refusals per session, then advice only; Jev failure proceeds; a writer
  hold expires after 5 min foreground without an agent id or 30 min idle
  transcript (max 2 h); CLAUDE_ROSTER_GUARD=off. Fixed: descriptions with
  spaces made every Jev classification fail (unsafe active-atom ids).
- Tier: roles carry family and tier (haiku, opus_low, opus_medium, opus_high,
  fable). New roles implementer-medium, planner-medium, reviewer-medium (17
  agents). For implement/plan/review the guard asks Jev a tier question
  directly (the runtime's questions are fixed) in parallel with route
  classification, and refuses once pointing at the role at Jev's tier. Fable
  roles run when Jev picks fable or gives p >= 0.4, else need a
  "Fable scope:" line.
- Memory: tier-memory.jsonl in the ledger directory; a dispatch repeated
  later in the session at a higher tier for a similar objective counts as
  escalated; Jev receives per-tier stats and up to 6 similar past packets.
- Observed in isolation (/tmp/guardcheck7.py, own stateDir): typo -> haiku
  (senior-implementer refused, retry proceeds); small diff review ->
  opus_medium; small plan to plan-reviewer refused; 146-ticket final review ->
  fable 0.9 (allowed; reviewer-medium refused toward Fable); after an
  escalation opus_low -> opus_high, a similar packet in a new session got
  opus_high. Latency 0.4-0.8 s. Anti-stall suite (/tmp/guardcheck5.py) still
  behaves as designed.

## Release 1.32.0 — 2026-09-25 (published and rolled out)

- PR #105 merged 1.30.x–1.32.0 into main (2c8808c); develop fast-forwarded to
  main; tag v1.32.0; GitHub prerelease with aohys-development-system-1.32.0.tgz
  (sha512 /eEiA+…6Q==, verified from the downloaded asset).
- Verification: typecheck, builder --check (87 artifacts), roster:check;
  isolated /tmp/ds1320 script /tmp/verify1320.py 33/33 (upgrade from 1.31.0,
  idempotent enable, private hook preserved, guard probes, byte/structural
  rollback, guardrails both orders, missing-guard audit after downgrade,
  contract rollback). Reviewer (Opus high): ship with fixes; 1 Medium + 3 Low
  fixed before the tag.
- Real HOME rollout in H2 order: settings backup, no drift across 21 sources,
  three private guard entries removed, setup 1.32.0 (audit healthy),
  claude-orchestration-enable, orchestration audit ok. Hooks now run
  ~/.codex/development-system/runtime/claude-orchestration/roster-guard.mjs;
  live ledger shows Jev succeeding for new dispatches. make-roster.py now
  writes to this repository's claude/agents; roster changes ship as releases.
- GitHub MCP: user-scoped server "github" with a headersHelper
  (~/.development-system/private/github-mcp-headers.mjs, token from gh at
  connect time, nothing stored); broken github plugin disabled. Connected.
- Production (user-authorized; Release Train on main succeeded for each):
  eteria #281 -> develop, #282 -> main (6655e6da, Deploy production success);
  casa-roca #140 -> develop, #141 -> main (c48377c, Production Path success;
  no Vercel CLI redeploy because only the dev-tool pin changed);
  the-barber-central #340 -> develop, #341 -> main (e314cf4a, Verify, Selective
  deploy and Release success; the promotion gate was rerun once the develop
  preview Release Train finished).
- nutri-plan #494 squash-merged to develop (Release Train preview success).
  Its PR branch was created through the GitHub git data API (same tree as the
  local plumbing commit) because its pre-push hook refuses while the redesign
  working tree is dirty. Not promoted: develop carries 14 commits beyond main
  (main pins contract 1.10.0), and #484/#485 record NUTRI-151 acceptance as
  pending (Convex real/Preview, Computer Use, Stripe test, restoration with
  media, regulatory/operational requirements). Merge tree is clean and the
  migration manifest is additive; promotion needs the user's decision.

## Pending (user)

- nutri-plan production waits until the user finishes the current redesign
  work (user decision 2026-09-25); develop already pins 1.32.0.
- OAuth in /mcp: vercel, sentry, cloudflare, stripe, expo, linear, posthog,
  exa, mercadopago, mobbin. Gmail, Calendar, Drive and Notion are not used.
- Run phase 0 in a fresh thread with
  private/verification/nutriplan-redesign-20260924/phase0-prompt.md (updated
  for 1.32.0; the :3013 server is stopped and the prompt starts one). Evaluate
  checkpoint A, then correct the system or continue (continue-prompt.md has
  phase 1 onward).
- Closed by the user: Test-authored nutri-plan commits stay as they are; no
  Vercel Pro (casa-roca dashboard keeps CLI deployments).
- Cross-CLI computer use.

## Evidence and processes

Private: ~/.development-system/private/releases/1.31.0-claude/ and
~/.development-system/private/runs/headroom-claude/. No nutri-plan dev server
is running.
