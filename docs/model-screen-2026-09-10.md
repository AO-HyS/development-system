# Local worker configuration screen — September 10, 2026

Priority: **rápido → bien → barato**. This is a preliminary configuration screen,
not a full orchestration experiment or a statistically stable ranking.

All candidates actually ran on the operator's machine against the same synthetic
appointment fixture. They implemented a tenant-safe reschedule API and an
independent local-only drawer, preserving selection and filters. The parent
checked 18 backend behaviors and 22 browser observations across desktop/mobile.
This does not demonstrate real database integration or independent design critique.
No production application was changed by these tasks.

| Requested configuration | Worker seconds | Result |
| --- | ---: | --- |
| Codex Terra Low, priority | 71.63 | Passed first attempt |
| Codex Sol Low, priority | 86.67 | Passed first attempt |
| OpenCode GLM 5.3 Flash High | 127.53 | Passed first attempt |
| Codex Luna High, priority | 210.00 | Passed; equivalent Save label reconciled in checker |
| OpenCode DeepSeek V4.1 Flash Low | 59.89 + 23.64 correction | Passed after impossible-date correction |
| OpenCode Muse 1.3 Contributor High | 115.92 + 37.34 correction | Passed after impossible-date correction |
| Devin SWE-2 Medium | 63.01 | Failed impossible-date rejection |
| Codex GPT-5.5 Low, priority | 116.18 | Failed impossible-date rejection |
| Codex Luna Max, priority | 467.27 | Hidden drawer intercepted the launch click |

These durations measure launcher wall time. They exclude parent diagnosis,
verification, integration and gaps between attempts. Correction sums are not
end-to-end delivery times. Different efforts were intentionally tested as
practical configurations, not as a controlled model-only comparison. One worker
per provider ran concurrently; cache, network and host contention were not
controlled. No TTFT or output tokens/second claim follows from these figures.

Two earlier SWE attempts stopped because noninteractive tool permissions were
incomplete (28.17s and 59.64s). Both remain invalid setup attempts, separately
retained. A fresh baseline with scoped node/cd/npm permission completed the
reported SWE trial. No global dangerous permission mode was enabled.

The calendar oracle rejected February 30 rather than letting Date normalization
silently accept March 2. It found a concrete defect missed by four candidates;
this is useful behavior evidence, not a test-count target. The Luna Max failure
was observed in the browser, although its backend checks passed.

## Provisional recommendations

- Native Codex implementation: try Terra Low or Sol Low with priority when the
  task is bounded. Keep lower effort provisional; increase effort for observed
  difficulty, not automatically for every file.
- OpenCode implementation: GLM High passed first attempt here. DeepSeek is worth
  the full orchestrator experiment but its fast first output was incomplete.
- Keep Luna High available. This sample gives no reason to require Max for every
  implementation worker. Native named role profiles remain explicit defaults;
  an orchestrator can select another available model through its native host.
- Preserve independent capable visual review and required behavioral checks.
  A small implementation task does not benchmark specialist judgment.
- The conversation's starting model remains orchestrator. These suggestions do
  not replace Astra, SWE-2 or DeepSeek selected by the user. SWE descendants stay
  SWE during its experiment; missing capabilities remain visible.

The three full NutriPlan runs are prepared separately from identical code/spec/
assets. They have not yet measured orchestration quality or produced accepted
product implementations. Repeat representative work before claiming a stable
winner or universal specialist defaults.

## Usage limits

| Codex configuration | Input tokens | Cached input | Output tokens |
| --- | ---: | ---: | ---: |
| Luna Max | 1,422,556 | 1,338,624 | 36,097 |
| Luna High | 509,452 | 449,024 | 15,947 |
| Sol Low | 186,595 | 156,800 | 5,378 |
| Terra Low | 215,821 | 184,576 | 4,914 |
| GPT-5.5 Low | 399,376 | 356,864 | 7,705 |

These are host-reported cumulative values across turns, not occupied context.
Provider accounting is not normalized. Raw logs and per-attempt checks are
retained privately. Requested model/effort/tier are recorded; Codex/OpenCode
stdout did not independently attest the served model or honored priority tier.
SWE export did identify `swe-2-medium`. Therefore unknown observed fields remain
unknown. API dollars and Pro allowance consumption cannot be inferred reliably
from this table. Two Pro subscriptions remain a fixed subscription expense;
this screen measures a chance to conserve usage, not guaranteed account capacity.

## Sources used to choose candidates

Exa discovery was followed by local catalog inspection and actual executions.
[OpenCode Go](https://opencode.ai/docs/go/) documents its provider catalog;
[OpenCode agents](https://opencode.ai/docs/agents/) documents role configuration.
Official model descriptions cover [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) and
[GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5).
Vendor throughput claims were not used as local performance results. In
particular, [Cognition's SWE-1.6 preview](https://cognition.ai/blog/swe-1-6-preview)
does not establish SWE-2 throughput. Catalog identifiers and capabilities remain
host/account dependent.
