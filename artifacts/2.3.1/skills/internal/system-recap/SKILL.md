---
name: system-recap
description: Write or refresh the system recap block in a PR description - which primitives the change touches, how (composes, extends, adds, combines, retires), its risk, and a diagram of the changed flow. Use when opening or updating a PR, when planning a non-trivial change, or when the user asks for a system review or PR recap.
---

# System recap

Adapted from Kent C. Dodds' `visual-recap` (kentcdodds/kcd-skills
`ab6303e3b22fbbeec665f9a62ee654f379c8c600`, MIT). Local changes: the map is
`docs/architecture/primitives.json`, retirements and combinations are classified,
and risk rises for permissions and money.

A reviewer reads the system, not 3,000 lines of diff. The recap supplements code
review; it never replaces it. Its main value is forcing the author to state which
primitives it put together.

## Rules

1. **Recap mode reads the diff, not memory.** `git diff <base>...HEAD` and
   `--stat` against the PR base; every claim is checkable in the diff.
2. **Classify against the map** at base and at head
   (`git show <base>:docs/architecture/primitives.json`). Use its ids verbatim.
3. **The map stays current.** A PR that adds, reshapes, combines or retires a
   primitive updates `primitives.json` in the same PR and passes
   `development-system check-primitives`.
4. **No map at base:** say so. A primitive documented for the first time is
   "documented", not "added"; only primitives this diff introduces are "added".

## Classification

| Impact | Meaning | Risk |
| --- | --- | --- |
| composes | uses existing primitives as they are | low |
| extends | changes a primitive's behavior, shape or contract | medium |
| combines | merges primitives into one; callers move | medium |
| adds | introduces a new primitive | high |
| retires | removes or deprecates a primitive | high |

The overall risk is the highest touched. A change that touches authorization,
money, personal data or a primitive's listed guarantees is at least medium even
when it only composes; say which guarantee.

## Block

Between `<!-- system-recap:start -->` and `<!-- system-recap:end -->`, inside
`<details>`, with the classification and risk in bold in the `<summary>`:

- Mode (plan or recap), base and head SHAs.
- Primitives touched: table of id, category, impact, one-line why.
- System map: a mermaid flowchart of touched primitives and immediate neighbors,
  colored by impact. Blank lines around fenced blocks so GitHub renders them.
- Change flow: optional mermaid of the new user or data flow.
- Plan vs actual: when a plan-mode recap existed.

Keep it under about 120 lines.

## Update the PR

Replace only the text between the markers (append the block on first run),
leaving the rest of the description untouched:

Read the current body with `gh pr view <n> --json body -q .body`, then send
the whole edited body through standard input, so no shared temporary file can
mix two PRs and the edit's own exit status is the result:

```bash
gh pr edit <n> --body-file - <<'BODY'
<the full description with the refreshed recap block>
BODY
```

Re-run after pushing significant commits. In plan mode, put the block in the
plan and state explicitly when no primitive changes.
