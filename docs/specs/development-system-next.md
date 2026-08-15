# Spec: Development System Next

Fecha: 2026-08-14
Estado: **Aprobado para ticketización por instrucción directa de Alejandro**
Fuente de producto: `01-customer-story.md` del workflow privado **Development System Next**
Alcance de esta fase: construir el sistema canónico; las convergencias de productos se ejecutan después.

## Problem Statement

El Development System ya mejora diseño, revisión y seguridad, pero tarda demasiado en convertir una conversación normal en software listo para probar. El flujo obliga a recordar nombres, genera documentos repetidos, añade validaciones amplias donde bastaría evidencia enfocada y puede dedicar medio día a una funcionalidad que debería producir una primera versión útil en minutos.

La fuente de intención también está invertida. El proceso correcto comienza con un **Product Grill With Docs** por Topics. Ese primer grill no diseña arquitectura: entiende actor, problema, resultado deseado, experiencia futura, límites y expectativas. De esa evidencia se genera un Future Customer Story breve y no técnico.

Después de aprobar la historia comienza un **Technical Grill With Docs** adaptado a lo que la historia realmente necesita. Ese segundo grill puede inspeccionar repositorio y documentación y pregunta por comportamiento actual, entidades, estados, interfaces, riesgos, seguridad, datos, pruebas, rollout y decisiones técnicas relevantes. Sus respuestas alimentan el flujo Working Backwards ya programado: preguntas e investigación cuando hagan falta, Product Contract, Technical Contract, Implementation Map/tickets y handoff privado. Los perfiles Quick, Standard y Complex controlan profundidad sin mezclar el Product Grill con diseño técnico. Una petición explícita de implementación simple todavía puede usar el fast path cuando el comportamiento es conocido, reversible y de bajo riesgo.

Alejandro trabaja con prisa, frecuentemente desde el celular y con ventanas cortas frente a la computadora. No puede revisar reportes gigantes, ejecutar benchmarks A/B ni reconstruir qué quedó listo entre repositorios. Necesita que T3 Code le diga, en pocas líneas, qué puede decidir, leer, probar o liberar desde el dispositivo disponible.

Los repos principales han acumulado drift arquitectónico, skills stale, componentes UI antiguos, observabilidad desigual y Release Trains redundantes. Instalar más instrucciones no demuestra que los agentes las sigan. El sistema necesita fitness functions rápidas, revisiones semánticas programadas, evidencia runtime y fuentes canónicas actuales por stack. Debe optimizar React, TanStack, shadcn, Convex, Cloudflare, Expo/React Native, iOS, Android y Electron sin imponer una arquitectura idéntica a productos distintos.

## Solution

Evolucionar el repositorio canónico a **Development System Next**, soportado únicamente por Codex y T3 Code, con cinco interfaces integradas:

1. **Definition Router** — reconoce intención natural y conduce `Product Grill With Docs → Future Customer Story → Technical Grill With Docs → Working Backwards contracts → Implementation Map/tickets → T3 handoff → Implement Preview`. Quick puede compactar artefactos; Standard conserva el flujo programado y Complex añade evidencia por riesgo. La orden explícita de implementación simple usa un fast path. Ningún documento autoriza código, merge o producción.
2. **Execution Router** — reemplaza `work-multiple` por **Parallel Work**. Calcula la frontera ejecutable, abre sólo lanes independientes, conserva un writer por superficie, integra un solo candidato y continúa otros lanes cuando una falla local no rompe la base compartida.
3. **Technical Reader Library** — Markdown permanece canónico; un índice privado agrupa iniciativas y genera HTML offline legible. El Reader soporta código, tablas, charts y Mermaid oficial completo —Gantt, timeline, sequence, architecture y demás tipos— con pan, zoom, pinch, expand y fullscreen.
4. **Check-in + Development Steward** — “Ya llegué”, “estoy en el celular” o preguntas equivalentes producen una lista corta reconciliada desde repositorios, Linear, PRs, CI, previews, releases y observabilidad. El Steward realiza revisiones programadas de drift y upstream sólo para AO HyS, Casa Roca, The Barber Central, NutriPlan y ETERIA.
5. **Fast Quality and Release Contract** — cada repositorio declara capacidades y adapters. El camino normal ejecuta sólo validación afectada; los checks costosos se reservan para el gate integrado que realmente los necesita. El Release Train construye una vez cuando sea posible, evita auditorías duplicadas, mide cada fase y no afirma preview o producción sin evidencia del proveedor.

