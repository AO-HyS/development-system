---
name: flow-qa
description: Run conversational software QA intake and file durable behavioral issues in the repository's configured tracker. Use when the user reports bugs, asks to file issues, or starts a QA intake session.
---

# Flow QA Intake

Read `docs/agents/issue-tracker.md` before writing external state. Use the configured tracker and native integration; do not assume GitHub. If setup is absent, load `setup-matt-pocock-skills` before filing.

For each reported behavior:

1. Ask at most three short questions only when expected behavior, actual behavior, reproduction, or frequency is missing.
2. Inspect the relevant code for domain language and behavioral boundaries. In a Git repository, load `coding-orchestration` and use its read-only `code_mapper` role when useful. Do not diagnose or implement a fix during intake unless separately requested.
3. Split only genuinely independent failure modes. Preserve honest dependencies and create blockers first.
4. File concise, user-facing issues with:
   - what happened;
   - what was expected;
   - numbered reproduction steps;
   - relevant inputs, state, or frequency;
   - additional behavioral context;
   - blocking relationship when applicable.
5. Avoid implementation paths and line numbers in the issue body because they become stale.

When the user already authorized filing, do not add a redundant approval pause. Return identifiers or URLs and a compact dependency summary.
