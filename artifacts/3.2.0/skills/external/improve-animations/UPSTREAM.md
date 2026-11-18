# Upstream and local adaptation

Source: https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/improve-animations
Author: Emil Kowalski. License: MIT; retained in LICENSE.
The exact fetched tree and file hashes are in upstream.json.

Local changes:
- `execute <plan>` implements the plan on the task branch; an isolated worktree only when the user asks (upstream mandates one with an executor subagent). The read-only audit fan-out is optional ("you may fan out").
- The upstream pointer to the `choreograph` skill, which is not installed here, is replaced by its one-line rule (one entrance per container, non-uniform delays).
- A one-line provenance pointer follows the frontmatter. Everything else is the upstream text.

For the weekly skill refresh, compare upstream against this pinned snapshot,
keep the local changes above, and ship updates through a new shared
package/catalog version. Never overwrite this published artifact.
