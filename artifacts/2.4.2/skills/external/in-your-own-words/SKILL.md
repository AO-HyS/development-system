---
name: in-your-own-words
description: "Explica el objetivo, el problema y cómo propones resolverlo; termina el turno y espera revisión. Usa /in-your-own-words o $in-your-own-words."
disable-model-invocation: true
---

Cuando el usuario invoque esta skill para explicar una tarea, prepara una
propuesta revisable en su idioma. Reformula lo entendido con tus propias
palabras y distingue los hechos confirmados de tus supuestos.

Incluye detalle suficiente para que pueda corregir tanto el objetivo como el
método antes de empezar:

- Qué quiere lograr y cómo se reconocerá el resultado esperado.
- Qué problema resuelve y qué ocurre actualmente, según el contexto disponible.
- Cómo propones hacerlo: alcance, partes afectadas y pasos concretos en orden,
  con la razón de las decisiones principales. Explica cómo comprobarías el
  resultado. Identifica los límites, supuestos o decisiones pendientes que
  cambien el enfoque.

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
