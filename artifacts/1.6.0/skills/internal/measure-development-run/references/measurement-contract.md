# Measurement contract

## Evidence hierarchy

Use evidence in this order:

1. Runtime or production behavior.
2. Preview or browser QA behavior.
3. Executed tests and checks whose real surface is known.
4. Independent review findings and dispositions.
5. Git, PR, CI, deployment, and tracker records.
6. Conversation claims.

Implementation is not proof that behavior works. A green label is not proof that the intended command or surface ran.

## Deterministic telemetry

The collector reads the exact Codex JSONL identified by `CODEX_THREAD_ID`. It persists metadata only:

- first prompt and invocation timestamps;
- agent operational time, thread span, unattributed between-turn time, tool time, and subagent time;
- cumulative Codex token counters observed before the invocation;
- parent and child model/reasoning metadata when available;
- counts and durations of tool calls, failures, incomplete calls, turns, and messages;
- subagent count and peak concurrency;
- session, repository, CLI, and cutoff provenance.

Agent operational time is the sum of completed and in-progress parent turns. It includes Codex reasoning, tool execution, waits for tool results, and waits for child agents while the parent turn remains active.

Thread span runs from the first prompt through invocation. It is context, not delivery duration. Between-turn gaps are unattributed idle time and remain excluded from the operational headline.

Tool and subagent durations are subsets of parent-turn time. Do not add them to operational time. Agent-minutes may sum parent and child active time because they measure consumed capacity rather than elapsed delivery time.

Codex session telemetry does not currently report monetary model cost. Record it as unavailable unless a separate authoritative source exposes it.

## Assessment rules

Fill every field in the generated template.

### Status vocabularies

- Overall: `success`, `partial`, `failed`, `blocked`, `abandoned`, `superseded`.
- Scope: `completed-verified`, `completed-unverified`, `partial`, `not-done`, `out-of-scope`, `blocked`.
- Delivery evidence: `verified`, `reported`, `failed`, `not-reached`, `not-applicable`, `unavailable`.
- Quality: `verified`, `adequate`, `insufficient`, `not-applicable`, `unavailable`.
- Work type: `planning`, `diagnosis`, `implementation`, `review`, `qa`, `release`, `mixed`, `other`.
- Error category: `product`, `test`, `infrastructure`, `permission`, `harness`, `scope-change`, `human-wait`, `tool`, `unknown`.
- Confidence: `high`, `medium`, `low`.

### Scope

Create one item for each explicit initial objective and each material objective added later. Do not hide unfinished work by relabeling it out of scope. Give every item a status and concise evidence.

### Outcome

Assess these independently:

- implementation;
- local checks;
- independent review;
- runtime behavior;
- preview;
- production.

Use `not-applicable` where the requested terminal state genuinely did not require a surface. Use `not-reached` when it was relevant but the run stopped earlier.

### Quality

Assess code, architecture, and security separately. State the executed evidence and remaining gaps. Security may be `not-applicable` only after considering whether the work changed authentication, authorization, secrets, trust boundaries, or sensitive data.

### Errors and intervention

Record implementation errors and corrections that deterministic tool telemetry cannot classify. Separate required human authorization from clarification, correction, and rescue.

Record externally observed CI, deployment, queue, or provider duration in `externalTiming`. Set `overlap` to:

- `inside-active-turn` when the parent turn already includes the wait;
- `outside-active-turn` when evidence proves the wait occurred after the agent stopped and before results became available;
- `unknown` when overlap cannot be established.

The headline is agent operational time plus only `outside-active-turn` external timing. Keep `unknown` duration visible but excluded to avoid double counting. Record retry counts, reason, and evidence in `retries`.

Every external timing entry must set `verified`. A verified entry needs non-empty evidence. An `outside-active-turn` entry also needs exact `startedAt` and `endedAt` timestamps, and `durationMs` must equal the interval. The finalizer rejects intervals outside the measurement boundary or overlapping an active parent turn. It unions concurrent verified outside intervals before adding them to the headline.

### Costs

Record only reported monetary or infrastructure costs with their source. Never derive dollars from time or tokens without a versioned price source.

### Retrospective

Recommendations must be actionable experiments, not generic advice. Each needs:

- action;
- reason tied to evidence;
- expected impact;
- validation method.

## Privacy

Do not include full messages, chain-of-thought, tool arguments, raw tool output, credentials, tokens, secrets, personal data, or unrestricted environment dumps. Prefer references such as commit SHA, PR number, check name, deployment ID, or thread ID.

Reports live under `~/.development-system/measurements/codex/` with user-only permissions. JSON is authoritative; Markdown is the review surface.
