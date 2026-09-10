# ADR 0030: Cover implementation and orchestration, not only visual acceptance

Status: accepted under the operator's retained correction and publication request,
September 10, 2026. The 1.16.0 correction was partial; product reimplementation
still belongs to a new thread.

The pilot's independent code review found draft loss when context changed between
inline and overlay, and Escape dismissing underlying context from a nested layer.
Those were corrected in the pilot: the review added value. A defensive containment
test also passed before its guard, so it did not establish a reproduced fix.
These observations justify targeted transition evidence, not discarding tests or
requiring a new test for every visual change.

The parent made 350 of 530 host tool calls. It made 213 invocations to the Node
surface used for Computer Use; these are not 213 literal clicks or a measure of
wasted minutes. The parent carried the long audit conversation, recovered usable
product access late, retried host setup and captures, and ended a turn with QA
pending. A later report overstated the outcome and initially lacked the requested
remote review surface. Six specialist agents alone do not explain these failures.
Some broad check reruns followed real source changes and were warranted.

Release 1.16.1 / catalog 0.37.1 updates existing flow-implement,
coding-orchestration, evidence-capture and UI/browser-QA profiles:

| Observed problem | Correction | Evidence needed next time |
| --- | --- | --- |
| State/dismissal regressions during layout change | Writer receives behavioral invariants; verify transitions and nested ownership | Draft/filter/focus retained through the changed flow; valid regression evidence |
| Login succeeded without usable organization | Resolve product role, organization and sample state early; retain private access-source pointer | First usable authenticated flow, not just HTTP/login success |
| Long parent context and many browser rounds | Compact scoped pass to Astra browser-QA when host supports it; otherwise direct stable tool batches | Parent rounds, discarded captures, completed flow and elapsed time |
| Repeated host failures | Change a relevant prerequisite before retry; preserve completed evidence and diagnose one actual blocker | Failed operation, changed condition and resulting observation |
| Interrupted work and premature closure | Resume from current candidate/ownership; reconcile requested outcome and review link before final verdict | Current status agrees with pending work and actual delivered surface |
| Excess or misleading checks | Focused transition coverage, justified broad reruns, distinguish test value from test count | Which named behavior each check proves and which defect it caused to be corrected |

These are responsibilities within the existing workflow. Use Matt Pocock's
writing-for-agents guidance and Codex skill-creator: keep the longer recovery
reference conditional and avoid adding a second coordinator, tracker, harness or
approval protocol. Retain the current model efforts and provider order. This pilot
does not compare Medium with xHigh or Go with Codex; no new ranking is inferred.

Keep source, runtime, formal QA, preview, production and user acceptance distinct.
Correct superseded mutable reports without rewriting historical evidence.
Unavailable host receipts remain a limitation; no fabricated certification.
Versioned skills and behavioral probes can demonstrate selected decision changes.
Only a new complete product run can establish speed, quota use and accepted delivery.
