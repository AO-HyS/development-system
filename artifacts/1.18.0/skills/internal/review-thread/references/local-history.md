# Locating a thread on this workstation

These are local source pointers, not permission to export unrelated history.
Resolve `~` for the current operator and verify the file exists.

- OpenCode native sessions usually have `ses_...` IDs. Prefer native session
  listing and `opencode export <session-id> --sanitize`. Redirect large exports
  to a private local file, then extract only relevant messages and task receipts.
  `opencode debug paths` identifies the active data directory; its
  `opencode.db` contains `session`, `message`, and `part` in the inspected version.
  Follow `session.parent_id` for actual child sessions and inspect assistant
  message metadata for observed models, variants, usage and failures.
- T3 UUID thread IDs are stored in `~/.t3/userdata/state.sqlite`. Open SQLite
  through a `file:/absolute/path?mode=ro` URI. Inspect the schema if it has changed.
  Query `projection_threads` and `projection_thread_sessions` by the exact
  `thread_id`, then fetch a bounded recent slice from
  `projection_thread_messages` and `projection_thread_activities` for that ID.
  Resolve provider-native session IDs before looking in OpenCode's store.
  T3 metadata such as worktree and PR association is a lookup hint: validate it
  against the actual checkout and requested work.

Do not confuse an absent native OpenCode session with an absent T3 thread.
Avoid scanning all message text or selecting entire databases into context.
History can contain credentials: extract necessary task facts, redact secrets,
and never attach a database, auth state or uncurated export to a report.
