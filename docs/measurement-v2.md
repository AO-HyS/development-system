# Measurement and scorecard v2

Measurement v2 is a local, content-minimized evidence format for comparing
development routes without changing the capability roster. It validates strict
run records, ingests JSON or JSONL history, and writes a static JSON/HTML
scorecard. Generated run evidence and scorecards are local outputs and must not
be committed.

## CLI

Validate one or more files or directories:

```sh
pnpm run measure:v2 validate \
  --input /absolute/path/to/run.json \
  --input /absolute/path/to/history
```

Build a scorecard:

```sh
pnpm run measure:v2 scorecard \
  --input /absolute/path/to/history \
  --output /absolute/path/to/local-scorecard \
  --baseline baseline \
  --treatment treatment \
  --sample-threshold 3 \
  --current-roster-hash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --rollback-ref roster:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
```

Directories are searched recursively for `.json` and `.jsonl` files. A JSON
file may contain one record or an array. JSONL uses one record per non-empty
line. A generated v2 object with `operation: measurement-scorecard` is skipped,
so an output directory nested below an input directory is safely rerunnable.
No other invalid JSON object is skipped. The whole batch fails on an invalid
record or duplicate `runId`.

The output directory is mode `0700`; `scorecard.json` and `index.html` are mode
`0600`. The HTML is standalone, includes `noindex,nofollow`, and does not need a
server.

## Run-record schema

Every object is closed: unlisted fields are invalid. Every non-timestamp string
is a controlled identifier, enum, hash, or immutable recovery reference. There
are no narrative/payload fields.

```json
{
  "schemaVersion": 2,
  "runId": "run-treatment-003",
  "cohort": "treatment",
  "repository": {
    "id": "development-system",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "ticket": "AOH-214"
  },
  "benchmark": {
    "packetId": "measurement-v2-packet",
    "acceptanceId": "measurement-v2-acceptance",
    "fixtureHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "rosterHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "capability": "implementation",
  "stage": "flow-implement",
  "ciPolicy": "required",
  "terminalSliceHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "startedAt": "2026-07-23T10:00:00.000Z",
  "endedAt": "2026-07-23T10:12:00.000Z",
  "verifiedAt": "2026-07-23T10:11:00.000Z",
  "waitMs": null,
  "result": "success",
  "evidenceStatus": "validated",
  "gates": {
    "requirements": "passed",
    "spec": "passed",
    "tickets": "passed",
    "ci": "passed",
    "preview": "not-required",
    "humanFinal": "pending"
  },
  "agents": [
    {
      "role": "implementer",
      "routeSlot": "implementation",
      "harness": "codex",
      "requestedModel": "gpt-5.6-sol",
      "resolvedModel": "gpt-5.6-sol",
      "reasoning": "medium",
      "durationMs": 705000,
      "tokens": null,
      "costUsd": null,
      "selectionReason": "bounded-contract-risk",
      "result": "success",
      "evidenceStatus": "validated"
    }
  ],
  "quality": {
    "firstAttempt": { "passed": false, "findings": 1 },
    "final": { "passed": true, "findings": 0 },
    "reviews": 1,
    "corrections": 1,
    "regressions": 0,
    "reopens": 0,
    "ci": "passed",
    "qa": "passed",
    "preview": "not-run",
    "escapedDefects": 0
  },
  "rollbackRef": "roster:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
}
```

Allowed outcomes are `success`, `failure`, `incomplete`, `timeout`, and
`permission-blocked`. Evidence is `validated`, `provisional`, `incomplete`,
`timeout`, or `permission-blocked`. The last three evidence values must match
the corresponding result, both for the run and each agent. A completed but not
independently validated outcome is `provisional`. Routing metrics use the
agent's outcome, never a copy of the enclosing run outcome.

Gate values are `passed`, `pending`, `blocked`, or `not-required`. CI, QA, and
preview values are `passed`, `failed`, `not-run`, `not-required`, or `blocked`.

`verifiedAt` is nullable. When present it must be between `startedAt` and
`endedAt`. `timeToVerifiedMs` is derived as `verifiedAt - startedAt` and is
never supplied by the producer. Validated evidence may still lack this
telemetry, but a treatment with unknown TTV cannot replace a baseline whose TTV
is known.

`waitMs`, agent `tokens`, and `costUsd` are nullable when the harness does not
report them. Zero must not stand in for unavailable telemetry. Any sum or mean
that contains an unavailable value also reports `null`.

`rollbackRef` is nullable or one of two immutable forms:

- `git:<40 hexadecimal commit>`;
- `roster:<64 hexadecimal SHA-256>`.

## Privacy boundary

