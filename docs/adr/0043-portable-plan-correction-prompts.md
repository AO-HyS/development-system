# ADR 0043: Retain packet portability constraints during plan correction

Status: Accepted bounded prompt repair; product acceptance remains separate.

## Context

A semantic plan correction omitted the initial planning prompt's established
portability rule and introduced an absolute source-root path. The validator
correctly rejected that plan, requiring another costly complete rewrite. The
running 1.23.2 benchmark arm and its evidence must remain unchanged.

## Decision

Put the existing relative-path or declared-placeholder requirement in the shared
planning scope used by initial planning and every plan-correction prompt. Repeat
that packets must not embed the original source root, change branches or commit.
Preserve the exact schemas, validators, authoritative worktree binding, model
pins, deadlines, review/QA gates and rejection behavior. This prompt repair
reduces avoidable correction work without accepting an invalid plan.

## Release boundary

Extend exact commit 8adcddbc925161bf698b1d9ed0bb056f28f19107 in an isolated 1.23.3
worktree. New immutable snapshots and manifest retain all 41 managed destinations
and catalog 0.43.1 with 104 skills / 140 variants. Compatible 1.23.0 scheduler
policy and pricing remain explicit pinned inputs. Prepare and verify the local
tarball while the timed 1.23.2 run continues; defer activation until that run is
terminal. No remote publication or change to historical evidence is implied.
