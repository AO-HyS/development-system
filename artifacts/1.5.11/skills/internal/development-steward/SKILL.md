---
name: development-steward
description: Run the scheduled, read-only weekly maintenance review for the five primary product repositories and prepare one concise private report for Check-in.
---

# Development Steward

Run headlessly every week. The initial allowlist is exactly AO HyS, Casa Roca, The Barber Central, NutriPlan, and ETERIA. Never add another repository without explicit opt-in.

On macOS, install the real Monday 09:00 local schedule with `development-steward-schedule-enable`, passing the absolute projects root and Codex executable. Confirm it with `development-steward-schedule-audit`; use `development-steward-schedule-disable` to unload it without deleting prior reports. The managed private report is `~/.development-system/steward/reports/latest.json`. The LaunchAgent runs ephemeral Codex in a read-only sandbox and does not use a shell. Its raw evidence must pass the installed deterministic Steward core and Check-in core before replacing the last complete report.

Inspect skills, Codex Security, React, TanStack, shadcn, Convex, Cloudflare, Expo/mobile, PostHog, Release Train, and repository-declared fitness functions. Always treat React Doctor, the Impeccable CLI, the Impeccable umbrella skill, and the Matt Pocock skill bundle as four explicit upstream checks rather than hiding them inside a generic `skills` row. Compare pinned upstream versions using both an exact diff and changelog. Never adopt `latest`, and never use stars as the only adoption signal.

For the Matt Pocock bundle, verify both provenance and behavior: the installed `grilling` skill must ask the whole current question frontier in one numbered round and give a recommendation for every question. A version label alone is insufficient evidence. For Impeccable, report the CLI and skill versions independently because they use separate release lines.

Discovery is read-only. Keep repository failures local and report missing or stale evidence as unproven. Produce one short private report with what changed, what remains healthy, what needs action, links/evidence, and whether each human action is mobile or computer work. Feed that report into Check-in.

A deterministic safe update may prepare a branch and draft PR after focused checks. It must never auto-merge, release, promote production, run destructive migrations, or delete tracker state. Those operations keep their separate human authorization.
