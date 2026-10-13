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

## Independent verification

The implementer's own checks are never the only evidence. A context-isolated
reviewer derives the oracle from the accepted objective and public interface,
observes the behavior for real (computer use, the browser, the repository's
verification CLI), rejects narrowed or unsupported runs, and reports the verdict
against every acceptance criterion, including unproven items. Independent
review returns the actual evidence gap; it does not invent a check per form or
feature.

## Web flows: QuickE2E with Jev (2.3.0)

Drive web flows with QuickE2E on its documented Jev engine. Jev is prepaid
(TypeSafe key at `~/.config/jevgrep/credentials.json`), so cost bans on hosted
inference do not apply to it; data limits still do. QuickE2E calls Jev through
OpenRouter, so load the Development System preload that sends the same request
to TypeSafe.

QuickE2E is an external tool, not shipped in this release. Install it once,
pinned, outside any repository; skip this when
`node ~/.development-system/tools/quicke2e/bin/quicke2e.mjs --help` already
works and `git -C ~/.development-system/tools/quicke2e rev-parse HEAD` shows
that commit:

```bash
git clone https://github.com/dmoka/quicke2e ~/.development-system/tools/quicke2e
git -C ~/.development-system/tools/quicke2e checkout 98f74b6ceb44e8eb68c0bc176e522983639b9521   # 0.5.0
(cd ~/.development-system/tools/quicke2e && npm ci && npx playwright install chromium)
```

Then run a flow:

```bash
OPENROUTER_API_KEY=via-typesafe node --import "$HOME/.codex/development-system/runtime/quicke2e/typesafe-jev.mjs" \
  "$HOME/.development-system/tools/quicke2e/bin/quicke2e.mjs" run <flow.mjs> --base <url> --engine jev --trace <private-dir> --video <private-dir>
```

- Log in with the repository's test accounts (names from its env files, never
  printed) and pass a Playwright `storageState`. Wait for `networkidle` before
  the first click on dev servers that hydrate late.
- Keep the flow file under `$HOME/.development-system/private/verification/<run-id>/`,
  never in the repository. Do not pass `--emit`: no replay spec is kept, so this
  is live verification, not an automated test (operator decision 2026-10-13);
  keeping a replay spec needs an operator test grant. A failed flow is re-run
  live, so renamed labels need no maintenance.
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
