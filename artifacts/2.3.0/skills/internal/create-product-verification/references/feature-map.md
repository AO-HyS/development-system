# Feature map entry

Each entry is current repository truth, not an aspirational inventory. Reuse the
repository's existing map file and format; these are the facts every entry needs.

- **Feature:** stable identifier and the primitives it composes (ids from
  `docs/architecture/primitives.json` when the repo has one).
- **How to get to it (user POV):** route or screen, role, preconditions.
- **Driving it:** the QuickE2E flow (start path, inputs, `expect`/`expectUrl`,
  `neverClick` for destructive controls) or the repo CLI command.
- **Proof:** the observable end state, the side effects to check, and the denied
  case for a role that must not reach it.
- **Cleanup:** how to remove what the drive created.
- **Gotchas:** missing seed data, flaky waits, prerequisites.
- **Status:** mapped | proven | blocked (with reason).

Evidence lives under `$HOME/.development-system/private/verification/<run-id>`,
never in the repository, and never contains credentials or personal data.
