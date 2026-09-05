# Development System repository instructions

Read the relevant parts of `docs/spec.md` and accepted ADRs. The spec is the
historical bootstrap proposal; use the current versioned contract for execution.
Current user instructions override skill guidelines. Preserve platform security
requirements and repository protections. If guidance blocks authorized work,
identify its exact file and instruction and explain why it applies.

## Canonical-source rules

- Treat `artifacts/` and `manifests/` as immutable published contract versions. Change behavior in a new semantic version rather than rewriting a published version.
- Every artifact hash, harness, destination, and mirror relationship must remain explicit in its version manifest.
- HOME files are generated outputs. Tests and scenarios must use an isolated `--home`; never write to the operator's real HOME during verification.
- Do not claim harness discovery, loading, or behavioral influence from a successful file copy. Those require operational adapter evidence.

## Verification

Run focused CLI tests while editing. Do not run `pnpm run verify`,
`pnpm run scenario`, or another full repository suite unless the user
explicitly requests that broad gate for the current run. When explicitly
requested, the scenario must demonstrate installation, drift detection, failed
validation, reinstall, rollback, and preservation of unrelated files.

## Authorization boundary

Repository publication and feature-branch PRs may be part of an explicitly authorized ticket. Do not merge, create a release, publish a package, deploy to production, activate paid infrastructure, or perform destructive cleanup without user authorization for that exact operation. One explicit instruction
can authorize several operations; retain it across turns rather than asking again.
