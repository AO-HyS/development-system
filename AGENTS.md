# Development System repository instructions

Read `docs/spec.md` and the ADRs relevant to the surface being changed.

## Canonical-source rules

- Treat `artifacts/` and `manifests/` as immutable published contract versions. Change behavior in a new semantic version rather than rewriting a published version.
- Every artifact hash, harness, destination, and mirror relationship must remain explicit in its version manifest.
- HOME files are generated outputs. Tests and scenarios must use an isolated `--home`; never write to the operator's real HOME during verification.
- Do not claim harness discovery, loading, or behavioral influence from a successful file copy. Those require operational adapter evidence.

## Verification

Run focused CLI tests while editing. Before handoff, run:

```sh
pnpm run verify
pnpm run scenario
```

The scenario must demonstrate installation, drift detection, failed validation, reinstall, rollback, and preservation of unrelated files.

## Authorization boundary

Repository publication and feature-branch PRs may be part of an explicitly authorized ticket. Do not merge, create a release, publish a package, deploy to production, activate paid infrastructure, or perform destructive cleanup without separate authorization for that exact operation.