## User Stories

1. As Alejandro, I want to describe an idea normally, so that I never need a mega-prompt or a memorized skill name.
2. As Alejandro, I want an initial Product Grill With Docs to produce the Future Customer Story, so that discovery begins with the customer outcome rather than architecture.
3. As Alejandro, I want the Future Customer Story to be compact and non-technical, so that I can approve product direction quickly.
4. As Alejandro, I want a second Technical Grill driven by the approved story, so that entities, behavior, constraints and implementation decisions receive only the questions they actually need.
5. As Alejandro, I want the established Working Backwards contracts and gates to continue after the Technical Grill, so that speed does not remove necessary product or technical precision.
6. As Alejandro, I want to request simple implementation explicitly, so that low-risk work can reach evidence in minutes.
7. As Alejandro, I want natural-language routing in Spanish or English, so that commands remain optional escape hatches.
8. As Alejandro, I want only Codex and T3 Code supported, so that unused harness parity does not create maintenance drag.
9. As Alejandro, I want Parallel Work to use dependency-aware lanes, so that independent work advances without conflicting writers.
10. As Alejandro, I want one integrated candidate by default, so that I review coherent functionality rather than a pile of PRs.
11. As Alejandro, I want plans stored by human initiative name, so that I can find the right Reader later.
12. As Alejandro, I want one offline HTML Reader, so that no server or hosted private content is required.
13. As Alejandro, I want every Mermaid diagram family rendered well, so that progress, sequence, architecture and timelines are not forced into flowcharts.
14. As Alejandro, I want diagrams to support pan, wheel/trackpad movement, pinch and zoom, so that large diagrams remain readable.
15. As Alejandro, I want “Ya llegué” to show only actions that need me, so that short computer sessions are useful.
16. As Alejandro, I want check-in to distinguish mobile-friendly actions from computer-only QA, so that I can help from anywhere.
17. As Alejandro, I want stale or fake Linear work removed instead of archived as clutter, so that the tracker remains trustworthy.
18. As Alejandro, I want issue identifiers to reflect their product, so that Casa Roca work is not confused with AO HyS work.
19. As Alejandro, I want architectural drift detected periodically, so that agent slop does not become precedent.
20. As Alejandro, I want recognized canonical repos and primary documentation used as evidence, so that stack guidance stays current.
21. As Alejandro, I want React Doctor, lint, typecheck, focused tests and Impeccable composed without duplicate work, so that quality stays fast.
22. As Alejandro, I want zero `any` and no dishonest TypeScript escape hatches in owned code, so that agents preserve real type safety.
23. As Alejandro, I want shadcn components, registries and icon strategy kept current unless a repo pins an exception, so that bugs do not persist through stale copies.
24. As Alejandro, I want Convex functions checked for authorization, validators, indexes, pagination, contention and bounded reads, so that performance and cost remain controlled.
25. As Alejandro, I want official Convex components considered before custom infrastructure, so that we do not reinvent maintained capabilities.
26. As Alejandro, I want Cloudflare to own suitable files and images while Convex owns domain data, so that storage costs and boundaries remain intentional.
27. As Alejandro, I want PostHog to become the primary observability surface when parity is proven, so that errors, releases and product signals are actionable together.
28. As Alejandro, I want deterministic production errors to produce bounded draft fixes, so that known failures can reach review before a user reports them.
29. As Alejandro, I want ambiguous anomalies investigated rather than auto-fixed, so that automation does not invent causes.
30. As Alejandro, I want Release Train phases timed separately, so that duplicated checks, provider waits and human gates are visible.
31. As Alejandro, I want changed-surface validation during normal work, so that full suites do not tax every ticket.
32. As Alejandro, I want builds reused across release phases where truthful, so that the same bytes are not rebuilt needlessly.
33. As Alejandro, I want migrations and backfills isolated from ordinary deploy steps, so that data risk stays explicit.
34. As Alejandro, I want preview, provenance, smoke and rollback evidence tied to the provider, so that green Git cannot impersonate production.
35. As Alejandro, I want Development Steward to produce one concise weekly report for five primary repos, so that maintenance does not become five noisy threads.
36. As Alejandro, I want safe upstream updates prepared as draft PRs but never auto-merged, so that freshness does not bypass judgment.
37. As Alejandro, I want real development runs measured automatically, so that speed improves without asking me to benchmark manually.
38. As Alejandro, I want active work, agent wait, checks, CI, provider time, corrections and human attention reported separately, so that no score hides the bottleneck.
39. As Alejandro, I want functional evidence for small work in about five minutes and a written explanation above ten, so that ceremony cannot dominate delivery.
40. As Alejandro, I want product convergence to start only after this system is installed and verified, so that migrations dogfood the intended process.

