# Architecture and LLM-comprehension benchmark

The architecture benchmark measures whether a routed model can recover a
version-pinned repository contract using only structured claims. It is a local,
deterministic judge for repeated C1-C6 and M0-M4 experiments. It does not run a
model, retain prompts or raw model output, inspect a product checkout, or change
the capability roster.

Suites, candidate-answer capture, and reports are separate concerns:

- a suite is authored against an exact 40-character repository commit and
  SHA-256-pinned benchmark identities;
- an external harness runs the controlled experiment and writes a structured
  candidate answer;
- this module validates and scores that answer with exact normalized matches;
- JSON and HTML reports are private generated outputs and must not be committed.

The report retains `packetHash`, `acceptanceHash`, `fixtureHash`, and
`groundTruthHash`. A future measurement-v2 adapter can join those identities to
route measurements without copying raw answers into measurement-v2 or changing
either schema.

## Task classes and modes

Task classes are fixed:

| Code | Name | Question measured |
| --- | --- | --- |
| C1 | `locate-seam` | Locate the canonical implementation seam. |
| C2 | `trace-path` | Trace a request or decision path. |
| C3 | `duplicate-decision` | Find duplicate or conflicting decisions. |
| C4 | `instruction-gate` | Recover applicable instructions and manual gates. |
| C5 | `test-map` | Map behavior to its authoritative tests. |
| C6 | `graph-reconcile` | Reconcile source evidence with graph/index claims. |

Modes are also fixed:

| Code | Name |
| --- | --- |
| M0 | `prompt-only` |
| M1 | `instructions` |
| M2 | `local-shards` |
| M3 | `knowledge-graph` |
| M4 | `normalized-index` |

Every repository declares all five mode keys as booleans. An answer for a mode
declared `false` is retained with status `unavailable`; it is not a failed task
and contributes to no scored aggregate.

## CLI

Validate a suite and its pinned ground truth:

```sh
pnpm run benchmark:architecture validate-suite \
  --suite /absolute/path/to/suite.json
```

Score one or more answer files or recursive directories:

```sh
pnpm run benchmark:architecture score \
  --suite /absolute/path/to/suite.json \
  --answers /absolute/path/to/answers \
  --output /absolute/path/to/private-score
```

Score and render JSON plus standalone HTML:

```sh
pnpm run benchmark:architecture report \
  --suite /absolute/path/to/suite.json \
  --answers /absolute/path/to/answers \
  --output /absolute/path/to/private-report
```

Or render an existing score:

```sh
pnpm run benchmark:architecture report \
  --scored /absolute/path/to/private-score/architecture-benchmark.json \
  --output /absolute/path/to/private-report
```

Convert a scored M1/M3 comparison into measurement-v2 records, then generate
the shared daily and rolling-seven-day scorecard:

