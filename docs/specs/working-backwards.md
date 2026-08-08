# Spec: Working Backwards para definición de funcionalidades

Fecha: 2026-08-07
Estado: **Aprobado**
Gate actual: spec, seam de aceptación y mapa de tickets aprobados por Alejandro el 2026-08-07. Los tickets pueden marcarse `ready-for-agent`; publicación en Linear, implementación y promoción conservan autorizaciones separadas.

## Problem Statement

Alejandro quiere usar agentes para convertir una idea de producto en una definición precisa antes de abrir T3 Code e implementar. Hoy el Development System separa grilling, spec, tickets e Implement Preview, pero no define un contrato único que comience por explicar la funcionalidad desde la experiencia futura del usuario y trabaje hacia atrás hasta las entidades, reglas, decisiones técnicas, slices y tickets.

Sin ese contrato, la implementación puede convertirse en el primer momento en que se descubren preguntas de producto, estados, permisos, dependencias o consecuencias arquitectónicas. Esto crea rework, tickets que describen capas en lugar de valor observable, reviews que descubren intención demasiado tarde, mayor consumo de contexto y cambios técnicamente verdes que no resuelven bien la necesidad del usuario.

HumanLayer ofrece una superficie útil para preguntas, investigación, documentos, comentarios y estructura, pero sus artefactos, comandos, worktrees, sincronización y permisos no son la fuente canónica del Development System. T3 Code sigue siendo la superficie preferida para implementar. El workflow debe aprovechar HumanLayer sin hacer que el conocimiento, la autorización o la capacidad de continuar dependan de una aplicación o nube particular.

## Solution

Añadir al Development System un workflow canónico y portable llamado `working-backwards`. El workflow coordina las capacidades existentes de grilling, investigación, spec y ticketización; no las reemplaza ni autoriza implementación.

El workflow comienza con un Working Backwards Brief que describe la experiencia terminada desde el punto de vista del usuario. A partir de él genera preguntas de investigación, evidencia del estado actual, contrato de producto, modelo de dominio y diseño técnico, Structure Outline, tickets verticales y un T3 Implementation Handoff privado.

El workflow ofrece tres perfiles:

- `Quick`: para un cambio pequeño, conocido, reversible y de una sola superficie. Produce un brief compacto, criterios observables, uno o pocos slices y handoff.
- `Standard`: perfil por defecto. Produce la cadena completa de brief, investigación, Product Contract, Domain & Technical Design, Structure Outline, tickets y handoff.
- `Complex`: para cambios con entidades o invariantes nuevos, autorización, datos sensibles, migraciones, proveedores externos, coste real, múltiples repositorios, decisiones difíciles de revertir o riesgo arquitectónico. Añade los artefactos de prueba, ADR, migración, seguridad o rollout que el riesgo exija.

El agente recomienda el perfil a partir de evidencia, pero la recomendación es read-only. Un trigger de riesgo puede escalar el mínimo requerido; nunca puede reducir silenciosamente un trabajo riesgoso a `Quick`. Alejandro puede escoger un perfil más profundo. Cambiar de perfil conserva las decisiones ya aprobadas y registra por qué se escaló o redujo.

### Working Backwards Brief

El brief adapta Working Backwards al Development System sin exigir ficción de marketing ni afirmaciones inventadas. Incluye:

- título y proposición de valor entendibles por el usuario;
- usuario o actor principal;
- problema actual y resultado deseado;
- explicación de la experiencia como si la funcionalidad ya estuviera disponible;
- recorrido para comenzar y alcanzar el primer momento de valor;
- External FAQ sobre funcionamiento, límites, errores, recuperación y diferencias frente al proceso actual;
- Internal FAQ sobre valor, alcance, evidencia, incógnitas, coste, riesgos, dependencias y métricas de éxito;
- explícitamente qué no se construirá;
- afirmaciones que todavía necesitan investigación.