## Implementation Decisions

### Lifecycle and intent

- Add a non-technical Product Grill before the existing Working Backwards chain. It persists settled product Topics and generates the Future Customer Story.
- Treat a conversation that already contains a completed Product Grill as valid input; never re-interview settled Topics.
- Keep Future Customer Story human-oriented, short and free of premature architecture.
- After story approval, run a separate Technical Grill whose Topics are derived from the story, selected profile, repository evidence and risk triggers rather than a fixed questionnaire.
- Feed the Technical Grill into the programmed Working Backwards sequence: research questions/report as needed, Product Contract, Technical Contract, Implementation Map/tickets and private T3 handoff.
- Preserve Quick as a compact representation of the same decisions, Standard as the complete default and Complex as Standard plus risk-specific evidence.
- Preserve separate authorization for implementation, external tracker writes, commit/push/PR, merge, release and production.
- Remove Factory from generated contracts, catalogs, repository adapters and validation expectations without rewriting published versions.

### Shared state and reports

- Introduce one typed, provider-neutral evidence model for repository state, issue state, PR/CI state, preview/release evidence, observability findings and required human action.
- Make Check-in a pure prioritization interface over collected evidence. It does not silently mutate trackers or repositories.
- Classify actions by device capability: mobile, computer, local-secret/device, or promotion authorization.
- Let Development Steward schedule collection, freshness checks and deterministic evaluations; scheduled runs produce private report artifacts and optional draft changes only.

### Reader and private library

- Use stable workflow IDs and human initiative names under private HOME storage. Generate a searchable catalog from metadata without publishing plan contents.
- Keep Markdown and workflow JSON canonical. HTML is disposable derived output.
- Embed official Mermaid and an open-source pan/zoom runtime locally so every supported Mermaid family works without network access.
- Keep the Reader responsive, accessible, noindex, offline and CSP-restricted. Reader polish is an implementation slice and does not block definition.

### Architecture and quality

- Maintain stack-specific architecture profiles sourced from primary docs, recognized open-source implementations and local product evidence. A profile guides locality, module depth, composition and seams; it never copies a repository wholesale.
- Use deterministic fitness functions on changed code and periodic semantic reviews for patterns that static tools cannot prove.
- Compose existing tools by ownership: formatter/lint, typecheck, focused behavior tests, React Doctor, Impeccable, Codex Security, Convex review and provider-specific checks. Do not execute two tools for the same evidence without a documented reason.
- Development Steward must treat the installed Impeccable skill and CLI as versioned upstream dependencies: compare the exact repo-local version against the current official release, show the pinned diff and changelog, and prepare updates only for repositories that already use it.
- Treat `any`, double assertions and equivalent type erasure as violations in owned TypeScript unless an external boundary has a narrow documented adapter.
- Keep shadcn updates diff-aware and repo-specific. Preserve working design and behavior; do not migrate primitive families automatically.

### Convex and observability

- Add a Convex Guardian that evaluates auth, validators, indexes, pagination, bounded results, write contention, actions, scheduling, storage boundaries and official components.
- Prefer Cloudflare for suitable binary/static storage while keeping domain records and relationships in Convex.
- Add a PostHog observability contract covering production-only instrumentation, exceptions, release/source-map identity, privacy, replay, Web Vitals and actionable alert routing.
- Permit automated draft fixes only after deterministic reproduction, a bounded root cause and a regression test.

### Release Train

