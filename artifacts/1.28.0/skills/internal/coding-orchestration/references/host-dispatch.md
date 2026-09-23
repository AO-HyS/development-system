# Host-specific dispatch

Read this only when a selected worker needs an external CLI or a provider
availability failure needs handling. Prefer the host's native lifecycle; a
skill does not add capability or authorize provider substitution.

## Governed runs

For an active 1.25 run, use the governance recipe's classified, prepared
`execute` command. The current supported process boundary launches fresh
read-only Codex researchers/planners/reviewers, an isolated Flash writer, or
an approved exact local check. Read the live capability result before selecting
a route. Native writable descendants and the older T3 `run-worker` command do
not inherit governance merely because they exist; they require a separately
proven adapter. Never substitute raw CLI invocation for a denied dispatch.

The compatibility guidance below applies only outside a bound governed run.

When using the Development System resolver, use the real argument array for
the parent-selected model and verify the host's supported model and effort.
Record observed runtime identity before claiming resolution. The resolver
grants no permissions or publication authority.

For a typed quota or availability failure, retain one bounded observation and
respect the user's provider and family constraints. Do not retry the same
unavailable provider without a changed observation.

On T3, use development-system run-worker --input packet.json --json with the
exact current owning thread and turn. Verify path confinement before writable
dispatch and inspect startup plus completion. Process exit proves completion,
not correctness; review the owned diff and receipt. Other hosts use their
attached native cancellation lifecycle.

## Optional Open Code Review delegation

When an optional external review is authorized and the ocr CLI is already
available, deterministic preparation can use the same diff:

    pnpm dlx @alibaba-group/open-code-review@1.12.1 delegate preview --repo ROOT --from BASE --to HEAD
    pnpm dlx @alibaba-group/open-code-review@1.12.1 delegate rule <paths>

Use preview metadata to select the reviewable paths, then pass those paths to
rule resolution before reading each diff. The host reviewer performs the actual
review with the same host model and subscription; delegation does not
configure or require a separate API. Compare the same diff separately and
report findings without claiming that this route is superior. This is an
optional review receipt, never a mandatory gate, provider fallback or new
orchestration layer. See the official delegation guide:
https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/integrations/delegate.md
