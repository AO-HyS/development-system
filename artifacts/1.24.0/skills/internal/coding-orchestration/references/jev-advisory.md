# Jev advisory execution

Use this recipe for non-trivial implementation, a material decision or
independent review. One parent owns the task through the authorized endpoint.
The starting model remains that parent; new sessions default to Sol High.
Bounded writing uses `opencode-go/deepseek-v4.1-flash` High. Native descendants
use `gpt-6-astra` XHigh, explicitly requested with a fresh or minimal context.
Luna and automatic provider/model substitution are outside this profile.

## Prepare one coherent packet

Read the task and relevant repository guidance. Resolve the affected contracts,
write ownership, dependencies, observable acceptance and authorized verification
environment. Reuse the execution-contract packet; avoid duplicate discovery.
Tiny deterministic edits stay with the parent. Use at most two writers with
disjoint ownership. Serialize dependencies and workers sharing provider state
unless an isolated adapter has demonstrated safe concurrency.

Keep a private run directory with `run.json`, atoms and receipts. Run context
contains `runId`, `rootModel`, `phase`, `baseSha` read from Git, and
`verifiedAtomIds`. Each atom contains `id`, `objective`, repository-relative
`readSet`, `writeSet`, `dependsOn`, `acceptanceIds`, compact `exactContext` and
`observedFacts`. Track active writers in `active-atoms.json`, an array of `{id, writeSet}`
with unique safe IDs and repository-relative paths. Pass it to every
classification while writers are active so Jev can assess semantic overlap.
Update it when ownership starts or finishes.
Supply actual dependency state, never the whole conversation,
credentials or unnecessary product data.

## Ask, decide, execute

The installed command is
`node "$HOME/.codex/development-system/advisory-runtime/cli.mjs"`.
The pinned package exposes the same actions through `pnpm ds`.
`status --json` (`pnpm ds advisory-status --json`) reads configuration only.
Credentials come from `TYPESAFE_API_KEY`, or the private file selected by
`TYPESAFE_ENV_FILE`/`--credential-file`; the default is
`~/.development-system/private/secrets/typesafe.env`. Never paste the value in
a prompt, command argument, receipt, product repository or worker environment.

At a useful implementation, decision, correction or review boundary, run:

```sh
node "$HOME/.codex/development-system/advisory-runtime/cli.mjs" classify-atom \
  --atom /absolute/run/atom.json --run-context /absolute/run/run.json \
  --active-atoms /absolute/run/active-atoms.json \
  --receipt /absolute/run/classification.json --json
```

Jev proposes a route and typed signals. The parent chooses the actual action,
honors known blockers and capabilities, and records its reason:

```sh
node "$HOME/.codex/development-system/advisory-runtime/cli.mjs" record-route-decision \
  --atom /absolute/run/atom.json --run-context /absolute/run/run.json \
  --route-receipt /absolute/run/classification.json \
  --chosen-route deepseek_exact --rationale "Settled contract; dependency verified" \
  --receipt /absolute/run/decision.json --json
```

Use a fresh receipt destination for each action. The receipt is bound to the
same packet and run; changing them requires a new judgment. Neither a judgment
nor a chosen route grants permission or proves execution. Record unavailable
or malformed Jev responses once and continue with parent judgment; no unchanged
retries. Reads, shell commands, waits and every individual file do not each
need a classification.

Execute the chosen packet with native tools. For the bounded external writer:

```sh
env -u TYPESAFE_API_KEY -u TYPESAFE_ENV_FILE opencode run --pure \
  --model opencode-go/deepseek-v4.1-flash --variant high --format json \
  --dir /absolute/product/root "Exact bounded packet with owned paths and checks"
```

Keep the process attached to the owning turn; capture private JSONL, stderr,
process identity and completion. Existing credentials for the writer stay with
its provider. Wait through host completion events while doing independent work.
Inspect the actual changed paths and check outcomes before unblocking dependent
work. A missing provider or capability is a concrete gap, not permission to
substitute a model. Historical `jev-workflow` controllers are disabled in this
release; they are not the entry point for this recipe.

For native research/review, explicitly request `gpt-6-astra` with `xhigh` and
fresh/minimal context. Generic agents avoid a stale host role forcing another
model. On CLI resumes preserve the explicit model and reasoning arguments.
Observe session/provider model metadata when available; requested settings alone
do not establish actual identity. Browser and visual tasks retain the host's
authorized mechanism and actual capabilities.

## Integrate and finish

The parent integrates the coherent candidate, obtains independent code review,
and owns corrections and relevant verification. Visible changes also require
the actual affected browser flow and capable visual critique. Reuse current
evidence and repeat only affected checks or a required gate. A repeated blocker
without candidate progress retains a failure receipt and stops that retry path.
Terminate an old writer before transferring ownership.

Record first candidate separately from accepted behavior and final close.
Product time includes tools, providers, reviewers, corrections and evidence;
exclude setup and explicit human idle. Costs include all participating models,
cached input and failed attempts. Unknown usage stays unknown. End with the
criterion outcomes, model identities, changes, checks, evidence and remaining
gaps at the authorized endpoint. A first diff or process exit is not acceptance.
