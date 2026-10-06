# One shared agent installation, reproducible product CI

Development System 2.0 is distributed as an npm-format tarball on the canonical
GitHub release. Agent tooling is installed once per computer. It does not require
a registry account, a service, an adapter in each product, or a postinstall hook.

From a clean committed canonical checkout, run:

```sh
pnpm install --frozen-lockfile
./bin/development-system setup --home /absolute/home --json
```

Setup packs committed source into a verified package, stages release bytes outside
the checkout, and explicitly installs its contract, paired catalog and stable
runtime. Verify first with an isolated HOME. The active commands are
`~/.local/bin/development-system` and compatibility `aohys-development-system`.
Both resolve to the preserved package under `~/.development-system/packages/`.
Ensure `~/.local/bin` is on PATH. New tasks use that command; running threads keep
their already loaded context and selected model.

Updates need no product repository edit:

```sh
development-system update --version 2.0.2 --json
development-system doctor --json
```

Update downloads the exact canonical release archive with gh, rejects unsafe
archive entries, checks package inventory and the release-tag source commit,
and runs that package setup. Offline/reviewed adoption can use
`update --source-root /absolute/verified/package --json`. There is no implicit
network call during an ordinary product build. Historical packages remain
available for recovery; an explicit old CLI remains a historical choice.

Setup serializes through a kernel-owned SQLite transaction lock. A private
journal and integrity-checked backups cover the immediately previous package,
contract, catalog, declared managed files, hooks, state and launcher targets.
Publication of launchers follows successful installation. Failure restores the
previous complete tuple. `rollback` restores the previous tuple and refuses
unreconciled drift; `recover-shared` resumes an interrupted transaction. Process
death releases the lock. Unrelated HOME files, credentials, private transcripts,
product checkouts and paid infrastructure are outside this managed scope.

`doctor` identifies the actual invoked package, active package, contract/catalog
pair and managed drift. Completion reports reject a CLI that differs from the
active shared installation; `document --mode historical` is an explicit exception
recorded in provenance. The receipt and packet identify package/version/source,
renderer path/hash and output hash. A renderer version can differ intentionally
from the package version: the approved 1.40 reader is retained by 2.0.

A product can retain an exact pinned package and lockfile solely for necessary
CI commands, e.g. `aohys-development-system check-no-tests`. Give this a specific
script name; remove generic `ds` aliases. Do not run local-package setup, render
reports or resolve agent skills through a product dependency. CI stays
reproducible on Linux without the operator's global Mac installation.

Repository context comes from AGENTS.md, README and task-relevant docs.
`initialize-repository` and `normalize-repository` fail before writes. Adapter
retirement preserves unique product information in ordinary documentation and
removes only known adapter files after review. The structural audit preserves
real command, QA, preview, certification and residue criteria; no adapter is
required and no fake command makes a missing behavior pass.

T3 owns app-owned child tasks, history, browser and weekly scheduling. Native
children are preferred for supported same-provider reads/reviews. Source-writing
children require observed ownership admission and Git restrictions; generated
profiles alone do not prove that. Without those controls the authorized parent
edits sequentially. Cross-provider writing remains gated. Legacy launchd enable
fails before writes; audit/disable and history remain. `run-worker` is optional
external process recovery, never the T3-owned child task route. Pure planning and
operation-specific lifecycle/acceptance controls remain useful shared tools.

Maintainers create new immutable artifact/catalog/manifest versions, commit the
reviewed candidate, and run `pnpm release:pack --output <private-directory>`.
The builder stages committed runtime only, verifies extraction and reports SHA-256
and SHA-512. Publish the exact archive on the release tag; never replace published
bytes. Inventory/lock integrity is not a cryptographic publisher signature.
Installation, observed fresh-host loading and accepted behavior remain distinct.
