---
name: benchmark-checklist
description: Check whether a measured speedup, regression or tool comparison is valid before reporting it or choosing an option.
---

# Benchmark checklist

Adapted from Poteto's PStack, based on Brendan Gregg's benchmarking checklist.
See [provenance and adaptations](UPSTREAM.md) when updating.

Use existing measurements or an authorized bounded comparison. This skill does
not authorize new paid services, production workloads or an automated evaluation
platform. If no measurement exists, report the missing evidence; do not invent
a benchmark merely to exercise the skill.

## Define the claim

Write the exact claim and its scope before measuring: operation, dataset,
environment, versions, completion condition and time boundary. Inspect the
measurement mechanism and what it excludes. Separate preparation, first run,
replay, retries, corrections and total usable-result time for agent workflows.
Use identical starting state, task context and expected outcomes per option.

Check machine load and concurrency. On macOS use `uptime` and
`sysctl -n hw.logicalcpu`; use available platform equivalents elsewhere.
Preserve unrelated processes. Interleave options to reduce drift and disclose
remaining interference. Keep profiling separate from reported timing.

## Validate the evidence

1. **Limiter:** locate the bottleneck using relevant observations. A saturated
   driver or wait outside the operation can dominate the measured time.
2. **Configuration:** use representative builds, data, cache state, connection
   settings and supported tuning for both options. Name model/provider changes
   separately; a combined comparison cannot isolate the tool's contribution.
3. **Plausibility:** compare throughput with available CPU, disk or network and
   the original share of time. An implausible gain may be a cache hit or no-op.
4. **Correctness:** count failures, omissions, retries and false positives.
   Inspect the expected result. Fast rejection or skipped work is not success.
5. **Repeatability:** for an adoption comparison, aim for at least five
   alternating successful runs per option within the authorized limits, report
   all attempts and failures, plus median and range. Retain failures rather
   than timing successes alone. If scope or resources permit fewer runs, label
   the result preliminary; do not quietly increase limits or pick a winner
   from a difference within observed variation. A requested one-run estimate
   remains an estimate and still requires correctness and actual-work checks.
6. **Practical effect:** report total time to the usable outcome alongside a
   micro measurement. Include resource consumption or cost only when observed.
7. **Actual work:** confirm that the operation ran inside the timed interval
   and its result was consumed. Inspect relevant persistence, server receipt or
   visible state through the authorized verification channel.

## Report

Conclude faster, slower, no measurable difference or inconclusive for the stated
scope. Include units, run counts, all failure counts, range, environment and
limiter; link detailed evidence from the existing task record. Missing correct
outputs, unbalanced configuration or unobserved work prevents an adoption claim.
Do not infer product acceptance from timing or attribute savings causally when
the comparison did not control the relevant variables.
