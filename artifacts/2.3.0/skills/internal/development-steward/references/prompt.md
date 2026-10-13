# Development Steward weekly review

Perform one read-only weekly Development Steward review for exactly these repositories:

- AO-HyS/aohys.com
- corrortiz/casa-roca
- AO-HyS/the-barber-central
- AO-HyS/nutri-plan
- AO-HyS/eteria
- AO-HyS/development-system

Inspect local repository evidence and, when available without authentication changes, public primary-source upstream documentation. Report architectural drift, stale development-system guidance, dependency or platform updates with an exact current version, candidate version, relevant diff, and changelog, and deterministic maintenance that merits human review.

In every run, explicitly inspect these four independent toolchain rows even if no repository declares them directly:

1. `react-doctor`: exact version pinned by each applicable repository versus the exact stable npm release.
2. `impeccable-cli`: exact globally installed CLI version versus the exact stable published npm release.
3. `impeccable-skill`: exact installed umbrella skill version and source commit versus the exact stable `skill-v*` release.
4. `matt-pocock-skills`: exact installed bundle commit/tag versus the exact stable release, plus a behavioral check that `grilling` asks the whole current question frontier in one numbered round with one recommendation per question.

Do not combine these into one generic `skills` claim. A floating branch, `latest` alias, version inferred from source `main`, or version label without the required behavioral check is `unproven`.

Read repeated mistakes with the read-only command `development-system mistake list --repeated --json`. For each repeated id, add one evaluation with `area` `repeated-mistake` under the repository its incidents point to. Its `summary` names the id and either proposes the hard control at the highest level of the Gardener ladder (code > lint/CI/guard > rule/skill) or states the existing recorded control. A style note alone is not a control. If the command is unavailable, mark the repeated-mistake review `unproven`; never invent an id or incident.

Return only one raw JSON object, without Markdown fences or commentary. It must have `observedAt` as an ISO timestamp and `repositories` as an array containing only the six explicitly allowlisted repository IDs: `aohys`, `casa-roca`, `the-barber-central`, `nutri-plan`, `eteria`, and `development-system`. For each repository include its exact 40-hex `revision`, or an `error` when collection failed; `upstream` entries with `id`, exact `current`, exact `candidate`, `diff`, and `changelog`; and `evaluations` with `id`, `area`, `state`, `summary`, `deterministic`, `safeUpdate`, `focusedChecks`, and `device`. Use `unproven` whenever evidence is unavailable or ambiguous. Never manufacture a revision, version, diff, changelog, or successful check.

This run is read-only. Do not edit repositories or HOME configuration, create branches or commits, push, open or modify pull requests, write to trackers, change credentials, activate services, merge, release, deploy, promote production, or run destructive commands. You may recommend a bounded draft change, but you must not perform it. Never print secrets or environment values.


Request Sol 6.1 High; report observed identity or unknown. This is the read-only collection packet for the single recurring Steward, never activate another schedule. No automated tests or evals. For Development System, Casa Roca, Barber and NutriPlan, collect at most ten recent relevant real sessions each: sessions [{repositoryId,sessionId,revision or updatedAt,complete,evidence:[bounded pointers]}]. Do not include transcripts or credentials. In repository evidence include clean:true only after a real clean-tree observation, activeWriter:false only after ownership is established, otherwise unproven. A proposed deterministic change needs a stable changeId; never use revision as its identity. Failed publication remains pending. Return verified existing PR receipts only with exact repository, changeId, revision, verified:true, status:open-pr/resolved/no-change, evidence pointers and prUrl for an open PR. Session completion never proves change resolution. The ledger suppresses duplicates across revisions and keeps pending recommendations separate. Never auto merge, write business data or credentials, release main or production. A separately authorized writer can prepare one bounded draft PR per repository only after clean/ownership/revision proof and focused checks; this collector itself stays read-only.
