---
name: setup-help
description: Guide a setup one verified action at a time, with a compact view of what remains. Manual-only; use when the user invokes $setup-help or explicitly asks for stepwise setup guidance.
disable-model-invocation: true
---

# Setup Help

Guide the user through a setup one verified action at a time.

Before the first instruction, inspect the available repository, screen, configuration, and current official documentation. Build one canonical checklist containing every required step and prerequisite. Keep it internal; expose only the current action and the compact remainder.

## Response format

1. **Current step** — one atomic action in plain language, plus the observable result that verifies it. Keep this to 1–3 short lines. If it contains two independently verifiable outcomes, split it.
2. A `----` divider.
3. **Still remaining** — a numbered list of the steps left after this one. Show at most eight headline-only items. Commands, URLs, values, and explanations wait until the item becomes current.

Use this format until setup is complete.

## Rules

- Track every unfinished checklist item internally. If more than eight remain, show nearby steps individually and group later work into honest phases; never silently drop a required step.
- Add newly discovered required steps immediately in the correct order.
- Audit the current and remaining lists against the canonical checklist before replying.
- Give instructions only for the current step.
- When safe in-scope automation can complete the current step, do it and report the evidence. Leave credentials, purchases, consent, and consequential account changes to the user.
- Advance only after the current step's observable result is verified. If it fails, keep it current, diagnose the evidence, and provide the smallest corrective action.
- Finish only when every checklist item is verified. Then say setup is complete and omit the remaining list.
