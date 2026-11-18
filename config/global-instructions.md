# Personal development instructions

## Fast, then right, then cheap

The owner's order: the work must be fast, work well and cost less, in that
order. The measure is the time from his ask to behavior you have seen working,
not the number of merges.

## You choose how to work

Beyond this page you decide how to plan, delegate and order the work, and
which agent or model to use. Each product's practices live in its repository:
read and follow its `AGENTS.md`, its lints and its verification guide.

Standing decisions of the owner:

- No automated tests or evals anywhere: do not create or run them
  (`development-system allow-tests` is his to grant). QuickE2E flows live in
  `~/.development-system/private/quicke2e-flows/`, never in a repository.
- On this machine at most three threads run local gates at the same time.
- Secrets never go in chat: `request_secret`, at most once per task. Do not
  read `~/.development-system/private/secrets`.
- Browse by MCP in his Chrome only to verify, within the limits of the
  `verificar` skill; otherwise the T3 browser or a dedicated one.
- Before you report, stop every server or watcher you started, by PID.

{{shared-host-rules}}

{{codex-host}}

{{claude-host}}

## How an ask runs

1. **First reply.** Answer a product ask, dictated or naming a Linear ticket,
   with the five parts of the `in-your-own-words` skill. Its «Terminado»
   lines (`acción -> lo que se ve`) are the contract; the skill says when to
   wait for his yes.
2. **Build.** Load the skills the work calls for. Four defences, in order:
   lint at edit time, types, the reads below, verification. A defect a rule
   or a type could have caught leaves that rule in the same pull request.
3. **Verify.** The `verificar` skill ends every line PASA, NO PASA or NO
   ALCANZADO with a receipt. No review rounds: a third NO PASA of a line is
   diagnosed, told to him and left NO PASA.
4. **Close.** `development-system tarjeta` keeps the ask's card. Update the
   Linear ticket he named; leftovers go to a ticket with «Listo cuando»,
   reusing one first; an ask closed in the thread creates none.

## What every change goes through

`development-system listo <owner/repo#number>` tells you where a pull request
stands and what is missing, and publishes the «listo para fusionar» status that
`develop` requires. Run it right before merging and merge that exact head.

1. **Level.** The repository's `config/niveles.json`, read from the base
   branch, decides it from the paths the change touches: critical, normal or
   mechanical. You may raise a level (`listo --subir critico`); nothing lowers
   it.
2. **Codex.** Ask once (`listo --pedir`) and answer each of its comments in
   the thread with the fix commit or «Rechazado: motivo». A rejected P0 or P1,
   or no answer 15 minutes after the request, makes the change critical. Codex
   often answers after the merge: before you call the ask done, run
   `development-system listo --barrido <owner/repo>` and answer each thread it
   lists the same way; production refuses while one is open.
3. **Smoke.** When the change touches an app or the backend, run
   `development-system smoke --base <url>`. It never blocks a merge into
   `develop`; a failed smoke is a live finding you fix next, and it blocks
   production.
4. **Critical: before merging.** One independent read asks which case is
   missing that can harm a user, their data, their money or a secret today;
   its cases become lines, verified and recorded with
   `development-system registro`. A failed line, a line not reached or an
   open live finding stops the merge. A line the owner waives (`--dispensa`
   with his words) stays «no alcanzado»: never a pass, never a production
   approval.
5. **Normal: merge now, read after.** It merges into `develop` at once and
   stays «sin verificar»; one independent read per batch at the end of the
   session (`registro --lote`), its lines verified before you call the ask
   done.
6. **Mechanical.** Lint and typecheck. No read.

`development-system listo --produccion <owner/repo>` publishes «listo para
producción»: nothing reaches `main` with a read pending, a needed line not
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
command lock blocks only these five; its message names the allowed route.

{{visual-delivery}}
