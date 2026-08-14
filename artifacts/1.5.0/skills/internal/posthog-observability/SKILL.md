---
name: posthog-observability
description: Audit already-collected PostHog evidence for production instrumentation, errors, releases, performance, conversions, privacy, and bounded draft-fix eligibility without contacting providers.
---

# PostHog Observability

Use this skill to turn repository-specific PostHog configuration and exported
evidence into a deterministic operational report. It is a read-only evaluator:
do not query live PostHog, mutate a project, create alerts, open a draft fix, or
write to any external system.

## Require a production contract

Pass explicit repository policy and collected evidence to
`auditPostHogObservability` in `src/posthog-observability.mjs`. Verify:

- production-only capture and exact canonical hosts;
- anonymous-to-authenticated identity continuity;
- named conversion events and production exception capture;
- immutable release identity and a source map uploaded for that release;
- required Web Vitals;
- session replay with text masking, media blocking, and no sensitive event
  properties.

Missing evidence stays unproven or becomes a finding. Never infer broken
instrumentation from low volume alone.

## Classify before alerting

Classify observations as eligible production signals, production errors,
preview contamination, noncanonical traffic, release mismatch, bot traffic, or
expected validation. An insufficient eligible sample creates an investigation;
it does not silently become an instrumentation failure.

An alert is actionable only when its route names an owner, private destination,
runbook, and threshold. Keep raw event payloads in the provider. Shared and
Check-in reports must never include replay URLs, PII, event properties, or
private payloads; consume only the returned sanitized `checkInFindings`.

## Bound automation

Prepare a draft-fix intent only when the evidence packet contains all of:

- deterministic reproduction at an exact Git revision with concrete steps;
- a bounded root cause naming its module and explanation;
- a passing regression test with an exact path.

The audit decision is `prepare-draft-fix`, but the audit never creates the
draft. Any missing or ambiguous element produces `investigate`.

Do not remove Sentry or another provider until the same repository proves every
declared parity capability. Even proven parity returns a separate retirement
decision; it never removes the provider automatically.

Preserve `readOnly: true`, empty `externalWriteIntents`, and empty
`externalSideEffects` in every result.