Las citas de usuarios, métricas, precios, fechas y capacidades externas requieren evidencia. El agente no inventa testimonios ni presenta una hipótesis como hecho.

### Cadena de artefactos

El perfil `Standard` produce, en orden lógico:

1. Working Backwards Brief.
2. Research Questions.
3. Research Report.
4. Product Contract.
5. Domain & Technical Design.
6. Structure Outline.
7. Ticket Map.
8. T3 Implementation Handoff.

El Research Report describe el estado actual y responde las preguntas aprobadas; no diseña anticipadamente la solución. El Product Contract define comportamiento observable, flujos, estados, reglas, permisos, errores, recuperación, compatibilidad, aceptación y fuera de alcance. El Domain & Technical Design define entidades, relaciones, invariantes, contratos, lecturas, escrituras, eventos, migraciones, seguridad y decisiones descartadas. El Structure Outline divide el resultado en slices verticales verificables.

Los artefactos posteriores declaran qué artefactos aprobados los gobiernan. Para estado actual, el código y runtime observados prevalecen sobre documentos anteriores. Una contradicción entre artefactos se detiene para corrección; no se resuelve silenciosamente por cercanía temporal.

### Gates humanos

El workflow utiliza los gates persistidos existentes:

1. `Product Contract Approved`: confirma Working Backwards Brief, preguntas relevantes y experiencia deseada. Corresponde al gate de requisitos.
2. `Technical Contract Approved`: confirma Product Contract, Domain & Technical Design y artefactos de riesgo. Corresponde al gate de spec/plan.
3. `Implementation Map Approved`: confirma Structure Outline, granularidad, dependencias, acceptance criteria y frontera inicial. Corresponde al gate de tickets.

Comentarios, aprobaciones visuales o estados de HumanLayer no conceden por sí mismos ninguna transición. Cada gate se registra como una operación explícita del Development System. Después del tercer gate pueden publicarse tickets mediante una autorización separada de escritura externa y puede generarse el handoff. Ninguno de esos actos autoriza implementación.

`Implement Preview` sigue siendo el único trigger de delivery y autoriza sólo un terminal slice. Commit, push, PR, merge, release y producción conservan las fronteras existentes.

### Fuentes de verdad y privacidad

- Los documentos de producto y diseño aprobados viven en el repositorio del producto y son portables entre harnesses.
- Linear contiene issues, relaciones y estado operativo sólo después de publicación autorizada; no reemplaza el contrato del repositorio.
- El lifecycle, receipts, Local Visual Plan, T3 Implementation Handoff operativo y recaps privados viven en el HOME privado del Development System.
- HumanLayer contiene borradores, comentarios y copias de trabajo. Sus task IDs se pueden vincular al workflow ID, pero sus artefactos no se convierten automáticamente en fuente canónica.
- Ningún artefacto privado se copia a `.humanlayer/tasks` o a servicios sincronizados sin clasificación y autorización explícitas.
- Los daemons remotos, integraciones y proveedores externos permanecen desactivados en el primer piloto.

### Handoff a T3 Code

El T3 Implementation Handoff permite abrir un contexto fresco en T3 Code sin reconstruir la conversación. Registra:

- workflow y feature ID;
- perfil y razón de selección;
- artefactos aprobados y su precedencia;
- repositorio, rama base y revisión investigada;
- tickets y frontera lista;
- primer terminal slice propuesto;
- alcance y fuera de alcance;
- acceptance criteria y focused checks;
- riesgos, incógnitas y decisiones controversiales;
- gates y operaciones que todavía requieren autorización;
- receipts de HumanLayer, Codex u otro harness cuando existan.

T3 Code valida que el repositorio y los artefactos sigan vigentes antes de implementar. Un handoff antiguo o una rama divergente produce una solicitud de refresh, no ejecución basada en suposiciones.

## User Stories

