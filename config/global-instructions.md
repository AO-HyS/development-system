# Personal development instructions

One page for every host. Each host also reads its own two-line section.

## Fast, then right, then cheap

The owner's order: the work must be fast, work well and cost less, in that
order. The measure is the time from his ask to behavior you have seen working,
not the number of merges.

## You choose how to work

Nothing here tells you how to plan, whether to delegate, which agent or model to
use, or in what order to work. The practices of each product live in its
repository: read its `AGENTS.md`, its lints and its verification guide, and
follow them.

Standing decisions of the owner:

- No automated tests or evals anywhere: do not create or run them
  (`development-system allow-tests` is his to grant). QuickE2E flows live in
  `~/.development-system/private/quicke2e-flows/`, never in a repository.
- On this machine at most three threads run local gates at the same time.
- Secrets never go in chat: `request_secret`, at most once per task. Do not
  read `~/.development-system/private/secrets`.
- Use the T3 browser or a dedicated one; his personal Chrome only when he
  dedicates it.
- Before you report, stop every server or watcher you started, by PID.

{{shared-host-rules}}

{{codex-host}}

{{claude-host}}

## What every change goes through

`development-system listo <owner/repo#number>` tells you where a pull request
stands and what is missing, and publishes the «listo para fusionar» status that
`develop` requires. Run it right before merging and merge that exact head.

1. **Level.** The repository's `config/niveles.json`, read from the base
   branch, decides it from the paths the change touches: critical, normal or
   mechanical. You may raise a level (`listo --subir critico`); nothing lowers
   it.
2. **Codex.** Ask once (`listo --pedir`). Its review has finished and you
   answered each of its comments in the thread, with the fix commit or
   «Rechazado: motivo». A rejected P0 or P1 makes the change critical. If
   Codex has not answered 15 minutes after the request, the change becomes
   critical and stops waiting. Codex also reads the head you merge and often
   answers minutes after the merge: before you call the ask done, run
   `development-system listo --barrido <owner/repo>` and answer each thread it
   lists the same way; production refuses while one is open.
3. **Smoke.** When the change touches an app or the backend, run
   `development-system smoke --base <url>`: with QuickE2E the product loads, a
   test account signs in and the main screens open. It always runs and never
   blocks a merge into `develop`; a failed smoke is a live finding you fix
   next, and it blocks production.
4. **Critical: before merging.** One independent read asks which case is
   missing that can harm a user, their data, their money or a secret today,
   and lists the cases this change needs. Run those cases for real (local
   backend with seed data, QuickE2E or Playwright; computer use only for what
   they cannot reach) and record them with `development-system registro`. A
   failed case, a needed case not reached or an open live finding stops the
   merge. A case the owner waives stays «no alcanzado» (`--dispensa` with his
   words): it lets that change through, it is never a pass and never a
   production approval.
5. **Normal: merge now, read after.** It merges into `develop` at once and
   stays «sin verificar». At the end of the work session one independent read
   covers the whole batch and lists its cases (`registro --lote`); run them
   before you call the ask done.
6. **Mechanical.** Lint and typecheck. No read.

`development-system listo --produccion <owner/repo>` publishes «listo para
producción»: nothing reaches `main` with a read pending, a needed case not
passed, a live finding open or a smoke that did not pass.

## When to stop and ask

Ask the owner before only these five, and keep working on everything else:

1. Spending money that the billing inventory
   (`~/.development-system/private/permission-audit/`) does not show as
   included or prepaid. Jev through TypeSafe and Vercel Hobby are prepaid.
2. Destroying something he did not order destroyed in this task and that
   cannot be recovered: uncommitted or untracked work, another thread's work,
   data, infrastructure.
3. New messages to customers or real people.
4. Account-security changes: grants, passwords, 2FA, members, exporting
   secrets.
5. Production: a merge to `main`, a production deploy, a release or a global
   install. Prepare everything, then ask one question naming the pull request,
   its head and what reaches production. Only an answer that approves that
   step counts («sí, a producción», «mergea a main»); it covers that step's
   release, install and rollback, nothing later.

Everything else you decide yourself, merges and deploys to `develop` and
preview included. What he already authorized for the same operation and scope
is never asked again, and «te apruebo todo», «dale», «pásatela» or «ya no me
preguntes» grant everything in the task's scope except these five. Do not stop
early: an open item with remaining authority means keep working. A login, 2FA
or CAPTCHA only he can complete is a handoff, not a permission question. The
command lock blocks only these five kinds of command; when it blocks, its
message names the allowed route.

{{visual-delivery}}
