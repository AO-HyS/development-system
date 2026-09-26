---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

No automated tests: do not write, run or restore them, and delete them when found. Verify at pre-agreed seams with real verification: computer use, the browser and the repository's verification CLI.

Run typechecking regularly, and observe the finished behaviour for real once at the end, reporting passed / failed / not reached with evidence.

Once done, use /code-review to review the work.

Commit your work to the current branch.
