# ADR 0012: Luna owns bounded implementation and worktree boundaries fail closed

Status: Accepted

## Context

The first live `work-multiple` run under contract 0.9.0 correctly loaded the
explicit skill and routed three writers to Spark, but useful implementation
started late and two writers patched the dirty primary checkout instead of
their registered lane worktrees. The parent detected the mismatch only after
edits existed, creating relocation and restoration work. Fast first output is
not useful when instruction following and ownership isolation fail.

The installed Codex catalog exposes Luna, Terra, and Sol. Luna already performs
focused tests and mechanical work, Terra is reserved for browser QA, and Sol is
the judgment route. The operator explicitly directed the system to stop using
Spark and use the fastest stable alternative.

## Decision

Codex `fast_implementer` uses `gpt-5.6-luna` at High reasoning. This is an
incident-driven provisional mapping, not a benchmark winner. Terra remains the
browser-QA model. Sol Medium is used only when implementation needs judgment
outside an exact bounded packet.

Every writer packet includes the expected absolute worktree path and branch.
Before its first read or edit, the writer verifies `pwd`, Git top-level, and
branch. Missing or mismatched evidence stops the writer without edits. Patch
targets outside the verified Git root are rejected. The parent interrupts a
mismatched writer before relocating, restoring, or integrating any diff.

The next same-packet measurements compare Luna against eligible challengers
using time to functional evidence, focused-check pass rate, correction cost,
tokens, authoritative cost when available, and worktree violations. Spark
remains historical benchmark evidence but is not a normal delivery route.

## Consequences

Bounded implementation favors stable instruction following over a nominally
faster first diff. Worktree isolation becomes an executable precondition rather
than a parent cleanup responsibility. The Luna mapping remains replaceable
when comparable measurements demonstrate a faster route with equal or better
verified delivery.
