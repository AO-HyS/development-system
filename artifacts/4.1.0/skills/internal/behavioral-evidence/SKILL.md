---
name: behavioral-evidence
description: Independently verify an accepted objective with real evidence (computer use, browser, the repository's verification CLI) and confirm the change adds no automated tests.
---

# Behavioral evidence

## Claude Code: the AF way

In a Claude Code AF run (`~/.claude/skills/flow-implement/references/forma-af.md`)
the evidence is `verificar`: one fresh `verificador-pantalla` for the screen
lines, the product's CLI for the server lines, lint and types for the rule
lines. No extra reader inside the run, and QuickE2E does not replace a screen
line. `check-no-tests` still runs, the smoke `listo` asks for stays and the
independent read of a critical change or a batch comes after the run, by
level. The rest of this page is the Codex path.

## Codex path

Real verification is the evidence. Computer use, the browser and the
repository's verification CLI and feature map observe the accepted behavior
through its public interface; a green check, count or coverage percentage never
overrides the accepted objective.

## No automated tests

The change adds no automated tests, test runner configuration, test scripts,
test dependencies or CI test steps. Run
`development-system check-no-tests --root <repository> --json` and report its
findings; automated tests found in the change are deleted, not kept or
strengthened. Report the actual missing behavior and the smallest real
observation that would prove it instead of proposing a test.

## Cases first

Before writing code, list the cases the change must survive: the good path and
the ugly ones, taken from the request, the area's verification guide and each
screen state crossed with the usual interruptions (wrong role, reload, double
submit, empty or hostile input, lost connection). After building, run every
case for real. For a critical change or a batch, each case goes in
`development-system registro` as `--necesario` with its `--caso`; a failing
case is fixed and run again before the merge. A case a reader finds missing is
added to the area's verification guide in the same PR.

## Independent verification

The implementer's own checks are never the only evidence. For a critical
change, or a batch of normal ones, a reader that did not write the change
(Sol 6.1 High; another model that is not the author when Sol is unavailable,
said in the record) derives the oracle from the accepted objective and public interface,
observes the behavior for real (computer use, the browser, the repository's
verification CLI), rejects narrowed or unsupported runs, and reports the verdict
against every acceptance criterion, including unproven items. Independent
review returns the actual evidence gap; it does not invent a check per form or
feature.

## Web flows: QuickE2E with Jev

QuickE2E is the standard web verification; Computer Use only covers what
QuickE2E cannot reach (native dialogs, OS sheets, another app), and the case
says why (owner decision 2026-11-02). Jev is prepaid through the operator's
TypeSafe key (jevgrep's credentials), so cost bans on hosted inference do not
apply to it; data limits still do.

One command installs, runs and records it:

```bash
development-system quicke2e status    # QuickE2E, Playwright and Jev access
development-system quicke2e install   # only when status reports a problem
development-system quicke2e check <flows.json> --base <url> --repo <checkout>
development-system quicke2e run <flows.json> --base <url> --repo <checkout>
```

- `run` adds `--json --headless --trace` and writes a hashed `run.json` under
  `~/.development-system/private/evidence/quicke2e/`, bound to the checkout's
  HEAD. Run it with the checkout at the PR head you verify.
- The smoke and the record are two commands.
  `development-system smoke --base <url>` runs the repository's smoke flow
  (`~/.development-system/private/quicke2e-flows/<repository>/smoke.json`) and
  publishes the `smoke` status on the head; it never blocks a merge into
  `develop`. The cases of a critical change, or of a batch, go in
  `development-system registro <owner/repo#n> --sha <head> --entorno <url> --lector <model> --lectura <thread> --veredicto sin-vivos --necesario "N1: <case>" --caso "pass: N1 <what was tried> => <what was observed>"`,
  one `--caso` per necessary case, naming the `run.json` in what was observed.
- Computer Use or a simulator: name the capture file and why QuickE2E could
  not reach it in the `--caso`. Every capture must exist.
- Flow files are declarative JSON (`flows.json`: the array a QuickE2E spec
  would export, as plain data). A `.mjs` spec is refused: it would run code in
  the process that reports the results. Write them under
  `~/.development-system/private/quicke2e-flows/<repo>/`, never in a repository; the command refuses a flow
  inside a product checkout and refuses `--emit`: no replay spec is kept, so
  this is live verification, not an automated test (operator decision
  2026-10-13). A failed flow is re-run live, so renamed labels need no
  maintenance. The QuickE2E skill text for writing flows is in the runtime at
  `~/.development-system/tools/quicke2e-runtime/node_modules/quicke2e/AGENTS.md`.
- Log in with the repository's test accounts (names from its env files, never
  printed) and pass a Playwright `storageState`. Wait for `networkidle` before
  the first click on dev servers that hydrate late.
- Prove permissions both ways: the allowed role reaches the end state and a
  role without the permission is observed refused.
- Assert side effects (rows, emails, payments in test mode), not just text.
- Clean up the records the flow created and stop every server you started.

The T3 browser remains the tool for visual judgment and exploration without a
defined flow.

Lines of code, file counts, identifier length and minified formatting are not
quality targets. Complexity signals may inform diagnosis but cannot fail a run.

## Output

Return the check-no-tests result, each acceptance criterion with its real
evidence (passed, failed or not reached), the independent verdict, every
self-grading finding and any unproven behavior. This skill is read-only and
never edits.
