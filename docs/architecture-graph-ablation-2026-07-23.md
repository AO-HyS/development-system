# Fresh knowledge-graph ablation

Linear: AOH-226  
Local date: 2026-07-23  
Production mutations: none

## Decision

Keep repository instructions plus direct source search (`M1`) as the default
architecture route. A fresh Understand Anything graph (`M3`) remains an
optional diagnostic tool; it is not a mandatory routing dependency and must
not be added to AOHYS or ETERIA on the strength of this experiment.

All 12 eligible Sol `xhigh` answers passed the closed architecture score and
were exported as validated AOH-226 measurement-v2 records. Eligibility was
verified from the tool trace: M1 ran in a worktree where the graph capability
was physically unavailable, while M3 had to run the exact graph helper and
both modes had to read every ground-truth source path.

| Repository | Mode | Score pass | Completed attempts | Median time | p95 time | Median tokens | p95 tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| The Barber Central | M1 isolated graph/source | 3/3 | 3/3 | 46.0 s | 47.2 s | 110,023 | 142,398 |
| The Barber Central | M3 fresh graph/source | 3/3 | 3/5 | 82.7 s | 93.9 s | 204,582 | 232,902 |
| NutriPlan | M1 isolated graph/source | 3/3 | 3/4 | 72.3 s | 102.2 s | 173,587 | 439,379 |
| NutriPlan | M3 fresh graph/source | 3/3 | 3/4 | 78.2 s | 111.9 s | 236,975 | 282,825 |

Relative to M1, M3 changed the medians by:

- The Barber Central: time `+79.9%`, tokens `+85.9%`;
- NutriPlan: time `+8.2%`, tokens `+36.5%`.

The promotion rule required either higher reliability with less than a 15%
token penalty, or at least a 10% reduction in time or tokens. Neither
repository qualifies. The generated measurement-v2 scorecard independently
returns `retain-baseline` and `do-not-change-routing` for both comparisons.
Dollar cost was unavailable, so no cost claim is made.

## Freshness evidence

| Repository | Pinned commit | Graph state | Graph shape | Refresh |
| --- | --- | --- | --- | --- |
| The Barber Central | `57845e4bec67ee957297f7e1d150454607093131` | strict stale check passed | 4,541 nodes / 4,351 edges / 9 layers | deterministic full refresh, 15.69 s |
| NutriPlan | `11f69d083a11e057fca705136c4428a6b3ef0216` | strict validation and stale check passed | 5,688 nodes / 8,620 edges / 8 layers | incremental repair of the changed route and imported legacy page |

Every M3 answer was verified against current source; source remained
authoritative. The suite binds each answer to the repository commit plus
packet, acceptance, fixture, and ground-truth hashes.

## Eligibility failures preserved

The first Barber packet asked the model to identify whether the seam was a
publishable package or a source alias, while the answer schema had no field for
that conclusion and the four-path cap was already consumed by the four seam
files. One M1 answer correctly spent two path slots on app `tsconfig` evidence,
then failed the closed expected-path score.

That packet is not eligible evidence. It was not relabeled or rescored.

A second diagnostic attempt used paired packets but tried to disable M3 using
prompt text alone. Despite the prohibition, the repo instructions caused one
of four Barber M1 attempts and two of four NutriPlan M1 attempts to invoke
graph surfaces. Those three answers were preserved as
`capability-contamination` and excluded.

The final M1 treatment used detached worktrees at the exact pinned commits and
quarantined only the graph artifacts, helper scripts, graph skills, and graph
context documents. A private manifest binds the removed paths and bytes. The
source files used by the task were unchanged. This produced a reproducible M1
capability boundary.

Four 360-second timeouts were also preserved: two of five Barber M3 attempts,
one of four NutriPlan M3 attempts, and one of four NutriPlan M1 attempts. Their
stderr shared Codex state-database and MCP/OAuth initialization warnings. This
shows a harness-level reliability issue in addition to the M1/M3 result; the
completed-answer score alone would have hidden it.

The permanent task-contract eligibility gate is documented in
`docs/architecture-benchmark.md`.

## Routing contract

- Default: concise repository instructions, bounded packet, direct source
  search, Sol `xhigh` for full-repository architecture analysis.
- Graph: optional when the task explicitly needs relationship discovery,
  impact exploration, or onboarding; its claims must still be verified in
  source.
- Concurrency: serialize full-repository `xhigh` runs; parallelize only cheap,
  disjoint checks.
- Rollback: retain roster
  `ed55cff7f4ef9cba90217c1ac86b8473eee026c5afe77ed58b70847256fceed9`.
- Re-evaluate M3 only with a new task class or a graph query path that is
  demonstrably cheaper; do not rerun this same ablation indefinitely.
- Repair the Codex state/MCP initialization path before treating full-repo
  timeout rates as a model-quality signal.

## Private generated evidence

Raw model events, structured answers, fixture manifests, invalidated
diagnostics, deterministic score JSON/HTML, measurement-v2 records, and the
standalone scorecard remain under the private benchmark directory. The
repository contains only the SHA-pinned closed suite and this
content-minimized decision record.
