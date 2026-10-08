# Development System repository instructions

Read the relevant parts of `docs/spec.md` and accepted ADRs. The spec is the
historical bootstrap proposal; use the current versioned contract for execution.
Current user instructions override skill guidelines. Preserve platform security
requirements and repository protections. If guidance blocks authorized work,
identify its exact file and instruction and explain why it applies.

## Workspace and task continuity

Follow [the branch-first workflow](docs/workflow/branch-first.md). Use the
canonical checkout; new tasks start from updated `develop`, and resumed tasks
keep their existing branch. Worktrees require an explicit request for that task,
including experiments. Preserve pending work before switching branches. Read and
update `docs/current-work.md` so a resumed session does not restart the work.

## Codex host model profile

Preserve the parent selected at session start. New sessions request
`gpt-6.1-sol` High at normal speed. For nontrivial work, Haiku 5.5 Medium through an available Claude route
collects bounded source facts; Opus 5.5 plans; a distinct fresh Sol 6.1 High
reviews the plan before writing; and an independent Sol 6.1 High reviews the
integrated result. For explicitly selected Codex-only work, general writers
request Sol 6.1 Medium; exact and mechanical
packets request Haiku 5.5 Medium through protected native Claude roles.
Codex-only native profiles remain explicit choices, never automatic fallback;
without an observed protected Haiku writer route the parent edits directly. Planning and review remain independent.
With an Anthropic parent, Sol 6.1 High plans and a fresh independent Opus 5.5
reviews the plan. Use existing read-only native/T3 routes and preserve explicit
provider restrictions. Resolve material objections; an unresolved blocker or
missing cross-family contrast prevents plan acceptance without an explicit user
decision. Reread updated installed instructions at the next safe turn before
delegation; current calls keep their model, and inactive threads adopt on resume.
Mappings are provisional until observed runtime evidence confirms identity,
effort, tier and required browser or vision capabilities. Never silently change
provider or reduce acceptance when a capability is unavailable.

## Canonical-source rules

- Treat `artifacts/` and `manifests/` as immutable published contract versions. Change behavior in a new semantic version rather than rewriting a published version.
- Every artifact hash, harness, destination, and mirror relationship must remain explicit in its version manifest.
- HOME files are generated outputs. Verification and scenarios must use an isolated `--home`; never write to the operator's real HOME during verification.
- Do not claim harness discovery, loading, or behavioral influence from a successful file copy. Those require operational adapter evidence.

## Verification

Real verification is `pnpm run typecheck`, `pnpm run release:prepare`,
`pnpm run roster:check`, `development-system check-no-tests`, the isolated-HOME
install script, and live hook or browser observation; no automated tests are
created or run. Do not run `pnpm run verify`,
`pnpm run scenario`, or another full repository suite unless the user
explicitly requests that broad gate for the current run. When explicitly
requested, the scenario must demonstrate installation, drift detection, failed
validation, reinstall, rollback, and preservation of unrelated files.

## Authorization boundary

Repository publication and feature-branch PRs may be part of an explicitly authorized ticket. Do not merge, create a release, publish a package, deploy to production, activate paid infrastructure, or perform destructive cleanup without user authorization for that exact operation. One explicit instruction
can authorize several operations; retain it across turns rather than asking again.
