# ADR 0041: Make direct planning with one implementation packet optional

Status: Accepted experimental alternative; performance and product acceptance
are recorded separately.

## Context

The authorized Jev workflow comparison exposed planning and packet coordination
overhead. A bounded fourth alternative can test whether one direct Astra planning
stage and one coherent Flash packet improve time to accepted behavior. Existing
three-arm runs and their installed 1.23.0 sources must remain unchanged.

## Decision

Add explicit `planningMode: "direct"` and `packetization: "single"` run options.
Astra xhigh reads the accepted task and source while producing the plan; the
single mode requires exactly one bounded implementation packet before dispatch.
Omitted options keep the existing discovery/planning and packet-selection path.

Preserve independent plan review and correction, all selected Jev boundaries,
Flash model identity and bounded ownership, independent packet review,
integration checks, integrated review, neutral QA, configured visual critique,
and acceptance. A packet can need repeated reviewed correction attempts. The
alternative never turns an implementation completion into accepted behavior.

Record selected options and controllerVersion 1.23.1. Retain compatible 1.23.0
scheduler policy and prices as explicit pinned inputs. Include every stage and
failed/correction attempt in task-active time and cost; exclude experiment setup
under the same existing measurement definition.

## Release boundary

Extend exact canonical commit 04fe3dde41f0d085ac2c07d207eb4379073853d6 in a separate
worktree. Create new 1.23.1 artifact snapshots and manifest only; retain all 41
managed destinations and published catalog 0.43.1 with 104 skills / 140 variants. No
historical manifest, active 1.23.0 package, original arm or HOME activation changes
are part of preparing this optional alternative. Local packaging and tests do
not establish a winning strategy or authorize remote publication.
