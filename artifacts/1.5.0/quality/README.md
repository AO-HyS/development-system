# Stack quality profiles 1.5.0

`stack-quality-profiles.json` is the versioned, provider-neutral source for stack guidance and deterministic fitness-function ownership in Development System Next.

- Repositories opt into capabilities; the catalog never applies every profile universally.
- Every rule names exactly one evidence oracle and at least one primary source or recognized standard.
- The read-only auditor reports `findings`, `recommendations`, `exceptions`, and `unprovenEvidence` separately.
- Missing evidence stays unproven. A green result is never inferred from an installed tool or copied file.
- Owned TypeScript forbids `any`, double assertions, TypeScript suppression directives, and equivalent erasure. Only a narrow external-boundary adapter may carry a path-scoped, repository-bound, documented exception.
- shadcn components, registries, and icon choices are update candidates by default. A repository may retain a version only through a documented version pin.
- `expo-react-native` is the default profile for a new mobile capability. Existing or deliberately native products may select `ios` or `android` explicitly.

The catalog records guidance, not product mutations. It performs no network, repository, tracker, provider, or HOME writes.

## Provider-neutral selection API

`selectApplicableQualityChecks(input)` is exported from `src/stack-quality-profiles.mjs` for release and changed-surface consumers. Input declares repository `capabilities` plus `changedSurfaces`, each with a stable `id` and its capability subset. Output groups applicable `ruleIds` and `surfaceIds` by oracle in catalog order and includes empty external-write and side-effect arrays. An empty changed-surface list selects no checks; undeclared capabilities fail closed.
