# ADR 0028: Apply measured effort and explicit speed by responsibility

Status: accepted; operator authorized production rollout on September 9, 2026.

Release 1.15.0 preserves the priority rápido → bien → barato and the existing
OpenCode Go execution order. Astra requests normal/default speed explicitly in
both routes and native profiles. The CLI resolver's missing-tier fallback now
requests default; previously it silently requested priority. Luna retains
priority/Fast. A requested tier is not proof of the tier charged by the service.

Feature orchestration provisionally moves from Astra Medium to xHigh. The same
complete-flow pilot finished at 13m55s/71 tool calls for Medium, 13m33s/48 calls
for xHigh, and 19m23s/54 calls for Max. All passed acceptance. The xHigh run used
17.2% less weighted Codex token consumption than Medium at equal requested speed.
This single case motivates the default, not a universal ranking. An explicit
escalation from xHigh reaches Max; escalation never lowers existing effort.

The subsequent specialist screen compared 18 roles at three efforts each:

| Responsibility | Production request |
| --- | --- |
| Backend, documentation, QA planning, release, general review | Astra Medium, default |
| Architecture, browser QA, Computer Use, performance, security, UI, visual critique | Astra High, default |
| Code mapping, general implementation, evidence preparation, test execution | Luna High, priority |
| Fast implementation fallback, mechanical work | Luna Max, priority |

Only the four Luna High mappings lower installed specialist effort. For example,
general implementation passed all probes in 121s at High versus 312s at Max.
Fast-implementer High missed an impossible date and needed a correction; Max
passed on its first attempt. Differences within 10% retain the installed choice.
Computer Use covered neutral observation; no sandbox or write authority changes
are justified by that fixture. Astra retains visual decisions and independent
critique before final evidence. Stable commands and recordings use host tools.

The 54 comparable runs, nine invalid setup attempts and one correction are kept
separate in private evidence. The invalid attempts consumed 11.79% of the measured
64-run credit equivalent; these were harness preparation errors, not product
failures. Completed runs were not repeated after the power outages. Selected
specialist efforts reduce estimated consumption only 1.65% versus their installed
baselines at the same speed. All-Max would add 71.59%. These estimates exclude
parent/preparation work and do not establish actual Pro allowance deductions,
remaining days, or a monthly spending reduction. The operator has two $200 plans.

Release artifacts, manifest hashes and catalog 0.36.0 carry these settings.
Earlier published versions remain immutable. Native profiles preserve sandbox
and task instructions. Root Codex settings for new sessions are aligned during
the authorized operator rollout, with a backup; config changes do not reconfigure
active turns. Verify isolated installation/rollback, routing regressions and a
real fresh runtime context before claiming the new model and effort loaded.

Full benchmark outputs and media remain private; no benchmark account data,
product source or transcripts are included in the public release.
