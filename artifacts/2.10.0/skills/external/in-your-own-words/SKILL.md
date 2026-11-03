---
name: in-your-own-words
description: "Explica lo que entendiste de la petición, propone cómo mejorarla (preguntas de sharpen) y arma el plan; termina el turno y espera revisión. Usa /in-your-own-words o $in-your-own-words."
disable-model-invocation: true
---

Cuando el usuario invoque esta skill, su mensaje ya es la petición. Prepara una
propuesta revisable en su idioma con tres partes, en este orden:

1. **Lo que entendí.** Reformula la petición con tus propias palabras, sin
   cambiarla todavía: qué quiere lograr, qué problema resuelve, qué ocurre
   actualmente según el contexto disponible y cómo se reconocerá el resultado.
   Distingue los hechos confirmados de tus supuestos.
2. **Cómo mejorarla.** Sobre esa petición entendida, responde:
   - Qué haría aquí un profesional de primer nivel en este campo que no se está
     pidiendo.
   - De qué material crudo partiría (código, datos, registros, la fuente
     original) en lugar de resúmenes ya digeridos.
   - Qué métodos y herramientas concretas usaría.
   - Qué evidencia, aparte del usuario o de ti, demostraría que el resultado es
     correcto.

   Con esas respuestas, lista las mejoras que de verdad sirven a su objetivo,
   marcadas como sugeridas para que el usuario las acepte o las quite. No
   amplíes el alcance con trabajo que no sirve a su objetivo ni decidas lo que es
   suyo.
3. **El plan.** Sobre la petición entendida y las mejoras sugeridas: alcance,
   partes afectadas y pasos concretos en orden, con la razón de las decisiones
   principales; cómo comprobarías el resultado; límites, supuestos o decisiones
   pendientes que cambien el enfoque. Señala qué pasos dependen de una mejora
   sugerida, para que quitarla no rompa el plan.

Ajusta el detalle a la tarea: una explicación concreta y comprensible, sin
inventar hechos ni convertirla en una especificación extensa. Puedes consultar
fuentes de solo lectura cuando sean necesarias para fundamentarla.

Entrega la propuesta como respuesta final y termina el turno indicando que
esperas la revisión del usuario. La invocación establece este punto de pausa,
aunque la petición original de la tarea incluyera implementarla: las ediciones,
comandos con efectos y delegaciones de ejecución quedan pendientes de su
aprobación explícita posterior. No inicies trabajo en segundo plano.

Si el usuario corrige la propuesta o añade requisitos, revísala y vuelve a
terminar el turno esperando aprobación; una corrección por sí sola no autoriza
la ejecución. Tras la aprobación, continúa únicamente con el alcance y las
operaciones autorizadas.
