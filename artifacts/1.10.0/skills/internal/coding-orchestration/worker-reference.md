# CLI workers on T3

After authorization and path-confinement verification, copy the exact argument
array from `model-route` into this execution packet. Store it privately; prompts
may contain sensitive project context.

```json
{
  "command": "opencode",
  "args": ["run", "--pure", "--model", "opencode-go/muse-spark-1.3-contributor", "--variant", "high", "--format", "json", "BOUNDED TASK"],
  "cwd": "/absolute/owned/worktree",
  "outputDirectory": "/absolute/private/new-attempt",
  "owner": {
    "databasePath": "/absolute/t3/userdata/state.sqlite",
    "threadId": "EXACT-CURRENT-THREAD-UUID",
    "turnId": "EXACT-CURRENT-TURN-UUID"
  }
}
```

Use the current host's thread/turn identity. Verify that exact pair is running
in `projection_turns`; never choose an unrelated running turn. On T3 installations
without supplied identity, read only the candidate thread metadata and match the
current user request. Ambiguous identity is not permission to detach a writer.

Run `development-system run-worker --input packet.json --json`. It requires
the local `sqlite3` CLI and a fresh output directory whose parent already exists.
It executes arguments directly, without shell interpolation or automatic permissions.
The packet grants neither dispatch authority nor path confinement.

The supervisor polls only that owning turn every 500 ms. An ended, missing or
unreadable turn stops the process group. SIGINT/SIGTERM also stop it; receipt
errors trigger cleanup. SIGKILL/host failure cannot guarantee cleanup. Child
processes that deliberately detach into another process group are outside this
supervisor's guarantee. Other hosts must use their attached native lifecycle.

`started.json`, `stdout.jsonl`, `stderr.log` and `result.json` remain private.
A failed or interrupted child makes the CLI exit nonzero. An exit of zero proves
process completion, not correctness; review the owned diff and focused behavior.
Inspect startup and completion, or a concrete stall. Keep useful work while
switching a failed provider; start a fresh attempt directory for the fallback.