The validator recursively rejects keys whose normalized names represent:

- prompts or transcript payloads;
- secrets, API keys, or passwords;
- clinical, patient, or diagnosis data;
- private-content payloads.

This applies at every nesting depth before ordinary unknown-field validation.
The validator does not attempt to recognize sensitive values inside arbitrary
prose because the schema exposes no prose field. `terminalSliceHash` and
`benchmark.fixtureHash` retain identity without content. `selectionReason` is a
lowercase code identifier such as `bounded-contract-risk`, not an explanation.
Do not put source snippets, model output, review text, conversations, customer
data, credentials, medical information, or filesystem paths into records.

## Aggregation and comparison

The scorecard emits:

- `daily`: one overall row plus rows grouped by
  repository/capability/route-slot/role/resolved-model/harness for each UTC
  date;
- `rolling7`: the same views over the current UTC date and six preceding days;
- `comparisons`: baseline and treatment metrics grouped by
  repository/capability/`routeSlot`. `routeSlot` names the stable logical
  responsibility (`implementation`, `architecture-analysis`, etc.); `role`
  remains the actual subagent. This permits `implementer` and
  `fast_implementer`, or `code_mapper` and `architecture_planner`, to compare
  when they execute the same controlled packet, while different route slots
  never mix;
- summary and route evidence counts for validated, provisional, incomplete,
  timeout, and permission-blocked agent outcomes;

An agent-run is the routing sample. A run with multiple agents contributes once
to each agent's route; its run-level quality applies to those routing samples.
Within a comparison group, run-level quality, wait, and verification timing are
deduplicated by `runId`; per-agent result, duration, tokens, cost, model, and
evidence remain agent outcomes.
The scorecard reports first/final-pass, CI, QA, preview-readiness and evidence
rates; mean duration, wait, and time-to-verified; nullable token/cost sums; and
mean reviews, corrections, regressions, reopens, and escaped defects. Daily,
rolling-seven-day, comparison JSON, and static HTML retain these signals.
Daily/rolling aggregates include nullable totals; baseline/treatment
comparisons deliberately omit total tokens and total cost and expose their
nullable per-agent averages instead.

## Advisory routing rule

The default minimum is **3 validated baseline and 3 validated treatment runs
per repository/capability/route-slot**. Eligibility includes an agent-run only when
both its run and agent outcome are `validated`. Multiple agents in one run do
not inflate the distinct-run eligibility count. Provisional, incomplete,
timeout, and permission-blocked outcomes remain visible but do not satisfy the
screening minimum. Below either minimum the result is
`insufficient-evidence` and the only action is to collect more samples.

At or above the threshold, treatment is eligible only when:

1. baseline and treatment use the identical terminal-slice hash, packet ID,
   acceptance ID, fixture hash, and repository commit;
2. treatment agent-success, CI-readiness, and QA pass rates are `1`;
3. preview-readiness is `1`: a required preview passed, while a
   `not-required` gate may have `not-run` or `not-required` evidence;
4. final-pass is `1`, first/final-pass rates do not regress, and mean
   corrections do not increase;
5. mean regressions, reopens, and escaped defects are zero and no worse than
   baseline;
6. treatment mean TTV does not exceed known baseline mean TTV; a known baseline
   plus unknown treatment TTV is ineligible;
7. mean duration, wait, time-to-verified, or corrections improves; and
8. the current roster SHA-256 and immutable rollback reference are present.

CI readiness follows the controlled `ciPolicy` enum. `required` does not permit
`gates.ci: not-required` and requires passed CI for readiness.
`not-required-read-only` is accepted only for the controlled `architecture` and
`research` capabilities, requires `gates.ci: not-required`, and permits
`quality.ci: not-run` or `not-required`. This keeps read-only packets eligible
without letting implementation self-declare a bypass. QA remains mandatory
because it is the benchmark judge/rubric.

The supplied current roster SHA-256 must match the roster hash captured by
every compared run. Drift reports `roster-drift` and blocks eligibility until
fresh evidence is collected.

Failed quality or gate criteria report `quality-gate-failed`; no measured
efficiency gain retains baseline. Without rollback or current roster hash, the
result is `missing-recovery-reference`. Non-identical evidence reports
`not-comparable`. An eligible result says `consider-treatment` and includes
both recovery references. A record-level rollback reference participates only
when it belongs to a validated treatment outcome; provisional or incomplete
treatment records cannot supply it. A CLI `--rollback-ref` must match such a
validated treatment reference.

Recommendations are advisory data. The module does not accept a roster path,
does not import roster mutation functions, and always reports
`"rosterMutation": "none"`. Changing a roster remains a separately authorized,
reviewed operation.