- Model release as a graph of affected surfaces and provider adapters rather than a fixed list of repeated jobs.
- Reuse immutable build artifacts where providers permit it; record when a provider forces a rebuild.
- Separate local changed validation, integrated certification, preview, data operations, production promotion and production smoke.
- Emit structured timings, skipped-step reasons, exact revision/build provenance, provider destination, smoke evidence and rollback handle.
- A provider credential failure blocks only that provider lane unless it invalidates shared evidence.

### Linear and rollout

- Define explicit product/team mapping so issue keys and titles identify AO HyS, Casa Roca, The Barber Central, NutriPlan and ETERIA correctly.
- Provide a destructive-cleanup preview before actual Linear deletion. Actual cleanup requires separate authorization and is not part of this implementation.
- Build repository convergence planning from audit evidence after Development System Next is installed. No product repository is changed by this spec.

## Testing Decisions

### Primary acceptance seam

Create one **Development System Next Contract Scenario**:

> Given a natural-language request, settled grill evidence, repository capabilities, a dependency graph, provider fixtures and a human authorization state, execute the Development System interface and inspect only observable outputs: selected route, required artifacts, executable frontier, delegated ownership, focused checks, private reports, external-write intents, timing evidence and next human action.

The scenario must prove the normal definition path, simple implementation escape hatch, Parallel Work frontier, Check-in prioritization, provider-isolated release behavior and every authorization boundary without snapshotting prompt prose.

### Focused evidence

- Lifecycle fixtures prove Product Grill evidence precedes the non-technical story, story approval precedes the Technical Grill, and the Technical Grill governs the programmed contracts, tickets and handoff for each profile.
- Reader fixtures render flowchart, Gantt/progress, sequence, timeline and architecture Mermaid offline, then prove pan/zoom/pinch controls, responsive layout and CSP.
- Reader browser evidence must use at least one realistically wide technical diagram and prove that expanded/fullscreen rendering preserves readable labels instead of shrinking the entire diagram into a thumbnail.
- Final implementation reports must render explicitly requested prompts and handoffs as reviewable content, not links alone, and include a known-issues ledger that distinguishes fixed, remaining, and exact-authorization-blocked work.
- Check-in fixtures reconcile conflicting Linear/Git/CI/provider evidence and produce a bounded mobile or computer action list without writes.
- Parallel Work fixtures prove dependency frontier, one writer per surface, continued independent lanes and one integrated candidate.
- Quality fixtures seed React, type-safety, Convex, shadcn and security problems and assert only the responsible oracle reports each failure.
- Release fixtures prove affected-surface selection, build reuse, isolated provider failure, migration separation, timing, preview/production truth and rollback evidence.
- Steward fixtures prove the five-repository allowlist, upstream diff evaluation, concise reporting and no auto-merge.
- Measurement fixtures report timing categories separately and never invent unavailable cost or runtime evidence.

### Validation policy

- During each ticket, run only the focused checks that prove its acceptance criteria.
- Run one integrated certification after the implementation branch combines all tickets.
- Browser acceptance is required only for Reader interactions and any Check-in UI that changes observable navigation or state.
- Real HOME, live Linear, production providers and product repositories remain untouched in deterministic tests.

## Out of Scope

- Converging, refactoring or deploying AO HyS, Casa Roca, The Barber Central, NutriPlan or ETERIA.
- Deleting NutriPlan's unused React Native app; that decision belongs to its convergence initiative.
- Executing Linear deletion or renaming live teams/issues.
- Migrating every existing shadcn component or changing product visual identities.
- Removing Sentry before PostHog parity is proven per repository.
- Auto-merging draft fixes, promoting production, running destructive migrations or activating paid infrastructure.
- Promising automatic T3 threads until a supported API is demonstrated.
- Supporting Factory or maintaining semantic parity with unused harnesses.

## Success and stop condition

Development System Next is ready for product convergence when the new version is installed from an immutable manifest into an isolated HOME, its contract scenario is green, the Reader opens directly from disk, a Check-in fixture returns a short actionable report, Parallel Work exposes a truthful frontier, the Release Train fixture demonstrates faster non-duplicated paths, and no operation crosses its authorization boundary. Product repositories and live trackers remain unchanged until their separate initiatives begin.
