# ADR 0065: Refresh external capabilities without application deployment

Status: Accepted for local candidate 1.38.0 / catalog 0.56.0, 2026-09-29.

The user requested the latest installed Impeccable, Matt Pocock and other
externally authored skills and asked whether this requires production deployment.
These capabilities are development tooling. No application deployment is needed.
A release of this repository and adoption of its package pins remain separate
operations; this request authorizes local installation, not publication or main
promotion.

Use immutable new artifact paths for catalog-managed external capabilities,
record exact upstream commits and capability hashes, and keep the published
versions unchanged. Merge local adapters against their prior upstream snapshots.
Preserve AO-authored workflows, authorization, context selection, browser routing,
report formats and the no-automated-tests policy. Retain the last available local
capability when its author removed the source path; report that limitation rather
than silently substituting a renamed capability. Do not add unrelated upstream
skills as part of an update.

Impeccable's skill, npm CLI and native engine have separate release channels.
Skill 4.3.1 and npm CLI 4.1.0 are already the latest published versions. Upgrade
the native engine separately to engine 0.1.7, whose release hashes and handshake
are recorded; its generic --version output is not the engine identity.

Only catalog-managed capabilities are part of the contract installer. Standalone
editable skills keep their upstream lock and a private reversible receipt.
Understand-Anything's linked skill directories are updated as a subset, preserving
the rest of its checkout; avoid a whole-repository pull that would restore unrelated
upstream test files. A compatibility adapter uses the preserved core's legacy
data directory when resolveUaDir is absent, so skill-only updates do not split
graphs, fingerprints or ignores across storage roots. Automatic deletion of old
scratch archives is omitted; cleanup requires an inventory and exact authority.
Provider-managed builtins and runtime/plugin bundles use their
native manager and are never overwritten as loose skills. Do not manually change
provider caches, accounts or permission settings.

Focused verification includes typecheck, release preparation, roster validation,
check-no-tests, isolated contract setup/audit, a separate skill audit, and real
native engine observation. A no-module-mocking production lint rule necessarily
names the banned frameworks: keep its source semantics; the instruction scan
excludes that exact source path, while file checks and all actual skill guidance
remain subject to the rule. Hash/mirror health is separate from harness discovery,
load and influence. A report is not behavior acceptance.
