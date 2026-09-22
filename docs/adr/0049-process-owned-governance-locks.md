# ADR 0049: Recover governance exclusion after process death

Status: user-authorized maintenance, 2026-09-21. Publication is separate.

The global registry lock recorded PID 46831 after that process had disappeared.
Every session sharing HOME could then fail before executing a tool. The original
store explicitly retained crash locks and only removed them in asynchronous
`finally` cleanup. The hook launcher can call `process.exit` at its deadline;
SIGKILL and process exit skip that cleanup. The specific reason PID 46831 ended
is unknown. A real child-process SIGKILL reproduces the permanent timeout.

Use a permanent SQLite database per lock path as the operating-system mutex.
Hold `BEGIN IMMEDIATE` through acquisition, recovery, the action and cleanup;
retry contention asynchronously within the existing bounded wait. SQLite owns
all database descriptors. Never delete, replace, archive or raw-open the mutex
database: closing an unrelated descriptor can release POSIX locks. Database
creation occurs inside a private directory. This is same-host, local-filesystem
coordination, not distributed locking.

The compatibility `.lock` remains so an older runtime still excludes new work.
Publish complete v2 owner metadata atomically through a prewritten, fsynced file
and an exclusive hard link. Bind the record to its host and permanent mutex
identity. Possession of that same mutex proves a prior v2 critical section has
ended even if a PID was reused. Legacy records require explicit ESRCH proof;
live, inaccessible, malformed and unknown owners remain protected. Age alone
never authorizes recovery. Preserve original orphan bytes and recovery provenance.
Interruption during recovery must remain recoverable without manual file deletion.

Release only the caller's matching owner file. Unify the Stop adapter's separate
file lock with the same primitive. Recovery never changes snapshots, attempt
state, leases, history, permits or acceptance. Snapshot checksum validation and
existing governance gates remain in force.

The package requires actual `node:sqlite` availability, checked before managed
installation writes. Supported unflagged versions are Node 22.13+ on the 22.x
line or 23.4+. No external native dependency is introduced. Contract 1.26.0 and
its artifacts remain immutable; this correction is prepared as 1.26.1.
Installed hooks pin the validated Node executable rather than resolving a
different runtime through PATH. Re-run setup after replacing that executable.

Validation includes real process death, same-process and cross-process
contention, concurrent recovery, mixed legacy ownership, interrupted recovery,
replacement protection and the real hook launcher in an isolated HOME. These
tests do not certify provider identity or complete NutriPlan product work.

References: [Node SQLite history](https://nodejs.org/api/sqlite.html),
[SQLite locking hazards](https://www.sqlite.org/howtocorrupt.html).
