# Changed-validation benchmark — 2026-07-28

This benchmark measures the ordinary feedback path, not full candidate
certification and not end-to-end feature delivery. Each command injects one
representative changed path through `CHANGED_FILES`, runs the repository's
`quality:changed` contract, and records wall time with `/usr/bin/time -p`.

| Repository | Representative risk | Result | Wall time |
| --- | --- | --- | ---: |
| AOHYS | dashboard navigation source | passed | 17.73 s |
| ETERIA | web pricing tracer source | passed | 21.83 s |
| The Barber Central | shared operational UI source | passed | 13.93 s |
| NutriPlan | shared observability source | passed | 14.81 s |
| NutriPlan | auth resilience, including mapped local E2E | passed | 93.84 s |

## Measured corrections

- AOHYS originally took 96.15 s because `...[origin/develop]` caused lint,
  typecheck, tests, and builds across nearly the whole workspace. Package-local
  lint/tests, removal of the duplicate TypeScript invocation, and file-local
  Impeccable reduced the same scenario to 17.73 s: an 81.6% wall-time
  reduction.
- NutriPlan's auth scenario originally started nine packages and 1,359 unit
  tests before its mapped E2E. The run was stopped at 68.24 s before E2E began.
  The corrected gate runs lint/typecheck only for the affected dependency
  closure, changed Vitest tests, and the five auth-mapped Playwright tests.
- Starting NutriPlan's dashboard and admin development servers concurrently
  reduced the completed auth scenario from 130.67 s to 93.84 s: a 28.2%
  reduction. The remaining cost is observable auth risk: two local apps and
  five browser tests, not an unconditional repository matrix.
- Provider-readiness commands failed closed in a clean local worktree because
  protected preview variables were not injected. Their live pass belongs in
  the protected CI Environment; the ordinary changed-validation path does not
  pay this cost.

## Reproduction

Run from each isolated repository worktree:

```sh
/usr/bin/time -p env CHANGED_FILES=<representative-path> pnpm run quality:changed
```

Compare only repetitions with the same repository, path, cache state, and
hardware. `CHANGED_FILES` verifies routing and gate cost; it does not fabricate
an edited source diff for tools that independently inspect Git. End-to-end
development speed must be recorded separately with `measure-development-run`.
