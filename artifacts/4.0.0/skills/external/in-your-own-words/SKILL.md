---
name: in-your-own-words
description: "Primera respuesta a un encargo de producto, y cuando el usuario escribe /in-your-own-words o $in-your-own-words: explica lo que entendiste, propone cómo mejorarlo, arma el plan con su definición de terminado y cómo lo vas a probar. Tras la aprobación, el trabajo no se da por terminado hasta cumplir esa definición."
---

Úsala cuando el usuario la invoque y, sin que la invoque, como primera
respuesta a un encargo que cambia un producto. Su mensaje ya es la petición.
Prepara una propuesta revisable en su idioma con cinco partes, en este orden:

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
   suyo. Si hay un camino claramente más simple, pregúntalo en una línea:
   «¿seguro que quieres X? Sería mucho más simple Y».
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
   sugerida. Incluye lo que no debe pasar. Marca cada punto con dónde se
   comprueba: `pantalla`, `servidor` o `regla` (lint o tipos). Estos puntos son
   los renglones que corre la skill `verificar`.
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

Cuando la usas sin que el usuario la invoque, la pausa depende del encargo:

- Si cambia cómo se comporta el producto, espera su «sí» o su corrección igual
  que arriba; mientras tanto sólo lee código y enciende el producto.
- Si el encargo ya trae su definición de terminado (un ticket con «Listo
  cuando» que se puede decidir, o criterios que el usuario dictó y se pueden
  decidir) o es mecánico, muestra las cinco partes con sus palabras y sigue
  trabajando sin esperar.

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
- Si el usuario cambia el encargo a medio camino, corrige la lista en el mismo
  hilo y di qué puntos cambiaron.
