# CLI workers on T3

After authorization and path confinement, store the parent-selected command
array in the private packet:

    {
      "command": "opencode",
      "args": ["run", "--pure", "--model", "provider/model",
               "--variant", "high", "--format", "json", "BOUNDED TASK"],
      "cwd": "/absolute/owned/worktree",
      "outputDirectory": "/absolute/private/new-attempt",
      "owner": {
        "databasePath": "/absolute/t3/userdata/state.sqlite",
        "threadId": "EXACT-CURRENT-THREAD-UUID",
        "turnId": "EXACT-CURRENT-TURN-UUID"
      }
    }

Match the exact owning thread and turn in projection_turns. Ambiguity is not
permission to detach a writer. The supervisor stops an ended or unreadable
turn; a child exit of zero still requires review of the owned diff and checks.
Keep private receipts, secrets and raw worker logs out of model output.
