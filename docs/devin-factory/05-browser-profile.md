# Perfil de navegador y evidencia de video

## Perfil persistente

`documented`: el estado del navegador puede persistir entre sesiones cuando se
pide explícitamente guardar el perfil. La disponibilidad, el aislamiento y la
vigencia de ese perfil deben demostrarse en el runtime del piloto.

Diseño (`proposed`):

1. Un perfil por producto. No se mezclan sesiones de productos con datos
   sensibles distintos (`nutri-plan` maneja datos clínicos).
2. Dentro de un producto, un usuario de QA por rol relevante. Para el piloto de
   roles esto es obligatorio: la evidencia de autorización exige comparar lo que
   ve cada rol.
3. El login se ejecuta dentro del plan Computer Use repo-local, con credenciales
   QA tomadas del mecanismo autorizado y nunca hardcodeadas.
4. El repo conserva su propia capability de verificación. No se instala una
   skill global de login ni se usa Playwright/Cypress para sustituir Computer
   Use en NutriPlan o The Barber Central.
5. Nunca se exportan cookies, tokens ni contenido del perfil a documentos,
   tickets, PRs o métricas.

Rotación: si una credencial de QA cambia o expira, se reemplaza el secret y se
regenera el perfil; no se parchea el perfil a mano.

## Evidencia de video

`proposed`: un testing agent cloud puede ejecutar el plan y producir recording,
screenshots y observaciones neutrales si satisface el contrato Computer Use del
repo y liga toda evidencia al SHA candidato.

Política (`proposed`):

| Tipo de cambio | Evidencia mínima |
| --- | --- |
| Flujo de usuario nuevo o modificado | video del flujo completo + screenshots de estados clave |
| Permisos, roles, autorización | video por rol afectado, incluyendo el caso denegado |
| Layout/responsive | video corto + screenshots en los breakpoints tocados |
| Copy, iconos, docs, refactor interno | sin video; justificación registrada |
| Backend sin superficie mapeada | sin video; evidencia de tests |

Un cambio visible sin evidencia Computer Use suficiente queda Draft o
`blocker`. La grabación no sustituye el juicio semántico: el runner ejecuta y
registra, y el juez separado evalúa la evidencia neutral, tal como fija ADR
0017.

Las anotaciones de la grabación siguen el formato `setup` / `test_start` /
`assertion` con resultado explícito, para que el video sea auditable sin verlo
completo.
