# Development System contract 1.0.0

Version 1.0.0 retains every 0.9.1 lifecycle, authorization, adapter, benchmark, repository-preparation, delivery, and rollback guarantee. It adds private real-run measurement with delivery-time semantics that exclude idle task age.

## Real-run measurement

- `measure-development-run` is a Codex-only skill because it depends on `CODEX_THREAD_ID` and Codex session JSONL. Factory support is intentionally absent.
- One measurement covers the entire Codex thread/task from its first real user prompt through the user prompt that invokes the skill. Scope changes, resumptions, and additional phases do not reset the start boundary.
- The measurement turn itself is excluded from the normal cutoff.
- Active, archived, completed, partial, failed, blocked, abandoned, and superseded tasks remain measurable while their local session evidence exists.
- Controlled capability benchmarks and real-work measurements remain separate evidence sets.

## Operational time

- The primary duration is measured work plus attributable external wait, not the age of the Codex task.
- Agent operational time is the sum of completed and in-progress parent-turn duration. It includes time while Codex is reasoning, executing tools, waiting for tool results, or waiting for child agents during an active turn.
- External CI, deployment, queue, or provider timing must declare whether it occurred inside an active turn, outside active turns, or has unknown overlap. Verified outside-turn waits require evidence and exact interval boundaries. Concurrent intervals are unioned, not summed; intervals that overlap agent operational time are rejected.
- Thread span remains recorded as context from the first prompt through invocation, but it is never presented as delivery time.
- Gaps between completed turns and later user prompts are unattributed idle time. They are excluded from operational time and cannot be labeled human wait without direct evidence.
- Child-agent duration remains capacity consumption. It is not added to elapsed delivery time because it can overlap the parent turn and other agents.
- Telemetry, assessments, and measurements use schema version 2. The validator can read pre-release schema-version-1 measurement snapshots without claiming they were part of a published earlier contract.

## Evidence and interpretation

- Deterministic telemetry records observable timestamps, token counters, turns, tools, failures, models, agents, concurrency, and repository provenance without persisting transcript text, reasoning, tool inputs, or tool outputs.
- Assessment records objectives, scope completion, functional evidence, quality, architecture, security, human intervention, errors, rework, costs, limitations, and improvement recommendations.
- Missing data remains `unavailable`; implementation does not imply runtime success and a copied skill does not imply load or influence.
- There is no composite score. Evaluation priority is verified outcome, quality/architecture/security, scope, speed, then cost.
- Monetary costs are recorded only from an authoritative reported source.

## Privacy and persistence

- Reports are private JSON and Markdown under `~/.development-system/measurements/`.
- Files and containing task directories are user-only.
- The collector structurally never copies full prompts, assistant messages, chain-of-thought, tool arguments, raw tool output, credentials, secrets, or unrestricted environment data. Assessment validation rejects common credential formats; arbitrary unlabeled secret formats still require deliberate redaction before persistence.
- Each invocation creates a new immutable snapshot. Corrections link to the prior measurement rather than overwrite it.
- Every Markdown report ends with evidence-backed recommendations whose expected impact and validation method are explicit.

## Installation and authorization

- Catalog 0.4.0 preserves the 21 logical skills and 42 physical variants from catalog 0.3.1, then adds one Codex-only measurement skill for 22 logical skills and 43 physical variants. The measurement entry records why Factory is out of scope.
- HOME remains generated state for canonical installation. Local development installation does not become published provenance.
- This contract does not expand permission to push, open or merge pull requests, publish, release, deploy, activate paid infrastructure, or modify external systems.
