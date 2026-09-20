# Verification receipt — visual Grill 1.22.1

Date: 2026-09-15

## Candidate identity and boundaries

- Worktree: `/Users/corrortiz/Documents/AO/.worktrees/development-system-grill-visual-122`
- Branch: `codex/grill-visual-1220`
- Verified base: `2767b409757dd14f378c50f883bbf899a20787a7`
- Previous candidate commit: `4df664d8cec86c99c17d8536585bd546d0e163ca`
- Contract: `1.22.1`
- Catalog: `0.43.1`
- The operator HOME remained on installed contract `1.21.0` / catalog `0.42.0`.
- The dirty primary checkout and NutriPlan were not modified. Nothing was
  pushed, merged, published, deployed or installed into the operator HOME.

The final candidate commit and clean-tree package SHA are recorded by the local
Git history and packaging output after this evidence file is committed. This
receipt deliberately does not guess a future commit hash.

## Behavioral and structural checks

| Command | Exit | Observable result |
| --- | ---: | --- |
| `node --test test/visual-grill.test.mjs` | 0 | 7/7 routing and ordered-receipt tests passed. |
| `python3 -B test/grill_questionnaire.py` | 0 | 10/10 persistence, media, legacy recovery, restart and UI-state tests passed. |
| `./bin/development-system validate-repository --json` | 0 | Repository healthy; contract 1.22.1 and catalog 0.43.1 present. |
| `pnpm run verify` | 0 | 594/594 tests passed and final repository validation reported healthy. |
| `pnpm run scenario` | 0 | 28/28 scenario tests passed after install, drift, failed validation, reinstall, rollback and unrelated-file preservation in isolated HOME directories. |
| `git diff --check` | 0 | No whitespace errors. |
| `find artifacts/1.22.0 artifacts/1.22.1 ...` | 0 | No generated `__pycache__` or `.pyc` remained in published artifacts. |

`quick_validate.py` could not run because the available Python environment has
no `yaml` module and no `uv` executable. That optional helper did not replace
the canonical catalog validator, repository validator or behavioral suites;
those all passed.

An early `pnpm run release:pack` correctly exited 1 because canonical tracked
sources were dirty. Packaging is rerun only after the local commit so the
manifest can bind a clean source revision.

## Operational skill evidence

- `impeccable context` loaded the Development System product and design context
  for the isolated corrected-flow fixture.
- The real `impeccable serve-question --start` rendered the supplied three-card
  payload. Desktop inspection showed exactly three equal-salience options plus
  Build this, steer and re-roll; no direction was selected.
- The questionnaire was served under an isolated HOME. Browser inspection
  exposed the reference image alternative text, caption, explicit function,
  single interview and no competing direction chooser.
- The exploration receipt preserves the required order: grounded candidates,
  concept seed, real Impeccable decision page, then a still-pending user
  selection.

See `impeccable-decision-receipt.json`, `questionnaire-visual-receipt.json` and
`independent-visual-review.md` in this directory for exact media hashes, scope
and visual findings.

## Findings corrected

Independent code review reproduced two blockers: legacy no-media rounds changed
canonical hashes, and a restarted media-backed round depended on the original
source image. The final implementation preserves legacy bytes, recovers the
embedded canonical media when the source disappears and still rejects changed
question definitions. Follow-up review found no remaining actionable code
finding.

A full verification run also exposed Python bytecode written inside immutable
artifact directories. Tests now disable bytecode creation; generated files were
removed and the complete gate passed afterward.

Visual review found an expanded pending list delaying the first question and
choice-only controls on a free-text prompt. Both were corrected and rechecked at
1440 x 900 and 390 x 844.

## Remaining visual and human gates

- Desktop Impeccable comparison is verified. At 390 x 844, its installed
  renderer's floating Back control overlaps labels on cards two and three, so
  mobile chooser acceptance remains open.
- The installed renderer exposes each wireframe as generic `Layout schematic`
  alternative text rather than the region relationships. Accessibility of the
  chooser is therefore not fully accepted.
- No user direction was selected. “Apto para comparar” is not approval; product
  refinement and page extension remain intentionally pending a real choice.
- The A/B/C pilot is observational: exact model identity and run variance could
  not be isolated. It cannot prove universal superiority or causality from
  mentioning the article.
