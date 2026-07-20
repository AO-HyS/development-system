# Spec: sistema de desarrollo multi-harness


> Imported from [Linear bootstrap spec](https://linear.app/aohys/document/spec-sistema-de-desarrollo-multi-harness-b30eaf6ef916) on 2026-07-19. Git history in this repository is canonical for implemented contract versions; Linear remains the operational tracker.

Fecha: 2026-07-19
Estado: **En revisión humana**
Gate: no se autoriza `to-tickets`, creación del repositorio central ni implementación hasta que este spec y su Local Visual Plan sean aprobados explícitamente.

## Problem Statement

Alejandro Ortiz Corro trabaja con Codex, T3Code y Factory Droid sobre repositorios con distintos niveles de madurez. Su forma de desarrollar existe hoy como una mezcla de instrucciones personales, skills globales, agentes, droids, hooks, reglas locales, comandos heredados y conocimiento implícito. La presencia de un archivo no demuestra que el harness lo descubra, cargue o ejecute. Codex y Factory pueden recibir contratos distintos, los repos pueden heredar reglas de otros productos y un validador estructural puede dar verde aunque el sistema real no cargue.

El workflow también mezcla etapas que requieren intervención humana con ejecución automática. Wayfinder puede alcanzarse desde un router aun cuando debe ser manual; la implementación puede empezar sin un gate suficientemente visible; los reviews pueden depender demasiado del mismo contexto o detenerse por un número arbitrario; QA, previews y pruebas pueden ejecutarse de forma desproporcionada; y los Local Visual Plans y Recaps todavía no tienen una superficie privada consistente entre harnesses.

Los repositorios maduros —principalmente NutriPlan, The Barber Central y parcialmente AOHYS— contienen patrones valiosos, pero copiarlos literalmente ha producido duplicaciones y contaminación de dominio. Escuela 360 no forma parte del primer rollout y permanecerá explícitamente sin preparar hasta su auditoría gradual. Otros proyectos usan tecnologías, procesos y diseños diferentes que deben conservarse. Impeccable es un sistema visual separado y no debe convertirse en una plantilla visual global.

Alejandro necesita una fuente de verdad versionada que capture su contrato de desarrollo, lo traduzca a cada harness, permita auditar e inicializar repositorios, mida modelos mediante benchmarks reproducibles y detenga la entrega antes de merge, release o producción para conservar su autoridad final.

## Solution

Construir un repositorio central versionado y publicado en GitHub que defina un contrato de desarrollo observable y común para Codex, T3Code y Factory Droid. El contrato especificará etapas, gates, autorizaciones, roles, review confrontatorio, evidencias, QA, previews y artefactos visuales. Cada harness tendrá un adapter que traduzca el contrato a sus herramientas, modelos, mecanismos de delegación, hooks y descubrimiento reales sin cambiar el comportamiento observable.

Wayfinder queda fuera del lifecycle normal: es una etapa opcional y exclusivamente manual que sólo puede ejecutarse mediante una invocación explícita de Alejandro. Ningún router, tamaño de iniciativa, recomendación ni clasificación puede activarlo automáticamente.

El lifecycle normal será:

 1. `grill-with-docs`, manual.
 2. Gate humano de requisitos.
 3. `to-spec`, que genera spec y Local Visual Plan.
 4. Gate humano de spec + plan.
 5. `to-tickets`.
 6. Gate humano de tickets.
 7. `Implement Preview`, manual.
 8. Delivery loop autónomo de implementación, pruebas, review confrontatorio, corrección y QA.
 9. Pre-release, Local Visual Recap, preview y PR sin merge.
10. Gate humano final.
11. Merge, release o producción sólo mediante autorización explícita para esa operación.

El repositorio central incluirá manifest de instalación, procedencia y hashes, adapters, skills, roster de agentes/droids, validadores operacionales, benchmarks, documentación, ADRs, scripts de auditoría/inicialización, versionado y rollback. La sincronización de skills eliminará entradas huérfanas y variantes viejas; cuando dos skills representen el mismo nombre lógico con contenido divergente, dominará la versión mantenida más reciente. Las copias idénticas necesarias para Codex y Factory sólo podrán coexistir como mirrors explícitos del manifest. Tendrá dos capacidades principales para repositorios: una auditoría read-only que distingue existencia, descubrimiento, catálogo, carga, activación e influencia; y una inicialización explícita para proyectos nuevos.

La arquitectura compartirá principios y vocabulario —Module, Interface, Implementation, Depth, Seam, Adapter, Leverage y Locality— sin imponer dominio, stack ni diseño visual idénticos. `improve-codebase-architecture` seguirá siendo un diagnóstico manual por repo que propone deepening antes de cualquier refactor.

El primer rollout preparará NutriPlan, The Barber Central y AOHYS. Escuela 360 y el resto entrarán gradualmente mediante la misma auditoría y criterios, sin declararse preparados antes de pasar sus gates.

## User Stories

 1. As Alejandro, I want Codex and Factory Droid to expose the same lifecycle, so that I do not relearn development for each harness.
 2. As Alejandro, I want T3Code to preserve the Codex contract and authorization state, so that changing the client does not change the process.
 3. As Alejandro, I want the development contract versioned in a central GitHub repository, so that every change is reviewable and reversible.
 4. As Alejandro, I want installed HOME files generated from a canonical source, so that local configuration cannot silently become the source of truth.
 5. As Alejandro, I want a manifest of installed versions, upstream commits, hashes, mirrors and drift, so that I can tell exactly what contract each harness is running.
 6. As Alejandro, I want lifecycle stages named consistently, so that native harness syntax does not change the mental model.
 7. As Alejandro, I want the router to recommend manual stages without executing them, so that classification never expands authorization.
 8. As Alejandro, I want Wayfinder to require an explicit invocation, so that a large initiative does not automatically create maps or tickets.
 9. As Alejandro, I want `grill-with-docs` to remain manual, so that product intent and constraints come from me.
10. As Alejandro, I want requirements persisted before synthesis, so that the spec does not depend only on chat memory.
11. As Alejandro, I want `to-spec` to generate a Local Visual Plan atomically, so that I can review the same scope in text and visually.
12. As Alejandro, I want a manual gate after spec and plan, so that implementation planning does not advance on an unapproved interpretation.
13. As Alejandro, I want tickets generated only after spec approval, so that executable work reflects the accepted contract.
14. As Alejandro, I want a manual gate after tickets, so that scope and sequencing remain under my control.
15. As Alejandro, I want `Implement Preview` to be the explicit delivery trigger, so that documentation never starts coding by itself.
16. As Alejandro, I want an authorized delivery run to commit, push, open a PR and deploy preview, so that it can reach a complete review surface autonomously.
17. As Alejandro, I want merge, release and production excluded from normal delivery authorization, so that irreversible promotion remains mine.
18. As Alejandro, I want economic activations and destructive operations to stop for approval, so that autonomy cannot create real-world cost or loss.
19. As Alejandro, I want reversible controversial decisions to continue with a written rationale, so that normal technical judgment does not cause constant interruptions.
20. As Alejandro, I want controversial decisions prominent in the recap, so that I can challenge them without reading internal logs.
21. As Alejandro, I want bypasses scoped to one operation, so that an exception never becomes a permanent permission.
22. As Alejandro, I want orchestration for work with real complexity, so that discovery, implementation and review can use specialized capacity.
23. As Alejandro, I want trivial changes handled directly, so that orchestration does not become ceremony.
24. As Alejandro, I want independent discovery lanes when useful, so that code, documentation, behavior and integration evidence can be gathered efficiently.
25. As Alejandro, I want one writer by default, so that agents do not conflict over shared files.
26. As Alejandro, I want parallel writers only on disjoint surfaces, so that concurrency has a real benefit and clear ownership.
27. As Alejandro, I want the orchestrator to retain integration responsibility, so that delegated work still reaches one coherent result.
28. As Alejandro, I want agents reused for the same ownership, so that context and cost are not repeatedly discarded.
29. As Alejandro, I want worktrees used only when explicitly requested or benchmark-authorized, so that normal work remains simple.
30. As Alejandro, I want every change reviewed confrontationally, so that the reviewer tries to disprove correctness instead of endorsing the implementer.
31. As Alejandro, I want review context isolated from implementation context, so that the reviewer is not anchored by the implementer's conclusions.
32. As Alejandro, I want the Foul/adversarial-reviewer capability mapped per harness, so that independent review does not depend on one product-specific mechanism.
33. As Alejandro, I want specialized jurors only when risk justifies them, so that security, performance and visual review add evidence without redundancy.
34. As Alejandro, I want review findings classified consistently, so that blockers and advice have different consequences.
35. As Alejandro, I want review rounds to continue until quality gates are met, so that an arbitrary iteration count cannot declare success.
36. As Alejandro, I want non-convergence detected from evidence, so that an endless loop pauses without silently accepting defects.
37. As Alejandro, I want the orchestrator to adjudicate technical disagreements, so that ordinary execution does not repeatedly return decisions to me.
38. As Alejandro, I want TDD selected by value, so that contracts and regressions receive strong tests without making every copy change expensive.
39. As Alejandro, I want every change to have appropriate evidence, so that omitting TDD never means omitting verification.
40. As Alejandro, I want browser QA proportional to user-visible impact, so that critical flows receive real interaction evidence and tiny changes do not pay a full suite unnecessarily.
41. As Alejandro, I want the selected QA level explained, so that I can judge whether the evidence matches the risk.
42. As Alejandro, I want every prepared repository to support previews, so that user-visible work can be inspected before merge.
43. As Alejandro, I want previews usable locally and shareable when needed, so that review works on computer and phone.
44. As Alejandro, I want Local Visual Plan and Recap private by default, so that architecture and operational details are not published openly.
45. As Alejandro, I want Local Visual Plan separate from the pull request, so that planning review and code review remain distinct surfaces.
46. As Alejandro, I want Local Visual Recap separate from the pull request, so that the final decision surface can optimize for rapid human review.
47. As Alejandro, I want the recap to include failures and corrections, so that green status does not hide the path or residual risk.
48. As Alejandro, I want a direct preview link and manual checklist in the recap, so that I know exactly what remains for me.
49. As Alejandro, I want the same architecture vocabulary across repos, so that humans and agents reason with consistent terms.
50. As Alejandro, I want deep Modules with small Interfaces, so that behavior is easy to use, test and maintain.
51. As Alejandro, I want tests to target observable behavior through Interfaces, so that internal refactors do not create test churn.
52. As Alejandro, I want Seams introduced only when real Adapters vary, so that abstractions earn their complexity.
53. As Alejandro, I want repository domain language preserved, so that shared practices do not homogenize unrelated products.
54. As Alejandro, I want `improve-codebase-architecture` to report candidates before changing code, so that architectural refactors remain deliberate.
55. As Alejandro, I want modern React checks and React Doctor integrated where applicable, so that agent-generated slop is detected automatically.
56. As Alejandro, I want orphaned skills removed and the newest maintained variant to replace older divergent duplicates, so that precedence is explicit rather than accidental.
57. As Alejandro, I want Convex projects detected, so that their backend-specific instructions and validations are available in each capable harness.
58. As Alejandro, I want a Factory equivalent when a Codex plugin cannot load there, so that cross-harness parity is based on behavior rather than filenames.
59. As Alejandro, I want a read-only repository audit, so that I can understand readiness before authorizing normalization.
60. As Alejandro, I want the audit to distinguish six loading states, so that “exists” never means “works.”
61. As Alejandro, I want the audit to detect instructions from other products, so that copied residue cannot govern the wrong repository.
62. As Alejandro, I want the audit to inspect nested CWD behavior, so that hidden Factory commands and nested AGENTS are not missed.
63. As Alejandro, I want a separate normalization authorization, so that an audit never repairs findings automatically.
64. As Alejandro, I want one initialization flow for new repositories, so that my development system is reproducible instead of remembered.
65. As Alejandro, I want initialization to preserve product-specific design and stack, so that standards do not become cloning.
66. As Alejandro, I want initialization to configure quality, review, QA and previews, so that a new repo is operationally ready.
67. As Alejandro, I want hooks scoped to where their dependencies exist, so that a global hook cannot fail across unrelated repos.
68. As Alejandro, I want global hooks capability-aware and safe to skip, so that missing repo tooling is not an error.
69. As Alejandro, I want validation to launch the real harnesses, so that a file-presence checker cannot produce a false green.
70. As Alejandro, I want validation to test AO, simple repos, mature repos, nested apps and T3Code, so that CWD-specific behavior is covered.
71. As Alejandro, I want validation to prove that manual-only stages remain inert, so that authorization is part of the test contract.
72. As Alejandro, I want validation to detect catalog overflow, so that implicit skill discovery cannot degrade silently.
73. As Alejandro, I want a capability-based orchestrator role, so that today's model can be replaced without changing the lifecycle.
74. As Alejandro, I want GPT-5.6 Sol High treated as a provisional baseline, so that Extra High is not paid by default without evidence.
75. As Alejandro, I want Spark modes and reasoning levels tested, so that the fast implementer mapping is not based on assumptions.
76. As Alejandro, I want Factory `inherit` resolved to reproducible mappings, so that droid behavior does not depend on an invisible session choice.
77. As Alejandro, I want benchmarks to compare identical tasks and checks, so that model rankings are causally meaningful.
78. As Alejandro, I want benchmarks to measure correction cost and slop, so that fastest first diff is not mistaken for fastest delivery.
79. As Alejandro, I want implementation, review, architecture, browser QA and visual judgment benchmarked separately, so that one model is not forced into every role.
80. As Alejandro, I want benchmark history retained and rerunnable, so that monthly model changes can be evaluated against prior results.
81. As Alejandro, I want cost and time treated as measured signals, so that invented budgets do not reduce quality.
82. As Alejandro, I want polling, duplicate context and redundant agents measured as waste, so that efficiency improves without weakening gates.
83. As Alejandro, I want NutriPlan, The Barber Central and AOHYS studied for principles, so that proven practices inform the system without copying domains.
84. As Alejandro, I want Escuela 360 excluded from the first readiness rollout until its own audit, so that an initialized but stale repository is not treated as a current reference.
85. As Alejandro, I want each remaining repo audited before it is marked ready, so that gradual rollout remains honest.
86. As Alejandro, I want Impeccable visual/mobile configuration left intact, so that process work does not alter product design.
87. As Alejandro, I want phases to end in evidence and a visual recap, so that I can approve progress without reviewing raw agent activity.
88. As Alejandro, I want the complete program tracked in Linear when requested, so that phases and dependencies are visible without making Linear the source of truth.
89. As Alejandro, I want natural-language recovery of the system, so that I do not need to memorize a secret command.
90. As Alejandro, I want recovery to use versioned artifacts and current installed state, so that memory does not depend on a conversation transcript.

## Implementation Decisions

### Canonical system and module depth

* Build one canonical Development System repository. Its external Interface is the versioned contract plus explicit install, audit, validate, benchmark and rollback operations. Harness-specific complexity remains behind that Interface.
* Treat Codex and Factory implementations as Adapters at a real Harness Seam because their tools, models, discovery and hooks differ. Treat T3Code initially as a verified Codex client surface, not a third semantic Adapter.
* Keep installed HOME state as generated output with a manifest and drift check. Direct edits are detectable and never silently redefine the canonical version.
* Pin every installed skill to its source, upstream commit, content hash, logical name and supported harness. A successful copy is not evidence that the harness discovers or loads it.
* Remove skills absent from the current authoritative upstream source instead of retaining compatibility debris by default.
* When two installed skills have the same logical name but divergent content, retain the newest maintained variant and remove the older variant. Intentional Codex/Factory adapters may diverge only when the manifest records that distinction and their observable contract remains equivalent.
* Retain byte-identical Codex/Factory copies only when each harness requires its own physical mirror. Do not count intentional mirrors as independent skills.
* Keep the supported harness scope to Codex, T3Code and Factory Droid. Do not create adapters or agent-specific copies for unrelated harnesses merely because an installer advertises compatibility with them.
* Organize shared behavior as deep Modules. Avoid pass-through wrappers that merely rename upstream skills without adding authorization, portability or validation.
* Keep repo-specific architecture, commands, release policy, stack and design outside the global Interface. The global system supplies principles and contracts, not product identity.

### Lifecycle state machine

* Represent lifecycle stage and gate state explicitly. A stage recommendation cannot itself transition the state.
* Keep Wayfinder outside the automatic router and outside the normal lifecycle. Only Alejandro's explicit invocation may enter it.
* Manual transitions are requirements approval, spec/plan approval, tickets approval, `Implement Preview`, and every merge/release/production action.
* Automatic transitions inside an authorized delivery run may implement, validate, review, correct, perform proportional QA, publish preview, update PR and generate recap.
* Side-effecting manual skills cannot be reached by direct filesystem reads from an automatic router. Adapters must preserve the same authorization invariant even when their native skill metadata differs.
* Natural-language requests can map to transitions; no secret phrase is required. The transition record must still show the exact operation authorized.

### `Implement Preview` and delivery

* `Implement Preview` executes the approved terminal slice, not every open item in a broad program.
* It authorizes edits, tests, commits, push, PR and preview. It excludes merge, release and production.
* It may incorporate newly discovered work only when that work blocks the terminal slice. Non-blocking findings become visible follow-ups.
* Reversible controversial technical decisions continue and are recorded with rationale, alternatives and rollback. Economic activations, destructive/irreversible actions and extraordinary paid usage are hard stops.
* Worktrees are opt-in. Benchmark fixtures may use explicitly authorized temporary worktrees.

### Orchestration and agents

* Use orchestration for real complexity, independent exploration, cross-surface work or materially valuable review. Keep trivial edits on the orchestrator.
* Default to one writer. Permit multiple writers only with disjoint ownership and no shared dependency sequence.
* Keep the execution orchestrator responsible for decomposition, role/model selection, integration, conflicts, findings and the terminal state.
* Reuse a worker for follow-up within the same ownership. Avoid active polling and duplicate searches.
* Define roles by capability, then map each Adapter to available agents, droids and models. Existing rosters are inputs to benchmark, not immutable decisions.

### Review

* Provide a Foul/adversarial-reviewer capability with clean context and a mandate to falsify correctness.
* Require intention/spec and standards/correctness review for non-trivial work. Add security, performance, visual and user-flow jurors based on risk.
* Prefer a distinct model or provider where useful. A clean context with a distinct mandate is an acceptable fallback.
* Use `blocker`, `high`, `medium` and `low`. Completion requires no blocker/high, explicit disposition of medium, green gates and required QA evidence.
* Do not cap review rounds numerically. Detect measured non-convergence and escalate without declaring success.

### Tests, QA and preview

* Make TDD a reasoned decision based on risk, behavior, existing coverage and test value. Require evidence for every change regardless of TDD choice.
* Prefer the highest stable Seam for tests: one acceptance Interface should exercise a contract scenario across a harness Adapter and repository fixture, then assert observable stage, authorization, catalog and evidence outcomes.
* Add narrower tests only when they isolate an Adapter or benchmark responsibility that the acceptance Interface cannot diagnose efficiently.
* Require browser/computer-use evidence for materially user-visible flows. Permit lightweight snapshots/previews for small visible changes and reasoned omission for internal work.
* Make preview capability a readiness requirement. Do not auto-activate paid infrastructure to satisfy it.

### Repository preparation

* Create an audit/normalize capability that is read-only by default. Audit and mutation are separate transitions.
* Create an initialize-new-repository capability that configures the contract without imposing visual design or activating paid services.
* Detect stack capabilities such as Convex and React, then select validated repo-local rules and harness equivalents.
* Normalize skill installations by removing orphaned bundles, stale source checkouts and superseded divergent variants while preserving manifest-declared harness mirrors.
* Integrate `codebase-design` vocabulary and a manual `improve-codebase-architecture` flow. Architecture reports precede refactoring.
* Treat React Doctor and modern React checks as candidate evidence tools whose overlap and precedence must be validated.

### Local visual surfaces

* Generate Local Visual Plan with the spec and Local Visual Recap at the end of each phase/delivery run.
* Keep both private, local and separate from pull requests. Investigate secure computer/phone access and a Factory-equivalent presentation surface before selecting infrastructure.
* Never publish them openly or adopt Convex/private hosting without comparing privacy, cost, activation and complexity.

### Linear and source control

* Track this program in Linear because the user explicitly authorized it. Linear records project state, phases, gates and issues; it is not the canonical content source after the central repository exists.
* Store the current bootstrap spec locally until the canonical repository is created. Move/version authoritative system documents in the repository during the first authorized implementation phase.
* Create the central repository and publish to GitHub only after spec/plan and ticket gates.

### Rollout

* Implement in reviewable phases: canonical repository; skill provenance and load repair; lifecycle; adapters; operational validator; benchmark; review/delivery loop; local visuals; repo audit/init; three priority pilots; remaining rollout; release/rollback documentation.
* A phase does not advance while its human gate is pending. Calendar goals do not override gates.
* The first readiness pilots are NutriPlan, The Barber Central and AOHYS. Escuela 360 and other repos remain explicitly unready until audited.
* Preserve Impeccable visual/mobile configuration. Fix only process-level integration breakage during this program.

## Testing Decisions

### Primary acceptance Seam

The highest test Seam is a Development Contract Scenario:

> Given a canonical system version, a harness Adapter, a repository fixture, a natural-language user action and an initial authorization state, execute one lifecycle scenario and inspect only observable outputs: selected stage, requested/denied transition, discovered and loaded capabilities, external side effects, evidence record and terminal state.

This Seam tests callers and adapters through the same Interface. It should cover most lifecycle, authorization and parity behavior without asserting internal file reads or prompt text.

### Modules and scenarios

* Canonical installation: install an exact upstream commit, detect drift and orphans, remove superseded divergent variants, reinstall and rollback.
* Harness parity: run equivalent scenarios through Codex and Factory; run Codex scenarios through T3Code and compare observable state.
* Manual boundaries: prove Wayfinder is unreachable from automatic routing and that Wayfinder, grilling, spec, tickets and delivery remain inert until explicitly invoked.
* Delivery authorization: prove `Implement Preview` permits PR/preview actions but denies merge/release/production.
* Economic safety: prove paid activation, destructive operations and extraordinary usage request approval before execution.
* Discovery: distinguish exists, discovered, catalogued, loadable, loaded and behaviorally influential.
* Catalog health: fail on omitted critical skills, orphaned entries, unmanifested divergent duplicates, overflow warnings, broken symlinks and scanner errors; report manifest-declared identical harness mirrors without treating them as conflicts.
* Hooks: prove repo-local hooks resolve and global hooks skip unsupported repos without failure.
* Nested context: run from AO, repo roots and nested apps to validate AGENTS and Factory-command precedence.
* Review: inject known defects and prove adversarial reviewers surface them, severity is consistent and the loop does not exit with blocker/high findings.
* Non-convergence: simulate repeated findings and prove the circuit breaker pauses without converting failure to success.
* TDD selection: verify the decision and evidence for representative logic, regression, visual and mechanical changes.
* QA selection: verify full, lightweight and omitted browser evidence decisions against change risk.
* Preview readiness: prove prepared repos expose the required local/shared review capability without unapproved paid activation.
* Visual artifacts: validate required plan/recap fields, privacy defaults, responsive readability and separation from PR content.
* Repository audit: seed duplicated, inert and foreign-project instructions and prove the report identifies them without mutation.
* Repository initialization: apply to representative stacks and prove idempotency, preserved product identity and working validation.
* Convex parity: prove equivalent repo guidance and validation is reachable in each supported harness.
* React quality: seed common slop patterns and prove selected tools find them without contradictory duplicate gates.
* Benchmarks: repeat identical fixtures and preserve model, harness, reasoning, timing, token, cost, correction and finding metadata.
* Rollout: validate NutriPlan, The Barber Central and AOHYS individually before marking them ready; prove Escuela 360 remains unready.

### Good-test criteria

* Assert externally observable behavior, authorization and evidence; do not snapshot prompts or implementation text.
* Use production + test Adapters only at real Seams.
* Prefer one contract scenario over many shallow tests when it exercises the same behavior.
* Preserve deterministic fixtures and identical instructions for model comparisons.
* Treat a green job as proof only of the command and surface actually exercised.
* Keep failure output diagnostic enough to distinguish canonical-source, Adapter, harness-runtime and repo-policy failures.

### Prior art

* The existing global structural validator provides roster and file-presence checks but must not be treated as operational proof.
* The Barber Central and NutriPlan handoffs provide measured patterns for terminal slices, proportional validation, independent review, preview and human pause.
* Existing AOHYS Impeccable integration provides one example of correctly scoped project hooks, while the current global hook provides a negative fixture.
* The Barber repo's local skill discovery provides a positive fixture for both harnesses; AO and Factory global discovery provide negative fixtures.
* Existing release trains, authenticated smoke tests and browser QA in mature repos provide repo-local prior art without becoming global commands.

## Out of Scope

* Changing product design systems, visual identity, frontend styling or mobile UI to make repositories look alike.
* Running Impeccable `init` or changing its repo-specific visual/mobile processes as part of this system implementation.
* Automatically merging pull requests, releasing versions or deploying product code to production.
* Automatically buying, activating or upgrading external services or infrastructure.
* Publishing Local Visual Plans or Recaps openly on the Internet.
* Treating Linear as the canonical source after the central repository exists.
* Making every repository use the same stack, folder tree, commands, preview provider or release train.
* Applying Wayfinder automatically because an initiative is large.
* Declaring a universal winning model before repeatable benchmarks.
* Converting every code change into mandatory TDD or full browser QA.
* Using worktrees outside explicit user requests or authorized benchmarks.
* Modifying non-priority repositories before their own audit/rollout phase.

## Further Notes

* The complete program remains in scope, but the first terminal slice is the central system plus readiness of NutriPlan, The Barber Central and AOHYS. Escuela 360 and the remaining repositories are explicit later rollout work, not hidden debt.
* “Complete today” is an execution target, not permission to skip human gates or claim unverified completion.
* GPT-5.6 Sol High is a provisional orchestrator baseline. Extra High is not the normal default. Spark modes, Factory alternatives, visual models and reviewer mappings require benchmarks.
* The label “Foul” names the adversarial capability; the implementation may reuse or compose existing roles if evidence shows a new agent is unnecessary.
* The current spec was bootstrapped before the central repository exists. Once implementation is authorized, the repository becomes the versioned source and this bootstrap copy is migrated with history.
* The Local Visual Plan is a separate private review surface generated with this spec.
