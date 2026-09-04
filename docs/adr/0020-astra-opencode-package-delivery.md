# ADR 0020: Astra, OpenCode Go and package distribution

Status: Accepted — explicit operator instruction, 2026-09-04.

The operator prioritizes delivery speed with proportional correctness guards,
then cost. Astra replaces Sol for orchestration, design, review and Computer
Use. OpenCode Go is authenticated and becomes the first worker route. Fable
through Factory/Devin assists complex review; Luna is the final fast fallback.
Deterministic operations run directly without model handoffs.

Keep the existing phase and authorization invariants, but execute ordinary
review in the Astra parent. Logical phases are not a requirement to launch
separate agents. Preserve incomplete objectives across turns, and retain
already granted publication authority.

The project is already an npm-shaped package, but installation depends on Git
objects. Add explicit package provenance support and distribute a pinned
npm-format tarball as a GitHub release asset. The existing canonical repository
is public; no new private registry, npm account or token is required. Consumers
pin one devDependency and a `ds` command. No postinstall mutates HOME. `setup`
explicitly installs contract plus skills; normal application deployments do
not install or execute development tooling.

Package-manager integrity binds the distribution bytes. A provenance file
inside those bytes records canonical source commit and file hashes; it is not
a publisher signature. Git checkouts retain their existing Git verification.
Tampered, incomplete or mismatched package sources fail closed before writes.

Version 1.6.0 and catalog 0.27.0 add pinned interface and visualization skills.
Safe adapters preserve user authorization and avoid automatic public uploads,
duplicate design reviews and unconditional design-token changes. Upstream
sources remain separately available with commit and license provenance.

Muse Spark Contributor stays outside automatic private-code routes because
its training terms differ. An isolated synthetic exercise can establish
runtime availability and a narrow result without treating it as general
coding certification.

This ADR supersedes model assignments and mandatory handoff interpretations
in ADRs 0012, 0014, 0016 and 0018. Their ownership, safety and authorization
constraints remain. ADR 0019 remains a separate unimplemented cloud proposal.
