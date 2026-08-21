# Release surface classification

Every primary product repository must decide deployment from the changed
surfaces before contacting a runtime provider. Branch membership alone is not a
deployment decision.

## Required behavior

1. Normalize and deduplicate repository-relative changed paths.
2. Treat Development System installation metadata, documentation, and tests as
   verification-only unless the repository documents a runtime dependency.
3. Map known runtime paths to the smallest provider targets that consume them.
4. Keep independent surfaces independent. A native-only change does not deploy
   an unrelated web application; a standalone Worker does not rebuild Vercel
   applications unless they consume its build output.
5. Treat an empty, unavailable, or unclassified diff as a full deployment. The
   optimization must fail safe, never suppress a required release.
6. Let explicit manual dispatch preserve the operator's requested deployment.
7. Keep validation and deployment separate: skipping a provider build does not
   skip the focused checks that apply to the changed files.

## Managed metadata

The default metadata-only set is:

- `.development-system/repository.json`
- `.codex/development-system/repository.md`
- `.factory/development-system/repository.md`

Repositories may add local verification-only paths, but they must not copy a
different product's runtime map. Provider-specific adapters remain in the
product repository and are tested as pure classification logic.

## Observable contract

A release plan reports changed files, selected targets, skip reasons, and
whether a fail-safe fallback was used. Provider workflows consume this plan;
they do not independently guess affected applications.
