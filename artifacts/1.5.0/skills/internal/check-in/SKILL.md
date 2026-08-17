---
name: check-in
description: Reconcile collected development evidence into a short read-only list of human actions when Alejandro says "Ya llegué", says he is on mobile, or gives an available time window.
---

# Check-in

Turn a short availability message into a private decision surface. Check-in is
a pure reader over evidence; it does not collect by mutating systems and never
creates, closes, moves, archives, deletes, merges, deploys, or promotes.

## Activate naturally

Use Check-in when Alejandro says phrases such as:

- `Ya llegué`;
- `Estoy en el celular`;
- `Tengo media hora`;
- an equivalent explicit request to check what needs him now.

Commands are optional. Preserve the stated device and time budget. If neither
is stated, use the current client as the device context and leave time
unproven.

## Reconcile before summarizing

Collect read-only evidence through available adapters, then pass normalized
items to the canonical `buildCheckIn` interface in `src/check-in.mjs`. Evidence
may come from repositories, Linear, pull requests and reviews, CI, previews,
releases, observability, blockers, and development-run records.

Each item identifies its repository, source, subject, claim, state, observation
time, revision or destination when relevant, exact link, and any human action.
Missing fields remain unproven. Never fill them from a green status elsewhere.

Reconcile by subject and claim:

- show contradictory states as a conflict instead of choosing Linear, Git, or
  runtime silently;
- mark evidence stale from its explicit observation time and freshness window;
- treat an absent observation time or state as unproven;
- require provider production evidence, destination, and state before calling
  production proven; green Git or CI alone is never deploy evidence;
- retain the exact Reader, preview, or evidence link so Alejandro can open the
  source without receiving the full report again.

## Return only the human frontier

Show at most three actions by default and never more than five. Every action
must say why it needs Alejandro now and use exactly one capability:

- `mobile` — readable or decidable from a phone;
- `computer` — browser or desktop QA;
- `local-device` — a local secret, simulator, hardware, or trusted device;
- `promotion-authorization` — an explicit human authorization boundary.

Prefer actions that fit the current device and time window, while making
conflicts visible. Keep overflow as deferred structured data. If no action is
proved, say so; do not manufacture useful-looking work.

## Preserve the boundary

The result must contain `readOnly: true`, empty `externalWriteIntents` and
`externalSideEffects`, and `authorization.promotionGranted: false`. A listed
promotion decision is a request for authority, not authority itself.

Expose the structured `privateReport` section unchanged to Development
Steward or the private Reader. Do not publish private report contents or repeat
the full report when an exact action link is available.
