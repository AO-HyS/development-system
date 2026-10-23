---
name: cross-review
description: Open a visible T3 review thread where a second model (Sol 6.1 High for a Claude author, Opus for a Codex author) reviews a plan or change, then go back and forth in that thread until both accept the same version. The owner can join the thread and steer. Use only when the operator asks for it (/cross-review or an explicit request); never start one on your own.
---

# Cross review

The author keeps writing; the reviewer only proposes. The conversation lives in
one ordinary T3 thread the owner can open, read and write in: the owner asked
for one continuous visible thread, so this is the explicit exception to fresh
review rounds. It does not replace the Sol and Codex reviews the global review
budget requires for a PR: one Sol review of the finished PR (none for docs-only
or small low-risk PRs) and Codex asked at most twice. The reviewer
model is the owner's choice: Sol 6.1 High for a Claude author, Opus for a
Codex author; the owner may name another.

## Start

1. Freeze the artifact: a file under
   `$HOME/.development-system/private/cross-review/<id>/` (plan, list or contract)
   or a PR head SHA. Compute its SHA-256.
2. Record `<id>.json` there: author thread id, artifact path and hash, round 0.
3. Check `t3_thread_list` for an existing review thread for this id before
   launching; a launch has no retry key.
4. `t3_thread_launch` in the same project and workspace as the author
   (`workspaceStrategy` of the author's checkout; never a new worktree), with:
   - model: `codex` / `gpt-6.1-sol`, `reasoningEffort: high` for a Claude
     author; `claudeAgent` / `claude-opus-5-5` for a Codex author;
   - first message: the owner's goal in your own words, the artifact path and
     hash, the evidence it rests on, "read only: do not edit, commit, switch
     branches or start servers", and the answer format below.
5. Save the returned thread id and run id; link the thread to the owner as
   `[title](t3-thread://v1/<threadId>)`.

Reviewer answer format: restate the owner's goal, then numbered findings
(R<round>-H<n>) each with severity (blocking, important, minor), evidence and a
concrete change; end with exactly `VEREDICTO: SIN BLOQUEANTES` or
`VEREDICTO: CON BLOQUEANTES`, and when there are no blockers, whether it accepts
the artifact with that hash.

## Each round

1. Wait for the recorded run with `t3_thread_wait` and that `runId`. Timeout,
   interruption or failure leave the round pending; never read it as acceptance.
2. Read the whole answer with `t3_thread_read` (page with `afterPosition`,
   recover truncated text with `itemId`/`textOffset`).
3. If the owner wrote in the thread since the last round, the owner's message
   wins: reconcile it before answering the reviewer.
4. For every finding: fix the artifact, or reject it with evidence. Save the new
   version, compute its hash, add a response table at the end.
5. Send the response with `t3_thread_send`, mode `queue`, a stable
   `clientRequestId` (`<id>-r<round>`), the new path and hash, and the request to
   verify each fix and look for regressions. Record the new `messageId`/`runId`.

## Close

- **Agreed:** the reviewer says `SIN BLOQUEANTES` and accepts the current hash.
  The author uses exactly that version.
- **Disagreement:** five rounds without agreement, or a finding the author
  rejects twice. Report both positions to the owner; this is never approval.

Report the rounds, the accepted hash and the thread link. The review validates a
design; the work it describes is still pending until done and verified.
