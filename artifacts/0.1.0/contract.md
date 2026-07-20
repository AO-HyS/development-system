# AOHYS Development System contract

Contract version: `0.1.0`

## Canonical interface

The Development System exposes four local operations:

- `install`: generate the declared harness files for an exact contract version and source commit;
- `audit`: compare generated files and declared mirrors with the installed manifest without mutating them;
- `validate`: enforce the same checks as `audit` and fail when state is missing or has drifted;
- `rollback`: restore the previous installed version, or the pre-install state when no earlier version exists.

The central repository is the source of truth. Files under a user's HOME are generated outputs. A manual edit may be reported as drift, preserved by a rollback snapshot, or replaced by an explicit reinstall, but it never changes the canonical contract.

## Harness seam

Codex and Factory receive byte-identical mirrors of this core contract in namespaced directories. T3Code consumes the Codex surface. Harness-specific discovery, loading, agents, hooks, and lifecycle adapters are separate modules and may diverge only behind an explicit adapter contract.

## Authorization boundary

Installing, auditing, validating, reinstalling, and rolling back this local contract do not authorize product mutations.

- A natural-language request may select one of these operations; no secret command phrase is required.
- A recommendation never grants permission to execute a transition.
- Merge, release, production deployment, destructive operations, paid activation, and extraordinary paid usage require explicit authorization for that exact operation.
- Delivery authorization does not persist as a blanket bypass.

These rules are product-independent. Repository-specific stack, design, domain language, commands, branch policy, preview provider, and release train remain owned by each product repository.

## Observable evidence

Every installation records the contract version, canonical repository, exact source commit, artifact hash, harness, destination, and expected mirror. Audit and validation report observable file and mirror status. Rollback restores recorded bytes rather than reconstructing prior state from chat memory.
