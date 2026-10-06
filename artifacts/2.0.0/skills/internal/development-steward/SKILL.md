---
name: development-steward
description: Run the scheduled, read-only weekly maintenance review for the six explicitly opted-in repositories and prepare one concise private report for Check-in.
---

# Development Steward

Run headlessly every week. The initial allowlist is exactly AO HyS, Casa Roca, The Barber Central, NutriPlan, ETERIA, and Development System. Never add another repository without explicit opt-in.

T3 scheduler is the preferred current-host runner. Audit both T3 scheduled tasks and the existing macOS LaunchAgent before activation: retain exactly one recurring runner, never activate a duplicate. Keep one stable task and return results to its owning thread. Monday 09:00 local is the existing cadence; activation requires explicit authorization. Legacy launchd activation is retired even from an ordinary terminal. Only `development-steward-schedule-audit` and `development-steward-schedule-disable` remain for inspection and disabling; preserve historical reports and the durable retro ledger. No schedule is enabled by loading this skill.

Request Sol 6.1 High for collection and computer use; report observed identity or unknown, never infer it from the request. Quota recovery uses existing bounded authorized profile recovery and receipts, with no silent provider change.

For Development System, Casa Roca, Barber and NutriPlan, inspect up to ten recent relevant real sessions per repository. Supply stable `repositoryId/sessionId`, exact revision or updatedAt, `complete`, and bounded evidence pointers; never raw transcripts or credentials. Use `development-system development-steward --input <private-json> --home <home> --json` to reconcile the private atomic ledger. Complete session collection advances only its cursor; recommendations remain pending until a verified PR receipt or explicit resolved/no-change. Replaying a processed session reports already-processed. PR identity is repository plus stable changeId across revisions; review an existing open PR instead of creating a duplicate. Failed publication stays pending and retryable. Unknown statuses stay unproven.

Draft preparation requires proven revision, explicit clean=true and activeWriter=false, deterministic safeUpdate and focused checks. Missing ownership or cleanliness evidence blocks drafts. Limit to one bounded draft per repository. The legacy `evaluations` field contains observations only and never authorizes evals or automated tests.

Inspect skills, Codex Security, React, TanStack, shadcn, Convex, Cloudflare, Expo/mobile, PostHog, Release Train, and repository-declared fitness functions. Always treat React Doctor, the Impeccable CLI, the Impeccable umbrella skill, and the Matt Pocock skill bundle as four explicit upstream checks rather than hiding them inside a generic `skills` row. Compare pinned upstream versions using both an exact diff and changelog. Never adopt `latest`, and never use stars as the only adoption signal.

For the Matt Pocock bundle, verify both provenance and behavior: the installed `grilling` skill must ask the whole current question frontier in one numbered round and give a recommendation for every question. A version label alone is insufficient evidence. For Impeccable, report the CLI and skill versions independently because they use separate release lines.

Read repeated mistakes with `development-system mistake list --repeated --json`. The report carries them as `repeatedMistakes: [{ id, incidents, proposedControl }]`. For each id, add one bounded item that proposes the hard control at the highest level of the Gardener ladder (code > lint/CI/guard > rule/skill), or states the existing control when one is recorded. Never propose a style note alone.

Discovery is read-only. Keep repository failures local and report missing or stale evidence as unproven. Produce one short private report with what changed, what remains healthy, what needs action, links/evidence, and whether each human action is mobile or computer work. Feed that report into Check-in.

A deterministic safe update may prepare a branch and draft PR after focused checks. It must never auto-merge, release, promote production, run destructive migrations, or delete tracker state. Those operations keep their separate human authorization.
