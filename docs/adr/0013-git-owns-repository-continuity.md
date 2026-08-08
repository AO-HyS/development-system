# ADR 0013: Git owns repository continuity

Status: Accepted

## Context

Release and orchestration contracts repeated commit SHAs across worktrees,
reviews, preview checks, and promotion gates. Those copies duplicated Git's
history, invalidated evidence mechanically after harmless commits, and caused
workflow-history polling without proving that production reused preview bytes.

## Decision

Repository continuity is read directly from Git refs, ancestry, and diffs.
Agents record worktree path and branch but do not copy or compare commit SHAs
as coordination state. Pull-request policy validates canonical source and
target branches without searching workflow runs by `head_sha`.

Evidence outside Git keeps its own automatic identity. Provider deployment IDs,
artifact digests, migration checkpoints, backup checksums, and hashes of
generated HOME files remain when they prove bytes or effects that Git cannot
observe. Tooling emits these values; operators do not transcribe them.

## Consequences

- New commits follow normal Git continuity without global recertification.
- Preview and production retain separate deployment and smoke evidence.
- A changed surface reruns only the checks whose evidence it invalidates.
- Hashes remain for external effects and generated state, not workflow ceremony.