1. As Alejandro, I want to explain a feature as a future user experience, so that implementation starts from customer value rather than internal components.
2. As Alejandro, I want the workflow to ask the hard product questions before code, so that missing rules are inexpensive to resolve.
3. As Alejandro, I want a Working Backwards Brief written in plain language, so that I can judge the idea without reading implementation detail.
4. As Alejandro, I want unsupported claims and invented customer quotes prohibited, so that the brief is honest rather than persuasive slop.
5. As Alejandro, I want external and internal FAQs, so that user concerns and delivery constraints are visible together.
6. As Alejandro, I want research questions separated from the proposed solution, so that the agent investigates instead of confirming its first idea.
7. As Alejandro, I want research to describe current code and runtime truth, so that design rests on evidence.
8. As Alejandro, I want external behavior documented before entities and modules, so that architecture serves the product contract.
9. As Alejandro, I want entities, relations and invariants named explicitly, so that agents share one domain model.
10. As Alejandro, I want state transitions, permissions and recovery paths designed before implementation, so that edge cases do not emerge late.
11. As Alejandro, I want technical alternatives and rejected decisions recorded, so that future agents do not reopen settled trade-offs without new evidence.
12. As Alejandro, I want slices to deliver narrow end-to-end behavior, so that every completed ticket is demonstrable or verifiable.
13. As Alejandro, I want ticket blockers represented explicitly, so that the executable frontier is truthful.
14. As Alejandro, I want each ticket to fit a fresh context, so that implementation avoids the context dumb zone.
15. As Alejandro, I want Quick, Standard and Complex profiles, so that small work remains fast and risky work receives enough thought.
16. As Alejandro, I want Standard to be the default, so that ordinary features receive consistent definition without requiring profile knowledge.
17. As Alejandro, I want risky characteristics to escalate the minimum profile, so that cost or urgency cannot silently remove safety work.
18. As Alejandro, I want to override a profile deliberately, so that the workflow remains a tool rather than an autonomous product manager.
19. As Alejandro, I want profile changes and reasons recorded, so that later cost and quality comparisons remain interpretable.
20. As Alejandro, I want exactly three definition gates, so that I retain authority without approving every generated paragraph.
21. As Alejandro, I want HumanLayer comments to remain feedback rather than authorization, so that UI state cannot bypass Development System gates.
22. As Alejandro, I want approved documents portable outside HumanLayer, so that I can continue in T3 Code or another harness.
23. As Alejandro, I want HumanLayer to remain the preferred definition surface, so that artifact comments and sessions improve the planning experience.
24. As Alejandro, I want T3 Code to remain the preferred implementation surface, so that coding stays in the environment I prefer.
25. As Alejandro, I want a compact T3 handoff, so that each implementation ticket can begin in a clean context.
26. As Alejandro, I want T3 Code to verify repo and artifact freshness, so that an old plan cannot override live code.
27. As Alejandro, I want private operational artifacts outside synced task storage, so that planning does not expand data exposure silently.
28. As Alejandro, I want local daemons and minimal integrations in the pilot, so that adoption begins with the smallest trust boundary.
29. As Alejandro, I want Linear publication separated from ticket approval, so that approving a map does not imply an external write.
30. As Alejandro, I want ticket publication separated from implementation, so that `ready-for-agent` is not confused with permission to edit.
31. As Alejandro, I want the workflow available through the canonical Development System, so that HumanLayer is an adapter rather than a dependency.
32. As Alejandro, I want Codex, T3 Code and supported harnesses to observe equivalent artifacts and gates, so that changing clients does not change authority.
33. As Alejandro, I want the workflow dogfooded on its own design, so that its first validation exercises the real document chain.
34. As Alejandro, I want historical features replayed through the workflow, so that we can test whether it would have caught known rework.
35. As Alejandro, I want one real product pilot before making it the default, so that adoption follows evidence rather than enthusiasm.
36. As Alejandro, I want time, context use, corrections and downstream defects measured separately, so that no composite score hides trade-offs.
37. As Alejandro, I want implementation and review to compare code against approved decisions, so that review becomes confirmation rather than product discovery.
38. As Alejandro, I want the workflow to stop when artifacts contradict or evidence is missing, so that document volume cannot create false certainty.

