---
name: review-thread
description: Audit a coding thread, run, or PR against its claims and evidence; return findings and a continuation prompt.
---

# Review a thread

Review completed or ongoing work from outside its implementation context.
The selected reviewer can be any available model with the required capabilities;
this method has no dependency on a named model or provider. Optimize useful
correction and completion time, not the volume of findings.

## Locate the candidate

Use the supplied thread ID and the host's native history/export or local
read-only history store. Recover the user's outcome, accepted decisions, latest
corrections and claimed result. Prefer a bounded snapshot with pointers over
loading every earlier conversation or handing its full history to a worker.
On this workstation, consult [local-history.md](references/local-history.md)
only when the supplied ID cannot be opened directly in the current host.

Verify the actual root, branch, commit/diff and PR. Sidebar links and model
selection labels can be stale. Associate each finding with the inspected
revision. If work changes during the review, record that and inspect the
relevant delta before claiming the newest candidate is faulty or accepted.
An unsuccessful limited search means “not located”, not “does not exist”.

Keep product files, remote records and active sessions unchanged during audit.
Write private review artifacts when useful. A request to review does not itself
authorize implementation, external messages, merge or production changes.

## Test the claims

Compare the requested behavior to the diff and the evidence already available.
Prioritize failures that prevent completion: omitted scope, wrong data/state,
authorization, broken interactions, visual direction, and unsupported delivery
claims. Inspect the exact provider/runtime contract when correctness hinges on
it. Tests that mock away a service restriction cannot settle that question.

Separate confirmed defects, corrected findings and unverified claims. Confirm
check exit codes and what each check covers. Reuse evidence while its revision,
environment and inputs still apply; rerun only checks needed to resolve an
actual uncertainty. Do not demand another full audit or test suite by default.

For visual claims, open approved references and the actual rendered evidence
with a vision-capable reviewer. Check route, role, loaded data, viewport and
candidate revision before judging fidelity. Desktop footage is not mobile
evidence. If browser access or vision is unavailable, report that limit and
continue the review supported by available evidence.

If runtime verification needs data changes, use an authorized isolated fixture
and recoverable cleanup. Do not mutate existing user data merely to obtain a
screenshot. Keep credentials and auth state out of reports and uploads.

## Inspect orchestration only where it explains the result

Use observed task/session records to determine whether workers actually ran,
which models were used, whether independent work overlapped, and where retries
or repeated investigation occurred. Distinguish a bad parent instruction,
worker error, environment failure and missing verification. Attribute causes
only when the trace supports them; one failed run is not a universal model
ranking. A plan to delegate is not a completed delegation.

Measure time to the requested usable result. Separate interruptions and provider
waits when timestamps support it. Report per-request usage without double
counting cumulative snapshots. Distinguish cached tokens, catalog/API cost,
subscription quota and cash paid; mark unavailable measurements as unknown.

## Return a correction the implementing thread can use

Lead with whether the inspected candidate meets the request. For each material
finding, give the trigger, observed consequence, exact source/revision or
evidence, and the smallest repair acceptance criterion. Explicitly retain
resolved findings rather than assigning them again. Label missing proof as a
verification gap rather than inventing a defect.

Provide a short continuation prompt containing the goal, current root/revision,
open findings, useful evidence paths, focused checks and authorized endpoint.
Preserve working code and settled decisions. Do not broaden it into a redesign
of the development system, a new benchmark or a mandatory provider change.
The verdict and continuation packet complete a review request. Ask for input
only when a missing fact prevents a material conclusion; do not end by asking
whether to begin an unrequested implementation stage.
