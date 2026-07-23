# Development System 0.8 recertification

Linear: AOH-215  
Date: 2026-07-23  
Mode: read-only against HOME and product repositories

## Decision

Development System 0.8 remains structurally healthy and its critical lifecycle
interface is operational in Codex, T3Code, and Factory. The result does not
claim exhaustive live influence for every installed skill: the catalog audit
proves all 20 logical skills structurally, the skill probe proves live influence
for `research`, and the operator probe proves the router plus six explicit
lifecycle skills.

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
- `evidence/harnesses-live-2026-07-23-recertification.json`: all AO, simple,
  NutriPlan, Barber, and nested AOHYS scenarios passed across Codex, Factory,
  and the T3Code/Codex adapter. The first AOHYS/Codex failure is retained under
  `recoveredFailures`; it exposed an evidence normalizer that rejected the
  equivalent phrase `unmodified`. The focused fix and retry passed.
- `evidence/repository-smoke-2026-07-23-recertification.json`: AOHYS, The Barber
  Central, ETERIA, and NutriPlan were fingerprinted against their current HEAD
  and status hash. All four completed with zero side effects and unchanged Git
  status. This evidence makes no rollout-readiness claim.

## Recovery

The full isolated scenario proves install, drift detection, failed validation,
reinstall, HOME rollback, skill synchronization, skill rollback, lifecycle
authorization, and repository preparation. The real HOME was not rolled back
because its audit and validation were healthy.

## Residual operational findings

- Codex emits a catalog warning without overflow. Catalog size is 401 of 512,
  with no broken links, scanner errors, or orphaned entries.
- Codex startup repeatedly attempts to refresh the `mercadopago-mcp-server`
  OAuth client and receives `invalid_client`. It does not invalidate lifecycle
  results, but it adds repeated startup noise and latency.
- The full harness validator produces no progress events and took more than
  five minutes for 15 live surface checks. Full-repo live validation should
  remain serial at the expensive-analysis level, while the command should emit
  scenario start/end timing so waiting and saturation are observable.

