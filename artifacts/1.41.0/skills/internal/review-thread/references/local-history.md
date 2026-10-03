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
- For T3 UUID IDs, prefer t3_thread_read in the current project or attached thread.
  Otherwise inspect ~/.t3/userdata/statev2.sqlite and legacy state.sqlite with
  file:/absolute/path?mode=ro. Query sqlite_master and table_info before choosing
  tables: the V2 database can also retain legacy projection tables. Locate the
  exact thread in orchestration_v2_projection_threads, then inspect bounded V2
  runs, subagents and turn_items/messages from that schema. Use legacy projection
  tables only for a thread proven to live there. Native agent origin and a task
  terminal state do not demonstrate app-owned dispatch or behavior acceptance.
  Metadata branch/worktree/PR is a lookup hint; verify the real checkout.


Do not confuse an absent native OpenCode session with an absent T3 thread.
Avoid scanning all message text or selecting entire databases into context.
History can contain credentials: extract necessary task facts, redact secrets,
and never attach a database, auth state or uncurated export to a report.