## Implementation Decisions

### Canonical module and adapters

- Add `working-backwards` as a deep coordination Module in the Development System. Its Interface accepts a feature idea, repository context, chosen or recommended profile, existing approved artifacts and explicit gate operations; it returns an artifact graph, current frontier, receipts and next authorized action.
- Reuse the existing grilling, research, spec, ticket and lifecycle capabilities behind that Interface. Do not duplicate their prompt bodies merely to produce a new command name.
- Treat HumanLayer as an operator-surface Adapter. It may create tasks, sessions, working artifacts and comments while the canonical workflow owns gates, artifact classification and receipts.
- Treat T3 Code as the Codex implementation surface unless operational evidence proves semantic divergence requiring another adapter.
- Create a new semantic contract/catalog/manifest version for executable behavior. Published artifact versions remain immutable.

### Profiles and escalation

- Recommend `Quick` only when behavior is already settled, change scope is narrow, rollback is easy and no hard risk trigger exists.
- Use `Standard` when no explicit reason supports another profile.
- Require at least `Complex` for changes involving domain invariants, authorization, sensitive data, destructive behavior, migration/backfill, paid activation, external-provider uncertainty, multi-repository coordination or difficult rollback.
- Permit risk-specific artifacts rather than forcing every Complex initiative to produce the same documents.
- Record both the recommended profile and human-selected profile with rationale.

### Artifact graph

- Define typed artifact roles, prerequisites, approval state, visibility classification, source revision and content integrity. Avoid treating filenames alone as proof of meaning or approval.
- Allow Quick artifacts to combine sections while preserving the same observable contract and gates relevant to the risk.
- Preserve the separation between current-state research and future-state design.
- Bind downstream artifacts to the approved versions they consumed. Any stale dependency makes the dependent artifact stale.
- Use Markdown as the portable canonical representation. Rich HumanLayer rendering or a future visual surface is derived output.

### Authorization and side effects

- Map the three Working Backwards gates onto the current persisted requirements, spec/plan and ticket gates.
- Keep recommendations and drafts read-only with respect to lifecycle and external systems.
- Require separate explicit operations for publishing approved documents, creating/updating Linear issues, generating a private handoff and invoking Implement Preview.
- Never allow a HumanLayer comment, task status, auto-advance setting or slash command to grant Development System authority implicitly.
- Default worktree timing to `Never` for definition tasks. A later implementation worktree remains opt-in.

### Portability, privacy and security

- Store approved product contracts in the product repository, operational state in private Development System storage and tracker state in the configured tracker.
- Treat HumanLayer cloud synchronization, remote daemons and integrations as independent trust boundaries. The initial adapter uses a local daemon and excludes secrets and private operational artifacts from synced storage.
- Record HumanLayer app/CLI version, daemon location, resolved agent/model/effort, loaded skills, injected instructions, task/session identifiers and observable side effects as runtime evidence.
- Fail closed when a requested artifact cannot be kept within its visibility classification.

### Handoff and freshness

- Generate the T3 handoff only from approved artifact versions and an approved ticket map.
- Include references and integrity metadata rather than copying the entire planning corpus into every implementation context.
- Revalidate repository identity, base revision, ticket state and governing artifact integrity before T3 implementation.
- Route material drift back to the smallest affected Working Backwards stage. Do not rerun the whole workflow when only one downstream artifact is stale.

### Rollout and measurement

- Dogfood the workflow on this initiative, then replay two historical features with known rework, then run one bounded real product pilot.
- Keep HumanLayer optional until matched evidence shows lower operational time or rework without worse quality, privacy or authorization outcomes.
- Measure active operational time, human attention, tokens, reported cost, artifact revisions, corrections, first-check pass, review blockers, plan-to-code deviation and defects/rework in subsequent changes as separate signals.
- Do not claim causality from unmatched tasks or a single successful feature.

