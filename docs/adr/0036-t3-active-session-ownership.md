# T3 worker ownership follows the active session

Status: accepted, 2026-09-14.

During the BARBER-205 preflight, the supervisor killed a read-only provider probe
while its owning user turn was still running. The T3 event
`thread.turn-diff-completed` wrote `projection_turns.completed_at` when a diff
checkpoint finished. The turn remained `running`, the session remained `running`,
and `active_turn_id` still matched the exact user turn. Later messages belonged
to that same running turn. The timestamp was not a cancellation signal.

Worker ownership requires the exact running turn and its matching running native
session. A different active turn, stopped session, missing ownership, or unreadable
database still prevents dispatch and stops existing workers. The supervisor never
mutates T3 state and retains cancellation of the worker process group.

This is a shared runtime prerequisite outside the A/B/C/D feature timers. It does
not change product code, the task, workers, acceptance, or the pinned skill catalog.
Version 1.20.1 preserves every artifact and destination of 1.20.0.
