# ADR 0002: Authorization is operation-specific and non-transitive

Status: Accepted

## Context

Automation can accidentally treat a routing decision, an implementation request, or a previous approval as permission to perform later irreversible operations.

## Decision

The core installer is limited to local contract state. Natural language can select `install`, `audit`, `validate`, or `rollback`, but selection and recommendation do not broaden authority. Merge, release, production, destructive operations, and economic activation require explicit authorization for the exact operation.

The generated contract carries this invariant to every supported harness mirror. Later lifecycle adapters must preserve it through observable transitions rather than relying on prompt wording alone.

## Consequences

- Recovery can be requested naturally without memorizing a command.
- Installing the Development System never grants permission to modify or promote a product.
- A future adapter may automate a delivery loop only within a separately authorized terminal slice.
