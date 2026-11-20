# Rápido → bien → barato

La meta es entregar la funcionalidad completa y usable en el menor tiempo posible.
Después optimizamos corrección; después costo. Medimos desde la petición hasta la
entrega, incluidas esperas y correcciones. Elegir un modelo barato que necesita más
vueltas puede empeorar la primera prioridad.

## El sistema completo

1. **Entender.** Tú describes el resultado. Cuando falta dirección hacemos grill
   y conservamos las decisiones. Una tarea clara pasa directo a ejecución.
2. **Elegir.** El orquestador revisa solo el código y contexto relevantes. Investiga o
   prueba opciones si eso puede evitar rehacer trabajo. El resultado es un encargo
   observable, no un documento grande por obligación.
3. **Ordenar.** Los tickets guardan alcance y aceptación. El orquestador identifica qué
   depende de qué. A y C pueden avanzar juntos si no comparten escritura; B espera
   sus dependencias. Al terminar una unidad, se calcula qué quedó listo.
4. **Construir.** Trabajadores capaces y rápidos reciben archivos, revisión,
   resultado esperado y comprobaciones. El orquestador mantiene decisiones, integración
   y correcciones. Las herramientas ejecutan búsquedas, comandos y lotes estables.
5. **Comprobar.** Seleccionamos comprobaciones por el cambio. Lint verifica reglas;
   typecheck, tipos; React Doctor, patrones React; reglas de arquitectura, límites
   del repo. Un flujo real comprueba lo que hace la persona. Un test opcional
   protege una regresión concreta. Cada fallo debe llevar a una corrección útil.
6. **Revisar.** El orquestador revisa el trabajo y los riesgos. Especialistas entran cuando
   aportan una revisión necesaria. Para cambios visuales: dirección acordada,
   Impeccable, crítico independiente y correcciones de los estados afectados.
7. **Entregar.** Una vez revisado el candidato, se graba el recorrido representativo.
   Se usan capturas durante la investigación; la evidencia final corresponde al
   resultado terminado. Se completan CI, preview y publicación según la autorización
   vigente. Un link local, un preview y producción son estados distintos.
8. **Aprender.** Registramos tiempo hasta entrega, errores, repeticiones y consumo
   separado. Cambiamos instrucciones o rutas por resultados observados.

## Dónde vive cada responsabilidad

- Development System: prioridad, delegación, selección de comprobaciones y cierre.
- AGENTS y skills del repo: arquitectura y particularidades del producto.
- Configuración y CI del repo: comandos y gates ejecutables.
- Linear: trabajo y aceptación; el orquestador realiza la coordinación viva.
- Impeccable: trabajo de diseño; el crítico juzga las pantallas renderizadas.
- Codex/T3: herramientas y ciclo de vida de ejecución. Usamos capacidades nativas
  disponibles, sin inferir funcionalidades de otros hosts a partir de una versión.

## Configuración vigente (3.1.0)

La fuente generada de verdad es `artifacts/3.1.0/model-routing.md`; la página
`docs/model-routing.md` la resume. El modelo elegido al iniciar la conversación
sigue siendo el orquestador y decide cómo trabajar: ningún agente, modelo,
skill ni orden de trabajo es obligatorio.

- Sol 6.1 High hace la lectura independiente de un cambio crítico antes de fusionarlo y la del lote de cambios normales al final de la sesión.
- Fable 5.2 queda fuera de la rutina.
- Opus 5.5, Sonnet 5.5 y Haiku 5.5 (`claude-haiku-5-5`): los agentes con nombre conservan su modelo; ninguno es obligatorio.
- Terra 6.1 fast (prioridad): uso de computadora y navegador para lo que QuickE2E y Playwright no alcanzan.
- Claude Code, forma AF (4.1.0): el padre administra; `escritor-rapido` (Sonnet 5.5 medium) escribe el producto y un `verificador-pantalla` fresco (Sonnet 5.5 medium, Browse por MCP) prueba los renglones de pantalla. Los pasos están en `~/.claude/rules/orchestration.md` y en `flow-implement/references/forma-af.md`; sin otra lectura de modelos dentro de la corrida. Codex no cambia.

El guard del roster y la puerta de cierre ya no están conectados. Lo que pasa
cada cambio está en [listo.md](listo.md): el nivel sale de `config/niveles.json`
del repositorio (crítico, normal o mecánico), Codex terminó y cada comentario
tiene respuesta, la prueba rápida con QuickE2E corre siempre sin frenar la
fusión a develop, y un cambio crítico necesita antes de fusionar una lectura
independiente, sus casos corridos de verdad y el registro.
