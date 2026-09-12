---
name: evidence-capture
description: Record an affected UI flow or package existing screenshots and video as delivery evidence.
---

The orchestrator retains product acceptance. Live Computer Use is assigned only
to a role with actual browser capability; deterministic host tools capture and
package media under that role's authorized plan. Use an assigned bounded script
or media role only when a writer is needed; a running recording needs no model
agent. Keep one driver per browser session.
Reuse the active execution method when a browser-capable role is needed.
For existing media, verify the candidate and review receipt in step 1, then
continue at step 5; recording steps apply only when making new captures.

1. For final evidence of a visual implementation, require completed Impeccable
   work and independent visual-capable critique with findings resolved on this
   candidate (`design-quality`). Packaging existing media reuses its review
   receipt; it does not start a redesign or a new implementation review. If the
   receipt is missing, label visual acceptance unverified. A behavior-only
   recording without a visual change does not require a design exercise.
   Baselines and review screenshots are diagnostic and may precede that gate.
   Read the project's existing verification skill. Bind the actual repository,
   app, revision, authorized origin/path, test state and viewport. Obtain a
   baseline before editing; label any recovered old revision as a recapture.
2. Select a representative walkthrough for the affected behavior, plus distinct
   risk states. Honor an explicit request for exhaustive coverage. Reuse valid
   captures while candidate, data and environment match; changing an unrelated
   file does not itself require rerecording all flows.
   Choose the viewport and populated/empty state that demonstrate the requested
   task and match its reference. A portrait browser capture does not demonstrate
   the desktop composition. Confirm authentication, organization and usable
   sample data before recording; report a missing state instead of substituting
   an unrelated flow. Preserve private data and use authorized fixtures only.
3. Discover the active host's recording and interaction tools once. Keep its
   authorization and browser mechanism. Read [host-execution.md](references/host-execution.md)
   before composing a batch. Use the existing host-authorized execution plan;
   do not introduce a second plan schema or browser bridge.
4. Start recording, perform the authorized flow, wait for the final visible
   outcome, then stop; also stop in a finally path on failure. If the host only
   supports fixed-duration clips, ensure the completed flow fits inside the clip
   or use shorter meaningful segments. A later action cannot complete an earlier
   recording. Trim idle time only when it preserves the demonstrated sequence.
   Group stable dependent operations into code; return compact step results and
   evidence references. Yield when navigation, state or permission changes need
   judgment. Refresh stale element references; never replay a possibly committed
   write to recover from a tool error.
5. Check that the media decodes, has nonzero duration and shows actual actions.
   Sample beginning, transition and the actual end of the file; verify that the
   terminal outcome is present within the media, not just in a later screenshot
   or tool log. Inspect more when anomalies
   appear. Record exactly what was sampled. Capture existence, full playback,
   functional success and visual quality are separate claims.

Return completed steps, tool failures, media references, candidate/viewport/state
and gaps. Keep raw frames, recordings and credentials out of model text output.
The executor reports complete/incomplete, never product PASS/FAIL. The
orchestrator combines it with before/after probes and independent visual review.
Missing recording support remains a gap; screenshots or generated video cannot
impersonate a walkthrough.

See [host-execution.md](references/host-execution.md) for limits and invocation.
