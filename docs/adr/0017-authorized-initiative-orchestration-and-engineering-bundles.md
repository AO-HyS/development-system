# ADR 0017: Authorized initiative orchestration and engineering bundles

- Status: Accepted
- Date: 2026-09-01

## Context

The explicit-only parallel path made operators remember a command even after
they had already selected a multi-ticket initiative. Its scheduler also
treated dependency edges as permanent lane unions, which reduced useful
concurrency after dependencies completed. Stack-specific skills, PStack-like
engineering tactics, focused checks, and integration checks were available
but were not represented as one auditable lane contract. A single specialist
risk could not express work that crossed security, performance, visual, and
backend boundaries.

Automatic routing must not infer authority from backlog size. Skills installed
on disk are not proof that the runtime discovered, loaded, executed, or was
influenced by them. The pure planner must retain zero side effects and zero
delivery authority.

## Decision

`orchestration-plan` is the sole automatic router. It selects parallel mode
only when:

1. `taskContract.requestedWorkItemIds` contains at least two unique IDs;
2. `workGraph.tickets` contains exactly that set; and
3. every ticket supplies kind, surfaces, dependencies, capabilities,
   acceptance, focused checks, and stop condition, with repository and
   integration evidence. The automatic route derives its writer from the
   canonical capability roster instead of accepting a ticket-supplied model.

Any mismatch fails closed. Ticket count, urgency, or repository size never
activates parallelism. Explicit `parallel-work` remains a compatibility path
for one release.

The scheduler computes dependency readiness first. It then chooses a stable,
deterministic executable frontier subject to declared writer capacity and
non-overlapping ownership. Dependency edges never permanently union lanes;
surface locks prevent simultaneous writers while each ticket retains its own
durable lane. Waiting tickets carry a machine-readable reason. Running work
reserves capacity before pending work. Failures propagate to descendants but not to
independent work while the shared base is healthy.

Ticket and specialist surfaces must be safe repository-relative paths inside
the task contract scope and outside protected boundaries. The pure planner
returns `dispatchAuthorized: false`; the host must bind the current user
request to the exact repository, revision, IDs, and operation before launch.
A valid plan is not an authorization receipt. The trusted host must reject
existing symlink components and bind a `verify-path-confinement` proof for the
canonical repository root, revision, scope, protected surfaces, and lane
surfaces before allocating branches or worktrees.

Each ticket receives a pure orchestration bundle containing capabilities,
selected PStack-derived tactics, skill references, focused checks, quality
oracles, integration checks, and runtime requirements with explicit fallback.
Focused checks execute inside lanes. One integration barrier depends on every
writer lane and executes integration checks exactly once. It precedes two
context-isolated Sol reviews, one for repository standards and one for the
requested objective; specialist reviews are additional. Computer Use execution
also waits for the integrated candidate and its semantic judgment waits for the
neutral execution evidence. Skill references remain unproven until
host-validated runtime evidence exists.

Specialist risk input may contain multiple supported risk records. Each record
requires an ID, evidence, and surfaces. Unknown or incomplete records fail
closed. The singular risk field remains compatible for one release.

PStack is adapted as one internal `pstack-engineering` tactics library pinned
to upstream commit `82f1d4f49ba8f21e3315a89c97e82f7c02a48fba` under its MIT license.
`poteto-mode`, upstream orchestration, autonomous external actions, model
routing, and Cursor-specific agents are not installed. Matt Pocock skills are
pinned separately to commit `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`.
The raw in-progress `implement-spec` file is retained only as provenance;
catalog `0.22.0` installs an AO adapter that preserves operation-specific
branch, commit, push, PR, merge, production, and cleanup gates.

## Consequences

- Already-authorized initiatives no longer require an extra skill invocation.
- Independent descendants can become concurrent after dependencies complete.
- Every lane carries enough deterministic data for routing and verification.
- Repository commands remain discovered inputs; the planner does not invent
  package-manager commands.
- Installation, discovery, loading, execution, and influence remain separate
  evidence levels.
- Planner output never grants agent launch, filesystem mutation, external
  writes, delivery, release, or production authority.

## Rollback

Reinstall Development System 1.5.14 and catalog 0.21.0. Published artifacts,
catalogs, and manifests from earlier versions remain unchanged.
