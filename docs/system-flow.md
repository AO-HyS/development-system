# Rápido → bien → barato

La meta es entregar la funcionalidad completa y usable en el menor tiempo posible.
Después optimizamos corrección; después costo. Medimos desde la petición hasta la
entrega, incluidas esperas y correcciones. Elegir un modelo barato que necesita más
vueltas puede empeorar la primera prioridad.

## El sistema completo

1. **Entender.** Tú describes el resultado. Cuando falta dirección hacemos grill
   y conservamos las decisiones. Una tarea clara pasa directo a ejecución.
2. **Elegir.** Astra revisa solo el código y contexto relevantes. Investiga o
   prueba opciones si eso puede evitar rehacer trabajo. El resultado es un encargo
   observable, no un documento grande por obligación.
3. **Ordenar.** Los tickets guardan alcance y aceptación. Astra identifica qué
   depende de qué. A y C pueden avanzar juntos si no comparten escritura; B espera
   sus dependencias. Al terminar una unidad, se calcula qué quedó listo.
4. **Construir.** Trabajadores capaces y rápidos reciben archivos, revisión,
   resultado esperado y comprobaciones. Astra mantiene decisiones, integración
   y correcciones. Las herramientas ejecutan búsquedas, comandos y lotes estables.
5. **Comprobar.** Seleccionamos comprobaciones por el cambio. Lint verifica reglas;
   typecheck, tipos; React Doctor, patrones React; reglas de arquitectura, límites
   del repo. Un flujo real comprueba lo que hace la persona. Un test opcional
   protege una regresión concreta. Cada fallo debe llevar a una corrección útil.
6. **Revisar.** Astra revisa el trabajo y los riesgos. Especialistas entran cuando
   aportan una revisión necesaria. Para cambios visuales: dirección acordada,
   Impeccable, crítico Astra independiente y correcciones de los estados afectados.
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
- Linear: trabajo y aceptación; Astra realiza la coordinación viva.
- Impeccable: trabajo de diseño; el crítico juzga las pantallas renderizadas.
- Codex/T3: herramientas y ciclo de vida de ejecución. Usamos capacidades nativas
  disponibles, sin inferir funcionalidades de otros hosts a partir de una versión.

## Estado de este cambio

Candidato local 1.12.0: prioridad explícita, selección de proveedor solo por el
padre, contexto acotado, tests nuevos opcionales y documentación proporcional.
Conserva rutas de modelos y gates existentes. No demuestra todavía mayor velocidad.
La comparación acordada son cuatro ejecuciones: misma tarea por repo con Astra
Low y Medium, mismos workers, versión fijada y entornos aislados. Espera los
pequeños tickets de Linear del usuario.
