# Fresh knowledge-graph ablation

Linear: AOH-226  
Local date: 2026-07-23  
Production mutations: none

## Decision

Keep repository instructions plus direct source search (`M1`) as the default
architecture route. A fresh Understand Anything graph (`M3`) remains an
optional diagnostic tool; it is not a mandatory routing dependency and must
not be added to AOHYS or ETERIA on the strength of this experiment.

All 12 eligible Sol `xhigh` runs completed, passed the closed architecture
score, and were exported as validated measurement-v2 records. M3 did not
improve reliability in either repository and was slower in both.

| Repository | Mode | Pass | Median time | p95 time | Median tokens | p95 tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| The Barber Central | M1 instructions/source | 3/3 | 61.7 s | 77.7 s | 148,750 | 154,022 |
| The Barber Central | M3 fresh graph/source | 3/3 | 92.7 s | 129.0 s | 295,425 | 504,846 |
| NutriPlan | M1 instructions/source | 3/3 | 84.3 s | 86.9 s | 354,530 | 381,342 |
| NutriPlan | M3 fresh graph/source | 3/3 | 123.8 s | 132.9 s | 372,420 | 457,333 |

Relative to M1, M3 changed the medians by:

- The Barber Central: time `+50.1%`, tokens `+98.6%`;
- NutriPlan: time `+46.9%`, tokens `+5.0%`.

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

## Invalidated diagnostic packet

The first Barber packet asked the model to identify whether the seam was a
publishable package or a source alias, while the answer schema had no field for
that conclusion and the four-path cap was already consumed by the four seam
files. One M1 answer correctly spent two path slots on app `tsconfig` evidence,
then failed the closed expected-path score.

That packet is not eligible evidence. It was not relabeled or rescored. A new
packet hash removed the unrepresentable clause, and all six Barber treatments
were rerun. The correction itself materially improved the M1 medians, showing
that a precise task contract is a first-order speed control.

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

## Private generated evidence

Raw model events, structured answers, fixture manifests, invalidated
diagnostics, deterministic score JSON/HTML, measurement-v2 records, and the
standalone scorecard remain under the private benchmark directory. The
repository contains only the SHA-pinned closed suite and this
content-minimized decision record.
