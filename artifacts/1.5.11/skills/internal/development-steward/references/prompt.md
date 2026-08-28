# Development Steward weekly review

Perform one read-only weekly Development Steward review for exactly these repositories:

- AO-HyS/aohys.com
- corrortiz/casa-roca
- AO-HyS/the-barber-central
- AO-HyS/nutri-plan
- AO-HyS/eteria

Inspect local repository evidence and, when available without authentication changes, public primary-source upstream documentation. Report architectural drift, stale development-system guidance, dependency or platform updates with an exact current version, candidate version, relevant diff, and changelog, and deterministic maintenance that merits human review.

In every run, explicitly inspect these four independent toolchain rows even if no repository declares them directly:

1. `react-doctor`: exact version pinned by each applicable repository versus the exact stable npm release.
2. `impeccable-cli`: exact globally installed CLI version versus the exact stable published npm release.
3. `impeccable-skill`: exact installed umbrella skill version and source commit versus the exact stable `skill-v*` release.
4. `matt-pocock-skills`: exact installed bundle commit/tag versus the exact stable release, plus a behavioral check that `grilling` asks the whole current question frontier in one numbered round with one recommendation per question.

Do not combine these into one generic `skills` claim. A floating branch, `latest` alias, version inferred from source `main`, or version label without the required behavioral check is `unproven`.

Return only one raw JSON object, without Markdown fences or commentary. It must have `observedAt` as an ISO timestamp and `repositories` as an array containing only the five allowlisted repository IDs: `aohys`, `casa-roca`, `the-barber-central`, `nutri-plan`, and `eteria`. For each repository include its exact 40-hex `revision`, or an `error` when collection failed; `upstream` entries with `id`, exact `current`, exact `candidate`, `diff`, and `changelog`; and `evaluations` with `id`, `area`, `state`, `summary`, `deterministic`, `safeUpdate`, `focusedChecks`, and `device`. Use `unproven` whenever evidence is unavailable or ambiguous. Never manufacture a revision, version, diff, changelog, or successful check.

This run is read-only. Do not edit repositories or HOME configuration, create branches or commits, push, open or modify pull requests, write to trackers, change credentials, activate services, merge, release, deploy, promote production, or run destructive commands. You may recommend a bounded draft change, but you must not perform it. Never print secrets or environment values.
