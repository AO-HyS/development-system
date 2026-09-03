# Playbook propuesto: review en tres capas

Ninguna capa sustituye a otra y ninguna comparte contexto con el writer.

## Capa 1 — Devin Review como señal

Automática sobre el PR cuando la cuenta y cuota la ejecutan. Auto-Fix puede
iterar sobre hallazgos baratos si está habilitado, pero no sustituye las capas
independientes. Un check omitido, vencido o bloqueado por cuota se registra como
no ejecutado, no como aprobado.

## Capa 2 — review intent-aware

Route slot `review-intent`. Compara el diff contra el ticket de Linear y la spec,
no contra el gusto del revisor. Responde tres preguntas:

1. ¿El cambio implementa exactamente los criterios de aceptación del ticket?
2. ¿Introduce comportamiento no pedido, especialmente en permisos o datos?
3. ¿La evidencia adjunta demuestra el comportamiento reclamado?

## Capa 3 — review adversarial

Route slot `review-adversarial`, contexto aislado, sin acceso de escritura y sin
ver el razonamiento del writer. Su mandato es falsificar la corrección: buscar
el caso que rompe el cambio, el rol que obtiene acceso indebido, el tenant que
se filtra, la migración sin rollback y la evidencia que en realidad no prueba lo
que dice probar.

Si no encuentra nada, lo declara explícitamente; el silencio no es un aprobado.

Ambas capas de juicio intentan Factory Fable 5.1 XHigh, luego Devin Fable 5.1
XHigh y finalmente Codex Sol XHigh. Sol Max sólo se usa ante una escalada
crítica explícita. Fable no participa en búsqueda, edición ni checks mecánicos.

## Regla de evidencia

Un cambio materialmente visible sin evidencia Computer Use repo-local queda
Draft o es `blocker`, no una observación. Las capas juzgan sobre evidencia
neutral producida por el runner; el runner nunca emite veredicto semántico.
