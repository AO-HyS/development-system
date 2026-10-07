# Current work — dedicated browser resource preparation

Root: /Users/corrortiz/Documents/AO/development-system.
Branch: feat/browser-resource-pool; base 88324e882ea3b623d2cdb38cf93b8879ba9e71c0.
Task: user authorized local reversible browser coordination changes on
2026-10-07, including beta browsers. Parent Sol 6.1 High edits sequentially;
read-only source mapping and fresh independent plan review completed.
Existing untracked .impeccable/ and private/ remain untouched.

Candidate 2.1.1 adds a private SQLite browser-resource allocator, explicit CLI
and opt-in dedicated-browser Computer Use launcher integration. Rotation has
no fixed browser-count cap; unavailable resources return capacity-needed.
Expiry/owner death/uncertainty quarantine rather than steal. Native Computer
Use retains the single-desktop guard until application confinement is proven.
Pooled fallback is denied without validated ownership transfer. The allocator
gates participating launches only; existing threads/tools are not intercepted.

A pinned upstream T3 profile patch is prepared, not applied to its installed
signed app. Google/GitHub authentication, native application confinement,
new-browser installation and live T3 profile selection remain pending the
actual browser/runtime and owner sign-in. No cookies/credentials are accessed.
No merge, public release, package publication or production action authorized.

Focused typecheck, release preparation, roster, no-tests guard and diff checks
passed. Real concurrent CLI processes in an isolated HOME received distinct
resources; exhaustion returned immediately, fencing rejected a stale release,
quarantine required explicit reconciliation and owner death quarantined the
desktop reservation. These observations cover allocation only, not browser
control or account authentication. The upstream patch passed git apply --check.
Fresh final source review passed after two bounded parser corrections.

2.1.0 was adopted locally at 2a7beaff4535. A discovery correction exposed the
installer's immutable-version guard when readopting changed 2.1.0 bytes; that
attempt failed before principal HOME adoption. Its original artifact/manifest
bytes are preserved and the correction is versioned as 2.1.1. Unknown browser
candidates require HTTP/HTTPS plus an HTML Viewer role. Disabled unreserved
allocator records can be unregistered without touching application/profile data.

Next: package the reviewed 2.1.1 candidate, verify isolated-HOME update and adopt
the complete tuple locally only if validation passes.
Evidence is recorded outside public source; report assets are sanitized. No
automated tests/evals, worktrees or external publication.

## Previous task continuity — shared tooling cleanup closeout

Canonical root: /Users/corrortiz/Documents/AO/development-system.
Task started 2026-10-06; selected parent Sol 6.1 High. Sequential parent edits,
fresh read-only facts and independent reviews; no admitted writing children.
No worktree, automated tests/evals, product data or customer operations.

Development System 2.0.1 and 2.0.2 are reviewed, merged to develop/main, publicly
released and installed globally. Active package/contract2.0.2, catalog0.60.0,
public source a2990946228a491803c87d6d9d109fd5b0458bcd. Doctor passes. Isolated
update/rollback/readoption and actual fresh instruction consumption passed.
Published contracts/catalogs remain immutable; rollback tuples remain available.

README and distribution instructions use one global installation per computer,
ordinary AGENTS/README/task docs, CI-only product pins and T3-owned orchestration.
Current doc release checks, correct Steward scheduler/Casa identity and bounded
no-tests scanner fixes are published. Scanner covers declared Markdown paths,
literal web/native commands and actual files; it is not exhaustive language or
native hook evidence. Global tool adoption requires no product release.

Known consumer cleanup candidates preserve runtime sources/release boundaries:
AOHYS PR209 and ETERIA PR295 source-reviewed with CI/certification passing.
Home, Todo and House final candidates retire exact adapters/foreign guidance and
automated-test scaffolding, run actual CI-only2.0.2 and have focused web/native
build receipts. Independent final review and feature PR publication are closing.
Existing unpublished develop refs and native generated outputs are preserved.

Casa/Nutri/Barber already use global tooling; no product changes here. NutriPlan
remains develop only; do not reopen the unrelated clinical production release.
Barber dirty product spec remains another owner's work. Opportunity's redesign
branch and dirty .gitignore remain untouched pending ownership reconciliation;
a concrete private patch is retained, not applied or published.

Remaining operation-specific decisions: product merges subject to their actual
repository/release authority, Todo's remote D1 boundary, Opportunity ownership,
live Devin loading and all generated native writer-role admission. No file-copy,
source build or report is treated as full product acceptance.

Private ledger and report destination:
~/.development-system/private/reports/shared-tooling-cleanup-20261006.
The ledger retains exact revisions, checks, reviews and PR states. Report/tunnel
receipts are added only after generation and readback. Keep private transcripts
and secrets outside served assets. Preserve
untracked .impeccable/ and private/ in this root. Earlier continuity remains
available in Git history; report current facts from the ledger, not old notes.
