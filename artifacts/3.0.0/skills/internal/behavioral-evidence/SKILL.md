---
name: behavioral-evidence
description: Independently verify an accepted objective with real evidence (computer use, browser, the repository's verification CLI) and confirm the change adds no automated tests.
---

# Behavioral evidence

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

## Cases first (2.15.0)

Confidence comes before the review. Before writing code, list the cases the
change must survive: the good path and the ugly ones, taken from the request,
the area's verification guide and each screen state crossed with the usual
interruptions (wrong role, reload, double submit, empty or hostile input, lost
connection). After building, run every case for real and record each one in
the receipt with `--case "<pass|fail>: <what was tried> => <what was observed>"`.
A receipt without cases is incomplete and one with a failing case is failed:
fix it and run the cases again before asking anyone to read. A case a reviewer
finds missing is added to the area's verification guide in the same PR.

## Independent verification

The implementer's own checks are never the only evidence. A context-isolated
reviewer derives the oracle from the accepted objective and public interface,
observes the behavior for real (computer use, the browser, the repository's
verification CLI), rejects narrowed or unsupported runs, and reports the verdict
against every acceptance criterion, including unproven items. Independent
review returns the actual evidence gap; it does not invent a check per form or
feature.

## Web flows: QuickE2E with Jev (2.10.0)

QuickE2E is the standard web verification; Computer Use only covers what
QuickE2E cannot reach (native dialogs, OS sheets, another app), and the receipt
says why (owner decision 2026-11-02). Jev is prepaid through the operator's
TypeSafe key (jevgrep's credentials), so cost bans on hosted inference do not
apply to it; data limits still do.

One command installs, runs and records it:

```bash
development-system quicke2e status    # QuickE2E 0.5.0, Playwright >= 1.64.1, Jev access
development-system quicke2e install   # only when status reports a problem
development-system quicke2e check <flows.json> --base <url> --repo <checkout>
development-system quicke2e run <flows.json> --base <url> --repo <checkout>
```

- `run` adds `--json --headless --trace` and writes a hashed `run.json` under
  `~/.development-system/private/evidence/quicke2e/`, bound to the checkout's
  HEAD. Run it with the checkout at the PR head you verify.
- Since 3.0.0 the smoke and the record are two commands.
  `development-system smoke --base <url>` runs the repository's smoke flow
  (`~/.development-system/private/quicke2e-flows/<repository>/smoke.json`) and
  publishes the `smoke` status on the head; it never blocks a merge into
  `develop`. The cases of a critical change, or of a batch, go in
  `development-system registro <owner/repo#n> --sha <head> --entorno <url> --lector <model> --lectura <thread> --veredicto sin-vivos --necesario "N1: <case>" --caso "pass: N1 <what was tried> => <what was observed>"`,
  one `--caso` per necessary case, naming the `run.json` in what was observed.
- The receipt bound to a run file stays available:
  `development-system evidence record --pr <ref> --verified-sha <head> --deployed-sha <served sha> --environment <url> --tool quicke2e --run <run.json> --allowed pass|fail --denied pass|fail --effects pass|fail --case "<pass|fail>: <what was tried> => <what was observed>"`,
  with one `--case` per case of the list. A change without a screen records
  `--exception nonvisual --reason <why> --checks <what ran>` with its cases.
  Pass the `run.json` that `run` printed: a record outside that directory or
  reached through a link, a record edited after the run, a non-zero exit, a
  failed flow, a run on another checkout, or flows whose base URL is not the
  receipt's `--environment` make the receipt fail; a missing run leaves it
  incomplete.
- Computer Use: `--tool computer-use --reason "<what QuickE2E cannot reach>" --capture <file>`;
  simulator runs: `--tool simulator --platforms ios,android --capture <file>`.
  Every capture must exist.
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
- Browser budget: one session per PR, before its review, covering every case
  of the list in one pass. After that only the cases a fix or a withdrawal
  touches run again, without asking the owner. Never a session per push or per
  polish change.

The T3 browser remains the tool for visual judgment and exploration without a
defined flow.

Lines of code, file counts, identifier length and minified formatting are not
quality targets. Complexity signals may inform diagnosis but cannot fail a run.

## Output

Return the check-no-tests result, each acceptance criterion with its real
evidence (passed, failed or not reached), the independent verdict, every
self-grading finding and any unproven behavior. This skill is read-only and
never edits.

## Authorized Claude Code account recovery (1.39.0)

For Claude Code review and computer use, the operator explicitly authorizes the
local Codex credential-home sequence followed by a fresh native Claude role.
Run codex-review once; it discovers existing profiles without copying credentials
and records at most two sequential profile attempts. Read receipt.json as well as findings.
When status is fallback_required and fallback.eligible is true, immediately
dispatch reviewer (plan, diff or security), visual-reviewer (image review) or
browser-qa (computer use) through the native Agent tool with the original packet.
Copy fallback.prompt verbatim from the receipt; it contains the original packet
and Codex fallback:, Codex fallback receipt: and Codex fallback packet: lines.
The guard verifies the full dispatched packet, hash, root, mode and Task-Id and
rejects resume so the native agent stays fresh. Computer-use fallback receipts
are admitted once only; a consumed receipt requires reconciliation, not replay.
Do not let a failed Codex attempt silently omit the independent review or absorb
it into the coordinator. Preserve the endpoint and actual capability requirements.
Cancellation, safety refusal and uncertain computer-use effects are not fallback
permission: reconcile observed state before more actions. If the native role lacks
vision or an authorized browser, retain the gap and continue independent work.
Report the provider change and actual or unknown identity. This explicit Claude
exception does not change restricted Codex-only tasks or Headroom's same-account
per-invocation contract. HOME installation does not prove live host loading.
