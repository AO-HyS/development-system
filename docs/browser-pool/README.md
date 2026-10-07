# Dedicated browser resource preparation

The broker rotates available registered browser applications and reserves each
bundle identifier across participating clients. Two Chrome processes or profiles
with the same bundle identifier are one native application resource. Discovery
reads application metadata; it neither launches browsers nor copies credentials,
cookies, profiles or passwords. It supports stable and beta browser channels.

The native Computer Use adapter still exposes a global desktop. Consequently
`computer-use` reservations also reserve the desktop, and the existing launcher
cap stays at one. Separate application assignments are not proof of safe native
concurrency. `allocation` reservations prepare resources only; they authorize no
browser effects. Direct browser tools and pre-existing threads are outside the
broker. No automatic T3 restart or provider/model substitution occurs.

## Commands

Use the active global CLI after complete candidate installation:

```sh
development-system browser-pool inventory --json
development-system browser-pool status --json
development-system browser-pool register --input /absolute/private/browser.json --json
development-system browser-pool acquire --input /absolute/private/request.json --json
development-system browser-pool release --input /absolute/private/release.json --json
development-system browser-pool quarantine --input /absolute/private/lease.json --json
development-system browser-pool reconcile --input /absolute/private/reconciliation.json --json
```

Registration identifies the installed application, rather than trusting a
caller-supplied bundle identifier. New candidates are disabled. Chrome must not
be enabled unless the owner explicitly dedicates it to agents. Enabling requires
`dedicated: true`, a recent `observedAt` timestamp, a local neutral `evidence`
file and `accounts` containing only google/github/facebook. Empty accounts are
valid for public-page work; registration records an observation, not a new
authentication guarantee. Reobserve the exact account before external effects.
Observations expire after 24 hours. Source or allocation evidence is not native
control or authentication evidence.

Example disabled registration:

```json
{"appPath":"/Applications/Brave Browser.app","enabled":false,"accounts":[]}
```

Acquisition takes `ownerId`, live `ownerPid`, `purpose`, required `accounts`,
optional exact `resourceId` and `ttlSeconds` (30..14400). Availability is scanned
in least-recently-used order with no configured browser-count cap. SQLite
serializes the short allocation transaction; it does not queue browser work.
No eligible resource returns `capacity-needed`, exit 75. Continue independent
work or add a verified resource; never choose another agent's browser.

Every release/quarantine/reconciliation names the exact `leaseId`, `ownerId`
and `generation`. Release also requires `operatorStopped: true` and
`effectsReconciled: true`. Expired leases and dead/reused owner PIDs are
quarantined, never automatically stolen. A quarantined resource needs explicit
`reconcile` after observed termination and effect reconciliation. These receipts
record the caller's observation; they do not kill an operator or cancel an
external action. Keep them private.

## Native launcher integration

An explicitly scoped dedicated-browser packet can use the existing launcher:

```sh
node ~/.codex/development-system/runtime/claude-orchestration/codex-review.mjs --computer-use --packet /absolute/private/packet.md --root /absolute/repository --browser-request /absolute/private/browser-request.json
```

The browser request contains `accounts`, optional `resourceId` and
`ttlSeconds`. The wrapper supplies its own owner/run ID, PID and purpose,
holds the reservation over credential-home attempts and saves the assigned
application in the hashed effective packet. The operator must verify actual
account/control. A completed operator reports `Browser lease: quiescent` only
as the last nonempty report line when all activity stopped and effects are
reconciled. Other outcomes quarantine
the resource. Pooled native fallback is denied until a receipt-bound ownership
transfer is implemented. Ordinary unpooled launcher behavior remains unchanged;
this opt-in does not claim universal interception of legacy/native tools.

## T3 profile patch

`t3-preview-profile.patch` is a prepared upstream candidate against
`pingdotgg/t3code` revision
`0678e4e23d8675ef88f9ac08e1ae90cfe7d6ef2e`. It adds explicit `profileId` to
`preview_open`, forwards it while preserving agent ownership, rejects changing
an existing tab's profile, and refuses silently replacing a requested persistent
desktop profile with an empty isolated server context.

The patch has not been installed in T3 or accepted upstream. Apply it to that
exact source revision, perform its relevant source checks, build the desktop
application and observe a fresh MCP catalog before relying on it. Imported
profiles do not become available to the current agent through this document.
There is no editable T3 Code source checkout here; the installed signed app
bundle is preserved while other threads run.

Behavior acceptance after a supported T3 build: open a new owned tab with the
exact imported profile and observe the correct Google/GitHub account; open a
second independent tab and retain both URLs under concurrent navigation; reject
other owners and profile changes on a reused tab; explicitly fail if the desktop
profile is unavailable. Do not export account cookies into evidence.

## Download and owner setup

- Brave: https://brave.com/download/
- Edge: https://www.microsoft.com/en-us/edge/download
- Vivaldi: https://vivaldi.com/download/
- Helium (beta): https://helium.computer/

The owner downloads/installs the chosen applications, signs into Google/GitHub
and optionally Facebook in the dedicated browser, then provides/observes a
neutral readiness receipt. Password-manager extensions can help sign in; they
do not guarantee transferable sessions or unattended MFA renewal. Register
only actual observed dedicated resources. The broker invents neither browsers
nor account readiness when capacity is exhausted.
