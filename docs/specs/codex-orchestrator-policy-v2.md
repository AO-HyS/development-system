# Spec: Orquestación Codex rápida, medible y cerrable

Fecha: 2026-08-16  
Estado: **Borrador para revisión**  
Fuente: grill aprobado y auditoría local del 16 de julio al 16 de agosto de 2026.

## Problem Statement

El runtime multiagente sí comprime trabajo independiente, pero el orquestador lo usa en tareas donde no aporta valor, abre demasiados reviewers, consulta repetidamente el estado de los agentes y termina sesiones con lanes sin cierre observable. Esto puede producir un primer diff rápido sin alcanzar el estado realmente solicitado, aumentar correcciones y dejarle a Alejandro demasiadas cosas por revisar.

Working Backwards también añade fricción innecesaria: las preguntas no aprovechan la interfaz nativa de decisiones múltiples y la aprobación de documentos todavía depende de fórmulas demasiado específicas.

## Solution

Definir una política global, capability-aware y exigible por defecto que optimice **entrega verificada**, no actividad de agentes. Los cambios triviales se implementan directamente. El trabajo no trivial usa un writer por slice; se delega únicamente por independencia real o especialidad necesaria y se limita normalmente a tres subagentes concurrentes.

Multi-Agent v2 reutiliza identidades estables, corrige mediante follow-ups y espera por eventos. Cada lane termina explícitamente como integrada, descartada, bloqueada con responsable o no iniciada. Reviews y QA se seleccionan por riesgo observable.

Cada ejecución registra outcome, tiempo, correcciones y coordinación. Check-in presenta una acción prioritaria por repositorio, separada en Móvil, Computadora o Sin acción. La revisión corre semanalmente y bajo pedido. El piloto usa trabajo natural y se evalúa a los cinco días o cinco ejecuciones no triviales, extendiéndose sólo cuando falta evidencia.

Working Backwards usa un Topic por turno con una a tres decisiones relacionadas, opciones recomendadas y ejemplos. La aprobación acepta lenguaje natural breve para el artefacto activo, pero cualquier cambio, pregunta o ambigüedad mantiene el documento en revisión.

## User Stories

1. Como Alejandro, quiero medir el tiempo hasta el estado autorizado realmente verificado, para no confundir un diff rápido con una entrega terminada.
2. Como Alejandro, quiero que los cambios triviales se resuelvan directamente, para no pagar coordinación innecesaria.
3. Como Alejandro, quiero delegación sólo por independencia o especialidad, para evitar subagentes ceremoniales.
4. Como Alejandro, quiero máximo tres subagentes concurrentes por defecto, para mantener las olas comprensibles y cerrables.
5. Como Alejandro, quiero un writer por slice no trivial, para conservar propiedad clara.
6. Como Alejandro, quiero writers paralelos sólo en superficies disjuntas, para reducir conflictos de integración.
7. Como Alejandro, quiero reutilizar el agente responsable durante correcciones, para no repetir contexto.
8. Como Alejandro, quiero que el padre espere por eventos, para eliminar polling frecuente.
9. Como Alejandro, quiero que cada lane tenga un estado terminal explícito, para saber qué quedó integrado, descartado o bloqueado.
10. Como Alejandro, quiero reviewers seleccionados por riesgo, para evitar inflación sin perder seguridad, performance o calidad visual cuando sí aplican.
11. Como Alejandro, quiero QA runtime en cambios observables, para probar comportamiento y no sólo código estático.
12. Como Alejandro, quiero degradación limpia cuando v2 no convenga o no esté disponible, para que una herramienta auxiliar no bloquee trabajo correcto.
13. Como Alejandro, quiero comparar contra historial real equivalente, para evitar repetir tareas como benchmark.
14. Como Alejandro, quiero una acción prioritaria por repositorio en Check-in, para poder revisar el sistema rápidamente.
15. Como Alejandro, quiero saber qué puedo resolver desde móvil y qué requiere computadora, para aprovechar mis ventanas cortas de atención.
16. Como Alejandro, quiero candidatos locales verificados para correcciones seguras, para no iniciar cada arreglo desde cero.
17. Como Alejandro, quiero preguntas agrupadas por Topic, para resolver decisiones relacionadas sin una conversación interminable.
18. Como Alejandro, quiero aprobar con lenguaje natural, para no memorizar frases del workflow.
19. Como Alejandro, quiero que feedback y aprobación no se mezclen, para revisar los bytes finales antes de avanzar.
20. Como Alejandro, quiero que una aprobación natural afecte sólo el artefacto activo, para preservar todos los gates externos.

## Implementation Decisions

