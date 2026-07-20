# ADR 0001: Canonical source and generated HOME state

Status: Accepted

## Context

Personal harness configuration currently mixes authored rules, copied skills, local edits, and generated files. File presence does not establish provenance, and a direct HOME edit can silently become an accidental source of truth.

## Decision

The published Development System repository owns versioned contract artifacts and manifests. Installation copies only manifest-declared artifacts into namespaced harness directories and writes an installed manifest containing the exact repository, commit, hashes, destinations, harnesses, and mirror relationships.

HOME is generated state. `audit` is read-only, `validate` turns drift into a failing gate, `install` is the explicit repair path, and `rollback` restores recorded bytes from the previous installation snapshot.

## Consequences

- Canonical changes are reviewable in Git history.
- Manual HOME changes remain visible but cannot redefine the contract.
- An installer must verify canonical hashes before writing.
- Harness discovery and behavioral influence still require operational validation in later adapters; copying a file is not proof of loading.
