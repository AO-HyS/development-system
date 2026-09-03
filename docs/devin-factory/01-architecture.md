# Arquitectura de la fábrica cloud-first

## Objetivo

Evaluar sesiones Devin como plano de ejecución cloud subordinado al lifecycle
de Development System 1.5.16, sin perder gates humanos, review independiente ni
evidencia verificable, y optimizando en este orden: **velocidad**, luego
**correctness**, luego **costo**. No hay un harness cloud publicado por este
documento.

La fábrica añade un harness, no autoridad nueva. `docs/spec.md` y
ADR 0017 siguen mandando: el planner permanece puro (`dispatchAuthorized:false`),
el paralelismo lo autoriza el host, y merge/release/producción siguen fuera de
la autorización de implementación.

## Mapeo lifecycle → superficies de Devin

| Etapa del lifecycle | Superficie Devin | Modo | Evidencia |
| --- | --- | --- | --- |
| `grill-with-docs` | orquestador canónico, plan-only | Sol | notas + Local Visual Plan |
| Gate de requisitos | mensaje bloqueante al humano | — | aprobación explícita |
| `to-spec` + Local Visual Plan | orquestador canónico, plan-only | Sol | spec + reader local |
| Gate de spec/plan | mensaje bloqueante | — | aprobación explícita |
| `to-tickets` | orquestador canónico + Linear | Sol | tickets con metadata completa |
| Gate de tickets | mensaje bloqueante | — | aprobación explícita |
| `Implement Preview` | autorización del host | — | binding request/repo/revision/IDs |
| Delivery loop | Scout → Ship → checks → integración | cadena rápida 1.5.16 | commits, checks, PR |
| Review post-integración | señal Devin Review + reviewer independiente | cadena de juicio 1.5.16 | findings clasificados |
| QA visible | Computer Use repo-local | Luna Max + juicio separado | recording + screenshots |
| Pre-release, recap, preview, PR | orquestador canónico | Sol | PR abierto sin merge |
| Gate humano final | mensaje bloqueante | — | aprobación explícita |

## Routing canónico y topología cloud

`verified` en la preparación del 2 de septiembre de 2026: el modo Devin se
cambiaba en caliente (toggle en la webapp; `!fusion`,
`!ultra`, `!fast`, `!lite`, `!normal`, `!swe` en Slack), así que la política de
modo podía usarse como topología de sesión. Debe revalidarse antes de un piloto.
No reemplaza la política de modelo publicada en 1.5.16.

Política efectiva por slot:

| routeSlot | Dueño | Ruta | Razón |
| --- | --- | --- | --- |
| `orchestration` | padre canónico | Codex Sol High | conserva contexto, autorización e integración |
| `discovery` (Scout) | worker read-only | SWE-1.7 → GLM 5.3 Flash → Gemini 3.8 Flash verificado → Luna Max Fast | buscar y mapear también es trabajo mecánico |
| `implementation` (Ship) | writer único | misma cadena rápida | evita reservar el modelo caro para editar archivos |
| `verification` | runner focalizado | misma cadena rápida | ejecución y recolección sin juicio semántico |
| `review-intent` | reviewer independiente | Fable 5.1 XHigh → Fable 5.1 XHigh → Sol XHigh | juicio contra ticket y spec |
| `review-adversarial` | reviewer independiente | misma cadena de juicio | frontera de proveedor y contexto limpio |
| `computer-use` | runner neutral | Luna Max | ejecuta y registra; no decide PASS/FAIL |
| `security` | specialist | Sol XHigh | riesgo de autorización y trust boundaries |

El padre nunca delega decomposición, integración, resolución de conflictos ni
estado terminal. Un solo writer por defecto; escribir en paralelo exige
propiedad disjunta y surface locks, igual que en ADR 0017.

Fusion puede mantener una sesión cloud caliente o coordinar sidekicks, pero no
autoriza usar un modelo distinto del resuelto por la cadena ni permite afirmar
que un modelo corrió sin receipt positivo.

## Skills del worker

El orquestador carga las skills de lifecycle y decide qué capacidad hace falta.
Scout y Ship reciben sólo `AGENTS.md`, las instrucciones repo-locales, la skill
de la capacidad seleccionada y el plan autorizado. No se replica el catálogo
global dentro de cada sesión Devin: para buscar, crear archivos, editar y correr
checks aporta latencia y aumenta el riesgo de reglas contradictorias.

