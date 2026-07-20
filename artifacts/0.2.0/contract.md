# AOHYS Development System contract

Contract version: `0.2.0`

## Skill catalog

The canonical catalog pins every managed skill to a repository, exact commit, upstream path, folder hash, logical name, physical destination, harness, and mirror or adapter relationship. T3Code consumes the Codex surface and does not create a third physical copy.

Byte-identical Codex and Factory installations are declared mirrors of one logical skill. Divergent content is valid only for named harness adapters that share an explicit observable contract. The `coding-orchestration` adapters both preserve bounded delegation, one writer by default, parent-owned integration, proportional verification, and authorization boundaries.

## Operational states

Skill evidence is reported without collapsing these states:

1. `exists`: an entry is present at the declared destination;
2. `discovered`: the entry is reachable through a supported harness root;
3. `catalogued`: the running harness exposes its metadata;
4. `loadable`: frontmatter, canonical folder hash, and referenced files are valid;
5. `loaded`: runtime evidence shows the full skill was selected or read;
6. `influenced`: the harness produced the skill's declared behavioral marker.

File copy, discovery metadata, or a catalog count never proves loading or influence. Runtime evidence records the harness executable, version, command, behavior signature, scanner errors, and overflow warnings. The behavior signature comes from skill-only instructions and is not embedded in the probe prompt.

## Reversible synchronization

`sync-skills` replaces only catalog-owned destinations and removes only cleanup paths named in the catalog. Existing files, directories, and symbolic links are moved into a local snapshot before mutation. `rollback-skills` restores those exact entries. Unmanaged paths remain untouched.

The isolated scenario must demonstrate authoritative synchronization, removal of stale and broken entries, identical declared mirrors, explicit adapters, refusal to report operational health without live evidence, reinstall, integrity-checked rollback, and preservation of unrelated files. A separate read-only operator probe demonstrates the six runtime states against the real harnesses.

## Authorization boundary

Skill synchronization and operational probes do not authorize product changes, merge, release, production, paid activation, or destructive cleanup beyond the exact catalog paths. Those operations require separate authorization.
