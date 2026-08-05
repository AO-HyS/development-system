---
name: measure-development-run
description: Measure a real Codex development task retrospectively from its first user prompt through the prompt that invokes this skill. Use when the user asks to quantify delivery time, tokens, agents, tool failures, rework, scope completion, functional evidence, code or architecture or security quality, intervention, cost, lessons, or improvement opportunities for the current or an archived Codex task.
---

# Measure Development Run

Create one private, append-only evidence snapshot for the current Codex task. Analyze all work types, including planning, diagnosis, implementation, review, QA, release, and mixed runs.

Measure first; interpret second. Never turn missing telemetry into an estimate.

## Run the measurement

1. Read `references/measurement-contract.md`.
2. Resolve the installed skill directory:

   ```sh
   measurement_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/measure-development-run"
   ```

3. Create an isolated working directory:

   ```sh
   measurement_work_dir="$(mktemp -d)"
   ```

4. Collect deterministic telemetry. The default cutoff is the latest user prompt, which is the invocation boundary:

   ```sh
   node "$measurement_skill_dir/scripts/measure-development-run.mjs" collect \
     --output "$measurement_work_dir/telemetry.json"
   ```

5. Create the assessment template:

   ```sh
   node "$measurement_skill_dir/scripts/measure-development-run.mjs" template \
     --output "$measurement_work_dir/assessment.json"
   ```

6. Inspect the telemetry, the visible conversation, repository evidence, and any relevant read-only Git, test, CI, PR, preview, production, or tracker evidence. If compaction hides necessary history, inspect only the required user and assistant records from the exact `source.sessionPath` reported by telemetry. Do not copy or persist a full transcript.
7. Replace every placeholder in `assessment.json`. Use direct evidence. Mark unavailable evidence as `unavailable`; do not infer success from implementation, labels, or file presence.
8. Finalize the immutable JSON and Markdown reports:

   ```sh
   node "$measurement_skill_dir/scripts/measure-development-run.mjs" finalize \
     --assessment "$measurement_work_dir/assessment.json"
   ```

9. Validate the emitted JSON path:

   ```sh
   node "$measurement_skill_dir/scripts/measure-development-run.mjs" validate \
     --measurement "<absolute-json-path>"
   ```

10. Return measured work plus attributable external wait as the headline duration, followed by agent operational time, external wait, outcome, biggest loss, and saved report paths. Treat thread span only as context. Do not claim the skill is complete until both files exist and validation passes.

## Preserve the boundary

- Measure the entire Codex thread/task from its first real user prompt through the user prompt that invoked the skill. Do not reset the boundary after scope changes, resumptions, or additional implementation phases in the same thread.
- Exclude the measurement turn itself. Use `--cutoff now` only for development or explicit forensic backfills where no invocation prompt exists, and disclose that boundary.
- Do not report task age or thread span as delivery duration. Agent operational time is completed plus in-progress parent-turn time and already includes waits for tools and child agents within those turns.
- For every `externalTiming` entry, set `verified` explicitly and set `overlap` to `inside-active-turn`, `outside-active-turn`, or `unknown`. Verified outside-turn entries require non-empty evidence plus exact `startedAt` and `endedAt` timestamps; `durationMs` must match that interval. The finalizer rejects overlap with active turns and unions concurrent outside intervals. Keep unknown overlap separate.
- Treat between-turn gaps as unattributed idle time and exclude them from the headline unless direct external evidence records a non-overlapping wait.
- Keep controlled model benchmarks separate from real-work measurements.
- Count parallel agent time as agent-minutes, not additional elapsed time.
- Separate product defects, test defects, infrastructure blockers, permission blockers, harness limitations, scope changes, and human waits.
- Treat outcome correctness and verified quality as prior to scope, speed, and cost.
- Do not create one composite score.
- Never store raw prompts, assistant messages, reasoning, tool inputs, tool outputs, secrets, credentials, or environment values in the measurement artifacts.
- Preserve every prior snapshot. A correction must set `supersedes` to an earlier measurement ID and create new files.

## Require an honest retrospective

Always finish the Markdown report with concrete recommendations. Include what worked, what failed, time loss, rework, missing evidence, and one to five changes whose expected impact and validation method are explicit.
