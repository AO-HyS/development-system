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

## Configuración vigente (2.9.0)

La fuente generada de verdad es `artifacts/2.9.0/model-routing.md`; la página
`docs/model-routing.md` la resume. El modelo elegido al iniciar la conversación
sigue siendo el orquestador y conserva la coordinación, la integración y las
correcciones.

- Sol 6.1 High planifica con un padre Anthropic y revisa el resultado integrado.
- Opus 5.5 planifica con un padre OpenAI, implementa lo difícil y la interfaz, y hace la crítica independiente de planes y de lo visual.
- Sonnet 5.5 ejecuta trabajo general acotado.
- Haiku 5.5 Medium (`claude-haiku-5-5`) escribe lo exacto y mecánico y mapea código en solo lectura.
- Terra 6.1 fast (prioridad): uso de computadora y simulador en Low, pruebas de navegador en High, video en Medium.

Cada selección depende de la tarea; no activamos todos los roles en cada
funcionalidad. Al terminar, se resuelve (settle) el hilo de cada hijo delegado
tras integrar su resultado, y antes del primer `delegate_task` se lee
`runtimeMode`. Las revisiones siguen el presupuesto por línea de rama.