```sh
pnpm run benchmark:architecture measurement \
  --scored /absolute/path/to/architecture-benchmark.json \
  --output /absolute/path/to/private/measurement-records.json \
  --roster-hash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --rollback-ref roster:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --baseline-mode M1 \
  --treatment-mode M3 \
  --provisional-mode M3

pnpm run measure:v2 scorecard \
  --input /absolute/path/to/private/measurement-records.json \
  --output /absolute/path/to/private/scorecard \
  --current-roster-hash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --rollback-ref roster:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Use `--provisional-mode` whenever capability freshness or runtime evidence is
not independently current. Provisional architecture runs remain visible in the
daily and rolling views but cannot satisfy the three-run routing threshold.
The adapter never mutates the capability roster.

Before `report --scored` writes anything, it recursively applies the privacy
filter and validates a closed generated-score schema: run/aggregate identities,
route metadata, timestamps, nullable telemetry, score ranges, penalty counts,
availability counts, unique run IDs, aggregate `n`, pass rate, and every
deterministic aggregate mean. Unknown keys or prompt/raw-output/transcript/
secret payloads fail the command.

JSON files may contain one answer or an array. JSONL uses one answer per
non-empty line. Directories are searched recursively. Recognizable generated
architecture score/report objects are skipped so an output directory may sit
below an answer directory. An object that merely claims a generated operation,
but does not have the complete generated envelope, is validated as an answer
and fails; arbitrary invalid JSON is never hidden.

Duplicate `runId` values fail the whole input batch.

## Closed suite schema

Every object is closed; unlisted keys are invalid. The top level contains:

- `schemaVersion: 1`;
- controlled `suiteId`;
- non-empty `repositories`;
- non-empty `cases`.

A repository contains only:

- `id`;
- exact lowercase 40-hex `commit`;
- repository-relative `exclusions`;
- `modes`, with boolean M0, M1, M2, M3, and M4 keys.

A case contains only:

- `id`, `repositoryId`, and one fixed `taskClass`;
- lowercase SHA-256 `packetHash`, `acceptanceHash`, `fixtureHash`, and
  `groundTruthHash`;
- `expected`;
- `forbiddenClaims`;
- `unsupportedClaims`.

`expected` has `canonicalPaths`, `symbols`, `edges`, `instructionFacts`, and
`gateFacts`. A symbol is `{ "path", "name" }`; an edge is
`{ "from", "to", "kind" }`. Facts are controlled identifiers, not prose.
`forbiddenClaims` and `unsupportedClaims` expose the same five claim categories,
using `paths` instead of `canonicalPaths`.

`groundTruthHash` is not a label. Validation recomputes SHA-256 over a
stable-key serialization of the repository ID, exact repository commit, case
ID, normalized `expected`, `forbiddenClaims`, and `unsupportedClaims`. Changing
the commit, relabeling the repository/case, or editing ground truth therefore
invalidates the hash. Packet, acceptance, and fixture content stays outside the
durable suite, so those identities must be produced by the controlled
experiment packager.

Suites must not contain prompts, secrets, source snippets, narrative model
output, or product data. Repository exclusions identify paths that cannot
support valid evidence; they do not authorize source capture.

## Closed answer schema

An answer contains only:

```json
{
  "schemaVersion": 1,
  "runId": "architecture-run-003",
  "caseId": "case-c4-gates",
  "mode": "M2",
  "route": {
    "routeSlot": "architecture-analysis",
    "role": "architecture-planner",
    "harness": "codex",
    "requestedModel": "gpt-5.6-sol",
    "resolvedModel": "gpt-5.6-sol",
    "reasoning": "xhigh"
  },
  "startedAt": "2026-07-23T10:00:00.000Z",
  "endedAt": "2026-07-23T10:01:00.000Z",
  "tokens": null,
  "costUsd": null,
  "waitMs": null,
  "claims": {
    "paths": [],
    "symbols": [],
    "edges": [],
    "instructionFacts": [],
    "gateFacts": []
  }
}
```

Each claim is structured and contains only its identity plus `evidenceRefs`:

- path: `{ "path", "evidenceRefs" }`;
- symbol: `{ "path", "name", "evidenceRefs" }`;
- edge: `{ "from", "to", "kind", "evidenceRefs" }`;
- instruction/gate fact: `{ "id", "evidenceRefs" }`.

An evidence reference is
`{ "path": "relative/file", "startLine": 1, "endLine": 2 }`. It identifies
where evidence can be rechecked but contains no snippet. Lines are positive and
inclusive. A claim has valid evidence only when it has at least one reference,
every reference resolves to an expected canonical path, and no reference is
inside an exclusion.

Timestamps are exact UTC ISO-8601 strings and `endedAt` cannot precede
`startedAt`. `tokens`, `costUsd`, and `waitMs` are nullable. Unknown telemetry
must remain `null`; zero means measured zero.

Keys representing prompts, secrets, passwords, API keys, source snippets,
transcripts, narrative content, or model-output payloads are rejected
recursively.

## Deterministic normalization and scoring

Normalization does not read the filesystem:

1. strings are trimmed and Unicode-normalized with NFC;
2. path separators become `/`;
3. leading `./`, empty segments, and internal `.` segments are removed;
4. absoluteness is checked after trimming; absolute paths and any input
   containing `..` are invalid;
5. symbol names, fact IDs, edge kinds, and case-sensitive path segments retain
   case;
6. an edge code reference must contain a valid repository-relative path and an
   optional controlled symbol after `#`; a value such as
   `src/router.mjs#routeRequest` normalizes both portions separately;
7. duplicate normalized claims count once in set metrics.

All scores are numbers in the inclusive range 0-1:

- `canonicalHitAt1`: first claimed path equals the first canonical path;
- `pathRecall`: canonical paths claimed / canonical paths expected;
- `symbolRecall`: canonical symbols claimed / canonical symbols expected;
- `edgePrecision`: correct edges / edges claimed;
- `edgeRecall`: correct edges / edges expected;
- `instructionCoverage`: expected instruction facts claimed / expected;
- `gateCoverage`: expected gate facts claimed / expected;
- `validEvidenceRatio`: claims with valid evidence / claims;
- `falseClaimRate`: unique claims outside expected ground truth / unique claims;
- `taskPass`: deterministic threshold result, encoded as 0 or 1.

Recall and coverage are `1` when the expected category is empty. Precision is
`1` only when both claimed and expected sets are empty. `validEvidenceRatio` is
`0` when there are no claims. `falseClaimRate` is `0` when there are no claims.

`taskPass` is `1` only when:

- `canonicalHitAt1` is 1;
- path recall and symbol recall are at least 0.8;
- edge precision and recall are at least 0.8;
- instruction and gate coverage are at least 0.8;
- valid evidence ratio is exactly 1;
- false claim rate is exactly 0;
- no forbidden or unsupported claim is present.

Everything else is `0`. No model judge, fuzzy match, embedding, or narrative
interpretation participates. Forbidden and unsupported claim counts remain
visible as penalties; stale claims are false claims because they are absent
from the SHA-pinned expected identity.

## Repetitions and aggregation

Every repetition remains a separate run in `runs`. Available-mode runs are
aggregated by:

- repository;
- task class;
- mode;
- role;
- resolved model;
- harness;
- packet hash;
- acceptance hash;
- fixture hash;
- ground-truth hash.

Each row reports `n`, numeric means for every score, `passRate`, and mean
duration. Token, cost, and wait means are `null` if any contributing repetition
has unknown telemetry. Different benchmark identities never share a group.
Unavailable modes appear only in the run-level availability count and HTML
unavailable list.

## Private output boundary

The output directory is forced to mode `0700`. JSON and HTML files are forced
to `0600`. HTML escapes every rendered string, is standalone, and includes
`noindex,nofollow`.

Generated reports are summaries, not raw-output archives. Do not add prompts,
source snippets, complete model responses, credentials, private product data,
or unrelated measurement-v2 records to an answer or report. Keep raw harness
capture in its separately governed ephemeral location and retain only the
closed answer after validation.
