# Architecture benchmark baseline

Linear: AOH-222
Date: 2026-07-23
Production mutations: none

## Decision

Repository instructions are proven useful. Knowledge graphs are not yet
eligible for routing. Shared components help when they encode a narrow,
tested decision, but broad cross-app canonization is not supported by the
current evidence.

The production-pinned C1 and C4 suites now target:

| Repository | Commit |
| --- | --- |
| AOHYS | `a94d84466602e48c022f7d4d234f399807263aa4` |
| The Barber Central | `d8d9f3118c28396d3632fd97aa8d38aebcfd83e1` |
| ETERIA | `6a22414d3394be43c7213b99c98c81ba1ce6d7d5` |
| NutriPlan | `94a46a4e08f502ec50ad4407bb58d9801162edff` |

Historical model results remain bound to their original commits and hashes;
they are not relabeled as current evidence. The relevant C1 seam files are
byte-unchanged between the historical and production pins, which makes them a
useful baseline but does not make them fresh routing samples.

## Model results: C1 locate-seam

| Repository | Route | Completed | Passed | Mean seconds | Mean tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| AOHYS | Luna/code mapper | 3 | 2 | 138.7 | unknown |
| AOHYS | Sol/architecture planner | 3 | 3 | 110.0 | unknown |
| Barber | Luna/code mapper | 3 | 3 | 145.7 | 326,639 |
| Barber | Sol/architecture planner | 4 of 5 | 4 | 89.8 | 247,876 |
| ETERIA | Luna/code mapper | 3 | 3 | 132.3 | 264,445 |
| ETERIA | Sol/architecture planner | 3 | 3 | 54.3 | 141,949 |
| NutriPlan | Luna/code mapper | 3 | 3 | 123.3 | 420,438 |
| NutriPlan | Sol/architecture planner | 4 of 5 | 4 | 93.0 | 326,565 |

Sol was faster in all four repositories and used fewer measured tokens in the
three repositories with token telemetry. It also avoided the AOHYS miss.
Full-repository `xhigh` work should therefore stay on Sol for this route.
This does not prove a cost advantage because dollar cost was unavailable.

The two Sol timeouts occurred under concurrent expensive runs. Serial retries
passed. Full-repository `xhigh` analysis should be serialized; only cheap,
disjoint checks should run concurrently.

## Instruction ablation

Eight controlled C4 runs all passed. Adding the applicable repository
instructions changed the mean from 27.5 seconds and 69,826 tokens to
17.25 seconds and 50,607 tokens:

- time: 37.3% lower;
- tokens: 27.5% lower;
- pass rate: unchanged at 100%.

AGENTS/CONTEXT are therefore part of the fast path, not optional documentation.
The benchmark supports keeping them concise, product-specific, and explicit
about gates.

## Knowledge graph

| Repository | State | M1 | M3 | Decision |
| --- | --- | --- | --- | --- |
| AOHYS | unavailable | measured | unavailable | Report absent; do not infer green. |
| ETERIA | unavailable | measured | unavailable | Report absent; do not infer green. |
| Barber | stale | 89.8 s / 247,876 tokens | 88.0 s / 321,290 tokens | 1.8 s faster but 29.6% more tokens; no routing change. |
| NutriPlan | stale by 25 files | 93.0 s / 326,565 tokens | 94.0 s / 335,690 tokens | Slower and 2.8% more tokens; no routing change. |

M3 treatments are exported to measurement v2 as `provisional`. They appear in
daily and rolling-seven-day reports but cannot satisfy the three-run routing
threshold until the graph is refreshed and rerun against the same commit.

## Shared components

| Repository | Dashboard | Admin | Overlap | Exact | Divergent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Barber | 102 | 93 | 93 | 62 | 31 |
| NutriPlan | 78 | 33 | 31 | 6 | 25 |

Barber's RecordCard foundation is a source alias, not a publishable workspace
package. It produced perfect C1 seam recovery in the validated runs, so the
narrow tested foundation is useful. The 31 divergent components are not
evidence for bulk extraction.

NutriPlan has no cross-app UI package and only 6 of 31 overlapping components
are exact. The LLM still recovered the RecordCard seam, but duplication and
divergence make a broad package migration high-risk. A tracer-bullet comparison
must measure one shared decision before any canonization.

## Routing and rollback

- Keep Sol `xhigh` for the bounded `architecture-analysis` route.
- Keep repository instructions in every route.
- Do not enable knowledge-graph routing yet.
- Do not auto-extract shared components.
- Do not mutate the roster from an architecture report.

The architecture-to-measurement adapter requires the current roster hash and
an immutable `roster:<sha256>` rollback reference. Stale capabilities can be
marked provisional explicitly. Routing still requires three validated samples
per baseline and treatment at the exact same repository, packet, acceptance,
fixture, terminal-slice, and roster identities.

## Private generated evidence

The raw command events and model answers remain in the private benchmark
directory. Sanitized scorecards are generated as JSON and standalone HTML with
mode `0600`; the directory is `0700`. The durable repository contains only
closed schemas, SHA-pinned suites, deterministic scoring code, and this
content-minimized decision record.
