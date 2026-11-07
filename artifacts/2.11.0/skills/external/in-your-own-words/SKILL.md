---
name: in-your-own-words
description: "Explica lo que entendiste de la petición, propone cómo mejorarla (preguntas de sharpen), arma el plan con su definición de terminado y cómo lo vas a probar; termina el turno y espera revisión. Tras la aprobación, no das el trabajo por terminado hasta cumplir esa definición. Usa /in-your-own-words o $in-your-own-words."
disable-model-invocation: true
---

Cuando el usuario invoque esta skill, su mensaje ya es la petición. Prepara una
propuesta revisable en su idioma con cinco partes, en este orden:

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
   principales; límites, supuestos o decisiones pendientes que cambien el
   enfoque. Señala qué pasos dependen de una mejora sugerida, para que quitarla
   no rompa el plan.
4. **Cuándo está terminado.** Una lista corta y numerada de lo que debe ser
   cierto al final, en el punto final que el usuario autorizó (por ejemplo
   producción, develop o una respuesta). Cada punto dice qué se hace y qué se
   debe ver: `acción o comando -> lo que se observa`. Debe poder revisarlo
   alguien que no seas tú. Señala los puntos que dependen de una mejora
   sugerida.
5. **Cómo lo voy a probar.** Para cada punto de la lista anterior, la prueba
   real: navegador, uso de computadora, cuentas de prueba del repositorio o el
   comando de verificación del proyecto, nunca pruebas automatizadas nuevas.
   Di también qué no vas a poder probar y por qué, y qué efectos reales tendrá
   la prueba (cargos, correos, escrituras) o que no tendrá ninguno.

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

Después de la aprobación, la lista de **Cuándo está terminado** aprobada es la
meta del trabajo:

- Antes de decir que terminaste o de cerrar un turno, revisa cada punto con su
  prueba. Si falta alguno y puedes avanzar con lo autorizado, sigue trabajando
  en vez de preguntar o reportar.
- Solo detente antes por un bloqueo concreto que no puedas resolver con lo
  autorizado (un permiso distinto, un dato que solo el usuario tiene, una
  decisión de un solo sentido); nómbralo y di qué punto queda pendiente.
- No cambies ni aflojes la lista por tu cuenta para darla por cumplida; si la
  evidencia muestra que un punto está mal planteado, explícalo y pide la
  corrección.
- En el reporte final marca cada punto como pasó, falló o no se alcanzó, con su
  evidencia.
