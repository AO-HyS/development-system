# ADR 0069: one shared agent installation, no repository adapters

Status: accepted by the operator on October 5, 2026; implementation authorized
through publication and production tooling adoption. Supersedes adapter generation
in ADR 0008 and the product dependency as normal agent entry point. Historical
published contracts and operational evidence remain immutable.

## Decision

Install the active runtime, contract, paired catalog and host-facing managed files
once per computer. Serialize updates, record private recovery state and restore
the immediately previous complete tuple on rollback. Agents use the global
`development-system`; products retain specific versioned CI checks only.
Repository context is discovered on demand from existing product docs. No adapter
or replacement mandatory index is generated. Retirement removes only known paths
and preserves unique product content. Structural command/QA/preview criteria stay.

T3 owns app-owned task execution/history/browser/scheduling. Shared pure planning,
acceptance and operation-specific authority controls remain. Retire launchd enable
for this T3-owned profile, even from an ordinary terminal. External process recovery
is separate and does not become a T3 child task controller. Jev automatic dispatch
was already disabled and stays disabled; standalone explicit advice remains.

## Evidence and limits

Report receipts identify the invoked package, exact source revision, intended
renderer path/hash and rendered output. Completion reports fail on active-package
mismatch; historical rendering is explicit. Installing bytes does not prove host
loading or influence. Observe fresh relevant tasks in the focus products after a
central update. Never hot-switch an existing thread's model or loaded context.

The current Codex named profiles do not establish enforced writer admission or
Git restrictions. Admit no writing children until those controls are observed.
The authorized selected parent performs sequential direct editing; fresh native
readers/reviewers remain independent. This does not certify a protected child
writer route or authorize cross-provider source writes.

No automated tests or evals. Acceptance uses focused source checks, isolated HOME
installation/failure/recovery/rollback, real hook/task observations, independent
review and release/install receipts. Preserve active branches and ownership.
No new worktrees, arbitrary repository discovery, paid services or product data
mutations are needed for this change.
