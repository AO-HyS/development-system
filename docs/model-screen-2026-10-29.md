# Terra 6.1 fast vs Sol 6.1 High screen — October 29, 2026

Priority: **rápido → bien → barato**. This is a preliminary screen for three
flows on this system, comparing two complete configurations: Codex
`gpt-6.1-terra` with `serviceTier: priority` (requested "fast") against the
current `gpt-6.1-sol` High with `serviceTier: default`. It cannot attribute the
difference to the model alone (tier and effort differ by design), and two
confirmation runs per option are below the five a stable adoption claim needs.

Accepted plan: cross-review with Sol, 4 rounds, v4 (sha256 `f7497969…1541`).
Private evidence (packets, oracles, run log, takes, critiques):
`~/.development-system/private/terra-benchmark-20261029/`.

## Result per flow

- **App testing (NutriPlan dashboard, two-role permission check): Terra high wins.**
  Confirmation S-T-T-S: Sol 116 s and 109 s; Terra 55 s and 63 s. Median 59 s vs
  112.5 s (−48 %); Terra was faster in both pairs and its slowest run beat Sol's
  fastest. All four gave the correct verdict (nutritionist creates, assistant is
  blocked in the list and on the direct `/patients/add` route), one form each.
- **Computer use (Planeta Aula iOS simulator, 7 steps): Terra low wins.**
  Sol 171 s and 160 s; Terra 97 s and 89 s. Median 93 s vs 165.5 s (−44 %);
  consistent in both pairs, no overlap. All four completed 7/7 with one note and
  one login, no trial or checkout.
- **Video recording (NutriPlan scene, agent-browser recorder): Terra medium wins
  after the recorder fix.** The first screen ran on agent-browser 0.15.1, whose
  recorder filmed a separate context at a fixed 1280×720 and restored the
  pre-recording page after `record stop`, so the operator could not see what it
  had filmed; there the blind judge failed one Terra low take and one Sol take.
  With agent-browser 0.41.0 (records the active tab at the viewport, 1440×900,
  keeps the page after stopping, writes a contact sheet) and packet v3, the
  rerun confirmation S-T-T-S gave Sol 168 s and 230 s, Terra medium 70 s and
  102 s: median 86 s vs 199 s (−57 %), faster in both pairs, no overlap. All four
  takes passed the blind Opus judge with no mandatory failure. Sol's takes scored
  higher (mean 4.25 and 5.0, against 4.0 and 3.75): Sol reviewed its contact
  sheet and used small scroll steps, while Terra scrolled once to the bottom and
  held the loaded record about 1 s instead of 1.5 s. §5 decides on integrity and
  completeness first, then time, so Terra medium wins; the quality gap is the
  open caveat.

## Exploration (Terra fast, one run per effort, random order)

- Video, first screen (agent-browser 0.15.1): high 32 s, medium 31 s, low 28 s; all one take, all ≥4 in every rubric
  dimension (judge ranking high > medium > low by small margins). Finalist low by
  the fixed tie-break (equal minimum score, then shortest time). Terra low twice
  said it could not confirm the record loaded on camera: agent-browser restores
  the pre-recording page after `record stop`, which hides the result from the
  operator.
- Video, rerun (agent-browser 0.41.0, packet v3): low 86 s (3 takes), high 97 s,
  medium 67 s (1 take each); judge means low 4.25, medium 4.0, high 3.75 (high
  had a 3 in fluency and completeness). Finalist medium by the fixed tie-break
  (equal minimum score 4 with low, then shortest time).
- Testing: high 65 s, medium 73 s, low 71 s; all correct. Finalist high.
- Computer use: medium 89 s, low 81 s, high 109 s; all 7/7. Finalist low.
- `xhigh` was not needed: no effort failed.

## Method and limits

- 21 counted sessions in the first screen (9 exploration, 12 confirmation) plus
  1 smoke and 2 preparation failures that did not count (T3 preview snapshots
  time out while the panel is hidden; a simulator session left open by another
  thread), and 2 blind Opus 5.5 critique sessions. The owner then asked to fix
  the recorder and test again: 7 more video sessions (3 exploration, 4
  confirmation) and 2 more blind critiques, 28 counted sessions in total, within
  the 30 ceiling.
- In the rerun the T3 server restarted at the end of the second Terra
  confirmation run; its time ends when its delivered take was saved (102 s) and
  excludes the logout, which the interruption cut off. The dashboard was then
  restarted before the last Sol run.
- Time is each child's self-reported start and end in UTC, from receiving the
  packet to delivering its report. It excludes T3 dispatch, queueing and the
  parent's preparation, probes and cleanup. Token and quota use were not
  observed comparably and are not part of the decision.
- Identity: host-applied model, effort and tier were recorded for every run;
  every child reported model and effort matching the request and tier
  "unknown". Fast tier is therefore requested and applied by the host, not
  observed in the child.
- The work per run is app round trips (login, list and record loads) plus model
  time between tool calls. Both configurations used the same app and servers,
  so the gap is most likely model and tier time; tool-call counts were not
  measured, so the split is not proven.
- Runs were strictly sequential, one operator per surface; machine load at the
  end was 1.66 (1-minute average) on 10 logical CPUs with other threads active,
  so host contention was not controlled.
- First-screen video takes are 1280×720 (fixed by agent-browser 0.15.1
  `record`); rerun takes are the planned 1440×900. The judge saw contact sheets at 2 frames per second plus full frames
  every 2 s, not the video itself; pauses under 0.5 s are estimates.

## Deviations from plan v4

- Browser route: the headless `agent-browser` CLI replaced T3 preview tools for
  testing and video, because T3 preview snapshots time out while the panel is
  hidden. The recorder is agent-browser's, not T3's.
- Video scene: NutriPlan patient record (Valeria Ejemplo Ruiz) instead of the
  Barber booking-owner scene, whose owner session needs an emailed OTP.
- Critique: two blind sessions (exploration, then confirmation) instead of one,
  because the finalist had to be chosen from exploration scores first.
- Planeta Aula ran against its preview backend by temporarily swapping
  `apps/mobile/.env.local` (restored at the end; sha256 matches the backup).

## Effects and cleanup

- NutriPlan (dev deployment `elated-shark-671`, org Diana Prueba): 7 synthetic
  patients `Bench-testing-*` created by nutritionist runs, each soft-deleted by
  registered ID with `deletePatient` and verified by probe (0 live). Their user
  records remain as declared synthetic residue. The assistant submitted nothing.
- Planeta Aula preview: 7 synthetic notes `bench-cu-*` on MOBILE1, retained as
  declared synthetic residue (no delete path in scope). No trial, checkout,
  subscription or setting change.
- No production system, payment, email or customer message was touched.

## Decision (approved by the owner; applied in 2.8.0)

- Computer use and simulator QA: Terra 6.1 low, fast tier.
- App testing through a browser: Terra 6.1 high, fast tier.
- Video recording: Terra 6.1 medium, fast tier, with agent-browser 0.41 or
  later. Ask for a contact-sheet review and small scroll steps in the packet;
  that is where Sol's takes were better.
- Plan, diff, backend and security review stay on Sol 6.1 High.
- These conclusions are preliminary (two confirmation runs per option); recheck
  with more runs if a flow regresses.
