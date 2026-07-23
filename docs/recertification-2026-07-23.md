# Development System 0.8 recertification

Linear: AOH-215
Date: 2026-07-23
Mode: read-only against HOME and product repositories

## Decision

Development System 0.8 remains structurally healthy. Codex and Factory passed
the live catalog and lifecycle probes. The installed T3Code application also
passed a real headless server turn through its Codex provider adapter: it loaded
the automatic router and the six explicit lifecycle skills, returned a distinct
behavior signature for each, and preserved repository HEAD and status.

This result does not claim exhaustive live influence for every installed skill.
The catalog audit proves all 20 logical skills structurally, the catalog probe
proves live influence for `research` in Codex and Factory, and the lifecycle
probes prove only the router and six named workflow skills. T3Code is a distinct
live client surface over the Codex provider, not a third physical skill variant.

## Evidence

- Real HOME `audit` and `validate`: healthy at contract `0.8.0`; all generated
  artifact and mirror hashes match. The installed source commit remains
  `e04ad18f415372aa9adf2181706fa6eb2f5c4166`, whose published 0.8 artifacts are
  unchanged by later measurement-only commits.
- `evidence/skills-live-2026-07-23-recertification.json`: Codex and Factory
  catalogued, loaded, and were behaviorally influenced by `research`; installed
  hashes match. The report is explicitly non-exhaustive.
- `evidence/lifecycle-interface-live-2026-07-23-recertification.json`: automatic
  routing plus `wayfinder`, `grill-with-docs`, `to-spec`, `to-tickets`,
  `flow-implement`, and `flow-code-review` passed in Codex and Factory with no
  repository mutations.
- `evidence/t3code-live-2026-07-23-recertification.json`: the installed T3Code
  `0.0.29-nightly.20260722.878` server launched in an isolated data directory,
  dispatched a real `gpt-5.6-sol` turn under `approval-required`, loaded the
  router plus all six lifecycle skills, and passed the current skill audit.
  Independent evidence records 18 completed commands whose native T3Code
  actions are exclusively `read`, `search`, or `list`, zero blocked commands,
  controlled behavior signatures, repository HEAD/status/fingerprint, and all
  13 managed HOME artifacts plus 40 skill variants before and after. The host
  audit ran with structured arguments and T3Code read its hash-bound result from
  the isolated data directory. Its immutable companion
  `evidence/t3code-live-2026-07-23-recertification.attestation.json` binds the
  98,633-byte capture by SHA-256 to evaluator commit `8efa650` and passes. The
  capture's original `ok: false` is retained: the capture-time evaluator
  required an approval event even when the runtime auto-classified every
  observed command as safe, and rejected the equivalent phrase `binary done
  condition`; the separate evaluator fixed only those false negatives.
- `evidence/harnesses-live-2026-07-23-recertification.json`: all AO, simple,
  NutriPlan, Barber, and nested AOHYS scenarios passed across Codex, Factory,
  and the structural T3Code/Codex adapter. This matrix exercises the unchanged
  contract `0.7.0` scenarios and `0.6.0` adapter registry embedded in the 0.8
  installation; it is not the independent T3Code application proof. The first
  AOHYS/Codex failure is retained under `recoveredFailures`; it exposed an
  evidence normalizer that rejected the equivalent phrase `unmodified`. The
  focused fix and retry passed.
- `evidence/repository-smoke-2026-07-23-recertification.json`: AOHYS, The Barber
  Central, ETERIA, and NutriPlan were fingerprinted against their current HEAD
  and status hash. All four completed with zero side effects, unchanged HEAD,
  and unchanged Git status. This evidence makes no rollout-readiness claim.

## Recovery

`evidence/isolated-scenario-2026-07-23-recertification.json` durably records the
full isolated scenario: install, drift detection, failed validation, reinstall,
HOME rollback, skill synchronization, skill rollback, lifecycle authorization,
repository preparation, and 17/17 acceptance tests. Stable real-HOME state was
captured before and after and remained byte-equivalent. The real HOME was not
rolled back because its audit and validation were healthy.

## Residual operational findings

- Codex emits a catalog warning without overflow. Catalog size is 401 of 512,
  with no broken links, scanner errors, or orphaned entries.
- Codex startup repeatedly attempts to refresh the `mercadopago-mcp-server`
  OAuth client and receives `invalid_client`. It does not invalidate lifecycle
  results, but it adds repeated startup noise and latency.
- The exhaustive T3Code turn took 91.5 seconds and reported 359,041 cumulative
  processed tokens. This is a harness diagnostic rather than a billing claim,
  but it proves that loading every lifecycle skill in ordinary implementation
  would be expensive. Daily routing should load only the selected stage; the
  exhaustive path belongs in periodic recertification.
- T3Code also reports an unrelated Grok CLI health-check warning during startup.
  It did not affect the Codex provider turn but should not remain unclassified
  startup noise.
- The full harness validator produces no progress events and took more than
  five minutes for 15 live surface checks. Full-repo live validation should
  remain serial at the expensive-analysis level, while the command should emit
  scenario start/end timing so waiting and saturation are observable.
