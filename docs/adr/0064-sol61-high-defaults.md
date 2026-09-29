# ADR 0064: Sol 6.1 High defaults

## Status

Accepted for Development System 1.37.0 and catalog 0.55.0. Supersedes the
model selections in [ADR 0059](0059-claude-code-orchestration-roster.md) and
[ADR 0061](0061-astra-reviews-through-codex-review.md) only. Their independent
review boundaries, launcher, receipts, guard, fallback and concurrency behavior
remain in force. Claude model roster tiers remain unchanged.

## Context

The operator selected `gpt-6.1-sol` to replace active Astra recommendations and
the previous Sol default. Official references are the
[OpenAI announcement](https://openai.com/index/introducing-gpt-6-1-sol/) and
[model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
These references identify the selected model; this decision makes no benchmark,
evaluation, comparative capability or performance claim.

## Decision

- New Codex sessions request `gpt-6.1-sol` High at normal speed. Preserve the
  parent already selected at session start.
- Planning, independent plan and integrated-result reviews, specialist review,
  visual review and browser execution request `gpt-6.1-sol` High. A distinct
  fresh reviewer still reviews the plan before writing; the final review stays
  independent. Browser execution still verifies browser and vision or Computer
  Use capabilities at dispatch.
- General implementation requests `gpt-6.1-sol` Medium. Luna 6 High priority
  remains the bounded research, exact and mechanical implementation profile.
- Advisory policy 1.4.0 names the decision route `sol61_high_decision`.
  Published policies 1.2.0 and 1.3.0 remain immutable. Claude policy route names
  follow the new policy, with no change to Claude model tiers or guard engine.
- codex-review requests the new model and High effort through both policy and
  fallback defaults. Headroom accepts the new id and retains explicit legacy
  model selections, the existing binary, caller arguments and credential boundary.

## Consequences

Mappings remain provisional until observed host/provider evidence confirms the
actual model, effort and service tier. Requested configuration is not runtime
identity, capability or behavioral acceptance. No silent provider fallback or
reduction in acceptance is permitted when the selected model lacks a required
capability. Publication and installation do not prove that an adapter loaded or
honored the profile. Verification uses isolated HOME and does not exercise
models, invoke Jev, run Headroom or create or run automated tests.