## Scout / Ship

`proposed` (Devin no publica una API llamada "Scout" ni "Ship"; aquí son
nombres de fase de nuestra fábrica, implementados con capacidades verificadas):

**Scout** — sesión o subagente de descubrimiento, read-only, sin permiso de
escritura ni de PR. Entrega: superficies tocadas, contratos afectados, riesgo
observable, nivel de QA propuesto, lista de checks focalizados, estimación de
paralelismo. Scout no propone diffs largos; propone el plan mínimo verificable.

**Ship** — writer único que implementa el plan aprobado, corre `quality:changed`
del repo y abre PR. Ship no decide su propio nivel de QA ni cierra hallazgos de
review; eso vuelve al orquestador.

Regla dura: Scout y Ship no pueden saltarse los gates humanos. Scout se ejecuta
antes o dentro de la ventana de `Implement Preview`; Ship exige `Implement
Preview` explícito.

## Reviews

Tres capas, ninguna sustituye a otra:

1. **Devin Review** (`documented`): señal automática sobre el PR. Auto-Fix puede
   corregir hallazgos baratos cuando esté habilitado, pero no sustituye la
   review independiente. Un check omitido, vencido o bloqueado por cuota se
   registra como no ejecutado, nunca como aprobado.
2. **Review intent-aware**: además de
   estándares, se evalúa contra el objetivo solicitado del ticket. Se implementa
   con instrucciones de review por repositorio que obligan a comparar el diff
   contra el ticket y la spec, no sólo contra el estilo del repo.
3. **Review adversarial independiente**: sesión hija con contexto
   limpio, sin acceso al razonamiento del writer, mandato de falsificar
   correctness. Sólo lectura y ejecución de checks; no edita. Clasifica en
   `blocker`, `high`, `medium`, `low`. Sin tope numérico de rondas; se detecta
   no-convergencia (misma clase de hallazgo repetida en tres rondas → escalada
   humana).

Completion requiere: cero `blocker`/`high`, disposición explícita de `medium`,
gates verdes y la evidencia de QA que corresponda al riesgo.

## Evidencia de video

`proposed`: una sesión cloud puede conducir la UI y grabar, siempre que el
producto autorice ese mecanismo y la evidencia quede ligada al candidato.

Regla vigente: todo cambio materialmente visible para el usuario exige
Computer Use repo-local. Cambios internos, docs o refactors sin superficie
mapeada pueden omitir grabación con justificación registrada. Para NutriPlan y
The Barber Central, Playwright y Cypress no son mecanismos de aceptación.

## Paralelismo y velocidad

Palancas ordenadas por impacto esperado:

1. **Snapshots calientes** por repo (blueprints): `pnpm install` congelado,
   store de pnpm y codegen de Convex ya presentes.
2. **Scouts en paralelo** sobre tickets dependency-ready, con surface locks.
3. **Checks focalizados en lane** (`quality:changed`) y una sola barrera de
   integración con `quality:certify` sobre el candidato integrado.
4. **Un solo preview compartido** por candidato, no uno por lane.
5. **Playbooks** para flujos recurrentes y **automations** para reaccionar a CI
   y a hallazgos de review.
6. **Perfil de navegador persistente** para no repetir logins en cada QA.

Fan-out ancho de trabajo independiente que requiere checkout propio se ejecuta
como dynamic workflow con sesiones hijas; fan-out estrecho se queda en una sola
sesión con subagentes.

## Costo

Costo es la tercera prioridad, no la primera, pero se contiene reservando Fable
5.1 para juicio de alto valor, usando la cadena rápida para toda mecánica,
ejecutando un solo `quality:certify` por candidato, reutilizando snapshots y
poniendo un tope explícito al fan-out. Toda activación de infraestructura de
pago sigue siendo hard stop.

## Límites que no se negocian

- Ningún merge, release, deploy a producción ni activación de pago sin
  autorización exacta para esa operación.
- `artifacts/` y `manifests/` publicados son inmutables.
- La arquitectura, el stack y los proveedores siguen siendo locales a cada
  producto; la fábrica no homogeneiza los repos.
- Los Local Visual Plan y Recap siguen siendo privados y separados del PR.