## Testing Decisions

### Primary acceptance Seam

Use one Working Backwards Contract Scenario as the highest stable Seam:

> Given a feature idea, repository fixture, profile evidence, artifact state and explicit human gate operations, execute the portable workflow through a harness Adapter and inspect only observable outputs: recommended/selected profile, artifact graph, visibility, stale state, requested or denied transition, external-write intent, ticket frontier, T3 handoff eligibility, receipts and terminal state.

This seam matches the existing Development Contract Scenario style. It must prove that HumanLayer can improve the definition surface without changing authorization semantics or making HumanLayer the source of truth.

### Scenario coverage

- Quick: produce a compact end-to-end definition for a reversible, single-surface change without generating unnecessary artifacts.
- Default: choose Standard when profile evidence is incomplete or neutral.
- Escalation: prevent Quick/Standard from bypassing a hard Complex trigger.
- Brief integrity: reject unsupported claims, missing user outcome and unresolved scope contradictions.
- Research isolation: prove research receives approved questions and current-state scope without solution-biased design instructions.
- Artifact dependencies: mark downstream artifacts stale when a governing artifact changes.
- Gates: deny design, tickets, publication, handoff or implementation when the required prior gate is absent.
- HumanLayer boundary: treat task comments and statuses as feedback only; record adapter receipts without lifecycle mutation.
- Privacy: deny placement of private artifacts into a synced destination.
- Ticketing: create a vertical dependency graph with a truthful initial frontier and no external write before authorization.
- Handoff: generate only from approved artifacts and reject a stale repository revision.
- T3 parity: consume the same handoff and lifecycle namespace through T3 Code's Codex surface.
- Profile change: preserve approved decisions and record rationale when the profile changes.
- Complex artifacts: require only the risk-specific ADR, prototype, migration, security or rollout evidence selected by the risk model.
- Failure recovery: resume from the smallest stale artifact rather than restarting the entire initiative.
- Measurement: emit separate comparable signals without a composite score.

### Good-test criteria

- Assert artifact roles, gates, visibility and side effects rather than exact prompt prose.
- Use isolated HOMEs, temporary repositories and fake external adapters for deterministic checks.
- Keep HumanLayer live probing read-only and separate from deterministic acceptance tests.
- Bind operational claims to executable/app version, resolved model, loaded skill evidence, timestamp and observed result.
- Treat generated documents as candidate evidence; tests cannot prove that a product decision is good.

### Prior art

- The persisted lifecycle already proves explicit requirements, spec/plan, ticket and Implement Preview gates.
- Repository audits already distinguish file existence from discovery, loading and influence; HumanLayer skill claims need the same evidence discipline.
- Implement Preview already provides the private handoff-to-delivery boundary and should remain the only implementation trigger.
- Current local visual artifacts establish the precedent for keeping operational decision surfaces outside product repositories and pull requests.

## Out of Scope

- Replacing T3 Code as the preferred implementation environment.
- Replacing the current lifecycle, Implement Preview, review loop or release train.
- Treating HumanLayer as the canonical source for product documents or authorization.
- Forking or rebuilding the deprecated open-source HumanLayer application.
- Enabling HumanLayer remote daemons, cloud integrations, auto-advance or default worktrees in the initial pilot.
- Automatically merging, releasing, deploying, activating paid services or performing destructive operations.
- Guaranteeing zero bugs, zero slop or lower cost solely from document generation.
- Requiring the full Standard or Complex chain for trivial changes.
- Publishing this draft or its tickets to Linear before the human ticket gate.

## Further Notes

- The Working Backwards idea follows Amazon's customer-first PR/FAQ method while removing the need for fictional marketing claims.
- HumanLayer's current workflow concepts inform the operator experience, but the integration must be validated against the installed version because its product and model routing change frequently.
- The decisive quality mechanism is not document count. It is early human judgment, evidence-backed research, explicit contracts, vertical slices, fresh implementation contexts and review against approved intent.