- La política canónica vive en Development System. Los repositorios declaran capacidades, comandos, stack y excepciones justificadas; no copian otra política completa.
- El router selecciona cero subagentes para cambios triviales, uno para un slice no trivial o una especialidad y dos o tres sólo para frentes independientes.
- El padre conserva descomposición, integración, conflictos, decisiones técnicas y estado terminal.
- Un writer posee cada slice. Writers paralelos requieren ownership disjunto y orden de integración explícito.
- Reviews base y especializados se eligen a partir de superficies y riesgos observables, no por tamaño aparente.
- Browser o runtime QA se exige para UI, navegación, mutaciones, integraciones y regresiones de comportamiento; cambios internos usan checks enfocados.
- Multi-Agent v2 usa task names estables, follow-ups para corrección, espera por eventos e interrupción únicamente de lanes que dejaron de ser relevantes.
- La finalización falla cerrada mientras una lane iniciada carezca de estado terminal.
- La medición incluye estado solicitado, estado alcanzado, wall time, primer candidato funcional, correcciones, waits, spawns, follow-ups, reviewers, writers, QA, lanes abiertas y fallback.
- El piloto incluye todo desarrollo nuevo, incluso ejecuciones directas que correctamente usaron cero subagentes.
- La política se conserva sólo si no degrada outcomes y reduce espera, retrabajo o lanes abiertas. Si no, se ajusta y vuelve a observar.
- Check-in reutiliza el Reader existente; no se crea otro dashboard.
- El reporte se regenera semanalmente y cuando el usuario diga `Ya llegué` o solicite revisar el piloto.
- Las correcciones automáticas terminan en candidato local verificado. PR, merge, release y producción conservan autorizaciones separadas.
- El protocolo de preguntas genera una a tres decisiones del mismo Topic y usa `request_user_input` cuando esté disponible; de lo contrario usa un fallback equivalente en chat.
- La aprobación natural acepta afirmaciones breves y directas. Preguntas, negaciones, ambigüedad, aprobación reportada, múltiples gates o cambios pedidos no aprueban.

## Acceptance Seams

1. **Router de orquestación:** dada una tarea y sus superficies, devuelve ejecución directa o lanes justificadas, con máximo tres concurrentes salvo excepción documentada.
2. **Reconciliación de ejecución:** dada la evidencia de una sesión, ninguna tarea queda `completed` con lanes iniciadas sin estado terminal.
3. **Medición del piloto:** clasifica ejecuciones directas, secuenciales y multiagente y compara outcomes sin inventar causalidad.
4. **Proyección de Check-in:** selecciona primero una acción por repositorio y la clasifica como Móvil, Computadora o Sin acción.
5. **Preguntas por Topic:** produce el mismo contrato de decisiones para la herramienta nativa y el fallback de chat.
6. **Aprobación natural:** acepta afirmaciones directas para un solo artefacto y falla cerrada ante feedback, preguntas o autorización múltiple.

## Testing Decisions

- Probar comportamiento observable mediante los seis seams anteriores; evitar snapshots de prompts o reportes completos.
- Usar fixtures históricas anonimizadas para validar routing, compresión, waits, retrabajo y cierre sin copiar transcripts privados.
- Cubrir cambios triviales directos, una especialidad, tres frentes independientes, dependencia secuencial y excepción documentada.
- Cubrir reuse/follow-up, espera por evento, lane descartada y lane bloqueada con responsable.
- Probar que seguridad, visual y browser QA sólo aparecen cuando las superficies correspondientes cambian.
- Probar el mismo Topic en payload nativo y chat, incluyendo rechazo de más de tres decisiones.
- Probar aprobaciones naturales en español e inglés y negativos con cambios, preguntas, citas, historial y múltiples gates.
- Validar el piloto con trabajo natural; no pedir una segunda ejecución artificial al usuario.

## Rollout

1. Publicar e instalar el contrato y catálogo nuevos en Development System.
2. Activar la política global con degradación limpia y sin modificar silenciosamente reglas específicas de repositorios.
3. Capturar todas las ejecuciones nuevas en los repos principales y Opportunity OS.
4. Evaluar a los cinco días o cinco ejecuciones no triviales; extender únicamente si la muestra sigue siendo insuficiente.
5. Conservar, ajustar o revertir la política según outcomes, espera, retrabajo y lanes abiertas.

## Out of Scope

- Aumentar el límite de concurrencia por encima de tres como default.
- Repetir tareas del usuario para producir un benchmark A/B.
- Crear otro dashboard o convertir automáticamente cada hallazgo en un ticket.
- Autorizar PR, merge, release, producción, infraestructura pagada o cambios destructivos desde Check-in.
- Homogeneizar arquitectura, stack, diseño o Release Train entre productos.

## Further Notes

- Los datos históricos prueban correlación y compresión temporal, no causalidad completa.
- La ausencia de telemetría de costo, tokens o provider permanece `unproven`; no bloquea el piloto.
- Multi-Agent v2 es una capacidad de ejecución, no un requisito para tareas que se resuelven mejor de forma directa.
