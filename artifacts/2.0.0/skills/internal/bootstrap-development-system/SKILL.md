---
name: bootstrap-development-system
description: Read task-relevant repository guidance and diagnose the shared Development System installation without creating repository adapters.
---

# Use the shared Development System

Read the repository AGENTS.md and README, then only documents relevant to the
current task. Preserve product domain, design, release rules and active work.
There is no repository adapter or mandatory replacement index.

Run `development-system doctor --json` to identify the active package, contract,
catalog and launcher consistency. Run `development-system audit-repository
--repository /absolute/canonical/root --json` only for a relevant structural
audit; preserve real QA/preview/certification gaps. Do not invent product scripts
or require an adapter to make an audit green. `initialize-repository` and
`normalize-repository` are retired and fail before writes.

Install or update the shared package explicitly when authorized. Product-local
pinned package commands serve explicit CI checks only. Never use a product
alias to render reports, install skills or orchestrate agents. Installation,
host loading and task influence are different observations; record each honestly.
No automated tests or evals. No source edits or external effects in this audit.
